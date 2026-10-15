"""优化建议通过公开报告投影与文本渲染的兼容回归。"""

import unittest

from test_content_analysis import analysis, report_with_analysis
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore, render_presentation


def advice_view(advice: object) -> dict:
    return create_presentation(
        "task",
        report_with_analysis(
            {
                **analysis(),
                "evaluationVersion": "content-evaluation.v2",
                "advice": advice,
            }
        ),
    )


def advice_section(rendered: str) -> str:
    return rendered.split("Issues and optimization advice", 1)[1].split(
        "Shortcomings compared with reference notes", 1
    )[0]


def advice_item(
    source_id: str = "body:p2",
    location: str = "body",
    priority: str = "high",
    problem: str = "The promised comparison is missing.",
) -> dict:
    return {
        "priority": priority,
        "location": location,
        "sourceId": source_id,
        "evidence": "原文 coffee comparison",
        "problem": problem,
        "suggestion": "Add the actual comparison criteria.",
    }


class ContentAdviceTests(unittest.TestCase):
    def test_completed_empty_advice_preserves_evidence_state_and_saved_score(
        self,
    ) -> None:
        for availability in ("sufficient", "limited"):
            with self.subTest(availability=availability):
                advice = {
                    "status": "completed",
                    "evidenceAvailability": availability,
                    "items": [],
                }
                view = advice_view(advice)
                self.assertEqual(view["data"]["contentAnalysis"].get("advice"), advice)
                self.assertEqual(view["data"]["score"], 7.2)
                rendered = render_presentation(view)
                self.assertIn("No obvious shortcomings", advice_section(rendered))
                self.assertLess(
                    rendered.index("Material and title align."),
                    rendered.index("Issues and optimization advice"),
                )

    def test_five_items_preserve_quotes_locations_and_stable_priority_order(
        self,
    ) -> None:
        items = [
            advice_item("title", "title", "low", "Title problem."),
            advice_item("body:p2", "body", "medium", "Body problem."),
            advice_item("topic:1", "topics", "high", "Topic problem."),
            advice_item("material:cover", "cover", "medium", "Cover problem."),
            advice_item("material:content", "content", "low", "Material problem."),
        ]
        view = advice_view(
            {
                "status": "completed",
                "evidenceAvailability": "sufficient",
                "items": items,
            }
        )
        projected = view["data"]["contentAnalysis"]["advice"]
        self.assertEqual(projected["status"], "completed")
        self.assertEqual(
            [item["sourceId"] for item in projected["items"]],
            ["topic:1", "body:p2", "material:cover", "title", "material:content"],
        )
        envelope = PresentationStore("unused").envelope(None, view)
        block = advice_section(envelope["displayText"])
        self.assertEqual(block.count("Problem:"), 5)
        for location in (
            "Topic 1",
            "Body paragraph 2",
            "Cover",
            "Title",
            "Existing image / video materials",
        ):
            self.assertIn("Location: " + location, block)
        for priority in ("High priority", "Medium priority", "Low priority"):
            self.assertIn(priority, block)
        for item in items:
            self.assertIn(item["problem"], block)
            self.assertIn('Evidence: "' + item["evidence"] + '"', block)
            self.assertIn("Suggested action: " + item["suggestion"], block)
            self.assertIn(item["problem"], envelope["translation"]["fields"].values())
        self.assertNotIn(
            "原文 coffee comparison", envelope["translation"]["fields"].values()
        )
        self.assertNotIn("material:", block)
        self.assertNotIn("body:p", block)
        self.assertNotIn("topic:", block)
        self.assertEqual(view["data"]["score"], 7.2)

    def test_unavailable_advice_and_missing_legacy_advice_remain_distinct(self) -> None:
        view = advice_view({"status": "unavailable", "items": []})
        self.assertEqual(
            view["data"]["contentAnalysis"]["advice"],
            {"status": "unavailable", "items": []},
        )
        block = advice_section(render_presentation(view))
        self.assertIn("Optimization advice is temporarily unavailable", block)
        self.assertNotIn("No obvious shortcomings", block)
        legacy = create_presentation("task", report_with_analysis(analysis()))
        self.assertNotIn("advice", legacy["data"]["contentAnalysis"])
        self.assertNotIn("Issues and optimization advice", render_presentation(legacy))
        self.assertEqual(legacy["data"]["score"], 7.2)

    def test_bad_advice_payload_degrades_without_losing_core_report(self) -> None:
        base = {"status": "completed", "evidenceAvailability": "limited", "items": []}
        cases = (
            ("null", None),
            (
                "missing-items",
                {"status": "completed", "evidenceAvailability": "limited"},
            ),
            ("unknown-status", {**base, "status": "failed"}),
            ("unknown-availability", {**base, "evidenceAvailability": "invented"}),
            ("missing-availability", {"status": "completed", "items": []}),
            ("unknown-field", {**base, "extra": "do not display"}),
            ("non-list", {**base, "items": "invalid"}),
            ("six-items", {**base, "items": [advice_item() for _ in range(6)]}),
            (
                "unavailable-with-items",
                {"status": "unavailable", "items": [advice_item()]},
            ),
        )
        for name, advice in cases:
            with self.subTest(name=name):
                view = advice_view(advice)
                core = view["data"]["contentAnalysis"]
                self.assertEqual(view["state"], "completed")
                self.assertEqual(view["data"]["score"], 7.2)
                self.assertEqual(core["stars"], 4)
                self.assertEqual(core["advice"], {"status": "unavailable", "items": []})
                rendered = render_presentation(view)
                self.assertIn("Material and title align.", rendered)
                self.assertIn(
                    "Optimization advice is temporarily unavailable",
                    advice_section(rendered),
                )
                self.assertNotIn("No obvious shortcomings", advice_section(rendered))

    def test_invalid_item_is_not_silently_dropped_or_rendered(self) -> None:
        changes = (
            {"priority": "urgent"},
            {"location": "unknown"},
            {"sourceId": "body:p0"},
            {"sourceId": "body:p01"},
            {"sourceId": "body:p-1"},
            {"sourceId": "body:p9007199254740992"},
            {"sourceId": "topic:1"},
            {"sourceId": "material:asset-123"},
            {"sourceId": "body:p" + "1" * 80},
            {"sourceId": "title\x00"},
            {"evidence": " "},
            {"evidence": "\ufeff \ufeff"},
            {"problem": None},
            {"suggestion": "\x00"},
            {"extra": "private UUID"},
        )
        for change in changes:
            with self.subTest(change=change):
                view = advice_view(
                    {
                        "status": "completed",
                        "evidenceAvailability": "sufficient",
                        "items": [advice_item(), {**advice_item(), **change}],
                    }
                )
                self.assertEqual(
                    view["data"]["contentAnalysis"]["advice"],
                    {"status": "unavailable", "items": []},
                )
                block = advice_section(render_presentation(view))
                self.assertNotIn("The promised comparison is missing.", block)
                self.assertNotIn("private UUID", block)
                self.assertNotIn("No obvious shortcomings", block)

    def test_text_limits_use_utf16_units_and_reject_overflow_without_truncation(
        self,
    ) -> None:
        for field, count in (("evidence", 250), ("problem", 400), ("suggestion", 400)):
            for overflow in (False, True):
                with self.subTest(field=field, overflow=overflow):
                    text = "😀" * (count + int(overflow))
                    view = advice_view(
                        {
                            "status": "completed",
                            "evidenceAvailability": "limited",
                            "items": [{**advice_item(), field: "  " + text + "  "}],
                        }
                    )
                    advice = view["data"]["contentAnalysis"]["advice"]
                    if overflow:
                        self.assertEqual(advice, {"status": "unavailable", "items": []})
                    else:
                        self.assertEqual(advice["status"], "completed")
                        displayed = advice["items"][0][field]
                        actual = (
                            displayed
                            if field == "evidence"
                            else view["texts"][displayed]
                        )
                        self.assertEqual(actual, text)

    def test_localized_advice_translates_prose_but_keeps_original_evidence(
        self,
    ) -> None:
        view = advice_view(
            {
                "status": "completed",
                "evidenceAvailability": "limited",
                "items": [advice_item()],
            }
        )
        item = view["data"]["contentAnalysis"]["advice"]["items"][0]
        rendered = render_presentation(
            view,
            {
                "contentAdvice": "问题与优化建议",
                "contentAdvicePriorityHigh": "高优先级",
                "contentAdviceProblem": "问题",
                "contentAdviceLocation": "位置",
                "contentAdviceBodyParagraph": "正文段落",
                "contentAdviceEvidence": "依据",
                "contentAdviceAction": "修改方向",
                item["problem"]: "正文缺少标题承诺的对比。",
                item["suggestion"]: "补充实际对比依据。",
            },
        )
        self.assertIn("问题与优化建议\n• 高优先级", rendered)
        self.assertIn("问题: 正文缺少标题承诺的对比。", rendered)
        self.assertIn("位置: 正文段落 2", rendered)
        self.assertIn('依据: "原文 coffee comparison"', rendered)
        self.assertIn("修改方向: 补充实际对比依据。", rendered)
        self.assertEqual(view["data"]["score"], 7.2)


if __name__ == "__main__":
    unittest.main()
