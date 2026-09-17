"""业务结果仅投影为公开展示字段，不透传接口内部数据。"""

import json
import math
import re
from collections.abc import Callable
from typing import Any, Optional, Union

from .help_content import resolve_help_topic
from .history import local_media
from .structure_metrics import project_structure_metrics
from .errors import TeehoError
from .score import read_primary_score
from .content_analysis import project_content_analysis, read_content_analysis
from .risk_matches import project_risk_matches
from .selection_reason import selection_reason
from .custom_metrics import read_custom_metrics
from .messages import ENGLISH, RADAR_METRICS, safe_text, safe_url

TERMINAL_FAILURE = frozenset(("technical_failed", "failed"))
CANCELLED = frozenset(("cancelled", "abandoned"))
PENDING = frozenset(
    (
        "researching",
        "queued",
        "collecting",
        "collecting_evidence",
        "waiting",
        "running",
        "processing",
        "analyzing",
        "retrying",
        "retry_scheduled",
    )
)
MAX_SAFE_INTEGER = 9007199254740991
IDENTIFIER = re.compile(r"[a-f0-9-]{36}", re.IGNORECASE)
View = dict[str, Any]


def _number(
    value: object, maximum: float = MAX_SAFE_INTEGER
) -> Optional[Union[int, float]]:
    if type(value) not in (int, float):
        return None
    return value if math.isfinite(value) and 0 <= value <= maximum else None


def _identifier(value: object) -> Optional[str]:
    return value if isinstance(value, str) and IDENTIFIER.fullmatch(value) else None


def _base(state: str, kind: str, next_action: Optional[str] = None) -> View:
    return {
        "state": state,
        "kind": kind,
        "nextAction": next_action,
        "texts": {},
        "data": {},
    }


def _notice(state: str, message: str, next_action: Optional[str] = None) -> View:
    return {**_base(state, "notice", next_action), "data": {"message": message}}


def _invalid() -> View:
    return _notice("invalid_response", "invalidResponse")


def _billing(task: View) -> View:
    if _number(task.get("chargedPoints")) is not None:
        return {"price": _number(task["chargedPoints"]), "message": "charged"}
    messages = {
        "released": "released",
        "reserved": "reserved",
        "consumed": "charged",
        "settled": "charged",
    }
    status = task.get("pointReservationStatus")
    return {
        "price": (
            _number(task.get("pointCost"))
            if status in ("consumed", "settled")
            else None
        ),
        "message": messages.get(status, "billingUnknown"),
    }


def _make_report(task: View, saved: bool, historical: bool) -> View:
    result = task.get("result")
    if not isinstance(result, dict):
        return _invalid()
    conclusion = result.get("qualitativeConclusion")
    if result.get("schemaVersion") != "analysis-result.v7" or not isinstance(result.get("radar"), dict):
        return _invalid()
    if not isinstance(conclusion, dict) or not isinstance(
        conclusion.get("summary"), str
    ):
        return _invalid()
    analysis = read_content_analysis(result.get("contentAnalysis"))
    forced_zero = bool(analysis and analysis["status"] == "completed"
                       and analysis["consistency"]["stars"] == 0)
    if (
        not isinstance(result.get("comparisonNotes"), list)
        or (not result["comparisonNotes"] and not forced_zero)
    ):
        return _invalid()
    if not isinstance(result.get("differences"), list):
        return _invalid()
    return _report_view(task, result, saved, historical)


def _report_view(task: View, result: View, saved: bool, historical: bool) -> View:
    texts: dict[str, str] = {}

    def prose(value: object) -> str:
        nonlocal texts
        key = "content_" + str(len(texts))
        texts = {**texts, key: safe_text(value) or ENGLISH["noInformation"]}
        return key

    comparisons = [
        _comparison(note, prose)
        for note in (result.get("comparisonNotes") or [])
        if isinstance(note, dict)
    ]
    insight = result.get("insight") or {}
    primary_score = read_primary_score(result)
    conclusion = result["qualitativeConclusion"]
    data = {
        "taskId": _identifier(task.get("id")),
        "historical": historical,
        "saved": saved is True,
        "billing": _billing(task),
        "score": primary_score["value"],
        "scoreSource": primary_score["source"],
        "customMetrics": read_custom_metrics(result.get("customMetrics")),
        "limited": insight.get("limited") is True,
        "weightedReference": (
            isinstance(insight.get("reference"), dict)
            and insight["reference"].get("aggregation") == "weighted_tracks"
        ),
        "scoreReference": (
            {
                key: _number(insight["reference"].get(key), 10)
                for key in ("mean", "median", "p10", "p90", "min", "max")
            }
            if isinstance(insight.get("reference"), dict)
            and primary_score["source"] == "insight"
            and (_number(insight["reference"].get("sampleCount")) or 0) >= 20
            else None
        ),
        "comparison": (
            insight.get("comparison")
            if insight.get("comparison") in ("above", "near", "below")
            else None
        ),
        "scores": [_number(result["radar"].get(key), 10) for key in RADAR_METRICS],
        "summary": prose(conclusion["summary"]),
        "comparisons": comparisons,
        "riskMatches": project_risk_matches(result, task, prose),
        "riskReviewStatus": result.get("riskReviewStatus"),
        "structureMetrics": project_structure_metrics(result),
        **({"contentAnalysis": project_content_analysis(
            result["contentAnalysis"], prose, comparisons
        )} if result.get("contentAnalysis") is not None else {}),
        "differences": [
            {
                "feature": item["feature"],
                "severity": item["severity"],
                "value": _number(item.get("value")),
                "low": _number(item.get("low")),
                "high": _number(item.get("high")),
                "references": [
                    note["title"]
                    for note in comparisons
                    if note["id"] in item.get("referenceIds", [])
                ],
            }
            for item in result.get("differences", [])
            if isinstance(item, dict)
            and item.get("feature")
            in (
                "titleLength",
                "bodyLength",
                "paragraphs",
                "paragraphLength",
                "lexicalVariety",
            )
            and item.get("severity")
            in ("aligned", "minor", "moderate", "major", "critical")
        ][:3],
    }
    return {**_base("completed", "report"), "texts": texts, "data": data}


def _comparison(note: View, prose: Callable[[object], str]) -> View:
    return {
        "selectionReason": selection_reason(note).value,
        "id": safe_text(note.get("noteId")),
        "title": safe_text(note.get("title")),
        "excerpt": safe_text(note.get("bodyExcerpt")),
        "likes": _number(note.get("likes")),
        "collects": _number(note.get("collects")),
        "comments": _number(note.get("comments")),
        "reason": prose(note.get("reason")),
        "url": safe_url(
            note.get("noteUrl", note.get("url")), allow_platform_access=True
        ),
    }


def _task_presentation(command: str, result: View) -> View:
    task = result["task"]
    if not isinstance(task, dict) or not isinstance(task.get("status"), str):
        return _invalid()
    status = task["status"]
    if status in ("succeeded", "completed"):
        view = _make_report(task, result.get("saved", False), command == "history")
        if view["state"] == "invalid_response":
            return {
                **view,
                "data": {**view["data"], "taskId": _identifier(task.get("id"))},
            }
        try:
            media = local_media(result.get("localMedia"))
        except TeehoError:
            media = local_media(None)
        if media["cover"] or media["images"] or media["video"]:
            return {**view, "data": {**view["data"], "localMedia": media}}
        return view
    data = {"taskId": _identifier(task.get("id")), "billing": _billing(task)}
    if status == "insufficient_points":
        view = _notice("insufficient_credits", "creditLow", "status")
    elif status in TERMINAL_FAILURE:
        reason = (task.get("failure") or {}).get("code")
        view = _notice(
            "failed",
            {
                "insight_unavailable": "insightFailure",
                "radar_unavailable": "radarFailure",
                "no_reference_notes": "referenceFailure",
            }.get(reason, "failedMessage"),
        )
    elif status in CANCELLED:
        view = _notice(
            "cancelled",
            (
                "maintenanceInterrupted"
                if task.get("cancellationReason") == "maintenance"
                else "taskCancelled"
            ),
        )
    elif status in PENDING:
        has_waited = command == "wait"
        view = _notice(
            "processing",
            "waiting" if has_waited else "waitingAutomatic",
            "wait_for_user" if has_waited else "wait",
        )
    else:
        return _invalid()
    return {**view, "data": {**data, **view["data"]}}


def _authentication_view(command: str, result: View) -> View:
    if command == "login":
        url = safe_url(result.get("verificationUrl"))
        code = result.get("userCode")
        if (
            not url
            or not isinstance(code, str)
            or not re.fullmatch(r"[a-z0-9 -]{1,80}", code, re.IGNORECASE)
        ):
            return _invalid()
        interval = _number(result.get("interval"))
        return {
            **_base("authorization_pending", "authorization", "login-status"),
            "data": {
                "url": url,
                "code": code,
                "interval": 5000 if interval is None else interval,
            },
        }
    user = result.get("user")
    if not isinstance(user, dict) or not isinstance(user.get("isAnonymous"), bool):
        return _invalid()
    expiration = result.get("expiresAt")
    return {
        **_base("authenticated", "onboarding", "continue"),
        "data": {
            "anonymous": user["isAnonymous"],
            "expiresAt": (
                None
                if "expiresAt" in result and expiration is None
                else safe_text(expiration) or ENGLISH["unavailable"]
            ),
        },
    }


def _status_view(result: View) -> View:
    user, summary = result.get("user"), result.get("summary")
    if not isinstance(user, dict) or not isinstance(summary, dict):
        return _invalid()
    balances = summary.get("balances") or {}
    return {
        **_base("authenticated", "status"),
        "data": {
            "anonymous": user.get("isAnonymous") is True,
            "email": "" if user.get("isAnonymous") else safe_text(user.get("email")),
            "enabled": summary.get("enabled") is not False,
            "balances": {
                key: _number(balances.get(key))
                for key in ("free", "package", "purchased", "total")
            },
        },
    }


def _summary_view(result: View, anonymous: bool) -> View:
    ignored = result.get("ignored")
    return {
        **_base("submitting", "summary"),
        "data": {
            **{
                key: safe_text(result.get(key))
                for key in ("title", "body", "topics", "video", "cover")
            },
            "images": _number(result.get("images")),
            "ignored": (
                [safe_text(item) for item in ignored]
                if isinstance(ignored, list)
                else []
            ),
            "anonymous": anonymous,
        },
    }


def _local_view(command: str, result: View) -> View:
    if command == "history" and isinstance(result.get("history"), list):
        history = result["history"]
        return {
            **_base("ready", "history"),
            "texts": {
                "history_" + str(i): safe_text(row.get("summary"))
                or ENGLISH["noInformation"]
                for i, row in enumerate(history)
            },
            "data": {
                "records": [
                    {
                        "id": _identifier(row.get("id")),
                        "savedAt": safe_text(row.get("savedAt")),
                        "summary": "history_" + str(i),
                    }
                    for i, row in enumerate(history)
                ]
            },
        }
    if command == "inspect" and isinstance(result.get("notes"), list):
        return {
            **_base(
                "ready",
                "inspect",
                "select_note" if result.get("requiresSelection") else "continue",
            ),
            "data": {
                "files": [safe_text(note.get("path")) for note in result["notes"]],
                "images": (
                    len(result["images"])
                    if isinstance(result.get("images"), list)
                    else None
                ),
                "videos": (
                    len(result["videos"])
                    if isinstance(result.get("videos"), list)
                    else None
                ),
                **(
                    {
                        "directories": [
                            safe_text(directory.get("path"))
                            for directory in result.get("directories", [])
                            if isinstance(directory, dict)
                        ]
                    }
                    if result.get("directories")
                    else {}
                ),
            },
        }
    if command == "logout" and result.get("signedOut") is True:
        return _notice("signed_out", "signedOut")
    if command == "clear-identity" and (
        result.get("cleared") is True or result.get("signedOut") is True
    ):
        return _notice("cleared", "identityCleared")
    if command == "clear-history" and result.get("cleared") is True:
        return _notice("cleared", "historyCleared")
    return _invalid()


def create_presentation(command: str, result: object, anonymous: bool = False) -> View:
    """只转换已知响应形状；错误数据回退固定提示。"""
    try:
        if not isinstance(result, dict):
            return _invalid()
        if isinstance(result.get("task"), (dict, list)) or result.get("task"):
            return _task_presentation(command, result)
        if result.get("preparing") is True:
            return _notice("preparing", "preparingMessage", "resume")
        if command == "task_summary":
            return _summary_view(result, anonymous)
        if command in ("login", "anonymous", "login-status"):
            return _authentication_view(command, result)
        if command == "status":
            return _status_view(result)
        if command == "help":
            topic = resolve_help_topic(result.get("topic"))
            return {
                **_base("ready", "help"),
                "data": {"topic": topic.id if topic else None},
            }
        if command == "installation":
            url = safe_url(result.get("apiUrl"))
            return (
                {**_base("ready", "installation"), "data": {"url": url}}
                if result.get("configured") is True and url
                else _invalid()
            )
        if command == "config":
            config = result.get("config")
            return (
                _notice("ready", "config")
                if isinstance(config, dict) and isinstance(config.get("tracks"), list)
                else _invalid()
            )
        return _local_view(command, result)
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError):
        return _invalid()


ERRORS = {
    "invalid_help_topic": ("invalid_input", "helpTopicInvalid", "help"),
    "missing_cover": ("invalid_input", "missingCover", "correct_input"),
    "指定封面必须在本次图片中": (
        "invalid_input",
        "coverMustBeInImages",
        "correct_input",
    ),
    "login_required": ("login_required", "loginRequired", "authenticate"),
    "authorization_pending": ("authorization_pending", "pendingAuth", "login-status"),
    "identity_busy": ("busy", "localData", "retry"),
    "identity_already_present": ("authenticated", "status", "status"),
    "anonymous_no_logout": ("invalid_request", "anonymousLogout", None),
    "identity_server_mismatch": ("invalid_configuration", "configurationError", None),
    "无法登录匿名用户，请注册新用户或者登录你的用户": (
        "login_required",
        "deviceMissing",
        "login",
    ),
    "题火请求参数无效，请更新技能后重试": ("invalid_request", "invalidRequest", None),
    "技能服务地址配置无效，请从目标题火网站重新安装技能": (
        "invalid_configuration",
        "configurationError",
        None,
    ),
    "积分不足，请查看题火状态": ("insufficient_credits", "creditLow", "status"),
    "需要确认清理当前账号历史": ("confirmation_required", "confirmHistory", "confirm"),
    "需要确认清除本机身份": ("confirmation_required", "confirmIdentity", "confirm"),
    "没有待恢复的题火任务": ("empty", "noPending", None),
    "有未确认的任务，请先恢复任务": ("pending", "resumeRequired", "resume"),
    "有任务分析中，请先查询任务": ("processing", "waiting", "task"),
    "账号已切换，请使用原账号查询任务": ("account_changed", "accountChanged", None),
    "rate_limited": ("rate_limited", "rate", "wait_for_user"),
    "anonymous_limit": ("anonymous_limit", "anonymousLimit", "login"),
    "请补充或检查标题": ("invalid_input", "missingTitle", "correct_input"),
    "请补充或检查正文": ("invalid_input", "missingBody", "correct_input"),
    "请补充或检查话题": ("invalid_input", "missingTopics", "correct_input"),
    "invalid_response": ("invalid_response", "invalidResponse", None),
    "invalid_input": ("invalid_input", "invalidRequest", "correct_input"),
    "input_encoding_invalid": ("invalid_input", "encodingInvalid", "correct_input"),
    "input_too_large": ("invalid_input", "invalidRequest", "correct_input"),
    "unknown_command": ("invalid_input", "invalidRequest", "help"),
    "invalid_local_data": ("local_error", "localData", None),
}


def create_error_presentation(error: BaseException) -> View:
    """内部错误只参与映射，不进入展示或元数据。"""
    code, status = getattr(error, "code", None), getattr(error, "status", None)
    if isinstance(error, PermissionError) or code in ("EPERM", "EACCES"):
        return _notice("permission_required", "permission", "request_permission")
    if status == 400:
        return _notice("invalid_request", "invalidRequest", "correct_input")
    if status == 403:
        return _notice("access_denied", "authDenied")
    mapped = ERRORS.get(code) or ERRORS.get(str(error))
    if mapped:
        return _notice(*mapped)
    status_messages = {
        401: ("login_required", "authExpired", "login"),
        404: ("not_found", "taskUnavailable", None),
        409: ("conflict", "conflict", None),
        429: ("rate_limited", "rate", "wait_for_user"),
    }
    if status in status_messages:
        return _notice(*status_messages[status])
    if isinstance(error, FileNotFoundError) or code == "ENOENT":
        return _notice("local_error", "localData")
    if isinstance(error, (SyntaxError, json.JSONDecodeError)):
        return _invalid()
    if re.match(r"^(历史|本地任务|任务暂不可用)", str(error)):
        return _notice("local_error", "localData")
    if re.match(r"^(图片|视频|素材|指定封面|不支持的|封面格式|目录)", str(error)):
        return _notice("invalid_input", "invalidMedia", "correct_input")
    return _notice("unavailable", "connectionMessage", "retry")
