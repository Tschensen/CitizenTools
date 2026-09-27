"""Separate Windows updater: wait for exit, back up, replace, then restart."""
from __future__ import annotations

import argparse
import ctypes
from ctypes import wintypes
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import subprocess
import time
import zipfile

PRODUCT = 'CitizenTools'
EXE = 'CitizenTools-Solo.exe'
MANIFEST = 'installation.json'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_relative(name):
    if not isinstance(name, str) or any(char in name for char in '\\:\x00') or any(part in {'', '.', '..'} for part in name.split('/')):
        raise ValueError('Unsafe package path')
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in {'.', '..'} or part.endswith(('.', ' ')) or re.fullmatch(r'(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?', part) for part in path.parts):
        raise ValueError('Unsafe package path')
    return path


def validate_program(program, version):
    program = Path(program)
    if program.resolve() != program.absolute() or len(program.resolve().parts) < 3 or program.is_symlink() or program.is_junction():
        raise ValueError('Invalid program directory')
    data = json.loads((program / MANIFEST).read_text(encoding='utf-8'))
    if data.get('product') != PRODUCT or data.get('version') != version or not (program / EXE).is_file():
        raise ValueError('Program version does not match update')
    files = data.get('files')
    if not isinstance(files, list) or EXE not in files or len(files) > 50000:
        raise ValueError('Invalid installation manifest')
    for name in files:
        safe_relative(name)
    return set(files) | {MANIFEST}


def extract_portable(archive_path, destination, version):
    destination = Path(destination)
    destination.mkdir()
    seen, total = set(), 0
    with zipfile.ZipFile(archive_path) as archive:
        if len(archive.infolist()) > 50000:
            raise ValueError('Package has too many entries')
        if shutil.disk_usage(destination).free < sum(item.file_size for item in archive.infolist()) + 64 * 1024 ** 2:
            raise OSError('Not enough disk space to unpack the update')
        for item in archive.infolist():
            path = safe_relative(item.filename.rstrip('/'))
            if path.parts[0] != 'CitizenTools-Solo' or len(path.parts) < 2:
                raise ValueError('Unexpected package root')
            relative = PurePosixPath(*path.parts[1:])
            key = str(relative).casefold()
            if key in seen or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1:
                raise ValueError('Ambiguous or linked package entry')
            seen.add(key)
            total += item.file_size
            if total > 4 * 1024 ** 3:
                raise ValueError('Expanded package is too large')
            output = destination.joinpath(*relative.parts)
            if item.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, output.open('xb') as target:
                    shutil.copyfileobj(source, target)
    expected = validate_program(destination, version)
    actual = {str(path.relative_to(destination).as_posix()) for path in destination.rglob('*') if path.is_file()}
    if actual != expected:
        raise ValueError('Package content does not match installation manifest')


def reject_links(root):
    for path in Path(root).rglob('*'):
        if path.is_symlink() or path.is_junction():
            raise ValueError('Program directory contains links; update manually')


def preserve_extra_files(old, new, managed):
    reject_links(old)
    for path in old.rglob('*'):
        if path.is_file():
            relative = path.relative_to(old)
            if relative.as_posix() not in managed and not (new / relative).exists():
                (new / relative).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, new / relative)


def make_data_backup(data_root, destination):
    destination.mkdir()
    database = data_root / 'data/cargo_planner.sqlite3'
    if database.is_file():
        with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as source, closing(sqlite3.connect(destination / 'cargo_planner.sqlite3')) as target:
            source.backup(target)
    for name in ['settings.json', 'capture-state.json']:
        if (data_root / name).is_file():
            shutil.copy2(data_root / name, destination / name)


def wait_for_parent(pid, cancel_path=None):
    if os.name != 'nt' or type(pid) is not int or pid <= 0 or pid == os.getpid():
        raise ValueError('Invalid Windows parent process')
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    process = kernel.OpenProcess(0x00100000, False, pid)
    if not process:
        if ctypes.get_last_error() == 87:
            return  # The parent exited before this process acquired its handle.
        raise OSError('Could not wait for the running application')
    try:
        deadline = time.monotonic() + 120
        while True:
            if cancel_path and cancel_path.exists():
                raise RuntimeError('Update handoff was cancelled; no files were changed')
            result = kernel.WaitForSingleObject(process, 500)
            if result == 0: return
            if result != 258 or time.monotonic() >= deadline:
                raise TimeoutError('Citizen Tools is still running; no files were changed')
    finally:
        kernel.CloseHandle(process)


def validate_job(path):
    path = Path(path).resolve()
    job = json.loads(path.read_text(encoding='utf-8'))
    if job.get('format') != 1 or not re.fullmatch(r'[a-f0-9]{32}', path.parent.name):
        raise ValueError('Invalid update job')
    data_root, program, package = (Path(job[name]).resolve() for name in ['dataRoot', 'program', 'package'])
    if path.parent.parent != data_root / 'Updates' or package.parent != path.parent or package.name not in {'CitizenTools-Solo-Portable.zip', 'CitizenTools-Solo-Setup.exe'}:
        raise ValueError('Update paths do not belong to this job')
    if data_root.is_relative_to(program) or program.is_relative_to(data_root) or job['kind'] not in {'portable', 'installer'}:
        raise ValueError('Program and data folders must be separate')
    for name in ['version', 'currentVersion']:
        if not re.fullmatch(r'\d+\.\d+\.\d+', job[name]):
            raise ValueError('Invalid version')
    if tuple(map(int, job['version'].split('.'))) <= tuple(map(int, job['currentVersion'].split('.'))):
        raise ValueError('Downgrades are not automatic updates')
    validate_program(program, job['currentVersion'])
    if digest(program / EXE) != job['oldExeSha256'] or digest(package) != job['sha256']:
        raise ValueError('Update checksum does not match')
    expected_name = 'CitizenTools-Solo-Portable.zip' if job['kind'] == 'portable' else 'CitizenTools-Solo-Setup.exe'
    if package.name != expected_name:
        raise ValueError('Wrong package type')
    args = job.get('restartArgs')
    if not isinstance(args, list) or not all(isinstance(item, str) and '\x00' not in item for item in args):
        raise ValueError('Invalid restart arguments')
    parser = argparse.ArgumentParser(exit_on_error=False)
    parser.add_argument('--data-dir', required=True, type=Path)
    parser.add_argument('--port', type=int)
    parser.add_argument('--localhost', action='store_true')
    parser.add_argument('--no-capture', action='store_true')
    parsed, remaining = parser.parse_known_args(args)
    if remaining or parsed.data_dir.resolve() != data_root or (parsed.port is not None and not 0 <= parsed.port <= 65535):
        raise ValueError('Invalid restart arguments')
    return job, data_root, program, package


def apply_update(job, program, package, folder, *, run_installer=subprocess.run):
    """No running app here. All renames stay beside the validated program."""
    managed = validate_program(program, job['currentVersion'])
    identifier = folder.name
    stage = program.parent / f'.{program.name}.update-{identifier}'
    backup = program.parent / f'.{program.name}.previous-{identifier}'
    if stage.exists() or backup.exists():
        raise ValueError('Update staging folder already exists')
    if not stage.resolve().parent == backup.resolve().parent == program.resolve().parent:
        raise ValueError('Invalid staging path')
    stage.mkdir()
    moved = False
    try:
        if job['kind'] == 'portable':
            fresh = stage / 'new'
            extract_portable(package, fresh, job['version'])
            preserve_extra_files(program, fresh, managed)
            program.rename(backup)
            moved = True
            fresh.rename(program)
        else:
            reject_links(program)
            needed = sum(file.stat().st_size for file in program.rglob('*') if file.is_file()) + package.stat().st_size * 2
            if shutil.disk_usage(program.parent).free < needed:
                raise OSError('Not enough disk space to back up and install the update')
            shutil.copytree(program, backup)
            moved = True
            completed = run_installer([str(package), '/VERYSILENT', '/SUPPRESSMSGBOXES', '/SP-', '/NORESTART',
                                      '/NOCLOSEAPPLICATIONS', '/NORESTARTAPPLICATIONS', '/NOFORCECLOSEAPPLICATIONS',
                                      f'/DIR={program}', f'/LOG={folder / "installer.log"}'],
                                     creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), check=False)
            if completed.returncode != 0:
                raise RuntimeError('Installer failed; previous program files restored')
        validate_program(program, job['version'])
        (backup / 'update-backup.json').write_text(json.dumps({'program': str(program), 'version': job['currentVersion']}), encoding='utf-8')
        return backup
    except Exception:
        if moved:
            if program.exists():
                program.rename(stage / 'failed')
            backup.rename(program)
        raise


def clean_previous_backup(data_root, program, keep):
    """Only remove a prior updater-owned backup after the new update succeeded."""
    try:
        result = json.loads((data_root / 'Updates/last-result.json').read_text(encoding='utf-8'))
        old = Path(result['backup']).resolve()
        if old == keep or old.parent != program.parent or not re.fullmatch(re.escape('.' + program.name + '.previous-') + r'[a-f0-9]{32}', old.name):
            return
        owner = json.loads((old / 'update-backup.json').read_text(encoding='utf-8'))
        if owner.get('program') != str(program) or old.is_symlink() or old.is_junction():
            return
        validate_program(old, owner['version'])
        reject_links(old)
        shutil.rmtree(old)
    except (OSError, ValueError, KeyError):
        pass


def run_job(path):
    folder = Path(path).resolve().parent
    result = {'ok': False}
    job = None
    parent_exited = False
    try:
        job, data_root, program, package = validate_job(path)
        (folder / 'helper-ready').write_text('ready', encoding='ascii')
        wait_for_parent(job['parentPid'], folder / 'cancel-update')
        parent_exited = True
        if (folder / 'cancel-update').exists():
            raise RuntimeError('Update handoff was cancelled; no files were changed')
        # Revalidate after the application and screenshot worker have exited.
        validate_job(path)
        make_data_backup(data_root, folder / 'data-backup')
        backup = apply_update(job, program, package, folder)
        clean_previous_backup(data_root, program, backup)
        result = {'ok': True, 'version': job['version'], 'backup': str(backup)}
        (data_root / 'Updates/last-result.json').write_text(json.dumps(result), encoding='utf-8')
        subprocess.Popen([str(program / EXE), *job['restartArgs']], cwd=str(program))
    except Exception as exc:
        result['ok'] = False
        result['error'] = str(exc)
        if job and parent_exited:
            # The file transaction rolls back before returning an error.
            try:
                validate_program(program, job['currentVersion'])
                subprocess.Popen([str(program / EXE), *job['restartArgs']], cwd=str(program))
            except Exception:
                pass
        if os.name == 'nt':
            ctypes.windll.user32.MessageBoxW(None, 'Update konnte nicht abgeschlossen werden / Update could not be completed.\n\n' + str(exc) + '\n\n' + str(folder), 'Citizen Tools Update', 0x10)
    finally:
        if job:
            (folder / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return 0 if result['ok'] else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--job', type=Path, required=True)
    raise SystemExit(run_job(parser.parse_args().job))
