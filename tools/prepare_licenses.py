"""Collect bundled license documents without network access or user data."""
import importlib.metadata
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT / 'packaging/licenses'
DEPENDENCIES = {
    'pywebview': ('BSD-3-Clause', 'https://github.com/r0x0r/pywebview'),
    'pythonnet': ('MIT', 'https://github.com/pythonnet/pythonnet'),
    'clr_loader': ('MIT', 'https://github.com/pythonnet/clr-loader'),
    'cffi': ('MIT-0 / dependency notices', 'https://cffi.readthedocs.io/'),
    'pycparser': ('BSD-3-Clause', 'https://github.com/eliben/pycparser'),
    'bottle': ('MIT', 'https://bottlepy.org/'),
    'typing_extensions': ('PSF-2.0', 'https://github.com/python/typing_extensions'),
}


def prepare(output: Path):
    output.mkdir(parents=True, exist_ok=True)
    registry = json.loads((SOURCES / 'registry.json').read_text(encoding='utf-8'))
    catalog = []

    def add(source, filename, title, license_name, group='third-party', url=''):
        target = output / filename
        if source.resolve() != target.resolve():
            shutil.copy2(source, target)
        catalog.append({'id': filename, 'file': filename, 'title': title,
                        'license': license_name, 'group': group, 'source': url})

    project = json.loads((ROOT/'project.json').read_text(encoding='utf-8'))
    add(ROOT/'LICENSE', 'CITIZEN-TOOLS-GPL.txt', project['name'], project['license'], 'project', project['repository'])
    add(ROOT/'NOTICE.md', 'CITIZEN-TOOLS-NOTICE.txt', 'Geltungsbereich / License scope', 'Hinweise / Notices', 'project')
    for item in registry:
        add(SOURCES/item['file'], item['file'], item['title'], item.get('license', 'Original license / notices'), url=item.get('source', ''))
    for name, (license_name, url) in DEPENDENCIES.items():
        distribution = importlib.metadata.distribution(name)
        files = [file for file in distribution.files or [] if '.dist-info/' in str(file)
                 and Path(file).name.lower().startswith(('license', 'copying', 'authors', 'notice'))]
        if not files:
            raise RuntimeError(f'Missing license documents: {name}')
        for file in files:
            add(Path(distribution.locate_file(file)), f'{name}-{Path(file).name}',
                f'{name} {distribution.version}' + (' · Authors' if 'authors' in str(file).lower() else ''), license_name, url=url)
    distribution = importlib.metadata.distribution('pyinstaller')
    copying = next(file for file in distribution.files if Path(file).name == 'COPYING.txt')
    add(Path(distribution.locate_file(copying)), 'PYINSTALLER-COPYING.txt', f'PyInstaller {distribution.version}',
        'GPL-2.0-or-later + Bootloader Exception / Apache-2.0', url='https://pyinstaller.org/en/stable/license.html')
    python_license = Path(sys.base_prefix)/'LICENSE.txt'
    if not python_license.is_file():
        python_license = SOURCES/'PYTHON-PSF-LICENSE.txt'
    add(python_license, 'PYTHON-PSF-LICENSE.txt', 'Python ' + sys.version.split()[0], 'PSF-2.0 / dependency notices', url='https://docs.python.org/3/license.html')
    (output/'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return catalog


if __name__ == '__main__':
    print(f'{len(prepare(SOURCES))} local license documents prepared.')
