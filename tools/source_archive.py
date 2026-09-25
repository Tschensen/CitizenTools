"""An explicit source-only archive; never includes .build, .venv or user data."""
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ('app.py', 'runtime.py', 'solo_about.py', 'solo_sounds.py', 'transfer.py',
              'project.json', 'LICENSE', 'NOTICE.md', 'README.md', 'requirements.txt', 'release-notes.json')
EXTRA_ROOT_FILES = ('.gitignore', '.gitattributes', 'CHANGELOG.md')
CODE_TREES = ('companion', 'server', 'shared', 'web', 'tools', 'tests', 'packaging', 'docs')
SUFFIXES = {'.py', '.ps1', '.js', '.html', '.css', '.json', '.md', '.txt', '.iss', '.svg', '.png', '.ico', '.wav'}


def create_archive(destination: Path, root=ROOT):
    files = [root/name for name in ROOT_FILES]
    files += [root/name for name in EXTRA_ROOT_FILES if (root/name).is_file()]
    for folder in CODE_TREES:
        for file in (root/folder).rglob('*'):
            relative = file.relative_to(root)
            if any(part.startswith('.') or part in {'__pycache__', 'data', 'Captures', 'WebView', 'node_modules'} for part in relative.parts):
                continue
            if file.name.startswith('EULA-') or file.name in {'settings.json', 'capture-state.json'}:
                continue
            if file.is_file() and (file.suffix.lower() in SUFFIXES or file.name.endswith(('LICENSE', 'COPYING'))):
                files.append(file)
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(set(files)):
            if not file.resolve().is_relative_to(root.resolve()):
                raise ValueError('Source file outside project')
            archive.write(file, Path('CitizenTools-Source')/file.relative_to(root))
