"""使用 owner.json 标记持有者的跨进程目录锁。"""

import os
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .errors import TeehoError
from .storage import (
    ensure_private_directory,
    is_link,
    private_permissions,
    read_json,
    write_json,
)

STALE_INITIALIZATION_SECONDS = 60


@contextmanager
def _acquisition_guard(path: Path) -> Iterator[None]:
    """操作系统锁序列化本版回收过程，进程退出自动释放。"""
    guard = path.with_name("." + path.name + ".guard")
    with guard.open("a+b") as stream:
        private_permissions(guard)
        if os.name == "nt":
            import msvcrt

            stream.seek(0)
            try:
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise TeehoError("identity_busy") from error
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise TeehoError("identity_busy") from error
            try:
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)


def process_is_running(pid: int) -> bool:
    """权限不明时保守保留锁；Windows 不使用 os.kill。"""
    if os.name != "nt":
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        return True
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        return ctypes.get_last_error() != 87
    try:
        return kernel.WaitForSingleObject(handle, 0) != 0
    finally:
        kernel.CloseHandle(handle)


def _is_stale(path: Path) -> bool:
    try:
        owner = read_json(path / "owner.json")
        if isinstance(owner, dict):
            pid = owner.get("pid")
            return type(pid) is int and pid > 0 and not process_is_running(pid)
    except TeehoError:
        pass  # 未完成或损坏的初始化按目录年龄判断。
    return time.time() - path.stat().st_mtime > STALE_INITIALIZATION_SECONDS


def _acquire(path: Path) -> None:
    try:
        path.mkdir(mode=0o700)
        return
    except FileExistsError:
        if is_link(path):
            raise TeehoError("identity_busy") from None
    if not _is_stale(path):
        raise TeehoError("identity_busy")
    # 只移除协议规定的 owner 文件，未知内容不递归删除。
    try:
        (path / "owner.json").unlink(missing_ok=True)
        path.rmdir()
        path.mkdir(mode=0o700)
    except (FileExistsError, FileNotFoundError, OSError) as error:
        raise TeehoError("identity_busy") from error


@contextmanager
def lock_directory(path: Path) -> Iterator[None]:
    """持锁执行；只释放本次令牌所属的目录。"""
    path = Path(path)
    ensure_private_directory(path.parent)
    owner = {"pid": os.getpid(), "token": str(uuid.uuid4())}
    with _acquisition_guard(path):
        _acquire(path)
        try:
            write_json(path / "owner.json", owner)
        except BaseException:
            (path / "owner.json").unlink(missing_ok=True)
            path.rmdir()
            raise
    try:
        yield
    finally:
        if read_json(path / "owner.json") == owner:
            (path / "owner.json").unlink(missing_ok=True)
            path.rmdir()
