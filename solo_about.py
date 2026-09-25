"""Read-only, bundled product information. Never reads the user data directory."""
from functools import lru_cache
import io
import json
from pathlib import Path
import sys
import zipfile

ROOT = Path(__file__).resolve().parent
LEGAL_ROOT = ROOT / 'legal' if getattr(sys, 'frozen', False) else ROOT / 'packaging/licenses'
SOURCE_ARCHIVE = ROOT / 'source/CitizenTools-Solo-Source.zip'


def releases():
    return json.loads((ROOT / 'release-notes.json').read_text(encoding='utf-8'))


def release_markdown(language='de'):
    lines = ['# Citizen Tools · Flight Deck — ' + ('Versionsverlauf' if language == 'de' else 'Release notes'), '']
    for release in releases():
        text = release[language]
        lines += [f"## {release['version']} — {text['title']}", '']
        lines += ['- ' + item for item in text['changes']]
        lines.append('')
    return '\n'.join(lines)


@lru_cache(maxsize=1)
def documents():
    manifest = json.loads((LEGAL_ROOT / 'catalog.json').read_text(encoding='utf-8'))
    result = []
    for item in manifest:
        item = dict(item)
        path = (LEGAL_ROOT / item['file']).resolve()
        if not path.is_relative_to(LEGAL_ROOT.resolve()):
            raise ValueError('Invalid license document path')
        item['text'] = path.read_text(encoding='utf-8-sig')
        result.append(item)
    return result


def information(version):
    return {'version': version, 'releases': releases(), 'documents': documents(), 'sourceAvailable': SOURCE_ARCHIVE.is_file(),
            'project': json.loads((ROOT/'project.json').read_text(encoding='utf-8'))}


def license_archive():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
        for item in documents():
            archive.writestr(item['file'], item['text'])
    return output.getvalue()
