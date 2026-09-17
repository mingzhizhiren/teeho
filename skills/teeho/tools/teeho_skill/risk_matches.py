"""独立词库命中展示；旧报告仅使用保存的文字，不读取媒体文件。"""

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any, Optional

from .content_analysis import _findings

CONTEXT_LENGTH = 80
MAX_TRACKS = 4
MAX_TRACK_CODE = 30


def _track_codes(result: dict[str, Any]) -> frozenset[int]:
    secondary = result.get("secondaryTracks")
    candidates = [
        result.get("primaryTrack"),
        *(secondary if isinstance(secondary, list) else []),
    ]
    valid = tuple(
        dict.fromkeys(
            code
            for code in candidates
            if type(code) is int and 1 <= code <= MAX_TRACK_CODE
        )
    )
    if not valid:
        insight = result.get("insight")
        tracks = insight.get("tracks") if isinstance(insight, dict) else None
        valid = tuple(
            dict.fromkeys(
                item["trackCode"]
                for item in (tracks if isinstance(tracks, list) else [])
                if isinstance(item, dict)
                and type(item.get("trackCode")) is int
                and 1 <= item["trackCode"] <= MAX_TRACK_CODE
            )
        )
    return frozenset(valid[:MAX_TRACKS])


def _in_scope(row: dict[str, Any], tracks: frozenset[int]) -> bool:
    codes = row.get("trackCodes")
    return codes is None or (
        isinstance(codes, list)
        and any(type(code) is int and code in tracks for code in codes)
    )


def _database() -> dict[str, Any]:
    root = Path(__file__).resolve().parents[2]
    source = root / "resources" / "risk-database.json"
    value = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("invalid_risk_database")
    return value


def _saved_texts(task: dict[str, Any]) -> Optional[dict[str, str]]:
    standard = task.get("standardTask")
    fields = standard.get("fields") if isinstance(standard, dict) else None
    if not isinstance(fields, dict):
        return None
    texts = {}
    for location in ("title", "body", "topics"):
        field = fields.get(location)
        value = field.get("value") if isinstance(field, dict) else None
        if (
            location == "topics"
            and isinstance(value, list)
            and all(isinstance(item, str) for item in value)
        ):
            value = "\n".join(value)
        if not isinstance(value, str):
            return None
        texts[location] = value
    return texts


def _saved_matches(task: dict[str, Any]) -> Optional[list[dict[str, Any]]]:
    texts = _saved_texts(task)
    if texts is None:
        return None
    try:
        database = _database()
        tracks = _track_codes(task.get("result") or {})
        patterns = [
            (row["name"], row["context"], re.compile(re.escape(word), re.IGNORECASE))
            for row in database["categories"]
            if _in_scope(row, tracks)
            for word in row["words"]
            if word
        ] + [
            (
                row["name"],
                row["context"],
                re.compile(row["pattern"].replace("\\\\", "\\"), re.IGNORECASE),
            )
            for row in database["patterns"]
            if _in_scope(row, tracks)
        ]
    except (OSError, ValueError, KeyError, TypeError, re.error):
        return None
    matches = {}
    for location, text in texts.items():
        for category, context, pattern in patterns:
            for match in pattern.finditer(text):
                if not match.group():
                    continue
                key = (location, match.group().lower(), category)
                if key in matches:
                    continue
                matches[key] = {
                    "term": match.group(),
                    "category": category,
                    "location": location,
                    "evidence": text[
                        max(0, match.start() - CONTEXT_LENGTH) : match.end()
                        + CONTEXT_LENGTH
                    ],
                    "description": context,
                }
    return sorted(matches.values(), key=lambda item: -len(item["term"]))


def _scope_saved_matches(
    matches: list[dict[str, Any]], result: dict[str, Any]
) -> list[dict[str, Any]]:
    if not matches:
        return matches
    try:
        database = _database()
        rows = [*database["categories"], *database["patterns"]]
        known = {row["name"] for row in rows}
        allowed = {row["name"] for row in rows if _in_scope(row, _track_codes(result))}
    except (OSError, ValueError, KeyError, TypeError):
        return matches
    return [
        item
        for item in matches
        if item["category"] not in known or item["category"] in allowed
    ]


def project_risk_matches(
    result: dict[str, Any], task: dict[str, Any], prose: Callable[[object], str]
) -> Optional[list[dict[str, Any]]]:
    """新报告使用确定性匹配结果；旧报告重新匹配保存的原文。"""
    value = result["riskMatches"] if "riskMatches" in result else _saved_matches(task)
    if result.get("riskReviewStatus") == "unavailable":
        value = [item for item in value if isinstance(item, dict) and item.get("riskLevel") == "high"] if isinstance(value, list) else []
        if not value:
            return None
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError("invalid_risk_matches")
    return [
        {
            **item,
            "category": prose(item["category"]),
            "description": prose(item["description"]),
            "references": [],
        }
        for item in _scope_saved_matches(_findings(value, len(value), "risk"), result)
        if item["location"] in ("title", "body", "topics")
    ]


def risk_match_lines(
    data: dict[str, Any], translate: Callable[[str], str]
) -> list[str]:
    """风险词独立于 Agent 是否成功，纯文字列出全部公开命中。"""
    matches = data.get("riskMatches")
    if matches is None:
        return ["ℹ️ " + translate("contentRiskUnavailable")]
    if not matches:
        return ["ℹ️ " + translate("contentNoTermRisks")]
    return (["ℹ️ " + translate("contentRiskUnavailable")] if data.get("riskReviewStatus") == "unavailable" else []) + [
        "🔎 " + item["term"] + " - "
        + translate("materials" if item["location"] == "content" else item["location"])
        + ": " + translate(item["description"])
        for item in matches
    ]
