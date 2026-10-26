"""升级提示仅公开随包安装说明，旧快照经新版工具重渲染仍可用。"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.errors import TeehoError
from teeho_skill.presentation import create_error_presentation
from teeho_skill.rendering import PresentationStore, render_presentation
from teeho_skill.version import (
    SkillUpgradeRequired,
    _installation_urls,
    installation_urls,
    skill_version,
)

OFFICIAL = "https://teeho.chat/skill-install.md"
GITHUB = "https://github.com/mingzhizhiren/teeho/blob/main/docs/skill-install.md"


class UpgradeInstallationTests(unittest.TestCase):
    def tearDown(self) -> None:
        _installation_urls.cache_clear()

    def test_new_upgrade_uses_bundled_urls_and_keeps_download_only_for_compatibility(
        self,
    ) -> None:
        self.assertEqual(skill_version(), "2.7.0")
        error = SkillUpgradeRequired(
            400,
            "http://localhost:9634/api",
            {
                "minimumVersion": "2.7.0",
                "latestVersion": "2.7.0",
                "officialInstallUrl": "https://untrusted.example/skill-install.md",
                "githubInstallUrl": "https://untrusted.example/alternate/skill-install.md",
                "downloadPath": "https://untrusted.example/download",
            },
        )
        self.assertEqual(error.details["officialInstallUrl"], OFFICIAL)
        self.assertEqual(error.details["githubInstallUrl"], GITHUB)
        self.assertEqual(
            error.details["downloadUrl"], "http://localhost:9634/api/skill/download"
        )
        view = create_error_presentation(error)
        rendered = render_presentation(view)
        self.assertIn(
            "Official installation instructions (recommended): " + OFFICIAL, rendered
        )
        self.assertIn(
            "GitHub installation instructions (fallback): " + GITHUB, rendered
        )
        self.assertNotIn("untrusted.example", rendered)
        self.assertNotIn("/api/skill/download", rendered)
        self.assertLess(rendered.index(OFFICIAL), rendered.index(GITHUB))
        self.assertEqual(view["nextAction"], "upgrade_skill")

    def test_legacy_upgrade_snapshot_gets_two_trusted_links_with_translatable_labels(
        self,
    ) -> None:
        legacy = {
            "state": "upgrade_required",
            "kind": "upgrade",
            "nextAction": "upgrade_skill",
            "texts": {},
            "data": {
                "currentVersion": "2.4.2",
                "minimumVersion": "2.5.3",
                "latestVersion": "2.5.3",
                "downloadUrl": "https://legacy.example/api/skill/download",
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            store = PresentationStore(temporary)
            envelope = store.publish(legacy)
            fields = envelope["translation"]["fields"]
            self.assertIn("skillOfficialInstall", fields)
            self.assertIn("skillGithubInstall", fields)
            rendered = store.render(
                envelope["presentationId"],
                {
                    "skillOfficialInstall": "官网安装说明（优先）",
                    "skillGithubInstall": "GitHub 安装说明（备用）",
                },
            )
            self.assertIn("官网安装说明（优先）: " + OFFICIAL, rendered["displayText"])
            self.assertIn("GitHub 安装说明（备用）: " + GITHUB, rendered["displayText"])
            self.assertIn("2.4.2", rendered["displayText"])
            self.assertNotIn("legacy.example", rendered["displayText"])
            self.assertEqual(rendered["nextAction"], "upgrade_skill")

    def test_snapshot_url_fields_cannot_override_the_bundled_installation_targets(
        self,
    ) -> None:
        view = create_error_presentation(
            SkillUpgradeRequired(400, "https://teeho.chat/api", {})
        )
        forged = {
            **view,
            "data": {
                **view["data"],
                "officialInstallUrl": "https://untrusted.example/one",
                "githubInstallUrl": "https://untrusted.example/two",
            },
        }
        text = render_presentation(forged)
        self.assertIn(OFFICIAL, text)
        self.assertIn(GITHUB, text)
        self.assertNotIn("untrusted.example", text)

    def test_invalid_bundled_links_fail_as_installation_error_without_network_fallback(
        self,
    ) -> None:
        for links in (
            None,
            {},
            {"official": OFFICIAL},
            {"official": "http://teeho.chat/skill-install.md", "github": GITHUB},
            {
                "official": "https://user:secret@teeho.chat/skill-install.md",
                "github": GITHUB,
            },
            {"official": OFFICIAL + "?token=secret", "github": GITHUB},
            {"official": OFFICIAL + "#run", "github": GITHUB},
            {"official": OFFICIAL + "\ncommand", "github": GITHUB},
        ):
            with self.subTest(links=links):
                _installation_urls.cache_clear()
                with patch(
                    "teeho_skill.version._release",
                    return_value={"installationUrls": links},
                ):
                    with self.assertRaises(TeehoError) as raised:
                        installation_urls()
                    self.assertEqual(
                        raised.exception.code, "invalid_skill_installation"
                    )

    def test_mutating_returned_links_does_not_change_cached_release_data(self) -> None:
        first = installation_urls()
        first["officialInstallUrl"] = "https://untrusted.example/install"
        self.assertEqual(installation_urls()["officialInstallUrl"], OFFICIAL)


if __name__ == "__main__":
    unittest.main()
