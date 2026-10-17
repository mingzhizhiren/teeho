"""仅展示服务端已保存的风险结果，客户端不持有词库或重新判断。"""

from collections.abc import Callable
from typing import Any, Optional

from .content_analysis import _findings


def project_risk_matches(
    result: dict[str, Any], prose: Callable[[object], str]
) -> Optional[list[dict[str, Any]]]:
    """缺少结果表示不可用；空列表才表示服务端确认没有命中。"""
    value = result.get("riskMatches")
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
        for item in _findings(value, len(value), "risk")
    ]


def risk_match_lines(
    data: dict[str, Any], translate: Callable[[str], str]
) -> list[str]:
    """保留已保存的全部命中；审核未完成时同时说明结果不完整。"""
    matches = data.get("riskMatches")
    is_unavailable = data.get("riskReviewStatus") == "unavailable"
    if matches is None:
        label = "contentRiskUnavailable" if is_unavailable else "contentRiskNotProvided"
        return ["ℹ️ " + translate(label)]
    if not matches and is_unavailable:
        return ["ℹ️ " + translate("contentRiskUnavailable")]
    if not matches:
        return ["ℹ️ " + translate("contentNoTermRisks")]
    warning = ["ℹ️ " + translate("contentRiskUnavailable")] if is_unavailable else []
    return [
        *warning,
        *(
            "🔎 "
            + item["term"]
            + " - "
            + translate(
                "materials" if item["location"] == "content" else item["location"]
            )
            + ": "
            + translate(item["description"])
            for item in matches
        ),
    ]
