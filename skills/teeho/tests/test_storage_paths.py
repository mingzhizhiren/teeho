"""Windows 长路径的真实文件 I/O 回归，只使用独立合成目录。"""

import ctypes
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))

from teeho_skill.errors import TeehoError
from teeho_skill.locking import lock_debug_fields, lock_directory
from teeho_skill.storage import (
    _windows_user_sid,
    ensure_private_directory,
    is_link,
    native_path,
    read_json,
    write_json,
)

TASK_ID = "00000000-0000-4000-8000-000000000001"


def extended_path(path: Path) -> Path:
    """测试夹具独立构造原生路径，避免用待测转换构造期望。"""
    return Path("\\\\?\\" + str(path.absolute()))


def read_dacl(path: Path) -> str:
    """读取合成文件的实际受保护 DACL，权限验证不使用模拟。"""
    from ctypes import wintypes

    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    security.GetFileSecurityW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    security.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
        ctypes.c_void_p,
        wintypes.DWORD,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.LPWSTR),
        ctypes.c_void_p,
    ]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    length = wintypes.DWORD()
    security.GetFileSecurityW(str(path), 4, None, 0, ctypes.byref(length))
    descriptor = ctypes.create_string_buffer(length.value)
    if not security.GetFileSecurityW(
        str(path), 4, descriptor, length, ctypes.byref(length)
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    text = wintypes.LPWSTR()
    if not security.ConvertSecurityDescriptorToStringSecurityDescriptorW(
        descriptor, 1, 4, ctypes.byref(text), None
    ):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return text.value
    finally:
        kernel.LocalFree(text)


@unittest.skipUnless(os.name == "nt", "Windows native long paths")
class LongPathStorageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="teeho-long-path-"))
        # 此路径由本测试创建；只删除这个独立目录，不碰任何真实 Skill 数据。
        self.addCleanup(shutil.rmtree, extended_path(self.root))

    def target(self, length: int) -> Path:
        parent = self.root
        while length - len(str(parent)) - len(TASK_ID) - 6 > 80:
            parent = parent / ("d" * 60)
        remaining = length - len(str(parent)) - len(TASK_ID) - 7
        target = parent / ("d" * remaining) / (TASK_ID + ".json")
        self.assertEqual(len(str(target)), length)
        return target

    def test_long_json_is_written_read_replaced_and_has_no_temporary_files(
        self,
    ) -> None:
        for length in (250, 261, 340):
            with self.subTest(length=length):
                path = self.target(length)
                write_json(path, {"version": "first", "text": "中文"})
                self.assertEqual(read_json(path), {"version": "first", "text": "中文"})
                write_json(path, {"version": "second"})
                self.assertEqual(read_json(path), {"version": "second"})
                self.assertEqual(
                    [item.name for item in extended_path(path.parent).iterdir()],
                    [path.name],
                )
                extended_path(path).unlink()
                self.assertEqual(read_json(path, {"missing": True}), {"missing": True})

    def test_long_json_replace_failure_keeps_old_file_and_removes_temporary(
        self,
    ) -> None:
        path = self.target(340)
        write_json(path, {"version": "old"})
        with patch.object(Path, "replace", side_effect=OSError("synthetic failure")):
            with self.assertRaises(OSError):
                write_json(path, {"version": "new"})
        self.assertEqual(read_json(path), {"version": "old"})
        self.assertEqual(
            [item.name for item in extended_path(path.parent).iterdir()], [path.name]
        )

    def test_long_lock_blocks_duplicate_owner_and_cleans_up_after_failure(self) -> None:
        path = self.target(340).with_suffix(".lock")
        with self.assertRaisesRegex(ValueError, "synthetic operation"):
            with lock_directory(path):
                self.assertEqual(read_json(path / "owner.json")["pid"], os.getpid())
                with self.assertRaisesRegex(TeehoError, "identity_busy"):
                    with lock_directory(path):
                        self.fail("duplicate lock acquired")
                raise ValueError("synthetic operation")
        self.assertFalse(extended_path(path).exists())
        with lock_directory(path):
            self.assertTrue(extended_path(path).is_dir())
        self.assertFalse(extended_path(path).exists())

    def test_long_file_and_directory_remain_private_after_replacement(self) -> None:
        path = self.target(340)
        for value in ({"version": "first"}, {"version": "second"}):
            write_json(path, value)
            self.assertEqual(
                read_dacl(extended_path(path)), f"D:P(A;;FA;;;{_windows_user_sid()})"
            )
            self.assertEqual(
                read_dacl(extended_path(path.parent)),
                f"D:P(A;OICI;FA;;;{_windows_user_sid()})",
            )

    def test_long_lock_diagnostics_keep_logical_hash_and_read_owner(self) -> None:
        path = self.target(340).with_suffix(".lock")
        with lock_directory(path):
            fields = lock_debug_fields(path)
            self.assertEqual(fields, lock_debug_fields(extended_path(path)))
            self.assertEqual(fields["ownerPid"], os.getpid())
            self.assertEqual(
                fields["lockKeyHash"],
                hashlib.sha256(
                    os.path.normcase(str(path.absolute())).encode()
                ).hexdigest(),
            )

    def test_long_junction_is_rejected_without_changing_target_or_permissions(
        self,
    ) -> None:
        target = self.root / "junction-target"
        target.mkdir()
        marker = target / "keep.json"
        marker.write_text('{"keep":true}', encoding="utf-8")
        original_dacl = read_dacl(target)
        junction = self.target(340).with_suffix(".junction")
        extended_path(junction.parent).mkdir(parents=True)
        subprocess.run(
            [
                "cmd.exe",
                "/c",
                "mklink",
                "/J",
                str(extended_path(junction)),
                str(target),
            ],
            capture_output=True,
            check=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        try:
            self.assertTrue(is_link(junction))
            with self.assertRaisesRegex(TeehoError, "invalid_local_data"):
                ensure_private_directory(junction)
            with self.assertRaisesRegex(TeehoError, "identity_busy"):
                with lock_directory(junction):
                    self.fail("junction lock acquired")
            self.assertEqual(marker.read_text(encoding="utf-8"), '{"keep":true}')
            self.assertEqual(read_dacl(target), original_dacl)
            self.assertEqual([item.name for item in target.iterdir()], ["keep.json"])
        finally:
            extended_path(junction).rmdir()

    def test_relative_unc_and_already_extended_paths_keep_the_same_location(
        self,
    ) -> None:
        local = self.root / "nested" / ".." / "value.json"
        self.assertEqual(native_path(local), extended_path(self.root / "value.json"))
        self.assertEqual(
            native_path(extended_path(self.root)), extended_path(self.root)
        )
        # 纯路径转换不连接网络共享。
        self.assertEqual(
            str(native_path(Path(r"\\server\share\nested\..\value.json"))),
            r"\\?\UNC\server\share\value.json",
        )
        relative = Path("nested") / ".." / "value.json"
        self.assertEqual(
            native_path(relative), extended_path(Path.cwd() / "value.json")
        )


if __name__ == "__main__":
    unittest.main()
