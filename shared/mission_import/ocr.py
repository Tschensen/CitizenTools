"""Tesseract discovery, image preparation and text extraction."""
from __future__ import annotations

from pathlib import Path
import os
import shutil
import subprocess
import sys
import tempfile

from shared.processes import hidden_subprocess_options


def resolve_tesseract(explicit_path: str | None) -> str | None:
    candidates = [
        explicit_path,
        bundled_tesseract_path(),
        os.environ.get("TESSERACT_CMD"),
        shutil.which("tesseract"),
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).expanduser()
        if path.is_file():
            return str(path)
    return None


def bundled_tesseract_path() -> str | None:
    """Return the OCR runtime shipped with the Windows app, if present."""
    roots: list[Path] = []
    if getattr(sys, "frozen", False):
        roots.append(Path(sys.executable).resolve().parent)
        bundle_root = getattr(sys, "_MEIPASS", "")
        if bundle_root:
            roots.append(Path(bundle_root))
    else:
        roots.append(Path(__file__).resolve().parents[2] / "runtime")

    for root in roots:
        candidate = root / "ocr" / "tesseract.exe"
        if candidate.is_file():
            return str(candidate)
    return None


def run_ocr(tesseract_path: str, image_path: Path) -> str:
    environment = os.environ.copy()
    tessdata = Path(tesseract_path).resolve().parent / "tessdata"
    if tessdata.is_dir():
        environment["TESSDATA_PREFIX"] = str(tessdata)
    result = subprocess.run(
        [tesseract_path, str(image_path), "stdout", "-l", "eng", "--psm", "6"],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
        env=environment,
        **hidden_subprocess_options(),
    )
    if result.returncode != 0:
        details = result.stderr.strip() or f"exit code {result.returncode}"
        raise RuntimeError(f"OCR failed: {details}")
    return result.stdout


def prepare_ocr_crop(image_path: Path, region: str) -> Path | None:
    if os.name != "nt" or image_path.suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        return None
    script_path = Path(__file__).with_name("prepare-ocr-image.ps1")
    if not script_path.is_file():
        return None

    normalized_region = {
        "details": "Details",
        "reward": "Reward",
        "title": "Title",
    }.get(str(region).casefold(), "Objectives")
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f"citizen-tools-ocr-{normalized_region.casefold()}-",
        suffix=".png",
    )
    os.close(file_descriptor)
    temporary_path = Path(temporary_name)
    temporary_path.unlink(missing_ok=True)
    try:
        result = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                "-Source",
                str(image_path),
                "-Output",
                str(temporary_path),
                "-Region",
                normalized_region,
            ],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=20,
            **hidden_subprocess_options(),
        )
    except (OSError, subprocess.SubprocessError):
        temporary_path.unlink(missing_ok=True)
        raise
    if result.returncode != 0 or not temporary_path.is_file():
        temporary_path.unlink(missing_ok=True)
        return None
    return temporary_path
