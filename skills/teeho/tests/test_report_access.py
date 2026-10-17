"""冻结的报告权限贯穿展示、翻译快照和跨身份本机历史。"""

import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_content_advice import advice_item
from test_content_analysis import analysis, report_with_analysis
from teeho_skill.history import HistoryTools
from teeho_skill.presentation import create_presentation
from teeho_skill.public_history import publish_report, visible_report
from teeho_skill.rendering import PresentationStore, render_presentation
from teeho_skill.report_access import CONTENT_INDICATORS
from teeho_skill.structure_metrics import METRIC_NAMES

FOOTER = "🌐向agent发送：“登录题火”解锁显示更多诊断信息"
OWNER = "00000000-0000-4000-8000-000000000010"
OTHER = "00000000-0000-4000-8000-000000000011"
HIDDEN_METRICS = (
    "imageCount",
    "videoDurationSeconds",
    "paragraphLength",
    "topicLength",
)


def access(anonymous: bool = False) -> dict:
    return {
        "version": "report-access.v1",
        "sections": {
            "contentAnalysis": {
                "enabled": True,
                "indicators": {
                    name: not (anonymous and name == "advice")
                    for name in CONTENT_INDICATORS
                },
            },
            "structureMetrics": {
                "enabled": True,
                "indicators": {
                    name: not (anonymous and name in HIDDEN_METRICS)
                    for name in METRIC_NAMES
                },
            },
            "comparisonNotes": {"enabled": True, "limit": 1 if anonymous else 4},
        },
        "footer": FOOTER if anonymous else None,
    }


def report(anonymous: bool = False) -> dict:
    detail = {
        **analysis(),
        "advice": {
            "status": "completed",
            "evidenceAvailability": "sufficient",
            "items": [advice_item(problem="Hidden advice detail.")],
        },
        "weaknesses": [
            {
                "location": "title",
                "evidence": "Coffee guide",
                "description": "The reference explains its topic clearly.",
                "suggestion": "Hidden supplementary advice.",
                "referenceIds": ["reference-1"],
            }
        ],
        "termRisks": [
            {
                "location": "body",
                "term": "guaranteed",
                "category": "Claim",
                "evidence": "guaranteed results",
                "description": "Risk detail.",
            }
        ],
    }
    source = report_with_analysis(detail)
    result = source["task"]["result"]
    first = result["comparisonNotes"][0]
    return {
        **source,
        "task": {
            **source["task"],
            "result": {
                **result,
                "reportAccess": access(anonymous),
                "riskMatches": detail["termRisks"],
                "comparisonNotes": [
                    {
                        **first,
                        "noteId": f"reference-{number}",
                        "title": f"Reference {number}",
                    }
                    for number in range(1, 5)
                ],
                "structureMetrics": {name: 10 for name in METRIC_NAMES},
                "structureReferences": {
                    name: {
                        "low": 5,
                        "high": 20,
                        "severity": "aligned",
                        "sampleCount": 30,
                    }
                    for name in METRIC_NAMES
                },
            },
        },
    }


class ReportAccessTests(unittest.TestCase):
    def test_anonymous_hides_fields_before_translation_and_puts_footer_last(
        self,
    ) -> None:
        source = report(True)
        frozen = copy.deepcopy(source)
        view = create_presentation("task", source, anonymous=True)
        self.assertEqual(view["state"], "completed")
        self.assertEqual(view["data"]["score"], 7.2)
        self.assertEqual(len(view["data"]["comparisons"]), 1)
        self.assertNotIn("advice", view["data"]["contentAnalysis"])
        self.assertEqual(
            {row["name"] for row in view["data"]["structureMetrics"]},
            set(METRIC_NAMES) - set(HIDDEN_METRICS),
        )
        envelope = PresentationStore("unused").envelope(None, view)
        serialized = json.dumps(envelope, ensure_ascii=False)
        for forbidden in (
            "Hidden advice detail",
            "Hidden supplementary advice",
            "Reference 2",
            "Average paragraph length",
            "Average topic length",
            "Image count",
            "Video duration",
            "Issues and optimization advice",
        ):
            self.assertNotIn(forbidden, serialized)
        self.assertTrue(envelope["displayText"].endswith(FOOTER))
        self.assertIn("Risk detail.", envelope["displayText"])
        self.assertEqual(source, frozen)

    def test_partial_report_without_legacy_summary_preserves_allowed_analysis(
        self,
    ) -> None:
        source = report(True)
        source["task"]["result"].pop("qualitativeConclusion")
        source["task"]["result"]["contentAnalysis"].pop("advice")
        view = create_presentation("task", source)
        self.assertEqual(view["state"], "completed")
        rendered = render_presentation(view)
        self.assertIn("Material and title align.", rendered)
        self.assertIn("7.20 / 10", rendered)
        self.assertNotIn("Optimization advice is temporarily unavailable", rendered)

    def test_individual_content_flags_hide_headings_rating_and_translation_fields(
        self,
    ) -> None:
        source = report()
        indicators = source["task"]["result"]["reportAccess"]["sections"][
            "contentAnalysis"
        ]["indicators"]
        for name in ("consistency", "weaknesses", "termRisks"):
            indicators[name] = False
        view = create_presentation("task", source)
        self.assertEqual(view["state"], "completed")
        envelope = PresentationStore("unused").envelope(None, view)
        text = envelope["displayText"]
        self.assertIn("Issues and optimization advice", text)
        self.assertIn("Hidden advice detail.", text)
        for hidden in (
            "Content consistency",
            "★★★★",
            "Shortcomings compared",
            "Risk detail.",
        ):
            self.assertNotIn(hidden, json.dumps(envelope))

    def test_disabled_modules_do_not_render_empty_sections_or_recompute_risk(
        self,
    ) -> None:
        source = report()
        sections = source["task"]["result"]["reportAccess"]["sections"]
        for section in sections.values():
            section["enabled"] = False
        with patch(
            "pathlib.Path.read_text", side_effect=AssertionError("no local risk reads")
        ):
            view = create_presentation("task", source)
        self.assertEqual(view["state"], "completed")
        rendered = render_presentation(view)
        for heading in (
            "Content analysis",
            "Key note metrics",
            "Comparable notes",
            "High-risk",
        ):
            self.assertNotIn(heading, rendered)
        self.assertIn("7.20 / 10", rendered)
        self.assertNotIn("Material and title align.", json.dumps(view))

    def test_manifest_risk_absence_does_not_fall_back_to_saved_note(self) -> None:
        source = report(True)
        source["task"]["result"].pop("riskMatches", None)
        with patch(
            "pathlib.Path.read_text", side_effect=AssertionError("no local risk reads")
        ):
            view = create_presentation("task", source)
        self.assertEqual(view["state"], "completed")
        self.assertIsNone(view["data"]["riskMatches"])
        self.assertNotIn("Risk detail.", render_presentation(view))

    def test_anonymous_report_keeps_canonical_hits_with_empty_agent_placeholder(
        self,
    ) -> None:
        source = report(True)
        source["task"]["result"]["contentAnalysis"]["termRisks"] = []
        view = create_presentation("task", source)
        self.assertEqual(view["state"], "completed")
        self.assertEqual(
            [row["term"] for row in view["data"]["riskMatches"]], ["guaranteed"]
        )
        self.assertIn("Risk detail.", render_presentation(view))

    def test_invalid_manifest_never_falls_back_to_legacy_full_access(self) -> None:
        for invalid in (
            None,
            {},
            {"version": "report-access.v2"},
            {**access(), "sections": {}},
            {**access(), "footer": "x" * 201},
            {**access(), "footer": "   "},
            {**access(), "unknownPermission": True},
            {
                **access(),
                "sections": {
                    **access()["sections"],
                    "comparisonNotes": {"enabled": True, "limit": True},
                },
            },
        ):
            source = report()
            source["task"]["result"]["reportAccess"] = invalid
            view = create_presentation("task", source)
            self.assertEqual(view["state"], "invalid_response")
            self.assertNotIn("Hidden advice detail", render_presentation(view))

    def test_full_manifest_preserves_legacy_display_and_does_not_apply_anonymous_identity(
        self,
    ) -> None:
        source = report()
        legacy = copy.deepcopy(source)
        legacy["task"]["result"].pop("reportAccess")
        # 旧报告的风险匹配走既有逻辑；对齐已保存匹配后仅比较权限对展示的影响。
        risks = source["task"]["result"]["contentAnalysis"]["termRisks"]
        source["task"]["result"]["riskMatches"] = risks
        legacy["task"]["result"]["riskMatches"] = risks
        actual = render_presentation(
            create_presentation("history", source, anonymous=True)
        )
        expected = render_presentation(create_presentation("history", legacy))
        self.assertEqual(actual, expected)
        self.assertIn("Reference 4", actual)
        self.assertNotIn(FOOTER, actual)

    def test_saved_anonymous_scope_survives_public_history_and_render_snapshot(
        self,
    ) -> None:
        source = report(True)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with patch.dict(
                os.environ, {"TEEHO_PUBLIC_HISTORY_DIR": str(root / "public")}
            ):
                history = HistoryTools(root, OWNER)
                history.save(source["task"])
                self.assertEqual(
                    history.list()[0]["summary"], "Material and title align."
                )
                publish_report(history.read(source["task"]["id"]), OWNER)
                # 后续全量结果不得覆写首次交付的本机权限快照。
                history.save(report()["task"])
                for owner in (None, OWNER, OTHER):
                    stored = visible_report(root, owner, source["task"]["id"])
                    view = create_presentation("history", stored)
                    store = PresentationStore(root, owner)
                    published = store.publish(view)
                    rendered = store.render(published["presentationId"], {})
                    self.assertEqual(len(view["data"]["comparisons"]), 1)
                    self.assertNotIn("Reference 2", rendered["displayText"])
                    self.assertTrue(rendered["displayText"].endswith(FOOTER))


if __name__ == "__main__":
    unittest.main()
