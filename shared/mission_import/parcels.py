"""Courier and package delivery recognition."""
from __future__ import annotations

from difflib import SequenceMatcher
import copy
import re

from .text import (
    clean_objective_text,
    parse_max_package_scu,
    parse_ocr_integer,
    parse_refuel_customer,
)


COURIER_DELIVERY_PATTERN = re.compile(r"^(.+?)\s+zu\s+(.+?)\s+liefern\b", re.IGNORECASE)


COURIER_PICKUP_PATTERN = re.compile(r"^(.+?)\s+bei\s+(.+?)\s+abholen\b", re.IGNORECASE)


def parse_courier_mission_details(text: str) -> dict | None:
    blocks = []
    pending = ""
    for raw_line in str(text or "").splitlines():
        line = clean_objective_text(re.sub(r"^[^A-Za-z0-9\u00c0-\u024f]+", "", raw_line))
        line = re.sub(r"\bliefer\s+n\b", "liefern", line, flags=re.IGNORECASE)
        line = re.sub(r"\babhol\s+en\b", "abholen", line, flags=re.IGNORECASE)
        if not line or re.search(r"PRIM(?:A|\u00c4|A)RE\s+ZIELE", line, re.IGNORECASE):
            continue
        pending = clean_objective_text(f"{pending} {line}")
        if re.search(r"\b(?:liefern|abholen)\b", pending, re.IGNORECASE):
            blocks.append(pending)
            pending = ""

    deliveries = []
    pickups = []
    for block in blocks:
        delivery_match = COURIER_DELIVERY_PATTERN.search(block)
        if delivery_match:
            deliveries.append({
                "name": clean_objective_text(delivery_match.group(1))[:200],
                "destination": re.sub(r"\bShe\s+ter\b", "Shelter", clean_objective_text(delivery_match.group(2)), flags=re.IGNORECASE)[:200],
            })
            continue
        pickup_match = COURIER_PICKUP_PATTERN.search(block)
        if pickup_match:
            pickups.append({
                "name": clean_objective_text(pickup_match.group(1))[:200],
                "pickup": re.sub(r"\bShe\s+ter\b", "Shelter", clean_objective_text(pickup_match.group(2)), flags=re.IGNORECASE)[:200],
            })

    packages = []
    unused_pickups = set(range(len(pickups)))
    for delivery in deliveries:
        ranked = sorted(
            unused_pickups,
            key=lambda index: SequenceMatcher(
                None,
                delivery["name"].casefold(),
                pickups[index]["name"].casefold(),
            ).ratio(),
            reverse=True,
        )
        if not ranked:
            continue
        pickup_index = ranked[0]
        similarity = SequenceMatcher(
            None,
            delivery["name"].casefold(),
            pickups[pickup_index]["name"].casefold(),
        ).ratio()
        if similarity < 0.45:
            continue
        unused_pickups.remove(pickup_index)
        packages.append({
            "quantity": 1,
            "name": delivery["name"],
            "pickup": pickups[pickup_index]["pickup"],
            "destination": delivery["destination"],
        })

    if not packages:
        return None
    return {
        "type": "courier",
        "title": "Kurierauftrag",
        "pickup": packages[0]["pickup"],
        "routes": [],
        "serviceDetails": {
            "customer": parse_refuel_customer(text),
            "location": packages[0]["destination"],
            "packages": packages,
            "maxPackageScu": parse_max_package_scu(text),
            "instructions": "",
        },
    }


def enrich_delivery_mission(draft: dict | None, details_text: str = "") -> dict | None:
    if not isinstance(draft, dict):
        return draft
    details_source = str(details_text or "")
    title = str(draft.get("title") or "")
    delivery_marker = bool(
        re.search(r"Paket\s+(?:bergen|zustellen)", details_source, re.IGNORECASE)
        or re.search(r"\b\d+\s*x\s+.+?\s+bergen\b", details_source, re.IGNORECASE)
        or re.search(r"Sonderlieferung|Package\s+Recovery|Retrieval\s+Run", title, re.IGNORECASE)
    )
    if not delivery_marker:
        return draft

    source_details = draft.get("serviceDetails") if isinstance(draft.get("serviceDetails"), dict) else {}
    packages = copy.deepcopy(source_details.get("packages")) if isinstance(source_details.get("packages"), list) else []
    if not packages:
        for consignment in draft.get("consignments", []) if isinstance(draft.get("consignments"), list) else []:
            if not isinstance(consignment, dict):
                continue
            cargo_name = clean_objective_text(consignment.get("title"))[:200]
            total_scu = parse_ocr_integer(consignment.get("totalScu")) or 0
            for route in consignment.get("routes", []) if isinstance(consignment.get("routes"), list) else []:
                if not isinstance(route, dict):
                    continue
                route_scu = parse_ocr_integer(route.get("targetScu")) or total_scu
                container_scu = route_scu if route_scu in {1, 2, 4, 8, 16, 24, 32} else 1 if route_scu > 0 else None
                quantity = 1 if container_scu == route_scu else max(1, route_scu)
                packages.append({
                    "quantity": quantity,
                    "name": cargo_name,
                    "pickup": clean_objective_text(route.get("pickup") or consignment.get("pickup"))[:200],
                    "destination": clean_objective_text(route.get("dropoff"))[:200],
                    "containerScu": container_scu,
                })

    if not packages:
        return draft

    quantity_match = re.search(r"\b(\d+)\s*x\s+(.+?)\s+bergen\b", details_source, re.IGNORECASE)
    if quantity_match and len(packages) == 1:
        packages[0]["quantity"] = max(1, int(quantity_match.group(1)))
        packages[0]["name"] = clean_objective_text(quantity_match.group(2))[:200]

    narrative_destination = re.search(
        r"Lieferung\s+von\s+dort\s+nach\s+(.+?)\s+(?:gebracht|geliefert)\s+werden",
        details_source,
        re.IGNORECASE | re.DOTALL,
    )
    if narrative_destination and len(packages) == 1:
        destination = clean_objective_text(narrative_destination.group(1))
        destination = re.sub(r"\bSpacep\s+ort\b", "Spaceport", destination, flags=re.IGNORECASE)
        packages[0]["destination"] = destination[:200]

    danger_match = re.search(r"Gefahrenstufe\s*:\s*(.+)$", details_source, re.IGNORECASE | re.MULTILINE)
    danger_note = clean_objective_text(danger_match.group(1))[:500] if danger_match else ""
    normalized = copy.deepcopy(draft)
    normalized["type"] = "delivery"
    if normalized.get("title") == "Kurierauftrag":
        normalized["title"] = "Lieferauftrag"
    normalized["pickup"] = str(packages[0].get("pickup") or "")
    normalized["routes"] = []
    normalized.pop("consignments", None)
    normalized.pop("allocationRequired", None)
    normalized["serviceDetails"] = {
        "customer": str(source_details.get("customer") or ""),
        "location": str(packages[0].get("destination") or ""),
        "packages": packages,
        "maxPackageScu": None,
        "instructions": str(source_details.get("instructions") or ""),
        "dangerNote": danger_note,
    }
    return normalized
