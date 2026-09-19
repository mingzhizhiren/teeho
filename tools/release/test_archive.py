"""Validate the documented ZIP extractor against valid and unsafe archives."""

import re
import stat
import struct
import warnings
import zipfile
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

DOCUMENT = Path(__file__).resolve().parents[2] / "docs/skill-install.md"


def load_extractor() -> types.ModuleType:
    text = DOCUMENT.read_text(encoding="utf-8")
    source = re.search(
        r"<!-- python-extract:start -->\s*```python\n(.*?)\n```\s*<!-- python-extract:end -->",
        text,
        re.S,
    )
    if source is None:
        raise AssertionError("Installation extraction implementation is missing")
    module = types.ModuleType("documented_skill_extractor")
    exec(compile(source[1], str(DOCUMENT), "exec"), module.__dict__)
    return module


class ArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(prefix="teeho-archive-compat-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.extractor = load_extractor()

    def archive(
        self, names: list[str], kind: int = stat.S_IFREG,
        compression: int = zipfile.ZIP_DEFLATED,
    ) -> Path:
        output = self.root / "skill.zip"
        with warnings.catch_warnings(), zipfile.ZipFile(output, "w") as archive:
            warnings.simplefilter("ignore", UserWarning)
            for name in names:
                member = zipfile.ZipInfo(name)
                member.filename = name
                member.orig_filename = name
                member.create_system = 3
                member.external_attr = (kind | 0o600) << 16
                member.compress_type = compression
                archive.writestr(member, b"synthetic skill content")
        return output

    def test_stored_and_deflated_files_extract_without_extractall(self) -> None:
        for compression in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            with self.subTest(compression=compression):
                archive = self.archive(
                    ["teeho/SKILL.md", "teeho/tools/entry.py"], compression=compression
                )
                destination = self.root / str(compression)
                with patch.object(zipfile.ZipFile, "extractall", side_effect=AssertionError):
                    self.extractor.extract_skill_archive(str(archive), str(destination), "teeho")
                self.assertEqual(
                    (destination / "teeho/tools/entry.py").read_bytes(), b"synthetic skill content"
                )

    def test_explicit_directories_and_unicode_names(self) -> None:
        archive = self.root / "directories.zip"
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as output:
            output.writestr("teeho/", b"")
            output.writestr("teeho/tools/", b"")
            output.writestr("teeho/tools/\u793a\u4f8b.py", b"pass")
        destination = self.root / "directories"
        self.extractor.extract_skill_archive(str(archive), str(destination), "teeho")
        self.assertEqual((destination / "teeho/tools/\u793a\u4f8b.py").read_bytes(), b"pass")

    def test_corrupt_payload_fails_crc_check(self) -> None:
        archive = self.archive(["teeho/SKILL.md"], compression=zipfile.ZIP_STORED)
        data = archive.read_bytes()
        offset = 30 + struct.unpack_from("<H", data, 26)[0] + struct.unpack_from("<H", data, 28)[0]
        archive.write_bytes(data[:offset] + bytes([data[offset] ^ 1]) + data[offset + 1:])
        with self.assertRaises(zipfile.BadZipFile):
            self.extractor.extract_skill_archive(str(archive), str(self.root / "crc"), "teeho")

    def test_invalid_and_truncated_archives_are_rejected(self) -> None:
        archive = self.archive(["teeho/SKILL.md"])
        valid = archive.read_bytes()
        for index, payload in enumerate((b"not zip", valid[:-30])):
            archive.write_bytes(payload)
            with self.assertRaises(zipfile.BadZipFile):
                self.extractor.extract_skill_archive(
                    str(archive), str(self.root / f"corrupt-{index}"), "teeho"
                )

    def test_unsafe_paths_never_escape_temporary_directory(self) -> None:
        names = [
            "teeho/../outside",
            "/absolute",
            "C:/outside",
            "other/file",
            "teeho/dir\\file",
            "teeho/CON",
            "teeho/file.",
            "teeho/file ",
            "teeho/file:stream",
            "teeho/a/./b",
            "teeho/file?",
            "teeho/file|",
            "teeho/a//b",
        ]
        for index, name in enumerate(names):
            with self.subTest(name=name):
                archive = self.archive([name])
                destination = self.root / f"invalid-{index}"
                with self.assertRaises(ValueError):
                    self.extractor.extract_skill_archive(str(archive), str(destination), "teeho")
                self.assertEqual(list(destination.iterdir()), [])
        self.assertFalse((self.root / "outside").exists())

    def test_links_and_special_files_are_rejected(self) -> None:
        for index, kind in enumerate(
            (stat.S_IFLNK, stat.S_IFCHR, stat.S_IFIFO, stat.S_IFSOCK)
        ):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                archive = self.archive(["teeho/unsafe"], kind)
                self.extractor.extract_skill_archive(
                    str(archive), str(self.root / f"special-{index}"), "teeho"
                )

    def test_duplicates_case_collisions_and_file_parents_are_rejected(self) -> None:
        cases = (
            ["teeho/a.py", "teeho/a.py"],
            ["teeho/a.py", "teeho/A.py"],
            ["teeho/file", "teeho/file/child"],
            ["teeho/file/child", "teeho/file"],
            ["teeho/Tools/a", "teeho/tools/b"],
            ["teeho/Tools/a", "teeho/tools"],
        )
        for index, names in enumerate(cases):
            with self.subTest(names=names), self.assertRaises(ValueError):
                archive = self.archive(names)
                self.extractor.extract_skill_archive(
                    str(archive), str(self.root / f"collision-{index}"), "teeho"
                )

    def test_size_and_count_limits_are_enforced(self) -> None:
        archive = self.archive(["teeho/a.py", "teeho/b.py"])
        for index, constant in enumerate(("MAX_ARCHIVE_ENTRIES", "MAX_UNPACKED_BYTES")):
            with patch.object(self.extractor, constant, 1), self.assertRaises(ValueError):
                self.extractor.extract_skill_archive(
                    str(archive), str(self.root / f"limit-{index}"), "teeho"
                )

    def test_empty_archive_and_insufficient_space_are_rejected(self) -> None:
        archive = self.archive([])
        with self.assertRaises(ValueError):
            self.extractor.extract_skill_archive(str(archive), str(self.root / "empty"), "teeho")
        archive = self.archive(["teeho/a.py"])
        with patch.object(
            self.extractor.shutil, "disk_usage", return_value=types.SimpleNamespace(free=0)
        ), self.assertRaises(ValueError):
            self.extractor.extract_skill_archive(str(archive), str(self.root / "full"), "teeho")

    def test_encryption_and_unsupported_compression_are_rejected_before_writes(self) -> None:
        archive = self.archive(["teeho/a.py"], compression=zipfile.ZIP_STORED)
        original = archive.read_bytes()
        central = original.index(b"PK\x01\x02")
        cases = ((6, central + 8, 1), (8, central + 10, 99))
        for index, (local_offset, central_offset, value) in enumerate(cases):
            changes = {local_offset: value, central_offset: value}
            archive.write_bytes(bytes(changes.get(offset, byte) for offset, byte in enumerate(original)))
            destination = self.root / f"unsupported-{index}"
            with self.assertRaises(ValueError):
                self.extractor.extract_skill_archive(str(archive), str(destination), "teeho")
            self.assertEqual(list(destination.iterdir()), [])

    def test_directory_metadata_must_match_name_and_have_no_payload(self) -> None:
        cases = (
            ("teeho/directory", stat.S_IFDIR, b""),
            ("teeho/directory/", stat.S_IFREG, b""),
            ("teeho/directory/", stat.S_IFDIR, b"unexpected"),
        )
        for index, (name, kind, payload) in enumerate(cases):
            archive = self.root / "mismatch.zip"
            with zipfile.ZipFile(archive, "w") as output:
                member = zipfile.ZipInfo(name)
                member.create_system = 3
                member.external_attr = (kind | 0o700) << 16
                output.writestr(member, payload)
            with self.assertRaises(ValueError):
                self.extractor.extract_skill_archive(
                    str(archive), str(self.root / f"mismatch-{index}"), "teeho"
                )

    def test_existing_destination_is_never_overwritten(self) -> None:
        archive = self.archive(["teeho/SKILL.md"])
        destination = self.root / "existing"
        destination.mkdir()
        marker = destination / "keep.txt"
        marker.write_text("keep", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            self.extractor.extract_skill_archive(str(archive), str(destination), "teeho")
        self.assertEqual(marker.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
