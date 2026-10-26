"""已保存评分的区间位置；仅用于展示，不改变主分。"""

import math
from collections.abc import Callable
from typing import Optional

BAR_STEPS = 32


def score_range_lines(
    score: object, reference: object, translate: Callable[[str], str]
) -> list[str]:
    """评分条只标记当前分，中位分保留为文字说明。"""
    if not isinstance(reference, dict):
        return []
    values = (
        score,
        reference.get("min"),
        reference.get("max"),
        reference.get("median"),
    )
    if any(
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 <= value <= 10
        for value in values
    ):
        return []
    current, minimum, maximum, median = values
    if maximum <= minimum or not minimum <= median <= maximum:
        return []
    percent = min(100, max(0, (current - minimum) / (maximum - minimum) * 100))
    current_index = math.floor(percent / 100 * BAR_STEPS + 0.5)
    rail = "=" * current_index + "^" + "-" * (BAR_STEPS - current_index)
    boundary: Optional[str] = (
        "scoreRangeBelow"
        if current < minimum
        else "scoreRangeAbove" if current > maximum else None
    )
    return [
        "",
        translate("scoreRangeTitle") + f": {percent:.1f}%",
        "0% [" + rail + "] 100%",
        "",
        "^ " + translate("scoreRangeCurrent") + f": {current:.2f}",
        translate("scoreRangeMedian") + f": {median:.2f}",
        translate("scoreRangeMinimum")
        + f": {minimum:.2f} · "
        + translate("scoreRangeMaximum")
        + f": {maximum:.2f}",
        *([translate(boundary)] if boundary else []),
        translate("scoreRangeCaption"),
    ]
