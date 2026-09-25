from __future__ import annotations

import os
import subprocess


def hidden_subprocess_options() -> dict[str, object]:
    if os.name != "nt":
        return {}

    options: dict[str, object] = {
        "creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0),
    }
    startupinfo_factory = getattr(subprocess, "STARTUPINFO", None)
    if startupinfo_factory:
        startupinfo = startupinfo_factory()
        startupinfo.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0)
        startupinfo.wShowWindow = getattr(subprocess, "SW_HIDE", 0)
        options["startupinfo"] = startupinfo
    return options
