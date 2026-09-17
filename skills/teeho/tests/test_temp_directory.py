"""临时工作目录不得回退到项目内。"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_temp import create_temp_directory


class TempDirectoryTests(unittest.TestCase):
    def test_creates_unique_directories_outside_project(self) -> None:
        with tempfile.TemporaryDirectory() as base:
            with patch("teeho_temp.tempfile.gettempdir", return_value=base):
                first = create_temp_directory()
                second = create_temp_directory()
            self.assertNotEqual(first, second)
            self.assertEqual(first.parent, Path(base).resolve())
            self.assertTrue(first.is_dir())
            self.assertTrue(first.name.startswith("teeho-"))

    def test_rejects_project_temp_override_before_writing(self) -> None:
        for root in (Path.cwd(), Path.cwd() / ".tmp"):
            with self.subTest(root=root):
                with patch("teeho_temp.tempfile.gettempdir", return_value=str(root)):
                    with patch("teeho_temp.tempfile.mkdtemp") as create:
                        with self.assertRaises(ValueError):
                            create_temp_directory()
                        create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
