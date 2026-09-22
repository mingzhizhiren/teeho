"""可选报告字段的局部降级；日志仅记录受控字段路径。"""

from collections.abc import Callable
from typing import Optional, TypeVar

T = TypeVar("T")


def read_optional(
    field: str, read: Callable[[], T], default: T, log: Optional[Callable] = None
) -> T:
    """一个可选项损坏不能使其余报告丢失，不记录字段原文。"""
    try:
        return read()
    except (ValueError, TypeError, KeyError, AttributeError, OverflowError) as error:
        if log:
            log(
                "report_optional_field_skipped",
                {"fieldPath": field, "errorCode": type(error).__name__},
                "warn",
            )
        return default
