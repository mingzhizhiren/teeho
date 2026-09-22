"""本机运行时、身份、网络与日志回归测试；只使用合成数据。"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from typing import Optional

from teeho_skill.api import TeehoApi
from teeho_skill.auth import AuthSession
from teeho_skill.config import normalize_api_url, read_installation
from teeho_skill.debug import DebugLogger, command_log_level
from teeho_skill.device import machine_identifier
from teeho_skill.errors import TeehoError
from teeho_skill.version import SkillUpgradeRequired
from teeho_skill.http_transport import HttpTransport
from teeho_skill.locking import lock_directory, process_is_running
from teeho_skill.storage import ensure_private_directory, is_link, read_json, write_json

USER_ID = "00000000-0000-4000-8000-000000000001"
OTHER_ID = "00000000-0000-4000-8000-000000000002"
BASE_URL = "https://example.test/api"
ISSUED = {
    "user": {"id": USER_ID, "isAnonymous": False},
    "accessToken": "synthetic-access",
    "accessExpiresAt": "2099-01-01T00:00:00Z",
    "expiresAt": None,
}


class LocalServer:
    def __init__(self, responder: object) -> None:
        self.requests = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                return

            def do_GET(self) -> None:
                self.respond()

            def do_POST(self) -> None:
                self.respond()

            def do_PUT(self) -> None:
                self.respond()

            def respond(self) -> None:
                body = self.rfile.read(int(self.headers.get("content-length", "0")))
                owner.requests.append((self.command, self.path, dict(self.headers), body))
                status, headers, content = responder(self.path, body)
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()


class RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="teeho-python-runtime-")
        self.root = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)

    def api_server(self, responder: object) -> tuple[LocalServer, TeehoApi]:
        server = LocalServer(responder)
        self.addCleanup(server.close)
        return server, TeehoApi(server.url + "/api", HttpTransport())

    def session(self, public: Optional[object] = None, **options: object) -> AuthSession:
        return AuthSession(
            self.root,
            public or SimpleNamespace(exchange_token=Mock(return_value=ISSUED)),
            BASE_URL,
            **options,
        )

    def identity(self, **changes: object) -> dict:
        value = {**ISSUED, "deviceToken": "a" * 64, "baseUrl": BASE_URL, **changes}
        write_json(self.root / "identity.json", value)
        return value

    def test_service_normalization_and_old_directory_hash(self) -> None:
        normalized = "https://example.test/api"
        self.assertEqual(normalize_api_url("HTTPS://EXAMPLE.TEST:443/a/../api///"), normalized)
        self.assertEqual(normalize_api_url("http://[::1]:80/api/"), "http://[::1]/api")
        install = read_installation({"TEEHO_HOME": str(self.root), "TEEHO_API_URL": normalized})
        self.assertEqual(
            install.root,
            self.root / "servers" / hashlib.sha256(normalized.encode()).hexdigest(),
        )
        self.assertFalse(install.debug)
        self.assertTrue(read_installation({"TEEHO_API_URL": "http://localhost:9634/api"}).debug)
        for invalid in (
            "http://example.test/api",
            "https://a:b@example.test/api",
            "https://example.test/api?token=private",
            "file:///tmp",
            "https://example.test/#private",
        ):
            with self.subTest(invalid=invalid), self.assertRaises(TeehoError):
                normalize_api_url(invalid)

    def test_atomic_json_failure_preserves_old_content_and_no_temporary(self) -> None:
        path = self.root / "private" / "identity.json"
        write_json(path, {"text": "中文"})
        with patch(
            "teeho_skill.storage.Path.replace", side_effect=OSError("synthetic write failure")
        ):
            with self.assertRaises(OSError):
                write_json(path, {"text": "changed"})
        self.assertEqual(read_json(path), {"text": "中文"})
        self.assertEqual(list(path.parent.iterdir()), [path])
        if os.name != "nt":
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(path.parent.stat().st_mode & 0o777, 0o700)

    def test_invalid_local_json_is_not_silently_replaced(self) -> None:
        path = self.root / "bad.json"
        for data in ('{"invalid":NaN}', '{"invalid":1e999}', '"scalar"', "{"):
            path.write_text(data, encoding="utf-8")
            with self.assertRaises(TeehoError):
                read_json(path)
        self.assertIsNone(read_json(self.root / "missing.json"))

    def test_old_live_lock_blocks_and_dead_owner_is_recovered(self) -> None:
        path = self.root / "identity.lock"
        write_json(path / "owner.json", {"pid": os.getpid()})
        with self.assertRaisesRegex(TeehoError, "identity_busy"):
            with lock_directory(path):
                self.fail("live lock entered")
        child = subprocess.Popen(
            [sys.executable, "-B", "-c", "pass"],
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        child.wait(timeout=10)
        self.assertFalse(process_is_running(child.pid))
        write_json(path / "owner.json", {"pid": child.pid})
        with lock_directory(path):
            self.assertEqual(read_json(path / "owner.json")["pid"], os.getpid())
        self.assertFalse(path.exists())
        self.assertTrue(process_is_running(os.getpid()))

    def test_lock_released_after_operation_exception(self) -> None:
        path = self.root / "operation.lock"
        with self.assertRaisesRegex(ValueError, "synthetic"):
            with lock_directory(path):
                raise ValueError("synthetic")
        with lock_directory(path):
            self.assertTrue(path.exists())

    @unittest.skipUnless(os.name == "nt", "Windows directory junction")
    def test_junction_is_rejected_without_modifying_its_target(self) -> None:
        target = self.root / "junction-target"
        target.mkdir()
        marker = target / "keep.txt"
        marker.write_text("preserved", encoding="utf-8")
        junction = self.root / "operation.lock"
        subprocess.run(
            ["cmd.exe", "/c", "mklink", "/J", str(junction), str(target)],
            check=True,
            capture_output=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        try:
            self.assertTrue(is_link(junction))
            with self.assertRaisesRegex(TeehoError, "invalid_local_data"):
                ensure_private_directory(junction)
            with self.assertRaisesRegex(TeehoError, "identity_busy"):
                with lock_directory(junction):
                    self.fail("junction acquired")
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserved")
            self.assertFalse((target / "owner.json").exists())
        finally:
            junction.rmdir()

    def test_device_digest_uses_platform_source_and_normalization(self) -> None:
        with (
            patch("teeho_skill.device.sys.platform", "win32"),
            patch(
                "teeho_skill.device._windows_identifier",
                return_value=("synthetic-guid", "MachineGuid"),
            ),
        ):
            actual = machine_identifier()
        expected = hashlib.sha256(b"teeho-device-v1:win32:MachineGuid:synthetic-guid").hexdigest()
        self.assertEqual(actual, expected)

    def test_refresh_expired_old_identity_and_bind_original_owner(self) -> None:
        public = SimpleNamespace(exchange_token=Mock(return_value=ISSUED))
        self.identity(accessExpiresAt="2000-01-01T00:00:00Z")
        result = self.session(public).authorized(
            lambda token: {"ok": token == ISSUED["accessToken"]}, USER_ID
        )
        self.assertTrue(result["ok"])
        public.exchange_token.assert_called_once_with("a" * 64)
        self.assertEqual(read_json(self.root / "identity.json")["expiresAt"], None)
        self.assertFalse((self.root / "identity.lock").exists())

    def test_refresh_cannot_silently_change_owner(self) -> None:
        original = self.identity(accessExpiresAt="2000-01-01T00:00:00Z")
        public = SimpleNamespace(
            exchange_token=Mock(return_value={**ISSUED, "user": {"id": OTHER_ID}})
        )
        operation = Mock()
        with self.assertRaisesRegex(TeehoError, "账号已切换"):
            self.session(public).authorized(operation, USER_ID)
        operation.assert_not_called()
        self.assertEqual(read_json(self.root / "identity.json"), original)

    def test_unauthorized_refreshes_once_but_unknown_write_is_not_replayed(
        self,
    ) -> None:
        self.identity()
        operation = Mock(side_effect=[TeehoError("login_required", 401), {"ok": True}])
        self.assertEqual(self.session().authorized(operation, USER_ID), {"ok": True})
        self.assertEqual(operation.call_count, 2)
        unknown = Mock(side_effect=TeehoError("request_failed"))
        with self.assertRaises(TeehoError):
            self.session().authorized(unknown, USER_ID)
        unknown.assert_called_once()

    def test_expired_authorization_can_logout_without_network_details(self) -> None:
        self.identity()
        public = SimpleNamespace(logout=Mock(side_effect=TeehoError("login_required", 401)))
        self.assertEqual(self.session(public).logout(), {"signedOut": True})
        self.assertIsNone(read_json(self.root / "identity.json"))

    def test_logout_uses_existing_credential_without_upgrade_blocked_refresh(self) -> None:
        self.identity()
        public = SimpleNamespace(
            exchange_token=Mock(side_effect=SkillUpgradeRequired(400, BASE_URL, {})),
            logout=Mock(return_value={"revoked": True}),
        )
        self.assertEqual(self.session(public).logout(), {"signedOut": True})
        public.exchange_token.assert_not_called()
        public.logout.assert_called_once_with(ISSUED["accessToken"])

    def test_upgrade_error_never_refreshes_even_if_http_status_is_401(self) -> None:
        self.identity()
        before = (self.root / "identity.json").read_bytes()
        public = SimpleNamespace(exchange_token=Mock(return_value=ISSUED))
        operation = Mock(side_effect=SkillUpgradeRequired(401, BASE_URL, {}))
        with self.assertRaises(SkillUpgradeRequired):
            self.session(public).authorized(operation, USER_ID)
        operation.assert_called_once()
        public.exchange_token.assert_not_called()
        self.assertEqual((self.root / "identity.json").read_bytes(), before)

    def test_anonymous_failure_reuses_pending_token_and_requires_real_machine(
        self,
    ) -> None:
        public = SimpleNamespace(
            create_anonymous_identity=Mock(
                side_effect=[TeehoError("request_failed"), {"user": ISSUED["user"]}]
            ),
            exchange_token=Mock(return_value=ISSUED),
        )
        session = self.session(public, machine_identifier=lambda: "b" * 64)
        with self.assertRaises(TeehoError):
            session.anonymous()
        token = read_json(self.root / "identity.json")["deviceToken"]
        self.assertEqual(session.anonymous()["user"]["id"], USER_ID)
        self.assertEqual(public.create_anonymous_identity.call_args.args[0], token)
        with self.assertRaisesRegex(TeehoError, "无法登录匿名用户"):
            self.session(public, machine_identifier=lambda: None).anonymous()

    def test_api_maps_safe_errors_and_rejects_invalid_json(self) -> None:
        response = {"status": 429, "body": {"code": 429, "message": "anonymous_limit"}}
        _, api = self.api_server(
            lambda *_: (response["status"], {}, json.dumps(response["body"]).encode())
        )
        with self.assertRaisesRegex(TeehoError, "anonymous_limit"):
            api.create_anonymous_identity("a" * 64, "b" * 64)
        response.update(status=400, body={"code": 400, "message": "PRIVATE_DETAIL"})
        with self.assertRaisesRegex(TeehoError, "题火请求参数无效"):
            api.start_login("a" * 64)
        response.update(status=200, body={"code": True, "data": {}})
        with self.assertRaisesRegex(TeehoError, "invalid_response"):
            api.start_login("a" * 64)

    def test_api_accepts_persistent_authorization(self) -> None:
        _, api = self.api_server(
            lambda *_: (200, {}, json.dumps({"code": 0, "data": ISSUED}).encode())
        )
        self.assertIsNone(api.exchange_token("a" * 64)["expiresAt"])

    def test_api_rejects_bad_response_shapes_and_accepts_unadmitted_task(self) -> None:
        api = TeehoApi(BASE_URL, HttpTransport())
        cases = (
            (api.get_points, {}, {"summary": []}),
            (api.get_task_config, {}, {"config": "bad"}),
            (api.get_task_config, {}, {"config": {"uploads": []}}),
            (api.get_task, {"task_id": USER_ID}, {"task": {"id": USER_ID}}),
            (api.get_media_statuses, {"asset_ids": [USER_ID]}, {"assets": ["bad"]}),
            (api.get_video, {"video_id": USER_ID}, {"video": {"state": "ready"}}),
            (
                api.create_image_upload_session,
                {"files": []},
                {"session": {"assets": [{}]}},
            ),
            (
                api.create_video_upload_session,
                {"file": {}},
                {"session": {"video": {"id": USER_ID}}},
            ),
        )
        for operation, arguments, response in cases:
            with (
                self.subTest(operation=operation.__name__),
                patch.object(api, "_authorized", return_value=response),
            ):
                with self.assertRaisesRegex(TeehoError, "invalid_response"):
                    operation(**arguments)
        with patch.object(api, "_authorized", return_value={"task": None}):
            self.assertEqual(api.get_admission(USER_ID), {"task": None})
            with self.assertRaisesRegex(TeehoError, "invalid_response"):
                api.get_task(USER_ID)

    def test_network_json_rejects_nonfinite_numbers_and_bounds_response(self) -> None:
        response = {"body": b'{"code":0,"data":{"value":NaN}}'}
        _, api = self.api_server(lambda *_: (200, {}, response["body"]))
        for body in (
            b'{"code":0,"data":{"value":NaN}}',
            b'{"code":0,"data":{"value":1e999}}',
        ):
            response["body"] = body
            with self.assertRaisesRegex(TeehoError, "invalid_response"):
                api.start_login("a" * 64)
        response["body"] = b"x" * 128
        with patch("teeho_skill.http_transport.MAX_RESPONSE_BYTES", 64):
            with self.assertRaisesRegex(TeehoError, "invalid_response"):
                api.start_login("a" * 64)

    def test_concurrent_directory_acquisition_has_one_owner(self) -> None:
        path = self.root / "concurrent.lock"
        first_acquired = threading.Event()
        release_first = threading.Event()

        def hold() -> None:
            with lock_directory(path):
                first_acquired.set()
                release_first.wait(timeout=5)

        worker = threading.Thread(target=hold)
        worker.start()
        try:
            self.assertTrue(first_acquired.wait(timeout=5))
            with self.assertRaisesRegex(TeehoError, "identity_busy"):
                with lock_directory(path):
                    self.fail("second owner entered")
        finally:
            release_first.set()
            worker.join(timeout=5)
        self.assertFalse(worker.is_alive())

    def test_failed_debug_directory_does_not_break_business(self) -> None:
        rows = []
        file = self.root / "not-directory"
        file.write_text("fixture", encoding="utf-8")
        logger = DebugLogger(file, True, stderr=rows.append)
        logger.log("request_started")
        logger.close()
        self.assertEqual(
            sum(json.loads(row)["event"] == "debug_log_write_failed" for row in rows), 1
        )

    def test_private_identity_is_readable_and_replaceable_in_another_process(
        self,
    ) -> None:
        path = self.root / "private" / "identity.json"
        write_json(path, {"value": "synthetic"})
        script = (
            "import sys; from pathlib import Path; "
            "sys.path.insert(0,sys.argv[1]); "
            "from teeho_skill.storage import read_json,write_json; "
            "p=Path(sys.argv[2]); value=read_json(p); "
            "write_json(p,{**value,'reopened':True})"
        )
        child = subprocess.run(
            [
                sys.executable,
                "-B",
                "-S",
                "-c",
                script,
                str(Path(__file__).resolve().parents[1] / "tools"),
                str(path),
            ],
            capture_output=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        self.assertEqual(child.returncode, 0, child.stderr.decode("utf-8", errors="replace"))
        self.assertEqual(read_json(path), {"value": "synthetic", "reopened": True})

    def test_dripping_response_cannot_extend_request_deadline(self) -> None:
        class DripHandler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: object) -> None:
                return

            def do_GET(self) -> None:
                self.send_response(200)
                self.send_header("Content-Length", "40")
                self.end_headers()
                try:
                    for _ in range(40):
                        self.wfile.write(b"x")
                        self.wfile.flush()
                        time.sleep(0.01)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    return  # 客户端在总期限到达后主动关闭连接。

        server = ThreadingHTTPServer(("127.0.0.1", 0), DripHandler)
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with self.assertRaisesRegex(TeehoError, "request_failed"):
                HttpTransport().request(f"http://127.0.0.1:{server.server_port}", timeout=0.08)
        finally:
            server.shutdown()
            server.server_close()
            worker.join()

    def test_redirect_does_not_leak_authentication(self) -> None:
        server, api = self.api_server(
            lambda *_: (
                307,
                {"Location": "/should-not-follow"},
                b'{"code":307,"data":{}}',
            )
        )
        with self.assertRaises(TeehoError):
            api.logout("synthetic-access")
        self.assertEqual(len(server.requests), 1)

    def test_streaming_multipart_unicode_filename_and_conflict_confirmation(
        self,
    ) -> None:
        server, api = self.api_server(lambda *_: (409, {}, b"conflict"))
        path = self.root / "封面.png"
        content = b"synthetic image" * 16000
        path.write_bytes(content)
        target = {
            "endpoint": server.url,
            "bucketName": "media",
            "objectName": "user/video.mp4",
            "signature": "synthetic-signature",
        }
        with patch.object(Path, "read_bytes", side_effect=AssertionError("must stream")):
            api.upload_file(target, path, "image/png", path.name)
        method, route, headers, body = server.requests[0]
        self.assertEqual(method, "PUT")
        self.assertEqual(
            route,
            "/storage/v1/object/upload/sign/media/user/video.mp4?token=synthetic-signature",
        )
        self.assertFalse(
            any(key.lower() in {"authorization", "cookie", "x-request-id"} for key in headers)
        )
        mime = BytesParser(policy=default).parsebytes(
            ("Content-Type: " + headers["Content-Type"] + "\r\n\r\n").encode() + body
        )
        parts = list(mime.iter_parts())
        self.assertEqual(parts[0].get_payload(decode=True), b"3600")
        self.assertEqual(parts[1].get_filename(), "封面.png")
        self.assertEqual(parts[1].get_payload(decode=True), content)
        self.assertEqual(headers["X-Upsert"], "false")

    def test_debug_is_disabled_by_default_and_never_logs_secrets(self) -> None:
        rows = []
        disabled = DebugLogger(self.root / "disabled")
        disabled.log("ignored")
        disabled.close()
        self.assertFalse((self.root / "disabled").exists())
        logger = DebugLogger(self.root, True, stderr=rows.append, max_file_bytes=400)
        for _ in range(3):
            logger.log(
                "request_started",
                {
                    "token": "PRIVATE_TOKEN",
                    "body": "PRIVATE_BODY",
                    "route": "bad?secret=PRIVATE",
                    "httpStatus": 200,
                },
            )
        logger.output({"state": "completed", "displayText": "PRIVATE_NOTE 🎯 ╱"}, "report")
        logger.close()
        self.assertGreater(len(list((self.root / "logs").glob("*.jsonl"))), 1)
        text = "".join(rows)
        self.assertNotIn("PRIVATE", text)
        self.assertTrue(json.loads(rows[-1])["hasRadar"])
        self.assertEqual(command_log_level("authorization_pending"), "info")
        self.assertEqual(command_log_level("failed"), "error")

    def test_network_parse_logs_keep_request_correlation(self) -> None:
        rows = []
        server = LocalServer(lambda *_: (200, {}, b"PRIVATE_BODY"))
        self.addCleanup(server.close)
        logger = DebugLogger(None, True, stderr=rows.append)
        api = TeehoApi(server.url + "/api", HttpTransport(logger))
        with self.assertRaisesRegex(TeehoError, "invalid_response"):
            api.start_login("a" * 64)
        parsed = [json.loads(row) for row in rows]
        self.assertEqual(len({row["requestId"] for row in parsed}), 1)
        self.assertEqual(parsed[-1]["state"], "invalid_json")
        self.assertNotIn("PRIVATE_BODY", "".join(rows))
        self.assertTrue(any(key.lower() == "x-request-id" for key in server.requests[0][2]))


if __name__ == "__main__":
    unittest.main()
