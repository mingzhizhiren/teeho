"""服务地址与按站点隔离的本机数据位置。"""

import hashlib
import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import quote, unquote, urlsplit, urlunsplit

from .errors import TeehoError
from .storage import read_json

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
ENDPOINT_PATH = Path(__file__).resolve().parents[2] / "endpoint.json"


def normalize_api_url(value: object) -> str:
    """校验并按浏览器 URL 规则规范化服务地址。"""
    if not isinstance(value, str) or any(ord(char) < 32 for char in value):
        raise TeehoError("invalid_api_url")
    try:
        parsed = urlsplit(value.strip().replace("\\", "/"))
        hostname = (parsed.hostname or "").encode("idna").decode("ascii").lower()
        port = parsed.port
        if (
            not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or "?" in value
            or "#" in value
            or (
                parsed.scheme != "https"
                and not (parsed.scheme == "http" and hostname in LOCAL_HOSTS)
            )
        ):
            raise ValueError("invalid")
        host = f"[{hostname}]" if ":" in hostname else hostname
        authority = (
            host
            if port is None or port == {"http": 80, "https": 443}[parsed.scheme]
            else f"{host}:{port}"
        )
        segments: list[str] = []
        for part in parsed.path.split("/"):
            decoded = unquote(part).lower()
            if decoded == ".":
                continue
            if decoded == "..":
                segments = segments[:-1] if len(segments) > 1 else segments
            else:
                segments = [*segments, part]
        path = quote("/".join(segments), safe="/%:@!$&'()*+,;=-._~").rstrip("/")
        return urlunsplit((parsed.scheme, authority, path, "", ""))
    except (ValueError, UnicodeError) as error:
        raise TeehoError("invalid_api_url") from error


@dataclass(frozen=True)
class Installation:
    root: Path
    base_url: str
    debug: bool


def read_installation(env: Optional[Mapping[str, str]] = None) -> Installation:
    """每个规范化服务地址对应独立的身份与历史目录。"""
    environment = os.environ if env is None else env
    try:
        endpoint = read_json(ENDPOINT_PATH)
        if not isinstance(endpoint, dict):
            raise TeehoError("invalid_api_url")
        if "debug" in endpoint and type(endpoint["debug"]) is not bool:
            raise TeehoError("invalid_debug_config")
        base_url = normalize_api_url(environment.get("TEEHO_API_URL") or endpoint.get("apiUrl"))
        configured_debug = None if environment.get("TEEHO_API_URL") else endpoint.get("debug")
    except (OSError, TeehoError) as error:
        raise TeehoError("技能服务地址配置无效，请从目标题火网站重新安装技能") from error
    site_key = hashlib.sha256(base_url.encode("utf-8")).hexdigest()
    root = Path(environment.get("TEEHO_HOME") or Path.home() / ".teeho")
    return Installation(
        root / "servers" / site_key,
        base_url,
        urlsplit(base_url).hostname in LOCAL_HOSTS and configured_debug is not False,
    )
