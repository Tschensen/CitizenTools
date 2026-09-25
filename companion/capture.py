from __future__ import annotations

import ctypes
import os
import re
import subprocess
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Callable

from shared.processes import hidden_subprocess_options


DEFAULT_HOTKEY = "Ctrl+Shift+F12"
DEFAULT_CAPTURE_RETENTION = 50
HOTKEY_ID = 0xC17E
WM_HOTKEY = 0x0312
WM_QUIT = 0x0012
PM_NOREMOVE = 0x0000
PM_REMOVE = 0x0001
MOD_ALT = 0x0001
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_WIN = 0x0008
MOD_NOREPEAT = 0x4000
VK_CONTROL = 0x11
VK_SHIFT = 0x10
VK_ALT = 0x12
VK_LWIN = 0x5B
VK_RWIN = 0x5C

MODIFIER_ALIASES = {
    "alt": ("Alt", MOD_ALT),
    "control": ("Ctrl", MOD_CONTROL),
    "ctrl": ("Ctrl", MOD_CONTROL),
    "strg": ("Ctrl", MOD_CONTROL),
    "shift": ("Shift", MOD_SHIFT),
    "umschalt": ("Shift", MOD_SHIFT),
    "win": ("Win", MOD_WIN),
    "windows": ("Win", MOD_WIN),
}
SPECIAL_KEYS = {
    "insert": ("Insert", 0x2D),
    "pause": ("Pause", 0x13),
    "print": ("PrintScreen", 0x2C),
    "printscreen": ("PrintScreen", 0x2C),
    "snapshot": ("PrintScreen", 0x2C),
}
RECORDED_MODIFIER_KEYSYMS = {
    "alt_l": "Alt",
    "alt_r": "Alt",
    "control_l": "Ctrl",
    "control_r": "Ctrl",
    "meta_l": "Alt",
    "meta_r": "Alt",
    "shift_l": "Shift",
    "shift_r": "Shift",
    "super_l": "Win",
    "super_r": "Win",
    "win_l": "Win",
    "win_r": "Win",
}


RECORDED_SPECIAL_KEYSYMS = {
    "insert": "Insert",
    "pause": "Pause",
    "print": "PrintScreen",
    "printscreen": "PrintScreen",
    "snapshot": "PrintScreen",
}


class _Point(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]


class _Message(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("message", ctypes.c_uint),
        ("wParam", ctypes.c_size_t),
        ("lParam", ctypes.c_ssize_t),
        ("time", ctypes.c_ulong),
        ("pt", _Point),
        ("lPrivate", ctypes.c_ulong),
    ]


def default_capture_folder() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return base / "CitizenToolsSolo" / "Captures"


def normalize_capture_retention(value: object) -> int:
    try:
        retention = int(str(value).strip())
    except (TypeError, ValueError) as error:
        raise ValueError("Die maximale Anzahl gespeicherter Aufnahmen muss eine ganze Zahl sein.") from error
    if retention < 1:
        raise ValueError("Es muss mindestens eine Aufnahme aufbewahrt werden.")
    return retention


def list_managed_captures(folder: Path) -> list[Path]:
    capture_folder = Path(folder).expanduser()
    if not capture_folder.is_dir():
        return []
    captures = []
    for path in capture_folder.iterdir():
        if not path.is_file():
            continue
        if not path.name.casefold().startswith("citizentools-") or path.suffix.casefold() != ".png":
            continue
        try:
            modified = path.stat().st_mtime_ns
        except OSError:
            continue
        captures.append((modified, path.name.casefold(), path))
    return [item[2] for item in sorted(captures)]


def prune_managed_captures(
    folder: Path,
    max_files: int,
    can_delete: Callable[[Path], bool] | None = None,
) -> list[Path]:
    retention = normalize_capture_retention(max_files)
    captures = list_managed_captures(folder)
    excess = max(0, len(captures) - retention)
    deleted = []
    for path in captures:
        if excess <= 0:
            break
        if can_delete is not None and not can_delete(path):
            continue
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        deleted.append(path)
        excess -= 1
    return deleted


def clear_managed_captures(folder: Path) -> list[Path]:
    deleted = []
    for path in list_managed_captures(folder):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        deleted.append(path)
    return deleted


def parse_hotkey(value: object) -> tuple[str, int, int]:
    tokens = [token.strip() for token in re.split(r"\s*\+\s*", str(value or "")) if token.strip()]
    if len(tokens) < 2:
        raise ValueError("Der Aufnahme-Hotkey braucht mindestens eine Zusatztaste und eine Haupttaste.")

    modifiers = 0
    modifier_labels = []
    main_key: tuple[str, int] | None = None
    for token in tokens:
        lowered = token.casefold()
        modifier = MODIFIER_ALIASES.get(lowered)
        if modifier:
            label, flag = modifier
            if not modifiers & flag:
                modifier_labels.append(label)
                modifiers |= flag
            continue

        if main_key is not None:
            raise ValueError("Der Aufnahme-Hotkey darf nur eine Haupttaste enthalten.")
        function_match = re.fullmatch(r"f([1-9]|1\d|2[0-4])", lowered)
        if function_match:
            number = int(function_match.group(1))
            main_key = (f"F{number}", 0x70 + number - 1)
        elif len(token) == 1 and token.upper() in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
            main_key = (token.upper(), ord(token.upper()))
        else:
            main_key = SPECIAL_KEYS.get(lowered)
            if main_key is None:
                raise ValueError(f"Die Haupttaste '{token}' wird nicht unterstützt.")

    if modifiers == 0 or main_key is None:
        raise ValueError("Der Aufnahme-Hotkey braucht mindestens eine Zusatztaste und eine Haupttaste.")

    canonical_modifiers = [
        label
        for label, flag in (("Ctrl", MOD_CONTROL), ("Alt", MOD_ALT), ("Shift", MOD_SHIFT), ("Win", MOD_WIN))
        if modifiers & flag
    ]
    canonical = "+".join([*canonical_modifiers, main_key[0]])
    return canonical, modifiers | MOD_NOREPEAT, main_key[1]


def normalize_hotkey(value: object) -> str:
    return parse_hotkey(value)[0]


def recorded_modifier_name(keysym: object) -> str | None:
    return RECORDED_MODIFIER_KEYSYMS.get(str(keysym or "").casefold())


def recorded_main_key_name(keysym: object, keycode: object = None) -> str | None:
    try:
        virtual_key = int(keycode)
    except (TypeError, ValueError):
        virtual_key = -1
    if 0x70 <= virtual_key <= 0x87:
        return f"F{virtual_key - 0x70 + 1}"
    if 0x41 <= virtual_key <= 0x5A or 0x30 <= virtual_key <= 0x39:
        return chr(virtual_key)
    if virtual_key in {0x2D, 0x13, 0x2C}:
        return {0x2D: "Insert", 0x13: "Pause", 0x2C: "PrintScreen"}[virtual_key]

    normalized = str(keysym or "").strip().casefold()
    function_match = re.fullmatch(r"f([1-9]|1\d|2[0-4])", normalized)
    if function_match:
        return f"F{int(function_match.group(1))}"
    if len(normalized) == 1 and normalized.upper() in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
        return normalized.upper()
    return RECORDED_SPECIAL_KEYSYMS.get(normalized)


def compose_recorded_hotkey(modifiers: set[str], main_key: str) -> str:
    ordered_modifiers = [name for name in ("Ctrl", "Alt", "Shift", "Win") if name in modifiers]
    return normalize_hotkey("+".join([*ordered_modifiers, main_key]))


def merge_recorded_modifiers(held_modifiers: set[str], event_state: int) -> set[str]:
    modifiers = set(held_modifiers)
    if event_state & 0x0004:
        modifiers.add("Ctrl")
    if event_state & 0x0001:
        modifiers.add("Shift")
    return modifiers


class HotkeyRecordingGate:
    """Short leases release only the hotkey, leaving OCR jobs running."""
    def __init__(self):
        self.lock = threading.Lock()
        self.leases: dict[str, float] = {}
        self.released = threading.Event()

    def active(self) -> bool:
        with self.lock:
            now = time.monotonic()
            self.leases = {key: expiry for key, expiry in self.leases.items() if expiry > now}
            return bool(self.leases)

    def update(self, session: str, enabled: bool):
        with self.lock:
            if enabled:
                if not any(expiry > time.monotonic() for expiry in self.leases.values()):
                    self.released.clear()
                self.leases[session] = time.monotonic() + 15
            else:
                self.leases.pop(session, None)


class GlobalHotkeyListener:
    def __init__(self, hotkey: str, callback: Callable[[], None], recording_gate: HotkeyRecordingGate | None = None):
        self.hotkey, self.modifiers, self.virtual_key = parse_hotkey(hotkey)
        self.callback = callback
        self.thread: threading.Thread | None = None
        self.thread_id = 0
        self.started = threading.Event()
        self.error: Exception | None = None
        self.registration_warning: str | None = None
        self.last_trigger_at = 0.0
        self.recording_gate = recording_gate

    def start(self) -> None:
        if os.name != "nt":
            raise RuntimeError("Globale Aufnahme-Hotkeys werden derzeit nur unter Windows unterstützt.")
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._run, name="CitizenToolsCaptureHotkey", daemon=True)
        self.thread.start()
        if not self.started.wait(3):
            raise RuntimeError("Der Aufnahme-Hotkey konnte nicht gestartet werden.")
        if self.error:
            raise RuntimeError(str(self.error)) from self.error

    def _run(self) -> None:
        user32 = ctypes.WinDLL("user32", use_last_error=True)
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        message = _Message()
        self.thread_id = int(kernel32.GetCurrentThreadId())
        user32.PeekMessageW(ctypes.byref(message), None, 0, 0, PM_NOREMOVE)
        recording_at_start = bool(self.recording_gate and self.recording_gate.active())
        registered = False if recording_at_start else bool(user32.RegisterHotKey(None, HOTKEY_ID, self.modifiers, self.virtual_key))
        if not registered and not recording_at_start:
            error_code = ctypes.get_last_error()
            self.registration_warning = (
                f"Der Aufnahme-Hotkey {self.hotkey} ist bereits belegt oder konnte nicht registriert werden"
                f" (Windows-Fehler {error_code}). Die direkte Tastenerkennung bleibt aktiv."
            )

        self.started.set()
        combination_was_down = False
        suspended = recording_at_start
        try:
            while True:
                recording = bool(self.recording_gate and self.recording_gate.active())
                # Keep the last recorded key suppressed until it is released.
                # Otherwise resuming the polling fallback would take a screenshot.
                suppress = recording or (suspended and self._key_is_down(user32, self.virtual_key))
                if suppress and not suspended:
                    if registered:
                        user32.UnregisterHotKey(None, HOTKEY_ID)
                        registered = False
                elif suspended and not suppress:
                    registered = bool(user32.RegisterHotKey(None, HOTKEY_ID, self.modifiers, self.virtual_key))
                suspended = suppress
                if recording:
                    self.recording_gate.released.set()
                should_stop = False
                while user32.PeekMessageW(ctypes.byref(message), None, 0, 0, PM_REMOVE):
                    if message.message == WM_QUIT:
                        should_stop = True
                        break
                    if not suspended and message.message == WM_HOTKEY and message.wParam == HOTKEY_ID:
                        self._invoke_callback()
                if should_stop:
                    break

                combination_is_down = self._combination_is_down(user32)
                if not suspended and combination_is_down and not combination_was_down:
                    self._invoke_callback()
                combination_was_down = combination_is_down
                time.sleep(0.02)
        finally:
            if registered:
                user32.UnregisterHotKey(None, HOTKEY_ID)

    @staticmethod
    def _key_is_down(user32, virtual_key: int) -> bool:
        return bool(user32.GetAsyncKeyState(virtual_key) & 0x8000)

    def _combination_is_down(self, user32) -> bool:
        if not self._key_is_down(user32, self.virtual_key):
            return False
        if self.modifiers & MOD_CONTROL and not self._key_is_down(user32, VK_CONTROL):
            return False
        if self.modifiers & MOD_SHIFT and not self._key_is_down(user32, VK_SHIFT):
            return False
        if self.modifiers & MOD_ALT and not self._key_is_down(user32, VK_ALT):
            return False
        if self.modifiers & MOD_WIN and not (
            self._key_is_down(user32, VK_LWIN) or self._key_is_down(user32, VK_RWIN)
        ):
            return False
        return True

    def _invoke_callback(self) -> None:
        if self.recording_gate and self.recording_gate.active():
            return
        now = time.monotonic()
        if now - self.last_trigger_at < 0.75:
            return
        self.last_trigger_at = now
        try:
            self.callback()
        except Exception:
            pass
        finally:
            self.last_trigger_at = time.monotonic()

    def stop(self) -> None:
        if not self.thread or not self.thread.is_alive():
            return
        if self.thread_id:
            user32 = ctypes.WinDLL("user32", use_last_error=True)
            user32.PostThreadMessageW(self.thread_id, WM_QUIT, 0, 0)
        self.thread.join(timeout=2)


def is_windows_platform() -> bool:
    return os.name == "nt"


def capture_screen(output_folder: Path, mode: str = "active-monitor") -> Path:
    if not is_windows_platform():
        raise RuntimeError("Bildschirmaufnahmen werden derzeit nur unter Windows unterstützt.")

    normalized_mode = "VirtualDesktop" if str(mode).casefold() == "virtual-desktop" else "ActiveMonitor"
    script_path = Path(__file__).resolve().parent / "scripts" / "capture-screen.ps1"
    if not script_path.is_file():
        raise RuntimeError("Das Bildschirmaufnahme-Skript wurde nicht gefunden.")

    capture_folder = Path(output_folder).expanduser().resolve()
    capture_folder.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]
    output_path = capture_folder / f"CitizenTools-{timestamp}.png"
    result = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            "-Output",
            str(output_path),
            "-Mode",
            normalized_mode,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
        **hidden_subprocess_options(),
    )
    if result.returncode != 0 or not output_path.is_file():
        output_path.unlink(missing_ok=True)
        details = result.stderr.strip() or result.stdout.strip() or f"Exit-Code {result.returncode}"
        raise RuntimeError(f"Screenshot konnte nicht erstellt werden: {details}")
    return output_path
