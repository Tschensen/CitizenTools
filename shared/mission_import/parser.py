"""Single entry point for mission text recognition; no I/O or UI dependencies."""
from __future__ import annotations

import re

from .cargo import (
    parse_english_mission_objectives,
    parse_german_mission_objectives,
)
from .parcels import parse_courier_mission_details
from .services import (
    parse_investigation_mission_details,
    parse_mining_mission_details,
    parse_procurement_mission_details,
    parse_refuel_mission_details,
    parse_salvage_mission_details,
)


PARSER_VERSION = 17


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
    return parse_english_mission_objectives(normalized)
