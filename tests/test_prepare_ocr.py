import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from tools.prepare_ocr import fetch, validate_runtime, validate_sources


class OcrReleaseTests(unittest.TestCase):
    def test_runtime_rejects_changed_or_extra_dlls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root/'tesseract.exe'
            binary.write_bytes(b'original')
            lock = {'runtime': {'tesseract.exe': {'sha256': hashlib.sha256(b'original').hexdigest()}}}
            validate_runtime(root, lock)
            binary.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                validate_runtime(root, lock)
            binary.write_bytes(b'original')
            (root/'old.dll').write_bytes(b'legacy')
            with self.assertRaisesRegex(ValueError, 'file list differs'):
                validate_runtime(root, lock)

    def test_offline_never_downloads_and_checks_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory)
            item = {'filename': 'package.zst', 'url': 'https://invalid.example/package.zst',
                    'sha256': hashlib.sha256(b'original').hexdigest()}
            with patch('tools.prepare_ocr.urllib.request.urlopen') as network:
                with self.assertRaises(FileNotFoundError):
                    fetch(item, cache, True)
                (cache/item['filename']).write_bytes(b'original')
                self.assertEqual(fetch(item, cache, True), cache/item['filename'])
                (cache/item['filename']).write_bytes(b'corrupt')
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    fetch(item, cache, True)
                network.assert_not_called()

    def test_sources_rejects_wrong_sources_even_with_matching_lock(self):
        lock = {'sources': [{'filename': 'source.zst', 'sha256': hashlib.sha256(b'original').hexdigest()}], 'packages': {}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'sources.zip'
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('ocr-lock.json', json.dumps(lock))
                archive.writestr('sources/source.zst', b'wrong source')
            with self.assertRaisesRegex(ValueError, 'Source hash mismatch'):
                validate_sources(path, lock)


if __name__ == '__main__':
    unittest.main()
