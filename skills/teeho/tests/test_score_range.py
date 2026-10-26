"""字符评分条通过真实报告投影与渲染入口验证。"""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import render_presentation

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures/presentation-golden.json").read_text(
        encoding="utf-8"
    )
)


class ScoreRangeTests(unittest.TestCase):
    def report(self, score: float = 7.11, **reference: object) -> dict:
        data = copy.deepcopy(
            next(case["result"] for case in FIXTURES if case["name"] == "report")
        )
        result = data["task"]["result"]
        result["primaryScore"] = {"source": "insight", "value": score}
        result["insight"]["reference"] = {
            "sampleCount": 20,
            "min": 5.41,
            "median": 6.83,
            "max": 7.87,
            **reference,
        }
        return data

    def test_live_and_historical_use_saved_final_score_without_median_marker(
        self,
    ) -> None:
        for command in ("task", "history"):
            data = self.report()
            before = copy.deepcopy(data)
            text = render_presentation(create_presentation(command, data))
            self.assertIn("range: 69.1%", text)
            self.assertIn("0% [" + "=" * 22 + "^" + "-" * 10 + "] 100%", text)
            self.assertNotRegex(text, r"(?m)^\s*v(?:\s|$)")
            self.assertIn("] 100%\n\n^ Your score: 7.11", text)
            self.assertIn("Median: 6.83", text)
            self.assertIn("^ Your score: 7.11", text)
            self.assertRegex(text, r": 5\.41\n\n[^\n]*range: 69\.1%")
            self.assertEqual(data, before)

    def test_boundaries_and_missing_evidence(self) -> None:
        for score, percent, note in ((0, "0.0%", "below"), (10, "100.0%", "above")):
            text = render_presentation(create_presentation("task", self.report(score)))
            self.assertIn("range: " + percent, text)
            self.assertIn("Your score is " + note, text)
        for reference in (
            {"min": None},
            {"max": 5.41},
            {"sampleCount": 19},
            {"median": 9},
            {"min": 8},
        ):
            text = render_presentation(
                create_presentation("task", self.report(**reference))
            )
            self.assertNotIn("0% [", text)
        data = self.report()
        data["task"]["result"]["primaryScore"]["source"] = "radar_average"
        self.assertNotIn("0% [", render_presentation(create_presentation("task", data)))

    def test_range_labels_use_the_existing_translation_flow(self) -> None:
        view = create_presentation("task", self.report())
        text = render_presentation(
            view,
            {"scoreRangeTitle": "同类评分区间位置", "scoreRangeCurrent": "本次评分"},
        )
        self.assertIn("同类评分区间位置: 69.1%", text)
        self.assertIn("^ 本次评分: 7.11", text)
