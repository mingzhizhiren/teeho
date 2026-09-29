"""慢速上传遵守十分钟总期限，不使用真实网络或等待。"""

import sys
import tempfile
import unittest
from collections.abc import Iterable
from pathlib import Path
from typing import cast
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from teeho_skill.http_transport import HttpResponse, HttpTransport


class UploadTimeoutTests(unittest.TestCase):
    def test_upload_after_five_minutes_and_expiry_at_ten_minutes(self) -> None:
        for elapsed in (330, 600):
            with self.subTest(elapsed=elapsed), tempfile.TemporaryDirectory() as root:
                video = Path(root) / "video.mp4"
                video.write_bytes(b"synthetic video")
                transport = HttpTransport()
                with patch(
                    "teeho_skill.http_transport.time.monotonic", return_value=1000
                ) as clock:
                    def send(_url: str, **kwargs: object) -> HttpResponse:
                        clock.return_value = 1000 + elapsed
                        body = b"".join(cast(Iterable[bytes], kwargs["data"]))
                        self.assertEqual(kwargs["timeout"], 600)
                        self.assertIn(b"synthetic video", body)
                        return HttpResponse(200, b"{}", {})

                    with patch.object(transport, "request", side_effect=send):
                        if elapsed == 600:
                            with self.assertRaises(TimeoutError):
                                transport.upload(
                                    "https://storage.example/upload", video,
                                    "video/mp4", video.name,
                                )
                        else:
                            result = transport.upload(
                                "https://storage.example/upload", video,
                                "video/mp4", video.name,
                            )
                            self.assertEqual(result.status, 200)
