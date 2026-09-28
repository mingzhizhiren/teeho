"""本地损坏与素材恢复的回归测试，只使用合成数据。"""

import json
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import test_diagnosis as fixtures
from test_diagnosis import OWNER
from teeho_skill.errors import TeehoError
from teeho_skill.history import HistoryTools
from teeho_skill.presentation import create_error_presentation
from teeho_skill.public_history import visible_history, publish_anonymous_history
from teeho_skill.media import MediaTools


class RecoveryResilienceTests(unittest.TestCase):
    setUp = fixtures.DiagnosisTests.setUp
    image = fixtures.DiagnosisTests.image

    def test_query_failed_video_does_not_claim_a_diagnosis_exists(self) -> None:
        from teeho_skill.storage import write_json
        from teeho_skill.presentation import create_presentation
        video_id = str(uuid4())
        self.api.video = {'id': video_id, 'state': 'cancelled'}
        scope = self.tool._scope()
        write_json(scope.root / 'pending.json', {'userId': OWNER, 'submissionId': str(uuid4()), 'videoSession': {'video': {'id': video_id}}})
        result = self.tool.tracked_task()
        self.assertEqual(result['unsubmittedStage'], 'failed')
        self.assertEqual(create_presentation('task', result)['state'], 'not_submitted')
        self.assertEqual(self.api.submissions, [])

    def test_unknown_submission_recovers_even_if_cached_text_is_damaged(self) -> None:
        self.api.lose_submission = True
        self.api.task_status = 'succeeded'
        with self.assertRaises(TeehoError): self.tool.diagnose(self.note)
        pending = self.root / 'accounts' / OWNER / 'pending.json'
        old = json.loads(pending.read_text(encoding='utf-8'))
        pending.write_text(json.dumps({**old, 'fields': {**old['fields'], 'topics': ['???']}}), encoding='utf-8')
        result = self.tool.resume()
        self.assertEqual(result['task']['id'], old['submissionId'])
        self.assertEqual(len(self.api.submissions), 1)

    def test_resuming_damaged_unsent_text_reports_old_draft_error(self) -> None:
        with patch.object(self.tool, '_submit', side_effect=TeehoError('request_failed')):
            with self.assertRaises(TeehoError): self.tool.diagnose(self.note)
        pending = self.root / 'accounts' / OWNER / 'pending.json'
        old = json.loads(pending.read_text(encoding='utf-8'))
        pending.write_text(json.dumps({**old, 'fields': {**old['fields'], 'topics': ['???']}}), encoding='utf-8')
        with self.assertRaisesRegex(TeehoError, 'pending_draft_invalid'):
            self.tool.resume()
        self.assertEqual(self.api.submissions, [])

    def test_new_diagnosis_is_not_blocked_by_unsent_draft_encoding(self) -> None:
        with patch.object(self.tool, '_submit', side_effect=TeehoError('request_failed')):
            with self.assertRaises(TeehoError): self.tool.diagnose(self.note)
        pending = self.root / 'accounts' / OWNER / 'pending.json'
        old = json.loads(pending.read_text(encoding='utf-8'))
        pending.write_text(json.dumps({**old, 'fields': {**old['fields'], 'topics': ['???']}}), encoding='utf-8')
        result = self.tool.diagnose(self.note)
        self.assertIn('task', result)
        self.assertEqual(len(self.api.submissions), 1)

    def test_bad_draft_with_unknown_submission_still_requires_recovery(self) -> None:
        with patch.object(self.tool, '_submit', side_effect=TeehoError('request_failed')):
            with self.assertRaises(TeehoError): self.tool.diagnose(self.note)
        pending = self.root / 'accounts' / OWNER / 'pending.json'
        old = json.loads(pending.read_text(encoding='utf-8'))
        pending.write_text(json.dumps({**old, 'submitting': True, 'fields': {**old['fields'], 'topics': ['???']}}), encoding='utf-8')
        with self.assertRaisesRegex(TeehoError, '有未确认的任务'):
            self.tool.diagnose(self.note)
        self.assertEqual(self.api.submissions, [])

    def test_video_failures_preserve_reason_and_do_not_resubmit(self) -> None:
        for code, expected_state in [('ffmpeg_timeout', 'failed'), ('unsupported_video_codec', 'invalid_input'), ('video_too_long', 'invalid_input'), ('unknown_internal_detail', 'failed')]:
            with self.subTest(code=code):
                video_id = str(uuid4())
                self.api.video = {'id': video_id, 'state': 'technical_failed', 'errorCode': code}
                with self.assertRaises(TeehoError) as raised:
                    self.tool._media(self.tool._scope())._wait_video(video_id)
                view = create_error_presentation(raised.exception)
                self.assertEqual(view['state'], expected_state)
                self.assertNotIn('invalidMedia', str(view))
                self.assertNotIn('unknown_internal_detail', str(view))
        self.assertEqual(self.api.submissions, [])

    def test_expired_video_qualification_reuploads_without_new_submission_identity(self) -> None:
        video = self.root / 'video.mp4'
        video.write_bytes(b'synthetic-video')
        self.api.lose_upload = True
        with self.assertRaises(TeehoError):
            self.tool.diagnose({**self.note, 'videos': [str(video)]})
        pending = self.root / 'accounts' / OWNER / 'pending.json'
        original = json.loads(pending.read_text(encoding='utf-8'))
        old_video_id = self.api.video['id']
        with patch.object(self.api, 'resume_video_upload_session', side_effect=TeehoError('video_upload_expired', 410)):
            result = self.tool.resume()
        self.assertNotEqual(self.api.video['id'], old_video_id)
        self.assertEqual(result['task']['id'], original['submissionId'])
        self.assertEqual(len(self.api.submissions), 1)

    def test_network_failure_keeps_old_video_record_without_reupload(self) -> None:
        video = self.root / 'video.mp4'
        video.write_bytes(b'synthetic-video')
        with patch.object(MediaTools, '_wait_video', return_value=False):
            self.tool.diagnose({**self.note, 'videos': [str(video)]})
        pending = self.root / 'accounts' / OWNER / 'pending.json'
        before = pending.read_bytes()
        with patch.object(self.api, 'get_video', side_effect=TeehoError('request_failed')):
            with self.assertRaises(TeehoError): self.tool.resume()
        self.assertEqual(pending.read_bytes(), before)
        self.assertEqual(self.api.submissions, [])

    def test_ready_video_session_resumes_without_original_video(self) -> None:
        video = self.root / "video.mp4"
        video.write_bytes(b"synthetic-video")
        with patch.object(MediaTools, "_wait_video", return_value=False):
            result = self.tool.diagnose({**self.note, "videos": [str(video)]})
        self.assertTrue(result["preparing"])
        video.unlink()
        result = self.tool.resume()
        self.assertIn("task", result)
        self.assertEqual(len(self.api.submissions), 1)

    def test_damaged_public_report_does_not_block_anonymous_history(self) -> None:
        history = HistoryTools(self.root, OWNER)
        healthy, broken = str(uuid4()), str(uuid4())
        history.save({"id": healthy, "result": {"qualitativeConclusion": {"summary": "healthy"}}})
        (history.root / (broken + ".json")).write_text("{broken", encoding="utf-8")
        public = self.root / "public"
        with patch.dict("os.environ", {"TEEHO_PUBLIC_HISTORY_DIR": str(public)}):
            publish_anonymous_history(self.root, {"user": {"id": OWNER, "isAnonymous": True}})
            public_broken = str(uuid4())
            (public / (public_broken + ".json")).write_text("{broken", encoding="utf-8")
            records = {record["id"]: record for record in visible_history(self.root, OWNER)}
            self.assertEqual(records[healthy]["summary"], "healthy")
            self.assertTrue(records[broken]["unavailable"])
            self.assertTrue(records[public_broken]["unavailable"])

    def test_completed_report_survives_corrupt_pending(self) -> None:
        task_id = self.tool.diagnose(self.note)["task"]["id"]
        self.api.tasks[task_id] = {
            "id": task_id, "status": "succeeded",
            "result": {"qualitativeConclusion": {"summary": "ready"}},
        }
        pending = self.root / "accounts" / OWNER / "pending.json"
        pending.write_text("{broken", encoding="utf-8")
        result = self.tool.task(task_id)
        self.assertEqual(result["task"]["status"], "succeeded")
        self.assertEqual(pending.read_text(encoding="utf-8"), "{broken")
        self.assertEqual(len(self.api.submissions), 1)

    def test_pending_permission_failure_requests_permission(self) -> None:
        scope = self.tool._scope()
        with patch("teeho_skill.diagnosis.read_json", side_effect=PermissionError()):
            with self.assertRaises(PermissionError) as raised:
                self.tool._pending(scope)
        self.assertEqual(create_error_presentation(raised.exception)["nextAction"], "request_permission")

    def test_corrupt_history_keeps_healthy_report_and_marks_bad_entry(self) -> None:
        history = HistoryTools(self.root, OWNER)
        healthy, broken = str(uuid4()), str(uuid4())
        history.save({"id": healthy, "result": {"qualitativeConclusion": {"summary": "healthy"}}})
        bad_file = history.root / (broken + ".json")
        bad_file.write_text("{broken", encoding="utf-8")
        records = {record["id"]: record for record in history.list()}
        self.assertEqual(records[healthy]["summary"], "healthy")
        self.assertTrue(records[broken]["unavailable"])
        self.assertEqual(bad_file.read_text(encoding="utf-8"), "{broken")

    def test_ready_images_resume_without_original_file(self) -> None:
        with patch.object(self.tool, "_submit", side_effect=TeehoError("request_failed")):
            with self.assertRaises(TeehoError):
                self.tool.diagnose(self.note)
        for image in self.note["images"]:
            Path(image).unlink()
        result = self.tool.resume()
        self.assertIn("task", result)
        self.assertEqual(len(self.api.uploads), 1)
        self.assertEqual(len(self.api.submissions), 1)

    def test_ready_image_with_lost_local_upload_flag_needs_no_file(self) -> None:
        with patch.object(self.tool, "_submit", side_effect=TeehoError("request_failed")):
            with self.assertRaises(TeehoError):
                self.tool.diagnose(self.note)
        pending = self.root / "accounts" / OWNER / "pending.json"
        state = json.loads(pending.read_text(encoding="utf-8"))
        state["assets"] = [{"id": asset["id"], "uploaded": False} for asset in state["assets"]]
        pending.write_text(json.dumps(state), encoding="utf-8")
        Path(self.note["images"][0]).unlink()
        self.tool.resume()
        self.assertEqual(len(self.api.uploads), 1)
