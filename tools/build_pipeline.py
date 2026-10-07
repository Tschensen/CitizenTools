"""Validate inputs, compile/cache, assemble packages and publish a Windows build."""
import argparse
import json
from pathlib import Path
import platform
import shutil
import struct
import sys
import time
import uuid

from runtime import VERSION
from tools.build_cache import compile_native, environment_signature
from tools.build_packages import assemble_program, package_variants, write_release, PROGRAM
from tools.build_publish import publish_release
from tools.prepare_licenses import prepare as prepare_licenses
from tools.source_archive import create_archive
from tools.prepare_ocr import validate_runtime, validate_sources, SOURCE_NAME
from update_contract import FULL_ASSETS, UPDATE_ASSETS
import solo_about

ROOT = Path(__file__).resolve().parents[1]


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--tesseract-dir', type=Path, required=True)
    parser.add_argument('--ocr-sources', type=Path, required=True)
    parser.add_argument('--webview-installer', type=Path)
    parser.add_argument('--installer', action='store_true', help='Auch Inno-Setup-Pakete erstellen')
    parser.add_argument('--profile', choices=['app', 'updates', 'release'], default='release',
                        help='app: Testprogramm; updates: kleine Pakete; release: Erstinstallation und Updates')
    parser.add_argument('--cache-dir', type=Path, default=ROOT / '.build/windows-cache')
    parser.add_argument('--force-rebuild', action='store_true', help='Native EXEs trotz Cache neu erstellen')
    parser.add_argument('--source-artifact', action='store_true', help='Projektquellcode zusätzlich als Release-Anhang ausgeben')
    args = parser.parse_args(argv)
    if args.profile == 'release' and not args.webview_installer:
        parser.error('Für Erstinstallationen wird --webview-installer benötigt; sonst --profile app/updates verwenden.')
    if args.profile != 'release' and args.webview_installer:
        parser.error('--webview-installer gehört ausschließlich zum Profil release.')
    if args.profile == 'app' and (args.installer or args.source_artifact):
        parser.error('Profil app erzeugt nur den Programmordner, keine Release-Anhänge.')
    if args.webview_installer and args.webview_installer.stat().st_size < 50_000_000:
        parser.error('WebView2-Datei ist zu klein. Den vollständigen x64-Offline-Installer verwenden.')
    return args


def build(args):
    started = time.monotonic()
    if sys.platform != 'win32' or struct.calcsize('P') != 8 or platform.machine().lower() not in {'amd64', 'x86_64'}:
        raise RuntimeError('Windows-Pakete benötigen 64-Bit-Python unter Windows.')
    ocr, output = args.tesseract_dir.resolve(), args.output.resolve()
    validate_runtime(ocr)
    validate_sources(args.ocr_sources)
    compiler = Path(r'C:\Program Files (x86)\Inno Setup 6\ISCC.exe')
    if args.installer and not compiler.is_file():
        raise RuntimeError(f'Inno Setup fehlt: {compiler}')
    releases = solo_about.releases()
    if releases[0]['version'] != VERSION:
        raise RuntimeError('Versionsverlauf muss mit der aktuellen Version beginnen.')
    # Normal mkdir inherits Windows workspace ACLs, unlike private mkdtemp ACLs.
    # Inno Setup still encounters MAX_PATH on long license filenames.
    stage = output.parent / '.build' / f'release-{uuid.uuid4().hex[:12]}'
    stage.mkdir(parents=True)
    legal = stage / 'legal'
    prepare_licenses(legal)
    source = stage / 'CitizenTools-Solo-Source.zip'
    create_archive(source)
    environment = environment_signature()
    native, app_report = compile_native(ROOT, args.cache_dir.resolve(), 'app', environment, force=args.force_rebuild)
    helper, helper_report = compile_native(ROOT, args.cache_dir.resolve(), 'helper', environment, force=args.force_rebuild)
    package = stage / PROGRAM
    notes = solo_about.release_markdown()
    assemble_program(ROOT, package, native, helper, ocr, legal, source, VERSION, notes)
    artifacts, modes = package_variants(ROOT, package, stage, VERSION, profile=args.profile,
                                        installer=args.installer, webview=args.webview_installer, compiler=compiler)
    names = [PROGRAM]
    if args.profile != 'app':
        ocr_sources = stage / SOURCE_NAME
        shutil.copy2(args.ocr_sources, ocr_sources)
        artifacts.append(ocr_sources)
        if args.source_artifact:
            artifacts.append(source)
        write_release(stage, artifacts, VERSION, releases, modes)
        (stage / 'RELEASE-NOTES.md').write_text(notes, encoding='utf-8')
        names += [file.name for file in artifacts] + ['release.json', 'SHA256SUMS.txt', 'RELEASE-NOTES.md']
    report = {'version': VERSION, 'profile': args.profile, 'native': {'app': app_report, 'helper': helper_report},
              'seconds': round(time.monotonic() - started, 2), 'artifacts': [file.name for file in artifacts]}
    (stage / 'build-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    # Retain stale files from earlier profiles in previous/ through the same
    # rollback transaction, so they cannot be mistaken for current artifacts.
    managed = {*FULL_ASSETS.values(), *UPDATE_ASSETS.values(), SOURCE_NAME, source.name,
               'release.json', 'SHA256SUMS.txt', 'RELEASE-NOTES.md'}
    publish_release(stage, output, names, obsolete=sorted(managed - set(names)))
    print(f'Fertig: {output / PROGRAM}')
    print(f'Buildbericht und vorherige Ausgabe: {stage}')
    return report
