"""验证技能参考笔记分档、空值和翻译后的完整输出。"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.engagement_display import engagement_tier
from teeho_skill.rendering import _comparison_lines


class EngagementDisplayTests(unittest.TestCase):
    def test_tier_boundaries(self) -> None:
        cases = {
            "likes": [(None, None), (0, None), (99, None), (100, "100+"), (999, "100+"),
                      (1000, "1K+"), (9999, "1K+"), (10000, "1W+"), (99999, "1W+"), (100000, "10W+")],
            "collects": [(None, None), (0, None), (99, None), (100, "100+"), (999, "100+"),
                         (1000, "1K+"), (4999, "1K+"), (5000, "5K+"), (9999, "5K+"), (10000, "1W+")],
            "comments": [(None, None), (0, None), (9, None), (10, "10+"), (99, "10+"),
                         (100, "100+"), (999, "100+"), (1000, "1000+")],
        }
        for metric, entries in cases.items():
            for count, expected in entries:
                with self.subTest(metric=metric, count=count):
                    self.assertEqual(engagement_tier(metric, count), expected)

    def test_comparison_uses_tiers_and_translated_missing_counts(self) -> None:
        labels = {"likes": "点赞", "collects": "收藏", "comments": "评论", "rapidGrowth": "快速增长",
                  "selectionReason": "入选理由", "rapid_growth": "快速增长"}
        note = {"title": "参考笔记", "excerpt": "正文", "url": "https://example.test/note",
                "likes": 91000, "collects": 15000, "comments": 1234}
        self.assertEqual(_comparison_lines(note, labels.__getitem__)[3], "点赞: 1W+ · 收藏: 1W+ · 评论: 1000+")
        missing = {**note, "likes": None, "collects": 0, "comments": 9}
        self.assertEqual(_comparison_lines(missing, labels.__getitem__)[3], "点赞: 快速增长 · 收藏: 快速增长 · 评论: 快速增长")


if __name__ == "__main__":
    unittest.main()
