"""Assemble current resources and package the same native build for each audience."""
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

from tools.build_cache import file_digest
from update_contract import FULL_ASSETS, UPDATE_ASSETS, PLATFORM, update_manifest

PROGRAM = 'CitizenTools-Solo'
WEBVIEW = 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'


def write_installation(package, version):
    manifest = {'product': 'CitizenTools', 'version': version, 'platform': PLATFORM,
                'files': sorted(path.relative_to(package).as_posix() for path in package.rglob('*')
                                if path.is_file() and path != package / 'installation.json')}
    (package / 'installation.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def assemble_program(root, package, native, helper, ocr, legal, source, version, release_notes):
    shutil.copytree(native, package)
    shutil.copy2(helper / 'CitizenTools-Updater.exe', package)
    internal = package / '_internal'
    for source_dir, destination in [(root / 'web', 'web'), (root / 'companion/assets', 'companion/assets'),
                                    (ocr, 'ocr'), (legal, 'legal')]:
        shutil.copytree(source_dir, internal / destination)
    for source_file, destination in [
        (root / 'companion/scripts/capture-screen.ps1', 'companion/scripts/capture-screen.ps1'),
        (root / 'shared/mission_import/prepare-ocr-image.ps1', 'shared/mission_import/prepare-ocr-image.ps1'),
        (root / 'release-notes.json', 'release-notes.json'), (root / 'project.json', 'project.json'),
        (source, 'source/CitizenTools-Solo-Source.zip')]:
        target = internal / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_file, target)
    shutil.copytree(legal, package / 'licenses')
    shutil.copy2(root / 'packaging/ocr-lock.json', package / 'licenses/ocr-lock.json')
    for name in ['LICENSE', 'NOTICE.md', 'CHANGELOG.md']:
        shutil.copy2(root / name, package / name)
    (package / 'RELEASE-NOTES.md').write_text(release_notes, encoding='utf-8')
    (package / 'README.md').write_text((root / 'README.md').read_text(encoding='utf-8')
                                     .replace('(packaging/licenses/)', '(licenses/)'), encoding='utf-8')
    shutil.copytree(root / 'docs', package / 'docs')
    write_installation(package, version)


def portable_archive(package, destination):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for file in sorted(package.rglob('*')):
            if file.is_file():
                archive.write(file, Path(PROGRAM) / file.relative_to(package))


def compile_installer(root, package, destination, version, *, update=False, compiler=None):
    compiler = compiler or Path(r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe')
    if any(len(str(path.resolve())) >= 260 for path in package.rglob('*') if path.is_file()):
        raise ValueError('Paketpfad für Inno Setup zu lang. Einen kürzeren --output-Pfad verwenden.')
    args = [str(compiler), f'/DAppVersion={version}', f'/DSourceDir={package}',
            f'/O{destination}']
    if update:
        args.append('/DUpdateOnly')
    args.append(str(root / 'packaging/CitizenTools-Solo.iss'))
    subprocess.run(args, check=True)


def package_variants(root, package, stage, version, *, profile, installer=False, webview=None, compiler=None):
    """Archive the lean tree first, then add prerequisites only for first installs."""
    artifacts, modes = [], []
    if profile == 'app':
        return artifacts, modes
    update_zip = stage / UPDATE_ASSETS['portable']
    portable_archive(package, update_zip)
    artifacts.append(update_zip)
    modes.append('portable')
    if installer:
        compile_installer(root, package, stage, version, update=True, compiler=compiler)
        artifacts.append(stage / UPDATE_ASSETS['installer'])
        modes.append('installer')
    if profile == 'release':
        prerequisite = package / 'prerequisites' / WEBVIEW
        prerequisite.parent.mkdir()
        shutil.copy2(webview, prerequisite)
        write_installation(package, version)
        archive = stage / FULL_ASSETS['portable']
        portable_archive(package, archive)
        artifacts.append(archive)
        if installer:
            compile_installer(root, package, stage, version, compiler=compiler)
            artifacts.append(stage / FULL_ASSETS['installer'])
    return artifacts, modes


def write_release(stage, artifacts, version, releases, modes):
    files = [{'name': path.name, 'bytes': path.stat().st_size, 'sha256': file_digest(path)} for path in artifacts]
    manifest = {'version': version, 'files': files, 'releases': releases, 'updates': update_manifest(modes)}
    (stage / 'release.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (stage / 'SHA256SUMS.txt').write_text(''.join(f"{item['sha256']}  {item['name']}\n" for item in files), encoding='utf-8')
    return files
