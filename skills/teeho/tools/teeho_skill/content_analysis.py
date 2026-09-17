"""内容分析的边界校验与公开展示投影。"""

import math
from decimal import Decimal, ROUND_HALF_UP
from collections.abc import Callable
from typing import Any, Optional

from .messages import safe_text

LOCATIONS = frozenset(("title", "body", "topics", "cover", "content"))
MAX_STARS = 5
FALLBACK_STARS = 3
MAX_ISSUES = 5
MAX_RISKS = 20
MAX_WEAKNESSES = 5
SCORE_POLICY = "consistency-weighted.v1"


def score_retention(analysis: dict[str, Any]) -> Optional[int]:
    """旧报告不套用新策略，失败兜底不降分。"""
    if analysis.get("scorePolicy") != SCORE_POLICY or analysis["status"] != "completed":
        return None
    return {1: 25, 2: 50}.get(analysis["consistency"]["stars"])


def expected_content_score(analysis: dict[str, Any]) -> Optional[float]:
    """使用十进制四舍五入验证最终分，不修改报告。"""
    if analysis["status"] == "completed" and analysis["consistency"]["stars"] == 0:
        return 0
    original = analysis["originalScore"]
    percent = score_retention(analysis)
    if percent is None or original is None:
        return original
    return float(
        (Decimal(str(original)) * Decimal(percent) / Decimal(100)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    )


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


def _findings(value: object, maximum: int, kind: str) -> list[dict[str, Any]]:
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
            if not isinstance(references, list) or not 1 <= len(references) <= 3:
                raise ValueError("invalid_content_analysis")
            finding = {**finding, "referenceIds": [_text(key) for key in references]}
        findings = [*findings, finding]
    return findings


def read_content_analysis(value: object) -> Optional[dict[str, Any]]:
    """旧报告可缺省；新报告只接受完整的受约束结构。"""
    if value is None:
        return None
    if not isinstance(value, dict) or value.get("status") not in (
        "completed",
        "fallback",
    ):
        raise ValueError("invalid_content_analysis")
    consistency = value.get("consistency")
    if "scorePolicy" in value and value["scorePolicy"] != SCORE_POLICY:
        raise ValueError("invalid_content_analysis_policy")
    if not isinstance(consistency, dict):
        raise ValueError("invalid_content_analysis")
    stars = consistency.get("stars")
    original = value.get("originalScore")
    unavailable_zero = (
        value["status"] == "completed" and stars == 0 and original is None
    )
    valid_original = (
        type(original) in (int, float)
        and math.isfinite(original)
        and 0 <= original <= 10
    )
    if (
        type(stars) is not int
        or not 0 <= stars <= MAX_STARS
        or (value["status"] == "fallback" and stars != FALLBACK_STARS)
        or "originalScore" not in value
        or not (valid_original or unavailable_zero)
    ):
        raise ValueError("invalid_content_analysis")
    issues = _findings(consistency.get("issues"), MAX_ISSUES, "issue")
    risks = _findings(value.get("termRisks"), MAX_RISKS, "risk")
    weaknesses = _findings(value.get("weaknesses"), MAX_WEAKNESSES, "weakness")
    if (stars == 0 and not issues) or (
        value["status"] == "fallback" and (issues or risks or weaknesses)
    ):
        raise ValueError("invalid_content_analysis")
    return {
        "status": value["status"],
        "originalScore": original,
        **({"scorePolicy": value["scorePolicy"]} if "scorePolicy" in value else {}),
        "consistency": {
            "stars": stars,
            "summary": _text(consistency.get("summary")),
            "issues": issues,
        },
        "termRisks": risks,
        "weaknesses": weaknesses,
    }


def project_content_analysis(
    value: object, prose: Callable[[object], str], comparisons: list[dict[str, Any]]
) -> Optional[dict[str, Any]]:
    """说明走翻译流程；命中原文与引用标题保持原样。"""
    analysis = read_content_analysis(value)
    if analysis is None:
        return None

    def project(item: dict[str, Any]) -> dict[str, Any]:
        references = item.get("referenceIds", [])
        if any(key not in {note["id"] for note in comparisons} for key in references):
            raise ValueError("invalid_content_analysis_reference")
        return {
            **item,
            "description": prose(item["description"]),
            **({"category": prose(item["category"])} if "category" in item else {}),
            "references": [
                note["title"] for note in comparisons if note["id"] in references
            ],
        }

    consistency = analysis["consistency"]
    return {
        "status": analysis["status"],
        "retainedPercent": score_retention(analysis),
        "stars": consistency["stars"],
        "summary": prose(consistency["summary"]),
        "issues": [project(item) for item in consistency["issues"]],
        "termRisks": [project(item) for item in analysis["termRisks"]],
        "weaknesses": [project(item) for item in analysis["weaknesses"]],
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
    elif stars == 0:
        rows.append(translate("contentAnalysisZero"))
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
                if analysis["status"] == "fallback"
                else translate(empty)
            )
        for item in analysis[key]:
            rows.extend(_finding_lines(item, translate))
    return rows
