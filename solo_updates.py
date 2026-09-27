"""Public GitHub release checks and verified downloads. Installation is native-only."""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time
from urllib import error, parse, request
import uuid

REPOSITORY = 'Tschensen/CitizenTools'
RELEASES_URL = f'https://github.com/{REPOSITORY}/releases'
LATEST_URL = f'https://api.github.com/repos/{REPOSITORY}/releases/latest'
ASSETS = {'portable': 'CitizenTools-Solo-Portable.zip', 'installer': 'CitizenTools-Solo-Setup.exe'}
MAX_PACKAGE = 2 * 1024 ** 3
CHECK_INTERVAL = 6 * 60 * 60


class UpdateError(Exception):
    pass


def version_tuple(value):
    match = re.fullmatch(r'v?(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})\.(0|[1-9]\d{0,7})', str(value))
    if not match:
        raise UpdateError('update_invalid_release')
    return tuple(map(int, match.groups()))


def canonical_version(value):
    return '.'.join(map(str, version_tuple(value)))


class GitHubRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        url = parse.urlparse(newurl)
        if url.scheme != 'https' or url.hostname not in {'github.com', 'api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'} or url.username or url.password:
            raise UpdateError('update_invalid_release')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class GitHubClient:
    def __init__(self):
        self.opener = request.build_opener(GitHubRedirect())

    def open(self, url):
        req = request.Request(url, headers={'User-Agent': 'CitizenTools-Updater', 'Accept': 'application/vnd.github+json'})
        return self.opener.open(req, timeout=20)

    def json(self, url, limit=1024 * 1024, digest=None):
        with self.open(url) as response:
            body = response.read(limit + 1)
        if len(body) > limit or (digest and hashlib.sha256(body).hexdigest() != digest):
            raise UpdateError('update_invalid_release')
        try:
            return json.loads(body)
        except (ValueError, UnicodeError) as exc:
            raise UpdateError('update_invalid_release') from exc

    def download(self, asset, destination, progress, cancelled):
        partial = destination.with_suffix(destination.suffix + '.part')
        received, digest = 0, hashlib.sha256()
        try:
            with self.open(asset['url']) as response, partial.open('xb') as output:
                while True:
                    if cancelled.is_set():
                        raise UpdateError('update_cancelled')
                    block = response.read(256 * 1024)
                    if not block:
                        break
                    received += len(block)
                    if received > asset['bytes']:
                        raise UpdateError('update_checksum')
                    output.write(block)
                    digest.update(block)
                    progress(received, asset['bytes'])
            if received != asset['bytes'] or digest.hexdigest() != asset['sha256']:
                raise UpdateError('update_checksum')
            if cancelled.is_set():
                raise UpdateError('update_cancelled')
            partial.replace(destination)
        finally:
            partial.unlink(missing_ok=True)


def release_asset(release, name):
    matches = [item for item in release.get('assets', []) if item.get('name') == name]
    if len(matches) != 1:
        raise UpdateError('update_incomplete_release')
    item = matches[0]
    expected = f'https://github.com/{REPOSITORY}/releases/download/{parse.quote(release["tag_name"], safe="")}/{name}'
    if item.get('browser_download_url') != expected or item.get('state', 'uploaded') != 'uploaded':
        raise UpdateError('update_invalid_release')
    digest = item.get('digest')
    if digest is not None and not re.fullmatch(r'sha256:[a-f0-9]{64}', str(digest)):
        raise UpdateError('update_invalid_release')
    return {'url': expected, 'size': item.get('size'), 'digest': digest[7:] if digest else None}


def read_candidate(client, current, mode):
    release = client.json(LATEST_URL)
    if not isinstance(release, dict) or release.get('draft') or release.get('prerelease'):
        raise UpdateError('update_invalid_release')
    latest = canonical_version(release.get('tag_name'))
    if version_tuple(latest) <= version_tuple(current):
        return None, latest
    manifest_asset = release_asset(release, 'release.json')
    manifest = client.json(manifest_asset['url'], digest=manifest_asset['digest'])
    if not isinstance(manifest, dict) or manifest.get('version') != latest or not isinstance(manifest.get('files'), list):
        raise UpdateError('update_invalid_release')
    name = ASSETS[mode if mode in ASSETS else 'portable']
    source = release_asset(release, name)
    files = [item for item in manifest['files'] if isinstance(item, dict) and item.get('name') == name]
    if len(files) != 1:
        raise UpdateError('update_incomplete_release')
    file = files[0]
    if type(file.get('bytes')) is not int or not 0 < file['bytes'] <= MAX_PACKAGE or not re.fullmatch(r'[a-f0-9]{64}', str(file.get('sha256'))):
        raise UpdateError('update_invalid_release')
    if source['size'] != file['bytes'] or (source['digest'] and source['digest'] != file['sha256']):
        raise UpdateError('update_checksum')
    notes = []
    for item in manifest.get('releases', []):
        if not isinstance(item, dict):
            continue
        if version_tuple(current) < version_tuple(item.get('version')) <= version_tuple(latest):
            clean = {'version': canonical_version(item['version'])}
            for language in ['de', 'en']:
                text = item.get(language, {})
                clean[language] = {'title': str(text.get('title', ''))[:300],
                                   'changes': [str(line)[:4000] for line in text.get('changes', [])[:100]]}
            notes.append(clean)
    notes.sort(key=lambda item: version_tuple(item['version']), reverse=True)
    return {'version': latest, 'name': str(release.get('name') or latest)[:300], 'notes': notes,
            'body': str(release.get('body') or '')[:60000],
            'url': RELEASES_URL + '/tag/' + parse.quote(release['tag_name'], safe=''),
            'asset': {'name': name, 'url': source['url'], 'bytes': file['bytes'], 'sha256': file['sha256']}}, latest


def installation_mode(program):
    if program is None:
        return 'development'
    if os.name == 'nt':
        import winreg
        for hive in [winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE]:
            try:
                with winreg.OpenKey(hive, r'Software\Microsoft\Windows\CurrentVersion\Uninstall\{096EB0A4-E06C-4D53-BA74-BFC2D465FEC0}_is1') as key:
                    location = Path(winreg.QueryValueEx(key, 'InstallLocation')[0]).resolve()
                if location == program.resolve() and (program / 'unins000.exe').is_file():
                    return 'installer'
            except OSError:
                pass
    return 'portable'


class UpdateManager:
    def __init__(self, version, data_root, *, program=None, client=None, mode=None):
        self.version, self.data_root = version, Path(data_root).resolve()
        self.program = Path(program).resolve() if program else None
        self.mode = mode or installation_mode(self.program)
        self.root = self.data_root / 'Updates'
        self.client = client or GitHubClient()
        self.lock = threading.RLock()
        self.stop_event, self.cancel_event = threading.Event(), threading.Event()
        self.worker = None
        self.state, self.error, self.candidate, self.latest = 'idle', '', None, None
        self.checked_at, self.progress, self.package, self.job = None, None, None, None
        self.automatic = True
        try:
            settings = json.loads((self.root / 'preferences.json').read_text(encoding='utf-8'))
            if isinstance(settings, dict):
                self.automatic = settings.get('automatic', True) is not False
        except (OSError, ValueError):
            pass
        try: self._clean_completed_downloads()
        except OSError: logging.info('Previous update downloads could not be cleaned up')

    def _clean_completed_downloads(self):
        # Keep backup data and logs; only discard our verified completed jobs'
        # expendable download and helper copy. A running helper remains locked.
        if not self.root.is_dir() or self.root.is_symlink() or self.root.is_junction(): return
        for folder in self.root.iterdir():
            if not re.fullmatch(r'[a-f0-9]{32}', folder.name) or not folder.is_dir() or folder.is_symlink() or folder.is_junction():
                continue
            try:
                result = json.loads((folder / 'result.json').read_text(encoding='utf-8'))
                job = json.loads((folder / 'job.json').read_text(encoding='utf-8'))
                if result.get('ok') is not True or Path(job['dataRoot']).resolve() != self.data_root:
                    continue
                for name in [*ASSETS.values(), 'CitizenTools-Updater.exe']:
                    try: (folder / name).unlink(missing_ok=True)
                    except OSError: pass
            except (OSError, ValueError, KeyError, TypeError):
                pass

    def status(self):
        with self.lock:
            candidate = copy.deepcopy(self.candidate)
            if candidate:
                candidate['bytes'] = candidate.pop('asset')['bytes']
            return {'currentVersion': self.version, 'latestVersion': self.latest, 'state': self.state,
                    'error': self.error, 'candidate': candidate, 'mode': self.mode,
                    'automatic': self.automatic, 'checkedAt': self.checked_at, 'progress': self.progress,
                    'canInstall': self.program is not None and (self.program / 'CitizenTools-Updater.exe').is_file()}

    def set_automatic(self, enabled):
        if type(enabled) is not bool:
            raise UpdateError('update_invalid_request')
        with self.lock:
            self.root.mkdir(parents=True, exist_ok=True)
            temporary = self.root / 'preferences.tmp'
            temporary.write_text(json.dumps({'automatic': enabled}), encoding='utf-8')
            temporary.replace(self.root / 'preferences.json')
            self.automatic = enabled
        return self.status()

    def _start(self, state, task):
        with self.lock:
            if self.worker and self.worker.is_alive() or self.state == 'installing':
                raise UpdateError('update_busy')
            self.state, self.error = state, ''
            self.worker = threading.Thread(target=task, name='SoloUpdate', daemon=True)
            self.worker.start()

    def check(self):
        def work():
            try:
                candidate, latest = read_candidate(self.client, self.version, self.mode)
                with self.lock:
                    self.candidate, self.latest = candidate, latest
                    self.package = None
                    self.checked_at = time.time()
                    self.state = 'available' if candidate else 'current'
            except Exception as exc:
                self._failed(exc)
        self._start('checking', work)
        return self.status()

    def _failed(self, exc):
        logging.info('Update operation failed: %s', exc)
        with self.lock:
            if isinstance(exc, UpdateError):
                code = str(exc)
            elif isinstance(exc, error.HTTPError) and exc.code == 404:
                code = 'update_no_release'
            elif isinstance(exc, error.HTTPError) and exc.code in {403, 429}:
                code = 'update_rate_limit'
            else:
                code = 'update_network' if isinstance(exc, (error.URLError, TimeoutError)) else 'update_failed'
            self.error = code
            self.state = 'available' if code == 'update_cancelled' and self.candidate else 'error'
            if isinstance(exc, error.HTTPError):
                exc.close()

    def download(self, version):
        with self.lock:
            if (self.worker and self.worker.is_alive()) or self.state == 'installing':
                raise UpdateError('update_busy')
            if not self.candidate or version != self.candidate['version'] or self.mode == 'development':
                raise UpdateError('update_unavailable')
            candidate = copy.deepcopy(self.candidate)
            self.cancel_event.clear()
        def progress(received, total):
            with self.lock:
                self.progress = {'received': received, 'total': total}
        def work():
            try:
                folder = self.root / uuid.uuid4().hex
                folder.mkdir(parents=True)
                package = folder / candidate['asset']['name']
                if shutil.disk_usage(folder).free < candidate['asset']['bytes'] * 3:
                    raise UpdateError('update_disk_space')
                self.client.download(candidate['asset'], package, progress, self.cancel_event)
                with self.lock:
                    self.package, self.state = package, 'ready'
            except Exception as exc:
                self._failed(exc)
        self.progress = {'received': 0, 'total': candidate['asset']['bytes']}
        self._start('downloading', work)
        return self.status()

    def cancel(self):
        self.cancel_event.set()
        return self.status()

    def start_automatic(self):
        def work():
            last_attempt = -CHECK_INTERVAL
            while not self.stop_event.is_set():
                if self.automatic and time.monotonic() - last_attempt >= CHECK_INTERVAL:
                    try:
                        if self.state not in {'downloading', 'ready', 'installing'}:
                            self.check()
                            last_attempt = time.monotonic()
                    except UpdateError:
                        pass
                if self.stop_event.wait(60):
                    break
        threading.Thread(target=work, name='SoloUpdateChecks', daemon=True).start()

    def launch_installer(self, version, restart_args):
        from update_helper import digest, validate_program
        with self.lock:
            if self.state != 'ready' or not self.package or not self.candidate or version != self.candidate['version'] or not self.program:
                raise UpdateError('update_unavailable')
            validate_program(self.program, self.version)
            if self.data_root.is_relative_to(self.program) or self.program.is_relative_to(self.data_root):
                raise UpdateError('update_data_in_program')
            if digest(self.package) != self.candidate['asset']['sha256']:
                raise UpdateError('update_checksum')
            folder = self.package.parent
            helper = folder / 'CitizenTools-Updater.exe'
            (folder / 'helper-ready').unlink(missing_ok=True)
            (folder / 'cancel-update').unlink(missing_ok=True)
            shutil.copy2(self.program / helper.name, helper)
            job = {'format': 1, 'parentPid': os.getpid(), 'program': str(self.program), 'dataRoot': str(self.data_root),
                   'package': str(self.package), 'sha256': self.candidate['asset']['sha256'], 'kind': self.mode,
                   'currentVersion': self.version, 'version': version,
                   'oldExeSha256': digest(self.program / 'CitizenTools-Solo.exe'), 'restartArgs': restart_args}
            job_path = folder / 'job.json'
            job_path.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
            process = subprocess.Popen([str(helper), '--job', str(job_path)], cwd=str(folder), creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            deadline = time.monotonic() + 15
            while not (folder / 'helper-ready').exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    (folder / 'cancel-update').write_text('cancel', encoding='ascii')
                    # This is our own helper, still waiting for us to exit.
                    # Never leave it armed after a failed handoff.
                    if process.poll() is None:
                        process.terminate()
                        process.wait(timeout=5)
                    raise UpdateError('update_helper_failed')
                time.sleep(.1)
            self.state, self.job = 'installing', job_path
            return self.status()

    def stop(self):
        self.stop_event.set()
        self.cancel_event.set()
