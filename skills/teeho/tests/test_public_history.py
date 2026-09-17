"""匿名报告公开且跨身份可读，正式报告与凭据保持私有。"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.history import HistoryTools
from teeho_skill.public_history import (
    clear_public_owner, publish_anonymous_history, publish_report, visible_history, visible_report,
)
from teeho_skill.cli import CommandRunner
from teeho_skill.diagnosis import AccountScope, DiagnosisTools

OWNER = "00000000-0000-4000-8000-000000000001"
OTHER = "00000000-0000-4000-8000-000000000002"
TASK = "00000000-0000-4000-8000-000000000003"


class PublicHistoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.shared = self.root / "public"
        self.environment = patch.dict(os.environ, {"TEEHO_PUBLIC_HISTORY_DIR": str(self.shared)})
        self.environment.start()
        self.task = {"id": TASK, "status": "succeeded", "result": {}}

    def tearDown(self) -> None:
        self.environment.stop()
        self.directory.cleanup()

    def test_anonymous_report_visible_without_identity_and_after_login(self) -> None:
        private = HistoryTools(self.root / "user-a", OWNER)
        private.save(self.task)
        publish_anonymous_history(self.root / "user-a", {"user": {"id": OWNER, "isAnonymous": True}})
        for owner in (None, OWNER, OTHER):
            self.assertEqual([row["id"] for row in visible_history(self.root / "user-b", owner)], [TASK])
            self.assertEqual(visible_report(self.root / "user-b", owner, TASK)["task"], self.task)
        saved = json.loads((self.shared / (TASK + ".json")).read_text(encoding="utf-8"))
        self.assertEqual(saved["anonymousOwner"], OWNER)
        self.assertNotIn("deviceToken", saved)
        if os.name != "nt":
            self.assertEqual(self.shared.stat().st_mode & 0o7777, 0o1777)
            self.assertEqual((self.shared / (TASK + ".json")).stat().st_mode & 0o777, 0o644)

    def test_formal_history_is_not_published_or_visible_to_other_users(self) -> None:
        HistoryTools(self.root, OWNER).save(self.task)
        publish_anonymous_history(self.root, {"user": {"id": OWNER, "isAnonymous": False}})
        self.assertFalse(self.shared.exists())
        self.assertEqual(visible_history(self.root, OTHER), [])
        self.assertEqual(visible_history(self.root, None), [])
        self.assertEqual(len(visible_history(self.root, OWNER)), 1)

    def test_duplicate_publication_preserves_report_and_list_deduplicates(self) -> None:
        private = HistoryTools(self.root, OWNER)
        private.save(self.task)
        report = private.read(TASK)
        publish_report(report, OWNER)
        publish_report(report, OWNER)
        self.assertEqual(len(visible_history(self.root, OWNER)), 1)
        self.assertEqual(list(self.shared.glob("*.tmp")), [])

    def test_missing_public_directory_does_not_create_data_on_read(self) -> None:
        self.assertEqual(visible_history(self.root, None), [])
        self.assertFalse(self.shared.exists())

    def test_completed_anonymous_diagnosis_publishes_and_history_needs_no_api(self) -> None:
        diagnosis = DiagnosisTools(None, SimpleNamespace(root=self.root))
        scope = AccountScope(self.root / 'accounts' / OWNER, OWNER, True)
        self.assertTrue(diagnosis._save_report(scope, self.task, None))
        runner = CommandRunner()
        runner.auth = SimpleNamespace(root=self.root / 'different-system-user')
        runner.identity = None
        self.assertEqual(runner._history('history', {'taskId': TASK})['task'], self.task)
        self.assertEqual(len(runner._history('history', {})['history']), 1)

    def test_public_clear_is_limited_to_original_anonymous_owner(self) -> None:
        private = HistoryTools(self.root, OWNER)
        private.save(self.task)
        publish_report(private.read(TASK), OWNER)
        clear_public_owner(OTHER)
        self.assertEqual(len(visible_history(self.root / 'reader', None)), 1)
        clear_public_owner(OWNER)
        self.assertEqual(visible_history(self.root / 'reader', None), [])
