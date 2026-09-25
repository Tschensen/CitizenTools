"""Versioned, personal interchange files shared with the PHP suite."""
import base64
import copy
import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit

FORMAT = "citizen-tools-personal-transfer"
MAX_BYTES = 32 * 1024 * 1024
COLLECTIONS = {"shipLibrary": 500, "fleet": 500, "missions": 500, "ledgerEntries": 1000, "contacts": 500}
EXTRAS = ("layout", "pilots", "soloPilotId", "activeFleetEntryId", "autoload", "stopHistory", "currentLocation",
          "selectedStopDropoff", "selectedRunRoutePointKey", "runPriorityRouteLocation", "runCompletedRoutePoints")
PRIVATE = {"_onlineMeta", "organization", "pilotGroups", "organizationLink", "organizationOrigin", "organizationProgress",
           "participantAllocations", "participants", "participantProgress", "onlineAssigneeIds", "groupId", "workspaceId",
           "payoutSplit", "payoutSettlement", "permissions", "roles", "createdBy", "ownerUserId"}


def clean(value):
    if isinstance(value, list):
        return [clean(item) for item in value]
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items() if key not in PRIVATE and key not in {"__proto__", "constructor", "prototype"}}
    return value


def personal_state(state):
    result = clean({key: copy.deepcopy(state.get(key, [])) for key in COLLECTIONS} |
                   {key: copy.deepcopy(state[key]) for key in EXTRAS if key in state})
    canonical_ids(result)
    return result


def stable_uuid(key):
    digest = hashlib.sha256(('citizen-tools-personal:' + key).encode()).hexdigest()
    return f'{digest[:8]}-{digest[8:12]}-5{digest[13:16]}-8{digest[17:20]}-{digest[20:32]}'


def canonical_ids(state):
    # HTTP tablet origins may lack crypto.randomUUID. Convert their fallback IDs
    # identically in both suites so a return transfer merges with the original.
    mapping = {}
    for key in ('missions', 'contacts'):
        records = state.get(key, [])
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get('id'), str):
                continue
            identifier = record['id']
            if re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9:_-]{0,95}', identifier) and not re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', identifier, re.I):
                record['id'] = stable_uuid(key + ':' + identifier)
                if key == 'missions':
                    mapping[identifier] = record['id']
    for entry in state.get('ledgerEntries', []) if isinstance(state.get('ledgerEntries'), list) else []:
        if isinstance(entry, dict) and isinstance(entry.get('missionId'), str) and entry['missionId'] in mapping:
            entry['missionId'] = mapping[entry['missionId']]
    for entry in state.get('stopHistory', []) if isinstance(state.get('stopHistory'), list) else []:
        if isinstance(entry, dict) and isinstance(entry.get('missionIds'), list):
            entry['missionIds'] = [mapping.get(identifier, identifier) if isinstance(identifier, str) else identifier for identifier in entry['missionIds']]


def parse(document):
    if not isinstance(document, dict):
        raise ValueError("transfer_invalid_file")
    if document.get("format") == FORMAT:
        if document.get("version") != 1:
            raise ValueError("transfer_unsupported_version")
        source = document.get("state")
    elif document.get("format") == "citizen-tools-online-personal-backup" and document.get("version") == 1:
        source = document.get("state")
    elif "format" not in document:
        source = document
    else:
        raise ValueError("transfer_invalid_file")
    if not isinstance(source, dict) or not all(isinstance(source.get(key), list) for key in ("shipLibrary", "fleet", "missions", "ledgerEntries")):
        raise ValueError("transfer_invalid_file")
    state = personal_state(source)
    for key in ("pilots", "stopHistory"):
        if key in state and (not isinstance(state[key], list) or len(state[key]) > 1000 or any(not isinstance(r, dict) or not isinstance(r.get("id"), str) for r in state[key])):
            raise ValueError("transfer_invalid_record")
    for key in ("layout", "autoload"):
        if key in state and not isinstance(state[key], dict):
            raise ValueError("transfer_invalid_record")
    if "runCompletedRoutePoints" in state and (not isinstance(state["runCompletedRoutePoints"], list) or any(not isinstance(r, str) for r in state["runCompletedRoutePoints"])):
        raise ValueError("transfer_invalid_record")
    for key, limit in COLLECTIONS.items():
        records = state[key]
        if not isinstance(records, list) or len(records) > limit:
            raise ValueError("transfer_collection_limit")
        seen = set()
        for record in records:
            if not isinstance(record, dict) or not isinstance(record.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:_-]{0,95}", record["id"]) or record["id"] in seen:
                raise ValueError("transfer_invalid_record")
            seen.add(record["id"])
            if key in ("shipLibrary", "fleet") and not (record.get("manufacturer") and record.get("model")):
                raise ValueError("transfer_invalid_record")
            if key == "fleet" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(record.get("acquiredOn", ""))):
                raise ValueError("transfer_invalid_record")
            if key == "missions" and not record.get("title"):
                raise ValueError("transfer_invalid_record")
            if key == "contacts" and not record.get("name"):
                raise ValueError("transfer_invalid_record")
            if key == "ledgerEntries":
                try:
                    valid = 0 < float(record.get("amountAuec", 0)) <= 999999999999.99 and record.get("category") and re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(record.get("bookedOn", "")))
                except (ValueError, TypeError):
                    valid = False
                if not valid:
                    raise ValueError("transfer_invalid_record")
    assets = document.get("images", {})
    if not isinstance(assets, dict) or len(assets) > 1000:
        raise ValueError("transfer_invalid_image")
    return state, assets


def image_bytes(encoded):
    from server import app as backend
    try:
        body = base64.b64decode(encoded, validate=True)
    except (ValueError, TypeError):
        raise ValueError("transfer_invalid_image") from None
    detected = backend.detect_ship_image_type(body)
    if not detected or len(body) > 5 * 1024 * 1024:
        raise ValueError("transfer_invalid_image")
    return body, detected[0]


def prepare_images(state, assets):
    files = {}
    # Decode every asset before writing anything; filenames never come from the file.
    decoded = {url: image_bytes(value) for url, value in assets.items()}
    for key in ("shipLibrary", "fleet"):
        for record in state[key]:
            url = str(record.get("imageUrl", ""))
            if url in decoded:
                body, extension = decoded[url]
                name = f"ship-{hashlib.sha256(body).hexdigest()[:24]}{extension}"
                files[name] = body
                record["imageUrl"] = f"/data/ship-images/{name}"
            elif url and not url.startswith(("https://", "http://")):
                # Legacy files contain only paths belonging to the source installation.
                record["imageUrl"] = ""
    return files


def export(state, image_directory):
    state = personal_state(state)
    images = {}
    for key in ("shipLibrary", "fleet"):
        for record in state[key]:
            url = str(record.get("imageUrl", ""))
            path = urlsplit(url).path
            if not urlsplit(url).netloc and re.fullmatch(r"/?data/ship-images/ship-[a-f0-9]{24}\.(png|jpg|webp)", path):
                file = image_directory / path.rsplit("/", 1)[-1]
                if not file.is_file():
                    raise ValueError("transfer_missing_image")
                images[url] = base64.b64encode(file.read_bytes()).decode("ascii")
    result = {"format": FORMAT, "version": 1, "source": "offline", "createdAt": datetime.now(timezone.utc).isoformat(), "state": state, "images": images}
    if len(json.dumps(result).encode()) > MAX_BYTES:
        raise ValueError("transfer_too_large")
    return result


def merge(current, incoming, mode):
    current = {**current, **personal_state(current)}
    result = copy.deepcopy(current)
    for key in COLLECTIONS:
        records = {} if mode == "replace" else {record["id"]: record for record in current.get(key, [])}
        records.update({record["id"]: record for record in incoming[key]})
        result[key] = list(records.values())
        if len(result[key]) > COLLECTIONS[key]:
            raise ValueError("transfer_collection_limit")
    # Merging adds records, preserving the current ship selection and route.
    for key in EXTRAS:
        if mode == "replace":
            result.pop(key, None)
        if key in ("pilots", "stopHistory") and mode == "merge":
            records = {record["id"]: record for record in current.get(key, []) if isinstance(record, dict) and "id" in record}
            records.update({record["id"]: record for record in incoming.get(key, []) if isinstance(record, dict) and "id" in record})
            result[key] = list(records.values())
        elif key in incoming and (mode == "replace" or key not in result):
            result[key] = incoming[key]
    return result


def preview(current, incoming):
    current = personal_state(current)
    return [{"key": key, "current": len(current.get(key, [])), "incoming": len(incoming[key]),
             "updated": len({r["id"] for r in current.get(key, [])} & {r["id"] for r in incoming[key]})} for key in COLLECTIONS]
