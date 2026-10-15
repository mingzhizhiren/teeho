"""真实安装目录中的 CLI 通过本机 HTTP 验证来源和业务事件。"""

import json
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import concurrent.futures
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from uuid import UUID

from test_cli import ApiFixture, NOTE, PRIVATE_TOKEN

SKILL = Path(__file__).resolve().parents[1]


class ObservationFixture(ApiFixture):
    def __init__(self) -> None:
        super().__init__()
        self.observations = []
        self.observation_status = 200
        self.headers = []

    def handler(self) -> type:
        base = super().handler()
        fixture = self

        class Handler(base):
            def handle_request(self) -> None:
                if self.path == "/api/skill/observations":
                    fixture.headers = [
                        *fixture.headers,
                        self.headers.get("Authorization"),
                    ]
                super().handle_request()

        return Handler

    def respond(self, path: str, body: dict) -> tuple[int, object]:
        if path == "/api/skill/observations":
            self.observations = [*self.observations, body]
            return self.observation_status, {"accepted": True}
        return super().respond(path, body)


class ObservationCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.package = self.root / "installation" / "teeho"
        shutil.copytree(
            SKILL, self.package, ignore=shutil.ignore_patterns("__pycache__", "tests")
        )
        self.fixture = ObservationFixture()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.fixture.handler())
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}/api"
        self.fixture.upload_root = self.base_url
        self.source("finch")

    def source(self, source: str) -> None:
        (self.package / "tools/teeho_skill/distribution.py").write_text(
            f'SOURCE = "{source}"\n', encoding="utf-8"
        )

    def run_cli(
        self, command: str, value: object = None, package: Optional[Path] = None
    ) -> subprocess.CompletedProcess:
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str((package or self.package) / "tools/teeho.py"),
                command,
            ],
            input=json.dumps(value or {}, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=15,
            env={
                **os.environ,
                "TEEHO_HOME": str(self.root / "home"),
                "TEEHO_API_URL": self.base_url,
                "TEEHO_PUBLIC_HISTORY_DIR": str(self.root / "public-history"),
            },
        )
        for line in result.stdout.splitlines():
            self.assertNotIn("installationId", line)
            self.assertNotIn("firstSource", line)
            self.assertNotIn("observation", line.lower())
        return result

    def events(self) -> list[dict]:
        return [
            event for batch in self.fixture.observations for event in batch["events"]
        ]

    def test_installation_is_not_activation_and_upgrade_preserves_original_channel(
        self,
    ) -> None:
        self.assertEqual(self.run_cli("help").returncode, 0)
        self.run_cli("config")
        self.assertEqual(self.fixture.observations, [])
        self.assertEqual(self.run_cli("installation").returncode, 0)
        self.assertEqual([item["type"] for item in self.events()], ["installed"])
        first = self.fixture.observations[0]
        self.assertEqual(str(UUID(first["installationId"])), first["installationId"])
        self.assertEqual(first["firstSource"], "finch")
        self.assertEqual(first["currentSource"], "finch")
        self.assertEqual(self.run_cli("installation").returncode, 0)
        self.assertEqual(len(self.events()), 1)
        self.source("official")
        self.assertEqual(self.run_cli("login").returncode, 0)
        upgraded = self.fixture.observations[-1]
        self.assertEqual(upgraded["installationId"], first["installationId"])
        self.assertEqual(upgraded["firstSource"], "finch")
        self.assertEqual(upgraded["currentSource"], "official")
        self.assertEqual(
            [item["type"] for item in self.events()],
            ["installed", "activated", "authorization_started"],
        )
        self.assertNotIn(str(self.root), json.dumps(self.fixture.observations))

    def test_invalid_diagnosis_is_counted_without_sending_note_content(self) -> None:
        result = self.run_cli("diagnose", {"body": "PRIVATE_NOTE_BODY"})
        self.assertEqual(result.returncode, 1)
        self.assertEqual(
            [item["type"] for item in self.events()],
            [
                "activated",
                "diagnosis_started",
                "diagnosis_blocked",
            ],
        )
        self.assertEqual(self.events()[-1]["reason"], "input")
        self.assertNotIn("PRIVATE_NOTE_BODY", json.dumps(self.fixture.observations))
        self.assertNotIn("/api/skill/auth/token", self.fixture.calls)

    def test_formal_authorization_is_counted_once_and_task_queries_recover_link(
        self,
    ) -> None:
        self.fixture.anonymous = False
        self.assertEqual(self.run_cli("login").returncode, 0)
        self.assertEqual(self.run_cli("login-status").returncode, 0)
        self.assertEqual(self.run_cli("login-status").returncode, 0)
        successes = [
            item for item in self.events() if item["type"] == "authorization_succeeded"
        ]
        self.assertEqual(len({item["id"] for item in successes}), 1)
        task_id = "00000000-0000-4000-8000-000000000042"
        self.fixture.tasks[task_id] = {"id": task_id, "status": "queued"}
        result = self.run_cli("task", {"taskId": task_id})
        self.assertEqual(result.returncode, 0, result.stdout)
        linked = [item for item in self.events() if item["type"] == "task_linked"]
        self.assertEqual(linked[-1]["taskId"], task_id)
        self.assertEqual(
            len([item for item in self.events() if item["type"] == "activated"]), 1
        )
        self.assertNotIn(PRIVATE_TOKEN, json.dumps(self.fixture.observations))
        self.assertEqual(self.fixture.headers[-1], "Bearer " + PRIVATE_TOKEN)

    def test_failed_delivery_retries_same_ids_and_never_blocks_business(self) -> None:
        self.fixture.observation_status = 503
        self.assertEqual(self.run_cli("installation").returncode, 0)
        failed = self.fixture.observations[0]
        self.fixture.observation_status = 200
        self.assertEqual(self.run_cli("login").returncode, 0)
        self.assertEqual(
            self.fixture.observations[1]["installationId"], failed["installationId"]
        )
        self.assertEqual(self.fixture.observations[1]["events"][0], failed["events"][0])
        self.assertNotIn("/api/skill/auth/token", self.fixture.calls)
        self.assertLessEqual(len(self.fixture.observations), 3)

    def test_separate_installations_do_not_share_id_and_concurrent_install_is_idempotent(
        self,
    ) -> None:
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            results = list(
                executor.map(lambda _: self.run_cli("installation"), range(4))
            )
        self.assertTrue(all(result.returncode == 0 for result in results))
        self.assertTrue(self.events())
        original_ids = {event["id"] for event in self.events()}
        self.assertEqual(len(original_ids), 1)
        installation_id = self.fixture.observations[0]["installationId"]
        other = self.root / "other-agent" / "teeho"
        shutil.copytree(self.package, other)
        self.assertEqual(self.run_cli("installation", package=other).returncode, 0)
        self.assertNotEqual(
            self.fixture.observations[-1]["installationId"], installation_id
        )

    def test_community_without_observation_endpoint_does_not_repeat_optional_requests(
        self,
    ) -> None:
        self.fixture.observation_status = 404
        self.assertEqual(self.run_cli("installation").returncode, 0)
        self.assertEqual(self.run_cli("login").returncode, 0)
        self.assertEqual(len(self.fixture.observations), 1)

    def test_diagnosis_response_loss_recovers_same_task_link_without_new_submission(
        self,
    ) -> None:
        self.fixture.lose_submission = True
        cover = self.root / "cover.png"
        cover.write_bytes(b"synthetic-image")
        result = self.run_cli("diagnose", {**NOTE, "images": [str(cover)]})
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertEqual(len(self.fixture.submissions), 1)
        result = self.run_cli("resume")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(len(self.fixture.submissions), 1)
        linked = [item for item in self.events() if item["type"] == "task_linked"]
        self.assertEqual(
            linked[-1]["taskId"], self.fixture.submissions[0]["submissionId"]
        )
        self.assertEqual(
            len(
                [item for item in self.events() if item["type"] == "diagnosis_started"]
            ),
            1,
        )

    def test_switching_account_never_replays_old_task_with_new_bearer(self) -> None:
        self.fixture.anonymous = False
        self.run_cli("login")
        self.run_cli("login-status")
        self.fixture.observation_status = 503
        task_id = "00000000-0000-4000-8000-000000000042"
        self.fixture.tasks[task_id] = {"id": task_id, "status": "queued"}
        self.run_cli("task", {"taskId": task_id})
        self.run_cli("logout")
        original_respond = self.fixture.respond

        def respond(path: str, body: dict) -> tuple[int, object]:
            status, data = original_respond(path, body)
            if path == "/api/skill/auth/token":
                return status, {
                    **data,
                    "user": {
                        **data["user"],
                        "id": "00000000-0000-4000-8000-000000000099",
                    },
                    "accessToken": "SYNTHETIC_OTHER_ACCOUNT_TOKEN",
                }
            return status, data

        self.fixture.respond = respond
        self.fixture.observation_status = 200
        before = len(self.fixture.observations)
        self.run_cli("login")
        self.run_cli("login-status")
        later = self.fixture.observations[before:]
        self.assertTrue(later)
        self.assertFalse(
            any(
                event.get("taskId") == task_id
                for batch in later
                for event in batch["events"]
            )
        )
        self.assertEqual(
            self.fixture.headers[-1], "Bearer SYNTHETIC_OTHER_ACCOUNT_TOKEN"
        )

    def test_each_business_use_refreshes_current_channel_after_upgrade(self) -> None:
        self.run_cli("login")
        first = self.fixture.observations[0]
        self.source("official")
        self.run_cli("status")
        latest = self.fixture.observations[-1]
        self.assertEqual(latest["currentSource"], "official")
        self.assertEqual(latest["firstSource"], "finch")
        self.assertEqual(latest["installationId"], first["installationId"])
        self.assertEqual(
            len([item for item in self.events() if item["type"] == "activated"]), 2
        )

    def test_backlog_stays_bounded_and_preserves_initial_milestones(self) -> None:
        self.fixture.observation_status = 503
        self.run_cli("installation")
        first_install = self.events()[0]
        for _ in range(36):
            self.assertEqual(
                self.run_cli("diagnose", {"body": "invalid"}).returncode, 1
            )
        first_activation = next(
            item for item in self.events() if item["type"] == "activated"
        )
        self.fixture.observation_status = 200
        self.fixture.observations = []
        self.source("official")
        for _ in range(3):
            self.run_cli("installation")
        delivered = self.events()
        self.assertEqual(len(delivered), 100)
        self.assertIn(first_install, delivered)
        self.assertIn(first_activation, delivered)
        self.assertTrue(
            all(len(batch["events"]) <= 20 for batch in self.fixture.observations)
        )
        self.assertTrue(
            all(
                batch["currentSource"] == "official"
                for batch in self.fixture.observations
            )
        )

    def test_login_with_expired_old_identity_still_delivers_installation_events(
        self,
    ) -> None:
        self.fixture.anonymous = False
        self.run_cli("login")
        self.run_cli("login-status")
        identity_path = (
            self.root
            / "home/servers"
            / hashlib.sha256(self.base_url.encode()).hexdigest()
            / "identity.json"
        )
        identity = json.loads(identity_path.read_text(encoding="utf-8"))
        identity_path.write_text(
            json.dumps({**identity, "accessExpiresAt": "2000-01-01T00:00:00Z"}),
            encoding="utf-8",
        )
        before = len(self.events())
        calls_before = self.fixture.calls.count("/api/skill/auth/token")
        self.assertEqual(self.run_cli("login").returncode, 0)
        self.assertEqual(
            [item["type"] for item in self.events()[before:]],
            ["activated", "authorization_started"],
        )
        self.assertEqual(
            self.fixture.calls.count("/api/skill/auth/token"), calls_before
        )
        self.assertIsNone(self.fixture.headers[-1])

    def test_existing_identity_status_check_does_not_claim_new_authorization(
        self,
    ) -> None:
        self.fixture.anonymous = False
        self.run_cli("login")
        self.run_cli("login-status")
        before = len(self.events())
        self.assertEqual(self.run_cli("login-status").returncode, 0)
        self.assertEqual(self.events()[before:], [])


if __name__ == "__main__":
    unittest.main()
