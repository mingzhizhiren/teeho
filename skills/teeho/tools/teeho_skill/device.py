"""题火专用设备摘要；不返回原始机器标识。"""

import hashlib
import os
import re
import socket
import subprocess
import sys
from pathlib import Path
from typing import Optional

COMMAND_TIMEOUT_SECONDS = 5
MAX_COMMAND_BYTES = 128 * 1024


def _usable(value: object) -> Optional[str]:
    text = str(value or "").strip().lower()
    compact = text.replace("-", "").replace(":", "")
    if (
        not text
        or re.fullmatch(r"0+|f+", compact)
        or re.search(r"unknown|default|to be filled", text)
    ):
        return None
    return text


def _command(arguments: list[str]) -> Optional[str]:
    try:
        result = subprocess.run(
            arguments,
            capture_output=True,
            check=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if len(result.stdout) <= MAX_COMMAND_BYTES:
            return result.stdout.decode("utf-8", errors="replace")
    except (OSError, subprocess.SubprocessError):
        return None
    return None


def _windows_identifier() -> tuple[Optional[str], str]:
    import winreg

    try:
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
            0,
            winreg.KEY_READ | winreg.KEY_WOW64_64KEY,
        ) as key:
            candidate = _usable(winreg.QueryValueEx(key, "MachineGuid")[0])
        if candidate:
            return candidate, "MachineGuid"
    except OSError:
        pass  # 注册表不可用时尝试 SMBIOS。
    candidate = _usable(
        _command(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-CimInstance Win32_ComputerSystemProduct -ErrorAction Stop).UUID",
            ]
        )
    )
    return candidate, "SMBIOS"


def _mac_addresses() -> list[str]:
    if sys.platform == "win32":
        output = (
            _command(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "Get-NetAdapter -ErrorAction Stop | "
                    "Where-Object Status -eq Up | "
                    "Select-Object -ExpandProperty MacAddress",
                ]
            )
            or ""
        )
        values = [line.replace("-", ":") for line in output.splitlines()]
    elif sys.platform == "linux":
        values = []
        for _, name in socket.if_nameindex():
            if name == "lo":
                continue
            try:
                values = [
                    *values,
                    (Path("/sys/class/net") / name / "address").read_text(encoding="utf-8"),
                ]
            except OSError:
                continue
    elif sys.platform == "darwin":
        values = re.findall(r"\bether\s+([a-fA-F0-9:]{17})", _command(["/sbin/ifconfig"]) or "")
    else:
        values = []
    return sorted(candidate for value in values if (candidate := _usable(value)))


def machine_identifier() -> Optional[str]:
    """按 teeho-device-v1 契约规范化平台及设备来源。"""
    candidate, source = None, ""
    if sys.platform == "win32":
        candidate, source = _windows_identifier()
    elif sys.platform == "linux":
        for path in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
            try:
                candidate = _usable(Path(path).read_text(encoding="utf-8"))
            except OSError:
                continue
            if candidate:
                source = "machine-id"
                break
    elif sys.platform == "darwin":
        output = _command(["/usr/sbin/ioreg", "-rd1", "-c", "IOPlatformExpertDevice"])
        match = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', output or "")
        candidate, source = _usable(match[1] if match else None), "IOPlatformUUID"
    if not candidate:
        addresses = _mac_addresses()
        candidate, source = addresses[0] if addresses else None, "mac"
    if not candidate:
        return None
    value = f"teeho-device-v1:{sys.platform}:{source}:{candidate}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
