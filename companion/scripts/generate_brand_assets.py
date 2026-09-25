from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from shared.brand import COLORS, MARK_C, MARK_INNER, MARK_OUTER, MARK_SIGNAL, MARK_T, MARK_VIEWBOX


ASSET_DIR = PROJECT_ROOT / "companion" / "assets"
ICON_SIZES = (16, 20, 24, 32, 48, 64, 128, 256)


def parse_color(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    raw = value.removeprefix("#")
    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16), alpha


def contains(points: tuple[tuple[int, int], ...], x: float, y: float) -> bool:
    inside = False
    previous_x, previous_y = points[-1]
    for current_x, current_y in points:
        crosses = (current_y > y) != (previous_y > y)
        if crosses:
            boundary_x = (previous_x - current_x) * (y - current_y) / (previous_y - current_y) + current_x
            if x < boundary_x:
                inside = not inside
        previous_x, previous_y = current_x, current_y
    return inside


def render_mark(size: int, accent: str) -> bytes:
    supersample = 4
    render_size = size * supersample
    layers = (
        (MARK_OUTER, parse_color(accent)),
        (MARK_INNER, parse_color(COLORS["background"])),
        (MARK_C, parse_color(accent)),
        (MARK_T, parse_color(COLORS["text"])),
        (MARK_SIGNAL, parse_color(accent)),
    )
    pixels = bytearray(size * size * 4)
    for target_y in range(size):
        for target_x in range(size):
            accumulated = [0, 0, 0, 0]
            for offset_y in range(supersample):
                for offset_x in range(supersample):
                    sample_x = ((target_x * supersample + offset_x + 0.5) / render_size) * MARK_VIEWBOX
                    sample_y = ((target_y * supersample + offset_y + 0.5) / render_size) * MARK_VIEWBOX
                    color = (0, 0, 0, 0)
                    for polygon, layer_color in layers:
                        if contains(polygon, sample_x, sample_y):
                            color = layer_color
                    for channel in range(4):
                        accumulated[channel] += color[channel]
            pixel_index = (target_y * size + target_x) * 4
            sample_count = supersample * supersample
            pixels[pixel_index:pixel_index + 4] = bytes(value // sample_count for value in accumulated)
    return bytes(pixels)


def png_chunk(chunk_type: bytes, payload: bytes) -> bytes:
    content = chunk_type + payload
    return struct.pack(">I", len(payload)) + content + struct.pack(">I", zlib.crc32(content) & 0xFFFFFFFF)


def build_png(size: int, accent: str) -> bytes:
    rgba = render_mark(size, accent)
    rows = b"".join(b"\x00" + rgba[row * size * 4:(row + 1) * size * 4] for row in range(size))
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(rows, 9)) + png_chunk(b"IEND", b"")


def build_ico(accent: str) -> bytes:
    images = [(size, build_png(size, accent)) for size in ICON_SIZES]
    directory_size = 6 + len(images) * 16
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = bytearray()
    payload = bytearray()
    offset = directory_size
    for size, image in images:
        dimension = 0 if size == 256 else size
        entries.extend(struct.pack("<BBBBHHII", dimension, dimension, 0, 0, 1, 32, len(image), offset))
        payload.extend(image)
        offset += len(image)
    return header + bytes(entries) + bytes(payload)


def main() -> None:
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    variants = {
        "citizen-tools": COLORS["solo"],
        "tray-idle": COLORS["solo"],
        "tray-active": COLORS["dispatcher"],
        "tray-warning": COLORS["warning"],
        "tray-error": COLORS["error"],
    }
    for name, accent in variants.items():
        (ASSET_DIR / f"{name}.ico").write_bytes(build_ico(accent))
        (ASSET_DIR / f"{name}.png").write_bytes(build_png(128, accent))


if __name__ == "__main__":
    main()
