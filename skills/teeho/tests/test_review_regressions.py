"""Skill 审查发现的命令、恢复、缓存与 Windows 文件竞争回归。"""

import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from typing import BinaryIO
from unittest.mock import Mock, patch
from uuid import UUID

import test_cli as cli_fixtures
import test_diagnosis as diagnosis_fixtures
from teeho_skill.auth import AuthSession
from teeho_skill.cli import CommandRunner
from teeho_skill.errors import TeehoError
from teeho_skill.history import HistoryTools, local_media
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import MAX_RECORDS, PresentationStore
from teeho_skill.storage import read_json, write_json
from teeho_skill.storage import WINDOWS_REPLACE_ATTEMPTS

OWNER = diagnosis_fixtures.OWNER
PROBE_TIMEOUT_SECONDS = 5


class OptionalBodyCliTests(unittest.TestCase):
    setUp = cli_fixtures.CliTests.setUp
    run_cli = cli_fixtures.CliTests.run_cli
    identity = cli_fixtures.CliTests.identity

    def test_optional_body_reaches_http_submission(self) -> None:
        self.identity()
        without_body = {key: value for key, value in self.note.items() if key != "body"}
        for note in (
            without_body,
            {**without_body, "body": None},
            {**without_body, "body": ""},
        ):
            with self.subTest(body=note.get("body", "omitted")):
                code, lines, _ = self.run_cli("diagnose", note)
                self.assertEqual(code, 0, lines)
                self.assertEqual(lines[-1]["state"], "processing")
                self.assertEqual(self.fixture.submissions[-1]["fields"]["body"], "")
        self.assertEqual(len(self.fixture.submissions), 3)

    def test_optional_body_logging_is_safe_when_debug_disabled(self) -> None:
        runner = CommandRunner()
        self.assertFalse(runner.debug.enabled)
        without_body = {key: value for key, value in self.note.items() if key != "body"}
        for note in (without_body, {**without_body, "body": None}):
            with self.subTest(body=note.get("body", "omitted")):
                runner._log_input(note)

    def test_http_parameter_rejection_allows_corrected_input(self) -> None:
        self.identity()
        respond = self.fixture.respond

        def reject_original(path: str, body: dict) -> tuple[int, object]:
            if (
                path == "/api/analysis/tasks"
                and body["fields"]["title"] == self.note["title"]
            ):
                return 400, {"message": "synthetic invalid input"}
            return respond(path, body)

        with patch.object(self.fixture, "respond", side_effect=reject_original):
            code, lines, _ = self.run_cli("diagnose", self.note)
            self.assertEqual(code, 1, lines)
            self.assertEqual(lines[-1]["nextAction"], "correct_input")
            self.assertEqual(self.fixture.submissions, [])
            code, lines, _ = self.run_cli(
                "diagnose", {**self.note, "title": "Corrected title"}
            )
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "processing")
        self.assertEqual(len(self.fixture.submissions), 1)
        self.assertEqual(
            self.fixture.submissions[0]["fields"]["title"], "Corrected title"
        )


class SubmissionRecoveryTests(unittest.TestCase):
    setUp = diagnosis_fixtures.DiagnosisTests.setUp
    image = diagnosis_fixtures.DiagnosisTests.image

    def test_confirmed_rejection_allows_corrected_diagnosis(self) -> None:
        rejection = TeehoError("题火请求参数无效，请更新技能后重试", 400)
        with patch.object(self.api, "submit_task", side_effect=rejection):
            with self.assertRaises(TeehoError) as caught:
                self.tool.diagnose(self.note)
        self.assertIs(caught.exception, rejection)
        pending = self.root / "accounts" / OWNER / "pending.json"
        rejected = read_json(pending)
        self.assertFalse(rejected["submitting"])
        self.assertFalse(self.api.tasks)
        corrected = {**self.note, "title": "Corrected title"}
        result = self.tool.diagnose(corrected)
        self.assertNotEqual(result["task"]["id"], rejected["submissionId"])
        self.assertEqual(len(self.api.submissions), 1)
        self.assertEqual(self.api.submissions[0]["fields"]["title"], corrected["title"])

    def test_uncertain_responses_preserve_original_submission(self) -> None:
        pending = self.root / "accounts" / OWNER / "pending.json"
        for status in (None, 400, 500):
            with self.subTest(status=status):
                pending.unlink(missing_ok=True)
                with patch.object(
                    self.api,
                    "submit_task",
                    side_effect=TeehoError("request_failed", status),
                ):
                    with self.assertRaises(TeehoError):
                        self.tool.diagnose(self.note)
                original = pending.read_bytes()
                self.assertTrue(json.loads(original)["submitting"])
                with self.assertRaisesRegex(TeehoError, "有未确认的任务"):
                    self.tool.diagnose({**self.note, "title": "Another title"})
                self.assertEqual(pending.read_bytes(), original)

    def _check_recovered_media(self, wait: bool) -> None:
        self.api.task_status = "succeeded"
        self.api.lose_submission = True
        with self.assertRaises(TeehoError):
            self.tool.diagnose(self.note)
        pending = self.root / "accounts" / OWNER / "pending.json"
        original = pending.read_bytes()
        state = json.loads(original)
        expected = local_media(state)
        self.assertIsNone(state["taskId"])
        result = self.tool.tracked_task(wait=wait, task_id=state["submissionId"])
        self.assertEqual(result["localMedia"], expected)
        history = HistoryTools(self.root, OWNER)
        saved = history.read(state["submissionId"])
        self.assertEqual(saved["localMedia"], expected)
        self.assertEqual(pending.read_bytes(), original)
        self.tool.resume()
        self.assertEqual(history.read(state["submissionId"]), saved)
        self.assertEqual(len(self.api.submissions), 1)

    def test_task_recovers_original_media_after_lost_submission_response(self) -> None:
        self._check_recovered_media(wait=False)

    def test_wait_recovers_original_media_after_lost_submission_response(self) -> None:
        self._check_recovered_media(wait=True)


class PresentationRetentionTests(unittest.TestCase):
    def test_prune_removes_oldest_snapshot_instead_of_smallest_uuid(self) -> None:
        with tempfile.TemporaryDirectory(prefix="teeho-cache-review-") as directory:
            store = PresentationStore(directory, owner=OWNER)
            view = create_presentation("help", {})
            identifiers = [
                UUID(int=(1 << 128) - 1 - index) for index in range(MAX_RECORDS)
            ]
            with patch(
                "teeho_skill.rendering.uuid4",
                side_effect=[*identifiers, UUID(int=1), UUID(int=2)],
            ):
                for index in range(MAX_RECORDS):
                    envelope = store.publish(view)
                    path = store.root / (envelope["presentationId"] + ".json")
                    timestamp = (index + 1) * 1_000_000_000
                    os.utime(path, ns=(timestamp, timestamp))
                latest = store.publish(view)
                store.publish(view)
            self.assertFalse(store.has_snapshot(str(identifiers[0])))
            self.assertFalse(store.has_snapshot(str(identifiers[1])))
            rendered = store.render(
                latest["presentationId"], latest["translation"]["fields"]
            )
            self.assertEqual(rendered["delivery"]["mode"], "verbatim")
            self.assertEqual(len(store._records()), MAX_RECORDS)


@unittest.skipUnless(os.name == "nt", "Windows 读取句柄与原子替换竞争")
class WindowsIdentityReadTests(unittest.TestCase):
    def _identity_fixture(
        self, root: Path
    ) -> tuple[dict, dict, SimpleNamespace, AuthSession]:
        issued = {
            "user": {"id": OWNER, "isAnonymous": False},
            "accessToken": "synthetic-renewed-token",
            "accessExpiresAt": "2099-01-01T00:00:00Z",
            "expiresAt": None,
        }
        original = {
            **issued,
            "baseUrl": "https://example.test/api",
            "deviceToken": "synthetic-device",
            "accessToken": "synthetic-old-token",
            "accessExpiresAt": "2000-01-01T00:00:00Z",
        }
        write_json(root / "identity.json", original)
        api = SimpleNamespace(exchange_token=Mock(return_value=issued))
        session = AuthSession(root, api, original["baseUrl"])
        return original, issued, api, session

    def test_identity_reader_does_not_block_refresh_or_lose_its_snapshot(self) -> None:
        with tempfile.TemporaryDirectory(prefix="teeho-identity-review-") as directory:
            root = Path(directory)
            original, issued, api, session = self._identity_fixture(root)
            ready, finish = threading.Event(), threading.Event()
            path_open, path_replace = Path.open, Path.replace
            conflict = Mock()

            def open_path(path: Path, *args: object, **kwargs: object) -> BinaryIO:
                stream = path_open(path, *args, **kwargs)
                if threading.current_thread().name.startswith("identity-reader"):
                    ready.set()
                    if not finish.wait(PROBE_TIMEOUT_SECONDS):
                        stream.close()
                        raise TimeoutError("identity reader probe timed out")
                return stream

            def replace_path(source: Path, target: Path) -> Path:
                try:
                    return path_replace(source, target)
                except PermissionError as error:
                    # 保留真实 WinError，固定首次替换与短暂读取相撞的交错。
                    conflict(error.winerror)
                    finish.set()
                    reader.result(PROBE_TIMEOUT_SECONDS)
                    raise

            with patch.object(Path, "open", open_path), patch.object(
                Path, "replace", replace_path
            ):
                with ThreadPoolExecutor(
                    max_workers=1, thread_name_prefix="identity-reader"
                ) as pool:
                    reader = pool.submit(session.read_identity)
                    operation = Mock(return_value={"ok": True})
                    try:
                        self.assertTrue(ready.wait(PROBE_TIMEOUT_SECONDS))
                        self.assertEqual(
                            session.authorized(operation, OWNER), {"ok": True}
                        )
                    finally:
                        finish.set()
                    self.assertEqual(reader.result(PROBE_TIMEOUT_SECONDS), original)
            operation.assert_called_once_with(issued["accessToken"])
            self.assertIn(conflict.call_args.args[0], (5, 32))
            api.exchange_token.assert_called_once_with(original["deviceToken"])
            self.assertEqual(
                session.read_identity()["accessToken"], issued["accessToken"]
            )
            self.assertFalse((root / "identity.lock").exists())

    def test_permanent_access_denial_is_bounded_and_preserves_old_file(self) -> None:
        import ctypes

        with tempfile.TemporaryDirectory(prefix="teeho-write-denied-") as directory:
            path = Path(directory) / "identity.json"
            original = {"version": "synthetic-old"}
            write_json(path, original)
            denied = ctypes.WinError(5)
            with patch.object(Path, "replace", side_effect=denied) as replace, patch(
                "teeho_skill.storage.time.sleep"
            ):
                with self.assertRaises(PermissionError) as caught:
                    write_json(path, {"version": "synthetic-new"})
            self.assertIs(caught.exception, denied)
            self.assertEqual(replace.call_count, WINDOWS_REPLACE_ATTEMPTS)
            self.assertEqual(read_json(path), original)
            self.assertEqual(list(path.parent.glob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
