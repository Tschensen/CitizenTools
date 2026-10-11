import ctypes
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from companion.capture import GlobalHotkeyListener, HotkeyRecordingGate, WM_HOTKEY, HOTKEY_ID
from runtime import SoloRuntime
from solo_shortcuts import RouteShortcuts
from test_hotkey import WindowsKeys, until


class RouteShortcutTests(unittest.TestCase):
    def test_settings_normalize_persist_disable_and_reject_duplicate_capture_or_route_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = SoloRuntime(Path(directory))
            runtime.save_settings({'routeArriveHotkey': 'umschalt+strg+a'})
            self.assertEqual(SoloRuntime(Path(directory)).settings['routeArriveHotkey'], 'Ctrl+Shift+A')
            original = runtime.config_path.read_bytes()
            for payload in [{'routeLoadHotkey': 'Ctrl+Shift+A'}, {'captureHotkey': 'Ctrl+Shift+A'},
                            {'routeLoadHotkey': 'Ctrl+Shift+F12'}, {'routeLoadHotkey': ['bad']}]:
                with self.assertRaises(ValueError):
                    runtime.save_settings(payload)
                self.assertEqual(runtime.config_path.read_bytes(), original)
            runtime.save_settings({'routeArriveHotkey': ''})
            self.assertEqual(SoloRuntime(Path(directory)).settings['routeArriveHotkey'], '')
            runtime.save_settings({'routeHomeLocation': ' Orison '})
            self.assertEqual(SoloRuntime(Path(directory)).settings['routeHomeLocation'], 'Orison')
            with self.assertRaises(ValueError):
                runtime.save_settings({'routeHomeLocation': 'x' * 161})

    def test_strict_listener_rejects_registration_conflicts_without_polling(self):
        windows = WindowsKeys()
        windows.RegisterHotKey = lambda *args: 0
        calls = []
        listener = GlobalHotkeyListener('Ctrl+Shift+F11', lambda: calls.append(True), strict=True)
        with patch.object(ctypes, 'WinDLL', return_value=windows, create=True):
            with self.assertRaisesRegex(RuntimeError, 'belegt'):
                listener.start()
            listener.stop()
        self.assertEqual(calls, [])
        self.assertFalse(listener.registered)

    def test_registered_shortcut_uses_only_windows_messages_and_does_not_repeat_held_keys(self):
        windows = WindowsKeys()
        peek = windows.PeekMessageW
        windows.hotkey = False

        def messages(message, *args):
            if windows.hotkey:
                message._obj.message = WM_HOTKEY
                message._obj.wParam = HOTKEY_ID
                windows.hotkey = False
                return True
            return peek(message, *args)

        windows.PeekMessageW = messages
        calls = []
        listener = GlobalHotkeyListener('Ctrl+Shift+F11', lambda: calls.append(True), strict=True)
        with patch.object(ctypes, 'WinDLL', return_value=windows, create=True):
            try:
                listener.start()
                windows.keys = {0x11, 0x10, 0x12, 0x7A}
                time.sleep(.08)
                self.assertEqual(calls, [], 'Extra modifiers must not trigger a polling fallback')
                windows.hotkey = True
                until(lambda: len(calls) == 1)
                time.sleep(.8)
                self.assertEqual(calls, [True], 'Held keys must not repeat')
            finally:
                listener.stop()
        self.assertFalse(windows.registered)

    def test_recording_waits_for_every_listener_and_rolls_back_failed_lease(self):
        capture_gate, first, second = (HotkeyRecordingGate() for _ in range(3))
        runtime = SimpleNamespace(hotkey_recording_gate=capture_gate, worker=None)
        manager = RouteShortcuts(runtime)
        manager.listeners = {'one': SimpleNamespace(recording_gate=first), 'two': SimpleNamespace(recording_gate=second)}
        first.released.wait = lambda timeout: True
        second.released.wait = lambda timeout: False
        with self.assertRaises(RuntimeError):
            manager.record('test-recording', True)
        self.assertTrue(all(not gate.active() for gate in [capture_gate, first, second]))
        second.released.wait = lambda timeout: True
        manager.record('test-recording', True)
        self.assertTrue(all(gate.active() for gate in [capture_gate, first, second]))
        manager.record('test-recording', False)
        self.assertTrue(all(not gate.active() for gate in [capture_gate, first, second]))

    def test_dispatch_only_owner_window_and_never_while_recording_or_closing(self):
        calls = []
        invoked = threading.Event()
        def evaluate(script):
            calls.append(script)
            invoked.set()
        runtime = SimpleNamespace(window=SimpleNamespace(evaluate_js=evaluate), closing=False,
                                  hotkey_recording_gate=HotkeyRecordingGate())
        manager = RouteShortcuts(runtime)
        manager.dispatch('arrive')
        self.assertTrue(invoked.wait(1))
        until(lambda: not manager.dispatch_lock.locked())
        manager.dispatch('unknown')
        runtime.hotkey_recording_gate.update('recording-session', True)
        manager.dispatch('load')
        runtime.hotkey_recording_gate.update('recording-session', False)
        runtime.closing = True
        manager.dispatch('unload')
        self.assertEqual(calls, ['void window.soloRouteShortcuts?.run("arrive")'])


if __name__ == '__main__':
    unittest.main()
