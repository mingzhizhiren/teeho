"""按账号保存本机报告及原素材位置。"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional, Union

from .errors import TeehoError
from .storage import ensure_private_directory, read_json, write_json

IDENTIFIER = re.compile(r"[a-f0-9-]{36}", re.IGNORECASE)
REPORT_FILE = re.compile(r"[a-f0-9-]{36}\.json", re.IGNORECASE)
HISTORY_FILE = re.compile(r"[a-f0-9-]{36}\.(json|png|jpe?g|webp)", re.IGNORECASE)
COVER_EXTENSIONS = frozenset((".png", ".jpg", ".jpeg", ".webp"))


def _identifier(value: object) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise TeehoError("历史标识无效")
    return value


def local_media(value: object) -> dict[str, Any]:
    """校验本机素材位置；不读取素材，不将位置写入任务载荷。"""
    if value is None:
        return {"cover": None, "images": [], "video": None}
    if not isinstance(value, dict):
        raise TeehoError("历史报告不可读取")
    images = value.get("images", [])
    cover, video = value.get("cover"), value.get("video")
    if not isinstance(images, list):
        raise TeehoError("历史报告不可读取")
    paths = images + [path for path in (cover, video) if path is not None]
    if any(not isinstance(path, str) or not path or "\x00" in path for path in paths):
        raise TeehoError("历史报告不可读取")
    return {"cover": cover, "images": list(images), "video": video}


def _report(value: object, task_id: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("task"), dict):
        raise TeehoError("历史报告不可读取")
    if value["task"].get("id") != task_id or not isinstance(value.get("savedAt"), str):
        raise TeehoError("历史报告不可读取")
    cover = value.get("cover")
    if cover is not None and (
        not isinstance(cover, str)
        or Path(cover).name != cover
        or not HISTORY_FILE.fullmatch(cover)
        or Path(cover).suffix.lower() not in COVER_EXTENSIONS
    ):
        raise TeehoError("历史报告不可读取")
    local_media(value.get("localMedia"))
    return value


class HistoryTools:
    """公共本机历史边界，明文保存，无额外加密依赖。"""

    def __init__(self, root: Union[str, Path], user_id: str) -> None:
        self.root = Path(root).resolve() / "accounts" / _identifier(user_id) / "history"

    def save(
        self,
        task: dict[str, Any],
        cover_path: Optional[Union[str, Path]] = None,
        *,
        media: Optional[dict[str, Any]] = None,
    ) -> None:
        """同一任务只保存一次，仅记录原素材位置，不复制或移动素材。"""
        if not isinstance(task, dict):
            raise TeehoError("历史报告不可读取")
        task_id = _identifier(task.get("id"))
        ensure_private_directory(self.root)
        path = self.root / (task_id + ".json")
        if path.exists():
            self.read(task_id)
            return
        locations = local_media(
            media if media is not None else {
                "cover": str(cover_path) if cover_path else None,
                "images": [str(cover_path)] if cover_path else [],
            }
        )
        saved_at = (
            datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        )
        write_json(path, {
            "task": task, "cover": None, "localMedia": locations, "savedAt": saved_at,
        })

    def read(self, task_id: str) -> dict[str, Any]:
        """校验任务标识和已保存记录，拒绝跨目录读取。"""
        valid_id = _identifier(task_id)
        path = self.root / (valid_id + ".json")
        if path.is_symlink():
            raise TeehoError("历史报告不可读取")
        return _report(read_json(path), valid_id)

    def _files(self) -> list[Path]:
        try:
            return [
                path for path in self.root.iterdir() if not path.is_symlink() and path.is_file()
            ]
        except FileNotFoundError:
            return []

    def list(self) -> list[dict[str, Any]]:
        """按保存时间倒序列出当前账号历史摘要。"""
        reports = [
            self.read(path.stem) for path in self._files() if REPORT_FILE.fullmatch(path.name)
        ]
        records = [self._summary(report) for report in reports]
        return sorted(records, key=lambda record: record["savedAt"], reverse=True)

    @staticmethod
    def _summary(report: dict[str, Any]) -> dict[str, Any]:
        result = report["task"].get("result")
        conclusion = result.get("qualitativeConclusion") if isinstance(result, dict) else None
        summary = conclusion.get("summary", "") if isinstance(conclusion, dict) else ""
        if not isinstance(summary, str):
            raise TeehoError("历史报告不可读取")
        return {
            "id": report["task"]["id"],
            "savedAt": report["savedAt"],
            "summary": summary,
            "cover": report.get("cover"),
            "localMedia": local_media(report.get("localMedia")),
        }

    def clear(self, confirmed: bool) -> dict[str, bool]:
        """经确认后删除本账号已知报告文件，不递归、不跟随链接。"""
        if confirmed is not True:
            raise TeehoError("需要确认清理当前账号历史")
        for path in self._files():
            if HISTORY_FILE.fullmatch(path.name):
                path.unlink()
        return {"cleared": True}
