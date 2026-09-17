"""自定义展示项只使用已保存内容，不经过 Agent 翻译。"""

import math

from .messages import safe_text

MAX_ITEMS = 20
MAX_TEXT = 800


def read_custom_metrics(value: object) -> list[dict]:
    """校验展示类型，保留零值、负值与未知状态的区别。"""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_ITEMS:
        raise ValueError("invalid_metrics")
    result = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("invalid_metric")
        if any(
            not isinstance(item.get(key), str) or len(item[key]) > MAX_TEXT
            for key in ("id", "name", "unit", "description")
        ):
            raise ValueError("invalid_metric_text")
        number = item.get("value")
        if item.get("status") == "available":
            if not (
                isinstance(number, str)
                and len(number) <= MAX_TEXT
                or type(number) in (int, float)
                and math.isfinite(number)
            ):
                raise ValueError("invalid_metric_value")
        elif item.get("status") != "unavailable" or number is not None:
            raise ValueError("invalid_metric_status")
        result = [
            *result,
            {
                **item,
                **{
                    key: safe_text(item[key]) for key in ("name", "unit", "description")
                },
                "value": safe_text(number) if isinstance(number, str) else number,
            },
        ]
    return result
