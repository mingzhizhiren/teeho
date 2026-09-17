"""题火接口请求组装与协议校验；路径及用途说明见 constants.py。"""

import json
import math
import re
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Optional, Union
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

from . import constants
from .config import normalize_api_url
from .errors import TeehoError
from .http_transport import HttpResponse, HttpTransport, validate_http_url

UUID_PATTERN = re.compile(
    r"[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}"
)


def _identifier(value: object) -> str:
    if not isinstance(value, str) or not UUID_PATTERN.fullmatch(value):
        raise TeehoError("invalid_input")
    return value


def _text(value: object) -> str:
    if not isinstance(value, str) or not value or re.search(r"[\x00-\x1f\x7f]", value):
        raise TeehoError("invalid_response")
    return value


def _reject_constant(value: str) -> None:
    raise ValueError("non_finite_json")


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non_finite_json")
    return number


def _timestamp(value: object) -> str:
    text = _text(value)
    try:
        if datetime.fromisoformat(text.replace("Z", "+00:00")).tzinfo is None:
            raise ValueError("missing_timezone")
    except ValueError as error:
        raise TeehoError("invalid_response") from error
    return text


def _object(data: dict, key: str) -> dict:
    value = data.get(key)
    if not isinstance(value, dict):
        raise TeehoError("invalid_response")
    return value


def _records(data: dict, key: str) -> list[dict]:
    values = data.get(key)
    if not isinstance(values, list) or any(not isinstance(item, dict) for item in values):
        raise TeehoError("invalid_response")
    return values


def _record_id(record: dict) -> None:
    if not UUID_PATTERN.fullmatch(_text(record.get("id"))):
        raise TeehoError("invalid_response")


def _task_data(data: dict, allow_null: bool = False) -> dict:
    if allow_null and "task" in data and data["task"] is None:
        return data
    task = _object(data, "task")
    _record_id(task)
    _text(task.get("status"))
    if task.get("result") is not None:
        _object(task, "result")
    return data


def _media_record(record: dict) -> None:
    _record_id(record)
    _text(record.get("state"))


def _rejection(path: str, status: int, envelope: dict) -> str:
    if path == constants.API_AUTH_TOKEN and status == 409:
        return "authorization_pending"
    if status == 401:
        return "login_required"
    if status == 429:
        return (
            "anonymous_limit"
            if path == constants.API_AUTH_ANONYMOUS and envelope.get("message") == "anonymous_limit"
            else "rate_limited"
        )
    if status == 400:
        return "题火请求参数无效，请更新技能后重试"
    return "request_failed"


class TeehoApi:
    """方法只表达服务协议；身份刷新及业务顺序由调用方负责。"""

    def __init__(
        self, base_url: str, transport: HttpTransport, authorize: Optional[Callable] = None
    ) -> None:
        self.base_url = normalize_api_url(base_url)
        self.transport = transport
        self.authorize = authorize

    def _request(self, path: str, body: Optional[dict] = None, token: Optional[str] = None) -> dict:
        route = UUID_PATTERN.sub(":id", path)
        response = self.transport.request(
            self.base_url + path,
            method="GET" if body is None else "POST",
            route=route,
            headers={
                **({"Content-Type": "application/json"} if body is not None else {}),
                **({"Authorization": "Bearer " + _text(token)} if token else {}),
            },
            data=(
                None
                if body is None
                else json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            ),
        )
        return self._decode(path, response)

    def _parsed(self, response: HttpResponse, state: str) -> None:
        self.transport.log(
            "api_response_parsed",
            {
                **response.context,
                "httpStatus": response.status,
                "state": state,
                "durationMs": round((time.monotonic() - response.started) * 1000),
            },
        )

    def _decode(self, path: str, response: HttpResponse) -> dict:
        invalid = "invalid_response" if 200 <= response.status < 300 else "request_failed"
        try:
            envelope = json.loads(
                response.body.decode("utf-8"),
                parse_constant=_reject_constant,
                parse_float=_finite_float,
            )
        except (ValueError, UnicodeError, RecursionError) as error:
            self._parsed(response, "invalid_json")
            raise TeehoError(invalid, response.status) from error
        if not isinstance(envelope, dict) or type(envelope.get("code")) is not int:
            self._parsed(response, "invalid_envelope")
            raise TeehoError(invalid, response.status)
        if not 200 <= response.status < 300 or envelope["code"] != 0:
            self._parsed(response, "rejected")
            reason = _rejection(path, response.status, envelope)
            state = (
                reason
                if reason in {"anonymous_limit", "rate_limited", "login_required"}
                else "request_rejected"
            )
            self.transport.log("api_rejection_classified", {**response.context, "state": state})
            raise TeehoError(reason, response.status)
        if not isinstance(envelope.get("data"), dict):
            self._parsed(response, "missing_data")
            raise TeehoError("invalid_response", response.status)
        self._parsed(response, "success")
        return envelope["data"]

    def _authorized(
        self, path: str, body: Optional[dict] = None, expected_user_id: Optional[str] = None
    ) -> dict:
        if self.authorize is None:
            raise TeehoError("login_required")
        return self.authorize(lambda token: self._request(path, body, token), expected_user_id)

    def start_login(self, device_token: str, device_name: str = "Teeho Skill") -> dict:
        data = self._request(
            constants.API_AUTH_START,
            {"deviceToken": device_token, "deviceName": device_name},
        )
        validate_http_url(_text(data.get("verificationUrl")))
        _text(data.get("userCode"))
        if type(data.get("interval")) not in (int, float) or data["interval"] <= 0:
            raise TeehoError("invalid_response")
        return data

    def create_anonymous_identity(
        self, device_token: str, machine_id: str, device_name: str = "Teeho Skill"
    ) -> dict:
        return self._request(
            constants.API_AUTH_ANONYMOUS,
            {
                "deviceToken": device_token,
                "machineId": machine_id,
                "deviceName": device_name,
            },
        )

    def exchange_token(self, device_token: str) -> dict:
        data = self._request(constants.API_AUTH_TOKEN, {"deviceToken": device_token})
        _text(data.get("accessToken"))
        _timestamp(data.get("accessExpiresAt"))
        if "expiresAt" not in data:
            raise TeehoError("invalid_response")
        if data["expiresAt"] is not None:
            _timestamp(data["expiresAt"])
        user = data.get("user")
        if not isinstance(user, dict) or type(user.get("isAnonymous")) is not bool:
            raise TeehoError("invalid_response")
        if not UUID_PATTERN.fullmatch(_text(user.get("id"))):
            raise TeehoError("invalid_response")
        return data

    def logout(self, access_token: str) -> dict:
        return self._request(constants.API_AUTH_LOGOUT, {}, access_token)

    def get_points(self, *, expected_user_id: Optional[str] = None) -> dict:
        data = self._authorized(constants.API_POINTS_SUMMARY, expected_user_id=expected_user_id)
        summary = _object(data, "summary")
        if "balances" in summary and summary.get("enabled") is not False:
            _object(summary, "balances")
        return data

    def get_task_config(self, *, expected_user_id: Optional[str] = None) -> dict:
        data = self._authorized(constants.API_TASK_CONFIG, expected_user_id=expected_user_id)
        config = _object(data, "config")
        if "uploads" in config:
            uploads = _object(config, "uploads")
            if "video" in uploads:
                _object(uploads, "video")
        if "tracks" in config:
            _records(config, "tracks")
        return data

    def create_image_upload_session(
        self, files: list[dict], *, expected_user_id: Optional[str] = None
    ) -> dict:
        data = self._authorized(
            constants.API_IMAGE_UPLOAD_SESSIONS, {"files": files}, expected_user_id
        )
        for asset in _records(_object(data, "session"), "assets"):
            _record_id(asset)
            validate_http_url(_text(asset.get("uploadUrl")))
        return data

    def create_video_upload_session(
        self, file: dict, *, expected_user_id: Optional[str] = None
    ) -> dict:
        data = self._authorized(
            constants.API_VIDEO_UPLOAD_SESSIONS, {"file": file}, expected_user_id
        )
        video = _object(_object(data, "session"), "video")
        _record_id(video)
        upload = _object(video, "upload")
        validate_http_url(_text(upload.get("endpoint")))
        for key in ("bucketName", "objectName", "signature"):
            _text(upload.get(key))
        return data

    def get_media_statuses(
        self, asset_ids: list[str], *, expected_user_id: Optional[str] = None
    ) -> dict:
        data = self._authorized(
            constants.API_IMAGE_STATUSES,
            {"assetIds": [_identifier(value) for value in asset_ids]},
            expected_user_id,
        )
        for asset in _records(data, "assets"):
            _media_record(asset)
        return data

    def confirm_image_upload(
        self, asset_id: str, *, expected_user_id: Optional[str] = None
    ) -> dict:
        data = self._authorized(
            constants.API_IMAGE_COMPLETE_TEMPLATE.format(asset_id=_identifier(asset_id)),
            {},
            expected_user_id,
        )
        _media_record(_object(data, "asset"))
        return data

    def get_video(self, video_id: str, *, expected_user_id: Optional[str] = None) -> dict:
        data = self._authorized(
            constants.API_VIDEO_DETAIL_TEMPLATE.format(video_id=_identifier(video_id)),
            expected_user_id=expected_user_id,
        )
        _media_record(_object(data, "video"))
        return data

    def confirm_video_upload(
        self, video_id: str, *, expected_user_id: Optional[str] = None
    ) -> dict:
        data = self._authorized(
            constants.API_VIDEO_COMPLETE_TEMPLATE.format(video_id=_identifier(video_id)),
            {},
            expected_user_id,
        )
        _media_record(_object(data, "video"))
        return data

    def get_admission(self, submission_id: str, *, expected_user_id: Optional[str] = None) -> dict:
        data = self._authorized(
            constants.API_TASK_ADMISSION_TEMPLATE.format(submission_id=_identifier(submission_id)),
            expected_user_id=expected_user_id,
        )
        return _task_data(data, allow_null=True)

    def submit_task(self, payload: dict, *, expected_user_id: Optional[str] = None) -> dict:
        return _task_data(self._authorized(constants.API_TASK_SUBMIT, payload, expected_user_id))

    def get_task(self, task_id: str, *, expected_user_id: Optional[str] = None) -> dict:
        data = self._authorized(
            constants.API_TASK_DETAIL_TEMPLATE.format(task_id=_identifier(task_id)),
            expected_user_id=expected_user_id,
        )
        return _task_data(data)

    def upload_file(
        self, target: Union[str, dict], path: Path, declared_media_type: str, file_name: str
    ) -> None:
        if isinstance(target, dict):
            endpoint = urlsplit(validate_http_url(_text(target.get("endpoint"))))
            bucket = quote(_text(target.get("bucketName")), safe="")
            object_name = "/".join(
                quote(part, safe="") for part in _text(target.get("objectName")).split("/")
            )
            target = urlunsplit(
                (
                    endpoint.scheme,
                    endpoint.netloc,
                    constants.STORAGE_SIGNED_UPLOAD_TEMPLATE.format(
                        bucket_name=bucket, object_name=object_name
                    ),
                    urlencode({"token": _text(target.get("signature"))}),
                    "",
                )
            )
        response = self.transport.upload(target, path, declared_media_type, file_name)
        if not 200 <= response.status < 300 and response.status not in {400, 409}:
            raise TeehoError("素材上传失败，请恢复重试", response.status)
