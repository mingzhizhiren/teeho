"""有界 JSON 读取与私有文件原子替换。"""

import json
import math
import os
import stat
import tempfile
from functools import lru_cache
from pathlib import Path

from .errors import TeehoError

MAX_JSON_BYTES = 32 * 1024 * 1024


@lru_cache(maxsize=1)
def _windows_user_sid() -> str:
    """读取当前进程用户 SID，避免将 Administrators 所有者误当用户。"""
    import ctypes
    from ctypes import wintypes

    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    security.OpenProcessToken.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.HANDLE),
    ]
    security.GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    security.ConvertSidToStringSidW.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(wintypes.LPWSTR),
    ]
    token, length = wintypes.HANDLE(), wintypes.DWORD()
    if not security.OpenProcessToken(kernel.GetCurrentProcess(), 0x0008, ctypes.byref(token)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        security.GetTokenInformation(token, 1, None, 0, ctypes.byref(length))
        if not length.value:
            raise ctypes.WinError(ctypes.get_last_error())
        buffer = ctypes.create_string_buffer(length.value)
        if not security.GetTokenInformation(token, 1, buffer, length, ctypes.byref(length)):
            raise ctypes.WinError(ctypes.get_last_error())
        sid = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_void_p))[0]
        text = wintypes.LPWSTR()
        if not security.ConvertSidToStringSidW(sid, ctypes.byref(text)):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            return text.value
        finally:
            kernel.LocalFree(text)
    finally:
        kernel.CloseHandle(token)


def _windows_dacl(path: Path, dacl: str) -> None:
    """应用调用方明确指定的 Windows DACL。"""
    import ctypes
    from ctypes import wintypes

    security = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    convert = security.ConvertStringSecurityDescriptorToSecurityDescriptorW
    convert.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
        ctypes.c_void_p,
    ]
    convert.restype = wintypes.BOOL
    apply = security.SetFileSecurityW
    apply.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p]
    apply.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    descriptor = ctypes.c_void_p()
    if not convert(dacl, 1, ctypes.byref(descriptor), None):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        if not apply(str(path), 0x80000004, descriptor):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel.LocalFree(descriptor)


def private_permissions(path: Path, is_directory: bool = False) -> None:
    """限制凭据、缓存与日志权限，不改变系统用户主目录。"""
    if os.name == "nt":
        inheritance = "OICI" if is_directory else ""
        _windows_dacl(path, f"D:P(A;{inheritance};FA;;;{_windows_user_sid()})")
    else:
        path.chmod(0o700 if is_directory else 0o600)


def is_link(path: Path) -> bool:
    """识别符号链接和 Windows 目录联接，兼容没有 Path.is_junction 的版本。"""
    try:
        info = Path(path).lstat()
    except FileNotFoundError:
        return False
    if stat.S_ISLNK(info.st_mode):
        return True
    return os.name == "nt" and info.st_reparse_tag == stat.IO_REPARSE_TAG_MOUNT_POINT


def ensure_private_directory(path: Path) -> None:
    """创建目录链，新目录均仅属于当前用户。"""
    path = Path(path)
    if is_link(path):
        raise TeehoError("invalid_local_data")
    if not path.exists():
        if not path.parent.exists():
            ensure_private_directory(path.parent)
        path.mkdir(mode=0o700, exist_ok=True)
    if not path.is_dir():
        raise NotADirectoryError(str(path))
    private_permissions(path, is_directory=True)


def _reject_constant(value: str) -> None:
    raise ValueError("non_finite_json")


def _finite_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non_finite_json")
    return number


def read_json(path: Path, default: object = None) -> object:
    """缺文件返回默认值；畸形、超限或标量 JSON 明确失败。"""
    try:
        with Path(path).open("rb") as stream:
            content = stream.read(MAX_JSON_BYTES + 1)
    except FileNotFoundError:
        return default
    if len(content) > MAX_JSON_BYTES:
        raise TeehoError("invalid_local_data")
    try:
        value = json.loads(
            content.decode("utf-8"),
            parse_constant=_reject_constant,
            parse_float=_finite_float,
        )
    except (ValueError, UnicodeError, RecursionError) as error:
        raise TeehoError("invalid_local_data") from error
    if value is not None and not isinstance(value, (dict, list)):
        raise TeehoError("invalid_local_data")
    return value


def write_json(path: Path, value: object) -> None:
    """临时文件同步落盘后原子替换，失败保留旧文件。"""
    path = Path(path)
    data = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
        "utf-8"
    )
    if len(data) > MAX_JSON_BYTES:
        raise TeehoError("invalid_local_data")
    ensure_private_directory(path.parent)
    descriptor, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=path.parent)
    temporary_path = Path(temporary)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            private_permissions(temporary_path)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)
