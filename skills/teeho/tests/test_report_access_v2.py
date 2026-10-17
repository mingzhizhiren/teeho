"""八篇对照报告保留服务端顺序，同时兼容旧权限与首次交付历史。"""

import copy
import tempfile
import unittest
from pathlib import Path

from test_report_access import FOOTER, HIDDEN_METRICS, OWNER, report
from teeho_skill.history import HistoryTools
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore, render_presentation
from teeho_skill.structure_metrics import METRIC_NAMES


def report_v2(limit: int = 8, anonymous: bool = False) -> dict:
    source = report(anonymous)
    result = source["task"]["result"]
    manifest = result["reportAccess"]
    first = result["comparisonNotes"][0]
    return {
        **source,
        "task": {
            **source["task"],
            "result": {
                **result,
                "reportAccess": {
                    **manifest,
                    "version": "report-access.v2",
                    "sections": {
                        **manifest["sections"],
                        "comparisonNotes": {"enabled": True, "limit": limit},
                    },
                },
                "comparisonNotes": [
                    {
                        **first,
                        "noteId": f"reference-{number}",
                        "title": f"Reference {number}",
                    }
                    for number in range(1, 9)
                ],
            },
        },
    }


class ReportAccessV2Tests(unittest.TestCase):
    def test_paid_report_renders_eight_notes_in_delivered_order_and_last_four_citations(
        self,
    ) -> None:
        source = report_v2()
        result = source["task"]["result"]
        result["comparisonNotes"] = list(reversed(result["comparisonNotes"]))
        result["contentAnalysis"]["weaknesses"][0]["referenceIds"] = [
            "reference-5",
            "reference-6",
            "reference-7",
            "reference-8",
        ]
        view = create_presentation("task", source)
        self.assertEqual(view["state"], "completed")
        self.assertEqual(
            [item["title"] for item in view["data"]["comparisons"]],
            [f"Reference {number}" for number in range(8, 0, -1)],
        )
        detail = view["data"]["contentAnalysis"]
        self.assertTrue(detail["weaknessesAvailable"])
        self.assertEqual(
            detail["weaknesses"][0]["references"],
            ["Reference 8", "Reference 7", "Reference 6", "Reference 5"],
        )
        envelope = PresentationStore("unused").envelope(None, view)
        for number in range(1, 9):
            self.assertIn(f"📕 Reference {number}", envelope["displayText"])
        self.assertIn("Issues and optimization advice", envelope["displayText"])
        self.assertEqual(view["data"]["score"], 7.2)

    def test_free_report_keeps_all_indicators_and_advice_but_only_four_notes(
        self,
    ) -> None:
        view = create_presentation("task", report_v2(4))
        self.assertEqual(view["state"], "completed")
        self.assertEqual(len(view["data"]["comparisons"]), 4)
        self.assertEqual(
            {row["name"] for row in view["data"]["structureMetrics"]},
            set(METRIC_NAMES),
        )
        self.assertIn("advice", view["data"]["contentAnalysis"])
        self.assertIsNone(view["data"]["summary"])
        envelope = PresentationStore("unused").envelope(None, view)
        for number in range(5, 9):
            self.assertNotIn(f"Reference {number}", str(envelope))
        self.assertNotIn(FOOTER, envelope["displayText"])

    def test_anonymous_v2_keeps_existing_hidden_metrics_and_footer(self) -> None:
        view = create_presentation("task", report_v2(1, True))
        self.assertEqual(view["state"], "completed")
        self.assertEqual(len(view["data"]["comparisons"]), 1)
        self.assertEqual(
            {row["name"] for row in view["data"]["structureMetrics"]},
            set(METRIC_NAMES) - set(HIDDEN_METRICS),
        )
        self.assertNotIn("advice", view["data"]["contentAnalysis"])
        self.assertTrue(render_presentation(view).endswith(FOOTER))

    def test_v1_four_notes_remain_full_and_each_version_enforces_its_limit(
        self,
    ) -> None:
        legacy = create_presentation("history", report())
        self.assertEqual(legacy["data"]["reportAccess"]["version"], "report-access.v1")
        self.assertIsNotNone(legacy["data"]["summary"])
        for version, limit in (
            ("report-access.v1", 8),
            ("report-access.v2", 9),
            ("report-access.v3", 11),
        ):
            source = report_v2(limit)
            source["task"]["result"]["reportAccess"]["version"] = version
            self.assertEqual(
                create_presentation("task", source)["state"], "invalid_response"
            )

    def test_per_finding_reference_cap_remains_four_and_short_cohorts_are_not_filled(
        self,
    ) -> None:
        source = report_v2()
        result = source["task"]["result"]
        result["contentAnalysis"]["weaknesses"][0]["referenceIds"] = [
            f"reference-{number}" for number in range(1, 6)
        ]
        view = create_presentation("task", source)
        self.assertEqual(len(view["data"]["comparisons"]), 8)
        self.assertEqual(view["data"]["contentAnalysis"]["weaknesses"], [])
        self.assertFalse(view["data"]["contentAnalysis"]["weaknessesAvailable"])
        result["comparisonNotes"] = result["comparisonNotes"][:2]
        self.assertEqual(
            len(create_presentation("task", source)["data"]["comparisons"]), 2
        )

    def test_history_and_copy_keep_original_v1_or_v2_scope_after_tier_changes(
        self,
    ) -> None:
        cases = (
            (report(), report_v2(), 4),
            (report_v2(), report_v2(4), 8),
            (report_v2(4), report_v2(), 4),
        )
        for first, later, expected_count in cases:
            with self.subTest(
                version=first["task"]["result"]["reportAccess"]["version"],
                count=expected_count,
            ):
                original = copy.deepcopy(first["task"])
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    history = HistoryTools(root, OWNER)
                    history.save(first["task"])
                    history.save(later["task"])
                    stored = history.read(first["task"]["id"])
                    self.assertEqual(stored["task"], original)
                    view = create_presentation("history", stored, anonymous=True)
                    store = PresentationStore(root, OWNER)
                    publication = store.publish(view)
                    copied = store.render(publication["presentationId"], {})[
                        "displayText"
                    ]
                    self.assertEqual(len(view["data"]["comparisons"]), expected_count)
                    self.assertIn(f"📕 Reference {expected_count}", copied)
                    if expected_count == 4:
                        self.assertNotIn("Reference 5", copied)


if __name__ == "__main__":
    unittest.main()
