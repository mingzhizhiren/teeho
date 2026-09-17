"""内容总结、风险证据和零星评分门槛的跨端回归。"""

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.messages import RADAR_METRICS
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore, render_presentation

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "presentation-golden.json").read_text(
        encoding="utf-8"
    )
)


def report() -> dict:
    data = copy.deepcopy(
        next(case["result"] for case in FIXTURES if case["name"] == "report")
    )
    result = data["task"]["result"]
    result["comparisonNotes"][0]["noteId"] = "reference-1"
    result["differences"] = [
        {
            "feature": "titleLength",
            "severity": "minor",
            "value": 9,
            "low": 10,
            "high": 20,
            "referenceIds": ["reference-1"],
        }
    ]
    return data


def analysis(stars: int = 4, status: str = "completed") -> dict:
    return {
        "status": status,
        "originalScore": 7.2,
        "consistency": {
            "stars": stars,
            "summary": "Material and title align.",
            "issues": (
                [
                    {
                        "location": "cover",
                        "evidence": "Game map",
                        "description": "The cover does not support the coffee topic.",
                    }
                ]
                if stars == 0
                else []
            ),
        },
        "termRisks": [],
        "weaknesses": [],
    }


class ContentAnalysisTests(unittest.TestCase):
    def test_new_policy_scales_one_two_stars_and_rounds_half_up(self) -> None:
        for stars, original, expected in ((1, 4.42, 1.11), (2, 7.2, 3.6)):
            for source in ("insight", "radar_average"):
                with self.subTest(stars=stars, source=source):
                    data = report()
                    result = data["task"]["result"]
                    result["contentAnalysis"] = {
                        **analysis(stars),
                        "scorePolicy": "consistency-weighted.v1",
                        "originalScore": original,
                    }
                    result["primaryScore"] = {"source": source, "value": expected}
                    result["radar"] = dict.fromkeys(RADAR_METRICS, original)
                    result["insight"] = (
                        {**result["insight"], "score": expected}
                        if source == "insight"
                        else None
                    )
                    view = create_presentation("task", data)
                    self.assertEqual(view["state"], "completed")
                    self.assertEqual(view["data"]["score"], expected)
                    self.assertNotIn(
                        "25%" if stars == 1 else "50%", render_presentation(view)
                    )
                    result["primaryScore"]["value"] = original
                    self.assertEqual(
                        create_presentation("task", data)["state"], "invalid_response"
                    )

    def test_new_policy_leaves_three_to_five_and_fallback_unchanged(self) -> None:
        for stars, status, policy in (
            (1, "completed", None),
            (2, "completed", None),
            (3, "completed", "consistency-weighted.v1"),
            (4, "completed", "consistency-weighted.v1"),
            (5, "completed", "consistency-weighted.v1"),
            (3, "fallback", "consistency-weighted.v1"),
        ):
            with self.subTest(stars=stars, status=status, policy=policy):
                data = report()
                detail = analysis(stars, status)
                data["task"]["result"]["contentAnalysis"] = (
                    {**detail, "scorePolicy": policy} if policy else detail
                )
                view = create_presentation("task", data)
                self.assertEqual(view["state"], "completed")
                self.assertEqual(view["data"]["score"], 7.2)
                self.assertNotIn("final score retains", render_presentation(view))

    def test_old_summary_moves_above_key_differences_without_duplication(self) -> None:
        data = report()
        view = create_presentation("task", data)
        rendered = render_presentation(view)
        summary = view["texts"][view["data"]["summary"]]
        self.assertEqual(rendered.count(summary), 1)
        self.assertLess(rendered.index("Content analysis"), rendered.index(summary))
        self.assertLess(rendered.index(summary), rendered.index("Key note metrics"))

    def test_new_section_preserves_quotes_and_reference_titles(self) -> None:
        data = report()
        result = data["task"]["result"]
        selected = result["comparisonNotes"][0]
        detail = analysis()
        result["riskMatches"] = [
            {
                "term": "guaranteed",
                "category": "Absolute claim",
                "location": "body",
                "evidence": "guaranteed results",
                "description": "An unsupported promise.",
            }
        ]
        detail["weaknesses"] = [
            {
                "location": "title",
                "evidence": "Coffee guide",
                "description": "The title lacks the specific comparison in the reference.",
                "referenceIds": [selected["noteId"]],
            }
        ]
        result["contentAnalysis"] = detail
        view = create_presentation("task", data)
        envelope = PresentationStore("unused").envelope(None, view)
        rendered = envelope["displayText"]
        self.assertIn("★★★★☆ (4/5)", rendered)
        self.assertIn('guaranteed - Body: An unsupported promise.', rendered)
        self.assertIn(selected["title"], rendered)
        self.assertNotIn(result["qualitativeConclusion"]["summary"], rendered)
        fields = envelope["translation"]["fields"]
        self.assertIn("An unsupported promise.", fields.values())
        self.assertNotIn("guaranteed results", fields.values())
        self.assertEqual(view["data"]["score"], 7.2)
        self.assertLess(
            rendered.index("Shortcomings compared"), rendered.index("Key note metrics")
        )

    def test_completed_zero_stars_requires_zero_for_insight(self) -> None:
        data = report()
        result = data["task"]["result"]
        result["contentAnalysis"] = analysis(0)
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")
        result["primaryScore"]["value"] = 0
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")
        result["insight"]["score"] = 0
        view = create_presentation("task", data)
        self.assertEqual(view["state"], "completed")
        self.assertIn("0.00 / 10", render_presentation(view))
        self.assertIn("☆☆☆☆☆ (0/5)", render_presentation(view))
        self.assertIn("final score is set to 0", render_presentation(view))

    def test_zero_radar_gate_still_checks_original_average(self) -> None:
        data = report()
        result = data["task"]["result"]
        result["insight"] = None
        result["radar"] = dict.fromkeys(RADAR_METRICS, 7.2)
        result["primaryScore"] = {"source": "radar_average", "value": 0}
        result["contentAnalysis"] = analysis(0)
        self.assertEqual(create_presentation("task", data)["state"], "completed")
        result["contentAnalysis"]["originalScore"] = 8
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")
        result["contentAnalysis"]["originalScore"] = None
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")
        result.pop("contentAnalysis")
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")

    def test_zero_can_report_without_raw_model_score_or_reference_notes(self) -> None:
        data = report()
        result = data["task"]["result"]
        result["contentAnalysis"] = {**analysis(0), "originalScore": None}
        result["primaryScore"]["value"] = 0
        result["insight"]["score"] = 0
        result["comparisonNotes"] = []
        result["differences"] = []
        view = create_presentation("task", data)
        self.assertEqual(view["state"], "completed")
        self.assertIn("0.00 / 10", render_presentation(view))
        result["contentAnalysis"] = analysis(3)
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")
        result["comparisonNotes"] = report()["task"]["result"]["comparisonNotes"]
        result["contentAnalysis"]["originalScore"] = None
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")

    def test_fallback_three_stars_is_explicit_and_does_not_lower_score(self) -> None:
        data = report()
        data["task"]["result"]["contentAnalysis"] = analysis(3, "fallback")
        rendered = render_presentation(create_presentation("task", data))
        self.assertIn("★★★☆☆ (3/5)", rendered)
        self.assertIn("3 stars is a fallback", rendered)
        self.assertIn("7.20 / 10", rendered)
        self.assertNotIn("No term risks were reported", rendered)
        self.assertNotIn("No supported shortcomings", rendered)

    def test_invalid_stars_and_incorrect_nonzero_score_are_rejected(self) -> None:
        for stars, status, original in (
            (True, "completed", 7.2),
            (6, "completed", 7.2),
            (0, "fallback", 7.2),
            (4, "completed", 8),
        ):
            with self.subTest(stars=stars, status=status, original=original):
                data = report()
                data["task"]["result"]["contentAnalysis"] = {
                    **analysis(stars, status),
                    "originalScore": original,
                }
                self.assertEqual(
                    create_presentation("task", data)["state"], "invalid_response"
                )

    def test_unknown_reference_is_not_displayed_as_supported_weakness(self) -> None:
        data = report()
        data["task"]["result"]["contentAnalysis"] = {
            **analysis(),
            "weaknesses": [
                {
                    "location": "body",
                    "evidence": "Coffee",
                    "description": "Unsupported reference.",
                    "referenceIds": ["missing"],
                }
            ],
        }
        self.assertEqual(create_presentation("task", data)["state"], "invalid_response")

    def test_empty_findings_do_not_invent_weaknesses(self) -> None:
        data = report()
        data["task"]["result"]["contentAnalysis"] = analysis(5)
        rendered = render_presentation(create_presentation("task", data))
        self.assertIn("No supported shortcomings were reported", rendered)
        self.assertNotIn("Main strengths", rendered)


if __name__ == "__main__":
    unittest.main()
