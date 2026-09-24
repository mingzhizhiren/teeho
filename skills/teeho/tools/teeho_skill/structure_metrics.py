"""与网页一致展示报告冻结的六项笔记指标，不从旧差异或原文重算。"""

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable

METRIC_NAMES = (
    "titleLength", "titleEmojiRatio", "bodyLength", "paragraphLength",
    "listItemCount", "topicCount",
)
LEVELS = ("aligned", "minor", "moderate", "major", "critical")
LEVEL_ICONS = {
    "aligned": "🟢", "minor": "🟡", "moderate": "🟠",
    "major": "🔴", "critical": "🔴",
}


def _number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def project_structure_metrics(result: dict[str, Any]) -> list[dict[str, Any]]:
    metrics = result.get("structureMetrics") or {}
    references = result.get("structureReferences") or {}
    if not isinstance(metrics, dict) or not isinstance(references, dict):
        raise ValueError("invalid_structure_metrics")
    rows = []
    for name in METRIC_NAMES:
        value, reference = metrics.get(name), references.get(name)
        if value is not None and (not _number(value) or (name == "titleEmojiRatio" and value > 1)):
            raise ValueError("invalid_structure_metrics")
        if reference is not None and (
            not isinstance(reference, dict)
            or not _number(reference.get("low")) or not _number(reference.get("high"))
            or reference["low"] > reference["high"]
            or (name == "titleEmojiRatio" and reference["high"] > 1)
            or type(reference.get("sampleCount")) is not int or reference["sampleCount"] < 3
            or reference.get("severity") not in LEVELS
        ):
            raise ValueError("invalid_structure_reference")
        rows.append({"name": name, "value": value, "reference": reference})
    return rows


def structure_metric_lines(
    rows: list[dict[str, Any]], translate: Callable[[str], str],
    number: Callable[[float], str],
) -> list[str]:
    lines = []
    for row in rows:
        name, value, reference = row["name"], row["value"], row["reference"]
        def formatted(item: float) -> str:
            ratio = name == "titleEmojiRatio"
            rounded = (Decimal(str(item)) * (100 if ratio else 1)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            return number(float(rounded)) + ("%" if ratio else "")
        level = ("metricMissing" if value is None else
                 "metric_" + reference["severity"] if reference else "metricInsufficient")
        icon = LEVEL_ICONS[reference["severity"]] if value is not None and reference else "⚪"
        lines.append(icon + " " + translate(name) + ": " + (formatted(value) if value is not None else translate("unavailable")) + " · " + translate(level))
        lines.append(translate("peerRange") + ": " + (
            formatted(reference["low"]) + " ~ " + formatted(reference["high"])
            if reference else translate("metricInsufficient")
        ))
        lines.append("")
    return lines
