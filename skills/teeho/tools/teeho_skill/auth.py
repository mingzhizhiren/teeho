"""本机身份编排；凭据始终留在工具内部。"""

import secrets
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from .device import machine_identifier as detect_machine
from .errors import TeehoError
from .locking import lock_debug_fields, lock_directory, log_lock_event
from .storage import read_json, write_json
from .public_history import publish_anonymous_history

TOKEN_MARGIN_SECONDS = 30
LOCK_ATTEMPTS = 100
LOCK_DELAY_SECONDS = 0.1


def _expiration(value: object) -> float:
    if not isinstance(value, str):
        return 0
    try:
        instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return instant.timestamp() if instant.tzinfo else 0
    except (ValueError, OverflowError):
        return 0


class AuthSession:
    """持锁刷新凭据并绑定原账号。"""

    def __init__(
        self,
        root: Path,
        public_api: object,
        base_url: str,
        log: object = None,
        machine_identifier: Optional[Callable[[], Optional[str]]] = None,
        now: Optional[Callable[[], float]] = None,
    ) -> None:
        self.root = Path(root)
        self.public_api = public_api
        self.base_url = base_url
        self.log = (
            log.log if hasattr(log, "log") else (log or (lambda *args, **kwargs: None))
        )
        self.machine_identifier = machine_identifier or detect_machine
        self.now = now or time.time

    @contextmanager
    def _locked(self) -> Iterator[None]:
        path = self.root / "identity.lock"
        started = time.monotonic()
        for attempt in range(LOCK_ATTEMPTS):
            manager = lock_directory(path)
            try:
                manager.__enter__()
                break
            except TeehoError as error:
                if error.code == "identity_busy" and attempt in (0, LOCK_ATTEMPTS - 1):
                    log_lock_event(
                        self.log,
                        "lock_wait_started" if attempt == 0 else "lock_wait_timeout",
                        {
                            **lock_debug_fields(path),
                            "attempt": attempt + 1,
                            "waitMs": round((time.monotonic() - started) * 1000),
                        },
                    )
                if error.code != "identity_busy" or attempt == LOCK_ATTEMPTS - 1:
                    raise
                time.sleep(LOCK_DELAY_SECONDS)
        acquired = time.monotonic()
        context = lock_debug_fields(path)
        log_lock_event(
            self.log,
            "lock_acquired",
            {
                **context,
                "waitMs": round((acquired - started) * 1000),
                "attempt": attempt + 1,
            },
        )
        try:
            yield
        finally:
            manager.__exit__(None, None, None)
            log_lock_event(
                self.log,
                "lock_released",
                {**context, "holdMs": round((time.monotonic() - acquired) * 1000)},
            )

    def read_identity(self) -> Optional[dict]:
        identity = read_json(self.root / "identity.json")
        if identity is None:
            return None
        if not isinstance(identity, dict):
            raise TeehoError("invalid_local_data")
        if identity.get("baseUrl") != self.base_url:
            raise TeehoError("identity_server_mismatch")
        user = identity.get("user")
        if user is not None and (
            not isinstance(user, dict) or not isinstance(user.get("id"), str)
        ):
            raise TeehoError("invalid_local_data")
        if user is not None:
            try:
                if str(uuid.UUID(user["id"])) != user["id"].lower():
                    raise ValueError("invalid_uuid")
            except ValueError as error:
                raise TeehoError("invalid_local_data") from error
        return identity

    def _save(self, identity: dict) -> None:
        write_json(self.root / "identity.json", {**identity, "baseUrl": self.base_url})

    def cached_access_token(self, expected_user_id: str) -> Optional[str]:
        """可选请求只读取仍有效的缓存凭据，不创建或刷新身份。"""
        identity = self.read_identity() or {}
        if identity.get("user", {}).get("id") != expected_user_id:
            return None
        if _expiration(identity.get("accessExpiresAt")) <= self.now() + TOKEN_MARGIN_SECONDS:
            return None
        token = identity.get("accessToken")
        return token if isinstance(token, str) and token and not any(ord(char) < 32 for char in token) else None

    def login(self, device_name: str = "Teeho Skill") -> dict:
        with self._locked():
            publish_anonymous_history(self.root, self.read_identity())
            device_token = secrets.token_hex(32)
            challenge = self.public_api.start_login(device_token, device_name)
            self._save({"deviceToken": device_token, "challenge": challenge})
            return challenge

    def anonymous(self) -> dict:
        machine_id = self.machine_identifier()
        if not machine_id:
            raise TeehoError("无法登录匿名用户，请注册新用户或者登录你的用户")
        with self._locked():
            current = self.read_identity()
            if current and current.get("user"):
                raise TeehoError("identity_already_present")
            identity = (
                current
                if current and current.get("anonymousPending")
                else {
                    "deviceToken": secrets.token_hex(32),
                    "anonymousPending": True,
                }
            )
            self._save(identity)
            self.public_api.create_anonymous_identity(
                identity["deviceToken"], machine_id, "Teeho Skill"
            )
            return self._complete_login(identity)

    def _complete_login(self, identity: dict) -> dict:
        if not isinstance(identity.get("deviceToken"), str) or not identity["deviceToken"]:
            raise TeehoError("login_required")
        issued = self.public_api.exchange_token(identity["deviceToken"])
        updated = {key: value for key, value in identity.items() if key != "challenge"}
        self._save({**updated, **issued})
        return {"user": issued["user"], "expiresAt": issued["expiresAt"]}

    def complete_login(self) -> dict:
        with self._locked():
            return self._complete_login(self.read_identity() or {})

    def _refresh(self, identity: dict, stage: str, expected_user_id: str) -> dict:
        token = identity.get("deviceToken")
        if not isinstance(token, str) or not token:
            raise TeehoError("login_required")
        self.log("credential_refresh_started", {"stage": stage})
        issued = self.public_api.exchange_token(token)
        if issued.get("user", {}).get("id") != expected_user_id:
            raise TeehoError("账号已切换，请使用原账号查询任务")
        updated = {**identity, **issued}
        self._save(updated)
        self.log("credential_refresh_completed", {"stage": stage})
        return updated

    def _credential_snapshot(
        self, expected_user_id: Optional[str], rejected: Optional[dict] = None
    ) -> dict:
        """持锁取得凭据快照；401 后只续接原账号、原设备授权。"""
        with self._locked():
            identity = self.read_identity()
            if not identity or not identity.get("user"):
                raise TeehoError("login_required")
            user_id = identity["user"]["id"]
            if expected_user_id and user_id != expected_user_id:
                raise TeehoError("账号已切换，请使用原账号查询任务")
            if rejected is not None and identity.get("deviceToken") != rejected.get(
                "deviceToken"
            ):
                raise TeehoError("账号已切换，请使用原账号查询任务")
            expired = (
                _expiration(identity.get("accessExpiresAt"))
                <= self.now() + TOKEN_MARGIN_SECONDS
            )
            rejected_current = rejected is not None and identity.get(
                "accessToken"
            ) == rejected.get("accessToken")
            if expired or rejected_current:
                identity = self._refresh(
                    identity,
                    "unauthorized" if rejected is not None else "expiry",
                    user_id,
                )
            token = identity.get("accessToken")
            if not isinstance(token, str) or not token:
                raise TeehoError("login_required")
            return identity

    def authorized(
        self, operation: Callable[[str], dict], expected_user_id: Optional[str] = None
    ) -> dict:
        """业务请求使用原身份快照并在锁外执行；仅明确 401 可重试一次。"""
        identity = self._credential_snapshot(expected_user_id)
        try:
            return operation(identity["accessToken"])
        except TeehoError as error:
            if error.code == "skill_upgrade_required" or error.status != 401:
                raise
            # 其他进程已续期就复用；退出、换号或重新登录后不恢复旧授权。
            refreshed = self._credential_snapshot(
                identity["user"]["id"], rejected=identity
            )
            return operation(refreshed["accessToken"])

    def _sign_out(self, identity: Optional[dict]) -> dict:
        if not identity or not identity.get("user"):
            return {"signedOut": True}
        if identity["user"].get("isAnonymous"):
            raise TeehoError("anonymous_no_logout")
        try:
            # 注销端点可使用现有凭据撤销授权，无需经过可能被版本门槛拦截的续期。
            self.public_api.logout(identity.get("accessToken"))
        except TeehoError as error:
            if error.code == "skill_upgrade_required" or error.status != 401:
                raise
        (self.root / "identity.json").unlink(missing_ok=True)
        return {"signedOut": True}

    def logout(self) -> dict:
        with self._locked():
            return self._sign_out(self.read_identity())

    def clear_identity(self, confirmed: bool) -> dict:
        if confirmed is not True:
            raise TeehoError("需要确认清除本机身份")
        with self._locked():
            identity = self.read_identity()
            if identity and identity.get("user") and not identity["user"].get("isAnonymous"):
                return self._sign_out(identity)
            (self.root / "identity.json").unlink(missing_ok=True)
            return {"cleared": True}
