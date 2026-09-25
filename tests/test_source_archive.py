import sys
import tempfile
from pathlib import Path
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.source_archive import create_archive, ROOT_FILES


class SourceArchiveTests(unittest.TestCase):
    def test_only_source_files_are_archived(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for name in ROOT_FILES:
                (root/name).write_text('source', encoding='utf-8')
            included = ['web/app.js', 'companion/capture.py', 'packaging/licenses/NOTICE.txt']
            excluded = ['.build/report.json', 'dist/app.exe', '.venv/secret.py', 'server/data/accounts.json',
                        'companion/settings.json', 'companion/capture-state.json', 'companion/__pycache__/cache.pyc',
                        'web/.credentials.json', 'packaging/licenses/EULA-de.txt', 'web/data/private.json']
            for name in included + excluded:
                file = root/name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text(name, encoding='utf-8')
            output = root/'source.zip'
            create_archive(output, root)
            with zipfile.ZipFile(output) as archive:
                names = archive.namelist()
                for name in included + list(ROOT_FILES):
                    self.assertIn('CitizenTools-Source/'+name, names)
                for name in excluded:
                    self.assertNotIn('CitizenTools-Source/'+name, names)


if __name__ == '__main__':
    unittest.main()
