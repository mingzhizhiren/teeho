"""诊断恢复行为测试，使用独立本机状态和模拟接口。"""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from typing import Optional

from teeho_skill.constants import MAX_IMAGES, MEDIA_WAIT_SECONDS
from teeho_skill.diagnosis import DiagnosisTools
from teeho_skill.errors import TeehoError
from teeho_skill.history import HistoryTools
from teeho_skill.note import normalize_note
from teeho_skill.media import inspect_directory
from teeho_skill.storage import read_json

OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
NOTE = {"title": "原有标题", "body": "原有正文内容", "topics": ["生活"]}


class FakeAuth:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.user_id = OWNER

    def read_identity(self) -> dict:
        return {"user": {"id": self.user_id}}


class FakeApi:
    def __init__(self) -> None:
        self.tasks = {}
        self.submissions = []
        self.assets = {}
        self.uploads = []
        self.video = None
        self.video_file = None
        self.lose_submission = False
        self.lose_upload = False
        self.media_failed = False
        self.task_status = "queued"
        self.polls = 0
        self.last_owner = None
        self.response_hook = None

    def get_points(self, expected_user_id: Optional[str] = None) -> dict:
        self.last_owner = expected_user_id
        return {
            "summary": {
                "enabled": True,
                "balances": {"free": 30, "package": 0, "purchased": 0},
                "pricing": [{"minImages": 0, "maxImages": 18, "points": 15}],
            }
        }

    def get_task_config(self, expected_user_id: Optional[str] = None) -> dict:
        return {"config": {"uploads": {"video": {"maxFileBytes": 1024, "pointCost": 15}}}}

    def submit_task(self, payload: dict, expected_user_id: Optional[str] = None) -> dict:
        self.last_owner = expected_user_id
        self.submissions = self.submissions + [copy.deepcopy(payload)]
        task = {"id": payload["submissionId"], "status": self.task_status}
        if self.task_status == "succeeded":
            task = {
                **task,
                "result": {"qualitativeConclusion": {"summary": "完整结果"}},
            }
        self.tasks = {**self.tasks, task["id"]: task}
        if self.lose_submission:
            self.lose_submission = False
            raise TeehoError("request_failed")
        return {"task": task}

    def get_admission(self, submission_id: str, expected_user_id: Optional[str] = None) -> dict:
        self.last_owner = expected_user_id
        return {"task": self.tasks.get(submission_id)}

    def get_task(self, task_id: str, expected_user_id: Optional[str] = None) -> dict:
        self.polls += 1
        self.last_owner = expected_user_id
        result = {"task": self.tasks[task_id]}
        if self.response_hook:
            self.response_hook()
        return result

    def create_image_upload_session(
        self, files: list[dict], expected_user_id: Optional[str] = None
    ) -> dict:
        assets = [
            {"id": str(uuid4()), "uploadUrl": "https://storage.example.test/object"} for _ in files
        ]
        self.assets = {
            asset["id"]: {"id": asset["id"], "state": "awaiting_upload"} for asset in assets
        }
        return {"session": {"assets": assets}}

    def get_media_statuses(
        self, asset_ids: list[str], expected_user_id: Optional[str] = None
    ) -> dict:
        return {
            "assets": [
                {
                    **self.assets[identifier],
                    **({"state": "failed"} if self.media_failed else {}),
                }
                for identifier in asset_ids
            ]
        }

    def upload_file(
        self, target: object, path: Path, declared_media_type: str, file_name: str
    ) -> None:
        self.uploads = self.uploads + [
            {
                "target": target,
                "path": path,
                "name": file_name,
                "bytes": path.read_bytes(),
                "type": declared_media_type,
            }
        ]
        if self.lose_upload and declared_media_type.startswith("video/"):
            self.lose_upload = False
            raise TeehoError("request_failed")

    def confirm_image_upload(self, asset_id: str, expected_user_id: Optional[str] = None) -> dict:
        self.assets = {**self.assets, asset_id: {"id": asset_id, "state": "ready"}}
        return {"asset": self.assets[asset_id]}

    def create_video_upload_session(
        self, file: dict, expected_user_id: Optional[str] = None
    ) -> dict:
        self.video_file = file
        self.video = {"id": str(uuid4()), "state": "awaiting_upload"}
        return {
            "session": {
                "video": {
                    "id": self.video["id"],
                    "upload": {
                        "endpoint": "https://storage.example.test/storage/v1/upload/resumable",
                        "bucketName": "analysis-video",
                        "objectName": "fixture/video",
                        "signature": "synthetic",
                    },
                }
            }
        }

    def get_video(self, video_id: str, expected_user_id: Optional[str] = None) -> dict:
        return {"video": self.video}

    def confirm_video_upload(self, video_id: str, expected_user_id: Optional[str] = None) -> dict:
        self.video = {**self.video, "state": "ready"}
        return {"video": self.video}


class DiagnosisTests(unittest.TestCase):
    def test_body_is_optional_but_title_and_topics_are_required(self) -> None:
        for body in (None, "", "   "):
            result = normalize_note({"title": "已有标题", "body": body, "topics": ["生活"], "images": ["cover.png"]})
            self.assertEqual(result["fields"]["body"], "")
        self.assertEqual(normalize_note({"title": "已有标题", "topics": ["生活"], "images": ["cover.png"]})["fields"]["body"], "")
        for value in ({"topics": ["生活"], "images": ["cover.png"]}, {"title": "已有标题"}, {"title": "已有标题", "topics": []}, {"title": "已有标题", "topics": ["生活"], "body": 123}):
            with self.assertRaises(TeehoError):
                normalize_note(value)

    def test_missing_cover_is_rejected_before_submission(self) -> None:
        with self.assertRaisesRegex(TeehoError, 'missing_cover'):
            self.tool.diagnose(NOTE)
        self.assertEqual(self.api.submissions, [])
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="teeho-python-diagnosis-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.auth = FakeAuth(self.root)
        self.api = FakeApi()
        self.events = []
        self.tool = DiagnosisTools(self.api, self.auth, emit=self.events.append)
        self.note = {**NOTE, "images": [self.image("required-cover.png")]}

    def image(self, name: str = "cover.png") -> str:
        path = self.root / name
        path.write_bytes(b"synthetic-image")
        return str(path)

    def test_diagnose_submits_empty_body_without_requesting_more_text(self) -> None:
        note = {key: value for key, value in self.note.items() if key != "body"}
        self.tool.diagnose(note)
        self.assertEqual(self.api.submissions[0]["fields"]["body"], "")

    def test_inspect_reports_one_level_note_directories(self) -> None:
        child = self.root / "1"
        child.mkdir()
        (child / "note.md").write_text("title", encoding="utf-8")
        nested = child / "nested"
        nested.mkdir()
        result = inspect_directory(str(self.root))
        self.assertEqual(result["directories"], [{"name": "1", "path": str(child)}])

    def test_lost_submission_resumes_same_completed_task_and_history(self) -> None:
        self.api.lose_submission = True
        self.api.task_status = "succeeded"
        with self.assertRaises(TeehoError):
            self.tool.diagnose(self.note)
        pending = read_json(self.root / "accounts" / OWNER / "pending.json")
        self.assertTrue(pending["submitting"])
        result = DiagnosisTools(self.api, self.auth).resume()
        self.assertEqual(result["task"]["id"], pending["submissionId"])
        self.assertEqual(len(self.api.submissions), 1)
        self.assertEqual(len(HistoryTools(self.root, OWNER).list()), 1)
        payload = self.api.submissions[0]
        self.assertEqual(payload["admission"]["idempotencyKey"], payload["submissionId"])
        self.assertIsNone(payload["admission"]["session"])
        self.assertEqual(payload["admission"]["mediaBinding"]["contentKind"], "image")

    def test_not_admitted_old_pending_reuses_submission_identifier(self) -> None:
        self.api.lose_submission = True
        with self.assertRaises(TeehoError):
            self.tool.diagnose(self.note)
        self.api.tasks = {}
        self.tool.resume()
        self.assertEqual(len(self.api.submissions), 2)
        self.assertEqual(self.api.submissions[0], self.api.submissions[1])

    def test_unknown_submission_blocks_new_diagnosis(self) -> None:
        self.api.lose_submission = True
        with self.assertRaises(TeehoError):
            self.tool.diagnose(self.note)
        with self.assertRaisesRegex(TeehoError, "未确认"):
            self.tool.diagnose({**self.note, "title": "另一篇"})
        self.assertEqual(len(self.api.submissions), 1)

    def test_command_bound_account_rejects_switch_before_dispatch(self) -> None:
        tool = DiagnosisTools(self.api, self.auth, expected_user_id=OWNER)
        self.auth.user_id = OTHER
        with self.assertRaisesRegex(TeehoError, "账号已切换"):
            tool.diagnose(self.note)
        self.assertEqual(self.api.submissions, [])
        self.assertFalse((self.root / "accounts" / OTHER).exists())

    def test_unrelated_task_response_keeps_original_pending_submission(self) -> None:
        with patch.object(
            self.api,
            "submit_task",
            return_value={
                "task": {"id": OTHER, "status": "queued"},
            },
        ):
            with self.assertRaisesRegex(TeehoError, "任务结果未确认"):
                self.tool.diagnose(self.note)
        state = read_json(self.root / "accounts" / OWNER / "pending.json")
        self.assertTrue(state["submitting"])
        self.assertIsNone(state["taskId"])
        result = self.tool.resume()
        self.assertEqual(result["task"]["id"], state["submissionId"])

    def test_image_selection_and_cover_binding(self) -> None:
        for count in (0, 1, 20):
            with self.subTest(count=count):
                root = self.root / str(count)
                root.mkdir()
                api = FakeApi()
                image = self.image(f"cover-{count}.png")
                if count == 0:
                    with self.assertRaisesRegex(TeehoError, "missing_cover"):
                        DiagnosisTools(api, FakeAuth(root)).diagnose(NOTE)
                    continue
                DiagnosisTools(api, FakeAuth(root)).diagnose({**NOTE, "images": [image] * count})
                payload = api.submissions[0]
                self.assertEqual(len(payload["imageReferences"]), min(count, MAX_IMAGES))
                self.assertEqual(len(api.uploads), min(count, MAX_IMAGES))
                if count:
                    self.assertEqual(payload["coverReference"], payload["imageReferences"][0])
                else:
                    self.assertNotIn("coverReference", payload)

    def test_video_without_cover_is_submitted(self) -> None:
        video = self.root / "video.mp4"
        video.write_bytes(b"synthetic-video")
        result = self.tool.diagnose({**NOTE, "videos": [str(video)]})
        payload = self.api.submissions[0]
        self.assertEqual(payload["videoReference"], self.api.video["id"])
        self.assertEqual(payload["imageReferences"], [])
        self.assertNotIn("coverReference", payload)
        self.assertIsNone(result["localMedia"]["cover"])

    def test_video_response_loss_resumes_upload_and_ignores_second_video(self) -> None:
        first, second = self.root / "first.mp4", self.root / "second.mp4"
        first.write_bytes(b"synthetic-video")
        second.write_bytes(b"ignored-video")
        self.api.lose_upload = True
        with self.assertRaises(TeehoError):
            self.tool.diagnose({**self.note, "videos": [str(first), str(second)]})
        video_id = self.api.video["id"]
        result = DiagnosisTools(self.api, self.auth).resume()
        self.assertEqual(self.api.video["id"], video_id)
        self.assertEqual(self.api.video_file["fileName"], first.name)
        self.assertEqual(result["summary"]["ignored"], ["second.mp4"])
        self.assertEqual(result["localMedia"]["video"], str(first))
        self.assertEqual(result["localMedia"]["images"], self.note["images"])
        self.assertNotIn(str(first), json.dumps(self.api.submissions))
        self.assertEqual(self.api.submissions[0]["videoReference"], video_id)
        self.assertEqual(self.api.submissions[0]["imageReferences"], [])
        self.assertEqual(len(self.api.submissions), 1)

    def test_wait_uses_deadline_and_stops_on_technical_failure(self) -> None:
        result = self.tool.diagnose(self.note)
        identifier = result["task"]["id"]
        clock = [0.0]

        def sleep(seconds: float) -> None:
            clock[0] += seconds

        tool = DiagnosisTools(self.api, self.auth, now=lambda: clock[0], sleep=sleep)
        waiting = tool.wait(identifier)
        self.assertIn("任务分析中", waiting["message"])
        self.assertEqual(clock[0], MEDIA_WAIT_SECONDS)
        self.assertGreaterEqual(clock[0], 300)
        self.api.tasks = {identifier: {"id": identifier, "status": "technical_failed"}}
        before = self.api.polls
        self.assertEqual(tool.wait(identifier)["task"]["status"], "technical_failed")
        self.assertEqual(self.api.polls - before, 1)
        self.assertEqual(len(self.api.submissions), 1)

    def test_failed_media_can_be_replaced_before_submission(self) -> None:
        self.api.media_failed = True
        with self.assertRaisesRegex(TeehoError, "图片状态不可上传"):
            self.tool.diagnose({**NOTE, "images": [self.image()]})
        self.api.media_failed = False
        self.assertEqual(self.tool.diagnose(self.note)["task"]["status"], "queued")

    def test_history_stays_with_original_account_when_identity_changes(self) -> None:
        self.api.task_status = "succeeded"
        result = self.tool.diagnose(self.note)
        identifier = result["task"]["id"]

        def change_account() -> None:
            self.auth.user_id = OTHER

        self.api.response_hook = change_account
        self.tool.task(identifier)
        self.assertEqual(self.api.last_owner, OWNER)
        self.assertEqual(len(HistoryTools(self.root, OWNER).list()), 1)
        self.assertEqual(HistoryTools(self.root, OTHER).list(), [])

    def test_previous_complete_report_keeps_path_after_original_deleted(self) -> None:
        image = self.image()
        first = self.tool.diagnose({**NOTE, "images": [image]})["task"]["id"]
        self.api.tasks = {
            first: {
                "id": first,
                "status": "succeeded",
                "result": {"qualitativeConclusion": {"summary": "原报告"}},
            }
        }
        Path(image).unlink()
        self.tool.diagnose(self.note)
        report = HistoryTools(self.root, OWNER).read(first)
        self.assertEqual(report["task"]["result"]["qualitativeConclusion"]["summary"], "原报告")
        self.assertIsNone(report["cover"])
        self.assertEqual(report["localMedia"], {"cover": image, "images": [image], "video": None})
        self.assertEqual(list((self.root / "accounts" / OWNER).glob("*.png")), [])

    def test_recovered_v7_task_allows_new_diagnosis_without_clearing_identity(self) -> None:
        first = self.tool.diagnose(self.note)["task"]["id"]
        with patch.object(self.api, "get_task", side_effect=TeehoError("not_found", 404)):
            with self.assertRaises(TeehoError):
                self.tool.diagnose(self.note)
        self.assertEqual(len(self.api.submissions), 1)
        pending = read_json(self.root / "accounts" / OWNER / "pending.json")
        self.assertEqual(pending["taskId"], first)
        self.api.tasks = {
            **self.api.tasks,
            first: {
                "id": first,
                "status": "succeeded",
                "result": {
                    "schemaVersion": "analysis-result.v7",
                    "primaryScore": {"source": "insight", "value": 7.5},
                    "qualitativeConclusion": {"summary": "已完成的原报告"},
                },
            },
        }
        second = self.tool.diagnose(self.note)["task"]["id"]
        self.assertNotEqual(first, second)
        self.assertEqual(len(self.api.submissions), 2)
        self.assertEqual(self.auth.user_id, OWNER)
        self.assertEqual(self.api.last_owner, OWNER)
        report = HistoryTools(self.root, OWNER).read(first)
        self.assertEqual(report["task"]["result"]["schemaVersion"], "analysis-result.v7")

    def test_report_write_failure_does_not_resubmit(self) -> None:
        self.api.task_status = "succeeded"
        with patch.object(HistoryTools, "save", side_effect=OSError("disk full")):
            result = self.tool.diagnose(self.note)
        self.assertFalse(result["saved"])
        self.assertEqual(len(self.api.submissions), 1)

    def test_invalid_input_is_rejected_and_inspect_is_nonrecursive(self) -> None:
        for note in (
            {**NOTE, "title": "???"},
            {**NOTE, "body": "\ufffd"},
            {**NOTE, "topics": ["#"]},
            {**NOTE, "images": ["\x00"]},
        ):
            with self.subTest(note=note), self.assertRaises(TeehoError):
                self.tool.diagnose(note)
        self.assertEqual(self.api.submissions, [])
        for name in ("10.png", "2.png", "1.png", "note.md", ".env"):
            (self.root / name).write_text(name, encoding="utf-8")
        (self.root / "nested").mkdir()
        (self.root / "nested" / "hidden.md").write_text("hidden", encoding="utf-8")
        found = self.tool.inspect(str(self.root))
        self.assertEqual(
            [Path(path).name for path in found["images"]], ["1.png", "2.png", "10.png", "required-cover.png"]
        )
        self.assertEqual([note["name"] for note in found["notes"]], ["note.md"])

    def test_utf16_limits_and_cover_outside_first_selection(self) -> None:
        with self.assertRaises(TeehoError):
            normalize_note({**NOTE, "title": "😀" * 101})
        images = [str(self.root / f"{number}.png") for number in range(20)]
        normalized = normalize_note({**NOTE, "images": images, "cover": images[-1]})
        self.assertEqual(len(normalized["images"]), MAX_IMAGES)
        self.assertEqual(normalized["images"][-1], images[-1])


if __name__ == "__main__":
    unittest.main()
