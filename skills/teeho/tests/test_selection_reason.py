"""入选理由与网页采用相同边界。"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill.selection_reason import selection_reason, SelectionReason


class SelectionReasonTests(unittest.TestCase):
    def test_thresholds_and_missing_values(self) -> None:
        eligible = {"likes": 10000, "collects": 1000, "comments": 100}
        self.assertEqual(selection_reason(eligible), SelectionReason.HIGH_EXPOSURE)
        for field, value in [("likes", 9999), ("collects", 999), ("comments", 99), ("comments", None)]:
            with self.subTest(field=field, value=value):
                self.assertEqual(selection_reason({**eligible, field: value}), SelectionReason.RAPID_GROWTH)
