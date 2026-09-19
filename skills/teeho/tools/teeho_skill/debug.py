"""字段白名单调试日志；日志失败不阻止业务。"""

import hashlib
import json
import math
import os
import re
import sys
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .errors import TeehoError
from .storage import ensure_private_directory, private_permissions

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_DIRECTORY_BYTES = 50 * 1024 * 1024
RETENTION_SECONDS = 7 * 24 * 60 * 60
FILE_PATTERN = re.compile(r"^skill-\d{4}-\d{2}-\d{2}-[a-f0-9-]{36}-\d+\.jsonl$")
NUMBER_FIELDS = frozenset(
    (
        "durationMs httpStatus bodyBytes responseBytes characters lines imageCount "
        "videoCount titleCharacters bodyCharacters topicCount translatedFields "
        "fallbackFields exitCode pollAfterMs"
    ).split()
)
BOOLEAN_FIELDS = frozenset(
    "anonymous saved hasRadar translationAvailable hasTask submitting".split()
)
STRING_FIELDS = frozenset("command method route state nextAction template errorCode stage".split())


def command_log_level(state: str) -> str:
    if state in {"failed", "invalid_response", "unavailable", "service_unavailable", "local_error"}:
        return "error"
    if state in {
        "anonymous_limit",
        "invalid_input",
        "invalid_request",
        "permission_required",
        "rate_limited",
        "conflict",
        "access_denied",
        "account_changed",
        "invalid_configuration",
    }:
        return "warn"
    return "info"


def _safe_value(key: str, value: object) -> bool:
    if key in NUMBER_FIELDS:
        return type(value) in (int, float) and math.isfinite(value)
    if key in BOOLEAN_FIELDS:
        return type(value) is bool
    if key in STRING_FIELDS:
        return isinstance(value, str) and bool(re.fullmatch(r"[a-zA-Z0-9_:/.-]{1,100}", value))
    if key in {"taskId", "presentationId", "requestId"}:
        return isinstance(value, str) and bool(re.fullmatch(r"[a-fA-F0-9-]{36}", value))
    if key in {"displayHash", "scriptHash"}:
        return isinstance(value, str) and bool(re.fullmatch(r"[a-f0-9]{64}", value))
    return False


class DebugLogger:
    """按服务保存 JSONL，同时写 stderr，保留请求关联与安全耗时。"""

    def __init__(
        self,
        root: Optional[Path],
        enabled: bool = False,
        *,
        stderr: Optional[Callable[[str], object]] = None,
        max_file_bytes: int = MAX_FILE_BYTES,
        max_directory_bytes: int = MAX_DIRECTORY_BYTES,
        retention_seconds: float = RETENTION_SECONDS,
    ) -> None:
        self.enabled = enabled
        self.run_id = str(uuid.uuid4())
        self.started = time.time()
        self.directory = Path(root) / "logs" if root else None
        self.stderr = stderr or sys.stderr.write
        self.max_file_bytes = max_file_bytes
        self.max_directory_bytes = max_directory_bytes
        self.retention_seconds = retention_seconds
        self.part = self.bytes = 0
        self.warned = self.file_unavailable = False
        if enabled and self.directory:
            try:
                self._prepare()
            except (OSError, ValueError, TeehoError):
                self.file_unavailable = True
                self._warn()

    def _warn(self) -> None:
        if self.warned:
            return
        self.warned = True
        try:
            self.stderr(
                json.dumps(
                    {
                        "time": datetime.now(timezone.utc).isoformat(),
                        "level": "warn",
                        "event": "debug_log_write_failed",
                        "runId": self.run_id,
                        "pid": os.getpid(),
                    }
                )
                + "\n"
            )
        except (OSError, ValueError):
            pass  # stderr 已关闭时仍保留业务返回。

    def _prepare(self) -> None:
        if self.directory is None:
            return
        ensure_private_directory(self.directory)
        files = []
        for path in self.directory.iterdir():
            if not FILE_PATTERN.fullmatch(path.name) or path.is_symlink() or not path.is_file():
                continue
            try:
                files = [*files, (path, path.stat())]
            except FileNotFoundError:
                continue
        total = sum(info.st_size for _, info in files)
        for path, info in sorted(files, key=lambda item: item[1].st_mtime):
            if (
                time.time() - info.st_mtime > self.retention_seconds
                or total > self.max_directory_bytes - self.max_file_bytes
            ):
                path.unlink(missing_ok=True)
                total -= info.st_size

    def _append(self, line: str) -> None:
        if self.directory is None or self.file_unavailable:
            return
        size = len(line.encode("utf-8"))
        if self.bytes and self.bytes + size > self.max_file_bytes:
            self.part += 1
            self.bytes = 0
            self._prepare()
        date = datetime.fromtimestamp(self.started, timezone.utc).date().isoformat()
        path = self.directory / f"skill-{date}-{self.run_id}-{self.part}.jsonl"
        with path.open("a", encoding="utf-8", newline="\n") as stream:
            private_permissions(path)
            stream.write(line)
        self.bytes += size

    def log(self, event: str, fields: Optional[dict] = None, level: str = "debug") -> None:
        if not self.enabled:
            return
        if not re.fullmatch(r"[a-z0-9_]{1,80}", event) or level not in {
            "debug",
            "info",
            "warn",
            "error",
        }:
            return
        line = (
            json.dumps(
                {
                    "time": datetime.now(timezone.utc).isoformat(),
                    "level": level,
                    "event": event,
                    "runId": self.run_id,
                    "pid": os.getpid(),
                    "runtime": "python",
                    "runtimeVersion": sys.version.split()[0],
                    "platform": sys.platform,
                    "elapsedMs": round((time.time() - self.started) * 1000),
                    **{
                        key: value
                        for key, value in (fields or {}).items()
                        if _safe_value(key, value)
                    },
                },
                ensure_ascii=False,
            )
            + "\n"
        )
        try:
            self.stderr(line)
        except (OSError, ValueError):
            self._warn()
        try:
            self._append(line)
        except (OSError, ValueError, TeehoError):
            self.file_unavailable = True
            self._warn()

    def output(self, envelope: dict, kind: str) -> None:
        text = envelope.get("displayText") or ""
        sensitive = envelope.get("state") in {"authorization_pending", "authenticated"}
        self.log(
            "output_rendered",
            {
                "state": envelope.get("state"),
                "nextAction": envelope.get("nextAction"),
                "template": kind,
                "taskId": envelope.get("taskId"),
                "presentationId": envelope.get("presentationId"),
                "characters": len(text),
                "lines": len(text.split("\n")),
                "hasRadar": "╱" in text and "🎯" in text,
                "translationAvailable": bool(envelope.get("presentationId")),
                **(
                    {}
                    if sensitive
                    else {"displayHash": hashlib.sha256(text.encode("utf-8")).hexdigest()}
                ),
            },
            "info" if envelope.get("state") == "completed" else "debug",
        )

    def close(self) -> None:
        """同步写入，无待完成后台任务。"""
