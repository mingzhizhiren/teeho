"""使用合成网络异常与本机临时锁检查诊断内容和脱敏。"""

import http.client
import json
import os
import socket
import ssl
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill.debug import DebugLogger
from teeho_skill.auth import AuthSession
from teeho_skill.errors import TeehoError
from teeho_skill.http_transport import HttpTransport
from teeho_skill.locking import lock_directory


class DiagnosticsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lines: list[str] = []
        self.logger = DebugLogger(None, enabled=True, stderr=self.lines.append)
        self.transport = HttpTransport(self.logger)

    def event(self, name: str) -> dict:
        return next(
            row
            for line in self.lines
            for row in [json.loads(line)]
            if row["event"] == name
        )

    def tearDown(self) -> None:
        self.assertTrue(all(json.loads(line)["level"] == "debug" for line in self.lines))

    def test_explicit_log_levels_still_use_debug_output(self) -> None:
        for level in ("info", "warn", "error"):
            self.logger.log("diagnostic_probe", {"state": "failed"}, level)
        self.assertEqual(len(self.lines), 3)

    def test_wrapped_network_errors_keep_safe_classification(self) -> None:
        failures = [
            (URLError(socket.gaierror(socket.EAI_NONAME, "PRIVATE_HOST")), "dns"),
            (
                URLError(ConnectionResetError(10054, "PRIVATE_TOKEN")),
                "connection_reset",
            ),
            (URLError(ssl.SSLError(1, "PRIVATE_CERT")), "tls"),
            (http.client.RemoteDisconnected("PRIVATE_URL"), "remote_disconnected"),
        ]
        for failure, reason in failures:
            with self.subTest(reason=reason):
                self.lines.clear()
                with patch.object(self.transport.opener, "open", side_effect=failure):
                    with self.assertRaisesRegex(TeehoError, "request_failed"):
                        self.transport.request(
                            "https://storage.example/private?token=SECRET"
                        )
                row = self.event("request_failed")
                self.assertEqual(row["networkReason"], reason)
                self.assertEqual(row["phase"], "before_response_headers")
                self.assertFalse(row["responseHeadersReceived"])
                self.assertNotIn("PRIVATE", "".join(self.lines))
                self.assertNotIn("SECRET", "".join(self.lines))
                self.assertNotIn("storage.example", "".join(self.lines))

    def test_partial_upload_records_produced_bytes_not_received_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "PRIVATE_FILENAME.png"
            path.write_bytes(b"PRIVATE_CONTENT")

            def interrupted(request: object, **kwargs: object) -> None:
                chunks = iter(request.data)
                next(chunks)
                next(chunks)
                raise ConnectionResetError(10054, "PRIVATE_DETAILS")

            with patch.object(self.transport.opener, "open", side_effect=interrupted):
                with self.assertRaisesRegex(TeehoError, "request_failed"):
                    self.transport.upload(
                        "https://storage.example/private?token=SECRET",
                        path,
                        "image/png",
                        path.name,
                    )
        row = self.event("request_failed")
        self.assertEqual(row["phase"], "sending_request_body")
        self.assertGreater(row["bodyBytesProduced"], 0)
        self.assertFalse(row["requestBodyComplete"])
        self.assertEqual(row["errno"], 10054)
        self.assertNotIn("PRIVATE", "".join(self.lines))
        self.assertNotIn("SECRET", "".join(self.lines))

    def test_lock_contention_records_owner_without_path_or_token(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "PRIVATE_ACCOUNT" / "operation.lock"
            with lock_directory(path, log=self.logger.log):
                with self.assertRaisesRegex(TeehoError, "identity_busy"):
                    with lock_directory(path, log=self.logger.log):
                        self.fail("contended lock acquired")
            self.assertFalse(path.exists())
        self.assertEqual(self.event("lock_busy")["ownerPid"], os.getpid())
        self.assertEqual(self.event("lock_acquired")["lockKind"], "operation")
        self.assertGreaterEqual(self.event("lock_released")["holdMs"], 0)
        self.assertNotIn("PRIVATE_ACCOUNT", "".join(self.lines))
        self.assertNotIn('"token"', "".join(self.lines))

    def test_response_timeout_preserves_partial_read_and_upstream_id(self) -> None:
        class Response:
            status = 200
            headers = {"sb-request-id": "00000000-0000-4000-8000-000000000001"}

            def __enter__(self) -> "Response":
                return self

            def __exit__(self, *args: object) -> None:
                pass

            def read1(self, maximum: int) -> bytes:
                raise TimeoutError("PRIVATE_RESPONSE")

        response = Response()
        with patch.object(
            response, "read1", side_effect=[b"PRIVATE", TimeoutError("SECRET")]
        ), patch.object(self.transport.opener, "open", return_value=response):
            with self.assertRaisesRegex(TeehoError, "request_failed"):
                self.transport.request("https://storage.example/private?token=SECRET")
        row = self.event("request_failed")
        self.assertEqual(row["phase"], "reading_response_body")
        self.assertEqual(row["responseBytesRead"], 7)
        self.assertEqual(row["networkReason"], "timeout")
        self.assertTrue(row["responseHeadersReceived"])
        self.assertEqual(row["httpStatus"], 200)
        self.assertEqual(
            self.event("response_headers_received")["upstreamRequestId"],
            response.headers["sb-request-id"],
        )
        self.assertNotIn("PRIVATE", "".join(self.lines))
        self.assertNotIn("SECRET", "".join(self.lines))

    def test_completed_body_waiting_for_headers_is_distinguished(self) -> None:
        def interrupted(request: object, **kwargs: object) -> None:
            list(request.data)
            raise TimeoutError("PRIVATE_TIMEOUT")

        with patch.object(self.transport.opener, "open", side_effect=interrupted):
            with self.assertRaisesRegex(TeehoError, "request_failed"):
                self.transport.request(
                    "https://storage.example/",
                    method="PUT",
                    data=iter([b"abc", b"def"]),
                )
        row = self.event("request_failed")
        self.assertEqual(row["phase"], "awaiting_response_headers")
        self.assertTrue(row["requestBodyComplete"])
        self.assertEqual(row["bodyBytesProduced"], 6)

    def test_identity_lock_wait_reports_first_wait_and_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            session = AuthSession(
                root, object(), "https://api.example/", log=self.logger
            )
            with lock_directory(root / "identity.lock"), patch(
                "teeho_skill.auth.LOCK_ATTEMPTS", 2
            ), patch("teeho_skill.auth.time.sleep"):
                with self.assertRaisesRegex(TeehoError, "identity_busy"):
                    with session._locked():
                        self.fail("contended identity acquired")
            self.assertEqual(self.event("lock_wait_started")["ownerPid"], os.getpid())
            self.assertEqual(self.event("lock_wait_timeout")["attempt"], 2)
            with session._locked():
                pass
            self.assertEqual(self.event("lock_released")["lockKind"], "identity")

    def test_debug_disabled_does_not_emit_diagnostics(self) -> None:
        transport = HttpTransport(
            DebugLogger(None, enabled=False, stderr=self.lines.append)
        )
        with patch.object(transport.opener, "open", side_effect=ConnectionResetError()):
            with self.assertRaisesRegex(TeehoError, "request_failed"):
                transport.request("https://storage.example/")
        self.assertEqual(self.lines, [])

    def test_logging_failure_cannot_leak_an_acquired_lock(self) -> None:
        def failed_log(*args: object) -> None:
            raise OSError("PRIVATE_LOG_FAILURE")

        with tempfile.TemporaryDirectory() as folder, patch(
            "teeho_skill.locking.sys.stderr.write"
        ) as stderr:
            path = Path(folder) / "operation.lock"
            with self.assertRaisesRegex(TeehoError, "original_failure"):
                with lock_directory(path, log=failed_log):
                    raise TeehoError("original_failure")
            self.assertFalse(path.exists())
            self.assertNotIn("PRIVATE", str(stderr.call_args_list))
            self.assertTrue(all(json.loads(call.args[0])["level"] == "debug" for call in stderr.call_args_list))

    def test_proxy_and_certificate_errors_are_structured_without_messages(self) -> None:
        certificate = ssl.SSLCertVerificationError(1, "PRIVATE_CERTIFICATE")
        certificate.verify_code = 18
        failures = [
            (
                URLError("Tunnel connection failed: 407 PRIVATE_PROXY"),
                "proxy_tunnel",
                "proxyStatus",
                407,
            ),
            (URLError(certificate), "tls_certificate", "tlsVerifyCode", 18),
        ]
        for failure, reason, key, code in failures:
            self.lines.clear()
            with patch.object(self.transport.opener, "open", side_effect=failure):
                with self.assertRaises(TeehoError):
                    self.transport.request(
                        "https://storage.example/private?token=SECRET"
                    )
            self.assertEqual(self.event("request_failed")["networkReason"], reason)
            self.assertEqual(self.event("request_failed")[key], code)
            self.assertNotIn("PRIVATE", "".join(self.lines))

    def test_real_socket_close_after_upload_records_unknown_response(self) -> None:
        class DropResponse(BaseHTTPRequestHandler):
            def do_PUT(self) -> None:
                self.rfile.read(int(self.headers["Content-Length"]))
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()

            def log_message(self, *args: object) -> None:
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), DropResponse)
        server.daemon_threads = True
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder) / "PRIVATE.png"
                path.write_bytes(b"PRIVATE_IMAGE")
                with self.assertRaisesRegex(TeehoError, "request_failed"):
                    self.transport.upload(
                        f"http://127.0.0.1:{server.server_port}/?token=SECRET",
                        path,
                        "image/png",
                        path.name,
                    )
            row = self.event("request_failed")
            self.assertEqual(row["networkReason"], "remote_disconnected")
            self.assertEqual(row["phase"], "awaiting_response_headers")
            self.assertTrue(row["requestBodyComplete"])
            self.assertFalse(row["responseHeadersReceived"])
            self.assertNotIn("PRIVATE", "".join(self.lines))
            self.assertNotIn("SECRET", "".join(self.lines))
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)
