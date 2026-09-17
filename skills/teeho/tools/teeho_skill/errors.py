"""可安全交给展示层的稳定错误。"""

from typing import Optional


class TeehoError(Exception):
    """携带公开错误码，原始服务响应不进入异常文本。"""

    def __init__(self, code: str, status: Optional[int] = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status
