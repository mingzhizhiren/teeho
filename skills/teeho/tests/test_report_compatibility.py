"""技能读取服务端最终报告，业务规则演进不要求重装。"""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import render_presentation

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures/presentation-golden.json").read_text(encoding="utf-8")
)


def report():
    return copy.deepcopy(next(case["result"] for case in FIXTURES if case["name"] == "report"))


class ReportCompatibilityTests(unittest.TestCase):
    def test_bad_optional_item_keeps_siblings_and_logs_only_field_context(self):
        data = report()
        result = data["task"]["result"]
        result["comparisonNotes"][0]["noteId"] = "reference-1"
        result["customMetrics"] = [
            {
                "id": "one",
                "name": "Saved metric",
                "description": "",
                "unit": "",
                "status": "available",
                "value": 0,
            },
            {"status": "future-kind", "value": "PRIVATE_VALUE"},
        ]
        result["contentAnalysis"] = {
            "status": "completed",
            "consistency": {"stars": 4, "summary": "Saved explanation", "issues": []},
            "weaknesses": [
                {
                    "location": "body",
                    "evidence": "quote",
                    "description": "Saved advice",
                    "suggestion": 123,
                    "referenceIds": [result["comparisonNotes"][0]["noteId"]],
                }
            ],
        }
        events = []
        view = create_presentation("task", data, log=lambda *args: events.append(args))
        text = render_presentation(view)
        self.assertEqual(view["state"], "completed")
        self.assertIn("Saved metric: 0", text)
        self.assertIn("Saved advice", text)
        self.assertTrue(events)
        self.assertNotIn("PRIVATE_VALUE", json.dumps(events))
        self.assertNotIn("Saved advice", json.dumps(events))

    def test_future_policy_and_version_use_final_score_without_recalculation(self):
        data = report()
        result = data["task"]["result"]
        result["schemaVersion"] = "analysis-result.v99"
        result["primaryScore"] = {"source": "future_model", "value": 6.13}
        result["insight"]["score"] = 9
        result["contentAnalysis"] = {
            "status": "completed",
            "scorePolicy": "future-policy.v99",
            "originalScore": 8,
            "consistency": {"stars": 1, "summary": "Saved consistency explanation", "issues": []},
            "termRisks": [],
            "weaknesses": [],
            "futureField": {},
        }
        view = create_presentation("task", data)
        self.assertEqual(view["state"], "completed")
        self.assertEqual(view["data"]["score"], 6.13)
        text = render_presentation(view)
        self.assertIn("6.13 / 10", text)
        self.assertIn("Saved consistency explanation", text)
        self.assertNotIn("Radar average", text)

    def test_missing_or_malformed_optional_sections_keep_core_report(self):
        fields = (
            "radar",
            "insight",
            "comparisonNotes",
            "differences",
            "contentAnalysis",
            "customMetrics",
            "riskMatches",
            "structureMetrics",
        )
        for field in fields:
            for value in (None, "future structure", 42, [None]):
                with self.subTest(field=field, value=value):
                    data = report()
                    data["task"]["result"][field] = value
                    view = create_presentation("history", data)
                    self.assertEqual(view["state"], "completed")
                    self.assertIn("7.20 / 10", render_presentation(view))

    def test_unknown_reference_reason_is_generic_and_invalid_optional_score_is_hidden(self):
        data = report()
        note = data["task"]["result"]["comparisonNotes"][0]
        note.update({"reason": "future-recall", "modelScore": "not-a-number", "likes": 0})
        text = render_presentation(create_presentation("task", data))
        self.assertIn(note["title"], text)
        self.assertNotIn("Growing rapidly", text)
        self.assertNotIn("Model score:", text)

    def test_corrupt_core_score_is_never_replaced_with_zero(self):
        for value in (None, True, "7.2", float("nan"), float("inf"), -1, 11):
            data = report()
            data["task"]["result"]["primaryScore"]["value"] = value
            view = create_presentation("task", data)
            self.assertEqual(view["state"], "invalid_response")
            self.assertNotIn("0.00 / 10", render_presentation(view))

    def test_corrupt_task_identity_and_missing_summary_remain_errors(self):
        data = report()
        data["task"]["id"] = "-" * 36
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")
        data = report()
        data["task"]["result"]["qualitativeConclusion"]["summary"] = " "
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")

    def test_malformed_optional_billing_and_difference_references_keep_report(self):
        data = report()
        data["task"]["pointReservationStatus"] = []
        result = data["task"]["result"]
        result["differences"] = [
            {"feature": "titleLength", "severity": "minor", "referenceIds": None}
        ]
        self.assertEqual(create_presentation("task", data)["state"], "completed")
