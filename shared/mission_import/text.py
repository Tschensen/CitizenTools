"""Text cleanup and scalar fields shared by the mission parsers."""
from __future__ import annotations

import re


def clean_objective_text(value: object) -> str:
    return re.sub(r"^[-\u2013\u2022\s]+", "", re.sub(r"\s+", " ", str(value or ""))).strip()


def parse_ocr_integer(value: object) -> int | None:
    normalized = str(value or "").translate(str.maketrans({
        "O": "0", "o": "0",
        "S": "5", "s": "5",
        "I": "1", "i": "1", "l": "1", "|": "1",
    }))
    return int(normalized) if normalized.isdigit() else None


REWARD_NUMBER_PATTERN = re.compile(r"(?<!\d)(\d{1,3}(?:[.,'\s]\d{3})+|\d+)(?!\d)")


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
    source = str(text or "")
    amount_pattern = r"(?P<amount>\d+(?:[.,]\d+)?)\s*SCU\b"
    patterns = (
        # Keep the number attached to its label, even when OCR wraps the value.
        # The suffix also covers OCR variants such as ContainergroBe/-grosse.
        r"\bmax(?:imum|imal(?:e[rns]?)?)?\.?\s+(?:fracht)?container\w*"
        r"(?:\s+(?:size|gr\w+e))?\s*:?\s*" + amount_pattern,
        r"\bmax(?:imum|imal)?\.?\s+" + amount_pattern + r"[\s-]+(?:fracht)?container\b",
        # German Supply Haul contracts label the container size this way;
        # Tesseract commonly drops the umlaut, and some show 'SCU SCU'.
        r"\bschiffskapazit(?:ä|a|ae)t\s*:?\s*" + amount_pattern,
        r"\bschiff\b[^.!?]*?\b" + amount_pattern
        + r"[\s-]+Frachtcontainer\b[^.!?]*?\btransportieren\b",
    )
    # Prefer an explicit maximum over the alternative ship-capacity label.
    # Never infer a container size from a delivery's total SCU quantity.
    for pattern in patterns:
        for match in re.finditer(pattern, source, re.IGNORECASE):
            amount = float(match.group("amount").replace(",", "."))
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
