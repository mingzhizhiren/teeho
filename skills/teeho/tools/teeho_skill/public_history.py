"""仅匿名报告使用的本机公共存储；身份与凭据仍在私有目录。"""

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Optional

from .errors import TeehoError
from .history import HistoryTools, REPORT_FILE, _identifier, _report
from .storage import MAX_JSON_BYTES, _windows_dacl, _windows_user_sid, is_link, read_json


def public_history_directory() -> Path:
    """默认选择系统用户共享目录，允许显式配置共享卷。"""
    configured = os.environ.get("TEEHO_PUBLIC_HISTORY_DIR", "").strip()
    if configured:
        return Path(configured).absolute()
    if os.name == "nt":
        return Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "teeho-public-history"
    return Path("/Users/Shared" if sys.platform == "darwin" else "/var/tmp") / "teeho-public-history"


def _checked_directory() -> Path:
    directory = public_history_directory()
    if any(is_link(path) for path in (directory, *directory.parents)):
        raise TeehoError("invalid_local_data")
    return directory


def _prepare_directory(directory: Path) -> None:
    try:
        directory.mkdir(mode=0o1777)
    except FileExistsError:
        if not directory.is_dir():
            raise TeehoError("invalid_local_data")
        return
    if os.name == "nt":
        _windows_dacl(directory, (
            f"D:P(A;;FA;;;{_windows_user_sid()})"
            "(A;OICIIO;FA;;;CO)(A;OICI;GRGX;;;WD)(A;;0x00000006;;;AU)"
        ))
    else:
        directory.chmod(0o1777)


def publish_report(report: dict[str, Any], owner: str) -> None:
    """原子发布明文匿名报告；其他用户可读，不能覆写已有报告。"""
    task_id = _identifier(report.get("task", {}).get("id"))
    validated = _report(report, task_id)
    value = {**validated, "anonymousOwner": _identifier(owner)}
    data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if len(data) > MAX_JSON_BYTES:
        raise TeehoError("invalid_local_data")
    directory = _checked_directory()
    _prepare_directory(directory)
    target = directory / (task_id + ".json")
    if target.exists() or is_link(target):
        read_public_report(task_id)
        return
    descriptor, temporary = tempfile.mkstemp(dir=directory, suffix=".tmp")
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        if os.name == "nt":
            _windows_dacl(temporary_path, f"D:P(A;;FA;;;{_windows_user_sid()})(A;;GR;;;WD)")
        else:
            temporary_path.chmod(0o644)
        try:
            os.link(temporary_path, target)
        except FileExistsError:
            read_public_report(task_id)
    finally:
        temporary_path.unlink(missing_ok=True)


def read_public_report(task_id: str) -> dict[str, Any]:
    path = _checked_directory() / (_identifier(task_id) + ".json")
    if is_link(path):
        raise TeehoError("invalid_local_data")
    return _report(read_json(path), task_id)


def public_reports() -> list[dict[str, Any]]:
    directory = _checked_directory()
    if not directory.exists():
        return []
    return [read_public_report(path.stem) for path in directory.iterdir()
            if REPORT_FILE.fullmatch(path.name) and path.is_file() and not is_link(path)]


def publish_anonymous_history(root: Path, identity: Optional[dict]) -> None:
    """只迁移当前身份明确证明属于匿名账号的旧报告。"""
    user = (identity or {}).get("user", {})
    if user.get("isAnonymous") is not True:
        return
    history = HistoryTools(root, user["id"])
    for record in history.list():
        publish_report(history.read(record["id"]), user["id"])


def visible_history(root: Path, owner: Optional[str]) -> list[dict[str, Any]]:
    """当前账号私有历史与本机公共匿名历史合并，完全离线。"""
    public = [HistoryTools._summary(report) for report in public_reports()]
    private = HistoryTools(root, owner).list() if owner else []
    merged = {record["id"]: record for record in [*public, *private]}
    return sorted(merged.values(), key=lambda record: record["savedAt"], reverse=True)


def visible_report(root: Path, owner: Optional[str], task_id: str) -> dict[str, Any]:
    if owner:
        private = HistoryTools(root, owner)
        if (private.root / (_identifier(task_id) + ".json")).exists():
            return private.read(task_id)
    return read_public_report(task_id)


def clear_public_owner(owner: str) -> None:
    """匿名用户清理自己的报告，不删除其他匿名用户的公共报告。"""
    valid_owner = _identifier(owner)
    for report in public_reports():
        if report.get("anonymousOwner") == valid_owner:
            path = _checked_directory() / (_identifier(report["task"]["id"]) + ".json")
            if is_link(path):
                raise TeehoError("invalid_local_data")
            path.unlink()
