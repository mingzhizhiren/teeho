"""内容分析的边界校验与公开展示投影。"""

from collections.abc import Callable
from typing import Any, Optional

from .messages import safe_text
from .report_fields import read_optional

LOCATIONS = frozenset(("title", "body", "topics", "cover", "content"))
MAX_STARS = 5
MAX_ISSUES = 5
MAX_RISKS = 20
MAX_WEAKNESSES = 5
MAX_REFERENCES = 4


def _text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("invalid_content_analysis")
    return safe_text(value)


def _finding(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("location") not in LOCATIONS:
        raise ValueError("invalid_content_analysis")
    return {
        "location": value["location"],
        "evidence": _text(value.get("evidence")),
        "description": _text(value.get("description")),
    }


def _findings(
    value: object, maximum: int, kind: str, log: Optional[Callable] = None
) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError("invalid_content_analysis")
    findings = []
    for item in value:
        finding = _finding(item)
        if kind == "risk":
            finding = {
                **finding,
                "term": _text(item.get("term")),
                "category": _text(item.get("category")),
            }
        if kind == "weakness":
            references = item.get("referenceIds")
            if not isinstance(references, list) or not 1 <= len(references) <= MAX_REFERENCES:
                raise ValueError("invalid_content_analysis")
            finding = {**finding, "referenceIds": [_text(key) for key in references]}
            if "suggestion" in item:
                suggestion = read_optional(
                    "contentAnalysis.weaknesses.suggestion",
                    lambda: _text(item["suggestion"]),
                    None,
                    log,
                )
                if suggestion:
                    finding = {**finding, "suggestion": suggestion}
        findings = [*findings, finding]
    return findings


def read_content_analysis(
    value: object, log: Optional[Callable] = None
) -> Optional[dict[str, Any]]:
    """旧报告可缺省；新报告只接受完整的受约束结构。"""
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("status") not in (
        "completed",
        "fallback",
    ):
        raise ValueError("invalid_content_analysis")
    consistency = value.get("consistency")
    if not isinstance(consistency, dict):
        raise ValueError("invalid_content_analysis")
    stars = consistency.get("stars")
    if (
        type(stars) is not int
        or not 0 <= stars <= MAX_STARS
    ):
        raise ValueError("invalid_content_analysis")

    def findings(items: object, maximum: int, kind: str) -> list[dict[str, Any]]:
        if items is None:
            return []
        if not isinstance(items, list):
            return read_optional(
                "contentAnalysis." + kind, lambda: _findings(items, maximum, kind), [], log
            )
        return [
            row
            for item in items[:maximum]
            for row in read_optional(
                "contentAnalysis." + kind, lambda: _findings([item], maximum, kind, log), [], log
            )
        ]

    issues = findings(consistency.get("issues"), MAX_ISSUES, "issue")
    risks = findings(value.get("termRisks"), MAX_RISKS, "risk")
    weaknesses = findings(value.get("weaknesses"), MAX_WEAKNESSES, "weakness")
    return {
        "status": value["status"],
        "consistency": {
            "stars": stars,
            "summary": _text(consistency.get("summary")),
            "issues": issues,
        },
        "termRisks": risks,
        "weaknesses": weaknesses,
        "weaknessesAvailable": isinstance(value.get("weaknesses"), list)
        and len(weaknesses) == len(value["weaknesses"]),
    }


def project_content_analysis(
    value: object,
    prose: Callable[[object], str],
    comparisons: list[dict[str, Any]],
    log: Optional[Callable] = None,
) -> Optional[dict[str, Any]]:
    """说明走翻译流程；命中原文与引用标题保持原样。"""
    analysis = read_content_analysis(value, log)
    if analysis is None:
        return None

    def project(item: dict[str, Any]) -> dict[str, Any]:
        references = item.get("referenceIds", [])
        if any(key not in {note["id"] for note in comparisons} for key in references):
            raise ValueError("invalid_content_analysis_reference")
        return {
            **item,
            "description": prose(item["description"]),
            **({"suggestion": prose(item["suggestion"])} if "suggestion" in item else {}),
            **({"category": prose(item["category"])} if "category" in item else {}),
            "references": [
                note["title"] for note in comparisons if note["id"] in references
            ],
        }

    consistency = analysis["consistency"]
    weaknesses = [
        row
        for item in analysis["weaknesses"]
        for row in read_optional(
            "contentAnalysis.weaknesses.referenceIds", lambda: [project(item)], [], log
        )
    ]
    return {
        "status": analysis["status"],
        "stars": consistency["stars"],
        "summary": prose(consistency["summary"]),
        "issues": [project(item) for item in consistency["issues"]],
        "termRisks": [project(item) for item in analysis["termRisks"]],
        "weaknesses": weaknesses,
        "weaknessesAvailable": analysis["weaknessesAvailable"]
        and len(weaknesses) == len(analysis["weaknesses"]),
    }


def _finding_lines(item: dict[str, Any], translate: Callable[[str], str]) -> list[str]:
    location = "materials" if item["location"] == "content" else item["location"]
    rows = ["• " + translate(location) + ': "' + item["evidence"] + '"']
    if "term" in item:
        rows.append(
            translate("contentMatchedTerm")
            + ": "
            + item["term"]
            + " · "
            + translate(item["category"])
        )
    return [
        *rows,
        "  " + translate(item["description"]),
        *(["  " + translate(item["suggestion"])] if "suggestion" in item else []),
        *(
            "  " + translate("references") + ": " + title
            for title in item["references"]
        ),
    ]


def content_analysis_lines(
    data: dict[str, Any], translate: Callable[[str], str]
) -> list[str]:
    """按固定次序渲染一致性和参考不足。"""
    analysis = data.get("contentAnalysis")
    if not analysis:
        return [translate(data["summary"])]
    stars = analysis["stars"]
    rows = [
        translate("contentConsistency")
        + ": "
        + "★" * stars
        + "☆" * (MAX_STARS - stars)
        + f" ({stars}/5)"
    ]
    if analysis["status"] == "fallback":
        rows.append(translate("contentAnalysisFallback"))
    rows.append(translate(analysis["summary"]))
    for key, heading, empty in (
        ("issues", None, None),
        ("weaknesses", "contentWeaknesses", "contentNoWeaknesses"),
    ):
        if heading:
            rows.extend(["", translate(heading)])
        if not analysis[key] and empty:
            rows.append(
                translate("contentAnalysisUnavailable")
                if analysis["status"] == "fallback" or not analysis.get("weaknessesAvailable", True)
                else translate(empty)
            )
        for item in analysis[key]:
            rows.extend(_finding_lines(item, translate))
    return rows
