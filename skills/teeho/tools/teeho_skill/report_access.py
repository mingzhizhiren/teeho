"""读取服务端冻结的报告展示权限；旧报告不补造或重算权限。"""

from typing import Any, Optional

from .messages import safe_text
from .structure_metrics import METRIC_NAMES

ACCESS_CAPACITIES = {
    "report-access.v1": 4,
    "report-access.v2": 8,
    "report-access.v3": 10,
}
CONTENT_INDICATORS = ("consistency", "advice", "weaknesses", "termRisks")
LEGACY_MAX_COMPARISONS = 4
MAX_FOOTER_LENGTH = 200
Access = dict[str, Any]


def reference_capacity(access: Optional[Access]) -> int:
    """按保存的权限协议确定引用上限，不扩充旧版报告。"""
    if access is None:
        return LEGACY_MAX_COMPARISONS
    return ACCESS_CAPACITIES.get(access.get("version"), LEGACY_MAX_COMPARISONS)


def _section(value: object, indicators: tuple[str, ...]) -> Access:
    if (
        not isinstance(value, dict)
        or set(value) != {"enabled", "indicators"}
        or type(value.get("enabled")) is not bool
    ):
        raise ValueError("invalid_report_access")
    fields = value.get("indicators")
    if (
        not isinstance(fields, dict)
        or set(fields) != set(indicators)
        or any(type(fields.get(name)) is not bool for name in indicators)
    ):
        raise ValueError("invalid_report_access")
    return {
        "enabled": value["enabled"],
        "indicators": {name: fields[name] for name in indicators},
    }


def read_report_access(result: dict[str, Any]) -> Optional[Access]:
    """缺少权限快照表示历史契约；存在但损坏时拒绝展示，不能回退全量。"""
    if "reportAccess" not in result:
        return None
    value = result["reportAccess"]
    if (
        not isinstance(value, dict)
        or set(value) != {"version", "sections", "footer"}
        or value.get("version") not in tuple(ACCESS_CAPACITIES)
    ):
        raise ValueError("invalid_report_access")
    sections = value.get("sections")
    if not isinstance(sections, dict) or set(sections) != {
        "contentAnalysis",
        "structureMetrics",
        "comparisonNotes",
    }:
        raise ValueError("invalid_report_access")
    comparisons = sections.get("comparisonNotes")
    if (
        not isinstance(comparisons, dict)
        or set(comparisons) != {"enabled", "limit"}
        or type(comparisons.get("enabled")) is not bool
        or type(comparisons.get("limit")) is not int
        or not 0 <= comparisons["limit"] <= reference_capacity(value)
    ):
        raise ValueError("invalid_report_access")
    footer = value.get("footer")
    if footer is not None and (
        not isinstance(footer, str)
        or not footer.strip()
        or len(footer.strip()) > MAX_FOOTER_LENGTH
    ):
        raise ValueError("invalid_report_access")
    return {
        "version": value["version"],
        "sections": {
            "contentAnalysis": _section(
                sections.get("contentAnalysis"), CONTENT_INDICATORS
            ),
            "structureMetrics": _section(
                sections.get("structureMetrics"), METRIC_NAMES
            ),
            "comparisonNotes": {
                "enabled": comparisons["enabled"],
                "limit": comparisons["limit"],
            },
        },
        "footer": safe_text(footer) if footer else None,
    }


def allows(
    access: Optional[Access], section: str, indicator: Optional[str] = None
) -> bool:
    """按已校验快照判断展示，历史报告沿用原有内容。"""
    if access is None:
        return True
    value = access["sections"][section]
    return value["enabled"] and (
        value["indicators"][indicator] if indicator is not None else True
    )


def project_access_result(result: Access, access: Optional[Access]) -> Access:
    """在文字投影前移除未开放字段，避免进入翻译快照或备用展示路径。"""
    if access is None:
        return result
    content = result.get("contentAnalysis")
    filtered_content = (
        {
            key: item
            for key, item in content.items()
            if key not in CONTENT_INDICATORS or allows(access, "contentAnalysis", key)
        }
        if isinstance(content, dict) and allows(access, "contentAnalysis")
        else None
    )
    if isinstance(filtered_content, dict) and not allows(
        access, "contentAnalysis", "advice"
    ):
        weaknesses = filtered_content.get("weaknesses")
        filtered_content = {
            **filtered_content,
            **(
                {
                    "weaknesses": [
                        (
                            {
                                key: item
                                for key, item in row.items()
                                if key != "suggestion"
                            }
                            if isinstance(row, dict)
                            else row
                        )
                        for row in weaknesses
                    ]
                }
                if isinstance(weaknesses, list)
                else {}
            ),
        }
    comparisons = result.get("comparisonNotes")
    # 混合摘要和旧扩展字段没有细粒度归属；受限报告不能从这些副本补回结果。
    is_restricted = (
        any(not allows(access, "contentAnalysis", name) for name in CONTENT_INDICATORS)
        or any(not allows(access, "structureMetrics", name) for name in METRIC_NAMES)
        or not allows(access, "comparisonNotes")
        or access["sections"]["comparisonNotes"]["limit"] < reference_capacity(access)
    )
    source = (
        {
            key: item
            for key, item in result.items()
            if key
            not in (
                "qualitativeConclusion",
                "customMetrics",
                "differences",
                "radar",
                "noteScoringCoefficient",
                "noteScoringAudit",
                "topicSupport",
            )
        }
        if is_restricted
        else result
    )
    if not allows(access, "contentAnalysis", "termRisks"):
        source = {
            key: item
            for key, item in source.items()
            if key not in ("riskMatches", "riskReviewStatus")
        }
    return {
        **source,
        "contentAnalysis": filtered_content,
        **{
            field: (
                {
                    name: item
                    for name, item in value.items()
                    if name in METRIC_NAMES and allows(access, "structureMetrics", name)
                }
                if isinstance(value, dict)
                else {}
            )
            for field in ("structureMetrics", "structureReferences")
            for value in (result.get(field),)
        },
        "comparisonNotes": (
            comparisons[: access["sections"]["comparisonNotes"]["limit"]]
            if isinstance(comparisons, list) and allows(access, "comparisonNotes")
            else []
        ),
    }
