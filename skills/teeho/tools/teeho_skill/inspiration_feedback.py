"""验证接口返回的索引补参／参数错误提示，禁止用任意错误响应充当确认。"""

import re

from .errors import TeehoError
from .inspiration_contract import TOPIC_LIMIT, TRACK_MAX, input_fields

INPUT_PROTOCOL = "inspiration-input.v1"
FEEDBACK_KIND = "inspiration_input_feedback"
MAX_MESSAGE_LENGTH = 4096


def submission_fields(value: object) -> dict:
    """保留缺失项和赛道原始类型，让接口校验；不默认填入图文。"""
    if not isinstance(value, dict) or set(value) - {
        "topic",
        "mainTrack",
        "secondaryTrack",
        "noteType",
    }:
        raise TeehoError("invalid_input")
    topic = value.get("topic")
    if isinstance(topic, str):
        try:
            if len(topic.encode("utf-16-le")) // 2 > TOPIC_LIMIT:
                raise TeehoError("invalid_input")
        except UnicodeEncodeError as error:
            raise TeehoError("input_encoding_invalid") from error
    return dict(value)


def needs_feedback_protocol(value: dict) -> bool:
    """旧服务会默认图文，缺参或非法字段不能发送给不支持补参协议的服务。"""
    if "noteType" not in value:
        return True
    try:
        input_fields(value)
        return False
    except TeehoError:
        return True


def read_input_feedback(value: object) -> dict:
    """只接收已知协议、有限文本和有界建议字段；不信任原始 HTTP message。"""
    if (
        not isinstance(value, dict)
        or value.get("kind") != FEEDBACK_KIND
        or value.get("protocol") != INPUT_PROTOCOL
    ):
        raise TeehoError("invalid_response")
    text = value.get("displayText")
    state = value.get("state")
    if (
        state not in ("input_required", "invalid_input")
        or not isinstance(text, str)
        or not 1 <= len(text) <= MAX_MESSAGE_LENGTH
        or re.search(r"[\x00-\x08\x0b-\x1f\x7f]", text)
    ):
        raise TeehoError("invalid_response")
    base = {
        "kind": FEEDBACK_KIND,
        "protocol": INPUT_PROTOCOL,
        "state": state,
        "displayText": text,
    }
    if state == "invalid_input":
        if value.get("reason") not in (
            "invalid",
            "topic",
            "mainTrack",
            "secondaryTrack",
            "tracksEqual",
            "noteType",
        ):
            raise TeehoError("invalid_response")
        return {**base, "reason": value["reason"]}
    fields = value.get("suggestedInput")
    missing = value.get("missingFields")
    if (
        not isinstance(missing, list)
        or not missing
        or len(missing) > 3
        or any(key not in ("topic", "mainTrack", "noteType") for key in missing)
    ):
        raise TeehoError("invalid_response")
    _validate_suggestions(fields)
    if (
        value.get("targetCount") not in (4, 8, 10)
        or type(value.get("targetCount")) is not int
    ):
        raise TeehoError("invalid_response")
    for key in ("pointCost", "availablePoints"):
        number = value.get(key)
        if key == "availablePoints" and number is None:
            continue
        if type(number) is not int or number < 0:
            raise TeehoError("invalid_response")
    return {
        **base,
        "missingFields": missing,
        "suggestedInput": fields,
        **{key: value[key] for key in ("targetCount", "pointCost", "availablePoints")},
    }


def _validate_suggestions(value: object) -> None:
    if (
        not isinstance(value, dict)
        or set(value) - {"topic", "mainTrack", "secondaryTrack", "noteType"}
        or value.get("noteType") not in ("normal", "video")
    ):
        raise TeehoError("invalid_response")
    if "topic" in value:
        try:
            if (
                not isinstance(value["topic"], str)
                or not 1 <= len(value["topic"].encode("utf-16-le")) // 2 <= TOPIC_LIMIT
            ):
                raise TeehoError("invalid_response")
        except UnicodeEncodeError as error:
            raise TeehoError("invalid_response") from error
    for field in ("mainTrack", "secondaryTrack"):
        if field in value and (
            type(value[field]) is not int or not 1 <= value[field] <= TRACK_MAX
        ):
            raise TeehoError("invalid_response")
    if "mainTrack" in value and value.get("secondaryTrack") == value["mainTrack"]:
        raise TeehoError("invalid_response")


class InspirationInputFeedback(TeehoError):
    """服务端明确拒绝的参数错误，可安全解除本次未受理意图。"""

    def __init__(self, value: object) -> None:
        super().__init__("inspiration_input_feedback", 400)
        self.feedback = read_input_feedback(value)
        if self.feedback["state"] != "invalid_input":
            raise TeehoError("invalid_response")
