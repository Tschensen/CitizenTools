from __future__ import annotations

import ctypes
import os
import threading
from dataclasses import dataclass
from ctypes import wintypes
from pathlib import Path
from typing import Callable


TRAY_CALLBACK_MESSAGE = 0x0400 + 20
TRAY_REFRESH_MESSAGE = 0x0400 + 21
WM_COMMAND = 0x0111
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
WM_LBUTTONUP = 0x0202
WM_LBUTTONDBLCLK = 0x0203
WM_RBUTTONUP = 0x0205
WM_NULL = 0x0000

NIM_ADD = 0x00000000
NIM_MODIFY = 0x00000001
NIM_DELETE = 0x00000002
NIF_MESSAGE = 0x00000001
NIF_ICON = 0x00000002
NIF_TIP = 0x00000004

MF_STRING = 0x00000000
MF_GRAYED = 0x00000001
MF_SEPARATOR = 0x00000800
TPM_RIGHTBUTTON = 0x0002
TPM_BOTTOMALIGN = 0x0020
IDI_APPLICATION = 32512
IMAGE_ICON = 1
LR_LOADFROMFILE = 0x00000010
LR_DEFAULTSIZE = 0x00000040

ASSET_DIR = Path(__file__).resolve().parent / "assets"
TRAY_ICON_PATHS = {
    "idle": ASSET_DIR / "tray-idle.ico",
    "active": ASSET_DIR / "tray-active.ico",
    "warning": ASSET_DIR / "tray-warning.ico",
    "error": ASSET_DIR / "tray-error.ico",
}

MENU_OPEN = 1001
MENU_START = 1002
MENU_STOP = 1003
MENU_CHECK_SERVER = 1004
MENU_EXIT = 1005


@dataclass(frozen=True)
class TrayState:
    monitoring: bool = False
    server_status: str = "Ungeprüft"


def build_tray_tooltip(state: TrayState) -> str:
    monitoring = "Hotkey-Erfassung aktiv" if state.monitoring else "Hotkey-Erfassung deaktiviert"
    return f"Citizen Tools Solo | SOLO | {monitoring} | Server: {state.server_status}"[:127]


def tray_icon_variant(state: TrayState) -> str:
    status = str(state.server_status or "").strip().casefold()
    if any(token in status for token in ("ungültig", "fehler", "error")):
        return "error"
    if any(token in status for token in ("nicht erreichbar", "ungeprüft", "wird geprüft", "wird gestartet")):
        return "warning"
    return "active" if state.monitoring else "idle"


if os.name == "nt":
    LRESULT = ctypes.c_ssize_t
    WNDPROC = ctypes.WINFUNCTYPE(
        LRESULT,
        wintypes.HWND,
        wintypes.UINT,
        wintypes.WPARAM,
        wintypes.LPARAM,
    )

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [
            ("style", wintypes.UINT),
            ("lpfnWndProc", WNDPROC),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wintypes.HINSTANCE),
            ("hIcon", wintypes.HICON),
            ("hCursor", wintypes.HANDLE),
            ("hbrBackground", wintypes.HBRUSH),
            ("lpszMenuName", wintypes.LPCWSTR),
            ("lpszClassName", wintypes.LPCWSTR),
        ]

    class NOTIFYICONDATAW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("hWnd", wintypes.HWND),
            ("uID", wintypes.UINT),
            ("uFlags", wintypes.UINT),
            ("uCallbackMessage", wintypes.UINT),
            ("hIcon", wintypes.HICON),
            ("szTip", wintypes.WCHAR * 128),
        ]


class WindowsTrayIcon:
    def __init__(self, on_action: Callable[[str], None]):
        self.on_action = on_action
        self._state = TrayState()
        self._state_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self._hwnd = None
        self._icon = None
        self._icons = {}
        self._owned_icons = []
        self._icon_added = False
        self._window_proc = None
        self._class_name = f"CitizenToolsCompanionTray_{id(self):x}"
        self.error: str | None = None

    @property
    def available(self) -> bool:
        return bool(self._thread and self._thread.is_alive() and self._icon_added)

    def start(self) -> bool:
        if os.name != "nt":
            self.error = "Der Infobereich ist nur unter Windows verfügbar."
            return False
        if self.available:
            return True

        self._ready.clear()
        self._thread = threading.Thread(target=self._run, name="CitizenToolsTray", daemon=True)
        self._thread.start()
        self._ready.wait(timeout=3)
        return self.available

    def update_state(self, monitoring: bool, server_status: str) -> None:
        with self._state_lock:
            self._state = TrayState(
                bool(monitoring),
                str(server_status or "Ungeprüft"),
            )
        if self._hwnd and os.name == "nt":
            ctypes.windll.user32.PostMessageW(self._hwnd, TRAY_REFRESH_MESSAGE, 0, 0)

    def stop(self) -> None:
        if self._hwnd and os.name == "nt":
            ctypes.windll.user32.PostMessageW(self._hwnd, WM_CLOSE, 0, 0)
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=3)

    def _run(self) -> None:
        try:
            self._run_windows()
        except Exception as tray_error:
            self.error = str(tray_error)
        finally:
            self._ready.set()

    def _run_windows(self) -> None:
        user32 = ctypes.windll.user32
        shell32 = ctypes.windll.shell32
        kernel32 = ctypes.windll.kernel32

        kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
        kernel32.GetModuleHandleW.restype = wintypes.HINSTANCE
        user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
        user32.RegisterClassW.restype = wintypes.ATOM
        user32.UnregisterClassW.argtypes = [wintypes.LPCWSTR, wintypes.HINSTANCE]
        user32.UnregisterClassW.restype = wintypes.BOOL
        user32.CreateWindowExW.argtypes = [
            wintypes.DWORD,
            wintypes.LPCWSTR,
            wintypes.LPCWSTR,
            wintypes.DWORD,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.HMENU,
            wintypes.HINSTANCE,
            wintypes.LPVOID,
        ]
        user32.DefWindowProcW.restype = LRESULT
        user32.DefWindowProcW.argtypes = [
            wintypes.HWND,
            wintypes.UINT,
            wintypes.WPARAM,
            wintypes.LPARAM,
        ]
        user32.CreateWindowExW.restype = wintypes.HWND
        user32.DestroyWindow.argtypes = [wintypes.HWND]
        user32.DestroyWindow.restype = wintypes.BOOL
        user32.PostMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
        user32.PostMessageW.restype = wintypes.BOOL
        user32.GetMessageW.argtypes = [ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT]
        user32.GetMessageW.restype = wintypes.BOOL
        user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
        user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
        user32.DispatchMessageW.restype = LRESULT
        user32.LoadIconW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR]
        user32.LoadIconW.restype = wintypes.HICON
        user32.LoadImageW.argtypes = [wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int, ctypes.c_int, wintypes.UINT]
        user32.LoadImageW.restype = wintypes.HANDLE
        user32.DestroyIcon.argtypes = [wintypes.HICON]
        user32.DestroyIcon.restype = wintypes.BOOL
        user32.CreatePopupMenu.restype = wintypes.HMENU
        user32.AppendMenuW.argtypes = [wintypes.HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
        user32.AppendMenuW.restype = wintypes.BOOL
        user32.TrackPopupMenu.argtypes = [
            wintypes.HMENU,
            wintypes.UINT,
            ctypes.c_int,
            ctypes.c_int,
            ctypes.c_int,
            wintypes.HWND,
            wintypes.LPRECT,
        ]
        user32.TrackPopupMenu.restype = wintypes.BOOL
        user32.DestroyMenu.argtypes = [wintypes.HMENU]
        user32.SetForegroundWindow.argtypes = [wintypes.HWND]
        shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
        shell32.Shell_NotifyIconW.restype = wintypes.BOOL

        instance = kernel32.GetModuleHandleW(None)

        @WNDPROC
        def window_proc(hwnd, message, wparam, lparam):
            return self._handle_window_message(hwnd, message, wparam, lparam)

        self._window_proc = window_proc
        fallback_icon = user32.LoadIconW(None, ctypes.cast(IDI_APPLICATION, wintypes.LPCWSTR))
        for variant, icon_path in TRAY_ICON_PATHS.items():
            icon = user32.LoadImageW(
                None,
                str(icon_path),
                IMAGE_ICON,
                0,
                0,
                LR_LOADFROMFILE | LR_DEFAULTSIZE,
            )
            if icon:
                self._icons[variant] = icon
                self._owned_icons.append(icon)
            else:
                self._icons[variant] = fallback_icon
        window_class = WNDCLASSW()
        window_class.lpfnWndProc = window_proc
        window_class.hInstance = instance
        window_class.hIcon = self._icons.get("idle", fallback_icon)
        window_class.lpszClassName = self._class_name

        try:
            if not user32.RegisterClassW(ctypes.byref(window_class)):
                raise ctypes.WinError()
            self._icon = window_class.hIcon
            self._hwnd = user32.CreateWindowExW(
                0,
                self._class_name,
                "Citizen Tools Solo",
                0,
                0,
                0,
                0,
                0,
                None,
                None,
                instance,
                None,
            )
            if not self._hwnd:
                raise ctypes.WinError()
            if not self._notify_icon(NIM_ADD):
                raise ctypes.WinError()
            self._icon_added = True
            self._ready.set()

            message = wintypes.MSG()
            while user32.GetMessageW(ctypes.byref(message), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(message))
                user32.DispatchMessageW(ctypes.byref(message))
        except Exception as tray_error:
            self.error = str(tray_error)
            self._ready.set()
        finally:
            if self._icon_added:
                self._notify_icon(NIM_DELETE)
                self._icon_added = False
            if self._hwnd:
                user32.DestroyWindow(self._hwnd)
                self._hwnd = None
            user32.UnregisterClassW(self._class_name, instance)
            for icon in self._owned_icons:
                user32.DestroyIcon(icon)
            self._owned_icons.clear()
            self._icons.clear()
            self._ready.set()

    def _notify_icon(self, operation: int) -> bool:
        data = NOTIFYICONDATAW()
        data.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        data.hWnd = self._hwnd
        data.uID = 1
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        data.uCallbackMessage = TRAY_CALLBACK_MESSAGE
        with self._state_lock:
            state = self._state
            data.szTip = build_tray_tooltip(state)
            data.hIcon = self._icons.get(tray_icon_variant(state), self._icon)
        return bool(ctypes.windll.shell32.Shell_NotifyIconW(operation, ctypes.byref(data)))

    def _handle_window_message(self, hwnd, message, wparam, lparam):
        user32 = ctypes.windll.user32
        if message == TRAY_CALLBACK_MESSAGE:
            if lparam in {WM_LBUTTONUP, WM_LBUTTONDBLCLK}:
                self.on_action("open")
            elif lparam == WM_RBUTTONUP:
                self._show_menu(hwnd)
            return 0
        if message == TRAY_REFRESH_MESSAGE:
            if self._icon_added:
                self._notify_icon(NIM_MODIFY)
            return 0
        if message == WM_COMMAND:
            actions = {
                MENU_OPEN: "open",
                MENU_START: "start",
                MENU_STOP: "stop",
                MENU_CHECK_SERVER: "check_server",
                MENU_EXIT: "exit",
            }
            action = actions.get(int(wparam) & 0xFFFF)
            if action:
                self.on_action(action)
            return 0
        if message == WM_CLOSE:
            user32.DestroyWindow(hwnd)
            return 0
        if message == WM_DESTROY:
            if self._icon_added:
                self._notify_icon(NIM_DELETE)
                self._icon_added = False
            user32.PostQuitMessage(0)
            return 0
        return user32.DefWindowProcW(hwnd, message, wparam, lparam)

    def _show_menu(self, hwnd) -> None:
        user32 = ctypes.windll.user32
        menu = user32.CreatePopupMenu()
        if not menu:
            return
        with self._state_lock:
            state = self._state

        user32.AppendMenuW(menu, MF_STRING, MENU_OPEN, "Companion öffnen")
        user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        if state.monitoring:
            user32.AppendMenuW(menu, MF_STRING, MENU_STOP, "Hotkey-Erfassung deaktivieren")
        else:
            user32.AppendMenuW(menu, MF_STRING, MENU_START, "Hotkey-Erfassung aktivieren")
        user32.AppendMenuW(menu, MF_STRING, MENU_CHECK_SERVER, "Serververbindung prüfen")
        user32.AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, f"Server: {state.server_status}")
        user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
        user32.AppendMenuW(menu, MF_STRING, MENU_EXIT, "Companion beenden")

        cursor = wintypes.POINT()
        user32.GetCursorPos(ctypes.byref(cursor))
        user32.SetForegroundWindow(hwnd)
        user32.TrackPopupMenu(
            menu,
            TPM_RIGHTBUTTON | TPM_BOTTOMALIGN,
            cursor.x,
            cursor.y,
            0,
            hwnd,
            None,
        )
        user32.PostMessageW(hwnd, WM_NULL, 0, 0)
        user32.DestroyMenu(menu)

