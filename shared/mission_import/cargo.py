"""English and German cargo objectives and consignment allocation."""
from __future__ import annotations

from difflib import SequenceMatcher
import re

from .locations import choose_canonical_dropoff
from .text import (
    clean_objective_text,
    parse_ocr_integer,
)


COLLECT_PATTERN = re.compile(r"Collect\s+(.+?)\s+from\s+(.+?)(?:\.|\n|$)", re.IGNORECASE)


DELIVER_PATTERN = re.compile(
    r"Deliver\s+(?:0\s*/\s*)?(\d+(?:[.,]\d+)?)\s*SCU(?:\s+of\s+(.+?))?\s+to\s+(.+?)(?:\.|\n|$)",
    re.IGNORECASE,
)


GERMAN_DELIVERY_PATTERN = re.compile(
    r"Liefere\s+[0-9OoIl|]+\s*/\s*([0-9OoSsIl|]+)\s*SCU\s+(.+?)\s+zu\s+(.+)$",
    re.IGNORECASE,
)


GERMAN_PICKUP_PATTERN = re.compile(r"(.+?)\s+bei\s+(.+?)\s+abholen\b", re.IGNORECASE)


GERMAN_PICKUP_OCR_PATTERN = re.compile(
    r"^(.+?)\s+(?:b|h)?ei\s+(.+?)\s+abhol\w*\b",
    re.IGNORECASE,
)


GERMAN_PICKUP_FALLBACK_PATTERN = re.compile(
    r"^(.+?)\s+bei\s+(.+?)(?:\s+abhol\w*)?\s*[_.,;:!?-]*$",
    re.IGNORECASE,
)


def parse_german_mission_objectives(text: str) -> dict | None:
    consignments = []
    active = None
    lines = []

    for raw_line in str(text or "").splitlines():
        line = clean_objective_text(re.sub(r"^[^A-Za-z0-9]+", "", raw_line))
        line = re.sub(r"\bliefe\s+re\b", "Liefere", line, flags=re.IGNORECASE)
        if not line:
            continue
        if re.fullmatch(r"abholen[.!]?", line, re.IGNORECASE) and lines:
            lines[-1] = clean_objective_text(f"{lines[-1]} {line}")
            continue
        lines.append(line)

    for line in lines:
        delivery_match = GERMAN_DELIVERY_PATTERN.search(line)
        if delivery_match:
            total_scu = parse_ocr_integer(delivery_match.group(1))
            if total_scu is None or total_scu <= 0:
                continue
            if active:
                consignments.append(active)
            active = {
                "title": clean_objective_text(delivery_match.group(2)),
                "totalScu": total_scu,
                "dropoff": clean_objective_text(delivery_match.group(3)),
                "pickups": [],
            }
            continue

        pickup_match = GERMAN_PICKUP_PATTERN.search(line)
        if not pickup_match and active:
            pickup_match = GERMAN_PICKUP_OCR_PATTERN.search(line)
        if not pickup_match and active:
            fallback_match = GERMAN_PICKUP_FALLBACK_PATTERN.search(line)
            if fallback_match:
                fallback_cargo = clean_objective_text(fallback_match.group(1))
                if SequenceMatcher(
                    None,
                    fallback_cargo.lower(),
                    active["title"].lower(),
                ).ratio() >= 0.55:
                    pickup_match = fallback_match
        if pickup_match and active:
            cargo = clean_objective_text(pickup_match.group(1))
            cargo_matches = SequenceMatcher(None, cargo.lower(), active["title"].lower()).ratio() >= 0.55
            explicit_pickup = bool(re.search(r"\babhol\w*\b", line, re.IGNORECASE))
            if cargo_matches or explicit_pickup:
                pickup = clean_objective_text(pickup_match.group(2)).rstrip(" _.,;:!?-")
                if pickup:
                    active["pickups"].append(pickup)
            continue

        if active and not active["pickups"] and not line.lower().startswith(("primare", "primare")):
            active["dropoff"] = clean_objective_text(f"{active['dropoff']} {line}")

    if active:
        consignments.append(active)

    consignments = [item for item in consignments if item["title"] and item["totalScu"] > 0 and item["pickups"]]
    if not consignments:
        return None

    canonical_dropoff = choose_canonical_dropoff([item["dropoff"] for item in consignments])
    normalized_consignments = []
    grouped_consignments = {}
    allocation_required = False
    for item in consignments:
        dropoff = canonical_dropoff or item["dropoff"]
        route_target_scu = item["totalScu"] if len(item["pickups"]) == 1 else 0
        allocation_required = allocation_required or route_target_scu == 0
        routes = [
            {
                "pickup": pickup,
                "dropoff": dropoff,
                "targetScu": route_target_scu,
            }
            for pickup in item["pickups"]
        ]
        group_key = re.sub(r"[^a-z0-9]+", "", item["title"].casefold()) if route_target_scu > 0 else ""
        grouped = grouped_consignments.get(group_key) if group_key else None
        if grouped:
            grouped["totalScu"] += item["totalScu"]
            grouped["routes"].extend(routes)
            continue

        grouped = {
            "title": item["title"],
            "totalScu": item["totalScu"],
            "pickup": routes[0]["pickup"] if len(routes) == 1 else "",
            "routes": routes,
        }
        normalized_consignments.append(grouped)
        if group_key:
            grouped_consignments[group_key] = grouped

    for consignment in normalized_consignments:
        consignment_pickups = {route["pickup"] for route in consignment["routes"] if route["pickup"]}
        consignment["pickup"] = next(iter(consignment_pickups)) if len(consignment_pickups) == 1 else ""

    titles = list(dict.fromkeys(item["title"] for item in normalized_consignments))
    pickups = {
        route["pickup"]
        for consignment in normalized_consignments
        for route in consignment["routes"]
        if route["pickup"]
    }
    return {
        "title": " + ".join(titles),
        "pickup": next(iter(pickups)) if len(pickups) == 1 else "",
        "routes": [],
        "consignments": normalized_consignments,
        "allocationRequired": allocation_required,
    }


def parse_english_mission_objectives(normalized: str) -> dict | None:
    events = []

    for match in COLLECT_PATTERN.finditer(normalized):
        events.append(
            {
                "type": "collect",
                "index": match.start(),
                "cargo": clean_objective_text(match.group(1)),
                "pickup": clean_objective_text(match.group(2)),
            }
        )

    for match in DELIVER_PATTERN.finditer(normalized):
        events.append(
            {
                "type": "deliver",
                "index": match.start(),
                "targetScu": float(match.group(1).replace(",", ".")),
                "cargo": clean_objective_text(match.group(2)),
                "dropoff": clean_objective_text(match.group(3)),
            }
        )

    events.sort(key=lambda event: event["index"])
    active_cargo = ""
    active_pickup = ""
    cargo_names: list[str] = []
    routes = []

    for event in events:
        if event["type"] == "collect":
            active_cargo = event["cargo"] or active_cargo
            active_pickup = event["pickup"] or active_pickup
            if active_cargo and active_cargo not in cargo_names:
                cargo_names.append(active_cargo)
            continue

        cargo = event["cargo"] or active_cargo
        if cargo and cargo not in cargo_names:
            cargo_names.append(cargo)
        target_scu = event["targetScu"]
        if not float(target_scu).is_integer():
            continue
        routes.append(
            {
                "pickup": active_pickup,
                "dropoff": event["dropoff"],
                "targetScu": int(target_scu),
            }
        )

    complete_routes = [
        route
        for route in routes
        if route["pickup"] and route["dropoff"] and route["targetScu"] > 0
    ]
    if not complete_routes:
        return None

    title = cargo_names[0] if len(cargo_names) == 1 else "Mixed cargo" if cargo_names else "Cargo"
    pickup = complete_routes[0]["pickup"] if all(
        route["pickup"] == complete_routes[0]["pickup"] for route in complete_routes
    ) else ""
    return {"title": title, "pickup": pickup, "routes": complete_routes}
