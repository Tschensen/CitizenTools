"""Prepare the pinned MSYS2 OCR runtime and its corresponding source download.

Python 3.14 is required for tarfile's Zstandard support. Cached downloads are
verified and reused; --offline forbids network access entirely.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / 'packaging/ocr-lock.json'
SOURCE_NAME = 'CitizenTools-Solo-OCR-Sources.zip'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def load_lock():
    return json.loads(LOCK.read_text(encoding='utf-8'))


def fetch(item, cache, offline):
    path = cache / item['filename']
    if Path(item['filename']).name != item['filename']:
        raise ValueError('Invalid package filename')
    if not path.is_file():
        if offline:
            raise FileNotFoundError(f'Not cached: {path}')
        cache.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + '.partial')
        with urllib.request.urlopen(item['url'], timeout=120) as response, temporary.open('wb') as target:
            shutil.copyfileobj(response, target)
        if digest(temporary) != item['sha256']:
            raise ValueError(f'Download hash mismatch: {path.name}')
        temporary.replace(path)
    if digest(path) != item['sha256']:
        raise ValueError(f'Cached hash mismatch: {path.name}')
    return path


def validate_runtime(runtime, lock=None):
    lock = lock or load_lock()
    expected = set(lock['runtime'])
    actual = {p.relative_to(runtime).as_posix() for p in runtime.rglob('*') if p.is_file()}
    if actual != expected:
        raise ValueError(f'OCR file list differs: missing={expected-actual}, extra={actual-expected}')
    for name, item in lock['runtime'].items():
        if digest(runtime / name) != item['sha256']:
            raise ValueError(f'OCR hash mismatch: {name}')


def validate_sources(path, lock=None):
    lock = lock or load_lock()
    with zipfile.ZipFile(path) as archive:
        if json.loads(archive.read('ocr-lock.json')) != lock:
            raise ValueError('OCR source archive uses a different lock')
        for item in lock['sources']:
            with archive.open('sources/' + item['filename']) as source:
                if hashlib.file_digest(source, 'sha256').hexdigest() != item['sha256']:
                    raise ValueError(f"Source hash mismatch: {item['filename']}")
        for name, item in lock['packages'].items():
            for filename, expected in item['metadata'].items():
                if hashlib.sha256(archive.read(f'package-metadata/{name}/{filename}')).hexdigest() != expected:
                    raise ValueError(f'Package metadata mismatch: {name}/{filename}')
            if item.get('languageData'):
                with archive.open('language-data/' + item['filename']) as source:
                    if hashlib.file_digest(source, 'sha256').hexdigest() != item['sha256']:
                        raise ValueError(f'Language data mismatch: {name}')


def prepare(cache, runtime, source_archive, offline=False):
    lock = load_lock()
    binaries = {name: fetch(item, cache/'packages', offline) for name, item in lock['packages'].items()}
    sources = {item['filename']: fetch(item, cache/'sources', offline) for item in lock['sources']}
    # Refuse an old distribution with unrelated DLLs; never silently mix bundles.
    unexpected = {p.relative_to(runtime).as_posix() for p in runtime.rglob('*') if p.is_file()} - set(lock['runtime'])
    if unexpected:
        raise ValueError(f'Use an empty runtime directory; unexpected files: {unexpected}')
    runtime.mkdir(parents=True, exist_ok=True)
    source_archive.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source_archive, 'w', zipfile.ZIP_STORED) as output:
        output.write(LOCK, 'ocr-lock.json')
        output.write(ROOT/'docs/OCR-SOURCES.md', 'README.md')
        for item in lock['sources']:
            output.write(sources[item['filename']], 'sources/' + item['filename'])
        for name, item in lock['packages'].items():
            with tarfile.open(binaries[name], 'r:*') as archive:
                for filename, expected in item['metadata'].items():
                    content = archive.extractfile(filename).read()
                    if hashlib.sha256(content).hexdigest() != expected:
                        raise ValueError(f'Package metadata mismatch: {name}/{filename}')
                    output.writestr(f'package-metadata/{name}/{filename}', content)
                for filename, member in lock['runtime'].items():
                    if member['package'] != name:
                        continue
                    destination = (runtime/filename).resolve()
                    if not destination.is_relative_to(runtime.resolve()):
                        raise ValueError('Runtime path escapes output directory')
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(archive.extractfile(member['member']).read())
            if item.get('languageData'):
                output.write(binaries[name], 'language-data/' + item['filename'])
    validate_runtime(runtime, lock)
    validate_sources(source_archive, lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache', type=Path, default=ROOT/'.build/ocr-cache')
    parser.add_argument('--output', type=Path, default=ROOT/'.build/ocr')
    parser.add_argument('--sources', type=Path, default=ROOT/'.build'/SOURCE_NAME)
    parser.add_argument('--offline', action='store_true')
    args = parser.parse_args()
    prepare(args.cache.resolve(), args.output.resolve(), args.sources.resolve(), args.offline)
    print(f'OCR runtime: {args.output}\nCorresponding sources: {args.sources}')


if __name__ == '__main__':
    main()
