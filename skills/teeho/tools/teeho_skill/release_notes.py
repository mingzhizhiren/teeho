"""可选更新公告：英文源文、公开展示字段与本机已展示版本。"""

import re
from pathlib import Path
from typing import Optional

from .errors import TeehoError
from .messages import safe_text
from .storage import is_link, read_json, write_json
from .version import safe_version

MAX_MARKDOWN_LENGTH = 16000
MAX_RELEASES = 5
MARKER_FILE = "release-notes-seen.json"


def version_parts(version: str) -> tuple[int, ...]:
    """比较三段数字版本，避免按字符串排序。"""
    return tuple(int(part) for part in version.split("."))


def latest_release(data: object) -> Optional[dict]:
    """校验公开接口，只取最新一份有界英文日志。"""
    releases = data.get("releases") if isinstance(data, dict) else None
    if not isinstance(releases, list) or len(releases) > MAX_RELEASES:
        raise TeehoError("invalid_response")
    for release in releases:
        if not isinstance(release, dict) or not safe_version(release.get("version")):
            raise TeehoError("invalid_response")
        markdown = release.get("markdown")
        if (
            not isinstance(markdown, str)
            or not markdown.strip()
            or len(markdown) > MAX_MARKDOWN_LENGTH
        ):
            raise TeehoError("invalid_response")
    return (
        max(releases, key=lambda item: version_parts(item["version"]))
        if releases
        else None
    )


def has_seen(root: Path, version: str, presentation_id: Optional[str] = None) -> bool:
    """展示目录已按服务和账号分区；损坏记录由调用方降级处理。"""
    path = root / MARKER_FILE
    if is_link(path):
        raise TeehoError("invalid_local_data")
    marker = read_json(path, {})
    if (
        presentation_id
        and isinstance(marker, dict)
        and marker.get("presentationId") == presentation_id
        and marker.get("version") == version
    ):
        return False
    previous = safe_version(marker.get("version")) if isinstance(marker, dict) else None
    return bool(previous and version_parts(previous) >= version_parts(version))


def mark_seen(root: Path, version: str, presentation_id: Optional[str] = None) -> None:
    """仅在 stdout 成功输出最终文本后持久化，不降低已展示版本。"""
    if safe_version(version) and not has_seen(root, version):
        write_json(
            root / MARKER_FILE, {"version": version, "presentationId": presentation_id}
        )


def attach_release(view: dict, release: dict) -> dict:
    """逐行生成可翻译纯文本，避免 Markdown 围栏破坏报告代码块。"""
    lines = [
        safe_text(re.sub(r"^\s*#{1,6}\s+", "", line).replace("`", "").replace("**", ""))
        for line in release["markdown"].splitlines()
        if line.strip()
    ]
    if not lines or any(len(line) > 8000 for line in lines):
        raise TeehoError("invalid_response")
    fields = {f"releaseNoteLine{index}": line for index, line in enumerate(lines)}
    return {
        **view,
        "texts": {**view["texts"], "releaseNoteHeading": "What's new", **fields},
        "data": {
            **view["data"],
            "releaseNotes": {"version": release["version"], "fields": list(fields)},
        },
    }
