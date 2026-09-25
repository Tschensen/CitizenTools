"""Validated, persistent personal WAV selections, separate from bundled defaults."""
import base64
import binascii
import hashlib
import io
import json
from pathlib import Path
import re
import threading
import uuid
import wave

NAMES = ('tap', 'navigation', 'confirm', 'dialog', 'error', 'import-read', 'import-processing', 'import-success', 'import-failure')
MAX_BYTES = 2 * 1024 * 1024
MAX_REQUEST = 2_800_000


class SoundLibrary:
    def __init__(self, folder: Path, defaults: Path):
        self.folder, self.defaults = folder, defaults
        self.index = folder / 'library.json'
        self.lock = threading.RLock()

    def entries(self):
        try:
            value = json.loads(self.index.read_text(encoding='utf-8'))
            return value if isinstance(value, dict) else {}
        except (OSError, ValueError):
            return {}

    def path(self, name):
        if name not in NAMES:
            raise ValueError('sound_invalid_name')
        entry = self.entries().get(name, {})
        asset = entry.get('asset') if isinstance(entry, dict) else None
        relative = Path('custom') / asset if isinstance(asset, str) and re.fullmatch(r'[a-f0-9]{64}\.wav', asset) else Path(f'{name}.wav')
        target = (self.folder / relative).resolve()
        if not target.is_relative_to(self.folder.resolve()):
            raise ValueError('sound_invalid_path')
        return target

    def catalog(self):
        with self.lock:
            result, entries = {}, self.entries()
            for name in NAMES:
                entry = entries.get(name, {})
                entry = entry if isinstance(entry, dict) else {}
                available, revision = False, ''
                try:
                    source = self.path(name)
                    with source.open('rb') as stream:
                        data = stream.read(MAX_BYTES + 1)
                    if len(data) <= MAX_BYTES:
                        revision = hashlib.sha256(data).hexdigest()
                        available = source.parent.name == 'custom' or data != (self.defaults / f'{name}.wav').read_bytes()
                except (ValueError, OSError):
                    pass
                result[name] = {'available': available, 'filename': str(entry.get('filename') or f'{name}.wav')[:180], 'revision': revision}
            return result

    def upload(self, name, payload):
        if name not in NAMES or not isinstance(payload, dict):
            raise ValueError('sound_invalid_name')
        filename = str(payload.get('filename') or '').replace('\\', '/').split('/')[-1][:180]
        if not filename.lower().endswith('.wav'):
            raise ValueError('sound_invalid_wav')
        encoded = payload.get('data')
        if not isinstance(encoded, str) or len(encoded) > MAX_REQUEST - 1024:
            raise ValueError('sound_too_large')
        try:
            data = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError('sound_invalid_wav') from error
        if len(data) > MAX_BYTES:
            raise ValueError('sound_too_large')
        try:
            with wave.open(io.BytesIO(data)) as sound:
                frames, rate = sound.getnframes(), sound.getframerate()
                if sound.getcomptype() != 'NONE' or sound.getnchannels() not in (1, 2) or sound.getsampwidth() not in (1, 2, 3, 4) or not 8000 <= rate <= 96000 or frames <= 0:
                    raise ValueError('sound_invalid_wav')
                if frames / rate > 3:
                    raise ValueError('sound_too_long')
                if len(sound.readframes(frames + 1)) != frames * sound.getnchannels() * sound.getsampwidth():
                    raise ValueError('sound_invalid_wav')
        except (wave.Error, EOFError) as error:
            raise ValueError('sound_invalid_wav') from error
        digest = hashlib.sha256(data).hexdigest()
        with self.lock:
            custom = self.folder / 'custom'
            custom.mkdir(parents=True, exist_ok=True)
            asset = custom / f'{digest}.wav'
            # Immutable clips + one atomic manifest switch preserve the previous
            # selection if validation, disk writes or replacement fail.
            if not asset.exists():
                temporary = custom / f'{uuid.uuid4().hex}.tmp'
                try:
                    temporary.write_bytes(data)
                    temporary.replace(asset)
                finally:
                    temporary.unlink(missing_ok=True)
            entries = self.entries()
            entries[name] = {'asset': asset.name, 'filename': filename}
            temporary = self.folder / f'library-{uuid.uuid4().hex}.tmp'
            try:
                temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding='utf-8')
                temporary.replace(self.index)
            finally:
                temporary.unlink(missing_ok=True)
            return self.catalog()[name]
