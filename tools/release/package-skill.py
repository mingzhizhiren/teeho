"""使用 Python 标准库生成可重复的社区 ZIP 技能包。"""

import base64
import json
import sys
import zipfile

ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
REGULAR_FILE_MODE = 0o100644
MODE_SHIFT = 16
COMPRESSION_LEVEL = 9
UNIX_PLATFORM = 3


def main() -> None:
    entries = json.load(sys.stdin)
    with zipfile.ZipFile(sys.argv[1], "w", allowZip64=False) as archive:
        for name, encoded in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=ZIP_TIMESTAMP)
            info.create_system = UNIX_PLATFORM
            info.external_attr = REGULAR_FILE_MODE << MODE_SHIFT
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(
                info,
                base64.b64decode(encoded, validate=True),
                compresslevel=COMPRESSION_LEVEL,
            )


if __name__ == "__main__":
    main()
