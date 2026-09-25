import ctypes
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion.capture import GlobalHotkeyListener, HotkeyRecordingGate, WM_QUIT
from runtime import SoloHandler, SoloRuntime


def until(predicate):
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.01)
    raise AssertionError('Hotkey listener did not reach expected state')


class WindowsKeys:
    def __init__(self):
        self.registered = False
        self.quit = False
        self.keys = set()
        self.registrations = 0

    def RegisterHotKey(self, *args):
        self.registered = True
        self.registrations += 1
        return 1

    def UnregisterHotKey(self, *args):
        self.registered = False

    def GetCurrentThreadId(self):
        return 7

    def GetAsyncKeyState(self, key):
        return 0x8000 if key in self.keys else 0

    def PeekMessageW(self, message, *args):
        if self.quit:
            message._obj.message = WM_QUIT
            self.quit = False
            return True
        return False

    def PostThreadMessageW(self, *args):
        self.quit = True


class HotkeyTests(unittest.TestCase):
    def test_only_calling_session_is_released_and_abandoned_leases_expire(self):
        gate = HotkeyRecordingGate()
        with patch('companion.capture.time.monotonic', return_value=100):
            gate.update('first-session', True)
            gate.update('second-session', True)
            gate.update('first-session', False)
            self.assertTrue(gate.active())
        with patch('companion.capture.time.monotonic', return_value=116):
            self.assertFalse(gate.active())
        self.assertEqual(gate.leases, {})

    def test_listener_releases_registration_and_never_captures_recorded_key(self):
        windows = WindowsKeys()
        gate = HotkeyRecordingGate()
        calls = []
        listener = GlobalHotkeyListener('Ctrl+Shift+F11', lambda: calls.append(True), gate)
        with patch.object(ctypes, 'WinDLL', return_value=windows, create=True), patch('companion.capture.os.name', 'nt'):
            try:
                listener.start()
                self.assertTrue(windows.registered)
                gate.update('recording-test', True)
                self.assertTrue(gate.released.wait(1))
                self.assertFalse(windows.registered)
                windows.keys = {0x11, 0x10, 0x7A}
                listener._invoke_callback()  # Also suppress a queued WM_HOTKEY.
                time.sleep(.07)
                gate.update('recording-test', False)
                time.sleep(.07)
                self.assertFalse(windows.registered, 'Held recorded key must not immediately resume capture')
                self.assertEqual(calls, [])
                windows.keys = set()
                until(lambda: windows.registered)
                windows.keys = {0x11, 0x10, 0x7A}
                until(lambda: len(calls) == 1)
                windows.keys = set()
                gate.update('abandoned-session', True)
                self.assertTrue(gate.released.wait(1))
                with gate.lock:
                    gate.leases['abandoned-session'] = time.monotonic() - 1
                until(lambda: windows.registered)
                self.assertEqual(windows.registrations, 3)
            finally:
                listener.stop()
        self.assertFalse(windows.registered)

    def test_remote_devices_cannot_suspend_pc_hotkey(self):
        handler = SimpleNamespace(path='/api/solo/hotkey-recording', client_address=('192.168.1.20', 1234), send_json=lambda status, body: status)
        self.assertEqual(SoloHandler.do_POST(handler), 403)

    def test_saved_keys_use_canonical_windows_notation(self):
        self.assertEqual(SoloRuntime.validate_settings({'captureHotkey': 'umschalt + strg + z'})['captureHotkey'], 'Ctrl+Shift+Z')


if __name__ == '__main__':
    unittest.main()
