"""Contract tests for every public API route using a local real HTTP server."""

import json
import sys
import tempfile
import threading
import unittest
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill import constants
from teeho_skill.api import TeehoApi
from teeho_skill.errors import TeehoError
from teeho_skill.http_transport import HttpTransport
from teeho_skill.presentation import create_error_presentation
from teeho_skill.rendering import render_presentation

UID = "11111111-1111-4111-8111-111111111111"
DEVICE = "a" * 64
MACHINE = "b" * 64
TOKEN = "SYNTHETIC_TEST_TOKEN"
SUBMISSION = {
    "inputMode": "custom",
    "rawText": "",
    "fields": {"title": "Synthetic task", "body": "Synthetic body", "topics": ["test"]},
    "imageReferences": [UID],
    "coverReference": UID,
    "submissionId": UID,
    "admission": {
        "schemaVersion": "analysis-task-admission.v1",
        "confirmationRevision": 0,
        "session": None,
        "idempotencyKey": UID,
        "mediaBinding": {
            "contentKind": "image",
            "imageReferences": [UID],
            "videoReference": None,
            "coverReference": UID,
        },
    },
}


class Handler(BaseHTTPRequestHandler):
    requests, responses = [], {}
    codes = {}

    def do_GET(self) -> None:
        self.handle_request()

    def do_POST(self) -> None:
        self.handle_request()

    def do_PUT(self) -> None:
        self.handle_request()

    def handle_request(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        Handler.requests.append((self.command, self.path, dict(self.headers), body))
        value = Handler.responses.get(
            self.path, Handler.responses.get(self.path.removeprefix("/api"), {})
        )
        status, data = value if isinstance(value, tuple) else (200, value)
        message = data.get("message", "ok") if isinstance(data, dict) else "ok"
        payload = json.dumps(
            {
                "code": Handler.codes.get(self.path, 0 if status < 300 else status),
                "message": message,
                "data": data,
            }
        ).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *_args: object) -> None:
        return


class ApiContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join()
        cls.server.server_close()

    def setUp(self):
        Handler.requests.clear()
        Handler.responses.clear()
        Handler.codes.clear()
        self.api = TeehoApi(
            f"http://127.0.0.1:{self.server.server_port}/api", HttpTransport()
        )
        self.auth_calls = []

        def auth(operation, expected):
            self.auth_calls.append(expected)
            return operation(TOKEN)

        self.api.authorize = auth

    def test_all_declared_interfaces(self) -> None:
        task = {"id": UID, "status": "queued"}
        cases = [
            (
                "API_AUTH_START",
                lambda: self.api.start_login(DEVICE),
                "/skill/auth/start",
                "POST",
                {"deviceToken": DEVICE, "deviceName": "Teeho Skill"},
                {
                    "verificationUrl": "https://login.example",
                    "userCode": "ABC123",
                    "interval": 2,
                },
            ),
            (
                "API_AUTH_ANONYMOUS",
                lambda: self.api.create_anonymous_identity(DEVICE, MACHINE),
                "/skill/auth/anonymous",
                "POST",
                {
                    "deviceToken": DEVICE,
                    "machineId": MACHINE,
                    "deviceName": "Teeho Skill",
                },
                {"user": {"id": UID}},
            ),
            (
                "API_AUTH_TOKEN",
                lambda: self.api.exchange_token(DEVICE),
                "/skill/auth/token",
                "POST",
                {"deviceToken": DEVICE},
                {
                    "user": {"id": UID, "isAnonymous": True},
                    "accessToken": "access",
                    "accessExpiresAt": "2030-01-01T00:00:00Z",
                    "expiresAt": None,
                },
            ),
            (
                "API_AUTH_LOGOUT",
                lambda: self.api.logout(TOKEN),
                "/skill/auth/logout",
                "POST",
                {},
                {},
            ),
            (
                "API_POINTS_SUMMARY",
                lambda: self.api.get_points(expected_user_id=UID),
                "/points/summary",
                "GET",
                None,
                {"summary": {}},
            ),
            (
                "API_TASK_CONFIG",
                lambda: self.api.get_task_config(expected_user_id=UID),
                "/analysis/task-config",
                "GET",
                None,
                {"config": {}},
            ),
            (
                "API_IMAGE_UPLOAD_SESSIONS",
                lambda: self.api.create_image_upload_session(
                    [
                        {
                            "fileName": "photo.png",
                            "declaredMediaType": "image/png",
                            "byteSize": 15,
                        }
                    ],
                    expected_user_id=UID,
                ),
                "/analysis/media/upload-sessions",
                "POST",
                {
                    "files": [
                        {
                            "fileName": "photo.png",
                            "declaredMediaType": "image/png",
                            "byteSize": 15,
                        }
                    ]
                },
                {
                    "session": {
                        "assets": [{"id": UID, "uploadUrl": "https://upload.example/x"}]
                    }
                },
            ),
            (
                "API_IMAGE_STATUSES",
                lambda: self.api.get_media_statuses([UID], expected_user_id=UID),
                "/analysis/media/statuses",
                "POST",
                {"assetIds": [UID]},
                {"assets": [{"id": UID, "state": "ready"}]},
            ),
            (
                "API_IMAGE_COMPLETE_TEMPLATE",
                lambda: self.api.confirm_image_upload(UID, expected_user_id=UID),
                f"/analysis/media/{UID}/complete",
                "POST",
                {},
                {"asset": {"id": UID, "state": "ready"}},
            ),
            (
                "API_VIDEO_UPLOAD_SESSIONS",
                lambda: self.api.create_video_upload_session(
                    {
                        "fileName": "x.mp4",
                        "declaredMediaType": "video/mp4",
                        "byteSize": 15,
                    },
                    expected_user_id=UID,
                ),
                "/analysis/video/upload-sessions",
                "POST",
                {
                    "file": {
                        "fileName": "x.mp4",
                        "declaredMediaType": "video/mp4",
                        "byteSize": 15,
                    }
                },
                {
                    "session": {
                        "video": {
                            "id": UID,
                            "upload": {
                                "endpoint": "https://upload.example",
                                "bucketName": "b",
                                "objectName": "o",
                                "signature": "s",
                            },
                        }
                    }
                },
            ),
            (
                "API_VIDEO_DETAIL_TEMPLATE",
                lambda: self.api.get_video(UID, expected_user_id=UID),
                f"/analysis/video/{UID}",
                "GET",
                None,
                {"video": {"id": UID, "state": "ready"}},
            ),
            (
                "API_VIDEO_COMPLETE_TEMPLATE",
                lambda: self.api.confirm_video_upload(UID, expected_user_id=UID),
                f"/analysis/video/{UID}/complete",
                "POST",
                {},
                {"video": {"id": UID, "state": "ready"}},
            ),
            (
                "API_TASK_SUBMIT",
                lambda: self.api.submit_task(SUBMISSION, expected_user_id=UID),
                "/analysis/tasks",
                "POST",
                SUBMISSION,
                {"task": task},
            ),
            (
                "API_TASK_ADMISSION_TEMPLATE",
                lambda: self.api.get_admission(UID, expected_user_id=UID),
                f"/analysis/tasks/admissions/{UID}",
                "GET",
                None,
                {"task": task},
            ),
            (
                "API_TASK_DETAIL_TEMPLATE",
                lambda: self.api.get_task(UID, expected_user_id=UID),
                f"/analysis/tasks/{UID}",
                "GET",
                None,
                {"task": task},
            ),
        ]
        covered = set()
        for name, call, path, method, expected_body, data in cases:
            with self.subTest(name=name):
                Handler.responses[path] = data
                self.assertEqual(call(), data)
                actual, route, headers, body = Handler.requests[-1]
                self.assertEqual((actual, route), (method, "/api" + path))
                self.assertEqual(headers.get("X-Teeho-Skill-Version"), "2.1.0")
                (
                    self.assertEqual(json.loads(body), expected_body)
                    if expected_body is not None
                    else self.assertEqual(body, b"")
                )
                self.assertEqual(
                    headers.get("Content-Type"),
                    "application/json" if expected_body is not None else None,
                )
                if name not in {
                    "API_AUTH_START",
                    "API_AUTH_ANONYMOUS",
                    "API_AUTH_TOKEN",
                }:
                    self.assertEqual(headers.get("Authorization"), "Bearer " + TOKEN)
                covered.add(name)
        self.assertEqual(covered, {n for n in vars(constants) if n.startswith("API_")})
        self.assertIn("STORAGE_SIGNED_UPLOAD_TEMPLATE", vars(constants))
        self.assertEqual(self.auth_calls, [UID] * 11)
        for request in Handler.requests[:3]:
            self.assertNotIn("Authorization", request[2])

    def test_upgrade_code_precedes_http_error_mapping_for_every_api(self):
        calls = [
            ("/skill/auth/start", lambda: self.api.start_login(DEVICE)),
            ("/skill/auth/anonymous", lambda: self.api.create_anonymous_identity(DEVICE, MACHINE)),
            ("/skill/auth/token", lambda: self.api.exchange_token(DEVICE)),
            ("/skill/auth/logout", lambda: self.api.logout(TOKEN)),
            ("/points/summary", self.api.get_points),
            ("/analysis/task-config", self.api.get_task_config),
            ("/analysis/media/upload-sessions", lambda: self.api.create_image_upload_session([])),
            ("/analysis/media/statuses", lambda: self.api.get_media_statuses([UID])),
            (f"/analysis/media/{UID}/complete", lambda: self.api.confirm_image_upload(UID)),
            ("/analysis/video/upload-sessions", lambda: self.api.create_video_upload_session({})),
            (f"/analysis/video/{UID}", lambda: self.api.get_video(UID)),
            (f"/analysis/video/{UID}/complete", lambda: self.api.confirm_video_upload(UID)),
            ("/analysis/tasks", lambda: self.api.submit_task(SUBMISSION)),
            (f"/analysis/tasks/admissions/{UID}", lambda: self.api.get_admission(UID)),
            (f"/analysis/tasks/{UID}", lambda: self.api.get_task(UID)),
        ]
        for path, call in calls:
            with self.subTest(path=path):
                Handler.codes["/api" + path] = 4260
                Handler.responses[path] = (
                    400,
                    {
                        "reason": "skill_upgrade_required",
                        "minimumVersion": "2.2.0",
                        "latestVersion": "2.3.1",
                        "downloadPath": "/skill/download",
                        "message": "untrusted server prose",
                    },
                )
                before = len(Handler.requests)
                with self.assertRaises(TeehoError) as raised:
                    call()
                self.assertEqual(raised.exception.code, "skill_upgrade_required")
                self.assertEqual(len(Handler.requests), before + 1)
                view = create_error_presentation(raised.exception)
                self.assertEqual(view["state"], "upgrade_required")
                self.assertEqual(view["nextAction"], "upgrade_skill")
                text = render_presentation(view)
                self.assertIn(self.api.base_url + "/skill/download", text)
                self.assertIn("2.2.0", text)
                self.assertNotIn("untrusted server prose", text)

    def test_upload_file_descriptor_and_direct_url(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "photo.png"
            content = b"synthetic-media"
            path.write_bytes(content)
            target = {
                "endpoint": f"http://127.0.0.1:{self.server.server_port}",
                "bucketName": "media/x",
                "objectName": "a b/photo.png",
                "signature": "sig",
            }
            self.api.upload_file(target, path, "image/png", path.name)
            method, route, headers, body = Handler.requests[-1]
            self.assertEqual(
                (method, route),
                (
                    "PUT",
                    "/storage/v1/object/upload/sign/media%2Fx/a%20b/photo.png?token=sig",
                ),
            )
            self.assertNotIn("Authorization", headers)
            mime = BytesParser(policy=default).parsebytes(
                ("Content-Type: " + headers["Content-Type"] + "\r\n\r\n").encode()
                + body
            )
            parts = list(mime.iter_parts())
            self.assertEqual(parts[0].get_payload(decode=True), b"3600")
            self.assertEqual(parts[1].get_payload(decode=True), content)
            self.assertEqual(parts[1].get_filename(), "photo.png")
            self.assertEqual(parts[0].get_content_disposition(), "form-data")
            self.assertEqual(
                parts[0].get_param("name", header="content-disposition"), "cacheControl"
            )
            self.assertEqual(parts[1].get_content_disposition(), "form-data")
            # Supabase StorageFileApi 的 signed upload 使用空名称文件字段。
            self.assertIn(b'name=""', body)
            self.assertIn(b'filename="photo.png"', body)
            self.api.upload_file(
                f"http://127.0.0.1:{self.server.server_port}/direct?token=x",
                path,
                "image/png",
                path.name,
            )
            self.assertEqual(Handler.requests[-1][1], "/direct?token=x")
            self.assertNotIn("Authorization", Handler.requests[-1][2])

    def test_invalid_ids_do_not_request(self):
        for operation in (
            self.api.get_video,
            self.api.confirm_video_upload,
            self.api.get_task,
            self.api.get_admission,
            self.api.confirm_image_upload,
        ):
            with self.subTest(operation=operation.__name__), self.assertRaises(
                TeehoError
            ):
                operation("bad", expected_user_id=UID)
        self.assertFalse(Handler.requests)

    def test_error_classification(self):
        for path, status, message, expected, call in (
            (
                "/skill/auth/token",
                409,
                "pending",
                "authorization_pending",
                lambda: self.api.exchange_token("d"),
            ),
            (
                "/points/summary",
                401,
                "x",
                "login_required",
                lambda: self.api.get_points(expected_user_id=UID),
            ),
            (
                "/skill/auth/anonymous",
                429,
                "anonymous_limit",
                "anonymous_limit",
                lambda: self.api.create_anonymous_identity("d", "m"),
            ),
            (
                "/points/summary",
                429,
                "x",
                "rate_limited",
                lambda: self.api.get_points(expected_user_id=UID),
            ),
        ):
            Handler.responses["/api" + path] = (status, {"message": message})
            with self.subTest(path=path), self.assertRaisesRegex(TeehoError, expected):
                call()
        Handler.responses["/api/skill/auth/start"] = {}
        with self.assertRaises(TeehoError):
            self.api.start_login("d")


if __name__ == "__main__":
    unittest.main()
