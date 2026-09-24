"""素材检查和可恢复上传；接口地址统一由 api 模块维护。"""

import re
import stat
import time
from collections.abc import Callable
from pathlib import Path
from typing import Optional

from .api import TeehoApi
from .constants import (
    IMAGE_TYPES,
    MAX_IMAGE_BYTES,
    MAX_NOTE_FILE_BYTES,
    MAX_NOTE_FILES,
    MAX_TOTAL_IMAGE_BYTES,
    MEDIA_WAIT_SECONDS,
    POLL_SECONDS,
    VIDEO_TYPES,
)
from .errors import TeehoError
from .note import is_number, require_id


def _file_info(path: Path, maximum: int, code: str) -> int:
    try:
        info = path.lstat()
    except OSError as error:
        raise TeehoError(code) from error
    if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_size > maximum:
        raise TeehoError(code)
    return info.st_size


def image_descriptor(value: str) -> dict[str, object]:
    """读取图片元信息，字节由上传层按块读取。"""
    path = Path(value)
    size = _file_info(path, MAX_IMAGE_BYTES, "图片不可读取或超过上传限制")
    content_type = IMAGE_TYPES.get(path.suffix.lower())
    if not content_type:
        raise TeehoError("不支持的图片格式")
    return {"fileName": path.name, "declaredMediaType": content_type, "byteSize": size}


def _natural_key(name: str) -> tuple:
    # 不依赖机器 locale；数字使用自然顺序，其余字符使用稳定 Unicode 顺序。
    return tuple(
        (0, int(part)) if part.isdecimal() else (1, part.casefold())
        for part in re.split(r"(\d+)", name)
    )


def inspect_directory(value: object) -> dict[str, object]:
    """只检查指定目录的普通文件，不递归、不读取隐藏配置。"""
    if not isinstance(value, str) or not value or "\x00" in value:
        raise TeehoError("目录无效")
    root = Path(value).resolve()
    try:
        files = sorted(
            (
                path
                for path in root.iterdir()
                if not path.name.startswith(".")
                and not path.is_symlink()
                and stat.S_ISREG(path.lstat().st_mode)
            ),
            key=lambda path: _natural_key(path.name),
        )
        notes = [path for path in files if path.suffix.lower() in (".md", ".txt", ".json")]
        readable = [
            path for path in notes[:MAX_NOTE_FILES] if path.stat().st_size <= MAX_NOTE_FILE_BYTES
        ]
        return {
            "directories": [
                {"name": path.name, "path": str(path)}
                for path in sorted(
                    (
                        path
                        for path in root.iterdir()
                        if path.is_dir() and not path.is_symlink() and not path.name.startswith(".")
                    ),
                    key=lambda path: _natural_key(path.name),
                )
            ],
            "images": [str(path) for path in files if path.suffix.lower() in IMAGE_TYPES],
            "videos": [str(path) for path in files if path.suffix.lower() in VIDEO_TYPES],
            "notes": [
                {
                    "name": path.name,
                    "path": str(path),
                    "text": path.read_text(encoding="utf-8-sig"),
                }
                for path in readable
            ],
            "requiresSelection": len(readable) != 1,
        }
    except (OSError, UnicodeError) as error:
        raise TeehoError("目录无效") from error


class MediaTools:
    """每次流程绑定账号；关键步骤持久化后才推进。"""

    def __init__(
        self,
        api: TeehoApi,
        user_id: str,
        save: Callable[[dict], None],
        now: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.api = api
        self.user_id = user_id
        self.save = save
        self.now = now
        self.sleep = sleep

    def _video_rules(self) -> dict:
        config = self.api.get_task_config(expected_user_id=self.user_id).get("config")
        uploads = config.get("uploads") if isinstance(config, dict) else None
        video = uploads.get("video") if isinstance(uploads, dict) else None
        if not isinstance(video, dict) or not is_number(video.get("maxFileBytes")):
            raise TeehoError("视频超过限制或不可读取")
        if video["maxFileBytes"] <= 0:
            raise TeehoError("视频超过限制或不可读取")
        return video

    def video_descriptor(self, value: str) -> dict:
        """使用服务端视频限额校验本地文件。"""
        path = Path(value)
        content_type = VIDEO_TYPES.get(path.suffix.lower())
        if not content_type:
            raise TeehoError("不支持的视频格式")
        size = _file_info(path, self._video_rules()["maxFileBytes"], "视频超过限制或不可读取")
        return {
            "fileName": path.name,
            "declaredMediaType": content_type,
            "byteSize": size,
        }

    def check(self, images: list[str], video: Optional[str]) -> None:
        """在创建待提交记录前检查所选素材。"""
        files = [image_descriptor(path) for path in images]
        if sum(file["byteSize"] for file in files) > MAX_TOTAL_IMAGE_BYTES:
            raise TeehoError("图片总大小超过限制")
        if video:
            self.video_descriptor(video)

    def prepare(self, state: dict) -> tuple[dict, Optional[str]]:
        """返回新恢复状态，以及需要交还 Agent 的等待提示。"""
        if state.get("video") and not state.get("videoId"):
            state, waiting = self._prepare_video(state)
            if waiting:
                return state, "视频仍在处理中，请稍后恢复任务"
        state = self._upload_images(state)
        if state["assets"] and not self._wait_images(state["assets"]):
            return state, "素材仍在处理中，请稍后恢复任务"
        return state, None

    def _prepare_video(self, state: dict) -> tuple[dict, bool]:
        if not state.get("videoSession"):
            file = self.video_descriptor(state["video"])
            result = self.api.create_video_upload_session(file, expected_user_id=self.user_id)
            state = {**state, "videoSession": result.get("session")}
            self.save(state)
        session = state["videoSession"]
        video = session.get("video") if isinstance(session, dict) else None
        if not isinstance(video, dict) or not isinstance(video.get("upload"), dict):
            raise TeehoError("视频上传资格无效")
        video_id = require_id(video.get("id"), "视频上传资格无效")
        current = self._video_status(video_id)
        if current in ("awaiting_upload", "uploading"):
            file = self.video_descriptor(state["video"])
            self.api.upload_file(
                video["upload"],
                Path(state["video"]),
                file["declaredMediaType"],
                file["fileName"],
            )
            self.api.confirm_video_upload(video_id, expected_user_id=self.user_id)
        if not self._wait_video(video_id):
            return state, True
        state = {key: value for key, value in state.items() if key != "videoSession"}
        state = {**state, "videoId": video_id}
        self.save(state)
        return state, False

    def _video_status(self, video_id: str) -> str:
        result = self.api.get_video(video_id, expected_user_id=self.user_id).get("video")
        if not isinstance(result, dict) or result.get("id") != video_id:
            raise TeehoError("视频状态不可用")
        if not isinstance(result.get("state"), str):
            raise TeehoError("视频状态不可用")
        return result["state"]

    def _wait_video(self, video_id: str) -> bool:
        deadline = self.now() + MEDIA_WAIT_SECONDS
        while True:
            state = self._video_status(video_id)
            if state == "ready":
                return True
            if re.search("failed|cancelled|expired|delet", state):
                raise TeehoError("视频处理失败")
            if self.now() >= deadline:
                return False
            self.sleep(POLL_SECONDS)

    def _statuses(self, asset_ids: list[str]) -> list[dict]:
        assets = self.api.get_media_statuses(asset_ids, expected_user_id=self.user_id).get("assets")
        if not isinstance(assets, list) or len(assets) != len(asset_ids):
            raise TeehoError("素材状态不可用")
        if any(
            not isinstance(asset, dict) or not isinstance(asset.get("state"), str)
            for asset in assets
        ):
            raise TeehoError("素材状态不可用")
        if {asset.get("id") for asset in assets} != set(asset_ids):
            raise TeehoError("素材状态不可用")
        return assets

    def _upload_images(self, state: dict) -> dict:
        if not state["assets"] and state["images"]:
            files = [image_descriptor(path) for path in state["images"]]
            if sum(file["byteSize"] for file in files) > MAX_TOTAL_IMAGE_BYTES:
                raise TeehoError("图片总大小超过限制")
            response = self.api.create_image_upload_session(files, expected_user_id=self.user_id)
            session = response.get("session")
            assets = session.get("assets") if isinstance(session, dict) else None
            if not isinstance(assets, list) or len(assets) != len(files):
                raise TeehoError("上传凭据无效")
            for asset in assets:
                if not isinstance(asset, dict):
                    raise TeehoError("上传凭据无效")
                require_id(asset.get("id"), "上传凭据无效")
            state = {**state, "assets": assets}
            self.save(state)
        if len(state["assets"]) != len(state["images"]):
            raise TeehoError("上传凭据无效")
        for index, asset in enumerate(state["assets"]):
            if asset.get("uploaded") is True:
                continue
            self._upload_image(asset, state["images"][index])
            state = {
                **state,
                "assets": [
                    {**item, "uploaded": True} if i == index else item
                    for i, item in enumerate(state["assets"])
                ],
            }
            self.save(state)
        return state

    def _upload_image(self, asset: dict, path: str) -> None:
        current = self._statuses([asset["id"]])[0]
        if current["state"] in ("uploaded", "processing", "ready"):
            return
        if current["state"] != "awaiting_upload":
            raise TeehoError("图片状态不可上传，请重新选择素材")
        if not isinstance(asset.get("uploadUrl"), str):
            raise TeehoError("上传凭据无效")
        file = image_descriptor(path)
        self.api.upload_file(
            asset["uploadUrl"], Path(path), file["declaredMediaType"], file["fileName"]
        )
        self.api.confirm_image_upload(asset["id"], expected_user_id=self.user_id)

    def _wait_images(self, assets: list[dict]) -> bool:
        deadline = self.now() + MEDIA_WAIT_SECONDS
        while True:
            statuses = self._statuses([asset["id"] for asset in assets])
            if all(asset["state"] == "ready" for asset in statuses):
                return True
            if any(
                re.search("failed|cancelled|expired|delet", asset["state"]) for asset in statuses
            ):
                raise TeehoError("素材处理失败，请修复后重试")
            if self.now() >= deadline:
                return False
            self.sleep(POLL_SECONDS)
