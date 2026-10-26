"""使用 owner.json 标记持有者的跨进程目录锁。"""

import os
import hashlib
import sys
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Optional

from .errors import TeehoError
from .storage import (
    ensure_private_directory,
    is_link,
    native_path,
    private_permissions,
    read_json,
    write_json,
)

STALE_INITIALIZATION_SECONDS = 60
RELEASE_LOCK_ATTEMPTS = 20
RELEASE_LOCK_DELAY_SECONDS = 0.01


def log_lock_event(log: Optional[Callable], event: str, fields: dict) -> None:
    """诊断输出失败不能留下已获取的锁或掩盖原业务错误。"""
    if not log:
        return
    try:
        log(event, fields)
    except Exception:
        try:
            sys.stderr.write(
                '{"level":"debug","event":"lock_diagnostics_unavailable"}\n'
            )
        except (OSError, ValueError):
            pass  # stderr 也关闭时仍必须允许锁正常释放。


def lock_debug_fields(path: Path) -> dict:
    """仅用于观测，读取失败不改变锁判定；不输出账号路径和 owner token。"""
    logical_path = str(path.absolute())
    if os.name == "nt":
        if logical_path.startswith("\\\\?\\UNC\\"):
            logical_path = "\\\\" + logical_path[8:]
        elif logical_path.startswith("\\\\?\\"):
            logical_path = logical_path[4:]
    fields = {
        "lockKind": {
            "identity.lock": "identity",
            "operation.lock": "operation",
            "observations.lock": "observations",
        }.get(path.name, "other"),
        "lockKeyHash": hashlib.sha256(
            os.path.normcase(logical_path).encode()
        ).hexdigest(),
    }
    try:
        # Windows 不能删除仍被诊断读取打开的 owner 文件；读取也必须服从释放守卫。
        # 守卫繁忙就省略 ownerPid，不为记录日志等待或干扰业务锁。
        with _acquisition_guard(path):
            if not is_link(path) and not is_link(path / "owner.json"):
                owner = read_json(path / "owner.json")
                pid = owner.get("pid") if isinstance(owner, dict) else None
                if type(pid) is int and pid > 0:
                    return {**fields, "ownerPid": pid}
    except (OSError, TeehoError):
        pass  # 诊断读取竞态不影响实际锁的获取或释放。
    return fields


def _lock_guard(acquire: Callable[[], None], wait: bool) -> None:
    attempts = RELEASE_LOCK_ATTEMPTS if wait else 1
    for attempt in range(attempts):
        try:
            acquire()
            return
        except OSError as error:
            if attempt == attempts - 1:
                raise TeehoError("identity_busy") from error
            time.sleep(RELEASE_LOCK_DELAY_SECONDS)


@contextmanager
def _acquisition_guard(path: Path, wait: bool = False) -> Iterator[None]:
    """操作系统锁序列化本版回收过程，进程退出自动释放。"""
    guard = native_path(path).with_name("." + path.name + ".guard")
    with guard.open("a+b") as stream:
        private_permissions(guard)
        if os.name == "nt":
            import msvcrt

            stream.seek(0)
            _lock_guard(
                lambda: msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1), wait
            )
            try:
                yield
            finally:
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            _lock_guard(
                lambda: fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB), wait
            )
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
def lock_directory(path: Path, *, log: Optional[Callable] = None) -> Iterator[None]:
    """持锁执行；只释放本次令牌所属的目录。"""
    path = native_path(path)
    started = time.monotonic()
    ensure_private_directory(path.parent)
    owner = {"pid": os.getpid(), "token": str(uuid.uuid4())}
    try:
        with _acquisition_guard(path):
            _acquire(path)
            try:
                write_json(path / "owner.json", owner)
            except BaseException:
                (path / "owner.json").unlink(missing_ok=True)
                path.rmdir()
                raise
    except TeehoError as error:
        if log and error.code == "identity_busy":
            log_lock_event(
                log,
                "lock_busy",
                {
                    **lock_debug_fields(path),
                    "waitMs": round((time.monotonic() - started) * 1000),
                },
            )
        raise
    acquired = time.monotonic()
    context = lock_debug_fields(path) if log else {}
    log_lock_event(
        log,
        "lock_acquired",
        {**context, "waitMs": round((acquired - started) * 1000)},
    )
    try:
        yield
    finally:
        # Windows 不允许删除被竞争者读取的文件；释放与陈旧锁检查共用守卫。
        with _acquisition_guard(path, wait=True):
            if read_json(path / "owner.json") == owner:
                (path / "owner.json").unlink(missing_ok=True)
                path.rmdir()
                log_lock_event(
                    log,
                    "lock_released",
                    {**context, "holdMs": round((time.monotonic() - acquired) * 1000)},
                )
