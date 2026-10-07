"""Cache native binaries separately from replaceable application resources."""
import hashlib
from importlib import metadata
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import uuid


def file_digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def environment_signature():
    packages = sorted((item.metadata['Name'], item.version, item.read_text('RECORD') or '')
                      for item in metadata.distributions())
    return {'python': sys.version, 'executable': sys.executable, 'basePrefix': sys.base_prefix,
            'machine': platform.machine(), 'packages': packages}


def native_key(root, kind, environment):
    if kind == 'app':
        sources = list(root.glob('*.py'))
        for tree in ['companion', 'server', 'shared']:
            sources.extend((root / tree).rglob('*.py'))
    elif kind == 'helper':
        sources = [root / name for name in ['update_helper.py', 'update_contract.py']]
    else:
        raise ValueError('Unknown native target')
    sources += [root / name for name in ['requirements.txt', 'requirements-build.txt',
                                        'tools/build_cache.py', 'companion/assets/citizen-tools.ico']]
    files = {path.relative_to(root).as_posix(): file_digest(path) for path in sorted(set(sources))
             if path.is_file() and '__pycache__' not in path.parts}
    inputs = {'kind': kind, 'root': str(root.resolve()), 'environment': environment, 'files': files}
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


def inventory(folder):
    result = {}
    for path in sorted(folder.rglob('*')):
        if path.is_symlink() or path.is_junction():
            raise ValueError('Native cache must not contain links')
        if path.is_file():
            result[path.relative_to(folder).as_posix()] = file_digest(path)
    return result


def cached_bundle(cache, key, build, *, force=False):
    """Reuse only complete, unchanged outputs. Failed builds never replace a hit."""
    cache.mkdir(parents=True, exist_ok=True)
    index = cache / (key + '.json')
    if not force:
        try:
            entry = json.loads(index.read_text(encoding='utf-8'))
            name = entry['directory']
            if re.fullmatch(r'[a-f0-9]{32}', name):
                folder = cache / name / 'bundle'
                if (not folder.parent.is_symlink() and not folder.parent.is_junction()
                        and folder.is_dir() and not folder.is_symlink() and not folder.is_junction()
                        and entry['files'] and inventory(folder) == entry['files']):
                    return folder, True
        except (OSError, ValueError, KeyError, TypeError):
            pass
    work = cache / uuid.uuid4().hex
    work.mkdir()
    bundle = build(work)
    files = inventory(bundle)
    if not files:
        raise ValueError('Native build produced no files')
    bundle.rename(work / 'bundle')
    temporary = work / 'index.json'
    temporary.write_text(json.dumps({'directory': work.name, 'files': files}), encoding='utf-8')
    temporary.replace(index)
    return work / 'bundle', False


def compile_native(root, cache, kind, environment, *, force=False):
    key = native_key(root, kind, environment)
    name = 'CitizenTools-Solo' if kind == 'app' else 'CitizenTools-Updater'

    def build(work):
        output = work / 'dist'
        command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean',
                   '--onedir' if kind == 'app' else '--onefile', '--windowed', '--name', name,
                   '--distpath', str(output), '--workpath', str(work / 'build'),
                   '--specpath', str(work / 'spec'), '--icon', str(root / 'companion/assets/citizen-tools.ico')]
        if kind == 'app':
            command += ['--collect-all', 'webview', '--hidden-import', 'webview.platforms.edgechromium',
                        '--hidden-import', 'webview.platforms.winforms']
        command.append(str(root / ('app.py' if kind == 'app' else 'update_helper.py')))
        # Resources are assembled afterwards; none are frozen into this cache.
        subprocess.run(command, cwd=root, check=True)
        return output / name if kind == 'app' else output

    bundle, reused = cached_bundle(cache, key, build, force=force)
    print(f'{name}: {"Cache verwendet" if reused else "neu kompiliert"}', flush=True)
    return bundle, {'key': key, 'reused': reused}
