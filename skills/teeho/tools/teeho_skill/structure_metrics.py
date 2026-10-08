"""展示报告冻结的结构指标，兼容旧六项与新八项，不从原文重算。"""

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Callable
from .messages import safe_text

METRIC_NAMES = (
    "titleLength", "bodyLength", "paragraphLength", "paragraphCount",
    "topicCount", "topicLength",
    "maxTopicLength", "maxParagraphLength",
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
        if name.startswith('max') and name not in metrics:
            continue
        value, reference = metrics.get(name), references.get(name)
        if value is not None and not _number(value):
            raise ValueError("invalid_structure_metrics")
        if reference is not None and (
            not isinstance(reference, dict)
            or not _number(reference.get("low")) or not _number(reference.get("high"))
            or reference["low"] > reference["high"]
            or type(reference.get("sampleCount")) is not int or reference["sampleCount"] < 3
            or reference.get("severity") not in LEVELS
        ):
            raise ValueError("invalid_structure_reference")
        location_key = 'topics' if name == 'maxTopicLength' else 'paragraphs'
        locations = result.get('structureLocations') or {}
        positions = locations.get(location_key, []) if isinstance(locations, dict) and name.startswith('max') else []
        valid_positions = [item for item in positions if isinstance(item, dict)
                           and isinstance(item.get('text'), str)
                           and type(item.get('index')) is int and item['index'] >= 0
                           and (location_key == 'topics' or (type(item.get('number')) is int and item['number'] > 0))] if isinstance(positions, list) else []
        rows.append({"name": name, "value": value, "reference": reference,
                     **({"positions": valid_positions} if valid_positions else {})})
    return rows


def _difference_status(row: dict[str, Any]) -> str:
    value, reference = row["value"], row["reference"]
    if value is None:
        return "metricMissing"
    if reference is None:
        return "metricInsufficient"
    if reference["low"] <= value <= reference["high"]:
        return "metricInRange"
    is_count = row["name"] in ("paragraphCount", "topicCount")
    if value < reference["low"]:
        return "metricFewer" if is_count else "metricShorter"
    return "metricMore" if is_count else "metricLonger"


def structure_metric_lines(
    rows: list[dict[str, Any]], translate: Callable[[str], str],
    number: Callable[[float], str],
) -> list[str]:
    lines = []
    indexed = {row["name"]: row for row in rows}
    frozen_rows = [
        indexed.get(name, {"name": name, "value": None, "reference": None})
        for name in METRIC_NAMES
        if not name.startswith('max') or name in indexed
    ]
    topic_count = indexed.get("topicCount", {}).get("value")
    for row in frozen_rows:
        name, value, reference = row["name"], row["value"], row["reference"]
        def formatted(item: float) -> str:
            rounded = Decimal(str(item)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            return number(float(rounded))
        level = _difference_status(row)
        icon = LEVEL_ICONS[reference["severity"]] if value is not None and reference else "⚪"
        has_no_topics = value is None and (name == "maxTopicLength" or (name == "topicLength" and topic_count == 0))
        value_text = (translate("metricNoTopics") if has_no_topics else
                      formatted(value) if value is not None else translate("unavailable"))
        lines.append(icon + " " + translate(name) + ": " + value_text +
                     ("" if has_no_topics else " · " + translate(level)))
        lines.append(translate("peerRange") + ": " + (
            formatted(reference["low"]) + " ~ " + formatted(reference["high"])
            if reference else translate("metricInsufficient")
        ))
        for position in row.get('positions', []):
            prefix = (translate('metricParagraph') + ' ' + str(position['number']) + ': '
                      if name == 'maxParagraphLength' else '')
            lines.append(prefix + safe_text(position['text']))
        lines.append("")
    return lines
