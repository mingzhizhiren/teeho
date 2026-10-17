"""网络诊断只输出有限分类与数值，不记录异常消息、URL 或凭据。"""

import hashlib
import re
import ssl
from typing import Optional
from collections.abc import Callable, Iterable, Iterator
from urllib.error import URLError
from urllib.parse import urlsplit

MAX_ERROR_DEPTH = 4
TLS_REASONS = frozenset(
    {
        "CERTIFICATE_VERIFY_FAILED",
        "UNEXPECTED_EOF_WHILE_READING",
        "WRONG_VERSION_NUMBER",
        "TLSV1_ALERT_INTERNAL_ERROR",
        "TLSV1_ALERT_PROTOCOL_VERSION",
        "SSLV3_ALERT_HANDSHAKE_FAILURE",
    }
)


def _structured_error_fields(error: BaseException) -> dict[str, object]:
    fields: dict[str, object] = {"causeType": type(error).__name__}
    for attribute, key in (
        ("errno", "errno"),
        ("winerror", "winerror"),
        ("verify_code", "tlsVerifyCode"),
    ):
        value = getattr(error, attribute, None)
        if type(value) is int:
            fields = {**fields, key: value}
    reason = getattr(error, "reason", None)
    if (
        isinstance(error, ssl.SSLError)
        and isinstance(reason, str)
        and reason in TLS_REASONS
    ):
        fields = {**fields, "tlsReason": reason}
    return fields


def network_error_fields(
    error: BaseException, classify: Callable[[BaseException], str]
) -> dict[str, object]:
    """展开有限异常链，原始 reason 只用于分类，不直接写入日志。"""
    current = error
    fields: dict[str, object] = {"exceptionType": type(error).__name__}
    for _ in range(MAX_ERROR_DEPTH):
        fields = {
            **fields,
            **_structured_error_fields(current),
            "networkReason": classify(current),
        }
        if fields["networkReason"] != "unknown":
            break
        if isinstance(current, URLError):
            nested = current.reason
        else:
            nested = current.__cause__ or current.__context__
        if isinstance(nested, str):
            proxy_status = re.match(
                r"^Tunnel connection failed:\s+([1-5][0-9]{2})(?:\s|$)", nested
            )
            if proxy_status:
                fields = {
                    **fields,
                    "networkReason": "proxy_tunnel",
                    "proxyStatus": int(proxy_status[1]),
                }
        if not isinstance(nested, BaseException) or nested is current:
            break
        current = nested
    return fields


def upstream_request_id(headers: object) -> Optional[str]:
    """只接收服务端请求 UUID，不输出其他响应头。"""
    value = headers.get("sb-request-id") if hasattr(headers, "get") else None
    return (
        value
        if isinstance(value, str) and re.fullmatch(r"[a-fA-F0-9-]{36}", value)
        else None
    )


def request_debug_fields(url: str, opener: object) -> dict[str, object]:
    """目标只保留不可逆指纹；代理字段只说明是否配置，不声称实际经过代理。"""
    parsed = urlsplit(url)
    target = f"{parsed.scheme}://{parsed.netloc}{parsed.path}"
    return {
        "targetHostHash": hashlib.sha256((parsed.hostname or "").encode()).hexdigest(),
        "targetHash": hashlib.sha256(target.encode()).hexdigest(),
        "scheme": parsed.scheme,
        "proxyConfigured": any(
            bool(getattr(handler, "proxies", {}).get(parsed.scheme))
            for handler in getattr(opener, "handlers", ())
        ),
    }


def transfer_trace() -> tuple[Callable[[], dict], Callable[..., None]]:
    """每个请求拥有独立进度；产出字节不等于远端确认接收。"""
    state = {
        "bodyBytesProduced": 0,
        "requestBodyComplete": False,
        "responseBytesRead": 0,
        "responseHeadersReceived": False,
    }

    def update(**changes: object) -> None:
        nonlocal state
        state = {**state, **changes}

    def snapshot() -> dict:
        if state["responseHeadersReceived"]:
            phase = "reading_response_body"
        elif state["requestBodyComplete"]:
            phase = "awaiting_response_headers"
        elif state["bodyBytesProduced"]:
            phase = "sending_request_body"
        else:
            phase = "before_response_headers"
        return {**state, "phase": phase}

    return snapshot, update


def traced_body(data: Iterable[bytes], update: Callable[..., None]) -> Iterator[bytes]:
    """只计数请求库消费的块，不缓存、复制或输出上传内容。"""
    produced = 0
    for chunk in data:
        produced += len(chunk)
        update(bodyBytesProduced=produced)
        yield chunk
    update(requestBodyComplete=True)
