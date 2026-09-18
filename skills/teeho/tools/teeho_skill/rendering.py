"""固定报告排版与仅使用本机快照的字段翻译。"""

import json
import math
import re
import unicodedata
from collections.abc import Callable
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Optional, Union
from uuid import uuid4

from .errors import TeehoError
from .engagement_display import engagement_tier
from .help_content import HELP_TEXTS, HELP_TOPICS, feature_lines, help_lines
from .messages import CONTROL_CHARACTERS, ENGLISH, RADAR_METRICS, is_pictographic, safe_text
from .storage import ensure_private_directory, write_json
from .points_display import points_lines, report_points_line
from .radar import radar_plot
from .content_analysis import content_analysis_lines
from .risk_matches import risk_match_lines
from .structure_metrics import project_structure_metrics, structure_metric_lines

PANEL_WIDTH = 40
COMPARISON_EXCERPT_LENGTH = 20
DIVIDER = "═" * PANEL_WIDTH
MAX_RECORDS = 64
MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
MAX_TRANSLATION_BYTES = 512 * 1024
MAX_TRANSLATION_LENGTH = 8000
PUBLIC_PRESENTATION_OWNER = "public"
RECORD_NAME = re.compile(r"[a-f0-9-]{36}\.json", re.IGNORECASE)
PRESENTATION_ID = re.compile(r"[a-f0-9-]{36}", re.IGNORECASE)
FORBIDDEN_TRANSLATION = re.compile(r"[\r\n`━─╱╲│▰▱]")
NUMBER_TEXT = re.compile(r"[0-9]+(?:\.[0-9]+)?")
URL_TEXT = re.compile(r"https?://\S+")
View = dict[str, Any]
Translate = Callable[[str], str]


def _translations_object(value: object) -> dict[str, object]:
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_TRANSLATION_BYTES:
            return {}
        try:
            value = json.loads(value)
        except (ValueError, RecursionError):
            return {}
    return value if isinstance(value, dict) else {}


def _translated(source: str, value: object) -> Optional[str]:
    if (
        not isinstance(value, str)
        or not value.strip()
        or len(value) > MAX_TRANSLATION_LENGTH
    ):
        return None
    if CONTROL_CHARACTERS.search(value) or FORBIDDEN_TRANSLATION.search(value):
        return None
    if any(is_pictographic(character) for character in value):
        return None
    if sorted(NUMBER_TEXT.findall(source)) != sorted(NUMBER_TEXT.findall(value)):
        return None
    if sorted(URL_TEXT.findall(source)) != sorted(URL_TEXT.findall(value)):
        return None
    return safe_text(value)


def _banner(title: str) -> list[str]:
    return [
        title,
    ]


def _fixed(value: Union[int, float]) -> str:
    return str(
        Decimal.from_float(float(value)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
    )


def _plain_number(value: Union[int, float]) -> str:
    return str(int(value)) if value == int(value) else str(value)


def _radar(data: View, translate: Translate) -> list[str]:
    scores = data["scores"]
    icons = ("🎯", "🖼️", "📝", "📖", "💬", "⏱️")
    labels = [
        f"{icons[index]} {translate(key)}"
        for index, key in enumerate(RADAR_METRICS)
    ]
    values = ["—" if score is None else _fixed(score) for score in scores]
    if sum(score is None for score in scores) >= 3:
        maximum = 10
        return [
            translate("radarInsufficient"),
            "",
            *[
                f"{label}: {value}" + (f" / {maximum}" if score is not None else "")
                for label, value, score in zip(labels, values, scores)
            ],
        ]
    return [
        labels[0].center(35),
        values[0].center(35),
        *_radar_label_pair(labels[5], labels[1]),
        *_radar_label_pair(values[5], values[1]),
        *radar_plot(scores),
        *_radar_label_pair(labels[4], labels[2]),
        *_radar_label_pair(values[4], values[2]),
        labels[3].center(35),
        values[3].center(35),
    ]


def _text_width(text: str) -> int:
    return sum(
        (
            0
            if unicodedata.combining(char) or char in ("\ufe0f", "\u200d")
            else (
                2
                if is_pictographic(char)
                or unicodedata.east_asian_width(char) in ("W", "F")
                else 1
            )
        )
        for char in text
    )


def _radar_label_pair(left: str, right: str) -> list[str]:
    column_width, left_center, right_center = 14, 9, 25

    def wrap(text: str) -> list[str]:
        rows, line = [], ""
        for char in text:
            if _text_width(line + char) > column_width:
                rows, line = [*rows, line], ""
            line += char
        return [*rows, line]

    left_rows, right_rows = wrap(left), wrap(right)
    result = []
    for index in range(max(len(left_rows), len(right_rows))):
        first = left_rows[index] if index < len(left_rows) else ""
        second = right_rows[index] if index < len(right_rows) else ""
        prefix = " " * (left_center - _text_width(first) // 2) + first
        gap = right_center - _text_width(second) // 2 - _text_width(prefix)
        result = [*result, (prefix + " " * gap + second).rstrip()]
    return result


def _billing_lines(data: Optional[View], translate: Translate) -> list[str]:
    if not data or data.get("message") != "charged" or data.get("price") is None:
        return []
    price = (
        []
        if data["price"] is None
        else [translate("actualCharge") + ": " + _plain_number(data["price"])]
    )
    return price


def _field(label: str, value: object) -> str:
    if type(value) in (int, float):
        value = _plain_number(value)
    return f"• {label}: {value}"


def _section(label: str, translate: Translate, icon: str = "") -> list[str]:
    return ["", DIVIDER, "", "【" + icon + translate(label) + "】", ""]


def _comparison_lines(note: View, translate: Translate) -> list[str]:
    counts = [
        translate(key) + ": " + (engagement_tier(key, note.get(key)) or translate("rapidGrowth"))
        for key in ("likes", "collects", "comments")
    ]
    return [
        "📕 " + note["title"],
        note["excerpt"][:COMPARISON_EXCERPT_LENGTH]
        + ("..." if len(note["excerpt"]) > COMPARISON_EXCERPT_LENGTH else ""),
        note["url"] or translate("missingNoteUrl"),
        " · ".join(counts),
        translate("selectionReason") + ": " + translate(note.get("selectionReason", "rapid_growth")),
        "",
    ]


def _insight_lines(data: View, translate: Translate) -> list[str]:
    comparison_icon = {"above": "🟩", "near": "⬜", "below": "🟥"}.get(data.get("comparison"), "")
    score = (
        _fixed(data["score"]) + " / 10"
        if data["score"] is not None
        else translate("unavailable")
    )
    rows = [
        "🎯 "
        + translate(
            "average" if data.get("scoreSource") == "radar_average" else "insight"
        )
        + ": "
        + score
        + (" " + comparison_icon if comparison_icon and data["score"] is not None else "")
    ]
    reference = data.get("scoreReference")
    if data.get("scoreSource") != "radar_average":
        rows.extend(
            [
                translate(label) + ": " + (
                    _fixed(reference[key])
                    if reference and reference.get(key) is not None
                    else translate("unavailable")
                )
                for key, label in (
                    ("median", "referenceMedian"),
                    ("max", "referenceMax"),
                    ("min", "referenceMin"),
                )
            ]
        )
    return rows


# 雷达评分校准期间暂时隐藏展示，保留数据和绘图逻辑。
SHOW_RADAR_REPORT = False


def _report_heading(data: View, translate: Translate) -> list[str]:
    radar = _radar(data, translate) if SHOW_RADAR_REPORT else []
    return [
        *_banner("🔥 " + translate("brand") + " · " + translate("checkup")),
        report_points_line(data.get("remainingPoints"), translate),
        "",
        "【" + translate("historical" if data["historical"] else "complete") + "】",
        "",
        *_insight_lines(data, translate),
        *([*_section("radar", translate, "📊 "), *radar] if radar else []),
    ]


def _report_lines(view: View, translate: Translate) -> list[str]:
    data = view["data"]
    rows = _report_heading(data, translate)
    for item in data.get("customMetrics", []):
        value = (
            str(item["value"]) + (" " + item["unit"] if item["unit"] else "")
            if item["status"] == "available"
            else translate("unavailable")
        )
        rows.extend(["", item["name"] + ": " + value, item["description"]])
    rows.extend(_section("contentAnalysis", translate))
    rows.extend(content_analysis_lines(data, translate))
    rows.extend(["", "⚠️ " + translate("contentTermRisks")])
    rows.extend(risk_match_lines(data, translate))
    rows.extend(_section("differences", translate))
    rows.extend(structure_metric_lines(
        data.get("structureMetrics", project_structure_metrics({})), translate, _plain_number,
    ))
    if data["comparisons"]:
        rows.extend(_section("comparable", translate))
        rows.extend(
            line
            for note in data["comparisons"]
            for line in _comparison_lines(note, translate)
        )
    return [
        *rows,
        "",
        *[
            _field(translate(kind), safe_text(path))
            for kind, paths in (
                ("cover", [data.get("localMedia", {}).get("cover")]),
                ("images", data.get("localMedia", {}).get("images", [])),
                ("video", [data.get("localMedia", {}).get("video")]),
            )
            for path in paths if path
        ],
        *_billing_lines(data["billing"], translate),
        *(["\U0001f4c1 " + translate("saved")] if data["saved"] else []),
    ]


def _summary_lines(data: View, translate: Translate) -> list[str]:
    return [
        *(
            ["⚠️ " + translate("anonymous"), translate("loginHint"), ""]
            if data["anonymous"]
            else []
        ),
        "🔥 " + translate("summary"),
        "",
        *[_field(translate(key), data[key]) for key in ("title", "body", "topics")],
        _field(
            translate("images"),
            translate("unavailable") if data["images"] is None else data["images"],
        ),
        _field(translate("video"), data["video"] or translate("none")),
        _field(translate("cover"), data["cover"] or translate("none")),
        *(["⚠️ " + translate("mediaWarning")] if not data["cover"] and not data["video"] else []),
        *(
            [translate("ignored") + ": " + ", ".join(data["ignored"])]
            if data["ignored"]
            else []
        ),
        "",
        "⏳ " + translate("upload"),
    ]


def _identity_lines(view: View, translate: Translate) -> list[str]:
    data, kind = view["data"], view["kind"]
    if kind == "authorization":
        return [
            "🔐 " + translate("login"),
            "",
            _field(translate("authorizationUrl"), data["url"]),
            _field(translate("authorizationCode"), data["code"]),
            "",
            translate("loginInstructions"),
        ]
    if kind == "onboarding":
        return [
            "✅ " + translate("loginSuccess"),
            *(
                ["⚠️ " + translate("anonymous"), translate("loginHint")]
                if data["anonymous"]
                else []
            ),
            _field(
                translate("expires"),
                (
                    translate("persistent")
                    if data["expiresAt"] is None
                    else data["expiresAt"]
                ),
            ),
            "",
            translate("rules"),
            "",
            *feature_lines(translate),
        ]
    balances = (
        [
            translate(key)
            + ": "
            + (translate("unavailable") if value is None else _plain_number(value))
            for key, value in data["balances"].items()
        ]
        if data["enabled"]
        else []
    )
    return [
        "📋 " + translate("status"),
        translate("identity")
        + ": "
        + translate("anonymousAccount" if data["anonymous"] else "formalAccount"),
        *([data["email"]] if data["email"] else []),
        *(balances if data["enabled"] else [translate("billingDisabled")]),
    ]


def _notice_lines(view: View, translate: Translate) -> list[str]:
    data, state = view["data"], view["state"]
    headings = {
        "failed": "taskFailed",
        "processing": "processing",
        "unavailable": "connection",
        "authorization_pending": "pendingAuth",
    }
    heading = headings.get(state, "error")
    if state in ("ready", "cleared", "signed_out", "cancelled"):
        heading = data["message"]
    icon = (
        "✅"
        if state in ("ready", "cleared", "signed_out")
        else (
            "⏳"
            if state in ("processing", "preparing", "authorization_pending")
            else "❌"
        )
    )
    return [
        icon + " " + translate(heading),
        DIVIDER,
        "",
        translate(data["message"]),
        *_billing_lines(data.get("billing"), translate),
    ]


def _render_lines(view: View, translate: Translate) -> list[str]:
    data, kind = view["data"], view["kind"]
    if kind == "help":
        return help_lines(data.get("topic"), translate)
    if kind == "report":
        return _report_lines(view, translate)
    if kind in ("authorization", "onboarding", "status"):
        return _identity_lines(view, translate)
    if kind == "summary":
        return _summary_lines(data, translate)
    if kind == "installation":
        return [
            *_banner("🔥 " + translate("usage")),
            "",
            DIVIDER,
            "",
            translate("usageRequest"),
            "",
            *[
                _field(translate(key), translate("example" + key.title()))
                for key in ("title", "body", "topics")
            ],
            "",
            translate("usageMedia"),
            translate("usageIdentity"),
        ]
    if kind == "history":
        rows = [
            line
            for index, row in enumerate(data["records"])
            for line in (f'[{index + 1}] {translate(row["summary"])}', row["savedAt"])
        ]
        return [
            "📁 " + translate("history"),
            *(rows if data["records"] else [translate("emptyHistory")]),
        ]
    if kind == "inspect":
        directories = data.get("directories", [])
        directory_lines = ["• " + path for path in directories] if directories else []
        directory_prompt = (
            bool(directories)
            and not data["files"]
            and data["images"] == 0
            and data["videos"] == 0
        )
        return [
            "📁 " + translate("inspect"),
            translate("images")
            + ": "
            + ("null" if data["images"] is None else _plain_number(data["images"])),
            translate("video")
            + ": "
            + ("null" if data["videos"] is None else _plain_number(data["videos"])),
            *["• " + path for path in data["files"]],
            *(
                [translate("selectSubdirectory"), *directory_lines]
                if directory_prompt
                else []
            ),
            *(
                [translate("selectNote")]
                if view["nextAction"] == "select_note" and not directory_prompt
                else []
            ),
        ]
    return _notice_lines(view, translate)


def _source(view: View, key: str) -> str:
    return view["texts"].get(
        key, HELP_TEXTS.get(key, ENGLISH.get(key, ENGLISH["noInformation"]))
    )


def _render(view: View, translations: object = None) -> tuple[str, tuple[str, ...]]:
    overrides = _translations_object(translations)
    used: tuple[str, ...] = ()

    def translate(key: str) -> str:
        nonlocal used
        used = used if key in used else (*used, key)
        source = _source(view, key)
        return (
            (_translated(source, overrides[key]) or source)
            if key in overrides
            else source
        )

    body = "\n".join(_render_lines(view, translate))
    return _with_points(body, view, translate), used


def _with_points(body: str, view: View, translate: Translate) -> str:
    if view["kind"] == "report":
        return body
    snapshot = view["data"].get("remainingPoints")
    if snapshot and snapshot.get("enabled") is False:
        return body
    return (
        body + "\n" + "\n".join(points_lines(snapshot, translate)) if snapshot else body
    )


def render_presentation(view: View, translations: object = None) -> str:
    """翻译允许的文字字段，保留布局、链接、数字与操作状态。"""
    return _render(view, translations)[0]


def _validate_view(value: object) -> View:
    if not isinstance(value, dict) or not isinstance(value.get("state"), str):
        raise TeehoError("invalid_input")
    if not isinstance(value.get("data"), dict) or not isinstance(
        value.get("texts"), dict
    ):
        raise TeehoError("invalid_input")
    if not all(
        isinstance(key, str) and isinstance(text, str)
        for key, text in value["texts"].items()
    ):
        raise TeehoError("invalid_input")
    if value.get("kind") not in (
        "report",
        "authorization",
        "onboarding",
        "summary",
        "status",
        "installation",
        "history",
        "inspect",
        "notice",
        "help",
    ):
        raise TeehoError("invalid_input")
    if value.get("nextAction") is not None and not isinstance(
        value.get("nextAction"), str
    ):
        raise TeehoError("invalid_input")
    try:
        render_presentation(value)
    except (KeyError, TypeError, ValueError, AttributeError, IndexError) as error:
        raise TeehoError("invalid_input") from error
    return value


class PresentationStore:
    """按账号隔离公开展示快照；重渲染从不调用业务接口。"""

    def __init__(self, root: Union[str, Path], owner: Optional[str] = None) -> None:
        if owner is not None and (
            not isinstance(owner, str)
            or not re.fullmatch(r"[a-z0-9-]{1,80}", owner, re.IGNORECASE)
        ):
            raise TeehoError("invalid_input")
        self.root = Path(root) / "presentations" / (owner or "guest")

    def has_snapshot(self, presentation_id: object) -> bool:
        """仅检查合法标识对应的普通快照文件，不读取其内容。"""
        if not isinstance(presentation_id, str) or not PRESENTATION_ID.fullmatch(
            presentation_id
        ):
            return False
        path = self.root / (presentation_id + ".json")
        return not path.is_symlink() and path.is_file()

    def publish(self, view: View, tools_data: object = None) -> View:
        """写入公开快照并返回展示信封。"""
        _validate_view(view)
        if (
            len(json.dumps(view, ensure_ascii=False).encode("utf-8"))
            > MAX_SNAPSHOT_BYTES
        ):
            raise TeehoError("invalid_input")
        presentation_id = str(uuid4())
        ensure_private_directory(self.root)
        self.prune()
        write_json(self.root / (presentation_id + ".json"), view)
        return self.envelope(presentation_id, view, tools_data=tools_data)

    def envelope(
        self,
        presentation_id: Optional[str],
        view: View,
        translations: object = None,
        tools_data: object = None,
    ) -> View:
        """仅公开模板用到的可翻译字段和安全业务标识。"""
        display_text, used = _render(view, translations)
        overrides = _translations_object(translations)
        translated_count = sum(
            key in overrides
            and _translated(_source(view, key), overrides[key]) is not None
            for key in used
        )
        data = view["data"]
        # 安装验证字段来自已校验的公开视图，翻译和跨进程重渲染不能丢失。
        if tools_data is None and view["state"] == "ready":
            if view["kind"] == "help":
                tools_data = {"topics": [topic.id for topic in HELP_TOPICS]}
            elif view["kind"] == "installation":
                tools_data = {"configured": True, "apiUrl": data["url"]}
        return {
            **(
                {
                    "translationStats": {
                        "translated": translated_count,
                        "fallback": len(used) - translated_count,
                    }
                }
                if translations is not None
                else {}
            ),
            "state": view["state"],
            "displayText": display_text,
            "delivery": {
                "mode": "render_required" if translations is None else "verbatim",
                **({"command": "render"} if translations is None else {}),
                "field": "displayText",
                "format": "text_code_block",
                "language": "text",
            },
            "nextAction": view["nextAction"],
            "presentationId": presentation_id,
            "translation": {"fields": {key: _source(view, key) for key in used}},
            **({"taskId": data["taskId"]} if data.get("taskId") else {}),
            **({"pollAfterMs": data["interval"]} if data.get("interval") else {}),
            **(
                {
                    "reports": [
                        {"taskId": row["id"], "savedAt": row["savedAt"]}
                        for row in data["records"]
                    ]
                }
                if view["kind"] == "history"
                else {}
            ),
            **({"toolsData": tools_data} if tools_data else {}),
        }

    def render(self, presentation_id: str, translations: object = None) -> View:
        """读取指定账号的现有快照后重渲染。"""
        if not isinstance(presentation_id, str) or not PRESENTATION_ID.fullmatch(
            presentation_id
        ):
            raise TeehoError("invalid_input")
        path = self.root / (presentation_id + ".json")
        if path.is_symlink():
            raise TeehoError("invalid_input")
        with path.open("rb") as stream:
            data = stream.read(MAX_SNAPSHOT_BYTES + 1)
        if len(data) > MAX_SNAPSHOT_BYTES:
            raise TeehoError("invalid_input")
        try:
            view = _validate_view(json.loads(data.decode("utf-8")))
        except (ValueError, RecursionError) as error:
            raise TeehoError("invalid_input") from error
        return self.envelope(
            presentation_id, view, {} if translations is None else translations
        )

    def _records(self) -> list[Path]:
        try:
            return sorted(
                path
                for path in self.root.iterdir()
                if RECORD_NAME.fullmatch(path.name)
                and not path.is_symlink()
                and path.is_file()
            )
        except FileNotFoundError:
            return []

    def prune(self) -> None:
        """只修剪展示缓存；保留身份与历史。"""
        records = self._records()
        for path in records[: max(0, len(records) - MAX_RECORDS + 1)]:
            path.unlink()

    def clear(self) -> None:
        """仅删除当前账号目录内的已知普通快照文件。"""
        for path in self._records():
            path.unlink()
