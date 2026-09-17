"""唯一 HTTP I/O 边界：TLS、代理、超时、有界响应与流式 multipart。"""

import http.client
import re
import ssl
import time
import uuid
from collections.abc import Callable, Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

from .errors import TeehoError

REQUEST_TIMEOUT_SECONDS = 30
UPLOAD_TIMEOUT_SECONDS = 300
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
STREAM_CHUNK_BYTES = 64 * 1024
MEDIA_TYPE_PATTERN = re.compile(r"[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+")


def validate_http_url(value: object) -> str:
    """HTTPS 或明确的本机 HTTP；拒绝凭据与控制字符。"""
    if not isinstance(value, str) or re.search(r"[\x00-\x20\x7f\\]", value):
        raise TeehoError("invalid_api_url")
    try:
        parsed = urlsplit(value)
        _ = parsed.port
        is_local = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (
            not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or "#" in value
            or (parsed.scheme != "https" and not (parsed.scheme == "http" and is_local))
        ):
            raise ValueError("invalid")
    except ValueError as error:
        raise TeehoError("invalid_api_url") from error
    return value


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(
        self,
        req: Request,
        fp: object,
        code: int,
        msg: str,
        headers: object,
        newurl: str,
    ) -> None:
        return None


@dataclass(frozen=True)
class HttpResponse:
    status: int
    body: bytes
    context: dict
    started: float = 0


def _file_chunks(
    stream: object, size: int, prefix: bytes, suffix: bytes, deadline: float
) -> Iterator[bytes]:
    _check_deadline(deadline)
    yield prefix
    remaining = size
    while remaining:
        _check_deadline(deadline)
        chunk = stream.read(min(STREAM_CHUNK_BYTES, remaining))
        if not chunk:
            raise TeehoError("素材在上传时发生变化，请重新选择素材")
        remaining -= len(chunk)
        yield chunk
    if stream.read(1):
        raise TeehoError("素材在上传时发生变化，请重新选择素材")
    _check_deadline(deadline)
    yield suffix


def _check_deadline(deadline: float) -> None:
    if time.monotonic() >= deadline:
        raise TimeoutError("request_deadline")


def _read_body(response: object, deadline: float) -> bytes:
    """read1 每次接收后检查总期限，滴流不能无限延长响应。"""
    parts: list[bytes] = []
    total = 0
    while True:
        _check_deadline(deadline)
        chunk = response.read1(min(STREAM_CHUNK_BYTES, MAX_RESPONSE_BYTES + 1 - total))
        _check_deadline(deadline)
        if not chunk:
            return b"".join(parts)
        total += len(chunk)
        if total > MAX_RESPONSE_BYTES:
            raise TeehoError("invalid_response", response.status)
        parts = [*parts, chunk]


class HttpTransport:
    """不刷新身份、不重试业务写请求、不跟随重定向。"""

    def __init__(self, log: object = None) -> None:
        self.logger = log
        self.log: Callable = (
            log.log if hasattr(log, "log") else (log or (lambda *args, **kwargs: None))
        )
        context = ssl.create_default_context()
        context.set_alpn_protocols(["http/1.1"])
        self.opener = build_opener(_NoRedirect(), HTTPSHandler(context=context))

    def request(
        self,
        url: str,
        *,
        method: str = "GET",
        headers: Optional[dict[str, str]] = None,
        data: Optional[Union[bytes, Iterable[bytes]]] = None,
        timeout: float = REQUEST_TIMEOUT_SECONDS,
        route: str = "external",
    ) -> HttpResponse:
        validate_http_url(url)
        started = time.monotonic()
        context = {"requestId": str(uuid.uuid4()), "route": route, "method": method}
        request_headers = {**(headers or {})}
        if route != "external" and getattr(self.logger, "enabled", False):
            request_headers = {**request_headers, "x-request-id": context["requestId"]}
        self.log(
            "request_started",
            {
                **context,
                **({"bodyBytes": len(data)} if isinstance(data, bytes) else {}),
            },
        )
        request = Request(url, data=data, headers=request_headers, method=method)
        return self._send(request, timeout, started, context)

    def _send(
        self, request: Request, timeout: float, started: float, context: dict
    ) -> HttpResponse:
        try:
            try:
                response = self.opener.open(request, timeout=timeout)
            except HTTPError as error:
                response = error
            with response:
                self.log(
                    "response_headers_received",
                    {
                        **context,
                        "httpStatus": response.status,
                        "durationMs": round((time.monotonic() - started) * 1000),
                    },
                )
                body = _read_body(response, started + timeout)
                details = {
                    **context,
                    "durationMs": round((time.monotonic() - started) * 1000),
                }
                return HttpResponse(response.status, body, details, started)
        except (OSError, URLError, http.client.HTTPException, ValueError) as error:
            self.log(
                "request_failed",
                {
                    **context,
                    "durationMs": round((time.monotonic() - started) * 1000),
                    "errorCode": "network_error",
                },
            )
            raise TeehoError("request_failed") from error

    def upload(
        self, url: str, path: Path, declared_media_type: str, file_name: str
    ) -> HttpResponse:
        """按上传契约使用 PUT，内存占用独立于文件大小。"""
        validate_http_url(url)
        if not MEDIA_TYPE_PATTERN.fullmatch(declared_media_type):
            raise TeehoError("上传地址无效")
        if not file_name or re.search(r"[\x00-\x1f\x7f]", file_name):
            raise TeehoError("素材文件名无效")
        boundary = "----teeho-" + uuid.uuid4().hex
        escaped_name = file_name.replace("\\", "\\\\").replace('"', "%22")
        prefix = (
            f"--{boundary}\r\nContent-Disposition: form-data; "
            'name="cacheControl"\r\n\r\n3600\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name=""; '
            f'filename="{escaped_name}"\r\n'
            f"Content-Type: {declared_media_type}\r\n\r\n"
        ).encode("utf-8")
        suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        with Path(path).open("rb") as stream:
            import os

            size = os.fstat(stream.fileno()).st_size
            return self.request(
                url,
                method="PUT",
                timeout=UPLOAD_TIMEOUT_SECONDS,
                headers={
                    "x-upsert": "false",
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Content-Length": str(len(prefix) + size + len(suffix)),
                },
                data=_file_chunks(
                    stream,
                    size,
                    prefix,
                    suffix,
                    time.monotonic() + UPLOAD_TIMEOUT_SECONDS,
                ),
            )
