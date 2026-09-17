"""验证帮助内容、固定编号和字段翻译，查询用法不执行业务。"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.errors import TeehoError
from teeho_skill.help_content import help_result
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore, render_presentation

CHINESE_OVERVIEW = {
    "helpFeatures": "题火所有功能",
    "helpExecute": "执行",
    "helpView": "查看",
    "help_account_title": "登录登出账户",
    "help_diagnose_title": "笔记诊断任务",
    "help_task_title": "诊断进度与结果",
    "help_status_title": "账号信息与积分",
    "help_history_title": "分析结果历史",
    "help_help_title": "题火帮助信息",
}
EXPECTED_OVERVIEW = "\n".join(
    (
        "🔥 题火所有功能",
        "",
        "1️⃣ 执行 - 登录登出账户",
        "2️⃣ 执行 - 笔记诊断任务",
        "3️⃣ 查看 - 诊断进度与结果",
        "4️⃣ 查看 - 账号信息与积分",
        "5️⃣ 查看 - 分析结果历史",
        "6️⃣ 查看 - 题火帮助信息",
    )
)


class HelpTests(unittest.TestCase):
    def test_overview_renders_exact_six_features_after_snapshot_translation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = PresentationStore(directory, "public")
            original = store.publish(create_presentation("help", help_result({})))
            translated = store.render(original["presentationId"], CHINESE_OVERVIEW)
            self.assertEqual(translated["displayText"], EXPECTED_OVERVIEW)
            self.assertEqual(translated["state"], "ready")
            self.assertIsNone(translated["nextAction"])
            self.assertEqual(translated["translationStats"]["fallback"], 0)
            self.assertEqual(
                set(original["translation"]["fields"]), set(CHINESE_OVERVIEW)
            )
            self.assertNotRegex(str(original["translation"]["fields"]), "[1-6]️⃣|🔥")

    def test_each_topic_has_its_own_usage_and_request_examples(self) -> None:
        examples = {
            "account": "Sign out of my Teeho account.",
            "diagnose": "Diagnose the note in this folder.",
            "task": "Show the analysis result.",
            "status": "How many credits do I have left?",
            "history": "Open this saved report.",
            "help": "How do I sign in or out?",
        }
        for topic, example in examples.items():
            with self.subTest(topic=topic):
                view = create_presentation("help", help_result({"topic": topic}))
                output = render_presentation(view)
                self.assertIn(example, output)
                self.assertIn("How to use\n", output)
                self.assertIn("You can say\n", output)
                self.assertEqual(sum("️⃣" in row for row in output.splitlines()), 1)
                self.assertIsNone(view["nextAction"])

    def test_topic_translations_keep_steps_and_examples_in_the_program_layout(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = PresentationStore(directory, "public")
            original = store.publish(
                create_presentation("help", help_result({"topic": "account"}))
            )
            translations = {
                **original["translation"]["fields"],
                **CHINESE_OVERVIEW,
                "helpTitle": "题火帮助信息",
                "helpUsage": "使用方法",
                "helpExamples": "你可以这样说",
                "help_account_example_0": "帮我登录题火账户。",
                "help_account_example_1": "退出题火账户。",
            }
            output = store.render(original["presentationId"], translations)
            self.assertIn("1️⃣ 执行 - 登录登出账户", output["displayText"])
            self.assertIn(
                "\n你可以这样说\n• 帮我登录题火账户。\n• 退出题火账户。",
                output["displayText"],
            )
            self.assertEqual(output["translationStats"]["fallback"], 0)

    def test_translation_cannot_add_menu_rows_or_change_numbering(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = PresentationStore(directory, "public")
            original = store.publish(create_presentation("help", {}))
            for invalid in ("Login\n7️⃣ Install", "7️⃣ Login", "Login 🔥"):
                with self.subTest(invalid=invalid):
                    output = store.render(
                        original["presentationId"],
                        {
                            **CHINESE_OVERVIEW,
                            "help_account_title": invalid,
                            "featureList": "7️⃣ Install",
                        },
                    )
                    self.assertEqual(output["translationStats"]["fallback"], 1)
                    self.assertEqual(len(output["displayText"].splitlines()), 8)
                    self.assertNotIn("7️⃣", output["displayText"])

    def test_help_input_accepts_only_known_topics(self) -> None:
        for value in (
            None,
            [],
            {"topic": None},
            {"topic": []},
            {"topic": "logout"},
            {"topic": "../identity.json"},
            {"topic": "account", "confirmed": True},
        ):
            with self.subTest(value=value), self.assertRaises(TeehoError):
                help_result(value)

    def test_onboarding_uses_current_overview(self) -> None:
        for anonymous in (False, True):
            view = create_presentation(
                "login-status",
                {
                    "user": {"isAnonymous": anonymous},
                    "expiresAt": None,
                },
            )
            text = render_presentation(view, CHINESE_OVERVIEW)
            self.assertTrue(text.endswith(EXPECTED_OVERVIEW))


if __name__ == "__main__":
    unittest.main()
