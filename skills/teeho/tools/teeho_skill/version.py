"""技能发布身份；与服务端和打包工具共用 release.json。"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from .errors import TeehoError

UPGRADE_REQUIRED_CODE = 4260
VERSION_PATTERN = re.compile(r"(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})")


def _release() -> dict:
    try:
        value = json.loads(
            (Path(__file__).resolve().parents[2] / "release.json").read_text(
                encoding="utf-8"
            )
        )
    except (OSError, ValueError) as error:
        raise TeehoError("invalid_skill_installation") from error
    if not isinstance(value, dict):
        raise TeehoError("invalid_skill_installation")
    return value


def safe_version(value: object) -> Optional[str]:
    """版本只接受稳定三段数字，不把服务端自由文本带入提示。"""
    return (
        value if isinstance(value, str) and VERSION_PATTERN.fullmatch(value) else None
    )


@lru_cache(maxsize=1)
def skill_version() -> str:
    """读取当前安装包身份，不访问网络或用户数据。"""
    version = safe_version(_release().get("version"))
    if version:
        return version
    raise TeehoError("invalid_skill_installation")


def _installation_url(value: object) -> str:
    if not isinstance(value, str) or re.search(r"\s|[\x00-\x1f\x7f]", value):
        raise TeehoError("invalid_skill_installation")
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme == "https"
            and parsed.hostname
            and parsed.username is None
            and parsed.password is None
            and parsed.port in (None, 443)
            and not parsed.query
            and not parsed.fragment
            and parsed.path.endswith("/skill-install.md")
        ):
            return value
    except ValueError as error:
        raise TeehoError("invalid_skill_installation") from error
    raise TeehoError("invalid_skill_installation")


@lru_cache(maxsize=1)
def _installation_urls() -> tuple[str, str]:
    links = _release().get("installationUrls")
    if not isinstance(links, dict):
        raise TeehoError("invalid_skill_installation")
    return _installation_url(links.get("official")), _installation_url(
        links.get("github")
    )


def installation_urls() -> dict[str, str]:
    """只使用随包发布的安装说明地址；接口响应或旧快照不能改写目标。"""
    official, github = _installation_urls()
    return {"officialInstallUrl": official, "githubInstallUrl": github}


class SkillUpgradeRequired(TeehoError):
    """升级属于终止本次调用的兼容错误，保持身份与待恢复任务。"""

    def __init__(self, status: int, base_url: str, details: object) -> None:
        super().__init__("skill_upgrade_required", status)
        data = details if isinstance(details, dict) else {}
        self.details = {
            "currentVersion": skill_version(),
            "minimumVersion": safe_version(data.get("minimumVersion")),
            "latestVersion": safe_version(data.get("latestVersion")),
            **installation_urls(),
            # 兼容旧展示快照的内部字段；新版提示统一展示两个可信安装说明入口。
            "downloadUrl": base_url + "/skill/download",
        }
