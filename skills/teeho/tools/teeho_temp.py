"""在系统临时位置初始化题火命令工作目录，不读取身份或调用业务接口。"""

import json
import sys
import tempfile
from pathlib import Path


def create_temp_directory() -> Path:
    """拒绝落在当前项目或技能目录内的临时根，创建独立目录。"""
    root = Path(tempfile.gettempdir()).resolve()
    protected = (Path.cwd().resolve(), Path(__file__).resolve().parent.parent)
    if any(root == path or path in root.parents for path in protected):
        raise ValueError("System temporary directory points inside the project or skill directory.")
    return Path(tempfile.mkdtemp(prefix="teeho-", dir=root)).resolve()


def main() -> int:
    try:
        directory = str(create_temp_directory())
    except (OSError, ValueError):
        sys.stderr.write("Cannot create a temporary workspace outside the project. Check temporary directory permissions and configuration.\n")
        return 1
    sys.stdout.write(json.dumps({"directory": directory, "workdir": directory}) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
