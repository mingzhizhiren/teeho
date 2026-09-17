"""诊断用例：账号绑定、持久化恢复与服务端权威任务状态。"""

import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from uuid import uuid4

from .api import TeehoApi
from .auth import AuthSession
from .constants import FINISHED_STATUSES, MEDIA_WAIT_SECONDS, POLL_SECONDS
from .errors import TeehoError
from .history import HistoryTools, local_media
from .public_history import publish_report
from .locking import lock_directory
from .media import MediaTools, image_descriptor, inspect_directory
from .note import build_task_payload, is_number, normalize_note, require_id
from .storage import ensure_private_directory, read_json, write_json


@dataclass(frozen=True)
class AccountScope:
    root: Path
    user_id: str
    anonymous: bool = False


def _no_log(event: str, fields: Optional[dict] = None, level: str = "debug") -> None:
    pass


class DiagnosisTools:
    """时钟与网络可注入；每次任务始终属于启动时核实的账号。"""

    def __init__(
        self,
        api: TeehoApi,
        auth: AuthSession,
        *,
        emit: Optional[Callable[[dict], None]] = None,
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        log: Callable = _no_log,
        expected_user_id: Optional[str] = None,
    ) -> None:
        self.api = api
        self.auth = auth
        self.root = Path(auth.root)
        self.emit = emit or (lambda event: None)
        self.now = now
        self.sleep = sleep
        self.log = log
        self.expected_user_id = expected_user_id

    def inspect(self, directory: object) -> dict:
        """检查本机笔记文件夹，无需登录或联网。"""
        return inspect_directory(directory)

    def _scope(self) -> AccountScope:
        identity = self.auth.read_identity()
        user = identity.get("user") if isinstance(identity, dict) else None
        user_id = require_id(user.get("id") if isinstance(user, dict) else None, "login_required")
        if self.expected_user_id is not None and user_id != self.expected_user_id:
            raise TeehoError("账号已切换，请使用原账号查询任务")
        root = self.root / "accounts" / user_id
        ensure_private_directory(root)
        return AccountScope(root, user_id, user.get("isAnonymous") is True)

    def _pending(self, scope: AccountScope) -> Optional[dict]:
        try:
            state = read_json(scope.root / "pending.json")
        except (TeehoError, OSError, ValueError) as error:
            raise TeehoError("本地任务记录无法读取") from error
        if state is None:
            return None
        if not isinstance(state, dict) or state.get("userId") != scope.user_id:
            raise TeehoError("本地任务记录无法读取")
        if state.get("taskId"):
            require_id(state["taskId"], "本地任务记录无法读取")
            return state
        require_id(state.get("submissionId"), "本地任务记录无法读取")
        fields = state.get("fields")
        if not isinstance(fields, dict) or not isinstance(state.get("summary"), dict):
            raise TeehoError("本地任务记录无法读取")
        if not isinstance(state.get("images"), list) or not isinstance(state.get("assets"), list):
            raise TeehoError("本地任务记录无法读取")
        normalize_note(
            {
                **fields,
                "images": state["images"],
                "cover": state.get("cover"),
                "videos": [state["video"]] if state.get("video") else [],
            }
        )
        for asset in state["assets"]:
            if not isinstance(asset, dict):
                raise TeehoError("本地任务记录无法读取")
            require_id(asset.get("id"), "本地任务记录无法读取")
        return state

    def _media(self, scope: AccountScope) -> MediaTools:
        return MediaTools(
            self.api,
            scope.user_id,
            lambda state: write_json(scope.root / "pending.json", state),
            now=self.now,
            sleep=self.sleep,
        )

    def _save_report(self, scope: AccountScope, task: dict, state: Optional[dict]) -> bool:
        try:
            HistoryTools(self.root, scope.user_id).save(task, media=local_media(state))
            if scope.anonymous:
                publish_report(HistoryTools(self.root, scope.user_id).read(task["id"]), scope.user_id)
        except (TeehoError, OSError, ValueError) as error:
            self.log(
                "report_save_failed",
                {
                    "taskId": task["id"],
                    "saved": False,
                    "errorCode": getattr(error, "code", "save_error"),
                },
                "warn",
            )
            return False
        self.log("report_available_locally", {"taskId": task["id"], "saved": True})
        return True

    def _query_task(self, task_id: str, scope: AccountScope) -> dict:
        result = self.api.get_task(require_id(task_id), expected_user_id=scope.user_id)
        task = result.get("task")
        if not isinstance(task, dict) or task.get("id") != task_id:
            raise TeehoError("任务暂不可用")
        if task.get("result"):
            state = self._pending(scope)
            matching = state if state and state.get("taskId") == task_id else None
            saved = self._save_report(scope, task, matching)
            media = local_media(matching)
            if saved:
                report = HistoryTools(self.root, scope.user_id).read(task_id)
                media = local_media(report.get("localMedia"))
            return {**result, "saved": saved, "localMedia": media}
        return result

    def task(self, task_id: str) -> dict:
        """查询同一任务；结果保存失败不会触发重建。"""
        return self._query_task(task_id, self._scope())

    def wait(self, task_id: str) -> dict:
        """有界轮询，超时后交还 Agent，后续继续查询。"""
        scope, deadline = self._scope(), self.now() + MEDIA_WAIT_SECONDS
        last_status = None
        while True:
            result = self._query_task(task_id, scope)
            status = result["task"].get("status")
            if status != last_status:
                self.log("task_status_changed", {"taskId": task_id, "state": status})
            last_status = status
            if status in FINISHED_STATUSES:
                return result
            if self.now() >= deadline:
                self.log(
                    "task_wait_yielded",
                    {
                        "taskId": task_id,
                        "state": last_status,
                        "durationMs": MEDIA_WAIT_SECONDS * 1000,
                    },
                    "info",
                )
                return {
                    **result,
                    "message": "任务分析中，你可以等待一会再告诉我，我会再次查看任务是否分析完成",
                }
            self.sleep(POLL_SECONDS)

    def diagnose(self, value: dict[str, object]) -> dict:
        """选取素材并创建一个稳定提交标识，保留原任务的恢复入口。"""
        note = normalize_note(value)
        scope = self._scope()
        with lock_directory(scope.root / "operation.lock"):
            self._check_previous(scope)
            self._check_points(scope, len(note["images"]), bool(note["video"]))
            self._media(scope).check(note["images"], note["video"])
            state = {
                **note,
                "submissionId": str(uuid4()),
                "userId": scope.user_id,
                "assets": [],
                "taskId": None,
            }
            if note["cover"]:
                image_descriptor(note["cover"])
            write_json(scope.root / "pending.json", state)
            return self._resume(scope)

    def _check_previous(self, scope: AccountScope) -> None:
        previous = self._pending(scope)
        if not previous:
            return
        if previous.get("submitting") and not previous.get("taskId"):
            raise TeehoError("有未确认的任务，请先恢复任务")
        if previous.get("taskId"):
            status = self._query_task(previous["taskId"], scope)["task"].get("status")
            if status not in FINISHED_STATUSES:
                raise TeehoError("有任务分析中，请先查询任务")

    def _check_points(self, scope: AccountScope, image_count: int, is_video: bool) -> None:
        summary = self.api.get_points(expected_user_id=scope.user_id).get("summary")
        if not isinstance(summary, dict) or type(summary.get("enabled")) is not bool:
            raise TeehoError("积分状态不可用")
        if not summary["enabled"]:
            return
        if is_video:
            price = self._media(scope)._video_rules().get("pointCost")
        else:
            tiers = summary.get("pricing")
            if not isinstance(tiers, list):
                raise TeehoError("积分状态不可用")
            tier = next(
                (
                    tier
                    for tier in tiers
                    if isinstance(tier, dict)
                    and is_number(tier.get("minImages"))
                    and is_number(tier.get("maxImages"))
                    and tier["minImages"] <= image_count <= tier["maxImages"]
                ),
                {},
            )
            price = tier.get("points")
        balances = summary.get("balances")
        if not is_number(price) or price < 0 or not isinstance(balances, dict):
            raise TeehoError("积分状态不可用")
        if any(not is_number(balances.get(key)) for key in ("free", "package", "purchased")):
            raise TeehoError("积分状态不可用")
        if balances["free"] < price and balances["package"] + balances["purchased"] < price:
            raise TeehoError("积分不足，请查看题火状态")

    def resume(self) -> dict:
        """恢复当前账号的同一提交，网络失败不产生新提交标识。"""
        scope = self._scope()
        with lock_directory(scope.root / "operation.lock"):
            return self._resume(scope)

    def _resume(self, scope: AccountScope) -> dict:
        state = self._pending(scope)
        self.log(
            "task_resume_checked",
            {
                "hasTask": bool(state and state.get("taskId")),
                "taskId": ((state.get("taskId") or state.get("submissionId")) if state else None),
                "submitting": bool(state and state.get("submitting")),
            },
        )
        if state is None:
            raise TeehoError("没有待恢复的题火任务")
        if state.get("taskId"):
            return self._query_task(state["taskId"], scope)
        if state.get("submitting"):
            recovered = self._recover_admission(scope, state)
            if recovered is not None:
                return recovered
        self.emit(
            {
                "event": "task_summary",
                **state["summary"],
                **(
                    {"warning": "不上传封面/图片/视频会降低分析结果的准确性"}
                    if not state.get("cover")
                    else {}
                ),
            }
        )
        state, waiting = self._media(scope).prepare(state)
        if waiting:
            return {"preparing": True, "message": waiting}
        return self._submit(scope, state)

    def _recover_admission(self, scope: AccountScope, state: dict) -> Optional[dict]:
        result = self.api.get_admission(state["submissionId"], expected_user_id=scope.user_id)
        task = result.get("task")
        if task is None:
            return None
        if not isinstance(task, dict) or task.get("id") != state["submissionId"]:
            raise TeehoError("任务结果未确认，请恢复查询")
        write_json(scope.root / "pending.json", {**state, "taskId": task["id"]})
        if task.get("result"):
            return {
                **result,
                "localMedia": local_media(state),
                "saved": self._save_report(
                    scope,
                    task,
                    state,
                ),
            }
        return result

    def _submit(self, scope: AccountScope, state: dict) -> dict:
        payload = build_task_payload(state)
        state = {**state, "submitting": True}
        write_json(scope.root / "pending.json", state)
        result = self.api.submit_task(payload, expected_user_id=scope.user_id)
        task = result.get("task")
        if not isinstance(task, dict):
            raise TeehoError("任务结果未确认，请恢复查询")
        task_id = require_id(task.get("id"), "任务结果未确认，请恢复查询")
        if task_id != state["submissionId"]:
            raise TeehoError("任务结果未确认，请恢复查询")
        state = {
            **state,
            "taskId": task_id,
            "assets": [{"id": asset["id"], "uploaded": True} for asset in state["assets"]],
        }
        write_json(scope.root / "pending.json", state)
        saved = bool(task.get("result")) and self._save_report(
            scope,
            task,
            state,
        )
        return {
            "summary": state["summary"], "task": task, "saved": saved,
            "localMedia": local_media(state),
        }
