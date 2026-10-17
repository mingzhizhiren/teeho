"""锁诊断必须与释放同步，不能把成功业务结果覆盖成文件权限错误。"""

import os
import json
import subprocess
import sys
import tempfile
import threading
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill import locking
from teeho_skill.auth import AuthSession
from teeho_skill.errors import TeehoError

PROBE_TIMEOUT_SECONDS = 5


class LockDiagnosticsTests(unittest.TestCase):
    def test_another_process_cannot_read_owner_while_guard_is_held(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.lock"
            tools = str(Path(__file__).resolve().parents[1] / "tools")
            script = (
                "import sys,json; from pathlib import Path; sys.path.insert(0,sys.argv[2]); "
                "from teeho_skill.locking import lock_debug_fields; "
                "print(json.dumps(lock_debug_fields(Path(sys.argv[1]))))"
            )
            with locking.lock_directory(path):
                with locking._acquisition_guard(path):
                    result = subprocess.run(
                        [
                            sys.executable,
                            "-B",
                            "-X",
                            "utf8",
                            "-c",
                            script,
                            str(path),
                            tools,
                        ],
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        timeout=PROBE_TIMEOUT_SECONDS,
                        check=True,
                        creationflags=(
                            subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
                        ),
                    )
                self.assertNotIn("ownerPid", json.loads(result.stdout))
            self.assertFalse(path.exists())

    def test_busy_guard_skips_owner_read_without_error(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.lock"
            with locking.lock_directory(path):
                with patch.object(
                    locking,
                    "_acquisition_guard",
                    side_effect=TeehoError("identity_busy"),
                ), patch.object(locking, "read_json") as read:
                    fields = locking.lock_debug_fields(path)
                read.assert_not_called()
                self.assertEqual(fields["lockKind"], "identity")
                self.assertNotIn("ownerPid", fields)
            self.assertFalse(path.exists())

    @unittest.skipUnless(os.name == "nt", "Windows 文件占用删除语义")
    def test_debug_reader_racing_identity_release_preserves_business_result(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "identity.lock"
            session = AuthSession(Path(folder), object(), "https://api.example")
            start, ready, finish = (threading.Event() for _ in range(3))
            original_guard, original_read = (
                locking._acquisition_guard,
                locking.read_json,
            )

            def read_with_open_file(
                current: Path, *args: object, **kwargs: object
            ) -> object:
                if threading.current_thread().name != "diagnostic-reader":
                    return original_read(current, *args, **kwargs)
                with Path(current).open("rb"):
                    ready.set()
                    if not finish.wait(PROBE_TIMEOUT_SECONDS):
                        raise RuntimeError("diagnostic probe timed out")
                    return original_read(current, *args, **kwargs)

            def observe() -> None:
                if start.wait(PROBE_TIMEOUT_SECONDS):
                    try:
                        locking.lock_debug_fields(path)
                    finally:
                        ready.set()

            @contextmanager
            def release_guard(current: Path, wait: bool = False) -> Iterator[None]:
                with original_guard(current, wait=wait):
                    if wait:
                        # 释放持有守卫时，另一个进程可能正要记录 owner；固定该交错。
                        start.set()
                        self.assertTrue(ready.wait(PROBE_TIMEOUT_SECONDS))
                    yield

            def query_succeeded() -> dict:
                with session._locked():
                    return {"status": "processing"}

            observer = threading.Thread(target=observe, name="diagnostic-reader")
            observer.start()
            try:
                with patch.object(
                    locking, "read_json", side_effect=read_with_open_file
                ), patch.object(locking, "_acquisition_guard", release_guard):
                    self.assertEqual(query_succeeded(), {"status": "processing"})
            finally:
                finish.set()
                observer.join(PROBE_TIMEOUT_SECONDS)
                self.assertFalse(observer.is_alive())
            self.assertFalse(path.exists())
            # 释放后下一次真实获取也必须成功，而不是依赖死进程回收。
            with locking.lock_directory(path):
                pass
