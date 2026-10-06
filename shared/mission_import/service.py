"""Shared screenshot-to-draft pipeline for uploads and the Companion."""
from __future__ import annotations

from pathlib import Path
import re
import subprocess
import sys

from . import ocr
from .locations import reconcile_draft_locations
from .parcels import (
    enrich_delivery_mission,
    parse_courier_mission_details,
)
from .parser import parse_mission_objectives
from .quality import build_import_field_quality
from .services import (
    apply_mission_title,
    merge_service_drafts,
    parse_investigation_mission_details,
    parse_mining_mission_details,
    parse_procurement_mission_details,
    parse_refuel_mission_details,
    parse_salvage_mission_details,
)
from .text import (
    clean_objective_text,
    parse_max_container_scu,
    parse_max_package_scu,
    parse_refuel_customer,
    parse_reward_amount,
)


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
            objectives_crop_path = ocr.prepare_ocr_crop(image_path, "objectives")
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as preparation_error:
            last_ocr_error = preparation_error

        try:
            details_crop_path = ocr.prepare_ocr_crop(image_path, "details")
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as details_preparation_error:
            emit(f"Details crop skipped: {details_preparation_error}", True)

        try:
            reward_crop_path = ocr.prepare_ocr_crop(image_path, "reward")
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as reward_preparation_error:
            emit(f"Reward crop skipped: {reward_preparation_error}", True)

        try:
            title_crop_path = ocr.prepare_ocr_crop(image_path, "title")
        except (OSError, RuntimeError, subprocess.TimeoutExpired) as title_preparation_error:
            emit(f"Title crop skipped: {title_preparation_error}", True)

        if objectives_crop_path:
            try:
                text = ocr.run_ocr(tesseract_path, objectives_crop_path)
                draft = parse_mission_objectives(text)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as ocr_error:
                last_ocr_error = ocr_error

        if details_crop_path:
            try:
                details_text = ocr.run_ocr(tesseract_path, details_crop_path)
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
                text = ocr.run_ocr(tesseract_path, image_path)
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
                title_text = ocr.run_ocr(tesseract_path, title_crop_path)
                draft = apply_mission_title(draft, title_text)
                draft = enrich_delivery_mission(draft, details_text)
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as title_error:
                emit(f"Title OCR skipped: {title_error}", True)

        if draft and reward_crop_path:
            try:
                reward_text = ocr.run_ocr(tesseract_path, reward_crop_path)
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
