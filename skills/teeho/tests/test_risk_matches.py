"""风险结论以服务端保存结果为准，历史和翻译均不扫描或二次筛选。"""

import copy
import json
import tempfile
import unittest
from unittest.mock import patch

from test_content_analysis import analysis, report
from teeho_skill.content_analysis import read_content_analysis
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore, render_presentation


def risk() -> dict:
    return {
        "term": "阴道",
        "category": "生理词语",
        "location": "body",
        "evidence": "先喝口热的。阴道",
        "description": "请核对词语使用场景。",
    }


class RiskMatchesTests(unittest.TestCase):
    def test_unused_legacy_risk_alias_is_not_projected_or_translated(self) -> None:
        data = report()
        alias = {
            **risk(),
            "term": "LEGACY_ALIAS_TERM",
            "category": "LEGACY_ALIAS_CATEGORY",
            "description": "LEGACY_ALIAS_DESCRIPTION",
        }
        data["task"]["result"]["contentAnalysis"] = {
            **analysis(),
            "termRisks": [alias],
        }
        data["task"]["result"]["riskMatches"] = [
            {
                **risk(),
                "term": "SERVER_HIT",
                "description": "Canonical risk description.",
            }
        ]
        frozen = copy.deepcopy(data)
        view = create_presentation("history", data)
        envelope = PresentationStore("unused").envelope(None, view)
        self.assertNotIn("termRisks", view["data"]["contentAnalysis"])
        self.assertNotIn("LEGACY_ALIAS", json.dumps(view))
        self.assertNotIn("LEGACY_ALIAS", json.dumps(envelope))
        self.assertIn("SERVER_HIT", envelope["displayText"])
        self.assertIn(
            "Canonical risk description.", envelope["translation"]["fields"].values()
        )
        self.assertEqual(data, frozen)
        parsed = read_content_analysis(data["task"]["result"]["contentAnalysis"])
        self.assertEqual(parsed["termRisks"][0]["term"], "LEGACY_ALIAS_TERM")

    def test_unavailable_review_preserves_all_saved_risk_levels(self) -> None:
        data = report()
        data["task"]["result"].update(
            riskReviewStatus="unavailable",
            riskMatches=[
                {**risk(), "term": "杀人", "riskLevel": "high"},
                {**risk(), "term": "最", "riskLevel": "medium"},
                risk(),
            ],
        )
        view = create_presentation("history", data)
        self.assertEqual(
            [item["term"] for item in view["data"]["riskMatches"]],
            ["杀人", "最", "阴道"],
        )
        text = render_presentation(view)
        for word in ("杀人", "最", "阴道"):
            self.assertIn(word, text)
        self.assertIn("high-risk term check could not be completed", text)

    def test_saved_locations_are_not_filtered_by_client(self) -> None:
        data = report()
        data["task"]["result"]["riskMatches"] = [
            risk(),
            {**risk(), "location": "cover", "term": "第一"},
            {**risk(), "location": "content", "term": "保证"},
        ]
        view = create_presentation("history", data)
        self.assertEqual(
            [item["location"] for item in view["data"]["riskMatches"]],
            ["body", "cover", "content"],
        )
        rendered = render_presentation(view)
        self.assertIn("第一 - Cover", rendered)
        self.assertIn("保证 - Images / video", rendered)

    def test_saved_hits_do_not_depend_on_current_track_or_category_rules(self) -> None:
        for primary, secondary in ((4, []), (4, [5]), (0, [])):
            with self.subTest(primary=primary, secondary=secondary):
                data = report()
                data["task"]["result"].update(
                    primaryTrack=primary,
                    secondaryTracks=secondary,
                    riskMatches=[
                        {**risk(), "term": "治愈", "category": "Medical"},
                        risk(),
                    ],
                )
                with patch(
                    "pathlib.Path.read_text",
                    side_effect=AssertionError("no dictionary"),
                ):
                    view = create_presentation("history", data)
                self.assertEqual(
                    [item["term"] for item in view["data"]["riskMatches"]],
                    ["治愈", "阴道"],
                )

    def test_saved_match_survives_empty_agent_and_fallback_without_rescanning(
        self,
    ) -> None:
        for status in ("completed", "fallback"):
            data = report()
            data["task"]["result"]["contentAnalysis"] = analysis(3, status)
            data["task"]["result"]["riskMatches"] = [risk()]
            text = render_presentation(create_presentation("task", data))
            self.assertIn("阴道", text)
            self.assertIn("7.20 / 10", text)
            self.assertLess(
                text.index("High-risk terms"), text.index("Comparable notes")
            )

    def test_old_report_missing_matches_does_not_rescan_saved_text_or_agent_findings(
        self,
    ) -> None:
        data = report()
        data["task"]["standardTask"] = {
            "fields": {
                "title": {"value": "咖啡"},
                "body": {"value": "先喝口热的。阴道"},
                "topics": {"value": ["咖啡日常"]},
            }
        }
        data["task"]["result"]["contentAnalysis"] = {
            **analysis(),
            "termRisks": [risk()],
        }
        data["task"]["result"].pop("riskMatches", None)
        with patch(
            "pathlib.Path.read_text", side_effect=AssertionError("no dictionary")
        ):
            view = create_presentation("history", data)
            envelope = PresentationStore("unused").envelope(None, view)
        self.assertEqual(view["state"], "completed")
        self.assertIsNone(view["data"]["riskMatches"])
        self.assertIn(
            "No risk detection results were provided.", envelope["displayText"]
        )
        self.assertNotIn("No matching high-risk terms", envelope["displayText"])
        self.assertNotIn("阴道", envelope["displayText"])
        self.assertNotIn(
            "请核对词语使用场景。", envelope["translation"]["fields"].values()
        )

    def test_explicit_empty_matches_are_confirmed_without_using_agent_alias(
        self,
    ) -> None:
        data = report()
        data["task"]["result"]["contentAnalysis"] = {
            **analysis(),
            "termRisks": [risk()],
        }
        data["task"]["result"]["riskMatches"] = []
        with patch(
            "pathlib.Path.read_text", side_effect=AssertionError("no dictionary")
        ):
            text = render_presentation(create_presentation("task", data))
        self.assertIn("No matching high-risk terms", text)
        self.assertNotIn("阴道", text)

    def test_unavailable_empty_result_does_not_claim_confirmed_no_hits(self) -> None:
        data = report()
        data["task"]["result"].update(riskMatches=[], riskReviewStatus="unavailable")
        view = create_presentation("task", data)
        self.assertEqual(view["data"]["riskMatches"], [])
        text = render_presentation(view)
        self.assertIn("The high-risk term check could not be completed.", text)
        self.assertNotIn("No matching high-risk terms", text)

    def test_invalid_optional_saved_result_does_not_fall_back_to_agent_alias(
        self,
    ) -> None:
        for invalid in (None, "invalid", [None]):
            data = report()
            data["task"]["result"]["contentAnalysis"] = {
                **analysis(),
                "termRisks": [risk()],
            }
            data["task"]["result"]["riskMatches"] = invalid
            view = create_presentation("task", data)
            self.assertEqual(view["state"], "completed")
            self.assertIsNone(view["data"]["riskMatches"])
            self.assertNotIn("阴道", render_presentation(view))

    def test_saved_matches_after_fortieth_and_duplicates_keep_server_order(
        self,
    ) -> None:
        data = report()
        words = [f"risk[{index:02}]" for index in range(50)]
        saved = [*words, words[0]]
        data["task"]["result"]["riskMatches"] = [
            {**risk(), "term": word} for word in saved
        ]
        view = create_presentation("task", data)
        self.assertEqual(
            [item["term"] for item in view["data"]["riskMatches"]],
            saved,
        )
        self.assertIn(words[-1], render_presentation(view))

    def test_translation_snapshot_keeps_saved_risks_without_a_dictionary(self) -> None:
        data = report()
        data["task"]["result"]["riskMatches"] = [
            {**risk(), "description": "Check the saved context.", "location": "cover"},
        ]
        view = create_presentation("history", data)
        match = view["data"]["riskMatches"][0]
        with tempfile.TemporaryDirectory() as directory:
            store = PresentationStore(directory)
            published = store.publish(view)
            with patch(
                "pathlib.Path.read_text", side_effect=AssertionError("no dictionary")
            ):
                rendered = store.render(
                    published["presentationId"],
                    {match["description"]: "请核对已保存的使用场景。"},
                )
            self.assertIn(
                "阴道 - Cover: 请核对已保存的使用场景。", rendered["displayText"]
            )
            self.assertEqual(rendered["state"], "completed")


if __name__ == "__main__":
    unittest.main()
