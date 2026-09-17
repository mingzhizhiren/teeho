"""任务终态后的余额、重置时间及查询失败不丢报告。"""

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.cli import CommandRunner
from teeho_skill.errors import TeehoError
from teeho_skill.points_display import points_snapshot
from teeho_skill.rendering import render_presentation

OWNER = "00000000-0000-4000-8000-000000000001"
SUMMARY = {
    "summary": {
        "enabled": True,
        "balances": {"free": 15, "package": 1765, "purchased": 0, "total": 1780},
        "dailyAllowance": 30,
        "serverNow": "2026-09-10T05:59:33Z",
        "nextResetAt": "2026-09-10T16:00:00Z",
    }
}


class PointsDisplayTests(unittest.TestCase):
    def setUp(self) -> None:
        fixtures = json.loads((Path(__file__).parent / "fixtures/presentation-golden.json").read_text(encoding="utf-8"))
        self.view = next(case["view"] for case in fixtures if case["name"] == "report")
        self.runner = CommandRunner()
        self.runner.identity = {"user": {"id": OWNER}}
        self.runner.api = Mock()
        self.runner.api.get_points.return_value = SUMMARY

    def test_terminal_report_queries_bound_account_and_appends_fresh_balance(self) -> None:
        for command in ("task", "wait", "resume", "diagnose"):
            with self.subTest(command=command):
                view = self.runner._remaining_points(command, self.view)
                text = render_presentation(view)
                self.assertEqual(text.splitlines()[1], "✨ Total available credits 1780")
                self.assertEqual(text.count("Total available credits"), 1)
                self.assertNotIn("Radar chart", text)
                self.assertLess(text.index("Total available credits"), text.index("Insight engine score"))
                self.assertNotIn("10:00:27", text)
                self.assertEqual(view["state"], "completed")
        self.runner.api.get_points.assert_called_with(expected_user_id=OWNER)

    def test_points_failure_preserves_completed_report_and_does_not_fake_zero(self) -> None:
        self.runner.api.get_points.side_effect = TeehoError("PRIVATE")
        view = self.runner._remaining_points("wait", self.view)
        text = render_presentation(view)
        self.assertEqual(view["state"], "completed")
        self.assertEqual(text, render_presentation(self.view))
        self.assertNotIn("could not be retrieved", text)
        self.assertNotIn("PRIVATE", text)
        self.assertNotIn("Available credits: 0", text)
        self.assertEqual(text.splitlines()[1], "✨ Total available credits -")

    def test_report_unknown_disabled_and_zero_balances(self) -> None:
        for snapshot in (None, {"enabled": False}, {"unavailable": True}, {"enabled": True, "balances": {"free": 15}}):
            view = {**self.view, "data": {**self.view["data"], "remainingPoints": snapshot}}
            self.assertEqual(render_presentation(view).splitlines()[1], "✨ Total available credits -")
        snapshot = points_snapshot({"summary": {**SUMMARY["summary"], "balances": {"free": 0, "package": 0, "purchased": 0, "total": 0}}})
        view = {**self.view, "data": {**self.view["data"], "remainingPoints": snapshot}}
        text = render_presentation(view, {"totalAvailableCredits": "总可用积分"})
        self.assertEqual(text.splitlines()[1], "✨ 总可用积分 0")

    def test_processing_history_and_render_do_not_fetch_points(self) -> None:
        for command in ("history", "render"):
            self.assertIs(self.runner._remaining_points(command, self.view), self.view)
        pending = {**self.view, "state": "processing"}
        self.assertIs(self.runner._remaining_points("wait", pending), pending)
        self.runner.api.get_points.assert_not_called()

    def test_disabled_missing_reset_and_invalid_balance_are_distinct(self) -> None:
        self.assertEqual(points_snapshot({"summary": {"enabled": False, "balances": None}}), {"enabled": False})
        no_time = {"summary": {**SUMMARY["summary"], "nextResetAt": None}}
        self.assertIsNone(points_snapshot(no_time)["seconds"])
        invalid = {"summary": {**SUMMARY["summary"], "balances": {"free": -1}}}
        with self.assertRaises(TeehoError):
            points_snapshot(invalid)
