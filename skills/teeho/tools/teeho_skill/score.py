"""当前报告主分契约，洞察模型与雷达平均分保持不同来源。"""

import math

from .messages import RADAR_METRICS
from .content_analysis import expected_content_score, read_content_analysis


def read_primary_score(result: dict) -> dict:
    """验证主分身份，不根据当前部署或插件重新解释历史。"""
    insight = result.get("insight")
    primary = result.get("primaryScore")
    if result.get("schemaVersion") != "analysis-result.v7":
        raise ValueError("invalid_score_version")
    if not isinstance(primary, dict) or type(primary.get("value")) not in (int, float):
        raise ValueError("invalid_score")
    value = primary["value"]
    if not math.isfinite(value) or not 0 <= value <= 10:
        raise ValueError("invalid_score")
    analysis = read_content_analysis(result.get("contentAnalysis"))
    if analysis and value != expected_content_score(analysis):
        raise ValueError("invalid_content_analysis_score")
    if primary.get("source") == "insight":
        if (
            not isinstance(insight, dict)
            or insight.get("status") != "available"
            or value != insight.get("score")
        ):
            raise ValueError("invalid_score")
    elif primary.get("source") == "radar_average":
        radar = result.get("radar", {})
        values = [radar.get(key) for key in RADAR_METRICS if radar.get(key) is not None]
        if (
            insight is not None
            or len(values) < 4
            or any(
                type(item) not in (int, float)
                or not math.isfinite(item)
                or not 0 <= item <= 10
                for item in values
            )
        ):
            raise ValueError("invalid_average")
        if not math.isclose(
            analysis["originalScore"] if analysis else value,
            math.floor(
                sum(math.floor(item * 100 + 0.5) for item in values) / len(values) + 0.5
            )
            / 100,
        ):
            raise ValueError("invalid_average")
    else:
        raise ValueError("invalid_score_source")
    return primary
