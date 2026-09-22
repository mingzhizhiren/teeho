"""技能发布身份；与服务端和打包工具共用 release.json。"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

from .errors import TeehoError

UPGRADE_REQUIRED_CODE = 4260
VERSION_PATTERN = re.compile(r"(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})")


def safe_version(value: object) -> Optional[str]:
    """版本只接受稳定三段数字，不把服务端自由文本带入提示。"""
    return value if isinstance(value, str) and VERSION_PATTERN.fullmatch(value) else None


@lru_cache(maxsize=1)
def skill_version() -> str:
    """读取当前安装包身份，不访问网络或用户数据。"""
    try:
        release = json.loads(
            (Path(__file__).resolve().parents[2] / "release.json").read_text(encoding="utf-8")
        )
        version = safe_version(release.get("version"))
        if version:
            return version
    except (OSError, ValueError, AttributeError) as error:
        raise TeehoError("invalid_skill_installation") from error
    raise TeehoError("invalid_skill_installation")


class SkillUpgradeRequired(TeehoError):
    """升级属于终止本次调用的兼容错误，保持身份与待恢复任务。"""

    def __init__(self, status: int, base_url: str, details: object) -> None:
        super().__init__("skill_upgrade_required", status)
        data = details if isinstance(details, dict) else {}
        self.details = {
            "currentVersion": skill_version(),
            "minimumVersion": safe_version(data.get("minimumVersion")),
            "latestVersion": safe_version(data.get("latestVersion")),
            # 固定同站 API 路径，不执行或跟随响应中任意安装命令、地址。
            "downloadUrl": base_url + "/skill/download",
        }
