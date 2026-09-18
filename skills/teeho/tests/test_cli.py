"""真实 Python 子进程通过本地 HTTP 验证公开命令契约。"""

import ast
import hashlib
import importlib.util
import inspect
import io
import json
import os
import re
import socket
import subprocess
import sys
import sysconfig
import tempfile
import threading
import typing
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from typing import Optional

from teeho_skill.cli import parse_arguments, read_input
from teeho_skill.constants import MAX_INPUT_BYTES
from teeho_skill.device import machine_identifier
from teeho_skill.errors import TeehoError
from teeho_skill.storage import read_json, write_json

TOOLS = Path(__file__).resolve().parents[1] / "tools"
ENTRY = TOOLS / "teeho.py"
OWNER = "00000000-0000-4000-8000-000000000001"
NOTE = {
    "title": "我的朋友",
    "body": "今天一起去电玩城玩游戏。",
    "topics": ["电玩城", "90后"],
}
PRIVATE_TOKEN = "SYNTHETIC_PRIVATE_ACCESS_TOKEN"
AUTHORIZATION_CODE = "ABCDE12345"


def is_stdlib_import(name: str) -> bool:
    """通过模块来源检查依赖，Python 3.9 不提供 sys.stdlib_module_names。"""
    if name in {"teeho_skill", "fcntl", "msvcrt", "winreg"}:
        return True
    spec = importlib.util.find_spec(name)
    if spec is None:
        return False
    if spec.origin in {"built-in", "frozen"}:
        return True
    if not spec.origin:
        return False
    origin = Path(spec.origin).resolve()
    if {part.lower() for part in origin.parts} & {"site-packages", "dist-packages"}:
        return False
    if origin.parent == Path(sys.base_prefix).resolve() and origin.suffix == ".pyd":
        return True
    roots = (
        sysconfig.get_path("stdlib"),
        sysconfig.get_path("platstdlib"),
        sysconfig.get_config_var("DESTSHARED"),
        Path(sys.base_prefix) / "DLLs",
        Path(os.__file__).parent,
    )
    return any(origin.is_relative_to(Path(root).resolve()) for root in roots if root)


class ApiFixture:
    def __init__(self) -> None:
        self.calls = []
        self.submissions = []
        self.tasks = {}
        self.mode = "normal"
        self.pending = False
        self.lose_submission = False
        self.anonymous = True

    def respond(self, path: str, body: dict) -> tuple[int, object]:
        if self.mode == "html":
            return 503, "PRIVATE_STACK"
        if self.mode == "malformed":
            return 200, {"arbitrary": "PRIVATE_STACK"}
        if path == "/api/skill/auth/start":
            return 200, {
                "verificationUrl": "https://example.test/authorize",
                "userCode": AUTHORIZATION_CODE,
                "interval": 5000,
            }
        if path == "/api/skill/auth/anonymous":
            return 200, {"user": {"id": OWNER, "isAnonymous": True}}
        if path == "/api/skill/auth/token":
            if self.pending:
                return 409, {"message": "PRIVATE_ERROR"}
            return 200, {
                "user": {
                    "id": OWNER,
                    "isAnonymous": self.anonymous,
                    "email": None if self.anonymous else "fixture@example.test",
                },
                "accessToken": PRIVATE_TOKEN,
                "accessExpiresAt": "2099-01-01T00:00:00Z",
                "expiresAt": None,
            }
        if path == "/api/skill/auth/logout":
            return 200, {"signedOut": True}
        if path == "/api/points/summary":
            return 200, {
                "summary": {
                    "enabled": False,
                    "balances": {
                        "free": 30,
                        "package": 0,
                        "purchased": 0,
                        "total": 30,
                    },
                    "pricing": [],
                }
            }
        if path == "/api/analysis/task-config":
            return 200, {"config": {"tracks": []}}
        if path == "/api/analysis/media/upload-sessions":
            return 200, {"session": {"assets": [{"id": "00000000-0000-4000-8000-000000000003", "uploadUrl": self.upload_root + "/upload"}]}}
        if path == "/api/analysis/media/statuses":
            return 200, {"assets": [{"id": identifier, "state": "ready"} for identifier in body['assetIds']]}
        if path.startswith('/api/analysis/media/') and path.endswith('/complete'):
            return 200, {"asset": {"id": path.split('/')[-2], "state": "ready"}}
        if path == "/api/analysis/tasks":
            self.submissions = self.submissions + [body]
            task = {"id": body["submissionId"], "status": "queued"}
            self.tasks = {**self.tasks, task["id"]: task}
            return 200, {"task": task}
        if path.startswith("/api/analysis/tasks/admissions/"):
            return 200, {"task": self.tasks.get(path.rsplit("/", 1)[-1])}
        if path.startswith("/api/analysis/tasks/"):
            return 200, {"task": self.tasks[path.rsplit("/", 1)[-1]]}
        return 404, {"message": "not found"}

    def handler(self) -> type[BaseHTTPRequestHandler]:
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                pass

            def do_PUT(self) -> None:
                self.rfile.read(int(self.headers.get('Content-Length', '0')))
                self.send_response(200)
                self.send_header('Content-Length', '0')
                self.end_headers()

            def do_GET(self) -> None:
                self.handle_request()

            def do_POST(self) -> None:
                self.handle_request()

            def handle_request(self) -> None:
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length)) if length else {}
                fixture.calls = fixture.calls + [self.path]
                status, data = fixture.respond(self.path, body)
                if self.path == "/api/analysis/tasks" and fixture.lose_submission:
                    fixture.lose_submission = False
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                    return
                payload = (
                    data
                    if isinstance(data, str)
                    else json.dumps(
                        {"code": 0 if status == 200 else status, "data": data},
                        ensure_ascii=False,
                    )
                )
                encoded = payload.encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

        return Handler


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="teeho-python-cli-")
        self.addCleanup(self.directory.cleanup)
        self.home = Path(self.directory.name)
        self.fixture = ApiFixture()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.fixture.handler())
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_port}/api"
        self.fixture.upload_root = f"http://127.0.0.1:{self.server.server_port}"
        cover = self.home / "cover.png"
        cover.write_bytes(b"synthetic-image")
        self.note = {**NOTE, "images": [str(cover)]}
        self.data_root = self.home / "servers" / hashlib.sha256(self.base.encode()).hexdigest()

    def run_cli(
        self, command: str, value: object = None, *, input_file: Optional[Path] = None
    ) -> tuple[int, list[dict], list[dict]]:
        data = (
            value
            if isinstance(value, bytes)
            else (
                json.dumps(value, ensure_ascii=False).encode("utf-8") if value is not None else b""
            )
        )
        result = subprocess.run(
            [sys.executable, "-B", "-S", "-X", "utf8", str(ENTRY), command]
            + (["--input-file", str(input_file)] if input_file else []),
            input=data,
            capture_output=True,
            timeout=15,
            cwd=self.home,
            env={
                **os.environ,
                "TEEHO_HOME": str(self.home),
                "TEEHO_API_URL": self.base,
                "TEEHO_PUBLIC_HISTORY_DIR": str(self.home / "public-history"),
            },
        )
        stdout, stderr = result.stdout.decode("utf-8"), result.stderr.decode("utf-8")
        self.assertTrue(stdout.strip(), stderr)
        lines = [json.loads(line) for line in stdout.splitlines()]
        logs = [json.loads(line) for line in stderr.splitlines()]
        self.assertNotIn(PRIVATE_TOKEN, stdout + stderr)
        return result.returncode, lines, logs

    def identity(self, anonymous: bool = True) -> None:
        write_json(
            self.data_root / "identity.json",
            {
                "baseUrl": self.base,
                "user": {"id": OWNER, "isAnonymous": anonymous},
                "deviceToken": "synthetic-device-token",
                "accessToken": PRIVATE_TOKEN,
                "accessExpiresAt": "2099-01-01T00:00:00Z",
            },
        )

    def test_help_installation_are_offline_and_do_not_read_credentials(self) -> None:
        self.data_root.mkdir(parents=True)
        (self.data_root / "identity.json").write_text("broken identity", encoding="utf-8")
        code, lines, logs = self.run_cli("help")
        self.assertEqual(code, 0)
        self.assertIn("All Teeho features", lines[0]["displayText"])
        self.assertEqual(lines[0]["toolsData"]["topics"], ["account", "diagnose", "task", "status", "history", "help"])
        self.assertFalse(any(log["event"] in ("identity_checked", "input_read") for log in logs))
        code, lines, _ = self.run_cli("installation")
        self.assertEqual(code, 0)
        self.assertEqual(lines[0]["toolsData"], {"apiUrl": self.base, "configured": True})
        self.assertIn("translation", lines[0])
        self.assertIn("Title:", lines[0]["displayText"])
        self.assertEqual(self.fixture.calls, [])

    def test_help_topics_and_render_are_offline_without_login_or_diagnosis(self) -> None:
        self.data_root.mkdir(parents=True)
        identity = self.data_root / "identity.json"
        identity.write_text("broken identity", encoding="utf-8")
        input_file = self.home / "help-input.json"
        for topic in ("account", "diagnose", "task", "status", "history", "help"):
            with self.subTest(topic=topic):
                input_file.write_text(json.dumps({"topic": topic}), encoding="utf-8")
                code, lines, logs = self.run_cli("help", input_file=input_file)
                self.assertEqual(code, 0, lines)
                self.assertIsNone(lines[0]["nextAction"])
                self.assertIn("You can say", lines[0]["displayText"])
                self.assertFalse(any(log["event"] == "identity_checked" for log in logs))
                original = lines[0]
                code, rendered, _ = self.run_cli("render", {
                    "presentationId": original["presentationId"],
                    "translations": original["translation"]["fields"],
                })
                self.assertEqual(code, 0, rendered)
                self.assertEqual(rendered[0]["displayText"], original["displayText"])
        input_file.write_text('{"topic":"PRIVATE_UNKNOWN_TOPIC"}', encoding="utf-8")
        code, lines, _ = self.run_cli("help", input_file=input_file)
        self.assertEqual(code, 1)
        self.assertEqual(lines[0]["state"], "invalid_input")
        self.assertEqual(lines[0]["nextAction"], "help")
        self.assertNotIn("PRIVATE_UNKNOWN_TOPIC", lines[0]["displayText"])
        self.assertEqual(identity.read_text(encoding="utf-8"), "broken identity")
        self.assertEqual(self.fixture.calls, [])

    def test_first_diagnosis_anonymous_utf8_bom_and_no_status_signup(self) -> None:
        if machine_identifier() is None:
            self.skipTest("Host exposes no supported stable device identifier")
        self.assertEqual(self.run_cli("status")[1][0]["state"], "login_required")
        damaged = self.run_cli("diagnose", {**NOTE, "title": "????"})
        self.assertEqual(damaged[1][0]["state"], "invalid_input")
        self.assertEqual(self.fixture.calls, [])
        file = self.home / "中文 input.json"
        file.write_bytes(b"\xff\xfe\x00")
        self.assertEqual(self.run_cli("diagnose", input_file=file)[1][0]["state"], "invalid_input")
        file.write_text(json.dumps(self.note, ensure_ascii=False), encoding="utf-8-sig")
        code, lines, logs = self.run_cli("diagnose", input_file=file)
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "processing")
        self.assertEqual(self.fixture.submissions[0]["fields"], NOTE)
        self.assertEqual(self.fixture.calls.count("/api/skill/auth/anonymous"), 1)
        self.assertEqual(
            sum("Using an anonymous account" in line["displayText"] for line in lines),
            1,
        )
        self.assertNotIn(NOTE["title"], json.dumps(logs, ensure_ascii=False))
        self.run_cli("status")
        self.assertEqual(self.fixture.calls.count("/api/skill/auth/anonymous"), 1)

    def test_task_failure_and_translation_do_not_resubmit_or_leak(self) -> None:
        self.identity()
        code, lines, logs = self.run_cli("diagnose", self.note)
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["nextAction"], "wait")
        self.assertIn("Using an anonymous account", lines[0]["displayText"])
        identifier = self.fixture.submissions[0]["submissionId"]
        self.fixture.tasks = {
            identifier: {
                "id": identifier,
                "status": "technical_failed",
                "pointCost": 15,
                "pointReservationStatus": "released",
                "failure": {"code": "SECRET_CODE", "message": "PRIVATE server failure"},
            }
        }
        code, lines, _ = self.run_cli("wait", {"taskId": identifier})
        self.assertEqual(code, 1)
        self.assertEqual(lines[0]["state"], "failed")
        self.assertIn("No credits were charged", lines[0]["displayText"])
        self.assertNotIn("Remaining credits", lines[0]["displayText"])
        self.assertNotIn("Credit billing is disabled", lines[0]["displayText"])
        self.assertNotRegex(json.dumps(lines), "SECRET_CODE|PRIVATE")
        requests = len(self.fixture.calls)
        translated = self.run_cli(
            "render",
            {
                "presentationId": lines[0]["presentationId"],
                "translations": {"taskFailed": "Analyse impossible"},
            },
        )
        self.assertIn("Analyse impossible", translated[1][0]["displayText"])
        self.assertEqual(len(self.fixture.calls), requests)
        self.assertEqual(len(self.fixture.submissions), 1)
        for event in ("api_response_parsed", "output_rendered", "scripts_loaded"):
            self.assertTrue(any(log["event"] == event for log in logs), event)

    def test_real_lost_response_recovers_in_next_process(self) -> None:
        self.identity()
        self.fixture.lose_submission = True
        self.assertEqual(self.run_cli("diagnose", self.note)[0], 1)
        pending = read_json(self.data_root / "accounts" / OWNER / "pending.json")
        self.assertTrue(pending["submitting"])
        code, lines, _ = self.run_cli("resume")
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["taskId"], pending["submissionId"])
        self.assertEqual(len(self.fixture.submissions), 1)

    def test_formal_authorization_pending_and_logging_levels(self) -> None:
        self.fixture.anonymous = False
        code, lines, _ = self.run_cli("login")
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[0]["state"], "authorization_pending")
        self.fixture.pending = True
        _, pending, logs = self.run_cli("login-status")
        self.assertEqual(pending[0]["state"], "authorization_pending")
        self.assertFalse(any(log["level"] in ("error", "warn") for log in logs))
        before = len(self.fixture.calls)
        self.assertEqual(self.run_cli("diagnose", self.note)[1][0]["state"], "authorization_pending")
        self.assertEqual(len(self.fixture.calls), before)
        self.fixture.mode = "html"
        _, _, failed_logs = self.run_cli("login-status")
        self.assertEqual(
            [log["event"] for log in failed_logs if log["level"] == "error"],
            ["command_finished"],
        )
        self.fixture.mode = "normal"
        self.fixture.pending = False
        self.assertEqual(self.run_cli("login-status")[1][0]["state"], "authenticated")
        self.assertEqual(self.run_cli("logout")[1][0]["state"], "signed_out")
        self.assertFalse((self.data_root / "identity.json").exists())

    def test_login_from_existing_account_can_render_in_next_process(self) -> None:
        self.identity()
        code, lines, _ = self.run_cli("login")
        self.assertEqual(code, 0)
        original = lines[0]
        fields = original["translation"]["fields"]
        self.assertNotIn(AUTHORIZATION_CODE, json.dumps(fields))
        translated_fields = {
            "login": "登录题火",
            "authorizationUrl": "授权地址",
            "authorizationCode": "授权码",
            "loginInstructions": "请在浏览器完成授权。",
        }
        self.assertEqual(set(fields), set(translated_fields))
        input_file = self.home / "render-input.json"
        input_file.write_text(
            json.dumps(
                {
                    "presentationId": original["presentationId"],
                    "translations": translated_fields,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        request_count = len(self.fixture.calls)
        code, rendered, _ = self.run_cli("render", input_file=input_file)
        self.assertEqual(code, 0, rendered)
        translated = rendered[0]
        self.assertIn("授权码: " + AUTHORIZATION_CODE, translated["displayText"])
        self.assertIn("https://example.test/authorize", translated["displayText"])
        self.assertTrue(translated["displayText"].startswith("🔐 登录题火\n\n"))
        for key in ("state", "nextAction", "pollAfterMs", "presentationId"):
            self.assertEqual(translated[key], original[key])
        self.assertEqual(translated["translationStats"]["fallback"], 0)
        self.assertEqual(len(self.fixture.calls), request_count)

    def test_public_presentations_render_without_reading_identity(self) -> None:
        self.data_root.mkdir(parents=True)
        identity_path = self.data_root / "identity.json"
        identity_path.write_text("broken identity", encoding="utf-8")
        for command in ("help", "installation"):
            with self.subTest(command=command):
                code, original, _ = self.run_cli(command)
                self.assertEqual(code, 0)
                fields = original[0]["translation"]["fields"]
                code, rendered, logs = self.run_cli(
                    "render",
                    {
                        "presentationId": original[0]["presentationId"],
                        "translations": fields,
                    },
                )
                self.assertEqual(code, 0, rendered)
                self.assertEqual(rendered[0]["displayText"], original[0]["displayText"])
                self.assertFalse(
                    any(log["event"] == "identity_checked" for log in logs)
                )
        self.assertEqual(identity_path.read_text(encoding="utf-8"), "broken identity")
        self.assertEqual(self.fixture.calls, [])

    def test_render_keeps_private_snapshot_with_original_account(self) -> None:
        self.identity()
        _, original, _ = self.run_cli("status")
        old_id = original[0]["presentationId"]
        identity = read_json(self.data_root / "identity.json")
        write_json(
            self.data_root / "identity.json",
            {
                **identity,
                "user": {
                    "id": "00000000-0000-4000-8000-000000000099",
                    "isAnonymous": True,
                },
            },
        )
        requests = len(self.fixture.calls)
        code, rendered, _ = self.run_cli(
            "render", {"presentationId": old_id, "translations": {}}
        )
        self.assertEqual(code, 1)
        self.assertEqual(rendered[0]["state"], "local_error")
        self.assertEqual(len(self.fixture.calls), requests)

    def test_completed_report_translation_keeps_diagram_numbers_and_task(self) -> None:
        self.identity()
        fixtures = json.loads(
            (Path(__file__).parent / "fixtures" / "presentation-golden.json").read_text(
                encoding="utf-8"
            )
        )
        task = next(case for case in fixtures if case["name"] == "report")["result"][
            "task"
        ]
        self.fixture.tasks = {task["id"]: task}
        code, lines, _ = self.run_cli("task", {"taskId": task["id"]})
        self.assertEqual(code, 0, lines)
        original = lines[0]
        self.assertEqual(original["state"], "completed")
        self.assertEqual(original["delivery"]["mode"], "render_required")
        self.assertEqual(original["delivery"]["command"], "render")
        translations = {
            **original["translation"]["fields"],
            "topicDemand": "话题需求",
            "titleExpression": "标题表达",
            "contentDevelopment": "内容展开",
            "readingExperience": "素材与阅读体验",
            "interactionPotential": "互动潜力",
            "distinctiveness": "差异化表达",
            "likes": "点赞",
            "collects": "收藏",
            "comments": "评论",
            "rapidGrowth": "快速增长",
        }
        requests = len(self.fixture.calls)
        code, lines, _ = self.run_cli(
            "render",
            {
                "presentationId": original["presentationId"],
                "translations": translations,
            },
        )
        self.assertEqual(code, 0, lines)
        rendered = lines[0]
        self.assertNotIn("话题需求", rendered["displayText"])
        self.assertIn("点赞: 快速增长 · 收藏: 快速增长 · 评论: 快速增长", rendered["displayText"])
        self.assertEqual(rendered["delivery"]["mode"], "verbatim")
        self.assertEqual(rendered["delivery"]["format"], "text_code_block")
        self.assertNotIn("command", rendered["delivery"])
        for key in ("state", "nextAction", "taskId", "presentationId"):
            self.assertEqual(rendered[key], original[key])

        def diagram_rows(text: str) -> list[str]:
            return [
                row for row in text.splitlines() if re.fullmatch(r"[ 0-9╱╲│◉┼─═]+", row)
            ]

        self.assertEqual(
            diagram_rows(rendered["displayText"]), diagram_rows(original["displayText"])
        )
        self.assertEqual(
            re.findall(r"[0-9]+(?:\.[0-9]+)?", rendered["displayText"]),
            re.findall(r"[0-9]+(?:\.[0-9]+)?", original["displayText"]),
        )
        self.assertEqual(
            re.findall(r"https?://\S+", rendered["displayText"]),
            re.findall(r"https?://\S+", original["displayText"]),
        )
        self.assertEqual(len(self.fixture.calls), requests)
        self.assertEqual(self.fixture.submissions, [])

    def test_errors_are_safe_json_and_clear_requires_explicit_true(self) -> None:
        self.fixture.mode = "html"
        self.assertEqual(self.run_cli("login")[1][0]["state"], "unavailable")
        self.fixture.mode = "malformed"
        malformed = self.run_cli("login")[1][0]
        self.assertEqual(malformed["state"], "invalid_response")
        self.assertNotIn("PRIVATE_STACK", json.dumps(malformed))
        for data in (b"{broken", b"[]", b'{"topics":NaN}', b'{"x":1,"x":2}'):
            with self.subTest(data=data):
                self.assertEqual(self.run_cli("diagnose", data)[1][0]["state"], "invalid_input")
        self.identity()
        self.assertEqual(
            self.run_cli("clear-identity", {"confirmed": "true"})[1][0]["state"],
            "confirmation_required",
        )
        self.assertTrue((self.data_root / "identity.json").exists())
        self.assertEqual(
            self.run_cli("clear-identity", {"confirmed": True})[1][0]["state"],
            "cleared",
        )


class CliInputAndArchitectureTests(unittest.TestCase):
    def test_type_annotations_can_be_resolved_by_supported_runtime(self) -> None:
        for path in (TOOLS / "teeho_skill").glob("*.py"):
            module = importlib.import_module("teeho_skill." + path.stem)
            for value in vars(module).values():
                if not (inspect.isfunction(value) or inspect.isclass(value)):
                    continue
                if value.__module__ != module.__name__:
                    continue
                with self.subTest(module=module.__name__, symbol=value.__name__):
                    typing.get_type_hints(inspect.unwrap(value))
                    if inspect.isclass(value):
                        for method in vars(value).values():
                            if inspect.isfunction(method):
                                typing.get_type_hints(inspect.unwrap(method))

    def test_input_limits_bom_multibyte_and_arguments(self) -> None:
        self.assertEqual(
            read_input(None, io.BytesIO(b"\xef\xbb\xbf" + json.dumps(NOTE).encode())),
            NOTE,
        )
        with self.assertRaises(TeehoError):
            read_input(None, io.BytesIO(b" " * (MAX_INPUT_BYTES + 1)))
        for arguments in (
            ["bogus"],
            ["status", "--input-file", "file.json"],
            ["status", "--unknown"],
        ):
            with self.subTest(arguments=arguments), self.assertRaises(TeehoError):
                parse_arguments(arguments)

    def test_bundle_imports_only_standard_library_and_local_modules(self) -> None:
        for path in TOOLS.rglob("*.py"):
            with self.subTest(path=path.name):
                tree = ast.parse(path.read_text(encoding="utf-8"))
                for node in ast.walk(tree):
                    if isinstance(node, ast.Import):
                        modules = [alias.name for alias in node.names]
                    elif isinstance(node, ast.ImportFrom) and node.level == 0:
                        modules = [node.module or ""]
                    else:
                        continue
                    for name in modules:
                        self.assertTrue(is_stdlib_import(name.split(".")[0]), name)
                        if name in ("urllib.request", "http.client"):
                            self.assertEqual(path.name, "http_transport.py")


if __name__ == "__main__":
    unittest.main()
