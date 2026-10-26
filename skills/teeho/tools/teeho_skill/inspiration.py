"""灵感索引：独立请求、本机持久化及领取确认。"""

import time
from pathlib import Path
from typing import Callable, Optional
from uuid import uuid4

from .api import TeehoApi
from .auth import AuthSession
from .constants import MEDIA_WAIT_SECONDS, POLL_SECONDS
from .errors import TeehoError
from .inspiration_contract import read_result, read_task
from .inspiration_feedback import INPUT_PROTOCOL, FEEDBACK_KIND, InspirationInputFeedback, needs_feedback_protocol, read_input_feedback, submission_fields
from .locking import lock_directory
from .note import require_id
from .storage import ensure_private_directory, is_link, native_path, read_json, write_json


class InspirationTools:
    """HTTP 在身份锁之外执行；每次操作始终绑定启动时账号。"""

    def __init__(
        self,
        api: TeehoApi,
        auth: AuthSession,
        expected_user_id: Optional[str] = None,
        *,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep
    ) -> None:
        self.api, self.auth = api, auth
        self.owner = require_id(
            expected_user_id or (auth.read_identity() or {}).get("user", {}).get("id"),
            "login_required",
        )
        self.root = native_path(Path(auth.root) / "accounts" / self.owner / "inspiration")
        self.now, self.sleep = now, sleep

    def _check_owner(self) -> None:
        if (self.auth.read_identity() or {}).get("user", {}).get("id") != self.owner:
            raise TeehoError("login_required")

    def _pending(self) -> Optional[dict]:
        state = read_json(self.root / "pending.json")
        if state is None:
            return None
        if not isinstance(state, dict) or state.get("userId") != self.owner:
            raise TeehoError("invalid_local_data")
        require_id(state.get("submissionId"), "invalid_local_data")
        return state

    def _clear_pending(self, task_id: str) -> None:
        with lock_directory(self.root / "operation.lock"):
            pending = self._pending()
            if pending and pending["submissionId"] == task_id:
                (self.root / "pending.json").unlink(missing_ok=True)

    def _record_path(self, task_id: str) -> Path:
        return self.root / "history" / (require_id(task_id, "invalid_input") + ".json")

    def _record(self, task_id: str) -> Optional[dict]:
        value = read_json(self._record_path(task_id))
        if value is None:
            return None
        if (
            not isinstance(value, dict)
            or value.get("schemaVersion") != "inspiration-local.v1"
            or value.get("userId") != self.owner
            or type(value.get("receiptConfirmed")) is not bool
        ):
            raise TeehoError("invalid_local_data")
        task = read_task(value.get("task"), task_id)
        return {**value, "task": task, "result": read_result(value.get("result"), task)}

    def submit(self, value: object) -> dict:
        """先保存新意图；未确认的旧提交必须恢复，不覆盖原身份。"""
        fields = submission_fields(value)
        self._check_owner()
        capabilities = self.api.inspiration_capabilities(expected_user_id=self.owner)
        if needs_feedback_protocol(fields) and capabilities.get("inputProtocol") != INPUT_PROTOCOL:
            raise TeehoError("inspiration_input_unsupported")
        ensure_private_directory(self.root)
        with lock_directory(self.root / "operation.lock"):
            pending = self._pending()
            if pending is not None:
                raise TeehoError("identity_busy")
            pending = {
                "userId": self.owner,
                "submissionId": str(uuid4()),
                "input": fields,
            }
            write_json(self.root / "pending.json", pending)
        return self.resume(capabilities=capabilities)

    def resume(self, *, capabilities: Optional[dict] = None) -> dict:
        """提交响应未知也只重用本次原身份，不生成新购买。"""
        self._check_owner()
        pending = self._pending()
        if not pending:
            raise TeehoError("inspiration_no_pending")
        payload = {
            **submission_fields(pending.get("input")),
            "submissionId": pending["submissionId"],
        }
        try:
            if needs_feedback_protocol(submission_fields(pending.get("input"))):
                capabilities = capabilities or self.api.inspiration_capabilities(expected_user_id=self.owner)
                if capabilities.get("inputProtocol") != INPUT_PROTOCOL:
                    raise TeehoError("inspiration_input_unsupported")
            response = self.api.submit_inspiration(payload, expected_user_id=self.owner)
            if response.get("kind") == FEEDBACK_KIND:
                feedback = read_input_feedback(response)
                if feedback["state"] != "input_required":
                    raise TeehoError("invalid_response")
                self._clear_pending(pending["submissionId"])
                return {"inspirationInputFeedback": feedback}
            task = read_task(response, pending["submissionId"])
            return self._finish(task)
        except InspirationInputFeedback as error:
            self._clear_pending(pending["submissionId"])
            return {"inspirationInputFeedback": error.feedback}
        except TeehoError as error:
            if error.code == "inspiration_rejected":
                self._clear_pending(pending["submissionId"])
            if error.code in ("request_failed", "invalid_response"):
                return {"inspirationUnknown": True, "taskId": pending["submissionId"]}
            raise
        except OSError as error:
            raise TeehoError("inspiration_local_error") from error

    def task(self, task_id: Optional[str] = None, *, wait: bool = False) -> dict:
        """查询、等待和领取原任务；已确认历史直接本地读取。"""
        self._check_owner()
        pending = self._pending() if task_id is None else None
        if not task_id and not pending:
            raise TeehoError("inspiration_no_pending")
        identifier = require_id(
            task_id or (pending or {}).get("submissionId"), "invalid_input"
        )
        local = self._record(identifier)
        if local and local.get("receiptConfirmed"):
            return self._completed(local)
        deadline = self.now() + MEDIA_WAIT_SECONDS
        while True:
            task = read_task(
                self.api.inspiration_task(identifier, expected_user_id=self.owner),
                identifier,
            )
            if (
                wait
                and task["status"] in ("queued", "processing")
                and self.now() >= deadline
            ):
                return {
                    "inspiration": True,
                    "task": task,
                    "saved": False,
                    "waitExpired": True,
                }
            if task["status"] not in ("queued", "processing") or not wait:
                return self._finish(task)
            self.sleep(POLL_SECONDS)

    def _finish(self, task: dict) -> dict:
        if task["status"] in ("queued", "processing"):
            return {"inspiration": True, "task": task, "saved": False}
        # 本服务账号内串行领取；不持有身份锁，也不覆盖等待轮询。
        with lock_directory(self.root / "receipt.lock"):
            self._check_owner()
            record = self._record(task["id"])
            if record and record["receiptConfirmed"]:
                return self._completed(record)
            if task["status"] in ("failed", "expired"):
                return self._terminal(task, record)
            return self._receive(task, record)

    def _download(self, task: dict) -> dict:
        delivery = self.api.inspiration_result(task["id"], expected_user_id=self.owner)
        received = read_task(delivery, task["id"])
        if received["resultHash"] != task["resultHash"]:
            raise TeehoError("invalid_response")
        return {
            "schemaVersion": "inspiration-local.v1",
            "userId": self.owner,
            "task": task,
            "result": read_result(delivery.get("result"), received),
            "receiptConfirmed": False,
        }

    def _terminal(self, task: dict, record: Optional[dict]) -> dict:
        if record:
            write_json(
                self._record_path(task["id"]),
                {
                    **record,
                    "task": {**task, "input": record["task"].get("input")},
                    "receiptConfirmed": False,
                },
            )
        self._clear_pending(task["id"])
        return {"inspiration": True, "task": task, "saved": False}

    def _receive(self, task: dict, record: Optional[dict]) -> dict:
        if record is None:
            record = self._download(task)
            write_json(self._record_path(task["id"]), record)
        self._check_owner()
        try:
            confirmed = read_task(
                self.api.inspiration_receipt(
                    record["task"], expected_user_id=self.owner
                ),
                task["id"],
            )
        except TeehoError as error:
            if error.code != "inspiration_expired":
                raise
            expired = read_task(
                self.api.inspiration_task(task["id"], expected_user_id=self.owner),
                task["id"],
            )
            if expired["status"] != "expired":
                raise TeehoError("invalid_response") from error
            return self._terminal(expired, record)
        record = {
            **record,
            "task": {**confirmed, "input": record["task"].get("input")},
            "receiptConfirmed": True,
        }
        write_json(self._record_path(task["id"]), record)
        return self._completed(record)

    def _completed(self, record: dict) -> dict:
        self._clear_pending(record["task"]["id"])
        return {
            "inspiration": True,
            "task": record["task"],
            "result": record["result"],
            "saved": True,
        }

    def history(self, task_id: Optional[str] = None) -> dict:
        """只读取当前服务和账号的私有索引历史，不发布匿名公共副本。"""
        self._check_owner()
        if task_id:
            record = self._record(task_id)
            if not record:
                raise TeehoError("not_found")
            return {
                "inspiration": True,
                "task": record["task"],
                "result": record["result"],
                "saved": True,
            }
        folder = self.root / "history"
        paths = (
            sorted(
                folder.glob("*.json"),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            if folder.exists()
            else []
        )
        records = [self._record(path.stem) for path in paths if not is_link(path)]
        return {
            "history": [
                {
                    "id": item["task"]["id"],
                    "savedAt": item["task"]["createdAt"],
                    "summary": (item["task"].get("input") or {}).get(
                        "topic", "Inspiration"
                    ),
                }
                for item in records
                if item
            ]
        }

    def clear(self, confirmed: object, task_id: Optional[str] = None) -> dict:
        """显式确认后只清当前账号索引历史，保留活动恢复意图。"""
        self._check_owner()
        if confirmed is not True:
            raise TeehoError("confirmation_required")
        if self._pending():
            raise TeehoError("identity_busy")
        folder = self.root / "history"
        paths = [self._record_path(task_id)] if task_id else list(folder.glob("*.json"))
        for path in paths:
            if is_link(path):
                raise TeehoError("invalid_local_data")
            path.unlink(missing_ok=True)
        return {"cleared": True}
