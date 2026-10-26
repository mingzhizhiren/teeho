"""索引输入、服务结果及本机记录的边界校验。"""

import math
import re
from datetime import datetime
from urllib.parse import urlsplit

from .errors import TeehoError
from .note import require_id, require_text

TOPIC_LIMIT = 256
TRACK_MAX = 30
MAX_NOTES = 10
MAX_ITEMS = 3
MAX_TEXT = 600
MAX_EXCERPT = 1000
MAX_SCORE = 10
STATUSES = frozenset(
    {"queued", "processing", "ready", "received", "insufficient", "failed", "expired"}
)


def input_fields(value: object) -> dict:
    """输入主题不继承诊断标题和素材的必需条件。"""
    if not isinstance(value, dict) or set(value) - {
        "topic",
        "mainTrack",
        "secondaryTrack",
        "noteType",
    }:
        raise TeehoError("invalid_input")
    topic, primary, secondary = (
        value.get("topic"),
        value.get("mainTrack"),
        value.get("secondaryTrack"),
    )
    try:
        topic = require_text(
            topic.strip() if isinstance(topic, str) else topic, TOPIC_LIMIT, "主题"
        )
    except TeehoError as error:
        raise TeehoError("invalid_input") from error
    if not isinstance(topic, str) or not 1 <= len(topic.strip()) <= TOPIC_LIMIT:
        raise TeehoError("invalid_input")
    for track in [primary, *([secondary] if secondary is not None else [])]:
        if type(track) is not int or not 1 <= track <= TRACK_MAX:
            raise TeehoError("invalid_input")
    kind = value.get("noteType", "normal")
    if primary == secondary or kind not in ("normal", "video"):
        raise TeehoError("invalid_input")
    return {
        "topic": topic.strip(),
        "mainTrack": primary,
        "noteType": kind,
        **({"secondaryTrack": secondary} if secondary is not None else {}),
    }


def read_task(value: object, task_id: str) -> dict:
    """校验服务端任务身份和计费状态，未知状态不猜测成功。"""
    if not isinstance(value, dict) or value.get("id") != require_id(
        task_id, "invalid_response"
    ):
        raise TeehoError("invalid_response")
    if value.get("status") not in STATUSES or value.get("targetCount") not in (
        4,
        8,
        10,
    ):
        raise TeehoError("invalid_response")
    if type(value.get("pointCost")) is not int or value["pointCost"] not in (0, 20, 50):
        raise TeehoError("invalid_response")
    if (
        type(value.get("resultVersion")) is not int
        or value["resultVersion"] != 1
        or value.get("reservationStatus")
        not in (None, "reserved", "settled", "released")
    ):
        raise TeehoError("invalid_response")
    if value.get("input") is not None:
        try:
            input_fields(value["input"])
        except TeehoError as error:
            raise TeehoError("invalid_response") from error
    for field in ("createdAt", "expiresAt"):
        if field == "expiresAt" and value.get(field) is None:
            continue
        _validate_timestamp(value.get(field))
    if value.get("resultHash") is not None and not re.fullmatch(
        r"[a-f0-9]{64}", str(value["resultHash"])
    ):
        raise TeehoError("invalid_response")
    return {
        key: value.get(key)
        for key in (
            "id",
            "status",
            "input",
            "targetCount",
            "pointCost",
            "reservationStatus",
            "resultVersion",
            "resultHash",
            "expiresAt",
            "createdAt",
            "failureCode",
        )
    }


def read_result(value: object, task: dict) -> dict:
    """只保存可核验的本次参考与两层输出，不接受缺引用的收费结果。"""
    if (
        not isinstance(value, dict)
        or value.get("schemaVersion") != "inspiration-result.v1"
    ):
        raise TeehoError("invalid_response")
    notes = value.get("notes")
    if (
        not isinstance(notes, list)
        or len(notes) > MAX_NOTES
        or not isinstance(value.get("policyVersion"), str)
    ):
        raise TeehoError("invalid_response")
    for note in notes:
        _validate_note(note)
    ids = {note["noteId"] for note in notes}
    if len(ids) != len(notes):
        raise TeehoError("invalid_response")
    complete = len(notes) == task["targetCount"]
    if task["status"] in ("ready", "received") and not complete:
        raise TeehoError("invalid_response")
    if task["status"] == "insufficient" and complete:
        raise TeehoError("invalid_response")
    for layer in ("themes", "angles"):
        entries = value.get(layer)
        if (
            not isinstance(entries, list)
            or len(entries) > MAX_ITEMS
            or (complete and not entries)
            or (not complete and entries)
        ):
            raise TeehoError("invalid_response")
        for item in entries:
            if (
                not isinstance(item, dict)
                or not isinstance(item.get("text"), str)
                or not 1 <= len(item["text"].strip()) <= MAX_TEXT
            ):
                raise TeehoError("invalid_response")
            refs = item.get("references")
            if (
                not isinstance(refs, list)
                or not refs
                or any(not isinstance(ref, str) or ref not in ids for ref in refs)
            ):
                raise TeehoError("invalid_response")
    return {
        key: value[key]
        for key in ("schemaVersion", "policyVersion", "notes", "themes", "angles")
    }


def _validate_note(note: object) -> None:
    if (
        not isinstance(note, dict)
        or not isinstance(note.get("noteId"), str)
        or not note["noteId"]
    ):
        raise TeehoError("invalid_response")
    if (
        not isinstance(note.get("title"), str)
        or not note["title"]
        or not isinstance(note.get("bodyExcerpt"), str)
        or len(note["bodyExcerpt"]) > MAX_EXCERPT
    ):
        raise TeehoError("invalid_response")
    score = note.get("modelScore")
    if (
        type(score) not in (int, float)
        or not math.isfinite(score)
        or not 0 <= score <= MAX_SCORE
    ):
        raise TeehoError("invalid_response")
    if note.get("noteType") not in ("normal", "video"):
        raise TeehoError("invalid_response")
    for key in ("likes", "collects", "comments"):
        number = note.get(key)
        if number is not None and (type(number) is not int or number < 0):
            raise TeehoError("invalid_response")
    url = note.get("url")
    if url is not None and (
        not isinstance(url, str)
        or urlsplit(url).scheme not in ("http", "https")
        or not urlsplit(url).netloc
    ):
        raise TeehoError("invalid_response")
    _validate_timestamp(note.get("observedAt"))


def _validate_timestamp(value: object) -> None:
    try:
        if (
            not isinstance(value, str)
            or datetime.fromisoformat(value.replace("Z", "+00:00")).tzinfo is None
        ):
            raise ValueError("missing timezone")
    except (KeyError, AttributeError, TypeError, ValueError) as error:
        raise TeehoError("invalid_response") from error
