"""更新公告通过真实展示快照与 CLI 输出接缝验证。"""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.api import TeehoApi
from teeho_skill.cli import CommandRunner
from teeho_skill.errors import TeehoError
from teeho_skill.http_transport import HttpResponse
from teeho_skill.presentation import create_presentation
from teeho_skill.release_notes import (
    has_seen,
    latest_release,
    mark_seen,
)
from teeho_skill.rendering import PresentationStore, render_presentation

RELEASE = {
    "version": "1.4.1",
    "markdown": "## In this update\n\n- **Better statistics**: More accurate counts.",
}


class ReleaseNotesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runner = CommandRunner()
        self.runner.store = PresentationStore(
            Path(self.temp.name) / "site-a", owner="account-a"
        )
        self.runner.api = Mock()
        self.runner.api.get_release_notes.return_value = {"releases": [RELEASE]}
        self.view = create_presentation("help", {})

    def render(self, envelope: dict, translations: dict) -> dict:
        with patch("sys.stdout", new_callable=io.StringIO) as output:
            self.runner._render(
                {
                    "presentationId": envelope["presentationId"],
                    "translations": translations,
                }
            )
            return json.loads(output.getvalue())

    def test_english_translation_then_output_marks_and_suppresses_next_call(
        self,
    ) -> None:
        view = self.runner._with_release_notes(self.view)
        envelope = self.runner.store.publish(view)
        other_envelope = self.runner.store.publish(view)
        self.assertFalse(has_seen(self.runner.store.root, "1.4.1"))
        fields = envelope["translation"]["fields"]
        self.assertEqual(fields["releaseNoteHeading"], "What's new")
        translated = {
            **fields,
            "releaseNoteHeading": "更新日志",
            "releaseNoteLine0": "本次更新",
        }
        result = self.render(envelope, translated)
        self.assertTrue(result["displayText"].startswith("更新日志 · v1.4.1\n本次更新"))
        self.assertIn(render_presentation(self.view), result["displayText"])
        self.assertTrue(has_seen(self.runner.store.root, "1.4.1"))
        self.assertNotIn(
            "releaseNotes", self.runner._with_release_notes(self.view)["data"]
        )
        self.assertIn("releaseNotesVersion", self.render(envelope, translated))
        self.assertNotIn("releaseNotesVersion", self.render(other_envelope, translated))

    def test_broken_stdout_does_not_mark(self) -> None:
        envelope = self.runner.store.publish(self.runner._with_release_notes(self.view))
        with patch("sys.stdout") as output:
            output.flush.side_effect = BrokenPipeError()
            with self.assertRaises(BrokenPipeError):
                self.runner._render(
                    {"presentationId": envelope["presentationId"], "translations": {}}
                )
        self.assertFalse(has_seen(self.runner.store.root, "1.4.1"))

    def test_marker_failure_keeps_successful_business_output(self) -> None:
        envelope = self.runner.store.publish(self.runner._with_release_notes(self.view))
        with patch("teeho_skill.cli.mark_seen", side_effect=OSError()):
            result = self.render(envelope, envelope["translation"]["fields"])
        self.assertEqual(result["state"], self.view["state"])

    def test_failure_progress_and_unavailable_notes_do_not_block(self) -> None:
        for state in (
            "failed",
            "processing",
            "invalid_response",
            "authorization_pending",
        ):
            view = {**self.view, "state": state}
            self.assertEqual(self.runner._with_release_notes(view), view)
        self.runner.api.get_release_notes.assert_not_called()
        for error in (TeehoError("request_failed"), TimeoutError()):
            self.runner.api.get_release_notes.side_effect = error
            self.assertEqual(self.runner._with_release_notes(self.view), self.view)

    def test_latest_only_semantic_versions_and_rollback(self) -> None:
        latest = latest_release(
            {
                "releases": [
                    {**RELEASE, "version": "1.9.0"},
                    {**RELEASE, "version": "1.10.0"},
                ]
            }
        )
        self.assertEqual(latest["version"], "1.10.0")
        mark_seen(self.runner.store.root, "1.10.0")
        mark_seen(self.runner.store.root, "1.4.1")
        self.assertTrue(has_seen(self.runner.store.root, "1.10.0"))
        self.assertFalse(has_seen(self.runner.store.root, "1.11.0"))

    def test_accounts_and_services_are_isolated(self) -> None:
        mark_seen(self.runner.store.root, "1.4.1")
        for site, owner in (("site-a", "account-b"), ("site-b", "account-a")):
            store = PresentationStore(Path(self.temp.name) / site, owner=owner)
            self.assertFalse(has_seen(store.root, "1.4.1"))

    def test_invalid_catalog_is_rejected_and_empty_is_allowed(self) -> None:
        self.assertIsNone(latest_release({"releases": []}))
        for data in (
            {},
            {"releases": [None]},
            {"releases": [{**RELEASE, "version": "oops"}]},
            {"releases": [{**RELEASE, "markdown": ""}]},
        ):
            with self.assertRaises(TeehoError):
                latest_release(data)

    def test_only_english_public_endpoint_with_short_timeout(self) -> None:
        transport = Mock()
        transport.request.return_value = HttpResponse(
            200, json.dumps({"code": 0, "data": {"releases": [RELEASE]}}).encode(), {}
        )
        api = TeehoApi("https://example.com/api", transport)
        self.assertEqual(api.get_release_notes(), {"releases": [RELEASE]})
        args, kwargs = transport.request.call_args
        self.assertEqual(args[0], "https://example.com/api/release-notes/en")
        self.assertEqual(kwargs["timeout"], 3)
        self.assertNotIn("Authorization", kwargs["headers"])


if __name__ == "__main__":
    unittest.main()
