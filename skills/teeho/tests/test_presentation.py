"""使用当前契约合成样本验证展示、翻译和本机隔离。"""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.errors import TeehoError
from teeho_skill.api import TeehoApi
from teeho_skill.http_transport import HttpResponse
from teeho_skill.history import HistoryTools
from teeho_skill.note import normalize_note
from teeho_skill.messages import safe_text, safe_url
from teeho_skill.presentation import create_error_presentation, create_presentation
from teeho_skill.rendering import (
    MAX_SNAPSHOT_BYTES,
    PresentationStore,
    render_presentation,
    _radar,
    _text_width,
)
from teeho_skill.messages import ENGLISH, RADAR_METRICS

FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "presentation-golden.json").read_text(
        encoding="utf-8"
    )
)
FIRST_ID = "00000000-0000-4000-8000-000000000001"
SECOND_ID = "00000000-0000-4000-8000-000000000002"


class PresentationTests(unittest.TestCase):
    def test_installation_metadata_survives_render_in_another_process_store(self) -> None:
        cases = (
            ("help", {}, {"topics": ["account", "diagnose", "task", "status", "history", "help"]}),
            ("installation", {"configured": True, "apiUrl": "https://teeho.chat/api"},
             {"configured": True, "apiUrl": "https://teeho.chat/api"}),
        )
        with tempfile.TemporaryDirectory() as directory:
            for command, result, metadata in cases:
                with self.subTest(command=command):
                    first = PresentationStore(directory).publish(
                        create_presentation(command, result), tools_data=metadata
                    )
                    rendered = PresentationStore(directory).render(first["presentationId"], {})
                    self.assertEqual(rendered.get("toolsData"), metadata)
                    self.assertEqual(rendered["state"], "ready")

    def test_six_frozen_note_metrics_replace_legacy_differences_without_colors(self) -> None:
        data = copy.deepcopy(next(case['result'] for case in FIXTURES if case['name'] == 'report'))
        metrics = {'titleLength': 10, 'titleEmojiRatio': 0, 'bodyLength': 192,
                   'paragraphLength': 95, 'listItemCount': 0, 'topicCount': 7}
        result = data['task']['result']
        result['structureMetrics'] = metrics
        result['structureReferences'] = {
            name: {'low': 0, 'high': 0.0125 if name == 'titleEmojiRatio' else 20.25,
                   'sampleCount': 4, 'severity': 'moderate'} for name in metrics
        }
        view = create_presentation('task', data)
        self.assertEqual([row['name'] for row in view['data']['structureMetrics']], list(metrics))
        text = render_presentation(view)
        self.assertIn('Key note metrics', text)
        self.assertIn('Title emoji ratio: 0% · Average', text)
        self.assertIn('0% ~ 1.25%', text)
        self.assertIn('Average paragraph length: 95', text)
        self.assertIn('List / step item count: 0', text)
        self.assertIn('Topic count: 7', text)
        for marker in ('🟢', '🟡', '🟠', '\x1b['):
            self.assertNotIn(marker, text)

    def test_report_requires_explicit_primary_score_but_not_exact_schema_version(self) -> None:
        fixture = next(case for case in FIXTURES if case["name"] == "report")
        for version, primary in (("analysis-result.v6", {"source": "insight", "value": 7.2}), ("analysis-result.v7", None)):
            data = copy.deepcopy(fixture["result"])
            data["task"]["result"] = {**data["task"]["result"], "schemaVersion": version, "primaryScore": primary}
            self.assertEqual(
                create_presentation("task", data)["state"],
                "completed" if primary else "invalid_response",
            )

    def test_report_paths_render_literally_outside_translation_fields(self) -> None:
        fixture = next(case for case in FIXTURES if case["name"] == "report")
        media = {"cover": "D:/notes/cover.jpg", "images": ["D:/notes/cover.jpg"],
                 "video": "D:/notes/clip.mp4"}
        view = create_presentation("history", {**fixture["result"], "localMedia": media})
        self.assertEqual(view["data"]["localMedia"], media)
        self.assertNotIn("D:/notes", json.dumps(view["texts"]))
        with tempfile.TemporaryDirectory() as directory:
            envelope = PresentationStore(directory, FIRST_ID).publish(view)
            self.assertIn(media["video"], envelope["displayText"])
            self.assertNotIn("D:/notes", json.dumps(envelope["translation"]["fields"]))

    def test_weighted_reference_notice_is_hidden(self) -> None:
        fixture = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(fixture["result"])
        data["task"]["result"]["insight"]["reference"] = {
            "sampleCount": 25, "median": 4.6, "min": 1.2, "max": 8.9,
            "aggregation": "weighted_tracks",
        }
        text = render_presentation(create_presentation("task", data))
        self.assertNotIn("Track-weighted references", text)
        self.assertIn("4.60", text)

    def test_maintenance_cancellation_tells_user_to_resubmit(self) -> None:
        view = create_presentation(
            "task",
            {
                "task": {
                    "id": FIRST_ID,
                    "status": "cancelled",
                    "cancellationReason": "maintenance",
                    "pointReservationStatus": "released",
                }
            },
        )
        text = render_presentation(view)
        self.assertIn("Service maintenance interrupted this analysis", text)
        self.assertIn("submit a new diagnosis", text)

    def test_custom_metrics_keep_strings_without_translation_and_keep_zero(
        self,
    ) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        data["task"]["result"]["customMetrics"] = [
            {
                "id": "price",
                "name": "Mon prix",
                "description": "<b>literal</b>",
                "unit": "元",
                "status": "available",
                "value": 0,
            },
            {
                "id": "growth",
                "name": "Growth",
                "description": "",
                "unit": "count",
                "status": "unavailable",
                "value": None,
            },
        ]
        text = render_presentation(create_presentation("task", data))
        self.assertIn("Mon prix: 0 元", text)
        self.assertIn("Growth: Unavailable", text)

    def test_saved_average_score_is_not_presented_as_model_prediction(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        result = data["task"]["result"]
        result.update(
            schemaVersion="analysis-result.v7",
            insight=None,
            primaryScore={"source": "radar_average", "value": 7.5},
        )
        result["radar"] = dict(
            zip(
                (
                    "topicDemand",
                    "titleExpression",
                    "contentDevelopment",
                    "readingExperience",
                    "interactionPotential",
                    "distinctiveness",
                ),
                (8, 6, 7, 9, None, None),
            )
        )
        text = render_presentation(create_presentation("task", data))
        self.assertIn("Radar average score: 7.50", text)
        self.assertNotIn("Insight Engine score:", text)
        self.assertNotIn("4/6", text)

    def test_partial_radar_only_draws_available_data_points(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        data["task"]["result"]["radar"] = {
            "topicDemand": None,
            "titleExpression": 8,
            "contentDevelopment": 7,
            "readingExperience": 9,
            "interactionPotential": None,
            "distinctiveness": 6,
        }
        view = create_presentation("task", data)
        self.assertNotIn("Radar chart", render_presentation(view))
        text = "\n".join(_radar(view["data"], ENGLISH.__getitem__))
        self.assertEqual(text.count("●"), 4)

    def test_three_missing_radar_metrics_hide_diagram(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        data["task"]["result"]["radar"] = {
            "topicDemand": None,
            "titleExpression": 8,
            "contentDevelopment": 7,
            "readingExperience": 9,
            "interactionPotential": None,
            "distinctiveness": None,
        }
        view = create_presentation("task", data)
        self.assertNotIn("Radar chart", render_presentation(view))
        text = "\n".join(_radar(view["data"], ENGLISH.__getitem__))
        self.assertIn("Insufficient six-dimension evidence", text)
        self.assertIn("Title expression: 8.00 / 10", text)
        self.assertIn("Topic demand: —", text)
        self.assertNotIn("●", text)

    def test_empty_radar_keeps_six_missing_values_and_independent_score(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        result = data["task"]["result"]
        result["schemaVersion"] = "analysis-result.v7"
        result["primaryScore"] = {"source": "insight", "value": 6.33}
        result["insight"]["score"] = 6.33
        result["primaryScore"] = {"source": "insight", "value": 6.33}
        result["radar"] = dict.fromkeys(result["radar"])
        text = render_presentation(create_presentation("task", data))
        self.assertNotIn("Insufficient six-dimension evidence", text)
        self.assertEqual(text.count(": —"), 0)
        self.assertIn("6.33 / 10", text)
        self.assertNotIn("●", text)

    def test_score_reference_is_visible_beside_model_score(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        data["task"]["result"]["insight"] = {
            "status": "available",
            "score": 7.2,
            "limited": False,
            "comparison": "above",
            "reference": {
                "sampleCount": 20,
                "mean": 4.94,
                "median": 4.86,
                "min": 1.23,
                "max": 9.87,
                "p10": 2.57,
                "p90": 7.42,
            },
        }
        rendered = render_presentation(create_presentation("task", data))
        self.assertIn("highest score for comparable notes: 9.87", rendered)
        self.assertIn("lowest score for comparable notes: 1.23", rendered)
        self.assertNotIn("4.94", rendered)
        self.assertIn("4.86", rendered)
        self.assertIn("🟩", rendered)

    def test_reference_keeps_platform_access_parameter(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        data = copy.deepcopy(report["result"])
        note = data["task"]["result"]["comparisonNotes"][0]
        note["url"] = "https://www.xiaohongshu.com/explore/abc?xsec_token=public-access"
        note.pop("noteUrl", None)
        view = create_presentation("task", data)
        self.assertIn(
            "xsec_token=public-access", view["data"]["comparisons"][0]["url"] or ""
        )

    def test_cover_error_has_actionable_input_message(self) -> None:
        with self.assertRaises(TeehoError) as caught:
            normalize_note(
                {
                    "title": "t",
                    "body": "b",
                    "topics": ["x"],
                    "videos": ["video.mp4"],
                    "cover": "cover.jpg",
                    "images": [],
                }
            )
        view = create_error_presentation(caught.exception)
        self.assertEqual(view["state"], "invalid_input")
        self.assertEqual(view["nextAction"], "correct_input")
        self.assertIn("cover", render_presentation(view).lower())
        self.assertIn("images", render_presentation(view).lower())
        normalized = normalize_note(
            {
                "title": "t",
                "body": "b",
                "topics": ["x"],
                "videos": ["video.mp4"],
                "cover": "cover.jpg",
                "images": ["cover.jpg"],
            }
        )
        self.assertEqual(normalized["cover"], "cover.jpg")
        generic = create_error_presentation(TeehoError("不支持的图片格式"))
        self.assertIn("unsupported", render_presentation(generic).lower())

    def test_inspect_subdirectory_candidates_are_rendered(self) -> None:
        result = {
            "notes": [],
            "images": [],
            "videos": [],
            "directories": [
                {"name": "1", "path": "C:/notes/1"},
                {"name": "2", "path": "C:/notes/2"},
                {"name": "10", "path": "C:/notes/10"},
            ],
            "requiresSelection": True,
        }
        view = create_presentation("inspect", result)
        rendered = render_presentation(view)
        self.assertEqual(
            view["data"]["directories"], ["C:/notes/1", "C:/notes/2", "C:/notes/10"]
        )
        self.assertIn("Only this folder was checked", rendered)
        self.assertIn("C:/notes/10", rendered)

    def test_radar_uses_current_dimensions_and_score_geometry(self) -> None:
        rows = _radar({"scores": [1, 2, 3, 4, 5, 6]}, ENGLISH.__getitem__)
        self.assertIn(ENGLISH[RADAR_METRICS[0]], rows[0])
        self.assertIn(ENGLISH[RADAR_METRICS[3]], rows[-2])
        self.assertEqual("\n".join(rows).count("●"), 6)
        self.assertNotIn("◉", "\n".join(rows))
        self.assertNotEqual(rows, _radar({"scores": [9, 8, 7, 6, 5, 4]}, ENGLISH.__getitem__))

    def test_installation_usage_is_plain_text_with_unicode_brand(self) -> None:
        view = create_presentation(
            "installation", {"configured": True, "apiUrl": "https://example.test/api"}
        )
        for translations in (None, {"usage": "使用示例", "title": "标题"}):
            with self.subTest(translations=translations):
                text = render_presentation(view, translations)
                self.assertTrue(text.startswith("🔥 "))
                self.assertNotIn("```", text)
                self.assertIn("🔥", text)
                self.assertNotIn("█", text)
                self.assertIn("\n\n• ", text)
                self.assertNotIn("**", text)
                self.assertIn("#topic1 #topic2 #topic3", text)

    def test_every_presentation_uses_plain_text_chrome(self) -> None:
        for case in FIXTURES:
            with self.subTest(case=case["name"]):
                text = render_presentation(case["view"], case.get("translations"))
                self.assertTrue(text.strip())
                self.assertNotIn("```", text)
                self.assertNotRegex(text, r"(?m)^#{1,6} ")
                self.assertNotRegex(text, r"(?m)^- \*\*")
                self.assertNotIn("<https://", text)
                self.assertNotIn("SYSTEM INITIALIZING", text)
                self.assertNotIn("NETWORK       SECURE", text)

    def test_pending_task_explains_automatic_wait_and_later_resume(self) -> None:
        result = {"task": {"id": FIRST_ID, "status": "processing"}}
        active = create_presentation("task", result)
        self.assertEqual(active["nextAction"], "wait")
        self.assertIn("automatically", render_presentation(active))
        self.assertIn("5 minutes", render_presentation(active))
        yielded = create_presentation("wait", result)
        self.assertEqual(yielded["nextAction"], "wait_for_user")
        self.assertIn('"Check the analysis result"', render_presentation(yielded))
        self.assertIn("same task", render_presentation(yielded))

    def test_current_runtime_golden_views_text_and_translation_fields(self) -> None:
        for case in FIXTURES:
            with self.subTest(case=case["name"]):
                before = copy.deepcopy(case["result"])
                view = create_presentation(
                    case["command"], case["result"], case.get("anonymous", False)
                )
                self.assertEqual(view["state"], case["view"]["state"])
                self.assertEqual(view["nextAction"], case["view"]["nextAction"])
                self.assertEqual(case["result"], before)
                rendered = render_presentation(view)
                self.assertTrue(rendered.strip())
                self.assertNotIn("PRIVATE", rendered)
                if view["kind"] == "report":
                    self.assertIn("7.20 / 10", rendered)
                    self.assertNotIn("Priority actions", rendered)
                    self.assertNotIn("Publication conclusion", rendered)
                envelope = PresentationStore("unused").envelope(FIRST_ID, view)
                self.assertTrue(
                    all(
                        isinstance(value, str)
                        for value in envelope["translation"]["fields"].values()
                    )
                )

    def test_report_hides_radar_but_keeps_drawing_logic(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        for command in ("task", "history"):
            with self.subTest(command=command):
                view = create_presentation(command, report["result"])
                text = render_presentation(view)
                self.assertTrue(text.startswith("🔥 "))
                self.assertNotIn("```", text)
                self.assertNotIn("Radar chart", text)
                self.assertNotIn("╱", text)
                self.assertNotIn("Title expression", text)
                diagram = "\n".join(_radar(view["data"], ENGLISH.__getitem__))
                self.assertIn("╱", diagram)
                self.assertIn("╲", diagram)
                for icon in ("🎯", "🖼️", "📝", "📖", "💬", "⏱️"):
                    self.assertIn(icon, diagram)
                for score in view["data"]["scores"]:
                    self.assertIn(f"{score:.2f}", diagram)

    def test_sources_outside_diagram_and_private_fields_absent(self) -> None:
        report = next(case for case in FIXTURES if case["name"] == "report")
        text = render_presentation(create_presentation("task", report["result"]))
        self.assertIn("https://example.test/note", text)
        self.assertNotIn("https://example.test/reference", text)
        self.assertNotIn("PRIVATE", text)
        self.assertNotIn("token=", text)
        self.assertIn("7.20", text)

    def test_translation_rejects_numbers_urls_icons_and_control_sequences(self) -> None:
        view = {
            "state": "ready",
            "kind": "notice",
            "nextAction": None,
            "texts": {"sampleMessage": "Read 3 facts at https://example.test/a"},
            "data": {"message": "sampleMessage"},
        }
        source = render_presentation(view)
        for invalid in (
            "Read 4 facts at https://example.test/a",
            "Read 3 facts at https://example.test/b",
            "Read 3 facts at https://example.test/a 🔥",
            "Read 3\nfacts at https://example.test/a",
            "Read 3 facts at https://example.test/a\x1b[31m",
            {"nested": "data"},
            "",
        ):
            with self.subTest(invalid=invalid):
                self.assertEqual(
                    render_presentation(view, {"sampleMessage": invalid}), source
                )
        self.assertIn(
            "查看 3 条",
            render_presentation(
                view, {"sampleMessage": "查看 3 条 https://example.test/a"}
            ),
        )
        self.assertEqual(render_presentation(view, "{broken"), source)

    def test_snapshot_owner_isolation_stats_saved_and_clear(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first, second = PresentationStore(directory, "first"), PresentationStore(
                directory, "second"
            )
            view = create_presentation("help", {"features": []})
            published = first.publish(view, tools_data={"synthetic": True})
            other = second.publish(view)
            self.assertEqual(published["toolsData"], {"synthetic": True})
            self.assertNotIn("translationStats", published)
            self.assertEqual(published["delivery"], {
                "mode": "render_required", "command": "render",
                "field": "displayText", "format": "text_code_block",
                "language": "text",
            })
            localized = first.render(
                published["presentationId"], {"helpFeatures": "题火所有功能"}
            )
            self.assertEqual(
                localized["translationStats"], {"translated": 1, "fallback": 8}
            )
            with self.assertRaises(FileNotFoundError):
                second.render(published["presentationId"], {})
            saved = next(case for case in FIXTURES if case["name"] == "report")
            (first.root / (FIRST_ID + ".json")).write_text(
                json.dumps(saved["view"]), encoding="utf-8"
            )
            self.assertIn("7.20", first.render(FIRST_ID, {})["displayText"])
            (first.root / "keep.txt").write_text("keep", encoding="utf-8")
            first.clear()
            self.assertTrue((first.root / "keep.txt").exists())
            self.assertEqual(
                second.render(other["presentationId"], {})["state"], "ready"
            )
            with self.assertRaises(FileNotFoundError):
                first.render(published["presentationId"], {})

    def test_malformed_snapshots_and_path_traversal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = PresentationStore(directory)
            published = store.publish(create_presentation("help", {}))
            for invalid_id in ("../identity", "", "a" * 36, None):
                with (
                    self.subTest(identifier=invalid_id),
                    self.assertRaises((TeehoError, FileNotFoundError)),
                ):
                    store.render(invalid_id, {})
            path = store.root / (published["presentationId"] + ".json")
            for content in (
                "[]",
                "{}",
                "{bad",
                " " * (MAX_SNAPSHOT_BYTES + 1),
                json.dumps(
                    {"state": "ready", "texts": {}, "data": {}, "kind": "report"}
                ),
            ):
                path.write_text(content, encoding="utf-8")
                with self.assertRaises(TeehoError):
                    store.render(published["presentationId"], {})
            with self.assertRaises(TeehoError):
                PresentationStore(directory, "../other")

    def test_http_server_failures_are_not_reported_as_connection_failures(self) -> None:
        for status in (500, 502, 503, 504):
            for body in (b'{"code":503,"message":"PRIVATE","data":null}', b'<html>PRIVATE</html>'):
                with self.subTest(status=status, body=body):
                    transport = Mock()
                    transport.request.return_value = HttpResponse(status, body, {})
                    api = TeehoApi("http://127.0.0.1:9634/api", transport)
                    with self.assertRaises(TeehoError) as caught:
                        api.create_anonymous_identity("synthetic-device", "synthetic-machine")
                    view = create_error_presentation(caught.exception)
                    text = render_presentation(view)
                    self.assertEqual(view["state"], "service_unavailable")
                    self.assertIn("Service temporarily unavailable", text)
                    self.assertNotIn("Connection failed", text)
                    self.assertNotIn("PRIVATE", text)
                    self.assertEqual(transport.request.call_count, 1)

    def test_transport_failure_remains_connection_failure(self) -> None:
        transport = Mock()
        transport.request.side_effect = TeehoError("request_failed")
        api = TeehoApi("http://127.0.0.1:9634/api", transport)
        with self.assertRaises(TeehoError) as caught:
            api.create_anonymous_identity("synthetic-device", "synthetic-machine")
        view = create_error_presentation(caught.exception)
        self.assertEqual(view["state"], "unavailable")
        self.assertIn("Connection failed", render_presentation(view))
        self.assertEqual(transport.request.call_count, 1)

    def test_errors_are_safe_and_status_action_specific(self) -> None:
        cases = (
            (TeehoError("login_required"), "login_required", "authenticate"),
            (TeehoError("anonymous_limit"), "anonymous_limit", "login"),
            (TeehoError("PRIVATE", status=400), "invalid_request", "correct_input"),
            (TeehoError("PRIVATE", status=401), "login_required", "login"),
            (PermissionError("PRIVATE"), "permission_required", "request_permission"),
            (RuntimeError("token=PRIVATE"), "unavailable", "retry"),
            (TeehoError("invalid_local_data"), "local_error", None),
        )
        for error, state, action in cases:
            with self.subTest(error=error):
                view = create_error_presentation(error)
                self.assertEqual((view["state"], view["nextAction"]), (state, action))
                self.assertNotIn("PRIVATE", render_presentation(view))

    def test_text_and_url_sanitization(self) -> None:
        self.assertEqual(safe_text("e\u0301\n```\x1b[31m\u202e"), "é ˋˋˋ [31m")
        for url in (
            "javascript:alert(1)",
            "https://user:secret@example.test/",
            "https://example.test/?Signature=secret",
            "https://example.test/?%74oken=secret",
            "https://example.test/\nSECRET",
            "https://example.test:invalid/",
            None,
        ):
            with self.subTest(url=url):
                self.assertIsNone(safe_url(url))
        self.assertEqual(safe_url("https://example.test"), "https://example.test/")


class HistoryTests(unittest.TestCase):
    def test_save_read_list_clear_and_saved_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first, second = HistoryTools(directory, FIRST_ID), HistoryTools(
                directory, SECOND_ID
            )
            cover = Path(directory) / "original.png"
            cover.write_bytes(b"SYNTHETIC COVER")
            task = {
                "id": FIRST_ID,
                "status": "completed",
                "result": {"qualitativeConclusion": {"summary": "完整报告"}},
            }
            before = copy.deepcopy(task)
            first.save(task, cover)
            first.save({**task, "status": "changed"})
            second.save(task, cover)
            self.assertEqual(task, before)
            self.assertEqual(first.read(FIRST_ID)["task"], task)
            self.assertEqual(first.list()[0]["summary"], "完整报告")
            self.assertIsNone(first.list()[0]["cover"])
            self.assertEqual(first.list()[0]["localMedia"]["cover"], str(cover))
            self.assertFalse((first.root / (FIRST_ID + ".png")).exists())
            (first.root / "keep.txt").write_text("keep", encoding="utf-8")
            with self.assertRaises(TeehoError):
                first.clear(False)
            self.assertEqual(first.clear(True), {"cleared": True})
            self.assertEqual(first.list(), [])
            self.assertEqual(len(second.list()), 1)
            self.assertTrue(cover.exists())
            self.assertTrue((first.root / "keep.txt").exists())

    def test_media_paths_and_legacy_cover_cleanup_never_delete_originals(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = HistoryTools(directory, FIRST_ID)
            image, video = Path(directory) / "original.jpg", Path(directory) / "clip.mp4"
            image.write_bytes(b"image")
            video.write_bytes(b"video")
            media = {"cover": str(image), "images": [str(image)], "video": str(video)}
            store.save({"id": FIRST_ID}, media=media)
            self.assertEqual(store.read(FIRST_ID)["localMedia"], media)
            self.assertEqual(len(list(store.root.iterdir())), 1)
            legacy = {"task": {"id": SECOND_ID}, "savedAt": "now", "cover": SECOND_ID + ".jpg"}
            (store.root / (SECOND_ID + ".json")).write_text(json.dumps(legacy), encoding="utf-8")
            (store.root / legacy["cover"]).write_bytes(b"old copy")
            self.assertEqual(store.read(SECOND_ID), legacy)
            store.clear(True)
            self.assertTrue(image.exists())
            self.assertTrue(video.exists())
            self.assertEqual(list(store.root.iterdir()), [])

    def test_invalid_history_and_path_traversal_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(TeehoError):
                HistoryTools(directory, "../other")
            store = HistoryTools(directory, FIRST_ID)
            self.assertEqual(store.list(), [])
            with self.assertRaises(TeehoError):
                store.read("../identity")
            store.root.mkdir(parents=True)
            (store.root / (FIRST_ID + ".json")).write_text(
                json.dumps(
                    {"task": {"id": SECOND_ID}, "savedAt": "now", "cover": None}
                ),
                encoding="utf-8",
            )
            with self.assertRaises(TeehoError):
                store.read(FIRST_ID)


if __name__ == "__main__":
    unittest.main()
