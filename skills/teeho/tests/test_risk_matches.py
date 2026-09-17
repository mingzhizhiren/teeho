"""直接词库命中独立于 Agent 输出，旧报告从自身原文恢复。"""

import unittest
from unittest.mock import patch

from test_content_analysis import analysis, report
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import render_presentation


def risk() -> dict:
    return {
        "term": "阴道",
        "category": "生理词语",
        "location": "body",
        "evidence": "先喝口热的。阴道",
        "description": "请核对词语使用场景。",
    }


class RiskMatchesTests(unittest.TestCase):
    def test_high_risks_remain_visible_when_other_review_is_unavailable(self) -> None:
        data = report()
        data["task"]["result"].update(riskReviewStatus="unavailable", riskMatches=[
            {**risk(), "term": "杀人", "riskLevel": "high"},
            {**risk(), "term": "最", "riskLevel": "medium"},
        ])
        view = create_presentation("history", data)
        self.assertEqual([item["term"] for item in view["data"]["riskMatches"]], ["杀人"])
        text = render_presentation(view)
        self.assertIn("杀人", text)
        self.assertIn("high-risk term check could not be completed", text)

    def test_unavailable_agent_filter_does_not_fall_back_to_raw_matches(self) -> None:
        data = report()
        data["task"]["result"].update(riskReviewStatus="unavailable", riskMatches=[risk()])
        view = create_presentation("history", data)
        self.assertIsNone(view["data"]["riskMatches"])
        self.assertIn("high-risk term check could not be completed", render_presentation(view))

    def test_saved_material_descriptions_are_not_original_note_risks(self) -> None:
        data = report()
        data["task"]["result"]["riskMatches"] = [
            risk(),
            {**risk(), "location": "cover", "term": "第一"},
            {**risk(), "location": "content", "term": "第一"},
        ]
        view = create_presentation("history", data)
        self.assertEqual([item["location"] for item in view["data"]["riskMatches"]], ["body"])

    def test_track_scope_uses_all_four_tracks_without_weights(self) -> None:
        database = {
            "categories": [
                {
                    "name": "Medical",
                    "context": "Medical context",
                    "words": ["治愈"],
                    "trackCodes": [1, 3, 5, 7, 8, 10],
                },
                {
                    "name": "Global",
                    "context": "Global context",
                    "words": ["杀人", "阴道"],
                    "trackCodes": None,
                },
            ],
            "patterns": [],
        }
        for primary, secondary, expected in (
            (4, [], False),
            (4, [5], True),
            (4, [2, 6, 5], True),
            (0, [], False),
        ):
            with self.subTest(primary=primary, secondary=secondary):
                data = report()
                data["task"]["result"].update(
                    primaryTrack=primary, secondaryTracks=secondary
                )
                data["task"]["standardTask"] = {
                    "fields": {
                        "title": {"value": "旅行"},
                        "body": {"value": "治愈 杀人 阴道"},
                        "topics": {"value": []},
                    }
                }
                with patch("teeho_skill.risk_matches._database", return_value=database):
                    view = create_presentation("history", data)
                terms = {item["term"] for item in view["data"]["riskMatches"]}
                self.assertEqual("治愈" in terms, expected)
                self.assertTrue({"杀人", "阴道"}.issubset(terms))

    def test_saved_hits_filter_known_categories_and_preserve_unknown(self) -> None:
        data = report()
        result = data["task"]["result"]
        result.update(primaryTrack=4, secondaryTracks=[])
        result["riskMatches"] = [
            {**risk(), "term": "治愈", "category": "Medical"},
            risk(),
        ]
        database = {
            "categories": [
                {
                    "name": "Medical",
                    "context": "Medical",
                    "words": ["治愈"],
                    "trackCodes": [5],
                }
            ],
            "patterns": [],
        }
        with patch("teeho_skill.risk_matches._database", return_value=database):
            view = create_presentation("history", data)
        self.assertEqual(
            [item["term"] for item in view["data"]["riskMatches"]], ["阴道"]
        )
        result["primaryTrack"] = 0
        result["insight"]["tracks"] = [
            {"trackCode": 4, "weight": 0.99},
            {"trackCode": 5, "weight": 0.01},
        ]
        with patch("teeho_skill.risk_matches._database", return_value=database):
            view = create_presentation("history", data)
        self.assertEqual(len(view["data"]["riskMatches"]), 2)

    def test_direct_match_survives_empty_agent_and_fallback_and_is_last(self) -> None:
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

    def test_old_report_matches_own_saved_fields(self) -> None:
        data = report()
        data["task"]["standardTask"] = {
            "fields": {
                "title": {"value": "咖啡"},
                "body": {"value": "先喝口热的。阴道"},
                "topics": {"value": ["咖啡日常"]},
            }
        }
        data["task"]["result"]["contentAnalysis"] = analysis()
        view = create_presentation("history", data)
        self.assertEqual(view["state"], "completed")
        self.assertTrue(
            any(item["term"] == "阴道" for item in view["data"]["riskMatches"])
        )
        self.assertIn("阴道", render_presentation(view))

    def test_old_report_missing_text_does_not_claim_no_matches(self) -> None:
        text = render_presentation(create_presentation("history", report()))
        self.assertIn("The high-risk term check could not be completed.", text)
        self.assertNotIn("No risk words", text)

    def test_explicit_empty_matches_never_read_dictionary_or_agent_legacy(self) -> None:
        data = report()
        data["task"]["result"]["contentAnalysis"] = {
            **analysis(),
            "termRisks": [risk()],
        }
        data["task"]["result"]["riskMatches"] = []
        with patch("teeho_skill.risk_matches._database", side_effect=AssertionError):
            text = render_presentation(create_presentation("task", data))
        self.assertIn("No matching high-risk terms", text)
        self.assertNotIn("阴道", text)

    def test_missing_dictionary_is_explicit_and_not_empty(self) -> None:
        data = report()
        data["task"]["standardTask"] = {
            "fields": {
                key: {"value": [] if key == "topics" else "咖啡"}
                for key in ("title", "body", "topics")
            }
        }
        with patch("teeho_skill.risk_matches._database", side_effect=FileNotFoundError):
            text = render_presentation(create_presentation("history", data))
        self.assertIn("The high-risk term check could not be completed.", text)

    def test_matches_after_fortieth_and_repeated_terms_are_preserved_correctly(
        self,
    ) -> None:
        data = report()
        words = [f"risk[{index:02}]" for index in range(50)]
        data["task"]["standardTask"] = {
            "fields": {
                "title": {"value": "Coffee"},
                "body": {"value": " ".join([*words, words[0]])},
                "topics": {"value": []},
            }
        }
        database = {
            "categories": [
                {"name": "Example", "context": "Check context", "words": words}
            ],
            "patterns": [],
        }
        with patch("teeho_skill.risk_matches._database", return_value=database):
            view = create_presentation("history", data)
        self.assertEqual(len(view["data"]["riskMatches"]), 50)
        self.assertIn(words[-1], render_presentation(view))
        data["task"]["result"]["riskMatches"] = [
            {**risk(), "term": word} for word in words
        ]
        view = create_presentation("task", data)
        self.assertEqual(len(view["data"]["riskMatches"]), 50)


if __name__ == "__main__":
    unittest.main()
