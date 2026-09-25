#!/usr/bin/env python3

from __future__ import annotations

import argparse
import copy
from difflib import SequenceMatcher
import hashlib
import json
import os
import queue
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib import error, parse, request

from companion import capture as companion_capture
from companion.version import USER_AGENT


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
ONLINE_COMPANION_TOKEN_PREFIX = "ctc_"
MAX_PROCESSED_SIGNATURES = 5000
MAX_CAPTURE_QUEUE = 20
PARSER_VERSION = 17
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
LOCATION_IDENTITY_NOISE = {
    "am", "at", "auf", "above", "bei", "by", "in", "lagrangepunkt", "near", "oberhalb",
    "of", "port", "station", "the", "uber", "ueber", "von",
    "arc", "arccorp", "cru", "crusader", "hur", "hurston", "mic", "microtech", "nyx", "pyro", "stanton",
}
DETAIL_LOCATION_PATTERN = re.compile(r"^\s*(?:>|»|→|[-=]+>)\s*(.+?)\s*$")
LOCATION_CODE_PATTERN = re.compile(r"\b([A-Z]{3})\s*-\s*L([1-5])\b", re.IGNORECASE)
LAGRANGE_NUMBER_PATTERN = re.compile(r"L([1-5])(?=\s*-|\b)", re.IGNORECASE)
REWARD_NUMBER_PATTERN = re.compile(r"(?<!\d)(\d{1,3}(?:[.,'\s]\d{3})+|\d+)(?!\d)")
REFUEL_TARGET_PATTERN = re.compile(
    r"(?:zu\s+betankendes\s+fahrzeug|vehicle\s+to\s+refuel)\s*:\s*(.+)$",
    re.IGNORECASE,
)
REFUEL_RATE_PATTERN = re.compile(
    r"\b(hydrogen|quantum(?:fuel)?)\s*:\s*(\d+(?:[.,]\d+)?)\s*a?u?ec\s*/\s*scu\b",
    re.IGNORECASE,
)
PROCUREMENT_OBJECTIVE_PATTERN = re.compile(
    r"\b(?:Bringe|Liefere)\s+0\s*/\s*(\d+)\s+(.+?)\s+zu\s+(.+?)"
    r"(?=(?:\n\s*[^A-Za-z0-9]*\s*(?:Bringe|Liefere)\s+0\s*/)|\Z)",
    re.IGNORECASE | re.DOTALL,
)
COURIER_DELIVERY_PATTERN = re.compile(r"^(.+?)\s+zu\s+(.+?)\s+liefern\b", re.IGNORECASE)
COURIER_PICKUP_PATTERN = re.compile(r"^(.+?)\s+bei\s+(.+?)\s+abholen\b", re.IGNORECASE)


def clean_objective_text(value: object) -> str:
    return re.sub(r"^[-\u2013\u2022\s]+", "", re.sub(r"\s+", " ", str(value or ""))).strip()


def parse_ocr_integer(value: object) -> int | None:
    normalized = str(value or "").translate(str.maketrans({
        "O": "0", "o": "0",
        "S": "5", "s": "5",
        "I": "1", "i": "1", "l": "1", "|": "1",
    }))
    return int(normalized) if normalized.isdigit() else None


def parse_reward_amount(text: str) -> int | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    labelled_lines = [
        line for line in lines
        if re.search(r"belohn|reward|auec|uec", line, re.IGNORECASE)
    ]
    candidates = labelled_lines or lines

    for line in candidates:
        amounts = []
        for match in REWARD_NUMBER_PATTERN.finditer(line):
            digits = re.sub(r"\D", "", match.group(1))
            if not digits:
                continue
            amount = int(digits)
            if 0 <= amount <= 10_000_000_000:
                amounts.append(amount)
        if amounts:
            return max(amounts)
    return None


def parse_max_container_scu(text: str) -> int | None:
    for raw_line in str(text or "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        labelled_maximum = (
            re.search(r"\bmax(?:imum)?\.?\b", line, re.IGNORECASE)
            and re.search(r"container", line, re.IGNORECASE)
        )
        ship_requirement = re.search(
            r"\bschiff\b.+?\b\d+(?:[.,]\d+)?\s*SCU\s+Frachtcontainer\b.+?\btransportieren\b",
            line,
            re.IGNORECASE,
        )
        if not labelled_maximum and not ship_requirement:
            continue
        match = re.search(r"(?<!\d)(\d+(?:[.,]\d+)?)\s*SCU\b", line, re.IGNORECASE)
        if not match:
            continue
        amount = float(match.group(1).replace(",", "."))
        if amount.is_integer() and 0 < amount <= 1000:
            return int(amount)
    return None


def parse_max_package_scu(text: str) -> float | None:
    match = re.search(
        r"Frachtgr(?:o|\u00f6|od|\u00f3)(?:\u00df|ss|f)e\s*:\s*bis\s+zu\s+(\d+(?:[.,]\d+)?)\s*SCU",
        str(text or ""),
        re.IGNORECASE,
    )
    if not match:
        return None
    amount = float(match.group(1).replace(",", "."))
    return round(amount, 2) if 0 < amount <= 1000 else None


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


def parse_refuel_customer(text: str) -> str:
    for raw_line in str(text or "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        match = re.search(r"(?:auftraggeber|contractor|employer)\s*:?\s*(.+)$", line, re.IGNORECASE)
        if match:
            return clean_objective_text(match.group(1))[:200]
    return ""


def parse_mission_title(text: str) -> str:
    lines = []
    for raw_line in str(text or "").splitlines():
        line = clean_objective_text(raw_line)
        if not line or re.fullmatch(r"(?:AUFTR(?:A|Ä)GE|DETAILS|PRIM(?:A|Ä)RE ZIELE)", line, re.IGNORECASE):
            continue
        lines.append(line)
    title = " ".join(lines)
    title = re.sub(r"^[\\|/]+CC-", "ICC-", title, flags=re.IGNORECASE)
    title = re.sub(r"(?:\||\[)\s*BP\s*[|}\]]\s*(\*)?", r"[BP]\1", title, flags=re.IGNORECASE)
    title = re.sub(r"[|\[]\s*BP\s*[|\]]", "[BP]", title, flags=re.IGNORECASE)
    title = re.sub(r"\[\s*BP\s*[}\]]", "[BP]", title, flags=re.IGNORECASE)
    return title[:200]


def parse_salvage_title_details(title: str) -> dict:
    match = re.search(
        r"CLAIM\s*(#[A-Z0-9-]+)\s*:\s*(.+?)\s+SALVAGE\s+RIGHTS\b",
        str(title or ""),
        re.IGNORECASE,
    )
    if not match:
        return {"claimNumber": "", "salvageTarget": ""}
    return {
        "claimNumber": match.group(1).upper()[:80],
        "salvageTarget": clean_objective_text(match.group(2))[:200],
    }


def parse_salvage_mission_details(text: str) -> dict | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    normalized = "\n".join(lines)
    recognized_type = bool(
        re.search(r"\bSALVAGE\s+RIGHTS\b", normalized, re.IGNORECASE)
        or re.search(r"Verwertungsrechte|bergbar(?:e|en|er)?\s+Material", normalized, re.IGNORECASE)
        or re.search(r"recycelten\s+Materialverbundstoff|\bRMC\b", normalized, re.IGNORECASE)
    )
    if not recognized_type:
        return None

    notices = []
    for line in lines:
        if re.search(r"Datenfehler|Bauplan", line, re.IGNORECASE):
            notices.append(clean_objective_text(re.sub(r"^[^A-Za-z0-9\u00c0-\u024f]+", "", line)))
    instructions = " ".join(dict.fromkeys(filter(None, notices)))[:1000]

    return {
        "type": "salvage",
        "title": "Verwertungsauftrag",
        "pickup": "",
        "routes": [],
        "serviceDetails": {
            "customer": parse_refuel_customer(normalized),
            "location": "",
            "salvageTarget": "",
            "claimNumber": "",
            "instructions": instructions,
        },
    }


def apply_mission_title(draft: dict, title_text: str) -> dict:
    title = parse_mission_title(title_text)
    if not title:
        return draft
    enriched = copy.deepcopy(draft)
    enriched["title"] = title
    if enriched.get("type") == "salvage":
        enriched.setdefault("serviceDetails", {}).update(
            {
                key: value
                for key, value in parse_salvage_title_details(title).items()
                if value
            }
        )
    return enriched


def clean_investigation_location(value: object) -> str:
    location = clean_objective_text(re.sub(r"^[^A-Za-z0-9\u00c0-\u024f]+", "", str(value or "")))
    location = re.sub(r"\u20acrusader\b", "Crusader", location, flags=re.IGNORECASE)
    location = re.sub(r"\bnahe\s*[-\u2013\u2014]\s*Crusader\b", "nahe Crusader", location, flags=re.IGNORECASE)
    return location[:200]


def parse_investigation_mission_details(text: str) -> dict | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    normalized = "\n".join(lines)
    recognized_type = bool(
        re.search(r"NEW\s+HIRE\s*:\s*Locate\s+Missing\s+Person", normalized, re.IGNORECASE)
        or re.search(r"Fallakte\s*:", normalized, re.IGNORECASE)
        and re.search(r"Leitender\s+Ermittler\s*:", normalized, re.IGNORECASE)
        or re.search(r"suchen\s+und\s+Status\s+kl(?:a|\u00e4)ren", normalized, re.IGNORECASE)
    )
    if not recognized_type:
        return None

    subject = ""
    location = ""
    case_number = ""
    lead_investigator = ""
    instructions = ""
    danger_note = ""

    for index, line in enumerate(lines):
        if not line:
            continue

        subject_match = re.search(
            r"([A-Z\u00c0-\u024f][A-Za-z\u00c0-\u024f'\-]+(?:\s+[A-Z\u00c0-\u024f][A-Za-z\u00c0-\u024f'\-]+){1,3})"
            r"\s+suchen\s+und\s+Status\s+kl(?:a|\u00e4)ren",
            line,
        )
        if subject_match:
            subject = clean_objective_text(subject_match.group(1))[:200]
            for candidate in lines[index + 1:index + 3]:
                candidate_location = clean_investigation_location(candidate)
                if not candidate_location or re.search(r"falls\s+tot|hinweis\s*:", candidate_location, re.IGNORECASE):
                    continue
                location = candidate_location
                break

        case_match = re.search(r"Fallakte\s*:\s*(#[A-Z0-9-]+)", line, re.IGNORECASE)
        if case_match:
            case_number = case_match.group(1).upper()[:80]

        lead_match = re.search(r"Leitender\s+Ermittler\s*:\s*(.+)$", line, re.IGNORECASE)
        if lead_match:
            lead_investigator = clean_objective_text(lead_match.group(1))[:200]

        instruction_match = re.search(r"Falls\s+tot\s*:\s*(.+)$", line, re.IGNORECASE)
        if instruction_match:
            instructions = clean_objective_text(instruction_match.group(1))[:1000]

        danger_match = re.search(r"Hinweis\s*:\s*(.+)$", line, re.IGNORECASE)
        if danger_match:
            danger_note = clean_objective_text(danger_match.group(1))[:1000]

    return {
        "type": "investigation",
        "title": "NEW HIRE: Locate Missing Person",
        "pickup": "",
        "routes": [],
        "serviceDetails": {
            "customer": parse_refuel_customer(normalized),
            "location": location,
            "subject": subject,
            "caseNumber": case_number,
            "leadInvestigator": lead_investigator,
            "instructions": instructions,
            "dangerNote": danger_note,
        },
    }


def normalize_procurement_destination(value: object, context: str = "") -> str:
    destination = clean_objective_text(value)
    if re.search(r"Emporium", destination, re.IGNORECASE) and re.search(r"Wikelo", context, re.IGNORECASE):
        return "Beliebiges Wikelo Emporium"
    return destination[:200]


def parse_procurement_items(text: str) -> list[dict]:
    cleaned_lines = []
    for raw_line in str(text or "").splitlines():
        line = clean_objective_text(re.sub(r"^[^A-Za-z0-9\u00c0-\u024f]+", "", raw_line))
        if not line or re.fullmatch(r"PRIM(?:A|Ä)RE\s+ZIELE", line, re.IGNORECASE):
            continue
        cleaned_lines.append(line)
    normalized = "\n".join(cleaned_lines)
    items = []
    for match in PROCUREMENT_OBJECTIVE_PATTERN.finditer(normalized):
        quantity = int(match.group(1))
        name = clean_objective_text(match.group(2))[:200]
        destination = normalize_procurement_destination(match.group(3), normalized)
        if quantity <= 0 or not name or re.match(r"SCU\b", name, re.IGNORECASE):
            continue
        items.append(
            {
                "name": name,
                "quantity": quantity,
                "destination": destination,
            }
        )
    return items


def parse_procurement_mission_details(text: str) -> dict | None:
    normalized = str(text or "").replace("\r", "\n")
    items = parse_procurement_items(normalized)
    recognized_type = bool(
        items
        or re.search(r"ben[oö]tigte\s+Ressourcen.+beschaffen", normalized, re.IGNORECASE | re.DOTALL)
        or re.search(r"Ressourcen\s+zustellen", normalized, re.IGNORECASE)
        or re.search(r"n[uü]tzliche\s+Sachen\s+bringt", normalized, re.IGNORECASE)
    )
    if not recognized_type:
        return None

    detail_locations = extract_details_locations(normalized)
    delivery_match = re.search(
        r"(?:Ressourcen\s+zustellen|resources\s+deliver)\s*:\s*(?:\n\s*)?[^A-Za-z0-9\u00c0-\u024f]*([^\n]+)",
        normalized,
        re.IGNORECASE,
    )
    if delivery_match:
        detailed_location = clean_objective_text(delivery_match.group(1))[:200]
        if detailed_location:
            detail_locations = [detailed_location]
    if re.search(r"Wikelo\s+Emporium", normalized, re.IGNORECASE):
        location = "Beliebiges Wikelo Emporium"
    else:
        location = detail_locations[0] if len(detail_locations) == 1 else ""
    if not location:
        item_destinations = list(dict.fromkeys(item["destination"] for item in items if item["destination"]))
        location = item_destinations[0] if len(item_destinations) == 1 else ""
    if location:
        for item in items:
            item["destination"] = location

    return {
        "type": "procurement",
        "title": "Beschaffungsauftrag",
        "pickup": "",
        "routes": [],
        "serviceDetails": {
            "customer": parse_refuel_customer(normalized),
            "location": location[:200],
            "items": items,
            "instructions": "",
        },
    }


def parse_mining_mission_details(text: str) -> dict | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    normalized = "\n".join(lines)
    recognized_type = bool(
        re.search(r"Suchgebiet\s*:", normalized, re.IGNORECASE)
        and re.search(r"Mineralien\s+liefern|Bergbau-Anbauteil", normalized, re.IGNORECASE)
    )
    if not recognized_type:
        return None

    search_area = ""
    tool = ""
    instructions = ""
    for index, line in enumerate(lines):
        search_match = re.search(r"Suchgebiet\s*:\s*(.+)$", line, re.IGNORECASE)
        if search_match:
            search_area = clean_objective_text(search_match.group(1))[:200]

        tool_match = re.search(r"Empfohlenes\s+Werkzeug\s*:\s*(.+)$", line, re.IGNORECASE)
        if tool_match:
            tool = clean_objective_text(tool_match.group(1))[:300]

        hint_match = re.search(r"Fundort-Hinweise\s*:\s*(.*)$", line, re.IGNORECASE)
        if hint_match:
            hint_parts = [clean_objective_text(hint_match.group(1))]
            for continuation in lines[index + 1:index + 4]:
                if re.search(r"Mineralien\s+liefern|Empfohlenes\s+Werkzeug|Ausschreibung\s*:", continuation, re.IGNORECASE):
                    break
                hint_parts.append(clean_objective_text(continuation))
            instructions = " ".join(part for part in hint_parts if part)[:1000]

    for pattern, replacement in (
        (r"\bk[eé]nnen\b", "können"),
        (r"\bHohlen\b", "Höhlen"),
        (r"\bOberflache\b", "Oberfläche"),
        (r"\bbenotigen\b", "benötigen"),
    ):
        instructions = re.sub(pattern, replacement, instructions, flags=re.IGNORECASE)

    detail_locations = extract_details_locations(normalized)
    location = detail_locations[0] if detail_locations else ""
    return {
        "type": "mining",
        "title": "Bergbauauftrag",
        "pickup": "",
        "routes": [],
        "serviceDetails": {
            "customer": parse_refuel_customer(normalized),
            "location": location[:200],
            "miningMethod": "hand",
            "searchArea": search_area,
            "material": "",
            "targetAmount": None,
            "tool": tool,
            "instructions": instructions,
        },
    }


def parse_refuel_mission_details(text: str) -> dict | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text or "").splitlines()]
    normalized = "\n".join(lines)
    recognized_type = bool(re.search(r"missionstyp\s*:\s*betankung|refuel\s+request", normalized, re.IGNORECASE))
    location = ""
    target_vehicle = ""
    hydrogen_rate = None
    quantum_rate = None
    bonus = ""

    for index, line in enumerate(lines):
        if not line:
            continue
        location_match = re.search(r"einsatzort\s*:\s*(.*)$", line, re.IGNORECASE)
        if location_match:
            location = clean_objective_text(re.sub(r"^[^A-Za-z0-9ÄÖÜäöü]+", "", location_match.group(1)))
            if not location:
                for candidate in lines[index + 1:index + 3]:
                    candidate = clean_objective_text(re.sub(r"^[^A-Za-z0-9ÄÖÜäöü]+", "", candidate))
                    if not candidate or re.search(r"(?:fahrzeug|vergütung|vergutung|compensation)\s*:", candidate, re.IGNORECASE):
                        continue
                    location = candidate
                    break

        target_match = REFUEL_TARGET_PATTERN.search(line)
        if target_match:
            target_vehicle = clean_objective_text(target_match.group(1))[:200]

        rate_match = REFUEL_RATE_PATTERN.search(line)
        if rate_match:
            rate = float(rate_match.group(2).replace(",", "."))
            if rate_match.group(1).lower().startswith("hydrogen"):
                hydrogen_rate = rate
            else:
                quantum_rate = rate

        bonus_match = re.search(r"(?:zus[aä]tzlich|additional(?:ly)?)\s*:\s*(.+)$", line, re.IGNORECASE)
        if bonus_match:
            bonus = clean_objective_text(bonus_match.group(1))[:500]

    if not recognized_type and not (target_vehicle and (hydrogen_rate is not None or quantum_rate is not None)):
        return None

    service_type = (
        "both"
        if hydrogen_rate is not None and quantum_rate is not None
        else "hydrogen"
        if hydrogen_rate is not None
        else "quantum"
        if quantum_rate is not None
        else "both"
    )
    title = f"REFUEL REQUEST: {target_vehicle}" if target_vehicle else "Betankungsauftrag"
    return {
        "type": "refuel",
        "title": title,
        "pickup": "",
        "routes": [],
        "serviceDetails": {
            "customer": parse_refuel_customer(normalized),
            "location": location[:200],
            "serviceType": service_type,
            "hydrogenAmount": None,
            "quantumAmount": None,
            "targetVehicle": target_vehicle,
            "hydrogenRate": hydrogen_rate,
            "quantumRate": quantum_rate,
            "bonus": bonus,
        },
    }


def merge_service_drafts(base: dict, details: dict | None) -> dict:
    if not details:
        return base
    merged = copy.deepcopy(base)
    if not merged.get("title") or merged.get("title") in {
        "Kurierauftrag", "Betankungsauftrag", "Ermittlungsauftrag", "Verwertungsauftrag", "Beschaffungsauftrag", "Bergbauauftrag"
    }:
        merged["title"] = details.get("title") or merged.get("title")
    target = merged.setdefault("serviceDetails", {})
    for key, value in details.get("serviceDetails", {}).items():
        if value not in (None, "", [], {}):
            target[key] = value
        else:
            target.setdefault(key, value)
    if merged.get("type") == "procurement" and target.get("location"):
        for item in target.get("items", []):
            if isinstance(item, dict):
                item["destination"] = target["location"]
    return merged


def build_import_field_quality(draft: dict) -> dict[str, str]:
    """Describe extraction quality without pretending OCR confidence is exact."""
    mission_type = str(draft.get("type") or "cargo").strip().lower()
    details = draft.get("serviceDetails") if isinstance(draft.get("serviceDetails"), dict) else {}
    quality: dict[str, str] = {
        "title": "review" if draft.get("title") else "missing",
        "payout": "verified" if "payout" in draft and draft.get("payout") is not None else "missing",
    }

    def add(path: str, value: object, *, review: bool = False, optional: bool = False) -> None:
        if value not in (None, ""):
            quality[path] = "review" if review else "verified"
        elif not optional:
            quality[path] = "missing"

    if mission_type == "cargo":
        add("serviceDetails.customer", details.get("customer"), optional=True)
    elif mission_type in {"courier", "delivery"}:
        add("serviceDetails.customer", details.get("customer"))
        add("serviceDetails.maxPackageScu", details.get("maxPackageScu"), optional=True)
        add("serviceDetails.instructions", details.get("instructions"), review=True, optional=True)
        if mission_type == "delivery":
            add("serviceDetails.dangerNote", details.get("dangerNote"), review=True, optional=True)
        packages = details.get("packages") if isinstance(details.get("packages"), list) else []
        if not packages:
            quality["serviceDetails.packages"] = "missing"
        for index, package in enumerate(packages):
            if not isinstance(package, dict):
                continue
            add(f"serviceDetails.packages.{index}.quantity", package.get("quantity"))
            add(f"serviceDetails.packages.{index}.name", package.get("name"), review=True)
            add(f"serviceDetails.packages.{index}.pickup", package.get("pickup"), review=True)
            add(f"serviceDetails.packages.{index}.destination", package.get("destination"), review=True)
            if mission_type == "delivery":
                add(f"serviceDetails.packages.{index}.containerScu", package.get("containerScu"), optional=True)
    elif mission_type == "refuel":
        add("serviceDetails.customer", details.get("customer"))
        add("serviceDetails.location", details.get("location"), review=True)
        target_vehicle = str(details.get("targetVehicle") or "").strip()
        title_key = re.sub(r"[^a-z0-9]+", "", str(draft.get("title") or "").casefold())
        target_key = re.sub(r"[^a-z0-9]+", "", target_vehicle.casefold())
        add(
            "serviceDetails.targetVehicle",
            target_vehicle,
            review=not bool(target_key and target_key in title_key),
        )
        add("serviceDetails.hydrogenRate", details.get("hydrogenRate"), optional=True)
        add("serviceDetails.quantumRate", details.get("quantumRate"), optional=True)
        add("serviceDetails.bonus", details.get("bonus"), review=True, optional=True)
    elif mission_type == "investigation":
        add("serviceDetails.customer", details.get("customer"))
        add("serviceDetails.location", details.get("location"), review=True)
        add("serviceDetails.subject", details.get("subject"), review=True)
        add("serviceDetails.caseNumber", details.get("caseNumber"), optional=True)
        add("serviceDetails.leadInvestigator", details.get("leadInvestigator"), review=True, optional=True)
        add("serviceDetails.instructions", details.get("instructions"), review=True, optional=True)
        add("serviceDetails.dangerNote", details.get("dangerNote"), review=True, optional=True)
    elif mission_type == "salvage":
        add("serviceDetails.customer", details.get("customer"))
        add("serviceDetails.location", details.get("location"), review=True, optional=True)
        add("serviceDetails.salvageTarget", details.get("salvageTarget"), review=True)
        add("serviceDetails.claimNumber", details.get("claimNumber"), optional=True)
        add("serviceDetails.instructions", details.get("instructions"), review=True, optional=True)
    elif mission_type == "procurement":
        add("serviceDetails.customer", details.get("customer"))
        add("serviceDetails.location", details.get("location"), review=True)
        items = details.get("items") if isinstance(details.get("items"), list) else []
        if not items:
            quality["serviceDetails.items"] = "missing"
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            add(f"serviceDetails.items.{index}.quantity", item.get("quantity"))
            add(f"serviceDetails.items.{index}.name", item.get("name"), review=True)
            add(f"serviceDetails.items.{index}.destination", item.get("destination"), review=True)
    elif mission_type == "mining":
        add("serviceDetails.customer", details.get("customer"))
        add("serviceDetails.location", details.get("location"), review=True)
        add("serviceDetails.miningMethod", details.get("miningMethod"))
        add("serviceDetails.searchArea", details.get("searchArea"), review=True)
        add("serviceDetails.material", details.get("material"), review=True, optional=True)
        add("serviceDetails.targetAmount", details.get("targetAmount"), optional=True)
        add("serviceDetails.tool", details.get("tool"), review=True, optional=True)
        add("serviceDetails.instructions", details.get("instructions"), review=True, optional=True)

    return quality


def parse_mission_objectives(text: str) -> dict | None:
    normalized = str(text or "").replace("\r", "\n")
    normalized = re.sub(r"[\u25c7\u25c6\u25c8]", "\n", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    courier_draft = parse_courier_mission_details(normalized)
    if courier_draft:
        return courier_draft
    refuel_draft = parse_refuel_mission_details(normalized)
    if refuel_draft:
        return refuel_draft
    procurement_draft = parse_procurement_mission_details(normalized)
    if procurement_draft:
        return procurement_draft
    mining_draft = parse_mining_mission_details(normalized)
    if mining_draft:
        return mining_draft
    investigation_draft = parse_investigation_mission_details(normalized)
    if investigation_draft:
        return investigation_draft
    salvage_draft = parse_salvage_mission_details(normalized)
    if salvage_draft:
        return salvage_draft
    german_draft = parse_german_mission_objectives(normalized)
    if german_draft:
        return german_draft
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
    for raw_line in str(text or "").splitlines():
        match = DETAIL_LOCATION_PATTERN.match(raw_line)
        if not match:
            continue
        location = clean_objective_text(match.group(1))
        key = location.casefold()
        if len(location) < 3 or key in seen:
            continue
        seen.add(key)
        locations.append(location)
    return locations


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
            r"(?i)L[Ss](?=\s*-\s*Lagrangepunkt)",
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
    """Return the OCR runtime shipped with the Windows Companion, if present."""
    roots: list[Path] = []
    if getattr(sys, "frozen", False):
        roots.append(Path(sys.executable).resolve().parent)
        bundle_root = getattr(sys, "_MEIPASS", "")
        if bundle_root:
            roots.append(Path(bundle_root))
    else:
        roots.append(Path(__file__).resolve().parents[1] / "runtime")

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
        **companion_capture.hidden_subprocess_options(),
    )
    if result.returncode != 0:
        details = result.stderr.strip() or f"exit code {result.returncode}"
        raise RuntimeError(f"OCR failed: {details}")
    return result.stdout


def prepare_ocr_crop(image_path: Path, region: str) -> Path | None:
    if os.name != "nt" or image_path.suffix.lower() != ".png":
        return None
    script_path = Path(__file__).resolve().parent / "scripts" / "prepare-ocr-image.ps1"
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
        **companion_capture.hidden_subprocess_options(),
    )
    if result.returncode != 0 or not temporary_path.is_file():
        temporary_path.unlink(missing_ok=True)
        return None
    return temporary_path


def prepare_objectives_crop(image_path: Path) -> Path | None:
    return prepare_ocr_crop(image_path, "Objectives")


def prepare_details_crop(image_path: Path) -> Path | None:
    return prepare_ocr_crop(image_path, "Details")


def prepare_reward_crop(image_path: Path) -> Path | None:
    return prepare_ocr_crop(image_path, "Reward")


def prepare_title_crop(image_path: Path) -> Path | None:
    return prepare_ocr_crop(image_path, "Title")


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_signature(path: Path) -> str:
    stats = path.stat()
    source = f"{path.resolve()}|{stats.st_size}|{stats.st_mtime_ns}".encode("utf-8")
    return hashlib.sha256(source).hexdigest()


def default_state_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "share")
    return base / "CitizenToolsSolo" / "companion-state.json"


class CompanionState:
    def __init__(self, path: Path):
        self.path = path
        self.existed = path.is_file()
        self.processed: list[str] = []
        if self.existed:
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                stored_version = int(payload.get("parserVersion") or 0)
                if stored_version >= PARSER_VERSION:
                    self.processed = [str(value) for value in payload.get("processed", [])][-MAX_PROCESSED_SIGNATURES:]
            except (OSError, json.JSONDecodeError, AttributeError, TypeError, ValueError):
                self.processed = []
        self._processed_set = set(self.processed)

    def contains(self, signature: str) -> bool:
        return signature in self._processed_set

    def mark(self, signature: str) -> None:
        if signature in self._processed_set:
            return
        self.processed.append(signature)
        self._processed_set.add(signature)
        if len(self.processed) > MAX_PROCESSED_SIGNATURES:
            removed = self.processed[:-MAX_PROCESSED_SIGNATURES]
            self.processed = self.processed[-MAX_PROCESSED_SIGNATURES:]
            self._processed_set.difference_update(removed)
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"parserVersion": PARSER_VERSION, "processed": self.processed}, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    def clear(self) -> None:
        self.processed = []
        self._processed_set.clear()
        self.save()


def list_screenshots(folder: Path) -> list[Path]:
    return sorted(
        (
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ),
        key=lambda path: path.stat().st_mtime_ns,
    )


def list_screenshots_from_folders(folders: list[Path]) -> list[Path]:
    screenshots = []
    for folder in folders:
        screenshots.extend(list_screenshots(folder))
    return sorted(screenshots, key=lambda path: path.stat().st_mtime_ns)


def online_application_base_url(server_url: str) -> str:
    """Return the PHP application root for a web-app or operations-preview URL."""
    parsed = parse.urlsplit(str(server_url or "").strip())
    path = parsed.path.rstrip("/")
    for suffix in ("/operations-preview/index.php", "/operations-preview"):
        if path.endswith(suffix):
            path = path[: -len(suffix)]
            break
    return parse.urlunsplit((parsed.scheme, parsed.netloc, path.rstrip("/"), "", ""))


def parse_release_version(value: object) -> tuple[int, int, int] | None:
    match = re.fullmatch(r"\s*(\d+)\.(\d+)\.(\d+)\s*", str(value or ""))
    if not match:
        return None
    return tuple(int(part) for part in match.groups())


def companion_release_url(server_url: str) -> str:
    return f"{online_application_base_url(server_url)}/downloads/companion-release.json"


def check_companion_update(server_url: str, current_version: str) -> dict | None:
    """Return a newer same-origin Companion release, or None when none is available."""
    installed = parse_release_version(current_version)
    if installed is None:
        return None
    manifest_url = companion_release_url(server_url)
    release_request = request.Request(
        manifest_url,
        headers={"Accept": "application/json", "Cache-Control": "no-cache", "User-Agent": USER_AGENT},
    )
    try:
        with request.urlopen(release_request, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (error.HTTPError, error.URLError, OSError, UnicodeDecodeError, json.JSONDecodeError):
        return None

    available = parse_release_version(payload.get("version") if isinstance(payload, dict) else None)
    installer = payload.get("installer") if isinstance(payload, dict) else None
    if available is None or available <= installed or not isinstance(installer, dict):
        return None
    download_value = str(installer.get("url") or "").strip()
    download_url = parse.urljoin(manifest_url, download_value)
    manifest_parts = parse.urlsplit(manifest_url)
    download_parts = parse.urlsplit(download_url)
    if (
        download_parts.scheme not in {"http", "https"}
        or download_parts.scheme != manifest_parts.scheme
        or download_parts.netloc != manifest_parts.netloc
    ):
        return None
    return {
        "version": ".".join(str(part) for part in available),
        "downloadUrl": download_url,
        "publishedAt": str(payload.get("publishedAt") or ""),
    }


def online_api_urls(server_url: str, endpoint: str) -> list[str]:
    """Use the short API URL first, then the PHP query-route fallback."""
    base_url = online_application_base_url(server_url)
    endpoint_parts = parse.urlsplit(endpoint)
    direct_url = f"{base_url}{endpoint}"
    route = parse.quote(endpoint_parts.path or "/", safe="")
    query = f"&{endpoint_parts.query}" if endpoint_parts.query else ""
    fallback_url = f"{base_url}/index.php?route={route}{query}"
    return [direct_url, fallback_url]


def open_online_api_request(
    server_url: str,
    endpoint: str,
    *,
    data: bytes | None = None,
    headers: dict | None = None,
    method: str = "GET",
    timeout: int = 15,
) -> dict:
    """Read a JSON API response, retrying through index.php when rewrites are unavailable."""
    urls = online_api_urls(server_url, endpoint)
    for index, api_url in enumerate(urls):
        api_request = request.Request(api_url, data=data, headers=headers or {}, method=method)
        try:
            with request.urlopen(api_request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except error.HTTPError as http_error:
            if http_error.code == 404 and index + 1 < len(urls):
                continue
            raise
    raise RuntimeError("Companion-API konnte nicht erreicht werden.")


def add_online_companion_authorization(headers: dict, token: str) -> None:
    """Send the browser-paired token through a hoster-safe fallback header too."""
    headers["Authorization"] = f"Bearer {token}"
    headers["X-Citizen-Companion-Token"] = token


def submit_import(server_url: str, token: str, payload: dict, user_token: str = "") -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    online_token = str(token or "").startswith(ONLINE_COMPANION_TOKEN_PREFIX)
    request_payload = dict(payload)
    if online_token:
        add_online_companion_authorization(headers, token)
        # Browser-paired servers receive personal imports. Sharing happens in the web app.
        request_payload["scope"] = "solo"
    elif token:
        headers["X-Import-Token"] = token
    if user_token:
        headers["X-Citizen-Token"] = user_token
    body = json.dumps(request_payload, ensure_ascii=False).encode("utf-8")
    try:
        return open_online_api_request(
            server_url,
            "/api/imports",
            data=body,
            headers=headers,
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError(
                "Companion-API nicht gefunden. Den konfigurierten Server aktualisieren und neu starten."
            ) from http_error
        if http_error.code == 401:
            raise RuntimeError("Der Server hat den Companion-Zugang abgelehnt. Bitte die Verbindung erneut herstellen.") from http_error
        response_body = http_error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(response_body).get("message") or response_body
        except json.JSONDecodeError:
            message = response_body
        raise RuntimeError(f"Server rejected import ({http_error.code}): {message}") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def submit_import_progress(
    server_url: str,
    token: str,
    user_token: str = "",
    *,
    job_id: str,
    scope: str,
    device_id: str,
    device_name: str,
    status: str,
    source_file: str = "",
    message: str = "",
    queue_position: int = 0,
    import_id: str = "",
) -> dict:
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    online_token = str(token or "").startswith(ONLINE_COMPANION_TOKEN_PREFIX)
    if online_token:
        add_online_companion_authorization(headers, token)
        scope = "solo"
    elif token:
        headers["X-Import-Token"] = token
    if user_token:
        headers["X-Citizen-Token"] = user_token
    body = json.dumps(
        {
            "jobId": job_id,
            "scope": scope,
            "deviceId": device_id,
            "deviceName": device_name,
            "status": status,
            "sourceFile": source_file,
            "message": message,
            "queuePosition": queue_position,
            "importId": import_id,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    try:
        return open_online_api_request(
            server_url,
            "/api/imports/progress",
            data=body,
            headers=headers,
            method="POST",
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 401:
            raise RuntimeError("Der Server hat den Companion-Zugang abgelehnt. Bitte die Verbindung erneut herstellen.") from http_error
        if http_error.code == 404:
            raise RuntimeError("Die Fortschrittsanzeige benötigt einen aktualisierten Server.") from http_error
        raise RuntimeError(f"Server rejected import progress ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def reset_server_imports(server_url: str, token: str, scope: str, device_id: str) -> dict:
    body = json.dumps({"scope": scope, "deviceId": device_id}).encode("utf-8")
    headers = {"Content-Type": "application/json", "User-Agent": USER_AGENT}
    if token:
        headers["X-Import-Token"] = token
    try:
        return open_online_api_request(
            server_url,
            "/api/imports/reset",
            data=body,
            headers=headers,
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError(
                "Reset-API nicht gefunden. Den konfigurierten Server aktualisieren und neu starten."
            ) from http_error
        if http_error.code == 401:
            raise RuntimeError("Der Server hat das Import-Token abgelehnt.") from http_error
        response_body = http_error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(response_body).get("message") or response_body
        except json.JSONDecodeError:
            message = response_body
        raise RuntimeError(f"Server rejected reset ({http_error.code}): {message}") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def start_online_companion_pairing(server_url: str, device_name: str) -> dict:
    body = json.dumps({"deviceName": str(device_name or "Companion").strip() or "Companion"}).encode("utf-8")
    try:
        payload = open_online_api_request(
            server_url,
            "/api/companion/pairings",
            data=body,
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError("Dieser Server unterstützt noch keine Companion-Kopplung.") from http_error
        raise RuntimeError(f"Kopplung konnte nicht gestartet werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error

    pairing_id = str(payload.get("pairingId") or "").strip()
    poll_token = str(payload.get("pollToken") or "").strip()
    authorize_path = str(payload.get("authorizePath") or "").strip()
    if not pairing_id or not poll_token or not authorize_path.startswith("/"):
        raise RuntimeError("Der Server hat eine unvollständige Kopplungsanfrage geliefert.")
    return {
        "pairing_id": pairing_id,
        "poll_token": poll_token,
        "authorize_url": f"{online_application_base_url(server_url)}{authorize_path}",
        "expires_at": str(payload.get("expiresAt") or ""),
    }


def get_companion_capabilities(server_url: str) -> dict:
    try:
        payload = open_online_api_request(
            server_url,
            "/api/companion/capabilities",
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 404:
            raise RuntimeError("Dieser Citizen-Tools-Server unterstützt die automatische Companion-Erkennung noch nicht.") from http_error
        raise RuntimeError(f"Serverfähigkeiten konnten nicht gelesen werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error
    authentication = str(payload.get("authentication") or "").strip().lower()
    if not payload.get("ok") or authentication not in {"none", "token", "browser_pairing"}:
        raise RuntimeError("Der Server hat ungültige Companion-Fähigkeiten geliefert.")
    return payload


def get_online_companion_pairing(server_url: str, pairing_id: str, poll_token: str) -> dict:
    query = parse.urlencode({"pollToken": poll_token})
    try:
        return open_online_api_request(
            server_url,
            f"/api/companion/pairings/{parse.quote(pairing_id, safe='')}?{query}",
            headers={"User-Agent": USER_AGENT},
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 410:
            raise RuntimeError("Die Kopplungsanfrage ist abgelaufen. Bitte erneut starten.") from http_error
        raise RuntimeError(f"Kopplungsstatus konnte nicht geprüft werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error


def exchange_online_companion_pairing(server_url: str, pairing_id: str, poll_token: str) -> dict:
    try:
        payload = open_online_api_request(
            server_url,
            f"/api/companion/pairings/{parse.quote(pairing_id, safe='')}/exchange",
            data=json.dumps({"pollToken": poll_token}).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": USER_AGENT},
            method="POST",
        )
    except error.HTTPError as http_error:
        if http_error.code == 409:
            raise RuntimeError("Die Kopplung wurde noch nicht freigegeben oder bereits verwendet.") from http_error
        raise RuntimeError(f"Kopplung konnte nicht abgeschlossen werden ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error
    token = str(payload.get("token") or "").strip()
    if not token.startswith(ONLINE_COMPANION_TOKEN_PREFIX):
        raise RuntimeError("Der Server hat keinen gültigen Companion-Token geliefert.")
    return payload


def check_server_connection(
    server_url: str,
    token: str,
    *,
    scope: str = "solo",
    user_token: str = "",
) -> dict:
    headers = {"User-Agent": USER_AGENT}
    online_connection = token.startswith(ONLINE_COMPANION_TOKEN_PREFIX)
    # A browser-paired server is reachable before the Companion owns a token.
    # Detect that path first so the UI can offer pairing instead of a legacy ping error.
    if not online_connection and scope != "dispatcher":
        try:
            capabilities = get_companion_capabilities(server_url)
        except RuntimeError:
            capabilities = {}
        authentication = str(capabilities.get("authentication") or "").strip().lower()
        if authentication in {"none", "browser_pairing"}:
            return capabilities
    if online_connection:
        add_online_companion_authorization(headers, token)
    if token:
        if not online_connection:
            headers["X-Import-Token"] = token
    if user_token:
        headers["X-Citizen-Token"] = user_token
    organization_scope = scope == "dispatcher"
    endpoint = "/api/companion/status" if online_connection else (
        "/api/auth/dispatcher/status" if organization_scope else "/api/imports/ping"
    )
    try:
        payload = open_online_api_request(
            server_url,
            endpoint,
            headers=headers,
            timeout=10,
        )
    except error.HTTPError as http_error:
        if http_error.code == 401:
            if online_connection:
                raise RuntimeError("Der Online-Companion-Token wurde abgelehnt oder widerrufen.") from http_error
            raise RuntimeError(
                "Der Server hat den Organisations-Token abgelehnt."
                if organization_scope
                else "Der Server hat das Import-Token abgelehnt."
            ) from http_error
        if http_error.code == 404:
            raise RuntimeError(
                "Companion-API nicht gefunden. Den konfigurierten Server aktualisieren und neu starten."
            ) from http_error
        raise RuntimeError(f"Server check failed ({http_error.code}).") from http_error
    except error.URLError as url_error:
        raise RuntimeError(f"Server unavailable: {url_error.reason}") from url_error
    if not payload.get("ok"):
        raise RuntimeError("Server check failed.")
    if organization_scope and payload.get("enabled") and not payload.get("identity"):
        raise RuntimeError("Der persönliche Organisations-Token ist ungültig oder wurde gesperrt.")
    return payload


def build_import_payload(args: argparse.Namespace, image_path: Path, draft: dict) -> dict:
    captured_at = datetime.fromtimestamp(image_path.stat().st_mtime, tz=timezone.utc).isoformat()
    return {
        "scope": args.scope,
        "deviceId": args.device_id,
        "deviceName": args.device_name,
        "pilotName": str(getattr(args, "pilot_name", "") or "").strip(),
        "imageHash": hash_file(image_path),
        "capturedAt": captured_at,
        "sourceFile": image_path.name,
        "draft": draft,
    }


def read_mission_screenshot(
    tesseract_path: str,
    image_path: Path,
    emit=None,
) -> tuple[dict | None, Exception | None]:
    if emit is None:
        emit = lambda message, is_error=False: print(
            message,
            file=sys.stderr if is_error else sys.stdout,
            flush=True,
        )
    objectives_crop_path = None
    details_crop_path = None
    reward_crop_path = None
    title_crop_path = None
    draft = None
    details_text = ""
    last_ocr_error = None

    try:
        try:
            objectives_crop_path = prepare_objectives_crop(image_path)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as preparation_error:
            last_ocr_error = preparation_error

        try:
            details_crop_path = prepare_details_crop(image_path)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as details_preparation_error:
            emit(f"Details crop skipped: {details_preparation_error}", True)

        try:
            reward_crop_path = prepare_reward_crop(image_path)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as reward_preparation_error:
            emit(f"Reward crop skipped: {reward_preparation_error}", True)

        try:
            title_crop_path = prepare_title_crop(image_path)
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as title_preparation_error:
            emit(f"Title crop skipped: {title_preparation_error}", True)

        if objectives_crop_path:
            try:
                text = run_ocr(tesseract_path, objectives_crop_path)
                draft = parse_mission_objectives(text)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as ocr_error:
                last_ocr_error = ocr_error

        if details_crop_path:
            try:
                details_text = run_ocr(tesseract_path, details_crop_path)
                if not draft:
                    draft = (
                        parse_courier_mission_details(details_text)
                        or parse_refuel_mission_details(details_text)
                        or parse_investigation_mission_details(details_text)
                        or parse_salvage_mission_details(details_text)
                        or parse_procurement_mission_details(details_text)
                        or parse_mining_mission_details(details_text)
                    )
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as details_error:
                emit(f"Details OCR skipped: {details_error}", True)

        if not draft:
            try:
                text = run_ocr(tesseract_path, image_path)
                draft = parse_mission_objectives(text)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as ocr_error:
                last_ocr_error = ocr_error

        if draft and details_text:
            draft = enrich_delivery_mission(draft, details_text)
            if draft.get("type") == "delivery":
                pass
            elif draft.get("type") == "courier":
                courier_details = draft.setdefault("serviceDetails", {})
                max_package_scu = parse_max_package_scu(details_text)
                if max_package_scu is not None:
                    courier_details["maxPackageScu"] = max_package_scu
                    emit(f"Recognized maximum package size: {max_package_scu:g} SCU.")
                requirement_match = re.search(
                    r"Anforderung\s*:\s*(.+)$",
                    details_text,
                    re.IGNORECASE | re.MULTILINE,
                )
                if requirement_match:
                    courier_details["instructions"] = clean_objective_text(requirement_match.group(1))[:1000]
            elif draft.get("type") == "refuel":
                draft = merge_service_drafts(draft, parse_refuel_mission_details(details_text))
            elif draft.get("type") == "investigation":
                draft = merge_service_drafts(draft, parse_investigation_mission_details(details_text))
            elif draft.get("type") == "salvage":
                draft = merge_service_drafts(draft, parse_salvage_mission_details(details_text))
            elif draft.get("type") == "procurement":
                draft = merge_service_drafts(draft, parse_procurement_mission_details(details_text))
            elif draft.get("type") == "mining":
                draft = merge_service_drafts(draft, parse_mining_mission_details(details_text))
            else:
                draft, cross_check = reconcile_draft_locations(draft, details_text)
                max_container_scu = parse_max_container_scu(details_text)
                if max_container_scu is not None:
                    draft["maxContainerScu"] = max_container_scu
                    emit(f"Recognized maximum container size: {max_container_scu} SCU.")
                if cross_check["matched"]:
                    emit(
                        "Cross-checked "
                        f"{cross_check['matched']} location(s) in the details panel"
                        f"; corrected {cross_check['corrected']}."
                    )

        if draft and title_crop_path:
            try:
                title_text = run_ocr(tesseract_path, title_crop_path)
                draft = apply_mission_title(draft, title_text)
                draft = enrich_delivery_mission(draft, details_text)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as title_error:
                emit(f"Title OCR skipped: {title_error}", True)

        if draft and reward_crop_path:
            try:
                reward_text = run_ocr(tesseract_path, reward_crop_path)
                payout = parse_reward_amount(reward_text)
                if payout is not None:
                    draft["payout"] = payout
                    emit(f"Recognized reward: {payout:,} aUEC.")
                customer = parse_refuel_customer(reward_text)
                if customer:
                    if (
                        draft.get("type") == "delivery"
                        and re.search(r"Retrieval\s+Run", str(draft.get("title") or ""), re.IGNORECASE)
                        and not re.search(r"courier", customer, re.IGNORECASE)
                    ):
                        customer = "FTL-Courier"
                    draft.setdefault("serviceDetails", {})["customer"] = customer
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as reward_error:
                emit(f"Reward OCR skipped: {reward_error}", True)

        if draft:
            draft["fieldQuality"] = build_import_field_quality(draft)
    finally:
        for temporary_path in (objectives_crop_path, details_crop_path, reward_crop_path, title_crop_path):
            if temporary_path:
                temporary_path.unlink(missing_ok=True)

    return draft, last_ocr_error


def process_screenshot(
    args: argparse.Namespace,
    state: CompanionState,
    tesseract_path: str,
    image_path: Path,
    emit,
    job_id: str = "",
    report_progress=None,
) -> None:
    signature = file_signature(image_path)
    if state.contains(signature):
        return
    if time.time() - image_path.stat().st_mtime < args.settle_seconds:
        return

    emit(f"Reading {image_path.name} ...")
    if job_id and report_progress:
        report_progress(
            job_id,
            "processing",
            source_file=image_path.name,
            message="Texterkennung läuft",
        )
    draft, last_ocr_error = read_mission_screenshot(tesseract_path, image_path, emit)

    if not draft:
        if last_ocr_error:
            emit(f"OCR error: {last_ocr_error}", True)
        emit("No supported contract recognized.")
        if job_id and report_progress:
            report_progress(
                job_id,
                "failed",
                source_file=image_path.name,
                message="Kein unterstützter Auftrag erkannt",
            )
        state.mark(signature)
        return

    payload = build_import_payload(args, image_path, draft)
    try:
        result = submit_import(args.server, args.token, payload, user_token=getattr(args, "user_token", ""))
    except RuntimeError as submit_error:
        emit(str(submit_error), True)
        if job_id and report_progress:
            report_progress(
                job_id,
                "failed",
                source_file=image_path.name,
                message="Übertragung zum Server fehlgeschlagen",
            )
        return

    duplicate_note = " (already known)" if result.get("duplicate") else ""
    target_scope = str(result.get("scope") or args.scope)
    emit(f"Sent to {target_scope} import inbox{duplicate_note}.")
    if job_id and report_progress:
        report_progress(
            job_id,
            "completed",
            source_file=image_path.name,
            message="Auftrag erkannt und übertragen",
            import_id=str(result.get("id") or ""),
        )
    state.mark(signature)


def console_emit(message: str, is_error: bool = False) -> None:
    print(message, file=sys.stderr if is_error else sys.stdout, flush=True)


def run_companion(args: argparse.Namespace, stop_event=None, emit=console_emit) -> int:
    screenshots_value = getattr(args, "screenshots", None)
    args.screenshots = Path(screenshots_value).expanduser().resolve() if screenshots_value else None
    capture_folder_value = getattr(args, "capture_folder", None) or companion_capture.default_capture_folder()
    args.capture_folder = Path(capture_folder_value).expanduser().resolve()
    args.capture_retention = companion_capture.normalize_capture_retention(
        getattr(args, "capture_retention", companion_capture.DEFAULT_CAPTURE_RETENTION)
    )
    args.state_file = Path(args.state_file).expanduser().resolve()
    if not str(args.server).startswith(("http://", "https://")):
        raise ValueError("Server URL must start with http:// or https://")
    args.capture_folder.mkdir(parents=True, exist_ok=True)
    if args.screenshots and not args.screenshots.is_dir():
        raise ValueError(f"Screenshot folder not found: {args.screenshots}")
    watch_folders = []
    for folder in (args.screenshots, args.capture_folder):
        if folder and folder not in watch_folders:
            watch_folders.append(folder)

    tesseract_path = resolve_tesseract(args.tesseract)
    if not tesseract_path:
        raise ValueError("Tesseract OCR was not found. Install it locally or choose its executable.")

    emit("Checking server connection ...")
    check_server_connection(
        args.server,
        args.token,
        scope=args.scope,
        user_token=getattr(args, "user_token", ""),
    )
    emit("Server connection ready.")

    capture_requests: queue.Queue = queue.Queue(maxsize=MAX_CAPTURE_QUEUE)
    progress_requests: queue.Queue = queue.Queue(maxsize=MAX_CAPTURE_QUEUE * 8)
    capture_jobs_by_path: dict[str, str] = {}
    capture_jobs_lock = threading.Lock()
    capture_worker_stop = threading.Event()
    progress_worker_stop = threading.Event()
    progress_warning_emitted = False
    progress_queue_warning_emitted = False

    def report_capture_progress(job_id: str, status: str, **details) -> None:
        nonlocal progress_queue_warning_emitted
        update = {
            "job_id": job_id,
            "status": status,
            "details": details,
        }
        try:
            progress_requests.put_nowait(update)
        except queue.Full:
            if not progress_queue_warning_emitted:
                progress_queue_warning_emitted = True
                emit("Fortschrittswarteschlange voll · Statusanzeige kann verzögert sein", True)

    def run_progress_worker() -> None:
        nonlocal progress_warning_emitted
        while not progress_worker_stop.is_set() or not progress_requests.empty():
            try:
                update = progress_requests.get(timeout=0.25)
            except queue.Empty:
                continue
            details = update["details"]
            try:
                submit_import_progress(
                    args.server,
                    args.token,
                    user_token=getattr(args, "user_token", ""),
                    job_id=update["job_id"],
                    scope=args.scope,
                    device_id=args.device_id,
                    device_name=args.device_name,
                    status=update["status"],
                    source_file=str(details.get("source_file") or ""),
                    message=str(details.get("message") or ""),
                    queue_position=int(details.get("queue_position") or 0),
                    import_id=str(details.get("import_id") or ""),
                )
            except RuntimeError as progress_error:
                if not progress_warning_emitted:
                    progress_warning_emitted = True
                    emit(f"Fortschrittsanzeige nicht erreichbar: {progress_error}")
            finally:
                progress_requests.task_done()

    def capture_from_hotkey() -> None:
        job = {"id": str(uuid.uuid4()), "requestedAt": time.time()}
        try:
            capture_requests.put_nowait(job)
            report_capture_progress(
                job["id"],
                "queued",
                message="Aufnahme angefordert · Screenshot wird erstellt",
                queue_position=capture_requests.qsize(),
            )
            emit(f"Screenshot eingereiht · {capture_requests.qsize()} Aufnahme(n) warten")
        except queue.Full:
            emit(f"Aufnahmewarteschlange voll · maximal {MAX_CAPTURE_QUEUE} Screenshots", True)

    def run_capture_worker() -> None:
        while not capture_worker_stop.is_set():
            try:
                job = capture_requests.get(timeout=0.25)
            except queue.Empty:
                continue
            job_id = str(job.get("id") or "")
            try:
                output_path = companion_capture.capture_screen(
                    args.capture_folder,
                    getattr(args, "capture_mode", "active-monitor"),
                )
                with capture_jobs_lock:
                    capture_jobs_by_path[str(output_path.resolve())] = job_id
                report_capture_progress(
                    job_id,
                    "queued",
                    source_file=output_path.name,
                    message="Screenshot eingegangen · wartet auf Texterkennung",
                    queue_position=capture_requests.qsize() + 1,
                )
                emit(f"Screenshot erstellt: {output_path.name}")
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as capture_error:
                report_capture_progress(job_id, "failed", message="Screenshot konnte nicht erstellt werden")
                emit(str(capture_error), True)
            finally:
                capture_requests.task_done()

    progress_thread = threading.Thread(
        target=run_progress_worker,
        name="CitizenToolsProgressQueue",
        daemon=True,
    )
    capture_thread = threading.Thread(
        target=run_capture_worker,
        name="CitizenToolsCaptureQueue",
        daemon=True,
    )
    progress_thread.start()
    capture_thread.start()

    hotkey_listener = companion_capture.GlobalHotkeyListener(
        getattr(args, "capture_hotkey", companion_capture.DEFAULT_HOTKEY),
        capture_from_hotkey,
        getattr(args, "hotkey_recording_gate", None),
    )
    hotkey_started = False
    try:
        hotkey_listener.start()
        hotkey_started = True
        if hotkey_listener.registration_warning:
            emit(hotkey_listener.registration_warning)

        state = CompanionState(args.state_file)

        def capture_was_processed(path: Path) -> bool:
            try:
                return state.contains(file_signature(path))
            except OSError:
                return False

        existing = list_screenshots_from_folders(watch_folders)
        if not state.existed and not args.include_existing and not args.once:
            for image_path in existing:
                state.mark(file_signature(image_path))
            emit(f"Watching for new screenshots. Ignored {len(existing)} existing file(s).")
        for folder in watch_folders:
            emit(f"Watching {folder}")
        emit(f"Capture hotkey: {hotkey_listener.hotkey} | Target: {args.capture_folder}")
        pilot_note = f" | Pilot: {args.pilot_name}" if getattr(args, "pilot_name", "") else ""
        emit(f"Server: {args.server.rstrip('/')} | Inbox: {args.scope} | Device: {args.device_name}{pilot_note}")

        while stop_event is None or not stop_event.is_set():
            for image_path in list_screenshots_from_folders(watch_folders):
                if stop_event is not None and stop_event.is_set():
                    break
                path_key = str(image_path.resolve())
                with capture_jobs_lock:
                    job_id = capture_jobs_by_path.get(path_key, "")
                process_screenshot(
                    args,
                    state,
                    tesseract_path,
                    image_path,
                    emit,
                    job_id=job_id,
                    report_progress=report_capture_progress,
                )
                try:
                    processed = state.contains(file_signature(image_path))
                except OSError:
                    processed = False
                if processed and job_id:
                    with capture_jobs_lock:
                        capture_jobs_by_path.pop(path_key, None)
            deleted_captures = companion_capture.prune_managed_captures(
                args.capture_folder,
                args.capture_retention,
                can_delete=capture_was_processed,
            )
            if deleted_captures:
                emit(f"Removed {len(deleted_captures)} old Companion screenshot(s).")
            if args.once:
                break
            delay = max(0.5, args.interval)
            if stop_event is None:
                time.sleep(delay)
            elif stop_event.wait(delay):
                break
    finally:
        if hotkey_started:
            hotkey_listener.stop()
        capture_worker_stop.set()
        capture_thread.join(timeout=5)
        progress_worker_stop.set()
        progress_thread.join(timeout=5)
    emit("Companion stopped.")
    return 0


def create_argument_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Citizen Tools local Star Citizen screenshot companion")
    parser.add_argument("--server", default=os.environ.get("CITIZEN_TOOLS_SERVER", "http://127.0.0.1:4173"))
    parser.add_argument("--token", default=os.environ.get("CARGO_PLANNER_IMPORT_TOKEN", ""))
    parser.add_argument("--user-token", default=os.environ.get("CITIZEN_TOOLS_USER_TOKEN", ""))
    parser.add_argument("--screenshots", type=Path)
    parser.add_argument("--capture-folder", type=Path, default=companion_capture.default_capture_folder())
    parser.add_argument("--capture-hotkey", default=companion_capture.DEFAULT_HOTKEY)
    parser.add_argument("--capture-mode", choices=("active-monitor", "virtual-desktop"), default="active-monitor")
    parser.add_argument("--capture-retention", type=int, default=companion_capture.DEFAULT_CAPTURE_RETENTION)
    parser.add_argument("--scope", choices=("solo", "dispatcher"), default="solo")
    parser.add_argument("--pilot-name", default=os.environ.get("CITIZEN_TOOLS_PILOT", ""))
    parser.add_argument("--device-id", default=socket.gethostname())
    parser.add_argument("--device-name", default=socket.gethostname())
    parser.add_argument("--tesseract", default=os.environ.get("TESSERACT_CMD"))
    parser.add_argument("--state-file", type=Path, default=default_state_path())
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--settle-seconds", type=float, default=2.0)
    parser.add_argument("--include-existing", action="store_true")
    parser.add_argument("--once", action="store_true")
    return parser


def main() -> int:
    parser = create_argument_parser()
    args = parser.parse_args()
    try:
        return run_companion(args)
    except ValueError as configuration_error:
        parser.error(str(configuration_error))
    except KeyboardInterrupt:
        console_emit("Companion stopped.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
