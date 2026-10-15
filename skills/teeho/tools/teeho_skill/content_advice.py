"""优化建议的独立边界与公开文本展示。"""

import re
from collections.abc import Callable
from typing import Any, Optional

from .messages import safe_text

MAX_ITEMS = 5
MAX_SOURCE_LENGTH = 80
MAX_EVIDENCE_LENGTH = 500
MAX_PROSE_LENGTH = 800
UTF16_CODE_UNIT_BYTES = 2
MAX_SAFE_SOURCE_INDEX = 9_007_199_254_740_991
# 与服务端 String.trim 的空白集合保持一致，包括 BOM。
JS_TRIM_CHARACTERS = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007"
    "\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
PRIORITIES = ("high", "medium", "low")
ITEM_FIELDS = frozenset(
    (
        "priority",
        "location",
        "sourceId",
        "evidence",
        "problem",
        "suggestion",
    )
)
SOURCE_PATTERNS = (
    ("title", re.compile(r"title")),
    ("body", re.compile(r"body:p[1-9][0-9]*")),
    ("topics", re.compile(r"topic:[1-9][0-9]*")),
    ("cover", re.compile(r"material:cover")),
    ("content", re.compile(r"material:content")),
)


def _text(value: object, maximum: int) -> str:
    if not isinstance(value, str):
        raise ValueError("invalid_content_advice")
    trimmed = value.strip(JS_TRIM_CHARACTERS)
    if (
        not trimmed
        or len(trimmed.encode("utf-16-le")) // UTF16_CODE_UNIT_BYTES > maximum
    ):
        raise ValueError("invalid_content_advice")
    cleaned = safe_text(trimmed)
    if not cleaned:
        raise ValueError("invalid_content_advice")
    return cleaned


def _source(value: object, location: object) -> str:
    if not isinstance(value, str) or len(value) > MAX_SOURCE_LENGTH:
        raise ValueError("invalid_content_advice")
    if not any(
        location == expected and pattern.fullmatch(value)
        for expected, pattern in SOURCE_PATTERNS
    ):
        raise ValueError("invalid_content_advice")
    if location in ("body", "topics"):
        number = value.partition(":p" if location == "body" else ":")[2]
        if int(number) > MAX_SAFE_SOURCE_INDEX:
            raise ValueError("invalid_content_advice")
    return value


def _item(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != ITEM_FIELDS:
        raise ValueError("invalid_content_advice")
    if value["priority"] not in PRIORITIES:
        raise ValueError("invalid_content_advice")
    return {
        "priority": value["priority"],
        "location": value["location"],
        "sourceId": _source(value["sourceId"], value["location"]),
        "evidence": _text(value["evidence"], MAX_EVIDENCE_LENGTH),
        "problem": _text(value["problem"], MAX_PROSE_LENGTH),
        "suggestion": _text(value["suggestion"], MAX_PROSE_LENGTH),
    }


def read_content_advice(value: object) -> dict[str, Any]:
    """仅接受声明完整的建议状态，损坏状态交给调用方局部降级。"""
    if not isinstance(value, dict):
        raise ValueError("invalid_content_advice")
    items = value.get("items")
    if not isinstance(items, list) or len(items) > MAX_ITEMS:
        raise ValueError("invalid_content_advice")
    if (
        value.get("status") == "unavailable"
        and set(value) == {"status", "items"}
        and not items
    ):
        return {"status": "unavailable", "items": []}
    if (
        set(value) != {"status", "evidenceAvailability", "items"}
        or value.get("status") != "completed"
        or value.get("evidenceAvailability") not in ("sufficient", "limited")
    ):
        raise ValueError("invalid_content_advice")
    return {
        "status": "completed",
        "evidenceAvailability": value["evidenceAvailability"],
        "items": sorted(
            [_item(item) for item in items],
            key=lambda item: PRIORITIES.index(item["priority"]),
        ),
    }


def project_content_advice(
    value: object, prose: Callable[[object], str]
) -> dict[str, Any]:
    """建议解释参与翻译，原文依据与受控位置保持原样。"""
    advice = read_content_advice(value)
    return {
        **advice,
        "items": [
            {
                **item,
                "problem": prose(item["problem"]),
                "suggestion": prose(item["suggestion"]),
            }
            for item in advice["items"]
        ],
    }


def _location(item: dict[str, Any], translate: Callable[[str], str]) -> str:
    if item["location"] == "body":
        return (
            translate("contentAdviceBodyParagraph")
            + " "
            + item["sourceId"].partition(":p")[2]
        )
    if item["location"] == "topics":
        return (
            translate("contentAdviceTopic") + " " + item["sourceId"].partition(":")[2]
        )
    return translate(
        "contentAdviceMaterials" if item["location"] == "content" else item["location"]
    )


def _item_lines(item: dict[str, Any], translate: Callable[[str], str]) -> list[str]:
    return [
        "• " + translate("contentAdvicePriority" + item["priority"].title()),
        "  " + translate("contentAdviceProblem") + ": " + translate(item["problem"]),
        "  " + translate("contentAdviceLocation") + ": " + _location(item, translate),
        "  " + translate("contentAdviceEvidence") + ': "' + item["evidence"] + '"',
        "  " + translate("contentAdviceAction") + ": " + translate(item["suggestion"]),
    ]


def content_advice_lines(
    advice: Optional[dict[str, Any]], translate: Callable[[str], str]
) -> list[str]:
    """历史缺项不补造，失败和成功空结果分别表达。"""
    if advice is None:
        return []
    heading = ["", translate("contentAdvice")]
    if advice["status"] == "unavailable":
        return [*heading, translate("contentAdviceUnavailable")]
    if not advice["items"]:
        return [*heading, translate("contentNoObviousWeaknesses")]
    return [
        *heading,
        *(line for item in advice["items"] for line in _item_lines(item, translate)),
    ]
