"""English and German cargo objectives and consignment allocation."""
from __future__ import annotations

from difflib import SequenceMatcher
import re

from .locations import choose_canonical_dropoff
from .text import (
    clean_objective_text,
    parse_ocr_integer,
)


COLLECT_PATTERN = re.compile(r"Collect\s+(.+?)\s+from\s+(.+)$", re.IGNORECASE)


DELIVER_PATTERN = re.compile(
    r"Deliver\s+(?:[0-9OoSsIl|]+\s*/\s*)?([0-9OoSsIl|]+(?:[.,]\d+)?)\s*SCU"
    r"(?:\s+(?:of\s+)?(.+?))?\s+to\s+(.+)$",
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

    return build_consignment_draft(consignments)


def build_consignment_draft(consignments: list[dict]) -> dict | None:
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
    # English objectives put Deliver before its indented Collect objectives.
    # Join wrapped locations before parsing; a newline is not a location end.
    blocks = []
    pending = ""
    for raw_line in normalized.splitlines():
        line = clean_objective_text(re.sub(r"^[^A-Za-z0-9]+", "", raw_line))
        if re.match(r"^(?:PRIMARY OBJECTIVES|DETAILS|REWARD|CONTRACT(?:ED|S| AVAILABILITY)?|ACCEPT OFFER)\b", line, re.IGNORECASE):
            if pending:
                blocks.append(pending)
            pending = ""
        elif re.match(r"^(?:Deliver|Collect)\b", line, re.IGNORECASE):
            if pending:
                blocks.append(pending)
            pending = line
        elif pending and line:
            pending = clean_objective_text(f"{pending} {line}")
    if pending:
        blocks.append(pending)

    events = []
    for block in blocks:
        collect = COLLECT_PATTERN.fullmatch(block)
        delivery = DELIVER_PATTERN.fullmatch(block)
        if collect:
            events.append({"type": "collect", "cargo": collect[1], "pickup": clean_english_location(collect[2])})
        elif delivery:
            number = delivery[1].replace(",", ".")
            amount = float(number) if re.fullmatch(r"\d+(?:\.\d+)?", number) else parse_ocr_integer(number)
            total = int(amount) if amount is not None and amount > 0 and float(amount).is_integer() else 0
            events.append({"type": "deliver", "cargo": delivery[2] or "", "totalScu": total,
                           "dropoff": clean_english_location(delivery[3])})

    if not events:
        return None

    delivery_first = events[0]["type"] == "deliver"
    consignments = []
    pickups = []
    active = None
    previous_type = ""
    for event in events:
        if event["type"] == "collect":
            if delivery_first:
                if active and cargo_names_match(active["title"], event["cargo"]):
                    if not active["title"]:
                        active["title"] = event["cargo"]
                    if event["pickup"] not in active["pickups"]:
                        active["pickups"].append(event["pickup"])
            else:
                if previous_type == "deliver":
                    pickups = []
                pickups.append(event)
        else:
            matching = [item for item in pickups if cargo_names_match(event["cargo"], item["cargo"])]
            # Missing cargo names may inherit only an unambiguous commodity.
            names = list(dict.fromkeys(item["cargo"] for item in matching))
            title = event["cargo"] or (names[0] if len(names) == 1 else "")
            active = {"title": title, "totalScu": event["totalScu"], "dropoff": event["dropoff"],
                      "pickups": list(dict.fromkeys(item["pickup"] for item in matching)) if title else []}
            consignments.append(active)
        previous_type = event["type"]

    complete = [item for item in consignments if item["title"] and item["totalScu"] > 0 and item["dropoff"] and item["pickups"]]
    if not complete:
        return None
    # Keep the established simple-route shape for one commodity. Mixed cargo
    # and unknown multi-pickup quantities use the same allocation as German.
    if len({item["title"] for item in complete}) == 1 and all(len(item["pickups"]) == 1 for item in complete):
        routes = [{"pickup": item["pickups"][0], "dropoff": item["dropoff"], "targetScu": item["totalScu"]}
                  for item in complete]
        origins = {route["pickup"] for route in routes}
        return {"title": complete[0]["title"], "pickup": next(iter(origins)) if len(origins) == 1 else "", "routes": routes}
    return build_consignment_draft(complete)


def cargo_names_match(left: str, right: str) -> bool:
    return not left or SequenceMatcher(None, left.casefold(), right.casefold()).ratio() >= 0.85


def clean_english_location(value: str) -> str:
    # A sentence-ending period can be followed by small OCR artifacts. Retain
    # periods inside names such as HDMS-St. Martin.
    value = re.sub(r"\.\s+(?:[^A-Za-z0-9]*|[a-z]{1,2})$", "", value)
    value = re.sub(r"(?<!\S)[_~|]+(?!\S)", " ", value)
    value = re.sub(r"\b(ARC|CRU|HUR|MIC)-L[Ss]5?\b", r"\1-L5", value)
    return clean_objective_text(value).rstrip(" ._,;:!?~|>")
