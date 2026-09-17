"""命令装配与逐行 JSON 输出；不定义业务接口地址。"""

import argparse
import hashlib
import json
import stat
import sys
from pathlib import Path
from typing import BinaryIO, Optional

from .api import TeehoApi
from .auth import AuthSession
from .config import read_installation
from .constants import MAX_INPUT_BYTES
from .debug import DebugLogger, command_log_level
from .diagnosis import DiagnosisTools
from .errors import TeehoError
from .help_content import HELP_TOPICS, help_result
from .history import HistoryTools
from .public_history import clear_public_owner, publish_anonymous_history, visible_history, visible_report
from .http_transport import HttpTransport
from .note import normalize_note, require_id
from .presentation import create_error_presentation, create_presentation
from .points_display import points_snapshot
from .rendering import PUBLIC_PRESENTATION_OWNER, PresentationStore, render_presentation

FEATURES = (
    "login",
    "anonymous",
    "login-status",
    "logout",
    "status",
    "help",
    "installation",
    "config",
    "inspect",
    "diagnose",
    "resume",
    "task",
    "wait",
    "history",
    "clear-history",
    "clear-identity",
    "render",
)
INPUT_COMMANDS = frozenset(
    {
        "inspect",
        "diagnose",
        "task",
        "wait",
        "history",
        "clear-history",
        "clear-identity",
        "render",
    }
)
IDENTITY_COMMANDS = frozenset({"login", "anonymous", "login-status", "logout", "clear-identity"})
PUBLIC_PRESENTATION_COMMANDS = frozenset({"installation", "help"})


class _ArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise TeehoError("invalid_input")


def parse_arguments(argv: list[str]) -> tuple[str, Optional[str]]:
    """错误交由统一展示处理，argparse 不向 stdout 写帮助或退出。"""
    parser = _ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("command", nargs="?", default="help")
    parser.add_argument("--input-file")
    arguments = parser.parse_args(argv)
    if arguments.command not in FEATURES:
        raise TeehoError("unknown_command")
    if arguments.input_file is not None and (
        not arguments.input_file
        or (arguments.command not in INPUT_COMMANDS and arguments.command != "help")
    ):
        raise TeehoError("invalid_input")
    return arguments.command, arguments.input_file


def _reject_constant(value: str) -> None:
    raise ValueError("Non-finite JSON value")


def _object_pairs(pairs: list[tuple[str, object]]) -> dict:
    value = dict(pairs)
    if len(value) != len(pairs):
        raise ValueError("Duplicate JSON field")
    return value


def read_input(file_path: Optional[str], stdin: Optional[BinaryIO] = None) -> dict:
    """限制输入字节，统一解码 UTF-8，兼容 Windows UTF-8 BOM。"""
    source = stdin if stdin is not None else sys.stdin.buffer
    if file_path:
        path = Path(file_path)
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_INPUT_BYTES:
            raise TeehoError("input_too_large")
        with path.open("rb") as stream:
            data = stream.read(MAX_INPUT_BYTES + 1)
    else:
        if source.isatty():
            return {}
        data = source.read(MAX_INPUT_BYTES + 1)
    if len(data) > MAX_INPUT_BYTES:
        raise TeehoError("input_too_large")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise TeehoError("input_encoding_invalid") from error
    try:
        value = (
            json.loads(text, parse_constant=_reject_constant, object_pairs_hook=_object_pairs)
            if text.strip()
            else {}
        )
    except (ValueError, RecursionError) as error:
        raise TeehoError("invalid_input") from error
    if not isinstance(value, dict):
        raise TeehoError("invalid_input")
    return value


def _owner(identity: Optional[dict]) -> Optional[str]:
    user = identity.get("user") if isinstance(identity, dict) else None
    return user.get("id") if isinstance(user, dict) else None


class CommandRunner:
    """集中拥有命令输出；展示故障不重复业务请求。"""

    def __init__(self) -> None:
        self.debug = DebugLogger(Path.cwd(), enabled=False)
        self.store = None
        self.final_state = "starting"
        self.anonymous_reminder_shown = False
        self.identity = None

    def output(self, view: dict, tools_data: Optional[dict] = None) -> None:
        """发布展示快照，缓存失败时仍交付已确定的业务结果。"""
        self.final_state = view["state"]
        envelope = None
        try:
            if self.store:
                envelope = self.store.publish(view, tools_data=tools_data)
        except (OSError, TeehoError, ValueError):
            self.debug.log(
                "presentation_cache_failed",
                {"stage": "cache", "errorCode": "cache_error"},
                "warn",
            )
        if envelope is None:
            task_id = view.get("data", {}).get("taskId")
            envelope = {
                "state": view["state"],
                "displayText": render_presentation(view),
                "delivery": {
                    "mode": "verbatim",
                    "field": "displayText",
                    "format": "text_code_block",
                },
                "nextAction": view["nextAction"],
                "translationAvailable": False,
                **({"taskId": task_id} if task_id else {}),
                **({"toolsData": tools_data} if tools_data is not None else {}),
            }
        self.debug.output(envelope, view["kind"])
        self._write(envelope)

    def _write(self, envelope: dict) -> None:
        self.final_state = envelope["state"]
        sys.stdout.write(json.dumps(envelope, ensure_ascii=False, allow_nan=False) + "\n")
        sys.stdout.flush()

    def _configure(self) -> None:
        config = read_installation()
        self.debug = DebugLogger(config.root, enabled=config.debug)
        transport = HttpTransport(log=self.debug)
        public_api = TeehoApi(config.base_url, transport)
        self.auth = AuthSession(config.root, public_api, config.base_url, log=self.debug.log)
        self.api = TeehoApi(config.base_url, transport, authorize=self.auth.authorized)
        self.config = config

    def _fingerprint(self) -> None:
        if not self.config.debug:
            return
        try:
            root = Path(__file__).resolve().parent.parent
            paths = sorted(root.rglob("*.py"))
            digest = hashlib.sha256()
            for path in paths:
                digest.update(path.relative_to(root).as_posix().encode("utf-8"))
                digest.update(path.read_bytes())
            self.debug.log("scripts_loaded", {"scriptHash": digest.hexdigest()})
        except OSError:
            self.debug.log("script_fingerprint_unavailable", {}, "warn")

    def _initialize_identity(self, command: str, value: dict) -> None:
        public_store = PresentationStore(
            self.auth.root, owner=PUBLIC_PRESENTATION_OWNER
        )
        if command in PUBLIC_PRESENTATION_COMMANDS or (
            command == "render"
            and public_store.has_snapshot(value.get("presentationId"))
        ):
            self.store = public_store
            return
        self.identity = self.auth.read_identity()
        self.debug.log(
            "identity_checked",
            {
                "anonymous": bool(
                    self.identity and self.identity.get("user", {}).get("isAnonymous")
                ),
                "state": "authenticated" if _owner(self.identity) else "unsigned",
            },
        )
        self.store = PresentationStore(self.auth.root, owner=_owner(self.identity))
        if command != "diagnose" or _owner(self.identity):
            return
        if (
            self.identity
            and self.identity.get("challenge")
            and not self.identity.get("anonymousPending")
        ):
            raise TeehoError("authorization_pending")
        self.debug.log("diagnosis_identity_initializing", {"stage": "anonymous"})
        result = self.auth.anonymous()
        self.identity = self.auth.read_identity()
        self.store = PresentationStore(self.auth.root, owner=_owner(self.identity))
        self.output(create_presentation("anonymous", result))
        self.anonymous_reminder_shown = True

    def _summary(self, event: dict) -> None:
        anonymous = bool(self.identity and self.identity.get("user", {}).get("isAnonymous"))
        self.output(
            create_presentation(
                "task_summary",
                event,
                anonymous=anonymous and not self.anonymous_reminder_shown,
            )
        )

    def _history(self, command: str, value: dict) -> dict:
        owner = _owner(self.identity)
        publish_anonymous_history(self.auth.root, self.identity)
        if command == "clear-history":
            history = HistoryTools(self.auth.root, require_id(owner, "login_required"))
            result = history.clear(value.get("confirmed"))
            if (self.identity or {}).get("user", {}).get("isAnonymous") is True:
                clear_public_owner(owner)
            self.store.clear()
            return result
        if value.get("taskId"):
            report = visible_report(self.auth.root, owner, value["taskId"])
            return {
                "task": report["task"],
                "saved": True,
                "localMedia": report.get("localMedia"),
            }
        return {"history": visible_history(self.auth.root, owner)}

    def _task(self, command: str, value: dict, diagnosis: DiagnosisTools) -> dict:
        resumed = None if value.get("taskId") else diagnosis.resume()
        task_id = value.get("taskId") or (resumed or {}).get("task", {}).get("id")
        if not task_id:
            return resumed
        return diagnosis.wait(task_id) if command == "wait" else diagnosis.task(task_id)

    def _status(self) -> dict:
        owner = require_id(_owner(self.identity), "login_required")
        summary = self.api.get_points(expected_user_id=owner)
        return {**summary, "user": self.identity["user"]}

    def _remaining_points(self, command: str, view: dict) -> dict:
        if command not in ("diagnose", "task", "wait", "resume"):
            return view
        if view["state"] not in ("completed", "failed", "cancelled", "insufficient_credits"):
            return view
        if not view["data"].get("taskId"):
            return view
        try:
            owner = require_id(_owner(self.identity), "login_required")
            points = points_snapshot(self.api.get_points(expected_user_id=owner))
        except (TeehoError, OSError, ValueError):
            self.debug.log("remaining_points_unavailable", {"stage": "points"}, "warn")
            points = {"unavailable": True}
        return {**view, "data": {**view["data"], "remainingPoints": points}}

    def _dispatch(self, command: str, value: dict) -> tuple[dict, Optional[dict]]:
        diagnosis = DiagnosisTools(
            self.api,
            self.auth,
            emit=self._summary,
            log=self.debug.log,
            expected_user_id=_owner(self.identity),
        )
        actions = {
            "login": self.auth.login,
            "anonymous": self.auth.anonymous,
            "login-status": self.auth.complete_login,
            "logout": self.auth.logout,
            "clear-identity": lambda: self.auth.clear_identity(value.get("confirmed")),
            "status": self._status,
            "diagnose": lambda: diagnosis.diagnose(value),
            "resume": diagnosis.resume,
        }
        if command in actions:
            return actions[command](), None
        if command in ("history", "clear-history"):
            return self._history(command, value), None
        if command in ("task", "wait"):
            return self._task(command, value, diagnosis), None
        if command == "inspect":
            result = diagnosis.inspect(value.get("directory"))
            return result, result
        if command == "config":
            result = self.api.get_task_config()
            tracks = result.get("config", {}).get("tracks", [])
            data = {
                "tracks": [
                    {key: track.get(key) for key in ("id", "name", "labelKey", "enabled")}
                    for track in tracks
                    if isinstance(track, dict)
                ]
            }
            return result, data
        if command == "installation":
            result = {"apiUrl": self.config.base_url, "configured": True}
            return result, result
        return help_result(value), {"topics": [topic.id for topic in HELP_TOPICS]}

    def _render(self, value: dict) -> None:
        envelope = self.store.render(value.get("presentationId"), value.get("translations"))
        stats = envelope.get("translationStats", {})
        self.debug.log(
            "translation_rendered",
            {
                "presentationId": envelope.get("presentationId"),
                "translatedFields": stats.get("translated", 0),
                "fallbackFields": stats.get("fallback", 0),
            },
            "warn" if stats.get("fallback", 0) > 0 else "debug",
        )
        self.debug.output(envelope, "translation")
        self._write(envelope)

    def run(self, argv: list[str]) -> int:
        """处理一次命令，所有已知失败使用统一安全信封。"""
        exit_code = 1
        try:
            self._configure()
            command, file_path = parse_arguments(argv)
            self.debug.log("command_started", {"command": command}, "info")
            self._fingerprint()
            value = read_input(file_path) if command in INPUT_COMMANDS or file_path else {}
            if command == "diagnose":
                normalize_note(value)
                self._log_input(value)
            self._initialize_identity(command, value)
            if command == "render":
                self._render(value)
                exit_code = 0
            else:
                result, data = self._dispatch(command, value)
                if command in IDENTITY_COMMANDS:
                    self.store = PresentationStore(
                        self.auth.root, owner=_owner(self.auth.read_identity())
                    )
                view = self._remaining_points(command, create_presentation(command, result))
                self.output(view, None if view["state"] == "invalid_response" else data)
                exit_code = int(view["state"] in ("invalid_response", "failed"))
        except BrokenPipeError:
            exit_code = 1
        except (Exception, KeyboardInterrupt) as error:
            self.output(create_error_presentation(error))
        finally:
            self.debug.log(
                "command_finished",
                {"exitCode": exit_code, "state": self.final_state},
                command_log_level(self.final_state),
            )
            self.debug.close()
        return exit_code

    def _log_input(self, value: dict) -> None:
        self.debug.log(
            "input_read",
            {
                "titleCharacters": len(value["title"]),
                "bodyCharacters": len(value["body"]),
                "imageCount": len(value.get("images") or []),
                "videoCount": len(value.get("videos") or []),
                "topicCount": len(value["topics"]),
            },
        )


def main(argv: Optional[list[str]] = None) -> int:
    """CLI 的公开调用接口。"""
    return CommandRunner().run(sys.argv[1:] if argv is None else argv)
