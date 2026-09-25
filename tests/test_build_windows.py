import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.build_windows import publish_release


class StableReleaseTests(unittest.TestCase):
    names = ['CitizenTools-Solo', 'CitizenTools-Solo-Portable.zip', 'release.json']

    def prepare(self, root, version):
        root.mkdir()
        (root / self.names[0]).mkdir()
        (root / self.names[0] / 'CitizenTools-Solo.exe').write_text(version)
        for name in self.names[1:]:
            (root / name).write_text(version)

    def assert_version(self, root, version):
        self.assertEqual((root / self.names[0] / 'CitizenTools-Solo.exe').read_text(), version)
        for name in self.names[1:]:
            self.assertEqual((root / name).read_text(), version)

    def test_update_keeps_path_and_preserves_previous_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, first, second = root / 'dist', root / 'first', root / 'second'
            self.prepare(first, 'old')
            publish_release(first, output, self.names)
            self.prepare(second, 'new')
            publish_release(second, output, self.names)
            self.assert_version(output, 'new')
            self.assert_version(second / 'previous', 'old')

    def test_failed_publication_restores_entire_previous_release(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, stage = root / 'dist', root / 'stage'
            self.prepare(output, 'old')
            self.prepare(stage, 'new')
            rename = Path.rename
            def fail_archive(source, destination):
                if source == stage / self.names[1]:
                    raise PermissionError('Simulated locked file')
                return rename(source, destination)
            with patch.object(Path, 'rename', fail_archive):
                with self.assertRaises(RuntimeError):
                    publish_release(stage, output, self.names)
            self.assert_version(output, 'old')
            self.assert_version(stage, 'new')

            # Retrying a completely rolled-back publication needs no rebuild.
            publish_release(stage, output, self.names)
            self.assert_version(output, 'new')
            self.assert_version(stage / 'previous', 'old')

    def test_running_program_is_not_partially_replaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output, stage = root / 'dist', root / 'stage'
            self.prepare(output, 'old')
            self.prepare(stage, 'new')
            rename = Path.rename
            def locked_program(source, destination):
                if source == output / self.names[0]:
                    raise PermissionError('Simulated running program')
                return rename(source, destination)
            with patch.object(Path, 'rename', locked_program):
                with self.assertRaises(RuntimeError):
                    publish_release(stage, output, self.names)
            self.assert_version(output, 'old')
            self.assert_version(stage, 'new')
