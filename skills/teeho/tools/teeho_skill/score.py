"""只读取服务端最终主分，不复算模型或一致性系数。"""

import math

def read_primary_score(result: dict) -> dict:
    """主分仍严格校验数值；未知来源使用通用标签。"""
    primary = result.get("primaryScore")
    if not isinstance(primary, dict) or type(primary.get("value")) not in (int, float):
        raise ValueError("invalid_score")
    value = primary["value"]
    if not math.isfinite(value) or not 0 <= value <= 10:
        raise ValueError("invalid_score")
    source = primary.get("source")
    return {
        "value": value,
        "source": source if source in ("insight", "radar_average") else "unknown",
    }
