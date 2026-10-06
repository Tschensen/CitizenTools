"""Refuel, investigation, salvage, procurement and mining recognition."""
from __future__ import annotations

import copy
import re

from .locations import extract_details_locations
from .text import (
    clean_objective_text,
    parse_mission_title,
    parse_refuel_customer,
    parse_salvage_title_details,
)


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
