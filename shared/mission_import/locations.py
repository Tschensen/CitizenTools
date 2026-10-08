"""Reconcile OCR observations of the same location without database access."""
from __future__ import annotations

from difflib import SequenceMatcher
import copy
import re

from .text import clean_objective_text


LOCATION_IDENTITY_NOISE = {
    "am", "at", "auf", "above", "bei", "by", "in", "lagrangepunkt", "near", "oberhalb",
    "of", "port", "station", "the", "uber", "ueber", "von",
    "arc", "arccorp", "cru", "crusader", "hur", "hurston", "mic", "microtech", "nyx", "pyro", "stanton",
}


DETAIL_LOCATION_PATTERN = re.compile(r"^\s*(?:>|»|→|[-=]+>)\s*(.+?)\s*$")


LOCATION_CODE_PATTERN = re.compile(r"\b([A-Z]{3})\s*-\s*L([1-5])\b", re.IGNORECASE)


LAGRANGE_NUMBER_PATTERN = re.compile(r"L([1-5])(?=\s*-|\b)", re.IGNORECASE)


def choose_canonical_dropoff(dropoffs: list[str]) -> str:
    cleaned = [clean_objective_text(dropoff) for dropoff in dropoffs if clean_objective_text(dropoff)]
    if not cleaned:
        return ""
    if len(cleaned) == 1:
        return cleaned[0]

    def quality(value: str) -> tuple[int, float]:
        lower = value.lower()
        phrase_score = sum(1 for phrase in ("station", "oberhalb", "crusader") if phrase in lower)
        alpha_ratio = sum(character.isalpha() or character.isspace() or character in "-" for character in value) / max(1, len(value))
        return phrase_score, alpha_ratio

    best = max(cleaned, key=quality)
    related = [
        candidate
        for candidate in cleaned
        if locations_share_identity(candidate, best)
        and SequenceMatcher(None, candidate.lower(), best.lower()).ratio() >= 0.72
    ]
    return best if len(related) == len(cleaned) else ""


def location_identity_tokens(value: object) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold())
    tokens = []
    for token in normalized.split():
        if token in LOCATION_IDENTITY_NOISE or re.fullmatch(r"l\d+", token):
            continue
        tokens.append(token)
    return tokens[:3]


def locations_share_identity(left: object, right: object) -> bool:
    left_tokens = location_identity_tokens(left)
    right_tokens = location_identity_tokens(right)
    if not left_tokens or not right_tokens:
        return False
    left_anchor = left_tokens[0]
    right_anchor = right_tokens[0]
    scores = [SequenceMatcher(None, left_anchor, right_anchor).ratio()]
    if len(left_tokens) > 1:
        scores.append(SequenceMatcher(None, "".join(left_tokens[:2]), right_anchor).ratio())
    if len(right_tokens) > 1:
        scores.append(SequenceMatcher(None, left_anchor, "".join(right_tokens[:2])).ratio())
    return max(scores) >= 0.72


def extract_details_locations(text: str) -> list[str]:
    locations = []
    seen = set()
    lines = str(text or "").splitlines()
    for index, raw_line in enumerate(lines):
        english = re.match(r"^\s*[-•]\s*Freight\s+elevator\s+at\s+(.+)$", raw_line, re.IGNORECASE)
        match = DETAIL_LOCATION_PATTERN.match(raw_line)
        if not match and not english:
            continue
        location = clean_objective_text((english or match).group(1))
        # English station descriptions wrap immediately before 'Lagrange point'.
        if english and index + 1 < len(lines) and re.match(r"^\s*Lagrange\s+point\b", lines[index + 1], re.IGNORECASE):
            location = clean_objective_text(f"{location} {lines[index + 1]}")
        key = location.casefold()
        if len(location) < 3 or key in seen:
            continue
        seen.add(key)
        locations.append(location)
    return locations


def extract_english_direct_route(text: str) -> tuple[str, str] | None:
    narrative = clean_objective_text(text)
    elevator = r"(?:a\s+)?freight\s+elevator\s+at\s+"
    sentence_end = r"(?<!\bSt)[.!?](?=\s|$)"
    patterns = (
        r"\bcargo\s+haul\s+going\s+from\s+" + elevator + r"(.+?)\s+to\s+" + elevator + r"(.+?)" + sentence_end,
        r"\b" + elevator + r"(.+?)\s+has\s+some\s+cargo\s+that\s+needs\s+to\s+be\s+delivered\s+to\s+"
        + elevator + r"(.+?)" + sentence_end,
    )
    for pattern in patterns:
        match = re.search(pattern, narrative, re.IGNORECASE)
        if match:
            return clean_objective_text(match[1]), clean_objective_text(match[2])
    return None


def normalize_location_observation(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").casefold()).strip()


def location_observation_similarity(left: object, right: object) -> float:
    left_normalized = normalize_location_observation(left)
    right_normalized = normalize_location_observation(right)
    if not left_normalized or not right_normalized:
        return 0.0
    left_identity = " ".join(location_identity_tokens(left))
    right_identity = " ".join(location_identity_tokens(right))
    identity_score = SequenceMatcher(None, left_identity, right_identity).ratio()
    text_score = SequenceMatcher(None, left_normalized, right_normalized).ratio()
    return identity_score * 0.72 + text_score * 0.28


def find_corroborating_location(primary: str, candidates: list[str]) -> str | None:
    related = [
        candidate
        for candidate in candidates
        if locations_share_identity(primary, candidate)
    ]
    if not related:
        return None

    ranked = sorted(
        ((location_observation_similarity(primary, candidate), candidate) for candidate in related),
        reverse=True,
    )
    if ranked[0][0] < 0.68:
        return None
    if len(ranked) > 1 and ranked[0][0] - ranked[1][0] < 0.06:
        return None
    return ranked[0][1]


def extract_location_code(value: object) -> str:
    match = LOCATION_CODE_PATTERN.search(str(value or ""))
    return f"{match.group(1).upper()}-L{match.group(2)}" if match else ""


def extract_lagrange_number(value: object) -> str:
    match = LAGRANGE_NUMBER_PATTERN.search(str(value or ""))
    return match.group(1) if match else ""


def extract_station_name(value: object) -> str:
    without_code = LOCATION_CODE_PATTERN.sub("", str(value or ""))
    match = re.search(r"(.+?)(?:\s*-\s*|\s+)Station\b", without_code, re.IGNORECASE)
    return clean_objective_text(match.group(1)) if match else ""


def merge_location_observations(primary: str, corroborating: str) -> str:
    primary = clean_objective_text(primary)
    corroborating = clean_objective_text(corroborating)
    location_code = extract_location_code(primary) or extract_location_code(corroborating)
    station_name = extract_station_name(corroborating) or extract_station_name(primary)
    if location_code and station_name:
        return f"{location_code} {station_name} Station"

    resolved = re.sub(r"(?i)Stationam", "Station am", corroborating)
    primary_lagrange = extract_lagrange_number(primary)
    corroborating_lagrange = extract_lagrange_number(corroborating)
    if primary_lagrange and not corroborating_lagrange:
        resolved = re.sub(
            r"(?i)L[Ss](?=\s*(?:-\s*Lagrangepunkt|Lagrange\s+point))",
            f"L{primary_lagrange}",
            resolved,
        )
    return clean_objective_text(resolved)


def reconcile_draft_locations(draft: dict, details_text: str) -> tuple[dict, dict[str, int]]:
    candidates = extract_details_locations(details_text)
    reconciled = copy.deepcopy(draft)
    cache: dict[str, tuple[str, bool]] = {}
    matched_sources = set()
    corrected_sources = set()

    # Direct-haul prose explicitly names both endpoints. It can recover a
    # completely obscured objective location without guessing from a list.
    direct_route = extract_english_direct_route(details_text)
    routes = reconciled.get("routes", [])
    if direct_route and len(routes) == 1 and not reconciled.get("consignments"):
        for field, endpoint in zip(("pickup", "dropoff"), direct_route):
            primary = clean_objective_text(routes[0].get(field))
            resolved = merge_location_observations(primary, endpoint)
            routes[0][field] = resolved
            matched_sources.add(primary)
            if normalize_location_observation(primary) != normalize_location_observation(resolved):
                corrected_sources.add(primary)
        reconciled["pickup"] = routes[0]["pickup"]

    def resolve(value: object) -> str:
        primary = clean_objective_text(value)
        if not primary:
            return ""
        if primary in cache:
            return cache[primary][0]
        corroborating = find_corroborating_location(primary, candidates)
        if not corroborating:
            cache[primary] = (primary, False)
            return primary
        resolved = merge_location_observations(primary, corroborating)
        matched_sources.add(primary)
        if normalize_location_observation(resolved) != normalize_location_observation(primary):
            corrected_sources.add(primary)
        cache[primary] = (resolved, True)
        return resolved

    reconciled["pickup"] = resolve(reconciled.get("pickup"))
    for route in reconciled.get("routes", []) if isinstance(reconciled.get("routes"), list) else []:
        if not isinstance(route, dict):
            continue
        route["pickup"] = resolve(route.get("pickup"))
        route["dropoff"] = resolve(route.get("dropoff"))
    for consignment in reconciled.get("consignments", []) if isinstance(reconciled.get("consignments"), list) else []:
        if not isinstance(consignment, dict):
            continue
        consignment["pickup"] = resolve(consignment.get("pickup"))
        for route in consignment.get("routes", []) if isinstance(consignment.get("routes"), list) else []:
            if not isinstance(route, dict):
                continue
            route["pickup"] = resolve(route.get("pickup"))
            route["dropoff"] = resolve(route.get("dropoff"))

    return reconciled, {
        "matched": len(matched_sources),
        "corrected": len(corrected_sources),
    }
