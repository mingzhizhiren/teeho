"""题火技能的唯一命令入口；只依赖 Python 标准库。"""

import json
import sys

sys.dont_write_bytecode = True


def main() -> int:
    """检查运行环境后装配 CLI，导入模块时不执行业务。"""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    if sys.version_info < (3, 9):
        print(
            json.dumps(
                {
                    "state": "invalid_configuration",
                    "displayText": "Python 3.9 or newer is required.",
                    "nextAction": None,
                }
            ),
            flush=True,
        )
        return 1
    from teeho_skill.cli import main as run_cli

    return run_cli()


if __name__ == "__main__":
    raise SystemExit(main())
