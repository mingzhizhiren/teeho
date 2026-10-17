"""业务 HTTP 不占身份锁；并发续期及 401 恢复始终绑定原登录会话。"""

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import test_runtime as fixtures
from teeho_skill.auth import AuthSession
from teeho_skill.api import TeehoApi
from teeho_skill.diagnosis import DiagnosisTools
from teeho_skill.errors import TeehoError
from teeho_skill.http_transport import HttpTransport
from teeho_skill.presentation import create_presentation
from teeho_skill.rendering import PresentationStore
from teeho_skill.storage import read_json, write_json

OWNER = fixtures.USER_ID
TIMEOUT_SECONDS = 5
OLD_TOKEN = "synthetic-old-access"
NEW_TOKEN = "synthetic-new-access"


class AuthConcurrencyTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(prefix="teeho-auth-concurrency-")
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = self.root / "identity.json"
        self.identity = {
            **fixtures.ISSUED,
            "baseUrl": fixtures.BASE_URL,
            "deviceToken": "synthetic-original-device",
            "accessToken": OLD_TOKEN,
        }
        self.issued = {**fixtures.ISSUED, "accessToken": NEW_TOKEN}
        self.public = SimpleNamespace(exchange_token=Mock(return_value=self.issued))
        write_json(self.path, self.identity)

    def session(self, base_url: str = fixtures.BASE_URL) -> AuthSession:
        return AuthSession(self.root, self.public, base_url)

    def _child_query(self, base_url: str, task_id: str) -> subprocess.Popen:
        script = (
            "import json,sys; from pathlib import Path; sys.path.insert(0,sys.argv[1]); "
            "from teeho_skill.api import TeehoApi; from teeho_skill.auth import AuthSession; "
            "from teeho_skill.http_transport import HttpTransport; transport=HttpTransport(); "
            "auth=AuthSession(Path(sys.argv[2]),TeehoApi(sys.argv[3],transport),sys.argv[3]); "
            "api=TeehoApi(sys.argv[3],transport,authorize=auth.authorized); "
            "print(json.dumps(api.get_task(sys.argv[4],expected_user_id=sys.argv[5])))"
        )
        return subprocess.Popen(
            [
                sys.executable,
                "-B",
                "-X",
                "utf8",
                "-c",
                script,
                str(Path(__file__).resolve().parents[1] / "tools"),
                str(self.root),
                base_url,
                task_id,
                OWNER,
            ],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )

    def test_slow_http_query_does_not_block_another_process(self) -> None:
        entered, release = threading.Event(), threading.Event()
        slow_id = "11111111-1111-4111-8111-111111111111"
        fast_id = "22222222-2222-4222-8222-222222222222"

        def respond(path: str, body: bytes) -> tuple[int, dict, bytes]:
            if path.endswith(slow_id):
                entered.set()
                release.wait(TIMEOUT_SECONDS * 2)
            task = {"id": path.rsplit("/", 1)[-1], "status": "processing"}
            return 200, {}, json.dumps({"code": 0, "data": {"task": task}}).encode()

        server = fixtures.LocalServer(respond)
        self.addCleanup(server.close)
        self.addCleanup(release.set)
        base_url = server.url + "/api"
        write_json(self.path, {**self.identity, "baseUrl": base_url})
        slow = self._child_query(base_url, slow_id)
        fast = None
        try:
            self.assertTrue(entered.wait(TIMEOUT_SECONDS))
            fast = self._child_query(base_url, fast_id)
            stdout, stderr = fast.communicate(timeout=TIMEOUT_SECONDS)
            self.assertEqual(fast.returncode, 0, stderr.decode())
            self.assertEqual(json.loads(stdout)["task"]["id"], fast_id)
            self.assertIsNone(slow.poll())
        finally:
            release.set()
            for process in (slow, fast):
                if process is not None:
                    try:
                        process.communicate(timeout=TIMEOUT_SECONDS)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate()

    def test_concurrent_expired_credentials_refresh_once(self) -> None:
        write_json(
            self.path, {**self.identity, "accessExpiresAt": "2000-01-01T00:00:00Z"}
        )
        barrier = threading.Barrier(2)

        def operation(token: str) -> dict:
            barrier.wait(TIMEOUT_SECONDS)
            return {"newCredential": token == NEW_TOKEN}

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(self.session().authorized, operation, OWNER)
                for _ in range(2)
            ]
            results = [future.result(TIMEOUT_SECONDS * 2) for future in futures]
        self.assertEqual(results, [{"newCredential": True}] * 2)
        self.public.exchange_token.assert_called_once_with(self.identity["deviceToken"])

    def test_concurrent_401_responses_share_one_refresh(self) -> None:
        barrier = threading.Barrier(2)

        def operation(token: str) -> dict:
            if token == OLD_TOKEN:
                barrier.wait(TIMEOUT_SECONDS)
                raise TeehoError("login_required", 401)
            return {"newCredential": token == NEW_TOKEN}

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [
                pool.submit(self.session().authorized, operation) for _ in range(2)
            ]
            results = [future.result(TIMEOUT_SECONDS * 2) for future in futures]
        self.assertEqual(results, [{"newCredential": True}] * 2)
        self.public.exchange_token.assert_called_once_with(self.identity["deviceToken"])

    def _reject_after_identity_change(self, replacement: dict, code: str) -> None:
        def operation(token: str) -> dict:
            write_json(self.path, replacement)
            raise TeehoError("login_required", 401)

        call = Mock(side_effect=operation)
        with self.assertRaisesRegex(TeehoError, code):
            self.session().authorized(call)
        call.assert_called_once_with(OLD_TOKEN)
        self.public.exchange_token.assert_not_called()
        self.assertEqual(read_json(self.path), replacement)

    def test_401_after_account_switch_does_not_use_new_account(self) -> None:
        self._reject_after_identity_change(
            {**self.identity, "user": {"id": fixtures.OTHER_ID, "isAnonymous": False}},
            "账号已切换",
        )

    def test_401_after_new_login_of_same_account_stops_old_session(self) -> None:
        self._reject_after_identity_change(
            {
                **self.identity,
                "deviceToken": "synthetic-replacement-device",
                "accessToken": NEW_TOKEN,
            },
            "账号已切换",
        )

    def test_401_after_logout_does_not_restore_identity(self) -> None:
        def operation(token: str) -> dict:
            self.path.unlink()
            raise TeehoError("login_required", 401)

        call = Mock(side_effect=operation)
        with self.assertRaisesRegex(TeehoError, "login_required"):
            self.session().authorized(call)
        call.assert_called_once_with(OLD_TOKEN)
        self.public.exchange_token.assert_not_called()
        self.assertFalse(self.path.exists())

    def test_retry_request_is_outside_identity_lock_and_only_once(self) -> None:
        def operation(token: str) -> dict:
            self.assertFalse((self.root / "identity.lock").exists())
            raise TeehoError("login_required", 401)

        call = Mock(side_effect=operation)
        with self.assertRaises(TeehoError):
            self.session().authorized(call, OWNER)
        self.assertEqual(
            [args.args[0] for args in call.call_args_list], [OLD_TOKEN, NEW_TOKEN]
        )
        self.public.exchange_token.assert_called_once()

    def test_successful_request_keeps_original_account_during_switch(self) -> None:
        replacement = {
            **self.identity,
            "user": {"id": fixtures.OTHER_ID, "isAnonymous": False},
        }

        def operation(token: str) -> dict:
            write_json(self.path, replacement)
            return {"originalCredential": token == OLD_TOKEN}

        self.assertEqual(
            self.session().authorized(operation, OWNER), {"originalCredential": True}
        )
        self.assertEqual(read_json(self.path), replacement)
        self.public.exchange_token.assert_not_called()

    def test_wait_reads_fresh_http_status_and_delivers_completed_report(self) -> None:
        data = json.loads(
            (Path(__file__).parent / "fixtures/presentation-golden.json").read_text(
                encoding="utf-8"
            )
        )
        completed = next(
            case["result"]["task"] for case in data if case["name"] == "report"
        )
        responses = iter([{"id": completed["id"], "status": "processing"}, completed])

        def respond(path: str, body: bytes) -> tuple[int, dict, bytes]:
            return (
                200,
                {},
                json.dumps({"code": 0, "data": {"task": next(responses)}}).encode(),
            )

        server = fixtures.LocalServer(respond)
        self.addCleanup(server.close)
        base_url = server.url + "/api"
        write_json(self.path, {**self.identity, "baseUrl": base_url})
        auth = self.session(base_url)
        api = TeehoApi(base_url, HttpTransport(), authorize=auth.authorized)
        result = DiagnosisTools(api, auth, sleep=Mock()).wait(completed["id"])
        view = create_presentation("wait", result)
        store = PresentationStore(self.root, owner=OWNER)
        preview = store.publish(view)
        rendered = store.render(
            preview["presentationId"], preview["translation"]["fields"]
        )
        self.assertEqual(len(server.requests), 2)
        self.assertEqual(rendered["state"], "completed")
        self.assertIsNone(rendered["nextAction"])
        self.assertEqual(rendered["taskId"], completed["id"])
        self.assertEqual(rendered["displayText"], preview["displayText"])
        self.assertTrue(result["saved"])
        self.public.exchange_token.assert_not_called()


if __name__ == "__main__":
    unittest.main()
