from __future__ import annotations


BRAND_NAME = "Citizen Tools"
BRAND_DESCRIPTOR = "Operations Suite"

COLORS = {
    "void": "#050A11",
    "background": "#07101A",
    "surface": "#0B1622",
    "surface_raised": "#101F2D",
    "line": "#29465C",
    "text": "#E7F3FA",
    "muted": "#8FA8B8",
    "solo": "#5DC8F3",
    "dispatcher": "#55D69C",
    "warning": "#F4C65D",
    "error": "#FF6E78",
}

MARK_VIEWBOX = 64
MARK_OUTER = ((18, 4), (46, 4), (60, 18), (60, 46), (46, 60), (18, 60), (4, 46), (4, 18))
MARK_INNER = ((19, 8), (45, 8), (56, 19), (56, 45), (45, 56), (19, 56), (8, 45), (8, 19))
MARK_C = ((14, 20), (23, 11), (39, 11), (39, 19), (26, 19), (22, 23), (22, 41), (26, 45), (39, 45), (39, 53), (23, 53), (14, 44))
MARK_T = ((29, 24), (51, 24), (51, 32), (45, 32), (45, 51), (37, 51), (37, 32), (29, 32))
MARK_SIGNAL = ((48, 11), (53, 16), (48, 21), (45, 18), (47, 16), (45, 14))


def scaled_points(points: tuple[tuple[int, int], ...], size: int) -> list[float]:
    scale = float(size) / MARK_VIEWBOX
    return [coordinate * scale for point in points for coordinate in point]

