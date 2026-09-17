"""参考笔记入选理由的稳定枚举与阈值规则。"""

import math
from enum import Enum
from typing import Mapping


class SelectionReason(str, Enum):
    HIGH_EXPOSURE = "high_exposure"
    RAPID_GROWTH = "rapid_growth"


HIGH_EXPOSURE = {"likes": 10_000, "collects": 1_000, "comments": 100}


def selection_reason(note: Mapping[str, object]) -> SelectionReason:
    """按已保存数量判断，缺项走快速增长分支。"""
    for metric, minimum in HIGH_EXPOSURE.items():
        value = note.get(metric)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value < minimum
        ):
            return SelectionReason.RAPID_GROWTH
    return SelectionReason.HIGH_EXPOSURE
