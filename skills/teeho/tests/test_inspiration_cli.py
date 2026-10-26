"""真实 CLI 子进程与本地 HTTP 验证索引保存后领取。"""

import hashlib
import json
import os
import shutil
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Lock
from pathlib import Path

import test_cli as cli_fixture


class InspirationCliTests(unittest.TestCase):
    run_cli = cli_fixture.CliTests.run_cli
    identity = cli_fixture.CliTests.identity

    def test_partial_request_displays_server_confirmation_without_creating_task(self) -> None:
        code, lines, _ = self.run_cli("inspire", {"topic": "健身教练教学", "mainTrack": 7})
        self.assertEqual(code, 0, lines)
        output = lines[-1]
        self.assertEqual(output["state"], "input_required")
        self.assertEqual(output["delivery"]["mode"], "render_required")
        self.assertEqual(output["displayText"], "Please confirm this inspiration search:\n• Content type (images/video): Image notes\n• Points required: 20\nStart this inspiration search?")
        self.assertEqual(output["nextAction"], "wait_for_user")
        translations = dict(zip(output["translation"]["fields"], [
            "请确认本次灵感索引：", "• 内容形式（图片/视频）：图文",
            "• 所需积分：20", "确认开始索引吗？",
        ]))
        code, rendered, _ = self.run_cli("render", {
            "presentationId": output["presentationId"], "translations": translations,
        })
        self.assertEqual(code, 0, rendered)
        self.assertEqual(rendered[-1]["delivery"]["mode"], "verbatim")
        self.assertEqual(rendered[-1]["translationStats"]["fallback"], 0)
        self.assertEqual(rendered[-1]["displayText"], "\n".join(translations.values()))
        self.assertIsNone(self.task)
        self.assertEqual(self.receipts, 0)
        self.assertFalse((self.data_root / "accounts" / cli_fixture.OWNER / "inspiration" / "pending.json").exists())
        self.assertNotIn("noteType", self.input_calls[0])
        code, completed, _ = self.run_cli("inspire", output["toolsData"]["suggestedInput"])
        self.assertEqual(code, 0, completed)
        self.assertEqual(completed[-1]["state"], "completed")
        self.assertEqual(self.receipts, 1)

    def test_invalid_track_is_sent_unchanged_and_server_error_can_be_translated(self) -> None:
        code, lines, _ = self.run_cli("inspire", {"topic": "教学", "mainTrack": "7", "noteType": "normal"})
        self.assertEqual(code, 1)
        self.assertEqual(lines[-1]["state"], "invalid_input")
        self.assertEqual(lines[-1]["displayText"], "Invalid main category. Provide an integer from 1 to 30.")
        self.assertEqual(lines[-1]["delivery"]["mode"], "render_required")
        output = lines[-1]
        _, rendered, _ = self.run_cli("render", {
            "presentationId": output["presentationId"],
            "translations": {key: "主赛道参数无效，请提供 1 到 30 的整数。"
                             for key in output["translation"]["fields"]},
        })
        self.assertEqual(rendered[-1]["translationStats"]["fallback"], 0)
        self.assertEqual(rendered[-1]["displayText"], "主赛道参数无效，请提供 1 到 30 的整数。")
        self.assertEqual(self.input_calls[0]["mainTrack"], "7")
        self.assertIsNone(self.task)
        self.assertEqual(self.receipts, 0)
        code, completed, _ = self.run_cli("inspire", {"topic": "教学", "mainTrack": 7, "noteType": "normal"})
        self.assertEqual(completed[-1]["state"], "completed")

    def test_partial_input_is_not_sent_to_legacy_service_that_defaults_to_images(self) -> None:
        self.input_protocol = False
        code, lines, _ = self.run_cli("inspire", {"topic": "教学", "mainTrack": 7})
        self.assertEqual(code, 1, lines)
        self.assertEqual(lines[-1]["state"], "unavailable")
        self.assertEqual(self.input_calls, [])
        self.assertIsNone(self.task)

    def test_completed_request_without_pending_is_not_a_connection_failure(self) -> None:
        code, lines, _ = self.run_cli("inspire", {"topic": "周末旅行", "mainTrack": 1, "noteType": "normal"})
        self.assertEqual(code, 0)
        self.assertEqual(lines[-1]["state"], "completed")
        identifier = self.task["id"]
        requests = len(self.fixture.calls)
        for command in ("inspire-wait", "inspire-task", "inspire-resume"):
            code, output, _ = self.run_cli(command)
            self.assertEqual(output[-1]["state"], "empty")
            self.assertIsNone(output[-1]["nextAction"])
            self.assertNotIn("connect", output[-1]["displayText"].lower())
        self.assertEqual(len(self.fixture.calls), requests)
        code, restored, _ = self.run_cli("inspire-task", {"taskId": identifier})
        self.assertEqual(code, 0)
        self.assertEqual(restored[-1]["state"], "completed")
        self.assertEqual(self.receipts, 1)
        self.assertEqual(self.deliveries, 1)

    def test_malformed_confirmation_keeps_original_identity_until_reconciled(self) -> None:
        self.malformed_input_feedback = True
        _, lines, _ = self.run_cli("inspire", {"topic": "教学", "mainTrack": 7})
        self.assertEqual(lines[-1]["state"], "unknown_result")
        identifier = self.input_calls[0]["submissionId"]
        self.malformed_input_feedback = False
        code, recovered, _ = self.run_cli("inspire-resume")
        self.assertEqual(code, 0, recovered)
        self.assertEqual(recovered[-1]["state"], "input_required")
        self.assertEqual(self.input_calls[-1]["submissionId"], identifier)
        self.assertIsNone(self.task)
        self.assertEqual(self.receipts, 0)

    def setUp(self) -> None:
        cli_fixture.CliTests.setUp(self)
        self.identity()
        self.task = None
        self.receipts = 0
        self.deliveries = 0
        self.saved_before_receipt = False
        self.lose_receipt = False
        self.expire_receipt = False
        self.queued = False
        self.unavailable = False
        self.invalid_reference = False
        self.input_protocol = True
        self.malformed_input_feedback = False
        self.input_calls = []
        self.target_count = 4
        self.note_type = "normal"
        self.original = self.fixture.respond
        self.fixture.respond = self.respond

    def respond(self, path: str, body: dict) -> tuple[int, object]:
        if path == "/api/inspiration/capabilities":
            if self.unavailable:
                return 404, {}
            return 200, {
                "enabled": True,
                **({"inputProtocol": "inspiration-input.v1"} if self.input_protocol else {}),
                "userId": cli_fixture.OWNER,
                "tier": "free",
                "targetCount": 4,
                "imageCost": 20,
                "videoCost": 50,
                "canVideo": False,
                "availablePoints": 50,
                "tracks": [],
            }
        if path == "/api/inspiration/tasks":
            self.input_calls = [*self.input_calls, dict(body)]
            if "mainTrack" in body and (type(body["mainTrack"]) is not int or not 1 <= body["mainTrack"] <= 30):
                return 400, {"kind": "inspiration_input_feedback", "protocol": "inspiration-input.v1", "state": "invalid_input", "reason": "mainTrack", "displayText": "Invalid main category. Provide an integer from 1 to 30."}
            if "noteType" not in body:
                if self.malformed_input_feedback:
                    return 200, "{"
                return 200, {"kind": "inspiration_input_feedback", "protocol": "inspiration-input.v1", "state": "input_required", "displayText": "Please confirm this inspiration search:\n• Content type (images/video): Image notes\n• Points required: 20\nStart this inspiration search?", "missingFields": ["noteType"], "suggestedInput": {key: value for key, value in {**body, "noteType": "normal"}.items() if key != "submissionId"}, "targetCount": 4, "pointCost": 20, "availablePoints": 50}
            if self.task and self.task["id"] == body["submissionId"]:
                return 200, self.task
            self.task = {
                "id": body["submissionId"],
                "input": {
                    key: value for key, value in body.items() if key != "submissionId"
                },
                "status": "queued" if self.queued else "ready",
                "targetCount": self.target_count,
                "pointCost": 50 if self.note_type == "video" else 20,
                "reservationStatus": "reserved",
                "resultVersion": 1,
                "resultHash": "a" * 64,
                "expiresAt": "2099-01-01T00:00:00Z",
                "createdAt": "2026-10-23T00:00:00Z",
                "failureCode": None,
            }
            return 200, self.task
        if path.endswith("/receipt"):
            self.receipts += 1
            if self.expire_receipt:
                self.task = {
                    **self.task,
                    "status": "expired",
                    "reservationStatus": "released",
                    "input": None,
                }
                return 410, {}
            history = (
                self.data_root
                / "accounts"
                / cli_fixture.OWNER
                / "inspiration"
                / "history"
                / (self.task["id"] + ".json")
            )
            self.saved_before_receipt = history.is_file()
            self.task = {
                **self.task,
                "status": "received",
                "reservationStatus": "settled",
                "input": None,
            }
            if self.lose_receipt:
                self.lose_receipt = False
                return 500, {}
            return 200, self.task
        if path.endswith("/result"):
            self.deliveries += 1
            notes = [
                {
                    "noteId": str(i),
                    "title": f"便当{i}",
                    "bodyExcerpt": "工作日备餐",
                    "url": None,
                    "noteType": self.note_type,
                    "modelScore": 8,
                    "likes": 10,
                    "collects": 5,
                    "comments": 0,
                    "observedAt": "2026-10-23T00:00:00Z",
                }
                for i in range(self.target_count)
            ]
            return 200, {
                **self.task,
                "result": {
                    "schemaVersion": "inspiration-result.v1",
                    "policyVersion": "fixture",
                    "notes": notes,
                    "themes": [
                        {
                            "text": "参考笔记围绕工作日备餐",
                            "references": [
                                "missing" if self.invalid_reference else "0"
                            ],
                        }
                    ],
                    "angles": [{"text": "结合通勤时间准备便当", "references": ["0"]}],
                },
            }
        if path.startswith("/api/inspiration/tasks/"):
            return (200, self.task) if self.task else (404, {})
        return self.original(path, body)

    def test_inspire_saves_before_receipt_and_history_renders_offline(self) -> None:
        code, lines, _ = self.run_cli(
            "inspire", {"topic": "上班族便当", "mainTrack": 1, "noteType": "normal"}
        )
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "completed")
        self.assertTrue(self.saved_before_receipt)
        self.assertEqual(self.receipts, 1)
        self.assertIn("参考笔记围绕工作日备餐", lines[-1]["displayText"])
        self.assertIn("Selection reason: Related content", lines[-1]["displayText"])
        envelope = lines[-1]
        code, rendered, _ = self.run_cli(
            "render",
            {
                "presentationId": envelope["presentationId"],
                "translations": envelope["translation"]["fields"],
            },
        )
        self.assertEqual(code, 0, rendered)
        self.assertEqual(rendered[-1]["translationStats"]["fallback"], 0)
        before = len(self.fixture.calls)
        code, history, _ = self.run_cli(
            "history", {"kind": "inspiration", "taskId": self.task["id"]}
        )
        self.assertEqual(code, 0, history)
        self.assertIn("结合通勤时间准备便当", history[-1]["displayText"])
        self.assertEqual(len(self.fixture.calls), before)
        self.assertEqual(self.receipts, 1)

    def _use_long_history_home(self) -> None:
        from test_storage_paths import extended_path

        suffix = (
            Path("servers")
            / hashlib.sha256(self.base.encode()).hexdigest()
            / "accounts"
            / cli_fixture.OWNER
            / "inspiration"
            / "history"
            / (cli_fixture.OWNER + ".json")
        )
        padding = 261 - len(str(self.home / suffix)) - 1
        self.assertGreater(padding, 0)
        self.home = self.home / ("d" * padding)
        self.addCleanup(shutil.rmtree, extended_path(self.home))
        self.data_root = extended_path(
            self.home / "servers" / hashlib.sha256(self.base.encode()).hexdigest()
        )
        self.identity()

    @unittest.skipUnless(os.name == "nt", "Windows native long paths")
    def test_long_history_path_survives_receipt_resume_list_and_clear(self) -> None:
        self._use_long_history_home()
        self.lose_receipt = True
        _, first, _ = self.run_cli(
            "inspire", {"topic": "Long path fixture", "mainTrack": 1, "noteType": "normal"}
        )
        self.assertEqual(first[-1]["nextAction"], "inspire-resume")
        self.assertTrue(self.saved_before_receipt)
        code, resumed, _ = self.run_cli("inspire-resume")
        self.assertEqual(code, 0, resumed)
        self.assertEqual(resumed[-1]["state"], "completed")
        self.assertEqual(self.deliveries, 1)
        before = len(self.fixture.calls)
        code, listed, _ = self.run_cli("history", {"kind": "inspiration"})
        self.assertEqual(code, 0, listed)
        self.assertIn("Long path fixture", listed[-1]["displayText"])
        code, viewed, _ = self.run_cli(
            "history", {"kind": "inspiration", "taskId": self.task["id"]}
        )
        self.assertEqual(code, 0, viewed)
        code, cleared, _ = self.run_cli(
            "clear-history", {"kind": "inspiration", "confirmed": True}
        )
        self.assertEqual(code, 0, cleared)
        self.assertEqual(len(self.fixture.calls), before)
        folder = self.data_root / "accounts" / cli_fixture.OWNER / "inspiration"
        self.assertEqual(list((folder / "history").glob("*.json")), [])
        self.assertFalse((folder / "pending.json").exists())
        self.assertFalse((folder / "receipt.lock").exists())
        self.assertFalse((folder / "operation.lock").exists())
        for rows in (first, resumed, listed, viewed, cleared):
            self.assertNotIn(json.dumps(str(self.home))[1:-1], json.dumps(rows))

    def test_lost_receipt_response_resumes_original_saved_result(self) -> None:
        self.lose_receipt = True
        code, lines, _ = self.run_cli(
            "inspire", {"topic": "上班族便当", "mainTrack": 1, "noteType": "normal"}
        )
        self.assertEqual(lines[-1]["nextAction"], "inspire-resume")
        original_id = self.task["id"]
        code, resumed, _ = self.run_cli("inspire-resume")
        self.assertEqual(code, 0, resumed)
        self.assertEqual(resumed[-1]["state"], "completed")
        self.assertEqual(self.task["id"], original_id)
        self.assertEqual(self.deliveries, 1)

    def test_confirmed_history_recovers_a_crash_before_pending_cleanup(self) -> None:
        fields = {"topic": "便当", "mainTrack": 1, "noteType": "normal"}
        self.run_cli("inspire", fields)
        completed_id = self.task["id"]
        pending = (
            self.data_root
            / "accounts"
            / cli_fixture.OWNER
            / "inspiration"
            / "pending.json"
        )
        cli_fixture.write_json(
            pending,
            {
                "userId": cli_fixture.OWNER,
                "submissionId": completed_id,
                "input": fields,
            },
        )
        before = len(self.fixture.calls)
        code, lines, _ = self.run_cli("inspire-wait")
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "completed")
        self.assertFalse(pending.exists())
        self.assertEqual(len(self.fixture.calls), before)
        code, lines, _ = self.run_cli("inspire", {"topic": "旅行", "mainTrack": 2, "noteType": "normal"})
        self.assertEqual(code, 0, lines)
        self.assertNotEqual(self.task["id"], completed_id)

    def test_two_cli_processes_do_not_overwrite_a_confirmed_receipt(self) -> None:
        self.queued = True
        self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        self.task = {**self.task, "status": "ready"}
        entered, release = Event(), Event()
        guard = Lock()
        original = self.fixture.respond

        def interleaved(path: str, body: dict) -> tuple[int, object]:
            if path.endswith("/result"):
                with guard:
                    first = not entered.is_set()
                    captured = original(path, body)
                    if first:
                        entered.set()
                if first and not release.wait(15):
                    return 500, {}
                return captured
            if path.endswith("/receipt") and self.receipts:
                self.lose_receipt = True
            return original(path, body)

        self.fixture.respond = interleaved
        with ThreadPoolExecutor(max_workers=2) as pool:
            late = pool.submit(self.run_cli, "inspire-resume")
            try:
                self.assertTrue(entered.wait(10))
                other = pool.submit(self.run_cli, "inspire-resume").result(timeout=10)
            finally:
                release.set()
            finished = late.result(timeout=10)
        folder = self.data_root / "accounts" / cli_fixture.OWNER / "inspiration"
        record = json.loads(
            (folder / "history" / (self.task["id"] + ".json")).read_text(
                encoding="utf-8"
            )
        )
        self.assertTrue(record["receiptConfirmed"], (other[1], finished[1]))
        self.assertEqual(record["task"]["status"], "received")
        self.assertFalse((folder / "pending.json").exists())
        self.assertEqual(self.deliveries, 1)
        self.assertEqual(self.receipts, 1)

    def test_local_storage_failure_never_sends_receipt(self) -> None:
        folder = self.data_root / "accounts" / cli_fixture.OWNER / "inspiration"
        folder.mkdir(parents=True)
        (folder / "history").write_text("synthetic blocked directory", encoding="utf-8")
        code, lines, _ = self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        self.assertEqual(code, 1, lines)
        self.assertEqual(self.receipts, 0)
        self.assertTrue((folder / "pending.json").is_file())

    def test_new_idea_does_not_silently_resume_an_unconfirmed_purchase(self) -> None:
        self.lose_receipt = True
        self.run_cli("inspire", {"topic": "上班族便当", "mainTrack": 1, "noteType": "normal"})
        original_id = self.task["id"]
        before = self.receipts
        code, lines, _ = self.run_cli("inspire", {"topic": "旅行摄影", "mainTrack": 2, "noteType": "normal"})
        self.assertEqual(code, 1, lines)
        self.assertEqual(self.task["id"], original_id)
        self.assertEqual(self.receipts, before)
        code, lines, _ = self.run_cli("inspire-resume")
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "completed")

    def test_saved_but_expired_receipt_is_reconciled_in_local_history(self) -> None:
        self.expire_receipt = True
        _, lines, _ = self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        self.assertEqual(lines[-1]["state"], "expired")
        folder = self.data_root / "accounts" / cli_fixture.OWNER / "inspiration"
        self.assertFalse((folder / "pending.json").exists())
        code, lines, _ = self.run_cli(
            "history", {"kind": "inspiration", "taskId": self.task["id"]}
        )
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "expired")
        self.assertIn("No points charged", lines[-1]["displayText"])
        self.assertNotIn("Credits charged: 20", lines[-1]["displayText"])

    def test_help_lists_inspiration_without_starting_a_task(self) -> None:
        code, lines, _ = self.run_cli("help", input_file='{"topic":"inspiration"}')
        self.assertEqual(code, 0, lines)
        self.assertIn("inspiration", lines[-1]["displayText"].lower())
        self.assertEqual(self.fixture.calls, [])

    def test_topic_limit_matches_server_utf16_before_any_request(self) -> None:
        code, _, _ = self.run_cli("inspire", {"topic": "🍱" * 251, "mainTrack": 1, "noteType": "normal"})
        self.assertEqual(code, 1)
        self.assertEqual(self.fixture.calls, [])

    def test_unsupported_service_has_explicit_inspiration_unavailable_message(
        self,
    ) -> None:
        self.unavailable = True
        code, lines, _ = self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        self.assertEqual(code, 1, lines)
        self.assertIn("Inspiration is not available", lines[-1]["displayText"])
        self.assertIsNone(self.task)

    def test_anonymous_auto_identity_keeps_all_four_references_private(self) -> None:
        (self.data_root / "identity.json").unlink()
        code, lines, _ = self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["displayText"].count("📕"), 4)
        self.assertEqual(self.fixture.calls.count("/api/skill/auth/anonymous"), 1)
        self.run_cli("history")
        self.assertFalse(list((self.home / "public-history").rglob("*.json")))

    def test_formal_tiers_render_frozen_counts_and_prices_without_media_uploads(
        self,
    ) -> None:
        self.identity(anonymous=False)
        for count, kind, charge in (
            (4, "normal", 20),
            (8, "normal", 20),
            (8, "video", 50),
            (10, "normal", 20),
            (10, "video", 50),
        ):
            with self.subTest(count=count, kind=kind):
                self.target_count, self.note_type = count, kind
                code, lines, _ = self.run_cli(
                    "inspire", {"topic": "便当", "mainTrack": 1, "noteType": kind}
                )
                self.assertEqual(code, 0, lines)
                self.assertEqual(lines[-1]["displayText"].count("📕"), count)
                self.assertIn(f"Credits charged: {charge}", lines[-1]["displayText"])
        self.assertFalse(any("upload" in path for path in self.fixture.calls))

    def test_restart_waits_for_original_task_and_expiration_never_receives(
        self,
    ) -> None:
        self.queued = True
        _, lines, _ = self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        identifier = self.task["id"]
        self.assertEqual(lines[-1]["nextAction"], "inspire-wait")
        self.task = {**self.task, "status": "expired", "reservationStatus": "released"}
        code, lines, _ = self.run_cli("inspire-wait", {"taskId": identifier})
        self.assertEqual(code, 0, lines)
        self.assertEqual(lines[-1]["state"], "expired")
        self.assertIn("submit your idea again", lines[-1]["displayText"])
        self.assertEqual(self.receipts, 0)
        self.assertEqual(self.deliveries, 0)
        self.assertEqual(self.task["id"], identifier)

    def test_unverifiable_reference_never_receives_and_original_id_remains(
        self,
    ) -> None:
        self.invalid_reference = True
        _, lines, _ = self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        identifier = self.task["id"]
        self.assertEqual(lines[-1]["nextAction"], "inspire-resume")
        self.assertEqual(self.receipts, 0)
        self.invalid_reference = False
        code, lines, _ = self.run_cli("inspire-resume")
        self.assertEqual(code, 0, lines)
        self.assertEqual(self.task["id"], identifier)

    def test_history_cannot_be_read_after_switching_account_and_deletes_locally(
        self,
    ) -> None:
        self.run_cli("inspire", {"topic": "便当", "mainTrack": 1, "noteType": "normal"})
        identity_file = self.data_root / "identity.json"
        identity = json.loads(identity_file.read_text(encoding="utf-8"))
        identity_file.write_text(
            json.dumps(
                {
                    **identity,
                    "user": {
                        **identity["user"],
                        "id": "22222222-2222-4222-8222-222222222222",
                    },
                }
            ),
            encoding="utf-8",
        )
        code, _, _ = self.run_cli(
            "history", {"kind": "inspiration", "taskId": self.task["id"]}
        )
        self.assertEqual(code, 1)
        identity_file.write_text(json.dumps(identity), encoding="utf-8")
        before = len(self.fixture.calls)
        code, lines, _ = self.run_cli(
            "clear-history", {"kind": "inspiration", "confirmed": True}
        )
        self.assertEqual(code, 0, lines)
        self.assertEqual(len(self.fixture.calls), before)
        self.assertFalse(
            list(
                (
                    self.data_root
                    / "accounts"
                    / cli_fixture.OWNER
                    / "inspiration"
                    / "history"
                ).glob("*.json")
            )
        )


if __name__ == "__main__":
    unittest.main()
