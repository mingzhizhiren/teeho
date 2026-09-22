"""自定义展示项只使用已保存内容，不经过 Agent 翻译。"""

import math
from collections.abc import Callable
from typing import Optional

from .report_fields import read_optional

from .messages import safe_text

MAX_ITEMS = 20
MAX_TEXT = 800


def read_custom_metrics(value: object, log: Optional[Callable] = None) -> list[dict]:
    """校验展示类型，保留零值、负值与未知状态的区别。"""
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("invalid_metrics")
    return [
        row
        for item in value[:MAX_ITEMS]
        for row in read_optional("customMetrics.item", lambda: [_metric(item)], [], log)
    ]


def _metric(item: object) -> dict:
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
    return {
        "id": item["id"],
        "status": item["status"],
        **{key: safe_text(item[key]) for key in ("name", "unit", "description")},
        "value": safe_text(number) if isinstance(number, str) else number,
    }
