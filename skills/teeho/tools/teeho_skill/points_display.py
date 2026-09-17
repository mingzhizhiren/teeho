"""校验任务结束后的积分快照，时间统一显示为明确的 UTC。"""

import math
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Optional

from .errors import TeehoError


def _amount(value: object) -> Optional[float]:
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        return None
    return value


def _instant(value: object) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (ValueError, OverflowError):
        return None


def points_snapshot(result: dict) -> dict:
    """仅投影白名单余额与服务器时间，不保存身份或接口原文。"""
    summary = result.get("summary")
    if not isinstance(summary, dict):
        raise TeehoError("invalid_response")
    if summary.get("enabled") is False:
        return {"enabled": False}
    balances = summary.get("balances")
    if not isinstance(balances, dict):
        raise TeehoError("invalid_response")
    amounts = {key: _amount(balances.get(key)) for key in ("free", "package", "purchased", "total")}
    if any(value is None for value in amounts.values()):
        raise TeehoError("invalid_response")
    now, reset = _instant(summary.get("serverNow")), _instant(summary.get("nextResetAt"))
    return {
        "enabled": True,
        "balances": amounts,
        "allowance": _amount(summary.get("dailyAllowance")),
        "observedAt": now.strftime("%Y-%m-%d %H:%M:%S UTC") if now else None,
        "resetAt": reset.strftime("%Y-%m-%d %H:%M:%S UTC") if reset else None,
        "seconds": max(0, int((reset - now).total_seconds())) if now and reset else None,
    }


def report_points_line(snapshot: Optional[dict], translate: Callable[[str], str]) -> str:
    """报告标题下展示总可用积分；未知或关闭时使用短横线。"""
    value = "-"
    if snapshot and snapshot.get("enabled") is True:
        total = _amount((snapshot.get("balances") or {}).get("total"))
        if total is not None:
            value = format(total, "g")
    return "✨ " + translate("totalAvailableCredits") + " " + value


def points_lines(snapshot: dict, translate: Callable[[str], str]) -> list[str]:
    """展示查询时刻的余额和重置倒计时；未知不当作零。"""
    heading = ["", "【✨ " + translate("remainingCredits") + "】", ""]
    if snapshot.get("unavailable"):
        return [*heading, translate("creditsUnavailable")]
    if snapshot.get("enabled") is False:
        return [*heading, translate("billingDisabled")]
    balances = snapshot["balances"]
    allowance = snapshot.get("allowance")
    rows = [
        "• " + translate(key) + ": " + format(value, "g")
        + (" / " + format(allowance, "g") if key == "free" and allowance is not None else "")
        for key, value in balances.items()
    ]
    seconds = snapshot.get("seconds")
    countdown = (
        f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"
        if seconds is not None else translate("unavailable")
    )
    return [
        *heading, *rows,
        translate("creditsObservedAt") + ": " + (snapshot.get("observedAt") or translate("unavailable")),
        translate("dailyResetAt") + ": " + (snapshot.get("resetAt") or translate("unavailable")),
        translate("resetCountdownSnapshot") + ": " + countdown,
    ]
