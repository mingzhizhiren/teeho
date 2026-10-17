"""十篇报告及各档首次交付历史遵守冻结权限。"""

import tempfile
import unittest
from pathlib import Path

from test_report_access import OWNER
from test_report_access_v2 import report_v2
from teeho_skill.history import HistoryTools
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore


def report_v3(limit: int = 10) -> dict:
    source = report_v2(limit)
    task = source["task"]
    result = task["result"]
    return {
        **source,
        "task": {
            **task,
            "result": {
                **result,
                "reportAccess": {**result["reportAccess"], "version": "report-access.v3"},
                "comparisonNotes": [
                    {
                        **result["comparisonNotes"][0],
                        "noteId": f"reference-{number}",
                        "title": f"Reference {number}",
                    }
                    for number in range(1, 11)
                ],
                "contentAnalysis": {
                    **result["contentAnalysis"],
                    "weaknesses": [
                        {
                            **result["contentAnalysis"]["weaknesses"][0],
                            "referenceIds": ["reference-9", "reference-10"],
                        }
                    ],
                },
            },
        },
    }


class ReportAccessV3Tests(unittest.TestCase):
    def test_tiers_render_and_copy_saved_limits(self) -> None:
        for count in (4, 8, 10):
            with self.subTest(count=count):
                view = create_presentation("task", report_v3(count))
                self.assertEqual(view["state"], "completed")
                self.assertEqual(len(view["data"]["comparisons"]), count)
                text = PresentationStore("unused").envelope(None, view)["displayText"]
                self.assertIn(f"📕 Reference {count}", text)
                self.assertNotIn(f"📕 Reference {count + 1}", text)
                if count == 10:
                    self.assertEqual(
                        view["data"]["contentAnalysis"]["weaknesses"][0]["references"],
                        ["Reference 9", "Reference 10"],
                    )
                    self.assertIsNotNone(view["data"]["summary"])
                else:
                    self.assertIsNone(view["data"]["summary"])

    def test_history_keeps_original_scope_across_tier_and_protocol_changes(self) -> None:
        for first, later, count in (
            (report_v2(), report_v3(), 8),
            (report_v3(), report_v3(4), 10),
            (report_v3(8), report_v3(), 8),
            (report_v3(4), report_v3(), 4),
        ):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                history = HistoryTools(root, OWNER)
                history.save(first["task"])
                history.save(later["task"])
                stored = history.read(first["task"]["id"])
                self.assertEqual(stored["task"], first["task"])
                view = create_presentation("history", stored)
                store = PresentationStore(root, OWNER)
                publication = store.publish(view)
                copied = store.render(publication["presentationId"], {})["displayText"]
                self.assertEqual(len(view["data"]["comparisons"]), count)
                self.assertIn(f"📕 Reference {count}", copied)
                self.assertNotIn(f"📕 Reference {count + 1}", copied)

    def test_invalid_capacity_and_unknown_versions_are_rejected(self) -> None:
        self.assertEqual(
            create_presentation("task", report_v3(11))["state"], "invalid_response"
        )
        source = report_v3()
        task = source["task"]
        result = task["result"]
        invalid = {
            **source,
            "task": {
                **task,
                "result": {
                    **result,
                    "reportAccess": {
                        **result["reportAccess"], "version": "report-access.v4"
                    },
                },
            },
        }
        self.assertEqual(create_presentation("task", invalid)["state"], "invalid_response")


if __name__ == "__main__":
    unittest.main()
