#!/usr/bin/env python3

from __future__ import annotations

import json
import hmac
import hashlib
import io
import math
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import unicodedata
import uuid
import zipfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from difflib import SequenceMatcher
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from shared.processes import hidden_subprocess_options

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = PROJECT_ROOT / "web"
DATA_DIR = Path(os.environ.get("CARGO_PLANNER_DATA_DIR") or PROJECT_ROOT / "data").expanduser().resolve()
SHIP_IMAGE_DIR = DATA_DIR / "ship-images"
DB_PATH = DATA_DIR / "cargo_planner.sqlite3"
STATE_KEY = "shared_state"
STATE_KEYS = {
    "solo": STATE_KEY,
}
DEFAULT_HOST = "0.0.0.0" if os.name == "nt" else "127.0.0.1"
HOST = os.environ.get("CARGO_PLANNER_HOST", DEFAULT_HOST)
PORT = int(os.environ.get("CARGO_PLANNER_PORT", "4173"))
IMPORT_TOKEN = os.environ.get("CARGO_PLANNER_IMPORT_TOKEN", "").strip()
IMPORT_TOKEN_META_KEY = "companion_import_token"
IMPORT_STATUSES = {"pending", "imported", "dismissed"}
CAPTURE_JOB_STATUSES = {"queued", "processing", "completed", "failed"}
LOCATION_STATUSES = {"active", "archived"}
LOCATION_TYPES = {"system", "planet", "moon", "city", "station", "outpost", "lagrange", "jump_point", "other"}
DEFAULT_LOCATION_NAMES = (
    "Stanton", "Area18", "Baijini Point", "Everus Harbor", "Grim HEX", "Lorville", "New Babbage",
    "Orison", "Port Tressler", "Seraphim Station", "ARC-L1 Wide Forest Station",
    "ARC-L2 Lively Pathway Station", "ARC-L4 Faint Glen Station", "ARC-L5 Yellow Core Station",
    "CRU-L1 Ambitious Dream Station", "CRU-L4 Shallow Fields Station", "CRU-L5 Beautiful Glen Station",
    "HUR-L1 Green Glade Station", "HUR-L2 Faithful Dream Station", "HUR-L4 Melodic Fields Station",
    "HUR-L5 High Course Station", "MIC-L1 Shallow Frontier Station", "MIC-L2 Long Forest Station",
    "MIC-L4 Red Crossroads Station", "Pyro", "Pyro Gateway", "Ruin Station", "Pyro I", "Monox",
    "Bloom", "Pyro IV", "Pyro V", "Terminus", "Ignis", "Vuur", "Fuego", "Fairo", "Adir",
    "Vatra", "Nyx", "Levski", "Delamar", "Nyx I", "Nyx II", "Nyx III",
)
LOCATION_MATCH_MIN_MARGIN = 0.04
SHIP_IMAGE_MAX_BYTES = 5 * 1024 * 1024
BACKUP_UPLOAD_MAX_BYTES = 256 * 1024 * 1024
BACKUP_DATABASE_MAX_BYTES = 128 * 1024 * 1024
BACKUP_IMAGES_MAX_BYTES = 100 * 1024 * 1024
DB_FILE_LOCK = threading.RLock()
LOCATION_IDENTITY_NOISE = {
    "am", "at", "auf", "above", "bei", "by", "in", "lagrangepunkt", "near", "oberhalb",
    "of", "port", "station", "the", "uber", "ueber", "von",
    "arc", "arccorp", "cru", "crusader", "hur", "hurston", "mic", "microtech", "nyx", "pyro", "stanton",
}


def detect_ship_image_type(raw_body: bytes) -> tuple[str, str] | None:
    if raw_body.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if raw_body.startswith(b"\xff\xd8\xff"):
        return ".jpg", "image/jpeg"
    if len(raw_body) >= 12 and raw_body.startswith(b"RIFF") and raw_body[8:12] == b"WEBP":
        return ".webp", "image/webp"
    return None


def get_ship_image_prefix(scope: str, profile_id: str) -> str:
    profile_key = f"{normalize_scope(scope)}:{str(profile_id or '').strip()}"
    digest = hashlib.sha256(profile_key.encode("utf-8")).hexdigest()[:24]
    return f"ship-{digest}"


def remove_ship_image_files(scope: str, profile_id: str) -> int:
    prefix = get_ship_image_prefix(scope, profile_id)
    deleted = 0
    if not SHIP_IMAGE_DIR.exists():
        return deleted
    for image_path in SHIP_IMAGE_DIR.glob(f"{prefix}.*"):
        if image_path.is_file():
            image_path.unlink()
            deleted += 1
    return deleted


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_state (
                state_key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS app_meta (
                meta_key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO app_meta (meta_key, value) VALUES (?, ?)",
            (IMPORT_TOKEN_META_KEY, IMPORT_TOKEN),
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS mission_imports (
                import_id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                source_device TEXT NOT NULL,
                source_label TEXT NOT NULL,
                image_hash TEXT NOT NULL,
                payload TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(scope, image_hash)
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS mission_imports_scope_status_created
            ON mission_imports (scope, status, created_at DESC)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS companion_capture_jobs (
                job_id TEXT PRIMARY KEY,
                scope TEXT NOT NULL,
                source_device TEXT NOT NULL,
                source_label TEXT NOT NULL,
                source_file TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'queued',
                message TEXT NOT NULL DEFAULT '',
                queue_position INTEGER NOT NULL DEFAULT 0,
                import_id TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS companion_capture_jobs_scope_updated
            ON companion_capture_jobs (scope, updated_at DESC)
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS locations (
                location_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                star_system TEXT NOT NULL DEFAULT '',
                normalized_system TEXT NOT NULL DEFAULT '',
                parent_location TEXT NOT NULL DEFAULT '',
                normalized_parent TEXT NOT NULL DEFAULT '',
                location_type TEXT NOT NULL DEFAULT 'other',
                status TEXT NOT NULL DEFAULT 'active',
                source TEXT NOT NULL DEFAULT 'manual',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(normalized_name, normalized_system, normalized_parent)
            )
            """
        )
        location_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(locations)").fetchall()
        }
        if "source" not in location_columns:
            connection.execute("ALTER TABLE locations ADD COLUMN source TEXT NOT NULL DEFAULT 'legacy'")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS location_aliases (
                alias_id TEXT PRIMARY KEY,
                location_id TEXT NOT NULL,
                alias TEXT NOT NULL,
                normalized_alias TEXT NOT NULL,
                source TEXT NOT NULL DEFAULT 'manual',
                created_at TEXT NOT NULL,
                UNIQUE(location_id, normalized_alias),
                FOREIGN KEY(location_id) REFERENCES locations(location_id) ON DELETE CASCADE
            )
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS locations_status_system_name
            ON locations (status, normalized_system, normalized_name)
            """
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS location_aliases_normalized
            ON location_aliases (normalized_alias)
            """
        )
        seed_initial_locations(connection)
        connection.commit()
    finally:
        connection.close()


@contextmanager
def get_connection():
    with DB_FILE_LOCK:
        connection = sqlite3.connect(DB_PATH)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
        finally:
            connection.close()


def read_database_snapshot() -> bytes:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3", dir=str(DATA_DIR)) as snapshot_file:
        snapshot_path = Path(snapshot_file.name)
    try:
        with DB_FILE_LOCK:
            source_connection = sqlite3.connect(DB_PATH)
            target_connection = sqlite3.connect(snapshot_path)
            try:
                source_connection.backup(target_connection)
            finally:
                target_connection.close()
                source_connection.close()
        return snapshot_path.read_bytes()
    finally:
        snapshot_path.unlink(missing_ok=True)


def parse_backup_payload(raw_body: bytes) -> tuple[bytes, dict[str, bytes] | None, dict, str]:
    database_body = raw_body
    restored_images: dict[str, bytes] | None = None
    manifest: dict = {}
    backup_kind = "database"

    if raw_body.startswith(b"PK"):
        backup_kind = "package"
        try:
            with zipfile.ZipFile(io.BytesIO(raw_body), "r") as archive:
                archive_names = archive.namelist()
                if archive_names.count("cargo_planner.sqlite3") != 1:
                    raise ValueError("invalid_database_entry")
                database_info = archive.getinfo("cargo_planner.sqlite3")
                if database_info.file_size > BACKUP_DATABASE_MAX_BYTES:
                    raise ValueError("database_too_large")
                database_body = archive.read("cargo_planner.sqlite3")

                if "manifest.json" in archive_names:
                    manifest_info = archive.getinfo("manifest.json")
                    if manifest_info.file_size > 64 * 1024:
                        raise ValueError("manifest_too_large")
                    parsed_manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
                    if not isinstance(parsed_manifest, dict):
                        raise ValueError("invalid_manifest")
                    manifest = parsed_manifest

                restored_images = {}
                total_image_bytes = 0
                for archive_name in archive_names:
                    if not archive_name.startswith("ship-images/"):
                        continue
                    image_name = Path(archive_name).name
                    valid_path = archive_name == f"ship-images/{image_name}"
                    valid_name = re.fullmatch(r"ship-[a-f0-9]{24}\.(?:png|jpg|webp)", image_name)
                    if not valid_path or not valid_name:
                        raise ValueError("invalid_ship_image_path")
                    image_info = archive.getinfo(archive_name)
                    if image_info.file_size > SHIP_IMAGE_MAX_BYTES or image_name in restored_images:
                        raise ValueError("invalid_ship_image")
                    image_body = archive.read(archive_name)
                    total_image_bytes += len(image_body)
                    if total_image_bytes > BACKUP_IMAGES_MAX_BYTES or not detect_ship_image_type(image_body):
                        raise ValueError("invalid_ship_image")
                    restored_images[image_name] = image_body
        except (KeyError, ValueError, UnicodeDecodeError, json.JSONDecodeError, zipfile.BadZipFile) as error:
            raise ValueError("invalid_backup") from error
    elif len(database_body) > BACKUP_DATABASE_MAX_BYTES:
        raise ValueError("database_too_large")

    return database_body, restored_images, manifest, backup_kind


def summarize_backup_state(value: object, scope: str) -> dict:
    state = value if isinstance(value, dict) else {}
    missions = state.get("missions") if isinstance(state.get("missions"), list) else []
    fleet = state.get("fleet") if isinstance(state.get("fleet"), list) else []
    return {
        "scope": scope,
        "missions": len(missions),
        "activeMissions": sum(1 for mission in missions if isinstance(mission, dict) and mission.get("status") == "active"),
        "completedMissions": sum(1 for mission in missions if isinstance(mission, dict) and mission.get("status") == "completed"),
        "paidMissions": sum(1 for mission in missions if isinstance(mission, dict) and mission.get("status") == "paid"),
        "fleet": len(fleet),
        "activeFleet": sum(1 for entry in fleet if isinstance(entry, dict) and entry.get("status", "active") == "active"),
        "archivedFleet": sum(1 for entry in fleet if isinstance(entry, dict) and entry.get("status", "active") != "active"),
        "ledgerEntries": len(state.get("ledgerEntries")) if isinstance(state.get("ledgerEntries"), list) else 0,
        "shipLibrary": len(state.get("shipLibrary")) if isinstance(state.get("shipLibrary"), list) else 0,
        "pilots": len(state.get("pilots")) if isinstance(state.get("pilots"), list) else 0,
    }


def inspect_backup_database(database_path: Path) -> dict:
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        integrity_result = connection.execute("PRAGMA integrity_check").fetchone()
        if not integrity_result or integrity_result[0] != "ok":
            raise ValueError("integrity_check_failed")
        tables = {
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        }
        if "app_state" not in tables:
            raise ValueError("missing_app_state")

        states = []
        latest_state_at = None
        for scope, state_key in STATE_KEYS.items():
            row = connection.execute(
                "SELECT value, updated_at FROM app_state WHERE state_key = ?",
                (state_key,),
            ).fetchone()
            if not row:
                continue
            try:
                state_value = json.loads(row["value"])
            except (TypeError, json.JSONDecodeError) as error:
                raise ValueError("invalid_app_state") from error
            states.append(summarize_backup_state(state_value, scope))
            if row["updated_at"] and (latest_state_at is None or row["updated_at"] > latest_state_at):
                latest_state_at = row["updated_at"]

        def table_count(table_name: str, where: str = "", params: tuple = ()) -> int:
            if table_name not in tables:
                return 0
            query = f"SELECT COUNT(*) AS total FROM {table_name}"
            if where:
                query += f" WHERE {where}"
            return int(connection.execute(query, params).fetchone()["total"])

        return {
            "states": states,
            "locations": table_count("locations"),
            "pendingImports": table_count("mission_imports", "status = ?", ("pending",)),
            "captureJobs": table_count("companion_capture_jobs"),
            "latestStateAt": latest_state_at,
        }
    finally:
        connection.close()


def write_validated_backup_database(database_body: bytes) -> tuple[Path, dict]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".sqlite3", dir=str(DATA_DIR)) as temp_file:
        temp_file.write(database_body)
        temp_path = Path(temp_file.name)
    try:
        summary = inspect_backup_database(temp_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        raise
    return temp_path, summary


def read_meta(connection: sqlite3.Connection, key: str) -> str | None:
    row = connection.execute(
        "SELECT value FROM app_meta WHERE meta_key = ?",
        (key,),
    ).fetchone()
    return row["value"] if row else None


def write_meta(connection: sqlite3.Connection, key: str, value: str) -> None:
    connection.execute(
        """
        INSERT INTO app_meta (meta_key, value)
        VALUES (?, ?)
        ON CONFLICT(meta_key) DO UPDATE SET value = excluded.value
        """,
        (key, value),
    )


def get_import_token() -> str:
    return ""


def resolve_state_scope(path: str) -> tuple[str, str]:
    parsed = urlparse(path)
    params = parse_qs(parsed.query)
    requested_scope = params.get("scope", ["solo"])[0]
    scope = requested_scope if requested_scope in STATE_KEYS else "solo"
    return scope, STATE_KEYS[scope]


def normalize_scope(value: object) -> str:
    requested_scope = str(value or "solo").strip().lower()
    return requested_scope if requested_scope in STATE_KEYS else "solo"


def normalize_import_decimal(value: object, *, allow_zero: bool = True) -> float | None:
    if value in (None, ""):
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(numeric) or numeric < 0 or (numeric == 0 and not allow_zero):
        return None
    return round(numeric, 2)


def normalize_refuel_import_details(value: object) -> dict:
    details = value if isinstance(value, dict) else {}
    service_type = str(details.get("serviceType") or "both").strip().lower()
    if service_type not in {"hydrogen", "quantum", "both"}:
        service_type = "both"
    return {
        "customer": str(details.get("customer") or "").strip()[:200],
        "location": str(details.get("location") or "").strip()[:200],
        "serviceType": service_type,
        "hydrogenAmount": normalize_import_decimal(details.get("hydrogenAmount")),
        "quantumAmount": normalize_import_decimal(details.get("quantumAmount")),
        "targetVehicle": str(details.get("targetVehicle") or "").strip()[:200],
        "hydrogenRate": normalize_import_decimal(details.get("hydrogenRate"), allow_zero=False),
        "quantumRate": normalize_import_decimal(details.get("quantumRate"), allow_zero=False),
        "bonus": str(details.get("bonus") or "").strip()[:500],
    }


def normalize_investigation_import_details(value: object) -> dict:
    details = value if isinstance(value, dict) else {}
    return {
        "customer": str(details.get("customer") or "").strip()[:200],
        "location": str(details.get("location") or "").strip()[:200],
        "subject": str(details.get("subject") or "").strip()[:200],
        "caseNumber": str(details.get("caseNumber") or "").strip()[:80],
        "leadInvestigator": str(details.get("leadInvestigator") or "").strip()[:200],
        "instructions": str(details.get("instructions") or "").strip()[:1000],
        "dangerNote": str(details.get("dangerNote") or "").strip()[:1000],
    }


def normalize_salvage_import_details(value: object) -> dict:
    details = value if isinstance(value, dict) else {}
    return {
        "customer": str(details.get("customer") or "").strip()[:200],
        "location": str(details.get("location") or "").strip()[:200],
        "salvageTarget": str(details.get("salvageTarget") or "").strip()[:200],
        "claimNumber": str(details.get("claimNumber") or "").strip()[:80],
        "instructions": str(details.get("instructions") or "").strip()[:1000],
    }


def normalize_procurement_import_details(value: object) -> dict:
    details = value if isinstance(value, dict) else {}
    items = []
    for raw_item in details.get("items", []) if isinstance(details.get("items"), list) else []:
        if not isinstance(raw_item, dict):
            continue
        try:
            quantity = int(raw_item.get("quantity") or 0)
        except (TypeError, ValueError):
            quantity = 0
        name = str(raw_item.get("name") or "").strip()[:200]
        destination = str(raw_item.get("destination") or details.get("location") or "").strip()[:200]
        if quantity <= 0 or quantity > 1_000_000 or not name:
            continue
        items.append({"name": name, "quantity": quantity, "destination": destination})
        if len(items) >= 20:
            break
    return {
        "customer": str(details.get("customer") or "").strip()[:200],
        "location": str(details.get("location") or "").strip()[:200],
        "items": items,
        "instructions": str(details.get("instructions") or "").strip()[:1000],
    }


def normalize_courier_import_details(value: object) -> dict:
    details = value if isinstance(value, dict) else {}
    packages = []
    for raw_package in details.get("packages", []) if isinstance(details.get("packages"), list) else []:
        if not isinstance(raw_package, dict):
            continue
        try:
            quantity = int(raw_package.get("quantity") or 1)
        except (TypeError, ValueError):
            quantity = 1
        package = {
            "id": str(raw_package.get("id") or "").strip()[:120],
            "quantity": max(1, min(quantity, 1000)),
            "name": str(raw_package.get("name") or "").strip()[:200],
            "pickup": str(raw_package.get("pickup") or "").strip()[:200],
            "destination": str(raw_package.get("destination") or "").strip()[:200],
            "containerScu": normalize_import_decimal(raw_package.get("containerScu"), allow_zero=False),
            "cargoSegmentId": str(raw_package.get("cargoSegmentId") or "").strip()[:120],
            "pickedUpAt": str(raw_package.get("pickedUpAt") or "").strip()[:80],
            "deliveredAt": str(raw_package.get("deliveredAt") or "").strip()[:80],
        }
        if not package["name"] or not package["pickup"] or not package["destination"]:
            continue
        packages.append(package)
        if len(packages) >= 20:
            break
    return {
        "customer": str(details.get("customer") or "").strip()[:200],
        "location": str(details.get("location") or (packages[0]["destination"] if packages else "")).strip()[:200],
        "packages": packages,
        "maxPackageScu": normalize_import_decimal(details.get("maxPackageScu"), allow_zero=False),
        "instructions": str(details.get("instructions") or "").strip()[:1000],
        "dangerNote": str(details.get("dangerNote") or "").strip()[:500],
    }


def normalize_mining_import_details(value: object) -> dict:
    details = value if isinstance(value, dict) else {}
    mining_method = str(details.get("miningMethod") or "hand").strip().lower()
    if mining_method not in {"hand", "ship"}:
        mining_method = "hand"
    return {
        "customer": str(details.get("customer") or "").strip()[:200],
        "location": str(details.get("location") or "").strip()[:200],
        "miningMethod": mining_method,
        "searchArea": str(details.get("searchArea") or "").strip()[:200],
        "material": str(details.get("material") or "").strip()[:200],
        "targetAmount": normalize_import_decimal(details.get("targetAmount"), allow_zero=False),
        "tool": str(details.get("tool") or "").strip()[:300],
        "instructions": str(details.get("instructions") or "").strip()[:1000],
    }


def normalize_import_field_quality(value: object) -> dict:
    if not isinstance(value, dict):
        return {}
    normalized = {}
    for raw_path, raw_status in list(value.items())[:80]:
        path = str(raw_path or "").strip()[:80]
        status = str(raw_status or "").strip().lower()
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9.]*", path):
            continue
        if status not in {"verified", "review", "missing"}:
            continue
        normalized[path] = status
    return normalized


def normalize_mission_import_payload(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid import payload")

    draft = payload.get("draft")
    if not isinstance(draft, dict):
        raise ValueError("Missing draft")

    title = str(draft.get("title") or "").strip()[:200]
    mission_type = str(draft.get("type") or "cargo").strip().lower()
    if mission_type not in {"cargo", "courier", "delivery", "refuel", "investigation", "salvage", "procurement", "mining"}:
        raise ValueError("Unsupported mission type")
    default_pickup = str(draft.get("pickup") or "").strip()[:200]
    raw_routes = draft.get("routes")
    raw_consignments = draft.get("consignments")
    if not title:
        raise ValueError("Incomplete draft")

    try:
        payout = int(draft.get("payout")) if draft.get("payout") is not None else None
    except (TypeError, ValueError):
        payout = None
    if payout is not None and not 0 <= payout <= 10_000_000_000:
        payout = None

    try:
        max_container_value = float(draft.get("maxContainerScu")) if draft.get("maxContainerScu") is not None else 0.0
    except (TypeError, ValueError):
        max_container_value = 0.0
    max_container_scu = (
        int(max_container_value)
        if max_container_value.is_integer() and 0 < max_container_value <= 1000
        else None
    )

    routes = []
    consignments = []
    raw_service_details = draft.get("serviceDetails") if isinstance(draft.get("serviceDetails"), dict) else {}
    service_details = {
        "customer": str(raw_service_details.get("customer") or "").strip()[:200],
    } if mission_type == "cargo" else {}
    if mission_type in {"courier", "delivery"}:
        service_details = normalize_courier_import_details(draft.get("serviceDetails"))
        if not service_details["packages"]:
            raise ValueError("Incomplete package draft")
    elif mission_type == "refuel":
        service_details = normalize_refuel_import_details(draft.get("serviceDetails"))
        if not any((service_details["location"], service_details["targetVehicle"], service_details["customer"])):
            raise ValueError("Incomplete refuel draft")
    elif mission_type == "investigation":
        service_details = normalize_investigation_import_details(draft.get("serviceDetails"))
        if not any((service_details["location"], service_details["subject"], service_details["caseNumber"], service_details["customer"])):
            raise ValueError("Incomplete investigation draft")
    elif mission_type == "salvage":
        service_details = normalize_salvage_import_details(draft.get("serviceDetails"))
        if not any(service_details.values()):
            raise ValueError("Incomplete salvage draft")
    elif mission_type == "procurement":
        service_details = normalize_procurement_import_details(draft.get("serviceDetails"))
        if not service_details["items"]:
            raise ValueError("Incomplete procurement draft")
    elif mission_type == "mining":
        service_details = normalize_mining_import_details(draft.get("serviceDetails"))
        if not any((service_details["location"], service_details["searchArea"], service_details["material"], service_details["tool"])):
            raise ValueError("Incomplete mining draft")
    elif isinstance(raw_consignments, list) and raw_consignments:
        for raw_consignment in raw_consignments[:20]:
            if not isinstance(raw_consignment, dict):
                raise ValueError("Invalid consignment")
            cargo_title = str(raw_consignment.get("title") or "").strip()[:200]
            cargo_pickup = str(raw_consignment.get("pickup") or "").strip()[:200]
            try:
                total_scu = float(raw_consignment.get("totalScu") or 0)
            except (TypeError, ValueError):
                total_scu = 0
            if not cargo_title or total_scu <= 0 or not total_scu.is_integer():
                raise ValueError("Incomplete consignment")
            raw_cargo_routes = raw_consignment.get("routes")
            if not isinstance(raw_cargo_routes, list) or not raw_cargo_routes:
                raise ValueError("Incomplete consignment")
            cargo_routes = normalize_import_routes(raw_cargo_routes, cargo_pickup, allow_unallocated=True)
            consignments.append(
                {
                    "title": cargo_title,
                    "pickup": cargo_pickup,
                    "totalScu": int(total_scu),
                    "routes": cargo_routes,
                }
            )
    elif isinstance(raw_routes, list) and raw_routes:
        routes = normalize_import_routes(raw_routes, default_pickup, allow_unallocated=False)
    else:
        raise ValueError("Incomplete draft")

    source_device = str(payload.get("deviceId") or "unknown-device").strip()[:120] or "unknown-device"
    source_label = str(payload.get("deviceName") or source_device).strip()[:120] or source_device
    pilot_name = str(payload.get("pilotName") or "").strip()[:120]
    image_hash = str(payload.get("imageHash") or "").strip().lower()
    if len(image_hash) != 64 or any(character not in "0123456789abcdef" for character in image_hash):
        raise ValueError("Invalid image hash")
    requested_scope = str(payload.get("scope") or "solo").strip().lower()
    if requested_scope not in STATE_KEYS:
        raise ValueError("Invalid scope")

    return {
        "scope": requested_scope,
        "sourceDevice": source_device,
        "sourceLabel": source_label,
        "pilotName": pilot_name,
        "imageHash": image_hash,
        "capturedAt": str(payload.get("capturedAt") or "").strip()[:64],
        "sourceFile": str(payload.get("sourceFile") or "").strip()[:260],
        "draft": {
            "type": mission_type,
            "title": title,
            "pickup": default_pickup,
            "routes": routes,
            "consignments": consignments,
            "serviceDetails": service_details,
            "payout": payout,
            "maxContainerScu": max_container_scu if mission_type == "cargo" else None,
            "allocationRequired": mission_type == "cargo" and bool(draft.get("allocationRequired") or consignments),
            "fieldQuality": normalize_import_field_quality(draft.get("fieldQuality")),
        },
    }


def normalize_import_routes(raw_routes: list, default_pickup: str, allow_unallocated: bool) -> list[dict]:
    routes = []
    for raw_route in raw_routes[:50]:
        if not isinstance(raw_route, dict):
            raise ValueError("Invalid route")
        pickup = str(raw_route.get("pickup") or default_pickup).strip()[:200]
        dropoff = str(raw_route.get("dropoff") or "").strip()[:200]
        try:
            target_scu = float(raw_route.get("targetScu") or 0)
        except (TypeError, ValueError):
            target_scu = 0
        minimum_scu = 0 if allow_unallocated else 1
        if not pickup or not dropoff or target_scu < minimum_scu or not target_scu.is_integer():
            raise ValueError("Incomplete route")
        routes.append(
            {
                "pickup": pickup,
                "dropoff": dropoff,
                "targetScu": int(target_scu),
            }
        )
    return routes


def normalize_location_key(value: object) -> str:
    normalized = unicodedata.normalize("NFKD", str(value or "")).casefold()
    normalized = "".join(character for character in normalized if not unicodedata.combining(character))
    normalized = normalized.replace("’", "'").replace("`", "'")
    normalized = re.sub(r"[^a-z0-9]+", " ", normalized)
    return re.sub(r"\s+", " ", normalized).strip()


def is_reference_location(value: object) -> bool:
    label = str(value or "").strip()
    key = normalize_location_key(label)
    if len(key) < 4 or len(label) > 200:
        return False
    if re.fullmatch(r"\d+\s+(ziele?|targets?)", key):
        return False
    return key not in {"ziel offen", "einsatzort offen", "open target", "location open"}


def infer_location_metadata(name: str) -> tuple[str, str, str]:
    if name in {"Stanton", "Pyro", "Nyx"}:
        return name, "", "system"
    if name.startswith(("ARC-L", "CRU-L", "HUR-L", "MIC-L")):
        return "Stanton", name.split(" ", 1)[0], "station"
    if name in {"Area18", "Lorville", "New Babbage", "Orison"}:
        return "Stanton", "", "city"
    if name in {"Baijini Point", "Everus Harbor", "Grim HEX", "Port Tressler", "Seraphim Station"}:
        return "Stanton", "", "station"
    if name in {"Pyro Gateway", "Ruin Station"}:
        return "Pyro", "", "jump_point" if name == "Pyro Gateway" else "station"
    if name in {"Pyro I", "Monox", "Bloom", "Pyro IV", "Pyro V", "Terminus"}:
        return "Pyro", "", "planet"
    if name in {"Ignis", "Vuur", "Fuego", "Fairo", "Adir", "Vatra"}:
        return "Pyro", "", "moon"
    if name in {"Levski"}:
        return "Nyx", "Delamar", "city"
    if name in {"Delamar", "Nyx I", "Nyx II", "Nyx III"}:
        return "Nyx", "", "planet"
    lowered = name.casefold()
    if "station" in lowered or "harbor" in lowered or "point" in lowered:
        return "", "", "station"
    return "", "", "other"


def insert_discovered_location(
    connection: sqlite3.Connection,
    name: object,
    star_system: str = "",
    parent_location: str = "",
    location_type: str = "other",
    source: str = "state",
) -> str | None:
    label = str(name or "").strip()[:200]
    if not is_reference_location(label):
        return None
    normalized_name = normalize_location_key(label)
    alias_row = connection.execute(
        """
        SELECT location_aliases.location_id
        FROM location_aliases
        JOIN locations ON locations.location_id = location_aliases.location_id
        WHERE location_aliases.normalized_alias = ? AND locations.status = 'active'
        LIMIT 1
        """,
        (normalized_name,),
    ).fetchone()
    if alias_row:
        return alias_row["location_id"]
    existing = connection.execute(
        "SELECT location_id FROM locations WHERE normalized_name = ? AND status = 'active' LIMIT 1",
        (normalized_name,),
    ).fetchone()
    if existing:
        return existing["location_id"]
    alias_row = connection.execute(
        "SELECT location_id FROM location_aliases WHERE normalized_alias = ? LIMIT 1",
        (normalized_name,),
    ).fetchone()
    if alias_row:
        return alias_row["location_id"]
    existing = connection.execute(
        "SELECT location_id FROM locations WHERE normalized_name = ? LIMIT 1",
        (normalized_name,),
    ).fetchone()
    if existing:
        return existing["location_id"]

    now = datetime.now(timezone.utc).isoformat()
    location_id = str(uuid.uuid4())
    normalized_system = normalize_location_key(star_system)
    normalized_parent = normalize_location_key(parent_location)
    connection.execute(
        """
        INSERT OR IGNORE INTO locations (
            location_id, name, normalized_name, star_system, normalized_system,
            parent_location, normalized_parent, location_type, status, source, notes,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, '', ?, ?)
        """,
        (
            location_id,
            label,
            normalized_name,
            star_system,
            normalized_system,
            parent_location,
            normalized_parent,
            location_type if location_type in LOCATION_TYPES else "other",
            source if source in {"seed", "state"} else "state",
            now,
            now,
        ),
    )
    stored = connection.execute(
        """
        SELECT location_id FROM locations
        WHERE normalized_name = ? AND normalized_system = ? AND normalized_parent = ?
        """,
        (normalized_name, normalized_system, normalized_parent),
    ).fetchone()
    return stored["location_id"] if stored else None


def seed_initial_locations(connection: sqlite3.Connection) -> None:
    if read_meta(connection, "locations_seed_version"):
        return
    for name in DEFAULT_LOCATION_NAMES:
        star_system, parent_location, location_type = infer_location_metadata(name)
        insert_discovered_location(connection, name, star_system, parent_location, location_type, source="seed")
    rows = connection.execute("SELECT value FROM app_state").fetchall()
    for row in rows:
        try:
            state_payload = json.loads(row["value"])
        except (json.JSONDecodeError, TypeError):
            continue
        discover_state_locations(connection, state_payload)
    write_meta(connection, "locations_seed_version", "1")


def discover_state_locations(connection: sqlite3.Connection, state_payload: object) -> int:
    inserted = 0
    for label in collect_known_locations(state_payload):
        before = connection.total_changes
        insert_discovered_location(connection, label)
        inserted += int(connection.total_changes > before)
    return inserted


def normalize_location_payload(payload: object) -> dict:
    if not isinstance(payload, dict):
        raise ValueError("Invalid location payload")
    name = str(payload.get("name") or "").strip()[:200]
    if not is_reference_location(name):
        raise ValueError("A valid location name is required")
    star_system = str(payload.get("starSystem") or "").strip()[:120]
    parent_location = str(payload.get("parentLocation") or "").strip()[:160]
    location_type = str(payload.get("type") or "other").strip().lower()
    status = str(payload.get("status") or "active").strip().lower()
    if location_type not in LOCATION_TYPES:
        raise ValueError("Unsupported location type")
    if status not in LOCATION_STATUSES:
        raise ValueError("Unsupported location status")

    raw_aliases = payload.get("aliases")
    if isinstance(raw_aliases, str):
        raw_aliases = re.split(r"[\n,;]+", raw_aliases)
    aliases = []
    seen_aliases = {normalize_location_key(name)}
    for raw_alias in raw_aliases if isinstance(raw_aliases, list) else []:
        alias = str(raw_alias or "").strip()[:200]
        alias_key = normalize_location_key(alias)
        if not alias_key or alias_key in seen_aliases:
            continue
        seen_aliases.add(alias_key)
        aliases.append(alias)
    return {
        "name": name,
        "starSystem": star_system,
        "parentLocation": parent_location,
        "type": location_type,
        "status": status,
        "notes": str(payload.get("notes") or "").strip()[:2000],
        "aliases": aliases[:50],
    }


def replace_location_aliases(
    connection: sqlite3.Connection,
    location_id: str,
    aliases: list[str],
    source: str = "manual",
) -> None:
    existing_sources = {
        row["normalized_alias"]: row["source"]
        for row in connection.execute(
            "SELECT normalized_alias, source FROM location_aliases WHERE location_id = ?",
            (location_id,),
        ).fetchall()
    }
    connection.execute("DELETE FROM location_aliases WHERE location_id = ?", (location_id,))
    created_at = datetime.now(timezone.utc).isoformat()
    for alias in aliases:
        normalized_alias = normalize_location_key(alias)
        connection.execute(
            """
            INSERT OR IGNORE INTO location_aliases (
                alias_id, location_id, alias, normalized_alias, source, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                location_id,
                alias,
                normalized_alias,
                existing_sources.get(normalized_alias, source),
                created_at,
            ),
        )


def collect_import_locations(payload: object) -> list[str]:
    if not isinstance(payload, dict):
        return []
    draft = payload.get("draft")
    if not isinstance(draft, dict):
        return []
    values = []

    def add(value: object) -> None:
        if is_reference_location(value):
            values.append(str(value).strip())

    add(draft.get("pickup"))
    service_details = draft.get("serviceDetails")
    if isinstance(service_details, dict):
        add(service_details.get("location"))
        add(service_details.get("searchArea"))
        for item in service_details.get("items", []) if isinstance(service_details.get("items"), list) else []:
            if isinstance(item, dict):
                add(item.get("destination"))
        for package in service_details.get("packages", []) if isinstance(service_details.get("packages"), list) else []:
            if isinstance(package, dict):
                add(package.get("pickup"))
                add(package.get("destination"))
    for route in draft.get("routes", []) if isinstance(draft.get("routes"), list) else []:
        if isinstance(route, dict):
            add(route.get("pickup"))
            add(route.get("dropoff"))
    for consignment in draft.get("consignments", []) if isinstance(draft.get("consignments"), list) else []:
        if not isinstance(consignment, dict):
            continue
        add(consignment.get("pickup"))
        for route in consignment.get("routes", []) if isinstance(consignment.get("routes"), list) else []:
            if isinstance(route, dict):
                add(route.get("pickup"))
                add(route.get("dropoff"))
    return values


def load_location_usage_counts(connection: sqlite3.Connection) -> dict[str, int]:
    key_to_location_ids: dict[str, set[str]] = {}
    for row in connection.execute("SELECT location_id, normalized_name FROM locations").fetchall():
        key_to_location_ids.setdefault(row["normalized_name"], set()).add(row["location_id"])
    for row in connection.execute("SELECT location_id, normalized_alias FROM location_aliases").fetchall():
        key_to_location_ids.setdefault(row["normalized_alias"], set()).add(row["location_id"])
    counts: dict[str, int] = {}

    def count(values: list[str]) -> None:
        for value in values:
            for location_id in key_to_location_ids.get(normalize_location_key(value), set()):
                counts[location_id] = counts.get(location_id, 0) + 1

    for row in connection.execute("SELECT value FROM app_state").fetchall():
        try:
            count(collect_known_locations(json.loads(row["value"])))
        except (json.JSONDecodeError, TypeError):
            continue
    for row in connection.execute("SELECT payload FROM mission_imports").fetchall():
        try:
            count(collect_import_locations(json.loads(row["payload"])))
        except (json.JSONDecodeError, TypeError):
            continue
    return counts


def load_location_records(connection: sqlite3.Connection, status: str = "all") -> list[dict]:
    params: tuple = ()
    where_clause = ""
    if status in LOCATION_STATUSES:
        where_clause = "WHERE status = ?"
        params = (status,)
    rows = connection.execute(
        f"""
        SELECT * FROM locations
        {where_clause}
        ORDER BY normalized_system, normalized_parent, normalized_name
        """,
        params,
    ).fetchall()
    aliases_by_location: dict[str, list[str]] = {}
    for alias_row in connection.execute(
        "SELECT location_id, alias FROM location_aliases ORDER BY normalized_alias"
    ).fetchall():
        aliases_by_location.setdefault(alias_row["location_id"], []).append(alias_row["alias"])
    usage_counts = load_location_usage_counts(connection)
    return [
        {
            "id": row["location_id"],
            "name": row["name"],
            "starSystem": row["star_system"],
            "parentLocation": row["parent_location"],
            "type": row["location_type"],
            "status": row["status"],
            "source": row["source"],
            "notes": row["notes"],
            "aliases": aliases_by_location.get(row["location_id"], []),
            "usageCount": usage_counts.get(row["location_id"], 0),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def load_location_match_candidates(connection: sqlite3.Connection) -> list[dict]:
    rows = connection.execute(
        "SELECT location_id, name FROM locations WHERE status = 'active' ORDER BY normalized_name"
    ).fetchall()
    aliases_by_location: dict[str, list[str]] = {}
    for alias_row in connection.execute(
        "SELECT location_id, alias FROM location_aliases ORDER BY normalized_alias"
    ).fetchall():
        aliases_by_location.setdefault(alias_row["location_id"], []).append(alias_row["alias"])
    return [
        {"name": row["name"], "aliases": aliases_by_location.get(row["location_id"], [])}
        for row in rows
    ]


def collect_known_locations(state_payload: object) -> list[str]:
    if not isinstance(state_payload, dict):
        return []

    by_key: dict[str, str] = {}

    def add(value: object) -> None:
        if not is_reference_location(value):
            return
        label = str(value).strip()
        by_key.setdefault(normalize_location_key(label), label)

    for mission in state_payload.get("missions", []) if isinstance(state_payload.get("missions"), list) else []:
        if not isinstance(mission, dict):
            continue
        add(mission.get("pickup"))
        add(mission.get("dropoff"))
        service_details = mission.get("serviceDetails")
        if isinstance(service_details, dict):
            add(service_details.get("location"))
            add(service_details.get("searchArea"))
            for item in service_details.get("items", []) if isinstance(service_details.get("items"), list) else []:
                if isinstance(item, dict):
                    add(item.get("destination"))
            for package in service_details.get("packages", []) if isinstance(service_details.get("packages"), list) else []:
                if isinstance(package, dict):
                    add(package.get("pickup"))
                    add(package.get("destination"))
        for segment in mission.get("segments", []) if isinstance(mission.get("segments"), list) else []:
            if not isinstance(segment, dict):
                continue
            add(segment.get("pickup"))
            add(segment.get("dropoff"))

    for stop in state_payload.get("stopHistory", []) if isinstance(state_payload.get("stopHistory"), list) else []:
        if not isinstance(stop, dict):
            continue
        add(stop.get("dropoff"))
        for pickup in stop.get("pickups", []) if isinstance(stop.get("pickups"), list) else []:
            add(pickup)

    return list(by_key.values())


def location_similarity(source: str, candidate: str) -> float:
    source_key = normalize_location_key(source)
    candidate_key = normalize_location_key(candidate)
    if not source_key or not candidate_key:
        return 0.0
    if source_key == candidate_key:
        return 1.0

    sequence_score = SequenceMatcher(None, source_key, candidate_key).ratio()
    source_tokens = set(source_key.split())
    candidate_tokens = set(candidate_key.split())
    shared_tokens = len(source_tokens & candidate_tokens)
    containment_score = shared_tokens / max(1, min(len(source_tokens), len(candidate_tokens)))
    return max(sequence_score, sequence_score * 0.8 + containment_score * 0.2)


def location_identity_tokens(value: object) -> list[str]:
    tokens = []
    for token in normalize_location_key(value).split():
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


def find_similar_location(value: object, known_locations: list) -> tuple[str, float] | None:
    source = str(value or "").strip()
    source_key = normalize_location_key(source)
    if not source_key or not known_locations:
        return None

    scores_by_canonical: dict[str, float] = {}
    for candidate in known_locations:
        if isinstance(candidate, dict):
            canonical = str(candidate.get("name") or "").strip()
            aliases = candidate.get("aliases") if isinstance(candidate.get("aliases"), list) else []
            terms = [canonical, *[str(alias or "").strip() for alias in aliases]]
        else:
            canonical = str(candidate or "").strip()
            terms = [canonical]
        if not canonical:
            continue
        best_term_score = 0.0
        for term in terms:
            if not term:
                continue
            if normalize_location_key(term) == source_key:
                best_term_score = 1.0
                break
            if locations_share_identity(source, term):
                best_term_score = max(best_term_score, location_similarity(source, term))
        if best_term_score > 0:
            scores_by_canonical[canonical] = max(scores_by_canonical.get(canonical, 0.0), best_term_score)

    if not scores_by_canonical:
        return None

    ranked = sorted(
        scores_by_canonical.items(),
        key=lambda item: item[1],
        reverse=True,
    )
    best_candidate, best_score = ranked[0]
    if best_score >= 1.0:
        return best_candidate, best_score

    minimum_score = 0.9 if len(source_key) < 10 else 0.82 if len(source_key) < 18 else 0.76
    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
    if best_score < minimum_score or best_score - second_score < LOCATION_MATCH_MIN_MARGIN:
        return None
    return best_candidate, best_score


def match_import_locations(normalized_import: dict, known_locations: list[str]) -> dict:
    corrections = []

    def replace(container: dict, field: str) -> None:
        original = str(container.get(field) or "").strip()
        match = find_similar_location(original, known_locations)
        if not match:
            return
        canonical, score = match
        if canonical == original:
            return
        container[field] = canonical
        corrections.append(
            {
                "field": field,
                "recognized": original,
                "matched": canonical,
                "score": round(score, 3),
            }
        )

    draft = normalized_import.get("draft")
    if not isinstance(draft, dict):
        return normalized_import
    replace(draft, "pickup")
    service_details = draft.get("serviceDetails")
    if isinstance(service_details, dict):
        replace(service_details, "location")
        replace(service_details, "searchArea")
        for item in service_details.get("items", []) if isinstance(service_details.get("items"), list) else []:
            if isinstance(item, dict):
                replace(item, "destination")
        for package in service_details.get("packages", []) if isinstance(service_details.get("packages"), list) else []:
            if isinstance(package, dict):
                replace(package, "pickup")
                replace(package, "destination")
    for route in draft.get("routes", []) if isinstance(draft.get("routes"), list) else []:
        if isinstance(route, dict):
            replace(route, "pickup")
            replace(route, "dropoff")
    for consignment in draft.get("consignments", []) if isinstance(draft.get("consignments"), list) else []:
        if not isinstance(consignment, dict):
            continue
        replace(consignment, "pickup")
        for route in consignment.get("routes", []) if isinstance(consignment.get("routes"), list) else []:
            if isinstance(route, dict):
                replace(route, "pickup")
                replace(route, "dropoff")

    normalized_import["locationCorrections"] = corrections
    return normalized_import


class CargoPlannerHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def translate_path(self, path: str) -> str:
        parsed_path = urlparse(path).path
        image_prefix = "/data/ship-images/"
        if parsed_path.startswith(image_prefix):
            image_name = Path(parsed_path).name
            expected_path = f"{image_prefix}{image_name}"
            valid_name = re.fullmatch(r"ship-[a-f0-9]{24}\.(?:png|jpg|webp)", image_name)
            if parsed_path == expected_path and valid_name:
                return str(SHIP_IMAGE_DIR / image_name)
            return str(WEB_DIR / ".not-found")
        return super().translate_path(path)

    def log_request(self, code="-", size="-") -> None:
        parsed = urlparse(self.path)
        try:
            status_code = int(code)
        except (TypeError, ValueError):
            status_code = 0

        quiet_poll = (
            self.command == "GET"
            and parsed.path in {"/api/state", "/api/imports", "/api/imports/ping", "/api/imports/progress"}
            and 200 <= status_code < 300
        )
        if quiet_poll:
            return
        super().log_request(code, size)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.handle_get_state()
            return
        if parsed.path == "/api/imports":
            self.handle_get_imports()
            return
        if parsed.path == "/api/imports/ping":
            self.handle_import_ping()
            return
        if parsed.path == "/api/companion/capabilities":
            self.handle_companion_capabilities()
            return
        if parsed.path == "/api/imports/progress":
            self.handle_get_import_progress()
            return
        if parsed.path == "/api/locations":
            self.handle_get_locations()
            return
        if parsed.path == "/api/backup":
            self.handle_backup()
            return

        if parsed.path in {"", "/"}:
            self.path = "/index.html"

        super().do_GET()

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.handle_post_state()
            return
        if parsed.path == "/api/restore":
            self.handle_restore()
            return
        if parsed.path == "/api/restore/preview":
            self.handle_restore_preview()
            return
        if parsed.path == "/api/ocr":
            self.handle_ocr()
            return
        if parsed.path == "/api/imports":
            self.handle_create_import()
            return
        if parsed.path == "/api/imports/reset":
            self.handle_reset_imports()
            return
        if parsed.path == "/api/imports/progress":
            self.handle_update_import_progress()
            return
        if parsed.path == "/api/locations":
            self.handle_create_location()
            return
        if parsed.path.startswith("/api/locations/") and parsed.path.endswith("/aliases"):
            self.handle_add_location_alias(parsed.path)
            return
        if parsed.path == "/api/ship-images":
            self.handle_upload_ship_image()
            return
        if parsed.path.startswith("/api/imports/") and parsed.path.endswith("/status"):
            self.handle_update_import_status(parsed.path)
            return

        self.send_error(404, "Route not found")

    def do_PUT(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/locations/"):
            self.handle_update_location(parsed.path)
            return
        self.send_error(404, "Route not found")

    def do_DELETE(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/locations/"):
            self.handle_delete_location(parsed.path)
            return
        if parsed.path == "/api/ship-images":
            self.handle_delete_ship_image()
            return
        self.send_error(404, "Route not found")

    def handle_get_state(self) -> None:
        scope, state_key = resolve_state_scope(self.path)
        with get_connection() as connection:
            row = connection.execute(
                "SELECT value, updated_at FROM app_state WHERE state_key = ?",
                (state_key,),
            ).fetchone()
            meta = {
                "lastBackupAt": read_meta(connection, "last_backup_at"),
                "lastRestoreAt": read_meta(connection, "last_restore_at"),
            }

        payload = {
            "state": json.loads(row["value"]) if row else None,
            "updatedAt": row["updated_at"] if row else None,
            "scope": scope,
            "meta": meta,
        }
        self.send_json(200, payload)

    def handle_post_state(self) -> None:
        scope, state_key = resolve_state_scope(self.path)
        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""

        try:
            payload = json.loads(raw_body.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            self.send_json(400, {"error": "Invalid JSON body"})
            return

        if "state" not in payload:
            self.send_json(400, {"error": "Missing 'state' payload"})
            return

        serialized_state = json.dumps(payload["state"], ensure_ascii=False)
        updated_at = datetime.now(timezone.utc).isoformat()

        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO app_state (state_key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(state_key) DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (state_key, serialized_state, updated_at),
            )
            write_meta(connection, f"last_state_write_at_{scope}", updated_at)
            discover_state_locations(connection, payload["state"])
            connection.commit()

        self.send_json(200, {"ok": True, "updatedAt": updated_at, "scope": scope})











    def handle_get_imports(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        scope = normalize_scope(params.get("scope", ["solo"])[0])
        requested_status = str(params.get("status", ["pending"])[0]).strip().lower()
        status = requested_status if requested_status in IMPORT_STATUSES else "pending"

        with get_connection() as connection:
            rows = connection.execute(
                """
                SELECT import_id, source_device, source_label, payload, status, created_at, updated_at
                FROM mission_imports
                WHERE scope = ? AND status = ?
                ORDER BY created_at DESC
                LIMIT 50
                """,
                (scope, status),
            ).fetchall()

        imports = []
        for row in rows:
            stored_payload = json.loads(row["payload"])
            imports.append(
                {
                    "id": row["import_id"],
                    "sourceDevice": row["source_device"],
                    "sourceLabel": row["source_label"],
                    "pilotName": stored_payload.get("pilotName", ""),
                    "submittedBy": stored_payload.get("submittedBy"),
                    "status": row["status"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                    "capturedAt": stored_payload.get("capturedAt"),
                    "sourceFile": stored_payload.get("sourceFile"),
                    "draft": stored_payload.get("draft"),
                    "locationCorrections": stored_payload.get("locationCorrections", []),
                }
            )

        self.send_json(200, {"ok": True, "scope": scope, "status": status, "imports": imports})

    def handle_get_import_progress(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        scope = normalize_scope(params.get("scope", ["solo"])[0])
        recent_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
        active_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
        with get_connection() as connection:
            rows = connection.execute(
                """
                SELECT job_id, source_device, source_label, source_file, status,
                       message, queue_position, import_id, created_at, updated_at
                FROM companion_capture_jobs
                WHERE scope = ?
                  AND (
                      (status IN ('queued', 'processing') AND updated_at >= ?)
                      OR (status IN ('completed', 'failed') AND updated_at >= ?)
                  )
                ORDER BY
                    CASE status WHEN 'processing' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
                    created_at ASC
                LIMIT 50
                """,
                (scope, active_cutoff, recent_cutoff),
            ).fetchall()
        jobs = [
            {
                "id": row["job_id"],
                "sourceDevice": row["source_device"],
                "sourceLabel": row["source_label"],
                "sourceFile": row["source_file"],
                "status": row["status"],
                "message": row["message"],
                "queuePosition": row["queue_position"],
                "importId": row["import_id"],
                "createdAt": row["created_at"],
                "updatedAt": row["updated_at"],
            }
            for row in rows
        ]
        self.send_json(200, {"ok": True, "scope": scope, "jobs": jobs})

    def handle_update_import_progress(self) -> None:
        try:
            payload = self.read_json_body(max_bytes=32 * 1024)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_PROGRESS", "message": str(error)})
            return

        job_id = str(payload.get("jobId") or "").strip()[:120]
        status = str(payload.get("status") or "").strip().lower()
        requested_scope = str(payload.get("scope") or "solo").strip().lower()
        source_device = str(payload.get("deviceId") or "unknown-device").strip()[:120] or "unknown-device"
        source_label = str(payload.get("deviceName") or source_device).strip()[:120] or source_device
        source_file = str(payload.get("sourceFile") or "").strip()[:260]
        message = str(payload.get("message") or "").strip()[:500]
        import_id = str(payload.get("importId") or "").strip()[:120]
        try:
            queue_position = max(0, min(99, int(payload.get("queuePosition") or 0)))
        except (TypeError, ValueError):
            queue_position = 0
        if not job_id or status not in CAPTURE_JOB_STATUSES or requested_scope not in STATE_KEYS:
            self.send_json(400, {"ok": False, "error": "INVALID_PROGRESS", "message": "Invalid capture progress."})
            return


        now = datetime.now(timezone.utc).isoformat()
        cleanup_cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO companion_capture_jobs (
                    job_id, scope, source_device, source_label, source_file, status,
                    message, queue_position, import_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(job_id) DO UPDATE SET
                    scope = excluded.scope,
                    source_device = excluded.source_device,
                    source_label = excluded.source_label,
                    source_file = excluded.source_file,
                    status = excluded.status,
                    message = excluded.message,
                    queue_position = excluded.queue_position,
                    import_id = excluded.import_id,
                    updated_at = excluded.updated_at
                """,
                (
                    job_id,
                    requested_scope,
                    source_device,
                    source_label,
                    source_file,
                    status,
                    message,
                    queue_position,
                    import_id,
                    now,
                    now,
                ),
            )
            connection.execute(
                """
                DELETE FROM companion_capture_jobs
                WHERE status IN ('completed', 'failed') AND updated_at < ?
                """,
                (cleanup_cutoff,),
            )
            connection.commit()
        self.send_json(200, {"ok": True, "id": job_id, "scope": requested_scope, "status": status, "updatedAt": now})

    def handle_import_ping(self) -> None:
        if not self.is_import_authorized():
            self.send_json(401, {"ok": False, "error": "IMPORT_UNAUTHORIZED", "message": "Import token rejected."})
            return
        self.send_json(200, {"ok": True, "tokenProtected": bool(get_import_token())})

    def handle_companion_capabilities(self) -> None:
        self.send_json(
            200,
            {
                "ok": True,
                "service": "citizen-tools",
                "authentication": "token" if bool(get_import_token()) else "none",
                "features": {
                    "browserPairing": False,
                    "screenshotImports": True,
                },
            },
        )












    def handle_get_locations(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        requested_status = str(params.get("status", ["all"])[0]).strip().lower()
        status = requested_status if requested_status in LOCATION_STATUSES else "all"
        with get_connection() as connection:
            locations = load_location_records(connection, status)
        self.send_json(200, {"ok": True, "status": status, "locations": locations})

    def handle_create_location(self) -> None:
        try:
            normalized = normalize_location_payload(self.read_json_body(max_bytes=64 * 1024))
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_LOCATION", "message": str(error)})
            return
        location_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        try:
            with get_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO locations (
                        location_id, name, normalized_name, star_system, normalized_system,
                        parent_location, normalized_parent, location_type, status, notes,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        location_id,
                        normalized["name"],
                        normalize_location_key(normalized["name"]),
                        normalized["starSystem"],
                        normalize_location_key(normalized["starSystem"]),
                        normalized["parentLocation"],
                        normalize_location_key(normalized["parentLocation"]),
                        normalized["type"],
                        normalized["status"],
                        normalized["notes"],
                        now,
                        now,
                    ),
                )
                replace_location_aliases(connection, location_id, normalized["aliases"])
                connection.commit()
                created = next(
                    record for record in load_location_records(connection) if record["id"] == location_id
                )
        except sqlite3.IntegrityError:
            self.send_json(
                409,
                {"ok": False, "error": "LOCATION_EXISTS", "message": "A location with this hierarchy already exists."},
            )
            return
        self.send_json(201, {"ok": True, "location": created})

    def handle_update_location(self, path: str) -> None:
        location_id = self.location_id_from_path(path)
        if not location_id:
            self.send_error(404, "Route not found")
            return
        try:
            normalized = normalize_location_payload(self.read_json_body(max_bytes=64 * 1024))
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_LOCATION", "message": str(error)})
            return
        now = datetime.now(timezone.utc).isoformat()
        try:
            with get_connection() as connection:
                existing = connection.execute(
                    "SELECT name FROM locations WHERE location_id = ?",
                    (location_id,),
                ).fetchone()
                if not existing:
                    self.send_json(404, {"ok": False, "error": "LOCATION_NOT_FOUND"})
                    return
                aliases = list(normalized["aliases"])
                if normalize_location_key(existing["name"]) != normalize_location_key(normalized["name"]):
                    aliases.append(existing["name"])
                connection.execute(
                    """
                    UPDATE locations SET
                        name = ?, normalized_name = ?, star_system = ?, normalized_system = ?,
                        parent_location = ?, normalized_parent = ?, location_type = ?, status = ?,
                        source = 'manual', notes = ?, updated_at = ?
                    WHERE location_id = ?
                    """,
                    (
                        normalized["name"],
                        normalize_location_key(normalized["name"]),
                        normalized["starSystem"],
                        normalize_location_key(normalized["starSystem"]),
                        normalized["parentLocation"],
                        normalize_location_key(normalized["parentLocation"]),
                        normalized["type"],
                        normalized["status"],
                        normalized["notes"],
                        now,
                        location_id,
                    ),
                )
                replace_location_aliases(connection, location_id, normalize_location_payload({
                    **normalized,
                    "aliases": aliases,
                })["aliases"])
                connection.commit()
                updated = next(
                    record for record in load_location_records(connection) if record["id"] == location_id
                )
        except sqlite3.IntegrityError:
            self.send_json(
                409,
                {"ok": False, "error": "LOCATION_EXISTS", "message": "A location with this hierarchy already exists."},
            )
            return
        self.send_json(200, {"ok": True, "location": updated})

    def handle_add_location_alias(self, path: str) -> None:
        path_parts = [part for part in path.split("/") if part]
        if len(path_parts) != 4 or path_parts[:2] != ["api", "locations"] or path_parts[3] != "aliases":
            self.send_error(404, "Route not found")
            return
        location_id = path_parts[2]
        try:
            payload = self.read_json_body(max_bytes=8 * 1024)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_ALIAS", "message": str(error)})
            return
        alias = str(payload.get("alias") or "").strip()[:200]
        normalized_alias = normalize_location_key(alias)
        if len(normalized_alias) < 3:
            self.send_json(
                400,
                {"ok": False, "error": "INVALID_ALIAS", "message": "Alias must contain at least three characters."},
            )
            return

        with get_connection() as connection:
            location = connection.execute(
                "SELECT location_id, name, normalized_name FROM locations WHERE location_id = ?",
                (location_id,),
            ).fetchone()
            if not location:
                self.send_json(404, {"ok": False, "error": "LOCATION_NOT_FOUND"})
                return

            canonical_conflicts = connection.execute(
                "SELECT location_id, name, source FROM locations WHERE normalized_name = ? AND location_id != ?",
                (normalized_alias, location_id),
            ).fetchall()
            alias_conflicts = connection.execute(
                """
                SELECT DISTINCT locations.location_id, locations.name, locations.source
                FROM location_aliases
                JOIN locations ON locations.location_id = location_aliases.location_id
                WHERE location_aliases.normalized_alias = ? AND locations.location_id != ?
                """,
                (normalized_alias, location_id),
            ).fetchall()
            provisional_conflicts = [row for row in canonical_conflicts if row["source"] == "state"]
            blocking_conflicts = [row for row in canonical_conflicts if row["source"] != "state"]
            conflicts = {
                row["location_id"]: row["name"]
                for row in [*blocking_conflicts, *alias_conflicts]
            }
            if conflicts:
                self.send_json(
                    409,
                    {
                        "ok": False,
                        "error": "ALIAS_CONFLICT",
                        "message": "Alias is already assigned to another location.",
                        "locations": list(conflicts.values()),
                    },
                )
                return

            existing_alias = connection.execute(
                "SELECT alias_id FROM location_aliases WHERE location_id = ? AND normalized_alias = ?",
                (location_id, normalized_alias),
            ).fetchone()
            duplicate = normalized_alias == location["normalized_name"] or existing_alias is not None
            if not duplicate:
                now = datetime.now(timezone.utc).isoformat()
                if provisional_conflicts:
                    connection.executemany(
                        "UPDATE locations SET status = 'archived', updated_at = ? WHERE location_id = ?",
                        [(now, row["location_id"]) for row in provisional_conflicts],
                    )
                connection.execute(
                    """
                    INSERT INTO location_aliases (
                        alias_id, location_id, alias, normalized_alias, source, created_at
                    ) VALUES (?, ?, ?, ?, 'ocr_correction', ?)
                    """,
                    (str(uuid.uuid4()), location_id, alias, normalized_alias, now),
                )
                connection.execute(
                    "UPDATE locations SET updated_at = ? WHERE location_id = ?",
                    (now, location_id),
                )
                connection.commit()
            updated = next(
                record for record in load_location_records(connection) if record["id"] == location_id
            )

        self.send_json(200 if duplicate else 201, {
            "ok": True,
            "duplicate": duplicate,
            "alias": alias,
            "archivedLocations": [row["name"] for row in provisional_conflicts],
            "location": updated,
        })

    def handle_delete_location(self, path: str) -> None:
        location_id = self.location_id_from_path(path)
        if not location_id:
            self.send_error(404, "Route not found")
            return
        with get_connection() as connection:
            existing = connection.execute(
                "SELECT name FROM locations WHERE location_id = ?",
                (location_id,),
            ).fetchone()
            if not existing:
                self.send_json(404, {"ok": False, "error": "LOCATION_NOT_FOUND"})
                return
            usage_count = load_location_usage_counts(connection).get(location_id, 0)
            if usage_count > 0:
                self.send_json(
                    409,
                    {
                        "ok": False,
                        "error": "LOCATION_IN_USE",
                        "message": "Referenced locations can only be archived.",
                        "usageCount": usage_count,
                    },
                )
                return
            connection.execute("DELETE FROM locations WHERE location_id = ?", (location_id,))
            connection.commit()
        self.send_json(200, {"ok": True, "id": location_id, "deleted": True})

    @staticmethod
    def location_id_from_path(path: str) -> str:
        parts = [part for part in path.split("/") if part]
        if len(parts) != 3 or parts[:2] != ["api", "locations"]:
            return ""
        return parts[2]

    def handle_create_import(self) -> None:
        try:
            payload = self.read_json_body(max_bytes=256 * 1024)
            normalized = normalize_mission_import_payload(payload)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_IMPORT", "message": str(error)})
            return


        import_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        with get_connection() as connection:
            known_locations = load_location_match_candidates(connection)
            if not known_locations:
                state_row = connection.execute(
                    "SELECT value FROM app_state WHERE state_key = ?",
                    (STATE_KEYS[normalized["scope"]],),
                ).fetchone()
                if state_row:
                    try:
                        known_locations = collect_known_locations(json.loads(state_row["value"]))
                    except (json.JSONDecodeError, TypeError):
                        known_locations = []
            match_import_locations(normalized, known_locations)
            serialized_payload = json.dumps(normalized, ensure_ascii=False)
            try:
                connection.execute(
                    """
                    INSERT INTO mission_imports (
                        import_id, scope, source_device, source_label, image_hash,
                        payload, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                    """,
                    (
                        import_id,
                        normalized["scope"],
                        normalized["sourceDevice"],
                        normalized["sourceLabel"],
                        normalized["imageHash"],
                        serialized_payload,
                        now,
                        now,
                    ),
                )
                connection.commit()
                duplicate = False
                status = "pending"
            except sqlite3.IntegrityError:
                row = connection.execute(
                    """
                    SELECT import_id, status
                    FROM mission_imports
                    WHERE scope = ? AND image_hash = ?
                    """,
                    (normalized["scope"], normalized["imageHash"]),
                ).fetchone()
                import_id = row["import_id"]
                status = row["status"]
                duplicate = True

        self.send_json(
            200 if duplicate else 201,
            {
                "ok": True,
                "id": import_id,
                "scope": normalized["scope"],
                "status": status,
                "duplicate": duplicate,
                "createdAt": now,
            },
        )

    def handle_update_import_status(self, path: str) -> None:
        path_parts = [part for part in path.split("/") if part]
        if len(path_parts) != 4 or path_parts[:2] != ["api", "imports"] or path_parts[3] != "status":
            self.send_error(404, "Route not found")
            return
        import_id = path_parts[2]

        try:
            payload = self.read_json_body(max_bytes=16 * 1024)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_JSON", "message": str(error)})
            return

        status = str(payload.get("status") or "").strip().lower()
        if status not in IMPORT_STATUSES:
            self.send_json(400, {"ok": False, "error": "INVALID_STATUS", "message": "Unsupported import status."})
            return

        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        scope = normalize_scope(params.get("scope", ["solo"])[0])
        updated_at = datetime.now(timezone.utc).isoformat()
        with get_connection() as connection:
            cursor = connection.execute(
                """
                UPDATE mission_imports
                SET status = ?, updated_at = ?
                WHERE import_id = ? AND scope = ?
                """,
                (status, updated_at, import_id, scope),
            )
            connection.commit()

        if cursor.rowcount == 0:
            self.send_json(404, {"ok": False, "error": "IMPORT_NOT_FOUND"})
            return
        self.send_json(200, {"ok": True, "id": import_id, "scope": scope, "status": status, "updatedAt": updated_at})

    def handle_reset_imports(self) -> None:
        if not self.is_import_authorized():
            self.send_json(401, {"ok": False, "error": "IMPORT_UNAUTHORIZED", "message": "Import token rejected."})
            return

        try:
            payload = self.read_json_body(max_bytes=16 * 1024)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_JSON", "message": str(error)})
            return

        requested_scope = str(payload.get("scope") or "").strip().lower()
        source_device = str(payload.get("deviceId") or "").strip()[:120]
        if requested_scope not in STATE_KEYS or not source_device:
            self.send_json(
                400,
                {"ok": False, "error": "INVALID_RESET", "message": "Scope and deviceId are required."},
            )
            return

        with get_connection() as connection:
            import_rows = connection.execute(
                "SELECT import_id FROM mission_imports WHERE scope = ? AND source_device = ?",
                (requested_scope, source_device),
            ).fetchall()
            import_ids = {row["import_id"] for row in import_rows}
            deleted_missions = 0
            state_key = STATE_KEYS[requested_scope]
            state_row = connection.execute(
                "SELECT value FROM app_state WHERE state_key = ?",
                (state_key,),
            ).fetchone()
            if state_row and import_ids:
                try:
                    stored_state = json.loads(state_row["value"])
                except (json.JSONDecodeError, TypeError):
                    stored_state = None
                if isinstance(stored_state, dict) and isinstance(stored_state.get("missions"), list):
                    missions = stored_state["missions"]
                    stored_state["missions"] = [
                        mission
                        for mission in missions
                        if not isinstance(mission, dict) or str(mission.get("sourceImportId") or "") not in import_ids
                    ]
                    deleted_missions = len(missions) - len(stored_state["missions"])
                    if deleted_missions > 0:
                        updated_at = datetime.now(timezone.utc).isoformat()
                        connection.execute(
                            "UPDATE app_state SET value = ?, updated_at = ? WHERE state_key = ?",
                            (json.dumps(stored_state, ensure_ascii=False), updated_at, state_key),
                        )
                        write_meta(connection, f"last_state_write_at_{requested_scope}", updated_at)
            cursor = connection.execute(
                "DELETE FROM mission_imports WHERE scope = ? AND source_device = ?",
                (requested_scope, source_device),
            )
            progress_cursor = connection.execute(
                "DELETE FROM companion_capture_jobs WHERE scope = ? AND source_device = ?",
                (requested_scope, source_device),
            )
            connection.commit()

        self.send_json(
            200,
            {
                "ok": True,
                "scope": requested_scope,
                "sourceDevice": source_device,
                "deleted": cursor.rowcount,
                "deletedMissions": deleted_missions,
                "deletedProgressJobs": progress_cursor.rowcount,
            },
        )

    def read_json_body(self, max_bytes: int) -> dict:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error
        if content_length <= 0:
            raise ValueError("Missing JSON body")
        if content_length > max_bytes:
            raise ValueError("JSON body too large")
        raw_body = self.rfile.read(content_length)
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Invalid JSON body") from error
        if not isinstance(payload, dict):
            raise ValueError("Invalid JSON body")
        return payload

    def is_import_authorized(self) -> bool:
        import_token = get_import_token()
        if not import_token:
            return True
        supplied_token = self.headers.get("X-Import-Token", "")
        return hmac.compare_digest(supplied_token, import_token)

    def get_ship_image_request(self) -> tuple[str, str]:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        scope = normalize_scope(params.get("scope", ["solo"])[0])
        profile_id = str(params.get("profile", [""])[0] or "").strip()[:200]
        if not profile_id:
            raise ValueError("Missing ship profile")
        return scope, profile_id

    def handle_upload_ship_image(self) -> None:
        try:
            scope, profile_id = self.get_ship_image_request()
            content_length = int(self.headers.get("Content-Length", "0"))
        except (TypeError, ValueError) as error:
            self.send_json(400, {"ok": False, "error": "INVALID_SHIP_IMAGE", "message": str(error)})
            return
        if content_length <= 0:
            self.send_json(400, {"ok": False, "error": "MISSING_SHIP_IMAGE", "message": "No image was uploaded."})
            return
        if content_length > SHIP_IMAGE_MAX_BYTES:
            self.send_json(413, {"ok": False, "error": "SHIP_IMAGE_TOO_LARGE", "message": "The image is larger than 5 MB."})
            return

        raw_body = self.rfile.read(content_length)
        image_type = detect_ship_image_type(raw_body)
        if not image_type:
            self.send_json(415, {"ok": False, "error": "UNSUPPORTED_SHIP_IMAGE", "message": "Only PNG, JPG and WebP images are supported."})
            return

        suffix, content_type = image_type
        SHIP_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
        prefix = get_ship_image_prefix(scope, profile_id)
        target_path = SHIP_IMAGE_DIR / f"{prefix}{suffix}"
        temp_path = SHIP_IMAGE_DIR / f".{prefix}-{uuid.uuid4().hex}.tmp"
        try:
            temp_path.write_bytes(raw_body)
            remove_ship_image_files(scope, profile_id)
            temp_path.replace(target_path)
        finally:
            if temp_path.exists():
                temp_path.unlink()

        version = int(target_path.stat().st_mtime_ns)
        image_url = f"/data/ship-images/{target_path.name}?v={version}"
        self.send_json(
            201,
            {
                "ok": True,
                "scope": scope,
                "profileId": profile_id,
                "url": image_url,
                "contentType": content_type,
                "size": len(raw_body),
            },
        )

    def handle_delete_ship_image(self) -> None:
        try:
            scope, profile_id = self.get_ship_image_request()
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": "INVALID_SHIP_IMAGE", "message": str(error)})
            return
        deleted = remove_ship_image_files(scope, profile_id)
        self.send_json(200, {"ok": True, "scope": scope, "profileId": profile_id, "deleted": deleted})

    def handle_backup(self) -> None:
        init_db()
        filename = f"cargo-planner-backup-{datetime.now().strftime('%Y-%m-%d')}.zip"
        backup_at = datetime.now(timezone.utc).isoformat()
        with get_connection() as connection:
            write_meta(connection, "last_backup_at", backup_at)
            connection.commit()
        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("cargo_planner.sqlite3", read_database_snapshot())
            archive.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "format": "star-citizen-tools-backup",
                        "version": 1,
                        "createdAt": backup_at,
                        "shipImages": len(list(SHIP_IMAGE_DIR.glob("ship-*"))) if SHIP_IMAGE_DIR.exists() else 0,
                    },
                    ensure_ascii=False,
                    indent=2,
                ).encode("utf-8"),
            )
            if SHIP_IMAGE_DIR.exists():
                for image_path in sorted(SHIP_IMAGE_DIR.glob("ship-*")):
                    if image_path.is_file() and image_path.suffix.lower() in {".png", ".jpg", ".webp"}:
                        archive.write(image_path, arcname=f"ship-images/{image_path.name}")
        body = archive_buffer.getvalue()
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Backup-At", backup_at)
        self.end_headers()
        self.wfile.write(body)

    def read_backup_upload(self) -> bytes | None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"error": "Invalid Content-Length"})
            return None
        if content_length > BACKUP_UPLOAD_MAX_BYTES:
            self.send_json(413, {"error": "Backup file too large"})
            return None
        raw_body = self.rfile.read(content_length) if content_length > 0 else b""
        if not raw_body:
            self.send_json(400, {"error": "Missing backup file"})
            return None
        return raw_body

    def handle_restore_preview(self) -> None:
        raw_body = self.read_backup_upload()
        if raw_body is None:
            return
        temp_path: Path | None = None
        try:
            database_body, restored_images, manifest, backup_kind = parse_backup_payload(raw_body)
            temp_path, backup_summary = write_validated_backup_database(database_body)
            with DB_FILE_LOCK:
                current_summary = inspect_backup_database(DB_PATH) if DB_PATH.exists() else {
                    "states": [],
                    "locations": 0,
                    "pendingImports": 0,
                    "captureJobs": 0,
                    "latestStateAt": None,
                }
            current_images = len(list(SHIP_IMAGE_DIR.glob("ship-*"))) if SHIP_IMAGE_DIR.exists() else 0
        except (OSError, sqlite3.DatabaseError, ValueError):
            self.send_json(400, {"ok": False, "error": "INVALID_BACKUP", "message": "Invalid backup file"})
            return
        finally:
            if temp_path:
                temp_path.unlink(missing_ok=True)

        created_at = str(manifest.get("createdAt") or "").strip()[:80] or None
        self.send_json(
            200,
            {
                "ok": True,
                "preview": {
                    "kind": backup_kind,
                    "format": str(manifest.get("format") or "").strip()[:120] or None,
                    "version": manifest.get("version") if isinstance(manifest.get("version"), int) else None,
                    "createdAt": created_at,
                    "databaseBytes": len(database_body),
                    "shipImages": len(restored_images) if restored_images is not None else None,
                    "imagesMode": "replace" if restored_images is not None else "keep",
                    "backup": backup_summary,
                    "current": {
                        **current_summary,
                        "shipImages": current_images,
                    },
                },
            },
        )

    def handle_restore(self) -> None:
        raw_body = self.read_backup_upload()
        if raw_body is None:
            return

        DATA_DIR.mkdir(parents=True, exist_ok=True)
        restore_stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        backup_path = DATA_DIR / f"cargo_planner.pre-restore-{restore_stamp}.sqlite3"
        try:
            database_body, restored_images, _manifest, _backup_kind = parse_backup_payload(raw_body)
            temp_path, _backup_summary = write_validated_backup_database(database_body)
        except (OSError, sqlite3.DatabaseError, ValueError):
            self.send_json(400, {"error": "Invalid backup file"})
            return

        database_backup_created = False
        database_installed = False
        image_backup_created = False
        image_installed = False
        image_backup_path = DATA_DIR / f"ship-images.pre-restore-{restore_stamp}"
        temp_image_dir: Path | None = None
        try:
            with DB_FILE_LOCK:
                if DB_PATH.exists():
                    DB_PATH.replace(backup_path)
                    database_backup_created = True
                temp_path.replace(DB_PATH)
                database_installed = True
                init_db()
                if restored_images is not None:
                    temp_image_dir = DATA_DIR / f".ship-images-restore-{uuid.uuid4().hex}"
                    temp_image_dir.mkdir(parents=True, exist_ok=False)
                    for image_name, image_body in restored_images.items():
                        (temp_image_dir / image_name).write_bytes(image_body)
                    if SHIP_IMAGE_DIR.exists():
                        SHIP_IMAGE_DIR.replace(image_backup_path)
                        image_backup_created = True
                    temp_image_dir.replace(SHIP_IMAGE_DIR)
                    image_installed = True
                restored_at = datetime.now(timezone.utc).isoformat()
                with get_connection() as connection:
                    # A restore is a new revision, even if it restores an older state.
                    connection.execute("UPDATE app_state SET updated_at = ?", (restored_at,))
                    write_meta(connection, "last_restore_at", restored_at)
                    connection.commit()
        except Exception:
            with DB_FILE_LOCK:
                temp_path.unlink(missing_ok=True)
                if database_installed and DB_PATH.exists():
                    DB_PATH.unlink(missing_ok=True)
                if database_backup_created and backup_path.exists():
                    backup_path.replace(DB_PATH)
                if image_installed and SHIP_IMAGE_DIR.exists():
                    shutil.rmtree(SHIP_IMAGE_DIR, ignore_errors=True)
                if image_backup_created and image_backup_path.exists():
                    image_backup_path.replace(SHIP_IMAGE_DIR)
                if temp_image_dir and temp_image_dir.exists():
                    shutil.rmtree(temp_image_dir, ignore_errors=True)
            self.send_json(400, {"error": "Invalid backup file"})
            return

        self.send_json(
            200,
            {
                "ok": True,
                "restoredAt": restored_at,
                "backupBeforeRestore": backup_path.name if backup_path.exists() else None,
                "imagesRestored": len(restored_images or {}),
            },
        )

    def handle_ocr(self) -> None:
        from companion.app import resolve_tesseract
        tesseract_path = resolve_tesseract(None)
        if not tesseract_path:
            self.send_json(
                501,
                {
                    "ok": False,
                    "error": "OCR_NOT_CONFIGURED",
                    "message": "Tesseract OCR ist auf diesem Rechner noch nicht installiert oder nicht im PATH.",
                },
            )
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            self.send_json(400, {"ok": False, "error": "MISSING_IMAGE", "message": "Es wurde kein Screenshot übertragen."})
            return
        if content_length > 8 * 1024 * 1024:
            self.send_json(413, {"ok": False, "error": "IMAGE_TOO_LARGE", "message": "Der Screenshot ist größer als 8 MB."})
            return

        raw_body = self.rfile.read(content_length)
        suffix = ".png"
        content_type = self.headers.get("Content-Type", "")
        if "jpeg" in content_type or "jpg" in content_type:
            suffix = ".jpg"
        elif "webp" in content_type:
            suffix = ".webp"

        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            temp_file.write(raw_body)
            temp_path = Path(temp_file.name)

        try:
            result = subprocess.run(
                [tesseract_path, str(temp_path), "stdout", "-l", "eng", "--psm", "6"],
                check=False,
                capture_output=True,
                text=True,
                timeout=20,
                **hidden_subprocess_options(),
            )
        except subprocess.TimeoutExpired:
            self.send_json(504, {"ok": False, "error": "OCR_TIMEOUT", "message": "OCR hat zu lange gedauert."})
            return
        finally:
            if temp_path.exists():
                temp_path.unlink()

        if result.returncode != 0:
            self.send_json(
                500,
                {
                    "ok": False,
                    "error": "OCR_FAILED",
                    "message": "Der Screenshot konnte nicht gelesen werden.",
                    "details": result.stderr.strip()[:500],
                },
            )
            return

        self.send_json(200, {"ok": True, "text": result.stdout})

    def send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    init_db()
    server = ThreadingHTTPServer((HOST, PORT), CargoPlannerHandler)
    print(f"Star Citizen Tool Suite läuft auf http://{HOST}:{PORT}")
    if HOST == "0.0.0.0":
        print("Netzwerkmodus aktiv: Der Server ist für andere Geräte im lokalen Netz erreichbar.")
    else:
        print("Lokaler Modus aktiv: Der Server ist nur auf diesem Rechner erreichbar.")
    print(f"SQLite-Datenbank: {DB_PATH}")
    if get_import_token():
        print("Companion-Import: Token-Schutz aktiv.")
    else:
        print("Companion-Import: ohne Token-Schutz (nur für vertrauenswürdige Netze empfohlen).")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
