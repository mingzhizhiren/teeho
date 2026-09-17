"""笔记输入校验与受理载荷；保持现有 JSON 契约。"""

import math
import re
from pathlib import Path
from typing import Optional

from .constants import (
    EXCERPT_CHARACTERS,
    MAX_BODY_UNITS,
    MAX_IMAGES,
    MAX_TITLE_UNITS,
    MAX_TOPIC_UNITS,
    MAX_TOPICS,
)
from .errors import TeehoError


def require_id(value: object, code: str = "invalid_input") -> str:
    """验证用于接口及本机路径的已有 UUID 字符串。"""
    if not isinstance(value, str) or not re.fullmatch(
        r"[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}", value
    ):
        raise TeehoError(code)
    return value


def is_number(value: object) -> bool:
    """拒绝布尔值和非有限数字。"""
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def validate_note_encoding(value: dict[str, object]) -> None:
    """在匿名初始化和收费操作前拒绝明显损坏的文本。"""
    topics = value.get("topics")
    texts = [value.get("title"), value.get("body")]
    texts = texts + (topics if isinstance(topics, list) else [])
    for text in texts:
        if not isinstance(text, str):
            continue
        if (text.strip() and re.fullmatch(r"[?\s]+", text)) or "\ufffd" in text:
            raise TeehoError("input_encoding_invalid")
        try:
            text.encode("utf-8")
        except UnicodeEncodeError as error:
            raise TeehoError("input_encoding_invalid") from error


def require_text(value: object, limit: int, name: str) -> str:
    """按原 JavaScript UTF-16 长度限制校验文本。"""
    if not isinstance(value, str) or not value.strip():
        raise TeehoError("请补充或检查" + name)
    try:
        units = len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError as error:
        raise TeehoError("input_encoding_invalid") from error
    if units > limit:
        raise TeehoError("请补充或检查" + name)
    return value.strip()


def _paths(value: object, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(
        not isinstance(path, str) or not path or "\x00" in path for path in value
    ):
        raise TeehoError(label + "路径无效")
    return list(value)


def _topics(value: object) -> list[str]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_TOPICS:
        raise TeehoError("请补充或检查话题")
    topics = [
        require_text(item, MAX_TOPIC_UNITS, "话题").removeprefix("#").strip() for item in value
    ]
    if any(not topic for topic in topics):
        raise TeehoError("请补充或检查话题")
    return list(dict.fromkeys(topics))


def normalize_note(value: dict[str, object]) -> dict[str, object]:
    """校验并选取允许的素材，不读取磁盘或联网。"""
    validate_note_encoding(value)
    fields = {
        "title": require_text(value.get("title"), MAX_TITLE_UNITS, "标题"),
        "body": "" if value.get("body") is None or (
            isinstance(value.get("body"), str) and not value["body"].strip()
        ) else require_text(value.get("body"), MAX_BODY_UNITS, "正文"),
        "topics": _topics(value.get("topics")),
    }
    for key in ("track", "customTrackName"):
        if value.get(key):
            fields = {**fields, key: require_text(value[key], MAX_TITLE_UNITS, "赛道")}
    images, videos = _paths(value.get("images"), "图片"), _paths(value.get("videos"), "视频")
    video = videos[0] if videos else None
    selected = images[: 1 if video else MAX_IMAGES]
    cover = value.get("cover")
    if cover is None:
        cover = selected[0] if selected else None
    if cover is None:
        raise TeehoError('missing_cover')
    if cover is not None and (not isinstance(cover, str) or cover not in images):
        raise TeehoError("指定封面必须在本次图片中")
    if video:
        selected = [cover] if cover else []
    elif cover and cover not in selected:
        selected = selected[: MAX_IMAGES - 1] + [cover]
    return {
        "fields": fields,
        "images": selected,
        "cover": cover,
        "video": video,
        "summary": _summary(fields, selected, cover, video, images, videos),
    }


def _excerpt(value: str) -> str:
    return value[:EXCERPT_CHARACTERS] + ("..." if len(value) > EXCERPT_CHARACTERS else "")


def _summary(
    fields: dict,
    selected: list[str],
    cover: Optional[str],
    video: Optional[str],
    images: list[str],
    videos: list[str],
) -> dict:
    return {
        "title": _excerpt(fields["title"]),
        "body": _excerpt(fields["body"]),
        "topics": _excerpt(" ".join("#" + topic for topic in fields["topics"])),
        "images": len(selected),
        "video": Path(video).name if video else None,
        "cover": Path(cover).name if cover else None,
        "ignored": [Path(path).name for path in images if path not in selected]
        + [Path(path).name for path in videos[1:]],
    }


def build_task_payload(state: dict[str, object]) -> dict[str, object]:
    """生成与 Web 专家模式兼容的稳定幂等受理信息。"""
    image_ids = [] if state.get("videoId") else [asset["id"] for asset in state["assets"]]
    cover_index = state["images"].index(state["cover"]) if state.get("cover") else -1
    cover_id = state["assets"][cover_index]["id"] if cover_index >= 0 else None
    draft = {
        "inputMode": "custom",
        "rawText": "",
        "fields": state["fields"],
        "imageReferences": image_ids,
        "submissionId": state["submissionId"],
        **({"videoReference": state["videoId"]} if state.get("videoId") else {}),
        **({"coverReference": cover_id} if cover_id else {}),
    }
    return {
        **draft,
        "admission": {
            "schemaVersion": "analysis-task-admission.v1",
            "confirmationRevision": 0,
            "session": None,
            "idempotencyKey": state["submissionId"],
            "mediaBinding": {
                "contentKind": (
                    "video" if state.get("videoId") else "image" if image_ids else "text"
                ),
                "imageReferences": image_ids,
                "videoReference": state.get("videoId"),
                "coverReference": cover_id or (image_ids[0] if image_ids else None),
            },
        },
    }
