"""网页组合旅程与 Skill 共用合成报告；不代表真实模型质量验收。"""

import json
import unittest
from pathlib import Path

from test_content_analysis import report
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore, render_presentation

SHARED_REPORT = Path(__file__).parent / "fixtures" / "v150-content-evaluation.json"


def shared_report() -> tuple[dict, dict]:
    fixture = json.loads(SHARED_REPORT.read_text(encoding="utf-8"))
    source = report()
    result = source["task"]["result"]
    return fixture, {
        **source,
        "task": {
            **source["task"],
            "standardTask": {
                "fields": {
                    name: {"value": value} for name, value in fixture["input"].items()
                }
            },
            "result": {
                **result,
                "primaryScore": {"source": "insight", "value": fixture["primaryScore"]},
                "insight": {**result["insight"], "score": fixture["primaryScore"]},
                "contentAnalysis": fixture["contentAnalysis"],
                "riskMatches": fixture["riskMatches"],
                "riskReviewStatus": fixture["riskReviewStatus"],
            },
        },
    }


class SharedV150ReportTests(unittest.TestCase):
    def test_shared_advice_uses_an_exact_quote_from_the_numbered_original_paragraph(
        self,
    ) -> None:
        fixture, _ = shared_report()
        note = fixture["input"]
        detail = fixture["contentAnalysis"]
        self.assertEqual(detail["consistency"]["issues"][0]["evidence"], note["title"])
        advice = detail["advice"]["items"][0]
        self.assertEqual(advice["location"], "body")
        self.assertEqual(advice["sourceId"], "body:p3")
        self.assertEqual(advice["evidence"], note["body"].splitlines()[2])

    def test_live_and_saved_skill_reports_preserve_the_shared_evaluation_and_score(
        self,
    ) -> None:
        fixture, source = shared_report()
        expected = fixture["contentAnalysis"]
        expected_advice = expected["advice"]["items"][0]
        for command in ("task", "history"):
            with self.subTest(command=command):
                view = create_presentation(command, source)
                self.assertEqual(view["state"], "completed")
                self.assertEqual(view["data"]["score"], fixture["primaryScore"])
                projected = view["data"]["contentAnalysis"]
                self.assertEqual(
                    projected["evaluationVersion"], expected["evaluationVersion"]
                )
                self.assertEqual(projected["advice"]["status"], "completed")
                item = projected["advice"]["items"][0]
                for key in ("priority", "location", "sourceId", "evidence"):
                    self.assertEqual(item[key], expected_advice[key])
                for key in ("problem", "suggestion"):
                    self.assertEqual(view["texts"][item[key]], expected_advice[key])
                envelope = PresentationStore("unused").envelope(None, view)
                rendered = envelope["displayText"]
                self.assertIn("4.20 / 10", rendered)
                self.assertIn("【Content analysis ★★☆☆☆ (2/5)】", rendered)
                self.assertEqual(rendered.count("★★☆☆☆ (2/5)"), 1)
                self.assertIn(expected["consistency"]["summary"], rendered)
                self.assertIn("Location: Body paragraph 3", rendered)
                self.assertIn(expected_advice["evidence"], rendered)
                self.assertIn(expected_advice["problem"], rendered)
                self.assertIn(expected_advice["suggestion"], rendered)
                self.assertIn("No obvious shortcomings", rendered)
                self.assertIn("No matching high-risk terms were found.", rendered)
                self.assertNotIn("body:p3", rendered)
                self.assertNotIn(
                    expected_advice["evidence"],
                    envelope["translation"]["fields"].values(),
                )
                self.assertLess(
                    rendered.index("Content consistency"),
                    rendered.index("Issues and optimization advice"),
                )
                self.assertLess(
                    rendered.index("Issues and optimization advice"),
                    rendered.index("Shortcomings compared"),
                )
                self.assertLess(
                    rendered.index("Shortcomings compared"),
                    rendered.index("High-risk terms"),
                )

    def test_chinese_skill_labels_do_not_change_shared_quotes_or_saved_score(
        self,
    ) -> None:
        fixture, source = shared_report()
        rendered = render_presentation(
            create_presentation("task", source),
            {
                "contentAnalysis": "内容分析",
                "contentConsistency": "内容一致性",
                "contentAdvice": "问题与优化建议",
                "contentAdvicePriorityHigh": "高优先级",
                "contentAdviceProblem": "问题",
                "contentAdviceLocation": "位置",
                "contentAdviceEvidence": "依据",
                "contentAdviceAction": "修改方向",
                "contentNoObviousWeaknesses": "没有明显不足",
            },
        )
        item = fixture["contentAnalysis"]["advice"]["items"][0]
        self.assertIn("【内容分析 ★★☆☆☆ (2/5)】", rendered)
        self.assertIn("问题与优化建议\n• 高优先级", rendered)
        self.assertIn('依据: "' + item["evidence"] + '"', rendered)
        self.assertIn("修改方向: " + item["suggestion"], rendered)
        self.assertIn("没有明显不足", rendered)
        self.assertIn("4.20 / 10", rendered)


if __name__ == "__main__":
    unittest.main()
