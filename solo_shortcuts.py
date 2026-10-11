"""Global route keys dispatch only into the owning desktop window, never LAN clients."""
import json
import logging
import threading

from companion.capture import GlobalHotkeyListener, HotkeyRecordingGate, normalize_hotkey


SHORTCUTS = {
    'routeArriveHotkey': 'arrive',
    'routeLoadHotkey': 'load',
    'routePickupHotkey': 'pickup',
    'routeUnloadHotkey': 'unload',
    'routeHomeHotkey': 'home',
}


def validate_shortcuts(settings):
    used = {settings['captureHotkey']}
    for key in SHORTCUTS:
        value = settings.get(key, '')
        if value and value in used:
            raise ValueError(f'Tastenkürzel {value} ist mehrfach vergeben. Jede Aktion braucht eine eigene Kombination.')
        if value:
            used.add(value)


def normalize_shortcuts(payload):
    result = {}
    for key in SHORTCUTS:
        if key in payload:
            value = payload[key]
            if not isinstance(value, str):
                raise ValueError('Ungültiges Tastenkürzel.')
            result[key] = normalize_hotkey(value) if value.strip() else ''
    return result


class RouteShortcuts:
    def __init__(self, runtime):
        self.runtime = runtime
        self.listeners = {}
        self.errors = {}
        self.lock = threading.RLock()
        self.dispatch_lock = threading.Lock()
        self.generation = 0

    def configure(self):
        with self.lock:
            self.stop()
            self.errors = {}
            if self.runtime.window is None or self.runtime.closing:
                return
            for key, action in SHORTCUTS.items():
                hotkey = self.runtime.settings[key]
                if not hotkey:
                    continue
                gate = HotkeyRecordingGate()
                with self.runtime.hotkey_recording_gate.lock:
                    gate.leases = dict(self.runtime.hotkey_recording_gate.leases)
                listener = GlobalHotkeyListener(hotkey, lambda action=action: self.dispatch(action), gate, strict=True)
                try:
                    listener.start()
                    self.listeners[key] = listener
                except RuntimeError as error:
                    listener.stop()
                    self.errors[key] = str(error)

    def status(self):
        with self.lock:
            return {
                'available': self.runtime.window is not None,
                'keys': {key: {
                    'active': bool(self.listeners.get(key) and self.listeners[key].registered),
                    'error': self.errors.get(key, ''),
                } for key in SHORTCUTS},
            }

    def record(self, session, enabled):
        # Each listener acknowledges its own release; one fast listener must
        # never grant permission while another still owns the recorded key.
        with self.lock:
            gates = [self.runtime.hotkey_recording_gate]
            gates.extend(listener.recording_gate for listener in self.listeners.values())
            for gate in gates:
                gate.update(session, enabled)
            if not enabled:
                return
            worker = self.runtime.worker
            waiting = gates if worker and worker.is_alive() else gates[1:]
            if not all(gate.released.wait(1) for gate in waiting):
                for gate in gates:
                    gate.update(session, False)
                raise RuntimeError('Tastenkürzel noch belegt. Bitte erneut versuchen.')

    def dispatch(self, action):
        if action not in SHORTCUTS.values() or self.runtime.closing or self.runtime.hotkey_recording_gate.active():
            return
        window = self.runtime.window
        if window is None or not self.dispatch_lock.acquire(blocking=False):
            return
        generation = self.generation

        def invoke():
            try:
                if generation == self.generation and not self.runtime.closing:
                    window.evaluate_js(f'void window.soloRouteShortcuts?.run({json.dumps(action)})')
            except Exception:
                logging.exception('Could not dispatch route shortcut')
            finally:
                self.dispatch_lock.release()

        threading.Thread(target=invoke, name='SoloRouteShortcut', daemon=True).start()

    def stop(self):
        with self.lock:
            self.generation += 1
            for listener in self.listeners.values():
                listener.stop()
            self.listeners = {}
