"""安装范围内的有界业务观测；所有故障均与命令结果隔离。"""

import hashlib
import json
import os
import re
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .auth import AuthSession
from .distribution import SOURCE
from .errors import TeehoError
from .http_transport import HttpTransport
from .locking import lock_directory
from .storage import read_json, write_json
from .version import skill_version

MAX_PENDING_EVENTS = 100
MAX_BATCH_EVENTS = 20
MAX_FLUSHES = 2
REQUEST_TIMEOUT_SECONDS = 1
UNSUPPORTED_RETRY_SECONDS = 24 * 60 * 60
LOCK_ATTEMPTS = 10
LOCK_DELAY_SECONDS = 0.02
SOURCE_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
ACTIVE_COMMANDS = frozenset(
    {"login", "anonymous", "diagnose", "resume", "history", "status"}
)
OBSERVED_COMMANDS = ACTIVE_COMMANDS | {"installation", "login-status", "task", "wait"}
EVENT_TYPES = frozenset(
    {
        "installed",
        "activated",
        "diagnosis_started",
        "diagnosis_blocked",
        "authorization_started",
        "authorization_succeeded",
        "task_linked",
    }
)
BLOCK_REASONS = frozenset({"input", "credits", "authorization", "service", "other"})


def _source(value: object) -> str:
    if isinstance(value, str) and len(value) <= 48 and SOURCE_PATTERN.fullmatch(value):
        return value
    return "unknown"


def _identifier(value: object) -> bool:
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except ValueError:
        return False


def _valid_pending(item: object) -> bool:
    if not isinstance(item, dict) or set(item) != {
        "event",
        "ownerId",
        "source",
        "version",
    }:
        return False
    event = item["event"]
    if (
        not isinstance(event, dict)
        or not _identifier(event.get("id"))
        or event.get("type") not in EVENT_TYPES
    ):
        return False
    expected = {"id", "type"}
    if "occurredAt" in event:
        expected = expected | {"occurredAt"}
        occurred_at = event["occurredAt"]
        if not isinstance(occurred_at, str):
            return False
        try:
            if (
                datetime.fromisoformat(occurred_at.replace("Z", "+00:00")).tzinfo
                is None
            ):
                return False
        except ValueError:
            return False
    if event["type"] == "task_linked":
        expected = expected | {"taskId"}
        if not _identifier(event.get("taskId")) or not _identifier(item["ownerId"]):
            return False
    if event["type"] == "diagnosis_blocked":
        expected = expected | {"reason"}
        if event.get("reason") not in BLOCK_REASONS:
            return False
    return (
        set(event) == expected
        and (item["ownerId"] is None or _identifier(item["ownerId"]))
        and _source(item["source"]) == item["source"]
        and isinstance(item["version"], str)
        and len(item["version"]) <= 64
        and bool(
            re.fullmatch(
                r"\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?",
                item["version"],
            )
        )
    )


class SkillObservations:
    """首次来源固定，升级只改变当前来源；不为观测创建或刷新身份。"""

    def __init__(
        self, auth: AuthSession, log: Callable, transport: HttpTransport
    ) -> None:
        installation = os.path.normcase(str(Path(__file__).resolve().parents[2]))
        key = hashlib.sha256(installation.encode("utf-8")).hexdigest()
        self.root = auth.root / "installations" / key
        self.auth = auth
        self.log = log
        self.flushes = 0
        self.enabled = False
        self.transport = transport

    def _state(self) -> dict:
        state = read_json(self.root / "observations.json")
        if state is None:
            return {
                "installationId": str(uuid.uuid4()),
                "firstSource": _source(SOURCE),
                "seen": [],
                "pending": [],
            }
        if (
            not isinstance(state, dict)
            or not _identifier(state.get("installationId"))
            or _source(state.get("firstSource")) != state.get("firstSource")
            or not isinstance(state.get("seen"), list)
            or any(item not in {"installed", "activated"} for item in state["seen"])
            or not isinstance(state.get("pending"), list)
            or len(state["pending"]) > MAX_PENDING_EVENTS
            or not all(_valid_pending(item) for item in state["pending"])
            or ("retryAfter" in state and type(state["retryAfter"]) not in {int, float})
        ):
            raise TeehoError("invalid_local_data")
        return state

    def _safe(self, operation: Callable[[], None]) -> None:
        try:
            operation()
        except (OSError, TeehoError, ValueError, TypeError, KeyError, AttributeError):
            self.log("observation_unavailable", {"stage": "observation"})

    @contextmanager
    def _locked(self) -> Iterator[None]:
        """本地短事务允许有界等待，避免并发启动时全部丢失发送机会。"""
        for attempt in range(LOCK_ATTEMPTS):
            manager = lock_directory(self.root / "observations.lock")
            try:
                manager.__enter__()
                break
            except TeehoError as error:
                if error.code != "identity_busy" or attempt == LOCK_ATTEMPTS - 1:
                    raise
                time.sleep(LOCK_DELAY_SECONDS)
        try:
            yield
        finally:
            manager.__exit__(None, None, None)

    def begin(self, command: str) -> None:
        """帮助和安装检查不激活，轮询仅允许恢复已有事件。"""
        self.enabled = command in OBSERVED_COMMANDS
        if command in ACTIVE_COMMANDS:
            self.record("activated")
        if command == "login":
            self.record("authorization_started")
        if command == "diagnose":
            self.record("diagnosis_started")
        if self.enabled:
            self.flush()

    def finish(
        self,
        command: str,
        result: dict,
        owner_id: Optional[str],
        authorization_pending: bool = False,
    ) -> None:
        """安装命令确认包可运行后记录一次安装完成。"""
        if command == "installation":
            self.record("installed")
        if (
            command == "login-status"
            and authorization_pending
            and result.get("user", {}).get("isAnonymous") is False
        ):
            self._safe(self._authorized)
        task = result.get("task")
        if command in {"diagnose", "resume", "task", "wait"} and isinstance(task, dict):
            self._safe(
                lambda: self._record(
                    "task_linked", {"taskId": task.get("id")}, owner_id=owner_id
                )
            )

    def _authorized(self) -> None:
        identity = self.auth.read_identity() or {}
        device = identity.get("deviceToken")
        if isinstance(device, str) and device:
            key = hashlib.sha256(device.encode("utf-8")).hexdigest()
            self._record("authorization_succeeded", {}, key)

    def blocked(self, state: str) -> None:
        """只发送受控错误类别，绝不发送原始错误或输入。"""
        categories = {
            "invalid_input": "input",
            "invalid_request": "input",
            "insufficient_credits": "credits",
            "login_required": "authorization",
            "authorization_pending": "authorization",
            "account_changed": "authorization",
            "access_denied": "authorization",
            "anonymous_limit": "authorization",
            "service_unavailable": "service",
            "unavailable": "service",
            "invalid_response": "service",
            "rate_limited": "service",
        }
        self.record("diagnosis_blocked", reason=categories.get(state, "other"))

    def record(self, event_type: str, **fields: str) -> None:
        """仅持久化受控事件字段，待发队列永不写入凭据。"""
        if self.enabled:
            self._safe(lambda: self._record(event_type, fields))

    def _record(
        self,
        event_type: str,
        fields: dict,
        key: Optional[str] = None,
        owner_id: Optional[str] = None,
    ) -> None:
        identity = (
            {} if event_type == "installed" else (self.auth.read_identity() or {})
        )
        owner = owner_id if owner_id is not None else identity.get("user", {}).get("id")
        with self._locked():
            state = self._state()
            if event_type == "installed" and event_type in state["seen"]:
                return
            key = fields.get("taskId") if event_type == "task_linked" else key
            namespace = uuid.UUID(state["installationId"])
            identifier = (
                str(uuid.uuid5(namespace, event_type + ":" + key))
                if key
                else str(uuid.uuid4())
            )
            event = {
                "id": identifier,
                "type": event_type,
                "occurredAt": datetime.now(timezone.utc)
                .isoformat()
                .replace("+00:00", "Z"),
                **fields,
            }
            item = {
                "event": event,
                "ownerId": owner,
                "source": _source(SOURCE),
                "version": skill_version(),
            }
            if not _valid_pending(item):
                raise TeehoError("invalid_local_data")
            if any(entry["event"]["id"] == identifier for entry in state["pending"]):
                return
            pending = self._bounded([*state["pending"], item])
            seen = (
                [*state["seen"], event_type]
                if event_type == "installed"
                else state["seen"]
            )
            write_json(
                self.root / "observations.json",
                {**state, "seen": seen, "pending": pending},
            )

    def _bounded(self, pending: list[dict]) -> list[dict]:
        if len(pending) <= MAX_PENDING_EVENTS:
            return pending
        milestones = [
            next(item for item in pending if item["event"]["type"] == kind)
            for kind in ("installed", "activated")
            if any(item["event"]["type"] == kind for item in pending)
        ]
        protected = {item["event"]["id"] for item in milestones}
        remaining = [item for item in pending if item["event"]["id"] not in protected]
        self.log("observation_queue_trimmed", {"stage": "observation"})
        return [*milestones, *remaining[-(MAX_PENDING_EVENTS - len(milestones)) :]]

    def flush(self) -> None:
        """每次命令最多两次短请求，服务故障留待之后按原事件标识重试。"""
        if not self.enabled or self.flushes >= MAX_FLUSHES:
            return
        self.flushes += 1
        self._safe(self._flush)

    def _batch(self) -> Optional[tuple[dict, Optional[str]]]:
        with self._locked():
            state = self._state()
            pending = state["pending"]
            if not pending or state.get("retryAfter", 0) > time.time():
                return
            deliveries = [(item, self._delivery(item)) for item in pending]
            first = next((delivery for _, delivery in deliveries if delivery[0]), None)
            if first is None:
                return
            token = first[1]
            batch = [
                item
                for item, delivery in deliveries
                if delivery[0] and delivery[1] == token
            ][:MAX_BATCH_EVENTS]
            payload = {
                "installationId": state["installationId"],
                "firstSource": state["firstSource"],
                "currentSource": _source(SOURCE),
                "version": skill_version(),
                "events": [item["event"] for item in batch],
            }
            return payload, token

    def _delivery(self, item: dict) -> tuple[bool, Optional[str]]:
        owner = item["ownerId"]
        token = self.auth.cached_access_token(owner) if owner else None
        protected = item["event"]["type"] in {"task_linked", "authorization_succeeded"}
        return (bool(token) or not protected), token

    def _flush(self) -> None:
        batch = self._batch()
        if batch is None:
            return
        payload, token = batch
        response = self.transport.request(
            self.auth.base_url + "/skill/observations",
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Teeho-Skill-Version": skill_version(),
                **({"Authorization": "Bearer " + token} if token else {}),
            },
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status == 404:
            self._defer()
            return
        envelope = json.loads(response.body)
        if (
            response.status != 200
            or not isinstance(envelope, dict)
            or type(envelope.get("code")) is not int
            or envelope.get("code") != 0
        ):
            raise TeehoError("request_failed")
        self._acknowledge({event["id"] for event in payload["events"]})

    def _defer(self) -> None:
        with self._locked():
            state = self._state()
            write_json(
                self.root / "observations.json",
                {
                    **state,
                    "retryAfter": time.time() + UNSUPPORTED_RETRY_SECONDS,
                },
            )

    def _acknowledge(self, sent: set[str]) -> None:
        with self._locked():
            state = self._state()
            write_json(
                self.root / "observations.json",
                {
                    **state,
                    "pending": [
                        item
                        for item in state["pending"]
                        if item["event"]["id"] not in sent
                    ],
                },
            )
