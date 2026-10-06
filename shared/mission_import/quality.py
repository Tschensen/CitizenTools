"""Describe recognized, uncertain and missing mission fields for review."""
from __future__ import annotations

import re


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
