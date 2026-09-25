"""Build independent portable and installer artifacts. Never packages user data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from runtime import VERSION
from tools.prepare_licenses import prepare as prepare_licenses
from tools.source_archive import create_archive
from tools.prepare_ocr import validate_runtime, validate_sources, SOURCE_NAME
import solo_about


def publish_release(stage: Path, output: Path, names: list[str]):
    """Keep the installed path stable; retain the old files for rollback."""
    output.mkdir(parents=True, exist_ok=True)
    previous = stage / 'previous'
    if previous.exists() and any(previous.iterdir()):
        raise RuntimeError('Dieser Build enthält bereits eine vorherige Ausgabe. Bitte einen neuen Build verwenden.')
    previous.mkdir(exist_ok=True)
    backed_up, installed = [], []
    try:
        # Rename on the same volume before installing anything. If Windows
        # locks the running program, its current files remain together.
        for name in names:
            destination = output / name
            if destination.exists():
                destination.rename(previous / name)
                backed_up.append(name)
        for name in names:
            (stage / name).rename(output / name)
            installed.append(name)
    except OSError as error:
        for name in reversed(installed):
            (output / name).rename(stage / name)
        for name in reversed(backed_up):
            (previous / name).rename(output / name)
        raise RuntimeError('Ausgabe konnte nicht aktualisiert werden. Citizen Tools und geöffnete Paketdateien schließen und den Build erneut starten. Die bisherige Ausgabe wurde wiederhergestellt.') from error


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT/'dist')
    parser.add_argument('--tesseract-dir', type=Path, required=True)
    parser.add_argument('--ocr-sources', type=Path, required=True)
    parser.add_argument('--webview-installer', type=Path)
    parser.add_argument('--installer', action='store_true')
    args = parser.parse_args()
    output = args.output.resolve()
    ocr = args.tesseract_dir.resolve()
    if args.installer and not args.webview_installer:
        raise SystemExit('Für den vollständigen Offline-Installer wird --webview-installer benötigt.')
    if args.webview_installer and args.webview_installer.stat().st_size < 50_000_000:
        raise SystemExit('WebView2-Datei ist zu klein. Den vollständigen Standalone-Installer verwenden, nicht den Online-Bootstrapper.')
    for required in ['tesseract.exe', 'tessdata/eng.traineddata', 'tessdata/deu.traineddata']:
        if not (ocr/required).is_file(): raise SystemExit(f'OCR-Datei fehlt: {ocr/required}')
    validate_runtime(ocr)
    validate_sources(args.ocr_sources)
    output.mkdir(parents=True, exist_ok=True)
    staging_root = output.parent / '.build'
    staging_root.mkdir(parents=True, exist_ok=True)
    # mkdtemp uses mode 0700, which gives Windows a private ACL. Published
    # files must inherit the workspace permissions, including the PC user.
    stage = staging_root / f'solo-release-{uuid.uuid4().hex}'
    stage.mkdir()
    package = stage/'CitizenTools-Solo'
    if solo_about.releases()[0]['version'] != VERSION:
        raise RuntimeError('Versionsverlauf muss mit der aktuellen Version beginnen.')
    legal = stage/'legal'
    prepare_licenses(legal)
    source_archive = stage/'CitizenTools-Solo-Source.zip'
    create_archive(source_archive)
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--onedir', '--windowed', '--name', 'CitizenTools-Solo', '--distpath', str(stage), '--workpath', str(stage/'build'), '--specpath', str(stage/'spec'), '--icon', str(ROOT/'companion/assets/citizen-tools.ico'), '--collect-all', 'webview', '--hidden-import', 'webview.platforms.edgechromium', '--hidden-import', 'webview.platforms.winforms']
    for source, destination in [(ROOT/'web','web'), (ROOT/'companion/assets','companion/assets'), (ROOT/'companion/scripts','companion/scripts'), (ocr,'ocr'), (legal,'legal'), (ROOT/'release-notes.json','.'), (ROOT/'project.json','.'), (source_archive,'source')]:
        command += ['--add-data', f'{source}{os.pathsep}{destination}']
    command.append(str(ROOT/'app.py'))
    subprocess.run(command, cwd=ROOT, check=True)
    shutil.copytree(legal, package/'licenses')
    shutil.copy2(ROOT/'LICENSE', package/'LICENSE')
    shutil.copy2(ROOT/'NOTICE.md', package/'NOTICE.md')
    (package/'RELEASE-NOTES.md').write_text(solo_about.release_markdown(), encoding='utf-8')
    (package/'README.md').write_text((ROOT/'README.md').read_text(encoding='utf-8').replace('(packaging/licenses/)', '(licenses/)'), encoding='utf-8')
    shutil.copy2(ROOT/'CHANGELOG.md', package/'CHANGELOG.md')
    shutil.copytree(ROOT/'docs', package/'docs')
    shutil.copy2(ROOT/'packaging/ocr-lock.json', package/'licenses/ocr-lock.json')
    if args.webview_installer:
        prereq = package/'prerequisites'
        prereq.mkdir()
        shutil.copy2(args.webview_installer, prereq/'MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
    archive = stage/'CitizenTools-Solo-Portable.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as target:
        for file in package.rglob('*'):
            if file.is_file(): target.write(file, Path(package.name)/file.relative_to(package))
    ocr_sources = stage/SOURCE_NAME
    shutil.copy2(args.ocr_sources, ocr_sources)
    artifacts = [archive, source_archive, ocr_sources]
    if args.installer:
        compiler = Path(r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe')
        subprocess.run([str(compiler), f'/DAppVersion={VERSION}', f'/DSourceDir={package}', f'/O{stage}', str(ROOT/'packaging/CitizenTools-Solo.iss')], check=True)
        artifacts.append(stage/'CitizenTools-Solo-Setup.exe')
    files = []
    for file in artifacts:
        with file.open('rb') as stream:
            checksum = hashlib.file_digest(stream, 'sha256').hexdigest()
        files.append({'name': file.name, 'bytes': file.stat().st_size, 'sha256': checksum})
    (stage/'release.json').write_text(json.dumps({'version':VERSION, 'files':files}, indent=2)+'\n', encoding='utf-8')
    (stage/'SHA256SUMS.txt').write_text(''.join(f"{item['sha256']}  {item['name']}\n" for item in files), encoding='utf-8')
    (stage/'RELEASE-NOTES.md').write_text(solo_about.release_markdown(), encoding='utf-8')
    publish_release(stage, output, ['CitizenTools-Solo', *[file.name for file in artifacts], 'release.json', 'SHA256SUMS.txt', 'RELEASE-NOTES.md'])
    print(f'Fertig: {output / "CitizenTools-Solo"}')
    print(f'Build und vorherige Ausgabe: {stage}')


if __name__ == '__main__': main()
