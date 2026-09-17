"""面向用户的六项功能与用法；编号和结构由程序生成。"""

from collections.abc import Callable
from dataclasses import dataclass
from types import MappingProxyType
from typing import Optional

from .errors import TeehoError


@dataclass(frozen=True)
class HelpTopic:
    id: str
    marker: str
    action: str
    title: str
    steps: tuple[str, ...]
    examples: tuple[str, ...]


HELP_TOPICS = (
    HelpTopic(
        "account",
        "1️⃣",
        "helpExecute",
        "Sign in or out of your account",
        (
            "Ask to sign in to your Teeho account. Open the authorization link and complete authorization on the website.",
            "After authorization, Teeho checks the login result and continues your original request.",
            "Ask to sign out to end the current account authorization. Local reports are kept.",
        ),
        ("Sign in to my Teeho account.", "Sign out of my Teeho account."),
    ),
    HelpTopic(
        "diagnose",
        "2️⃣",
        "helpExecute",
        "Run a note diagnosis",
        (
            "Provide the existing note title, topics and a cover image. The body is optional. Add the prepared images or video, or select a folder of materials.",
            "For a note read from a file or folder, your Agent first shows the complete note and selected material paths for your confirmation. Uploading and diagnosis begin only after confirmation. A complete note entered directly in chat can be diagnosed immediately when requested.",
            "Ask to diagnose the note. Teeho shows the submitted materials and checks the task until the result is ready or the automatic waiting window ends.",
            "A new diagnosis is billed separately. Teeho analyzes existing notes without ghostwriting or rewriting them.",
        ),
        (
            "Diagnose this note using the title, body and topics below.",
            "Diagnose the note in this folder.",
        ),
    ),
    HelpTopic(
        "task",
        "3️⃣",
        "helpView",
        "Diagnosis progress and results",
        (
            "Ask to check your current diagnosis, or specify the task you want to view.",
            "Teeho queries the existing task and returns its progress or full result. Checking a task does not submit a new diagnosis. Use history to read saved reports locally.",
        ),
        ("Check the diagnosis progress.", "Show the analysis result."),
    ),
    HelpTopic(
        "status",
        "4️⃣",
        "helpView",
        "Account information and credits",
        (
            "Ask to view the current account and its remaining credits.",
            "Teeho shows the account type and available daily, monthly and purchased credits when credit billing is enabled.",
        ),
        ("Show my Teeho account information.", "How many credits do I have left?"),
    ),
    HelpTopic(
        "history",
        "5️⃣",
        "helpView",
        "Past analysis results",
        (
            "List this machine's public anonymous reports together with the current account's private reports, then choose a report to read in full. Anonymous reports are stored as plain text and readable by all system users, even without signing in.",
            "Reading saved history is local and does not contact the server or run a new diagnosis. Formal account reports remain separate; sign in to the relevant account to view them.",
        ),
        ("Show my past analysis results.", "Open this saved report."),
    ),
    HelpTopic(
        "help",
        "6️⃣",
        "helpView",
        "Teeho help",
        (
            "Ask what Teeho can do to see the feature list, or name a feature to read its usage and request examples.",
            "Asking how to use a feature only shows help. Ask to perform the action when you are ready.",
        ),
        ("What can Teeho do?", "How do I sign in or out?", "How do I diagnose a note?"),
    ),
)
TOPICS_BY_ID = MappingProxyType({topic.id: topic for topic in HELP_TOPICS})
HELP_TEXTS = MappingProxyType(
    {
        "helpFeatures": "All Teeho features",
        "helpTitle": "Teeho help",
        "helpExecute": "Execute",
        "helpView": "View",
        "helpUsage": "How to use",
        "helpExamples": "You can say",
        "helpTopicInvalid": "Choose a feature from Teeho help to view its usage.",
        **{f"help_{topic.id}_title": topic.title for topic in HELP_TOPICS},
        **{
            f"help_{topic.id}_{group}_{index}": text
            for topic in HELP_TOPICS
            for group, values in (("step", topic.steps), ("example", topic.examples))
            for index, text in enumerate(values)
        },
    }
)


def resolve_help_topic(value: object) -> Optional[HelpTopic]:
    """只允许总览或固定的功能主题，不将输入当作命令或路径。"""
    if value is None:
        return None
    if not isinstance(value, str) or value not in TOPICS_BY_ID:
        raise TeehoError("invalid_help_topic")
    return TOPICS_BY_ID[value]


def help_result(value: object) -> dict[str, object]:
    """校验帮助请求；省略 topic 返回总览。"""
    if not isinstance(value, dict) or set(value) - {"topic"}:
        raise TeehoError("invalid_help_topic")
    if "topic" in value and value["topic"] is None:
        raise TeehoError("invalid_help_topic")
    topic = resolve_help_topic(value.get("topic"))
    return {"topic": topic.id if topic else None}


def feature_line(topic: HelpTopic, translate: Callable[[str], str]) -> str:
    """编号、行数与分隔符固定，仅翻译动作和功能名。"""
    return f"{topic.marker} {translate(topic.action)} - {translate(f'help_{topic.id}_title')}"


def feature_lines(translate: Callable[[str], str]) -> list[str]:
    """帮助总览和登录结果共用同一份功能列表。"""
    return [
        "🔥 " + translate("helpFeatures"),
        "",
        *[feature_line(topic, translate) for topic in HELP_TOPICS],
    ]


def help_lines(value: object, translate: Callable[[str], str]) -> list[str]:
    """返回功能总览或单项用法，不执行业务操作。"""
    topic = resolve_help_topic(value)
    if topic is None:
        return feature_lines(translate)
    return [
        "🔥 " + translate("helpTitle"),
        "",
        feature_line(topic, translate),
        "",
        translate("helpUsage"),
        *[
            "• " + translate(f"help_{topic.id}_step_{i}")
            for i in range(len(topic.steps))
        ],
        "",
        translate("helpExamples"),
        *[
            "• " + translate(f"help_{topic.id}_example_{i}")
            for i in range(len(topic.examples))
        ],
    ]
