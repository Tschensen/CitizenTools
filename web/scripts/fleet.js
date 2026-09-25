function fleetText(key, fallback, params = {}) {
  if (typeof window.t === "function") return window.t(key, params);
  return String(fallback || "").replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

const FLEET_IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
let pendingFleetImageFile = null;
let fleetImagePreviewObjectUrl = "";
let originalFleetImageUrl = "";
let fleetImageRemovalRequested = false;
let fleetPatchRegistrationDrafts = new Map();

function getFleetMediaEntry(entry, shipType = findShipLibraryEntryById(entry?.shipId)) {
  return {
    ...(shipType || entry || {}),
    manufacturer: entry?.manufacturer || shipType?.manufacturer || "",
    model: entry?.model || shipType?.model || "",
    imageUrl: normalizeShipImageUrl(entry?.imageUrl) || normalizeShipImageUrl(shipType?.imageUrl),
  };
}

function setFleetImageStatus(message = "", severity = "neutral") {
  if (!fleetImageStatus) return;
  fleetImageStatus.textContent = message;
  fleetImageStatus.className = `form-hint form-hint-${severity} shipdb-image-status`;
  fleetImageStatus.hidden = !message;
}

function revokeFleetImagePreviewObjectUrl() {
  if (!fleetImagePreviewObjectUrl) return;
  URL.revokeObjectURL(fleetImagePreviewObjectUrl);
  fleetImagePreviewObjectUrl = "";
}

function clearPendingFleetImage() {
  pendingFleetImageFile = null;
  revokeFleetImagePreviewObjectUrl();
  if (fleetImageFileInput) fleetImageFileInput.value = "";
}

function syncFleetImageControls() {
  const imageUrl = normalizeShipImageUrl(fleetForm?.imageUrl?.value);
  if (fleetImageRemoveButton) fleetImageRemoveButton.disabled = !pendingFleetImageFile && !imageUrl;
  if (fleetImageRecognizeButton) fleetImageRecognizeButton.disabled = !pendingFleetImageFile && !imageUrl;
}

function syncFleetImagePreview() {
  if (!fleetImagePreviewWrap || !fleetImagePreview || !fleetForm?.imageUrl) return;
  if (pendingFleetImageFile && fleetImagePreviewObjectUrl) {
    fleetImagePreviewWrap.hidden = false;
    fleetImagePreviewWrap.classList.remove("is-image-error");
    fleetImagePreview.src = fleetImagePreviewObjectUrl;
    fleetImagePreview.alt = pendingFleetImageFile.name;
    syncFleetImageControls();
    return;
  }
  const imageUrl = normalizeShipImageUrl(fleetForm.imageUrl.value);
  fleetImagePreviewWrap.hidden = !imageUrl;
  fleetImagePreviewWrap.classList.remove("is-image-error");
  if (imageUrl) {
    fleetImagePreview.src = imageUrl;
    fleetImagePreview.alt = fleetText("fleet.image.previewAlt", "Individuelles Bild des Flottenschiffs");
  } else {
    fleetImagePreview.removeAttribute("src");
    fleetImagePreview.alt = "";
  }
  syncFleetImageControls();
}

function selectFleetImageFile(file) {
  if (!file) return;
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!supportedTypes.has(String(file.type || "").toLowerCase())) {
    if (fleetImageFileInput) fleetImageFileInput.value = "";
    setFleetImageStatus(fleetText("fleet.image.unsupported", "Bitte wähle eine PNG-, JPG- oder WebP-Datei."), "error");
    return;
  }
  if (file.size <= 0 || file.size > FLEET_IMAGE_UPLOAD_MAX_BYTES) {
    if (fleetImageFileInput) fleetImageFileInput.value = "";
    setFleetImageStatus(fleetText("fleet.image.tooLarge", "Das Bild darf höchstens 5 MB groß sein."), "error");
    return;
  }
  clearPendingFleetImage();
  pendingFleetImageFile = file;
  fleetImageRemovalRequested = false;
  fleetImagePreviewObjectUrl = URL.createObjectURL(file);
  syncFleetImagePreview();
  setFleetImageStatus(fleetText("fleet.image.selected", "{name} wird beim Speichern importiert.", { name: file.name }), "success");
}

async function uploadFleetImage(file, fleetEntryId) {
  const params = new URLSearchParams({ scope: activeAppMode, profile: `fleet:${fleetEntryId}` });
  const response = await fetch(`./api/ship-images?${params}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream", Accept: "application/json" },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.url) {
    throw new Error(payload.message || fleetText("fleet.image.uploadFailed", "Das Bild konnte nicht importiert werden."));
  }
  return normalizeShipImageUrl(payload.url);
}

async function deleteFleetImage(fleetEntryId) {
  const params = new URLSearchParams({ scope: activeAppMode, profile: `fleet:${fleetEntryId}` });
  const response = await fetch(`./api/ship-images?${params}`, { method: "DELETE", headers: { Accept: "application/json" } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || fleetText("fleet.image.removeFailed", "Das individuelle Bild konnte nicht entfernt werden."));
  }
}

function extractFleetRegistrationCandidate(ocrText) {
  const normalizedText = String(ocrText || "")
    .toUpperCase()
    .replace(/[–—−]/g, "-")
    .replace(/[^A-Z0-9\s-]/g, " ");
  const ignoredPrefixes = new Set(["AUEC", "HULL", "PATCH", "REG", "REGISTRATION", "SCU", "SERIAL", "SHIP", "STAR", "UEC"]);
  const candidates = [];

  normalizedText.split(/\r?\n/).forEach((line, lineIndex) => {
    const tokens = line.trim().split(/[\s-]+/).filter(Boolean);
    for (let index = 0; index <= tokens.length - 3; index += 1) {
      const [prefix, middle, suffix] = tokens.slice(index, index + 3);
      if (!/^[A-Z]{1,4}$/.test(prefix) || !/^[A-Z0-9]{2,8}$/.test(middle) || !/^[A-Z0-9]{1,5}$/.test(suffix)) continue;
      if (ignoredPrefixes.has(prefix)) continue;
      const value = `${prefix}-${middle}-${suffix}`;
      if (!/\d/.test(value) || value.length < 7 || value.length > 20) continue;
      const score = (/^\d+$/.test(middle) ? 6 : 0)
        + (/^[A-Z]+$/.test(suffix) ? 2 : 0)
        + (prefix.length <= 3 ? 2 : 0)
        + (suffix.length <= 3 ? 1 : 0)
        + (line.includes(value) ? 1 : 0);
      candidates.push({ value, score, order: lineIndex * 100 + index });
    }
  });

  candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  return candidates[0]?.value || "";
}

async function recognizeFleetRegistration() {
  const imageUrl = normalizeShipImageUrl(fleetForm?.imageUrl?.value);
  let imageBody = pendingFleetImageFile;
  if (!imageBody && imageUrl) {
    const imageResponse = await fetch(imageUrl, { cache: "no-store" });
    if (imageResponse.ok) imageBody = await imageResponse.blob();
  }
  if (!imageBody) {
    setFleetImageStatus(fleetText("fleet.image.noImageForOcr", "Wähle zuerst ein individuelles Bild aus."), "warning");
    return;
  }

  fleetImageRecognizeButton.disabled = true;
  setFleetImageStatus(fleetText("fleet.image.recognizing", "Registriernummer wird gesucht ..."), "neutral");
  try {
    const response = await fetch("./api/ocr", {
      method: "POST",
      headers: { "Content-Type": imageBody.type || "application/octet-stream", Accept: "application/json" },
      body: imageBody,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || fleetText("fleet.image.ocrFailed", "Die Registriernummer konnte nicht gelesen werden."));
    }
    const candidate = extractFleetRegistrationCandidate(payload.text);
    if (!candidate) {
      setFleetImageStatus(fleetText("fleet.image.ocrNoMatch", "Keine eindeutige Registriernummer erkannt. Das Bild bleibt trotzdem verwendbar."), "warning");
      return;
    }
    fleetForm.registration.value = candidate;
    setFleetImageStatus(fleetText("fleet.image.ocrFound", "Erkannt: {registration}. Bitte prüfe den Vorschlag vor dem Speichern.", { registration: candidate }), "success");
  } catch (error) {
    setFleetImageStatus(error?.message || fleetText("fleet.image.ocrFailed", "Die Registriernummer konnte nicht gelesen werden."), "warning");
  } finally {
    syncFleetImageControls();
  }
}

function renderFleetCargoMeta(shipType) {
  if (!shipType) return "";
  const summary = getShipGridSummary(shipType);
  const officialCargo = summary.official.totalScu || Number(shipType.cargoScu) || 0;
  const maxCargo = Math.max(officialCargo, summary.total.totalScu || 0);
  if (maxCargo <= 0) return "";

  const cargoLabel = summary.overload.totalScu > 0 && summary.total.totalScu > officialCargo
    ? fleetText("fleet.card.officialMax", "{official} offiziell · {max} max", {
        official: formatScuAmount(officialCargo),
        max: formatScuAmount(summary.total.totalScu),
      })
    : formatScuAmount(maxCargo);
  const containerSupport = getShipStandardContainerSupport(shipType);
  const officialContainer = containerSupport.officialProfile?.label || fleetText("fleet.card.noStandardContainer", "kein Standardcontainer");
  const totalContainer = containerSupport.totalProfile?.label || officialContainer;
  const containerLabel = summary.overload.totalScu > 0 && totalContainer !== officialContainer
    ? `${officialContainer} · ${totalContainer} ${fleetText("fleet.card.withOverload", "mit Überladung")}`
    : officialContainer;
  const manualContainerNote = containerSupport.maxContainerSizeKey
    ? containerSupport.maxContainerSizeKey === "none"
      ? fleetText("fleet.card.manualNoContainer", "Manuell: kein Standardcontainer")
      : fleetText("fleet.card.manualLimited", "(manuell begrenzt)")
    : "";

  return `
    <div>
      <span>${escapeHtml(fleetText("fleet.card.maxCargo", "Maximalfracht"))}</span>
      <strong>${escapeHtml(cargoLabel)}</strong>
    </div>
    <div>
      <span>${escapeHtml(fleetText("fleet.card.maxContainer", "Max. Containergröße"))}</span>
      <strong>${escapeHtml(containerLabel)}</strong>
      ${manualContainerNote ? `<small>${escapeHtml(manualContainerNote)}</small>` : ""}
    </div>
  `;
}

const FLEET_ACTION_ICONS = {
  active: `<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 13.7-3.5-3.5 1.4-1.4 2.1 2.1 4.7-4.8 1.4 1.4-6.1 6.3z" />`,
  setActive: `<path d="M11 2h2v3.1a7 7 0 0 1 5.9 5.9H22v2h-3.1a7 7 0 0 1-5.9 5.9V22h-2v-3.1A7 7 0 0 1 5.1 13H2v-2h3.1A7 7 0 0 1 11 5.1V2zm1 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" />`,
  edit: `<path d="M4 17.3V21h3.7L18.8 9.9l-3.7-3.7L4 17.3zm13.4-13.4 2.7 2.7a1 1 0 0 1 0 1.4l-1.1 1.1-4.1-4.1L16 3.9a1 1 0 0 1 1.4 0z" />`,
  costs: `<path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2zm3 5v2h6V7H9zm0 4v2h6v-2H9zm0 4v2h4v-2H9z" />`,
  details: `<path d="m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6 1.4-1.4z" />`,
};

function renderFleetActionIconButton({ className, label, icon, ariaDisabled = false }) {
  const escapedLabel = escapeHtml(label);
  return `
    <button class="${className} icon-only-button tooltip-button" type="button" aria-label="${escapedLabel}" title="${escapedLabel}" data-tooltip="${escapedLabel}"${ariaDisabled ? ' aria-disabled="true"' : ""}>
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          ${icon}
        </svg>
      </span>
    </button>
  `;
}

let activeFleetView = "ships";
let expandedFleetGroupId = "current";
let expandedFleetArchiveGroupId = "sold";
let expandedFleetCardId = "";
let selectedFleetDossierEntryId = "";
let fleetDossierReturnView = "ships";

function getFleetExpandedGroupId(scope) {
  return scope === "archive" ? expandedFleetArchiveGroupId : expandedFleetGroupId;
}

function setFleetExpandedGroupId(scope, groupId) {
  if (scope === "archive") {
    expandedFleetArchiveGroupId = groupId;
    return;
  }
  expandedFleetGroupId = groupId;
}

function setFleetView(view) {
  const requestedView = ["form", "ships", "archive", "dossier"].includes(view) ? view : "ships";
  activeFleetView = requestedView === "dossier" && !state.fleet.some((entry) => entry.id === selectedFleetDossierEntryId)
    ? "ships"
    : requestedView;
  syncFleetViewState();
  renderFleetSummary();
}

function syncFleetViewState() {
  const isEditing = Boolean(fleetForm?.entryId?.value);
  const translate = (key, fallback) => (typeof window.t === "function" ? window.t(key) : fallback);
  if (fleetFormTitle) {
    fleetFormTitle.textContent = isEditing ? translate("fleet.form.title.edit", "Schiff bearbeiten") : translate("fleet.form.title.entry", "Flotteneintrag");
  }
  if (fleetFormDescription) {
    fleetFormDescription.textContent = isEditing
      ? translate("fleet.form.description.edit", "Passe den bestehenden Flotteneintrag an, ohne die Historie zu verlieren.")
      : translate("fleet.form.description.entry", "Lege jedes Schiff als eigenen Eintrag an, auch wenn es später zerstört oder durch einen Patch ersetzt wurde.");
  }
  fleetViewTabs.forEach((button) => {
    const isActive = button.dataset.fleetViewTarget === activeFleetView;
    const shipsLabel = typeof isDispatcherMode === "function" && isDispatcherMode()
      ? translate("fleet.tabs.orgShips", "Unsere Schiffe")
      : translate("fleet.tabs.ships", "Meine Schiffe");
    const defaultLabels = {
      form: isEditing ? translate("fleet.tabs.edit", "Schiff bearbeiten") : translate("fleet.tabs.entry", "Flotteneintrag"),
      ships: shipsLabel,
      archive: translate("fleet.tabs.archive", "Flottenarchiv"),
      dossier: translate("fleet.tabs.dossier", "Schiffsakte"),
    };
    if (button.dataset.fleetViewTarget === "dossier") {
      button.hidden = activeFleetView !== "dossier";
    }
    button.textContent = defaultLabels[button.dataset.fleetViewTarget] || button.textContent;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  fleetViewSections.forEach((section) => {
    section.hidden = section.dataset.fleetView !== activeFleetView;
  });
  const summaryPanel = fleetSummary?.closest(".panel-fleet-summary");
  if (summaryPanel) summaryPanel.hidden = activeFleetView === "dossier";
  syncFleetDispatcherCrewFields();
}

function getActiveMissionsAssignedToFleetEntry(fleetEntryId) {
  if (!fleetEntryId) return [];
  return state.missions.filter(
    (mission) => isMissionActive(mission) && mission.assignedFleetEntryId === fleetEntryId,
  );
}

function closeShipMissionDialog(result = false) {
  if (!shipMissionDialog) return;
  shipMissionDialog.hidden = true;
  shipMissionDialog.dataset.result = result ? "confirm" : "cancel";
  shipMissionDialog.dispatchEvent(new CustomEvent("ship-mission-dialog-close"));
}

function showShipMissionDialog({ fromEntry, toEntry, missions }) {
  if (!shipMissionDialog || !shipMissionDialogMessage || !shipMissionDialogList) {
    return Promise.resolve(true);
  }

  const missionCount = missions.length;
  const missionWord = missionCount === 1
    ? fleetText("fleet.dialog.missionWordOne", "aktiver Auftrag")
    : fleetText("fleet.dialog.missionWordMany", "aktive Aufträge");
  shipMissionDialogMessage.textContent = fleetText(
    "fleet.dialog.switchMessage",
    "{from} hat noch {count} {missionWord}. Wenn du zu {to} wechselst, bleiben diese Aufträge dem bisherigen Schiff zugeordnet.",
    {
      from: formatFleetEntryDisplayName(fromEntry),
      to: formatFleetEntryDisplayName(toEntry),
      count: missionCount,
      missionWord,
    },
  );
  shipMissionDialogList.innerHTML = missions
    .slice(0, 5)
    .map(
      (mission) => `
        <article class="app-dialog-list-item">
          <strong>${escapeHtml(mission.title)}</strong>
          <span>${escapeHtml(getMissionTypeLabel(mission))} · ${escapeHtml(summarizeMissionRoute(mission))}</span>
        </article>
      `,
    )
    .join("");

  if (missions.length > 5) {
    shipMissionDialogList.insertAdjacentHTML(
      "beforeend",
      `<p class="app-dialog-more">${escapeHtml(fleetText("fleet.dialog.more", "und {count} weitere", { count: missions.length - 5 }))}</p>`,
    );
  }

  shipMissionDialog.hidden = false;
  shipMissionDialog.dataset.result = "cancel";
  shipMissionDialogConfirm?.focus();

  return new Promise((resolve) => {
    const handleClose = () => {
      cleanup();
      resolve(shipMissionDialog.dataset.result === "confirm");
    };
    const handleCancel = () => closeShipMissionDialog(false);
    const handleConfirm = () => closeShipMissionDialog(true);
    const handleBackdrop = (event) => {
      if (event.target === shipMissionDialog) closeShipMissionDialog(false);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") closeShipMissionDialog(false);
    };
    const cleanup = () => {
      shipMissionDialog.removeEventListener("ship-mission-dialog-close", handleClose);
      shipMissionDialogCancel?.removeEventListener("click", handleCancel);
      shipMissionDialogConfirm?.removeEventListener("click", handleConfirm);
      shipMissionDialog.removeEventListener("click", handleBackdrop);
      document.removeEventListener("keydown", handleKeydown);
    };

    shipMissionDialog.addEventListener("ship-mission-dialog-close", handleClose, { once: true });
    shipMissionDialogCancel?.addEventListener("click", handleCancel);
    shipMissionDialogConfirm?.addEventListener("click", handleConfirm);
    shipMissionDialog.addEventListener("click", handleBackdrop);
    document.addEventListener("keydown", handleKeydown);
  });
}

function closeFleetReplacementDialog(result = "abort") {
  if (!fleetReplacementDialog) return;
  fleetReplacementDialog.hidden = true;
  fleetReplacementDialog.dataset.result = result;
  fleetReplacementDialog.dispatchEvent(new CustomEvent("fleet-replacement-dialog-close"));
}

function showFleetReplacementDialog({ mode, entry }) {
  if (
    !fleetReplacementDialog ||
    !fleetReplacementDialogTitle ||
    !fleetReplacementDialogMessage ||
    !fleetReplacementRegistration ||
    !fleetReplacementDialogConfirm
  ) {
    return Promise.resolve({ createReplacement: mode === "pledge-destroyed", registration: "" });
  }

  const mandatory = mode === "pledge-destroyed";
  const shipName = `${entry.manufacturer} ${entry.model}`.trim();
  if (fleetReplacementDialogKicker) {
    fleetReplacementDialogKicker.textContent = fleetText("fleet.replacement.kicker", "Flottenhistorie");
  }
  fleetReplacementDialogTitle.textContent = mandatory
    ? fleetText("fleet.replacement.destroyedTitle", "Echtgeld-Schiff neu anlegen")
    : fleetText("fleet.replacement.patchTitle", "Ersatzschiff anlegen?");
  fleetReplacementDialogMessage.textContent = mandatory
    ? fleetText("fleet.replacement.destroyedMessage", "{ship} ist als Echtgeld-Schiff markiert. Beim Status \"Zerstört\" wird automatisch ein neuer aktiver Eintrag erstellt.", { ship: shipName })
    : fleetText("fleet.replacement.patchMessage", "{ship} wurde durch einen Patch ersetzt. Soll direkt ein neuer aktiver Eintrag mit gleichem Schiffsprofil erstellt werden?", { ship: shipName });
  fleetReplacementRegistration.value = "";

  if (fleetReplacementDialogAbort) {
    fleetReplacementDialogAbort.textContent = fleetText("common.cancel", "Abbrechen");
  }
  if (fleetReplacementDialogCancel) {
    fleetReplacementDialogCancel.hidden = mandatory;
    fleetReplacementDialogCancel.textContent = fleetText("fleet.replacement.skip", "Nein, nur archivieren");
  }
  fleetReplacementDialogConfirm.textContent = mandatory
    ? fleetText("fleet.replacement.createRequired", "Ersatz anlegen")
    : fleetText("fleet.replacement.create", "Ja, Ersatz anlegen");

  translateStaticText(fleetReplacementDialog);
  fleetReplacementDialog.hidden = false;
  fleetReplacementDialog.dataset.result = "abort";
  fleetReplacementRegistration.focus();

  return new Promise((resolve) => {
    const buildResult = (result) => ({
      aborted: result === "abort",
      createReplacement: result !== "abort" && (mandatory || result === "confirm"),
      registration: String(fleetReplacementRegistration.value || "").trim(),
    });
    const finish = (result) => {
      cleanup();
      closeFleetReplacementDialog(result);
      resolve(buildResult(result));
    };
    const handleClose = () => {
      cleanup();
      resolve(buildResult(fleetReplacementDialog.dataset.result || "abort"));
    };
    const handleAbort = () => finish("abort");
    const handleCancel = () => finish("skip");
    const handleConfirm = () => finish("confirm");
    const handleBackdrop = (event) => {
      if (event.target === fleetReplacementDialog) finish("abort");
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") finish("abort");
    };
    const cleanup = () => {
      fleetReplacementDialog.removeEventListener("fleet-replacement-dialog-close", handleClose);
      fleetReplacementDialogAbort?.removeEventListener("click", handleAbort);
      fleetReplacementDialogCancel?.removeEventListener("click", handleCancel);
      fleetReplacementDialogConfirm.removeEventListener("click", handleConfirm);
      fleetReplacementDialog.removeEventListener("click", handleBackdrop);
      document.removeEventListener("keydown", handleKeydown);
    };

    fleetReplacementDialog.addEventListener("fleet-replacement-dialog-close", handleClose, { once: true });
    fleetReplacementDialogAbort?.addEventListener("click", handleAbort);
    fleetReplacementDialogCancel?.addEventListener("click", handleCancel);
    fleetReplacementDialogConfirm.addEventListener("click", handleConfirm);
    fleetReplacementDialog.addEventListener("click", handleBackdrop);
    document.addEventListener("keydown", handleKeydown);
  });
}

const FLEET_WIPE_NOTE_PATTERNS = [
  /^Durch Wipe (?:entfernt|ersetzt)\.?$/i,
  /^Durch Wipe(?: in Patch)? .+ (?:entfernt|ersetzt)\.?$/i,
  /^(?:Removed|Replaced) by wipe\.?$/i,
  /^Removed by wipe(?: in patch)? .+\.?$/i,
  /^Replaced by wipe(?: in patch)? .+\.?$/i,
];

function buildFleetWipeNotes(notes, patchVersion, replaced) {
  const baseNotes = String(notes || "")
    .split(/\r?\n/)
    .filter((line) => !FLEET_WIPE_NOTE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .trim();
  const wipeNote = patchVersion
    ? replaced
      ? fleetText("fleet.wipe.noteReplaced", "Durch Wipe in Patch {version} ersetzt", { version: patchVersion })
      : fleetText("fleet.wipe.noteRemoved", "Durch Wipe in Patch {version} entfernt", { version: patchVersion })
    : replaced
      ? fleetText("fleet.wipe.noteReplacedNoVersion", "Durch Wipe ersetzt")
      : fleetText("fleet.wipe.noteRemovedNoVersion", "Durch Wipe entfernt");
  return [baseNotes, wipeNote].filter(Boolean).join("\n");
}

function getFleetWipeEntries() {
  return state.fleet.filter((entry) => entry.status === "active");
}

function closeFleetWipeDialog() {
  if (!fleetWipeDialog) return;
  fleetWipeDialog.hidden = true;
}

function getFleetPatchChangeMode() {
  return fleetWipeModeFull?.checked ? "wipe" : "reset";
}

function renderFleetPatchChangePreview() {
  [...(fleetWipeReplacementList?.querySelectorAll("[data-wipe-registration-id]") || [])].forEach((input) => {
    fleetPatchRegistrationDrafts.set(input.dataset.wipeRegistrationId, String(input.value || "").trim());
  });
  const entries = getFleetWipeEntries();
  const mode = getFleetPatchChangeMode();
  const pledgeEntries = entries.filter((entry) => entry.pledgePurchased);
  const ingameEntries = entries.filter((entry) => !entry.pledgePurchased);
  const replacementCandidates = mode === "reset" ? entries : pledgeEntries;
  const removedCount = mode === "wipe" ? ingameEntries.length : 0;
  const activeEntryIds = new Set(entries.map((entry) => entry.id));
  const assignedMissions = state.missions.filter(
    (mission) => isMissionActive(mission) && activeEntryIds.has(mission.assignedFleetEntryId),
  );

  fleetWipeDialogMessage.textContent = mode === "reset"
    ? fleetText("fleet.wipe.resetMessage", "Alle aktiven Schiffe bleiben im Besitz. Die bisherigen Instanzen werden archiviert und als neue Instanzen angelegt.")
    : fleetText("fleet.wipe.fullMessage", "Ingame gekaufte Schiffe werden entfernt. Echtgeldschiffe erhalten eine neue aktive Flotteninstanz.");
  fleetWipeSummary.innerHTML = [
    [fleetText("fleet.wipe.newInstances", "Neue Instanzen"), replacementCandidates.length],
    [fleetText("fleet.wipe.removedShips", "Entfernte Schiffe"), removedCount],
  ].map(([label, value]) => `
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(String(value))}</strong>
    </div>
  `).join("");

  fleetWipeReplacementSection.hidden = replacementCandidates.length === 0;
  fleetWipeReplacementList.innerHTML = replacementCandidates.map((entry) => `
    <label class="fleet-wipe-replacement-row">
      <span>
        <strong>${escapeHtml(`${entry.manufacturer} ${entry.model}`.trim())}</strong>
        <small>${escapeHtml(fleetText("fleet.wipe.previousRegistration", "Bisher: {registration}", { registration: formatFleetRegistration(entry) }))}</small>
      </span>
      <input type="text" data-wipe-registration-id="${escapeHtml(entry.id)}" value="${escapeHtml(fleetPatchRegistrationDrafts.get(entry.id) || "")}" placeholder="${escapeHtml(fleetText("fleet.replacement.registrationPlaceholder", "z. B. AB-1234-CD"))}" />
    </label>
  `).join("");

  fleetWipeMissionWarning.hidden = assignedMissions.length === 0;
  fleetWipeMissionWarning.textContent = assignedMissions.length > 0
    ? fleetText(
        assignedMissions.length === 1 ? "fleet.wipe.missionWarningOne" : "fleet.wipe.missionWarningMany",
        "{count} aktive Aufträge bleiben ihren bisherigen, danach archivierten Schiffen zugeordnet.",
        { count: assignedMissions.length },
      )
    : "";
  fleetWipeConfirm.textContent = mode === "reset"
    ? fleetText("fleet.wipe.confirmReset", "Schiffsreset durchführen")
    : fleetText("fleet.wipe.confirmFull", "Vollständigen Wipe durchführen");
}

function openFleetWipeDialog() {
  if (!fleetWipeDialog || !fleetWipeForm) return;
  const entries = getFleetWipeEntries();
  if (entries.length === 0) return;

  fleetWipeModeReset.checked = true;
  fleetWipeModeFull.checked = false;
  fleetPatchRegistrationDrafts = new Map();
  fleetWipePatchVersion.value = "";
  fleetWipeDate.value = formatDateForInput(new Date());
  fleetWipeDate.setCustomValidity("");
  translateStaticText(fleetWipeDialog);
  renderFleetPatchChangePreview();
  fleetWipeDialog.hidden = false;
  fleetWipePatchVersion.focus();
}

function applyFleetWipe() {
  const mode = getFleetPatchChangeMode();
  const patchVersion = normalizeFleetPatchVersion(fleetWipePatchVersion?.value);
  const endedOn = normalizeDateInput(fleetWipeDate?.value);
  const activeEntries = getFleetWipeEntries();
  if (!patchVersion || !endedOn || activeEntries.length === 0) return false;

  const invalidDateEntry = activeEntries.find((entry) => compareDateInputs(endedOn, entry.acquiredOn) < 0);
  if (invalidDateEntry) {
    fleetWipeDate.setCustomValidity(fleetText(
      "fleet.wipe.dateBeforeAcquisition",
      "Das Wipe-Datum liegt vor dem Flottenzugang von {ship}.",
      { ship: `${invalidDateEntry.manufacturer} ${invalidDateEntry.model}`.trim() },
    ));
    fleetWipeDate.reportValidity();
    return false;
  }
  fleetWipeDate.setCustomValidity("");

  const registrations = new Map(
    [...fleetWipeReplacementList.querySelectorAll("[data-wipe-registration-id]")]
      .map((input) => [input.dataset.wipeRegistrationId, String(input.value || "").trim()]),
  );
  const replacementEntries = [];
  let nextActiveFleetEntryId = "";
  const currentActiveFleetEntryId = state.activeFleetEntryId;

  const archivedFleet = state.fleet.map((entry) => {
    if (entry.status !== "active") return entry;
    const replaced = mode === "reset" || Boolean(entry.pledgePurchased);
    const status = mode === "reset"
      ? "patch-replaced"
      : replaced
        ? "wipe-replaced"
        : "wipe-removed";
    const archivedEntry = createFleetEntry({
      ...entry,
      status,
      patchVersion,
      endedOn,
      notes: mode === "reset"
        ? buildFleetNotesWithPatchVersion(entry.notes, "patch-replaced", patchVersion)
        : buildFleetWipeNotes(entry.notes, patchVersion, replaced),
    });
    if (replaced) {
      const replacementEntry = createFleetReplacementEntry(archivedEntry, registrations.get(entry.id) || "");
      replacementEntries.push(replacementEntry);
      if (entry.id === currentActiveFleetEntryId) nextActiveFleetEntryId = replacementEntry.id;
    }
    return archivedEntry;
  });

  state.fleet = [...replacementEntries, ...archivedFleet];
  if (!(typeof isDispatcherMode === "function" && isDispatcherMode())) {
    state.activeFleetEntryId = nextActiveFleetEntryId;
    syncLayoutToActiveFleetShip({ confirmChange: false });
  }
  expandedFleetCardId = "";
  expandedFleetGroupId = replacementEntries.length > 0 ? "active" : "";
  closeFleetWipeDialog();
  resetFleetForm();
  setFleetView("ships");
  persist();
  render();
  setActivePage("fleet");
  return true;
}

function renderFleetCard(entry) {
  const shipType = findShipLibraryEntryById(entry.shipId);
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const isCurrentActiveShip = !dispatcherMode && entry.status === "active" && entry.id === state.activeFleetEntryId;
  const activeClass = entry.status === "active" ? " is-active-entry" : "";
  const isExpanded = expandedFleetCardId === entry.id;
  const notesMarkup = entry.notes ? `<p class="fleet-card-notes">${escapeHtml(entry.notes)}</p>` : "";
  const registrationClass = entry.registration ? "" : " fleet-registration-placeholder";
  const ownerName = String(entry.ownerName || "").trim();
  const pilotName = getFleetEntryPilotName(entry);
  const pledgePurchased = Boolean(entry.pledgePurchased);
  const detailsId = `fleet-card-details-${entry.id}`;
  const statusBadgeMarkup =
    entry.status === "active"
      ? ""
      : `<span class="fleet-status-badge fleet-status-${escapeHtml(entry.status)}">${escapeHtml(getFleetStatusLabel(entry.status))}</span>`;
  const pledgeTooltip = fleetText("fleet.card.pledgeTooltip", "Mit Echtgeld gekauft");
  const gridSummary = shipType ? getShipGridSummary(shipType) : null;
  const officialCargo = gridSummary ? gridSummary.official.totalScu || Number(shipType?.cargoScu) || 0 : 0;
  const maxCargo = gridSummary ? Math.max(officialCargo, gridSummary.total.totalScu || 0) : 0;
  const refuelConfig = getRefuelContainerConfig(shipType, entry);
  const quickFacts = [
    getShipClassLabel(shipType?.shipClass),
    maxCargo > 0 ? fleetText("fleet.card.cargoQuick", "{value} SCU Fracht", { value: formatScuAmount(maxCargo) }) : "",
    refuelConfig.hasRefuelContainers
      ? refuelConfig.hasConfiguredCapacity
        ? fleetText("fleet.card.refuelQuick", "{value} SCU Refuel", { value: formatScuAmount(refuelConfig.totalCapacity) })
        : fleetText("fleet.card.refuelContainersQuick", "{count} Refuel-Behälter", { count: refuelConfig.containerCount })
      : "",
  ].filter(Boolean);
  return `
    <article class="fleet-card fleet-roster-card${activeClass}${isCurrentActiveShip ? " is-current-ship" : ""}${isExpanded ? " is-expanded" : ""}" data-fleet-id="${entry.id}">
      <div class="fleet-roster-main">
        <button class="fleet-roster-open" type="button" aria-label="${escapeHtml(fleetText("fleet.dossier.open", "Schiffsakte für {ship} öffnen", { ship: `${entry.manufacturer} ${entry.model}` }))}">
          <div class="fleet-roster-media">
            ${renderShipProfileMedia(getFleetMediaEntry(entry, shipType), "fleet-card-media")}
            ${pledgePurchased ? `<span class="fleet-pledge-badge tooltip-button" data-tooltip="${escapeHtml(pledgeTooltip)}" aria-label="${escapeHtml(pledgeTooltip)}">€</span>` : ""}
          </div>
          <div class="fleet-card-copy fleet-roster-identity">
            <span class="fleet-card-eyebrow">${escapeHtml(entry.manufacturer)}</span>
            <h3>${escapeHtml(entry.model)}</h3>
            <p class="fleet-registration${registrationClass}">${escapeHtml(formatFleetRegistration(entry))}</p>
            <div class="fleet-roster-facts">
              ${statusBadgeMarkup}
              ${quickFacts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}
            </div>
          </div>
        </button>
        <div class="fleet-card-actions">
          ${renderFleetActionIconButton({
            className: "secondary-button fleet-book-costs",
            label: fleetText("fleet.card.bookCosts", "Betriebskosten buchen"),
            icon: FLEET_ACTION_ICONS.costs,
          })}
          ${
            entry.status === "active" && !dispatcherMode
              ? renderFleetActionIconButton({
                  className: `${isCurrentActiveShip ? "primary-button" : "secondary-button"} fleet-set-active`,
                  label: isCurrentActiveShip ? fleetText("fleet.card.currentActive", "Aktives Schiff") : fleetText("fleet.card.setActive", "Als aktiv setzen"),
                  icon: isCurrentActiveShip ? FLEET_ACTION_ICONS.active : FLEET_ACTION_ICONS.setActive,
                  ariaDisabled: isCurrentActiveShip,
                })
              : ""
          }
          ${renderFleetActionIconButton({
            className: "secondary-button fleet-edit",
            label: fleetText("common.edit", "Bearbeiten"),
            icon: FLEET_ACTION_ICONS.edit,
          })}
          <button class="ghost-button fleet-delete icon-only-button tooltip-button" type="button" aria-label="${escapeHtml(fleetText("fleet.card.deleteEntry", "Eintrag löschen"))}" data-tooltip="${escapeHtml(fleetText("fleet.card.deleteEntry", "Eintrag löschen"))}">
            <span class="button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
              </svg>
            </span>
          </button>
          <button class="ghost-button fleet-card-details-toggle icon-only-button tooltip-button" type="button" aria-expanded="${isExpanded ? "true" : "false"}" aria-controls="${escapeHtml(detailsId)}" aria-label="${escapeHtml(isExpanded ? fleetText("fleet.card.hideDetails", "Details einklappen") : fleetText("fleet.card.showDetails", "Details anzeigen"))}" data-tooltip="${escapeHtml(isExpanded ? fleetText("fleet.card.hideDetails", "Details einklappen") : fleetText("fleet.card.showDetails", "Details anzeigen"))}">
            <span class="button-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">${FLEET_ACTION_ICONS.details}</svg>
            </span>
          </button>
        </div>
      </div>
      <div id="${escapeHtml(detailsId)}" class="fleet-roster-details"${isExpanded ? "" : " hidden"}>
        <div class="fleet-card-meta">
          <div>
            <span>${escapeHtml(fleetText("fleet.card.ownership", "Besitzdauer"))}</span>
            <strong>${escapeHtml(formatFleetOwnershipLine(entry))}</strong>
          </div>
          <div>
            <span>${escapeHtml(fleetText("fleet.card.period", "Zeitraum"))}</span>
            <strong>${escapeHtml(formatFleetDateRange(entry))}</strong>
          </div>
          <div${dispatcherMode || ownerName ? "" : " hidden"}>
            <span>${escapeHtml(fleetText("fleet.card.owner", "Eigentümer"))}</span>
            <strong>${escapeHtml(ownerName || fleetText("common.notSpecified", "Nicht angegeben"))}</strong>
          </div>
          <div${dispatcherMode || pilotName ? "" : " hidden"}>
            <span>${escapeHtml(fleetText("fleet.card.pilot", "Pilot"))}</span>
            <strong>${escapeHtml(pilotName || fleetText("common.notSpecified", "Nicht angegeben"))}</strong>
          </div>
          ${renderFleetCargoMeta(shipType)}
          <div${hasRefuelSupport(shipType) ? "" : " hidden"}>
            <span>${escapeHtml(fleetText("fleet.card.refuelConfig", "Refuel-Konfiguration"))}</span>
            <strong>${escapeHtml(formatFleetRefuelSupport(entry, shipType))}</strong>
          </div>
        </div>
        ${notesMarkup}
      </div>
    </article>
  `;
}

const FLEET_PATCH_NOTE_PATTERNS = [
  /^Durch Patch ersetzt(?: mit Patch .+)?\.?$/i,
  /^Durch Patch .+ ersetzt\.?$/i,
  /^Replaced by patch(?: with patch .+)?\.?$/i,
  /^Replaced by patch .+\.?$/i,
];

function normalizeFleetPatchVersion(value) {
  return String(value || "").trim();
}

function formatFleetPatchReplacementNote(patchVersion) {
  const normalizedVersion = normalizeFleetPatchVersion(patchVersion);
  return normalizedVersion
    ? fleetText("fleet.form.patchNote", "Durch Patch {version} ersetzt", { version: normalizedVersion })
    : "";
}

function stripFleetPatchReplacementNotes(notes) {
  return String(notes || "")
    .split(/\r?\n/)
    .filter((line) => !FLEET_PATCH_NOTE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .filter((line) => !FLEET_WIPE_NOTE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join("\n")
    .trim();
}

function buildFleetNotesWithPatchVersion(notes, status, patchVersion) {
  const baseNotes = stripFleetPatchReplacementNotes(notes);
  if (["wipe-replaced", "wipe-removed"].includes(status)) {
    return buildFleetWipeNotes(baseNotes, normalizeFleetPatchVersion(patchVersion), status === "wipe-replaced");
  }
  const patchNote = status === "patch-replaced" ? formatFleetPatchReplacementNote(patchVersion) : "";
  return [baseNotes, patchNote].filter(Boolean).join("\n");
}

function extractFleetPatchVersionFromNotes(notes) {
  const generatedLine = String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) =>
      FLEET_PATCH_NOTE_PATTERNS.some((pattern) => pattern.test(line))
      || FLEET_WIPE_NOTE_PATTERNS.some((pattern) => pattern.test(line)),
    );
  const match =
    generatedLine?.match(/^Durch Patch\s+(.+?)\s+ersetzt\.?$/i) ||
    generatedLine?.match(/^Replaced by patch\s+(.+?)\.?$/i) ||
    generatedLine?.match(/^Durch Wipe(?: in Patch)?\s+(.+?)\s+(?:ersetzt|entfernt)\.?$/i) ||
    generatedLine?.match(/^(?:Replaced|Removed) by wipe(?: in patch)?\s+(.+?)\.?$/i) ||
    generatedLine?.match(/(?:mit Patch|with patch)\s+(.+?)\.?$/i);
  return match ? normalizeFleetPatchVersion(match[1]) : "";
}

function syncFleetPatchVersionNote() {
  const notesField = fleetForm?.elements?.notes;
  if (!notesField) return;
  notesField.value = buildFleetNotesWithPatchVersion(
    notesField.value,
    fleetStatusSelect?.value || "active",
    fleetPatchVersionInput?.value || "",
  );
}

function renderFleetGroup({ id, title, entries, emptyText, collapsible = false, expanded = true, scope = "ships", panelize = false }) {
  const bodyId = `fleet-${scope}-${id}-group-body`;
  const countLabel = fleetText(entries.length === 1 ? "fleet.group.shipCount" : "fleet.group.shipCountPlural", "{count} Schiffe", { count: entries.length });
  const panelClass = panelize ? " panel" : "";
  const bodyMarkup = entries.length
    ? entries.map(renderFleetCard).join("")
    : `<div class="empty-state fleet-group-empty">${escapeHtml(emptyText)}</div>`;
  const headerCopy = `
    <span class="fleet-group-title">${escapeHtml(title)}</span>
    <span class="fleet-group-count">${escapeHtml(countLabel)}</span>
  `;

  if (collapsible) {
    return `
      <section class="fleet-group${panelClass}${expanded ? "" : " is-collapsed"}" data-fleet-group="${escapeHtml(id)}" data-fleet-group-scope="${escapeHtml(scope)}">
        <button class="fleet-group-header fleet-group-toggle" type="button" data-fleet-group-toggle="${escapeHtml(id)}" data-fleet-group-scope="${escapeHtml(scope)}" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${escapeHtml(bodyId)}">
          <span class="fleet-group-copy">${headerCopy}</span>
          <span class="collapse-indicator" aria-hidden="true"></span>
        </button>
        <div id="${escapeHtml(bodyId)}" class="fleet-group-body" ${expanded ? "" : "hidden"}>
          ${bodyMarkup}
        </div>
      </section>
    `;
  }

  return `
    <section class="fleet-group${panelClass}" data-fleet-group="${escapeHtml(id)}" data-fleet-group-scope="${escapeHtml(scope)}">
      <div class="fleet-group-header">
        <span class="fleet-group-copy">${headerCopy}</span>
      </div>
      <div id="${escapeHtml(bodyId)}" class="fleet-group-body">
        ${bodyMarkup}
      </div>
    </section>
  `;
}

function syncFleetGroupAccordion(scope = "ships") {
  const expandedGroupId = getFleetExpandedGroupId(scope);
  document.querySelectorAll(`[data-fleet-group-scope="${scope}"]`).forEach((group) => {
    const groupId = group.dataset.fleetGroup;
    const expanded = groupId === expandedGroupId;
    const body = group.querySelector(".fleet-group-body");
    const button = group.querySelector("[data-fleet-group-toggle]");
    if (body) {
      body.hidden = !expanded;
    }
    if (button) {
      button.setAttribute("aria-expanded", String(expanded));
    }
    group.classList.toggle("is-collapsed", !expanded);
  });
}

function getLongestFleetEntryFrom(entries) {
  return entries.reduce((best, entry) => {
    if (!best) return entry;
    return getFleetOwnershipDays(entry) > getFleetOwnershipDays(best) ? entry : best;
  }, null);
}

function renderFleetSummary() {
  const entries = getFleetEntries();
  const activeEntries = entries.filter((entry) => entry.status === "active");
  if (fleetWipeButton) {
    const wipeTooltip = fleetText("fleet.wipe.openTooltip", "Patchwechsel verwalten");
    fleetWipeButton.disabled = activeEntries.length === 0;
    fleetWipeButton.setAttribute("aria-label", wipeTooltip);
    fleetWipeButton.dataset.tooltip = wipeTooltip;
  }
  const longestActiveEntry = getLongestFleetEntryFrom(activeEntries);
  const summaryCards = activeFleetView === "archive"
    ? [
        { label: fleetText("fleet.summary.archivedShips", "Archivierte Schiffe"), value: entries.filter((entry) => entry.status !== "active").length },
        {
          label: fleetText("fleet.summary.longestOwnership", "Längste Besitzdauer"),
          value: getLongestFleetEntryFrom(entries.filter((entry) => entry.status !== "active"))
            ? formatFleetDurationDays(getFleetOwnershipDays(getLongestFleetEntryFrom(entries.filter((entry) => entry.status !== "active"))))
            : fleetText("common.noData", "Noch keine Daten"),
        },
      ]
    : [
        { label: fleetText("fleet.summary.totalShips", "Gesamtzahl Schiffe"), value: activeEntries.length },
        {
          label: fleetText("fleet.summary.longestOwnership", "Längste Besitzdauer"),
          value: longestActiveEntry
            ? formatFleetDurationDays(getFleetOwnershipDays(longestActiveEntry))
            : fleetText("common.noData", "Noch keine Daten"),
        },
      ];

  fleetSummary.innerHTML = summaryCards
    .map(
      (card) => `
        <div class="summary-card summary-card-compact">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
        </div>
      `,
    )
    .join("");
}

function bindFleetListEvents(root) {
  if (!root) return;

  root.querySelectorAll(".fleet-roster-open").forEach((button) => {
    button.addEventListener("click", () => {
      const entryId = button.closest(".fleet-card")?.dataset.fleetId || "";
      if (!state.fleet.some((entry) => entry.id === entryId)) return;
      selectedFleetDossierEntryId = entryId;
      fleetDossierReturnView = root === fleetArchiveList ? "archive" : "ships";
      setFleetView("dossier");
      renderFleet();
      setActivePage("fleet");
    });
  });

  root.querySelectorAll(".fleet-card-details-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const entryId = button.closest(".fleet-card")?.dataset.fleetId || "";
      expandedFleetCardId = expandedFleetCardId === entryId ? "" : entryId;
      renderFleet();
    });
  });

  root.querySelectorAll(".fleet-book-costs").forEach((button) => {
    button.addEventListener("click", () => {
      const entryId = button.closest(".fleet-card")?.dataset.fleetId || "";
      if (typeof financeController?.openQuickShipExpense === "function") {
        financeController.openQuickShipExpense(entryId);
      } else {
        financeController?.openShipExpense?.(entryId);
      }
    });
  });

  root.querySelectorAll("[data-fleet-group-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const groupId = button.dataset.fleetGroupToggle;
      const scope = button.dataset.fleetGroupScope || "ships";
      const isExpanded = button.getAttribute("aria-expanded") === "true";
      setFleetExpandedGroupId(scope, isExpanded ? "" : groupId);
      syncFleetGroupAccordion(scope);
    });
  });

  root.querySelectorAll(".fleet-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.fleet.find((candidate) => candidate.id === button.closest(".fleet-card")?.dataset.fleetId);
      if (!entry) return;
      populateFleetForm(entry);
      setFleetView("form");
      setActivePage("fleet");
    });
  });

  root.querySelectorAll(".fleet-set-active").forEach((button) => {
    button.addEventListener("click", async () => {
      if (button.getAttribute("aria-disabled") === "true") return;
      const entry = state.fleet.find((candidate) => candidate.id === button.closest(".fleet-card")?.dataset.fleetId);
      if (!entry || entry.status !== "active") return;
      const previousActiveFleetEntryId = state.activeFleetEntryId;
      const previousActiveEntry = state.fleet.find((candidate) => candidate.id === previousActiveFleetEntryId) || null;
      const assignedMissions = getActiveMissionsAssignedToFleetEntry(previousActiveFleetEntryId);
      if (previousActiveEntry && previousActiveFleetEntryId !== entry.id && assignedMissions.length > 0) {
        const shouldSwitch = await showShipMissionDialog({
          fromEntry: previousActiveEntry,
          toEntry: entry,
          missions: assignedMissions,
        });
        if (!shouldSwitch) return;
      }
      state.activeFleetEntryId = entry.id;
      syncLayoutToActiveFleetShip({ confirmChange: false });
      persist();
      render();
    });
  });

  root.querySelectorAll(".fleet-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".fleet-card");
      const entry = state.fleet.find((candidate) => candidate.id === card?.dataset.fleetId);
      if (!entry) return;
      const shouldDelete = await showMissionConfirmDialog({
        kicker: fleetText("nav.fleet", "Flotte"),
        title: fleetText("common.delete", "Löschen"),
        message: fleetText("fleet.confirm.delete", "Flotteneintrag \"{name}\" wirklich löschen?", { name: `${entry.manufacturer} ${entry.model}` }),
        confirmLabel: fleetText("common.delete", "Löschen"),
        tone: "danger",
      });
      if (!shouldDelete) return;
      if (state.activeFleetEntryId === entry.id) {
        state.activeFleetEntryId = "";
      }
      state.fleet = state.fleet.filter((candidate) => candidate.id !== entry.id);
      if (expandedFleetCardId === entry.id) expandedFleetCardId = "";
      if (fleetForm.entryId.value === entry.id) {
        resetFleetForm();
      }
      persist();
      render();
    });
  });
}

const FLEET_DOSSIER_CATEGORY_KEYS = {
  Reparatur: "finance.category.repair",
  Betankung: "finance.category.refuel",
  Treibstoffankauf: "finance.category.fuelPurchase",
  Quantum: "finance.category.quantum",
  Versicherung: "finance.category.insurance",
  Claim: "finance.category.claim",
  Hangargebühr: "finance.category.hangarFee",
  "Service-Sonstiges": "finance.category.serviceOther",
};

function formatFleetDossierCurrency(value, { signed = false } = {}) {
  const numericValue = Math.round(Number(value) || 0);
  const locale = typeof currentUiLanguage === "function" && currentUiLanguage() === "en" ? "en-US" : "de-DE";
  const absolute = Math.abs(numericValue).toLocaleString(locale);
  if (!signed || numericValue === 0) return `${absolute} aUEC`;
  return `${numericValue > 0 ? "+" : "-"}${absolute} aUEC`;
}

function getFleetDossierLedgerEntries(fleetEntry) {
  if (!fleetEntry) return [];
  const matchingFleetEntries = state.fleet.filter((entry) => entry.shipId && entry.shipId === fleetEntry.shipId);
  return (state.ledgerEntries || []).filter((ledgerEntry) => {
    if (ledgerEntry.fleetEntryId) return ledgerEntry.fleetEntryId === fleetEntry.id;
    const mission = state.missions.find((entry) => entry.id === ledgerEntry.missionId);
    if (mission?.assignedFleetEntryId) return mission.assignedFleetEntryId === fleetEntry.id;
    return Boolean(ledgerEntry.shipId && ledgerEntry.shipId === fleetEntry.shipId && matchingFleetEntries.length === 1);
  });
}

function formatFleetDossierCategory(category) {
  const key = FLEET_DOSSIER_CATEGORY_KEYS[category];
  return key ? fleetText(key, category) : String(category || fleetText("common.booking", "Buchung"));
}

function renderFleetDossier() {
  if (!fleetDossier) return;
  const entry = state.fleet.find((candidate) => candidate.id === selectedFleetDossierEntryId) || null;
  if (!entry) {
    fleetDossier.innerHTML = `<div class="empty-state">${escapeHtml(fleetText("fleet.dossier.notFound", "Dieser Flotteneintrag ist nicht mehr vorhanden."))}</div>`;
    return;
  }

  const shipType = findShipLibraryEntryById(entry.shipId);
  const assignedMissions = state.missions
    .filter((mission) => mission.assignedFleetEntryId === entry.id)
    .sort((left, right) => {
      const statusOrder = { active: 0, completed: 1, paid: 2, cancelled: 3 };
      const statusDifference = (statusOrder[getMissionWorkflowStatus(left)] ?? 9) - (statusOrder[getMissionWorkflowStatus(right)] ?? 9);
      if (statusDifference !== 0) return statusDifference;
      return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
    });
  const ledgerEntries = getFleetDossierLedgerEntries(entry);
  const nonOperatingCategories = new Set(["Schiffskauf", "Schiffsverkauf", "Upgrade", "Anfangsbestand"]);
  const operatingEntries = ledgerEntries.filter((ledgerEntry) => !nonOperatingCategories.has(String(ledgerEntry.category || "").trim()));
  const operatingIncome = operatingEntries
    .filter((ledgerEntry) => ledgerEntry.flow === "income")
    .reduce((sum, ledgerEntry) => sum + (Number(ledgerEntry.amountAuec) || 0), 0);
  const operatingCosts = operatingEntries
    .filter((ledgerEntry) => ledgerEntry.flow === "expense")
    .reduce((sum, ledgerEntry) => sum + (Number(ledgerEntry.amountAuec) || 0), 0);
  const operatingResult = operatingIncome - operatingCosts;
  const maintenanceEntries = ledgerEntries
    .filter((ledgerEntry) => ledgerEntry.flow === "expense" && ledgerEntry.scope === "service")
    .sort((left, right) => compareDateInputs(right.bookedOn, left.bookedOn));
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const ownerName = String(entry.ownerName || "").trim();
  const pilotName = getFleetEntryPilotName(entry);
  const registrationClass = entry.registration ? "" : " fleet-registration-placeholder";
  const pledgeTooltip = fleetText("fleet.card.pledgeTooltip", "Mit Echtgeld gekauft");

  const missionRows = assignedMissions.length
    ? assignedMissions.map((mission) => `
        <tr>
          <td><strong>${escapeHtml(mission.title)}</strong></td>
          <td>${escapeHtml(getMissionTypeLabel(mission))}</td>
          <td>${escapeHtml(getMissionAssignedPilotName(mission, fleetText("common.notSpecified", "Nicht angegeben")))}</td>
          <td><span class="fleet-dossier-status status-${escapeHtml(getMissionWorkflowStatus(mission))}">${escapeHtml(getMissionWorkflowLabel(mission))}</span></td>
          <td>${escapeHtml(summarizeMissionRoute(mission))}</td>
          <td class="numeric-cell">${escapeHtml(formatFleetDossierCurrency(getMissionPayout(mission)))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="6" class="table-empty-cell">${escapeHtml(fleetText("fleet.dossier.noMissions", "Diesem Schiff wurden noch keine Aufträge zugeordnet."))}</td></tr>`;

  const maintenanceRows = maintenanceEntries.length
    ? maintenanceEntries.map((ledgerEntry) => `
        <tr>
          <td>${escapeHtml(formatDateDisplay(ledgerEntry.bookedOn))}</td>
          <td><strong>${escapeHtml(formatFleetDossierCategory(ledgerEntry.category))}</strong></td>
          <td>${escapeHtml(ledgerEntry.reference || ledgerEntry.notes || fleetText("common.noData", "Keine Angabe"))}</td>
          <td class="numeric-cell expense-value">${escapeHtml(formatFleetDossierCurrency(-Math.abs(Number(ledgerEntry.amountAuec) || 0), { signed: true }))}</td>
        </tr>
      `).join("")
    : `<tr><td colspan="4" class="table-empty-cell">${escapeHtml(fleetText("fleet.dossier.noMaintenance", "Noch keine Wartungs- oder Betriebskosten gebucht."))}</td></tr>`;

  fleetDossier.innerHTML = `
    <div class="fleet-dossier-toolbar">
      <button id="fleetDossierBack" class="secondary-button icon-text-button" type="button">
        <span class="button-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="m14.7 5.3-1.4-1.4L5.2 12l8.1 8.1 1.4-1.4L9 13h11v-2H9l5.7-5.7Z" /></svg></span>
        <span>${escapeHtml(fleetText("fleet.dossier.back", "Zurück zur Flotte"))}</span>
      </button>
      <div class="fleet-dossier-actions">
        ${renderFleetActionIconButton({ className: "secondary-button fleet-dossier-costs", label: fleetText("fleet.card.bookCosts", "Betriebskosten buchen"), icon: FLEET_ACTION_ICONS.costs })}
        ${renderFleetActionIconButton({ className: "secondary-button fleet-dossier-edit", label: fleetText("common.edit", "Bearbeiten"), icon: FLEET_ACTION_ICONS.edit })}
      </div>
    </div>

    <div class="fleet-dossier-hero">
      <div class="fleet-dossier-media">
        ${renderShipProfileMedia(getFleetMediaEntry(entry, shipType), "fleet-dossier-image")}
        ${entry.pledgePurchased ? `<span class="fleet-pledge-badge tooltip-button" data-tooltip="${escapeHtml(pledgeTooltip)}" aria-label="${escapeHtml(pledgeTooltip)}">€</span>` : ""}
      </div>
      <div class="fleet-dossier-heading">
        <span class="fleet-card-eyebrow">${escapeHtml(entry.manufacturer)}</span>
        <h2>${escapeHtml(entry.model)}</h2>
        <p class="fleet-registration${registrationClass}">${escapeHtml(formatFleetRegistration(entry))}</p>
        <div class="fleet-dossier-heading-meta">
          <span class="fleet-status-badge fleet-status-${escapeHtml(entry.status)}">${escapeHtml(getFleetStatusLabel(entry.status))}</span>
          ${shipType?.shipClass ? `<span>${escapeHtml(getShipClassLabel(shipType.shipClass))}</span>` : ""}
        </div>
      </div>
    </div>

    <div class="summary-cards fleet-dossier-summary">
      <div class="summary-card summary-card-compact"><span>${escapeHtml(fleetText("fleet.dossier.income", "Betriebseinnahmen"))}</span><strong>${escapeHtml(formatFleetDossierCurrency(operatingIncome))}</strong></div>
      <div class="summary-card summary-card-compact"><span>${escapeHtml(fleetText("fleet.dossier.costs", "Betriebskosten"))}</span><strong>${escapeHtml(formatFleetDossierCurrency(operatingCosts))}</strong></div>
      <div class="summary-card summary-card-compact"><span>${escapeHtml(fleetText("fleet.dossier.result", "Ergebnis"))}</span><strong class="${operatingResult < 0 ? "expense-value" : "income-value"}">${escapeHtml(formatFleetDossierCurrency(operatingResult, { signed: true }))}</strong></div>
      <div class="summary-card summary-card-compact"><span>${escapeHtml(fleetText("fleet.dossier.missions", "Zugeordnete Aufträge"))}</span><strong>${escapeHtml(String(assignedMissions.length))}</strong></div>
    </div>

    <section class="fleet-dossier-section">
      <h3>${escapeHtml(fleetText("fleet.dossier.masterData", "Schiffsdaten"))}</h3>
      <div class="fleet-dossier-facts fleet-card-meta">
        <div><span>${escapeHtml(fleetText("fleet.card.ownership", "Besitzdauer"))}</span><strong>${escapeHtml(formatFleetOwnershipLine(entry))}</strong></div>
        <div><span>${escapeHtml(fleetText("fleet.card.period", "Zeitraum"))}</span><strong>${escapeHtml(formatFleetDateRange(entry))}</strong></div>
        <div${dispatcherMode || ownerName ? "" : " hidden"}><span>${escapeHtml(fleetText("fleet.card.owner", "Eigentümer"))}</span><strong>${escapeHtml(ownerName || fleetText("common.notSpecified", "Nicht angegeben"))}</strong></div>
        <div${dispatcherMode || pilotName ? "" : " hidden"}><span>${escapeHtml(fleetText("fleet.card.pilot", "Pilot"))}</span><strong>${escapeHtml(pilotName || fleetText("common.notSpecified", "Nicht angegeben"))}</strong></div>
        ${renderFleetCargoMeta(shipType)}
        <div${hasRefuelSupport(shipType) ? "" : " hidden"}><span>${escapeHtml(fleetText("fleet.card.refuelConfig", "Refuel-Konfiguration"))}</span><strong>${escapeHtml(formatFleetRefuelSupport(entry, shipType))}</strong></div>
        <div${shipType?.hangarSize ? "" : " hidden"}><span>${escapeHtml(fleetText("shipdb.card.hangar", "Hangargröße"))}</span><strong>${escapeHtml(formatHangarSize(shipType?.hangarSize))}</strong></div>
      </div>
      ${entry.notes ? `<p class="fleet-dossier-notes">${escapeHtml(entry.notes)}</p>` : ""}
    </section>

    <section class="fleet-dossier-section">
      <div class="fleet-dossier-section-head"><h3>${escapeHtml(fleetText("fleet.dossier.contracts", "Aufträge"))}</h3><span>${escapeHtml(fleetText("fleet.dossier.contractCount", "{count} Einträge", { count: assignedMissions.length }))}</span></div>
      <div class="finance-table-wrap"><table class="finance-table fleet-dossier-table"><thead><tr><th>${escapeHtml(fleetText("fleet.dossier.contract", "Auftrag"))}</th><th>${escapeHtml(fleetText("fleet.dossier.type", "Art"))}</th><th>${escapeHtml(fleetText("fleet.dossier.pilot", "Pilot"))}</th><th>${escapeHtml(fleetText("fleet.dossier.status", "Status"))}</th><th>${escapeHtml(fleetText("fleet.dossier.route", "Route / Einsatzort"))}</th><th>${escapeHtml(fleetText("fleet.dossier.payout", "Verdienst"))}</th></tr></thead><tbody>${missionRows}</tbody></table></div>
    </section>

    <section class="fleet-dossier-section">
      <div class="fleet-dossier-section-head"><h3>${escapeHtml(fleetText("fleet.dossier.maintenance", "Wartung und Betrieb"))}</h3><span>${escapeHtml(fleetText("fleet.dossier.bookingCount", "{count} Buchungen", { count: maintenanceEntries.length }))}</span></div>
      <div class="finance-table-wrap"><table class="finance-table fleet-dossier-table"><thead><tr><th>${escapeHtml(fleetText("fleet.dossier.date", "Datum"))}</th><th>${escapeHtml(fleetText("fleet.dossier.category", "Kategorie"))}</th><th>${escapeHtml(fleetText("fleet.dossier.details", "Details"))}</th><th>${escapeHtml(fleetText("fleet.dossier.amount", "Betrag"))}</th></tr></thead><tbody>${maintenanceRows}</tbody></table></div>
    </section>

    <section class="fleet-dossier-section fleet-dossier-lifecycle">
      <h3>${escapeHtml(fleetText("fleet.dossier.lifecycle", "Flottenhistorie"))}</h3>
      <ol class="fleet-dossier-timeline">
        <li><span>${escapeHtml(formatDateDisplay(entry.acquiredOn))}</span><strong>${escapeHtml(fleetText("fleet.dossier.acquired", "In die Flotte aufgenommen"))}</strong></li>
        ${entry.status !== "active" ? `<li><span>${escapeHtml(formatDateDisplay(entry.endedOn))}</span><strong>${escapeHtml(getFleetStatusLabel(entry.status))}</strong>${entry.patchVersion ? `<small>${escapeHtml(fleetText("fleet.dossier.patch", "Patch {version}", { version: entry.patchVersion }))}</small>` : ""}</li>` : ""}
      </ol>
    </section>
  `;

  bindShipProfileMedia(fleetDossier);
  fleetDossier.querySelector("#fleetDossierBack")?.addEventListener("click", () => {
    setFleetView(fleetDossierReturnView);
    renderFleet();
  });
  fleetDossier.querySelector(".fleet-dossier-edit")?.addEventListener("click", () => {
    populateFleetForm(entry);
    setFleetView("form");
    setActivePage("fleet");
  });
  fleetDossier.querySelector(".fleet-dossier-costs")?.addEventListener("click", () => {
    if (typeof financeController?.openQuickShipExpense === "function") {
      financeController.openQuickShipExpense(entry.id);
    } else {
      financeController?.openShipExpense?.(entry.id);
    }
  });
}

function renderFleet() {
  const entries = getFleetEntries();
  const activeEntries = entries.filter((entry) => entry.status === "active");
  const archivedEntries = entries.filter((entry) => entry.status !== "active");
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const activeFleetEntry = currentActiveFleetEntry();
  const currentActiveEntry = activeEntries.find((entry) => entry.id === activeFleetEntry?.id) || null;
  const otherActiveEntries = currentActiveEntry
    ? activeEntries.filter((entry) => entry.id !== currentActiveEntry.id)
    : activeEntries;
  const archiveStatuses = Object.keys(FLEET_STATUS_LABELS).filter((status) => status !== "active");
  const firstArchiveStatus = archiveStatuses.find((status) => archivedEntries.some((entry) => entry.status === status)) || "sold";
  if (expandedFleetArchiveGroupId && !archivedEntries.some((entry) => entry.status === expandedFleetArchiveGroupId)) {
    expandedFleetArchiveGroupId = firstArchiveStatus;
  }
  if (expandedFleetGroupId === "current" && !currentActiveEntry) {
    expandedFleetGroupId = "active";
  }
  if (dispatcherMode && expandedFleetGroupId === "current") {
    expandedFleetGroupId = "active";
  }

  renderFleetSummary();
  syncFleetViewState();

  fleetEmpty.hidden = activeEntries.length > 0;
  fleetList.innerHTML = "";
  if (activeEntries.length > 0) {
    fleetList.innerHTML = dispatcherMode
      ? renderFleetGroup({
          id: "active",
          title: fleetText("fleet.group.orgShips", "Unsere Schiffe"),
          entries: activeEntries,
          emptyText: fleetText("fleet.group.noAvailable", "Keine verfügbaren Schiffe."),
          collapsible: true,
          expanded: expandedFleetGroupId === "active",
          scope: "ships",
          panelize: true,
        })
      : [
      renderFleetGroup({
        id: "current",
        title: fleetText("fleet.group.activeShip", "Aktives Schiff"),
        entries: currentActiveEntry ? [currentActiveEntry] : [],
        emptyText: fleetText("fleet.group.noActiveShip", "Kein aktives Einsatzschiff gewählt."),
        collapsible: true,
        expanded: expandedFleetGroupId === "current",
        scope: "ships",
        panelize: true,
      }),
      renderFleetGroup({
        id: "active",
        title: fleetText("fleet.group.availableShips", "Verfügbare Schiffe"),
        entries: otherActiveEntries,
        emptyText: currentActiveEntry
          ? fleetText("fleet.group.noMoreAvailable", "Keine weiteren verfügbaren Schiffe.")
          : fleetText("fleet.group.noAvailable", "Keine verfügbaren Schiffe."),
        collapsible: true,
        expanded: expandedFleetGroupId === "active",
        scope: "ships",
        panelize: true,
      }),
    ].join("");
  }

  if (fleetArchiveEmpty) {
    fleetArchiveEmpty.hidden = archivedEntries.length > 0;
  }
  if (fleetArchiveList) {
    fleetArchiveList.innerHTML = archivedEntries.length
      ? archiveStatuses
          .map((status) => {
            const statusEntries = archivedEntries.filter((entry) => entry.status === status);
            if (statusEntries.length === 0) return "";
            return renderFleetGroup({
              id: status,
              title: getFleetStatusLabel(status),
              entries: statusEntries,
              emptyText: fleetText("fleet.group.noEntries", "Keine Einträge."),
              collapsible: true,
              expanded: expandedFleetArchiveGroupId === status,
              scope: "archive",
            });
          })
          .join("")
      : "";
  }

  renderFleetDossier();

  bindFleetListEvents(fleetList);
  bindFleetListEvents(fleetArchiveList);
  bindShipProfileMedia(fleetList);
  bindShipProfileMedia(fleetArchiveList);
}

function readFleetDraft() {
  const formData = new FormData(fleetForm);
  const shipId = String(formData.get("shipId") || "").trim();
  const shipType = findShipLibraryEntryById(shipId);
  const status = String(formData.get("status") || "active");
  const patchVersion = normalizeFleetPatchVersion(formData.get("patchVersion"));
  const notes = buildFleetNotesWithPatchVersion(formData.get("notes"), status, patchVersion);
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  return {
    id: String(formData.get("entryId") || "").trim() || createRuntimeId(),
    manufacturer: shipType?.manufacturer || "",
    model: shipType ? getShipEntryDisplayName(shipType) : "",
    registration: String(formData.get("registration") || "").trim(),
    imageUrl: normalizeShipImageUrl(formData.get("imageUrl")),
    refuelContainerSizesScu: formData.getAll("refuelContainerSizesScu"),
    acquiredOn: normalizeDateInput(formData.get("acquiredOn")),
    endedOn: normalizeDateInput(formData.get("endedOn")),
    status,
    patchVersion,
    ownerName: dispatcherMode ? String(fleetOwnerInput?.value || "").trim() : "",
    pilotName: dispatcherMode ? String(fleetPilotInput?.value || "").trim() : "",
    pledgePurchased: Boolean(fleetPledgePurchasedInput?.checked),
    notes,
    shipId,
  };
}

function getFleetFormRefuelContainerSizeValues() {
  return Array.from(fleetRefuelContainerFields?.querySelectorAll('[name="refuelContainerSizesScu"]') || [])
    .map((input) => input.value);
}

function getFleetEntryRefuelContainerSizeValues(entry) {
  const sizes = normalizeRefuelContainerSizeList(entry?.refuelContainerSizesScu);
  if (sizes.some((size) => size > 0)) {
    return sizes;
  }
  const legacySize = normalizePositiveDecimal(entry?.refuelContainerSizeScu);
  return legacySize > 0 ? [legacySize] : [];
}

function renderFleetRefuelContainerFields(values = getFleetFormRefuelContainerSizeValues()) {
  if (!fleetRefuelContainerFields) return;
  const shipType = findShipLibraryEntryById(String(fleetForm.shipId.value || "").trim());
  const containerCount = getRefuelContainerConfig(shipType).containerCount;

  if (!containerCount) {
    fleetRefuelContainerFields.hidden = true;
    fleetRefuelContainerFields.innerHTML = "";
    return;
  }

  const normalizedValues = normalizeRefuelContainerSizeList(values);
  fleetRefuelContainerFields.hidden = false;
  fleetRefuelContainerFields.innerHTML = `
    <div class="grid-3 compact-grid">
      ${Array.from({ length: containerCount }, (_, index) => `
        <label>
          ${escapeHtml(fleetText("fleet.form.containerLabel", "Behälter {number} (SCU)", { number: index + 1 }))}
          <input
            type="number"
            name="refuelContainerSizesScu"
            min="0"
            step="0.01"
            placeholder="${escapeHtml(fleetText("fleet.form.containerPlaceholder", "z. B. 32"))}"
            value="${escapeHtml(normalizedValues[index] ?? "")}"
          />
        </label>
      `).join("")}
    </div>
  `;
}

function populateFleetForm(entry) {
  const linkedShip = findShipLibraryEntryForFleetEntry(entry);
  fleetForm.entryId.value = entry.id;
  renderFleetPresetOptions(linkedShip?.id || "", linkedShip?.manufacturer || entry.manufacturer || "");
  fleetForm.shipId.value = linkedShip?.id || "";
  fleetForm.registration.value = entry.registration;
  clearPendingFleetImage();
  originalFleetImageUrl = normalizeShipImageUrl(entry.imageUrl);
  fleetImageRemovalRequested = false;
  fleetForm.imageUrl.value = originalFleetImageUrl;
  syncFleetImagePreview();
  setFleetImageStatus();
  renderFleetRefuelContainerFields(getFleetEntryRefuelContainerSizeValues(entry));
  fleetForm.acquiredOn.value = entry.acquiredOn;
  fleetForm.endedOn.value = entry.endedOn || "";
  fleetForm.status.value = entry.status;
  if (fleetPatchVersionInput) {
    fleetPatchVersionInput.value = entry.patchVersion || extractFleetPatchVersionFromNotes(entry.notes);
  }
  if (fleetOwnerInput) {
    fleetOwnerInput.value = entry.ownerName || "";
  }
  if (fleetPilotInput) {
    fleetPilotInput.value = getFleetEntryPilotName(entry);
  }
  if (fleetPledgePurchasedInput) {
    fleetPledgePurchasedInput.checked = Boolean(entry.pledgePurchased);
  }
  fleetForm.notes.value = entry.notes;
  fleetSubmitButton.textContent = fleetText("common.saveChanges", "Änderungen speichern");
  fleetCancelButton.hidden = false;
  setFleetView("form");
  syncFleetLifecycleFields();
  updateFleetDurationHint();
}

function resetFleetForm() {
  fleetForm.reset();
  clearPendingFleetImage();
  originalFleetImageUrl = "";
  fleetImageRemovalRequested = false;
  fleetForm.entryId.value = "";
  fleetForm.imageUrl.value = "";
  fleetForm.acquiredOn.value = formatDateForInput(new Date());
  fleetForm.status.value = "active";
  fleetForm.endedOn.value = "";
  if (fleetPatchVersionInput) {
    fleetPatchVersionInput.value = "";
  }
  if (fleetOwnerInput) {
    fleetOwnerInput.value = "";
  }
  if (fleetPilotInput) {
    fleetPilotInput.value = "";
  }
  if (fleetPledgePurchasedInput) {
    fleetPledgePurchasedInput.checked = false;
  }
  fleetForm.shipId.value = "";
  if (fleetManufacturerSelect) {
    fleetManufacturerSelect.value = "";
  }
  renderFleetPresetOptions();
  renderFleetRefuelContainerFields([]);
  syncFleetImagePreview();
  setFleetImageStatus();
  fleetSubmitButton.textContent = fleetText("fleet.form.saveShip", "Schiff speichern");
  fleetCancelButton.hidden = true;
  syncFleetViewState();
  syncFleetLifecycleFields();
  updateFleetDurationHint();
}

function syncFleetDispatcherCrewFields() {
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (fleetDispatcherCrewFields) {
    fleetDispatcherCrewFields.hidden = !dispatcherMode;
  }
  [fleetOwnerInput, fleetPilotInput].forEach((input) => {
    if (!input) return;
    input.disabled = !dispatcherMode;
    if (!dispatcherMode) {
      input.value = "";
    }
  });
}

function syncFleetLifecycleFields() {
  if (!fleetStatusSelect || !fleetEndedOn) return;
  const isActive = fleetStatusSelect.value === "active";
  const hasPatchVersion = ["patch-replaced", "wipe-replaced", "wipe-removed"].includes(fleetStatusSelect.value);
  fleetEndedOn.disabled = isActive;
  fleetEndedOn.required = !isActive;
  if (isActive) {
    fleetEndedOn.value = "";
  }
  if (fleetPatchVersionWrap && fleetPatchVersionInput) {
    fleetPatchVersionWrap.hidden = !hasPatchVersion;
    fleetPatchVersionInput.disabled = !hasPatchVersion;
    if (!hasPatchVersion) {
      fleetPatchVersionInput.value = "";
    }
  }
}

function updateFleetDurationHint() {
  if (!fleetDurationHint) return;
  const draft = readFleetDraft();
  if (!fleetManufacturerSelect?.value) {
    fleetDurationHint.innerHTML = `
      <strong>${escapeHtml(fleetText("fleet.form.chooseManufacturerTitle", "Hersteller wählen"))}</strong>
      <span>${escapeHtml(fleetText("fleet.form.chooseManufacturerText", "Wähle zuerst einen Hersteller aus deiner Schiffsdatenbank, damit anschließend die passenden Modelle erscheinen."))}</span>
    `;
    return;
  }

  if (!draft.shipId) {
    fleetDurationHint.innerHTML = `
      <strong>${escapeHtml(fleetText("fleet.form.chooseModelTitle", "Modell wählen"))}</strong>
      <span>${escapeHtml(fleetText("fleet.form.chooseModelText", "Wähle jetzt das passende Modell aus dem gewählten Hersteller aus."))}</span>
    `;
    return;
  }

  if (!draft.acquiredOn) {
    fleetDurationHint.innerHTML = `
      <strong>${escapeHtml(fleetText("fleet.form.ownershipTitle", "Besitzdauer"))}</strong>
      <span>${escapeHtml(fleetText("fleet.form.ownershipText", "Wähle ein Startdatum, damit wir dir die Haltedauer ausrechnen können."))}</span>
    `;
    return;
  }

  if (draft.endedOn && compareDateInputs(draft.endedOn, draft.acquiredOn) < 0) {
    fleetDurationHint.innerHTML = `
      <strong>${escapeHtml(fleetText("fleet.form.checkDateTitle", "Datum prüfen"))}</strong>
      <span>${escapeHtml(fleetText("fleet.form.checkDateText", "Das Enddatum liegt aktuell vor dem Startdatum."))}</span>
    `;
    return;
  }

  const previewEntry = createFleetEntry(draft);
  fleetDurationHint.innerHTML = `
    <strong>${escapeHtml(previewEntry.manufacturer || fleetText("fleet.form.shipFallback", "Schiff"))} ${escapeHtml(previewEntry.model || "")}</strong>
    <span>${escapeHtml(formatFleetOwnershipLine(previewEntry))}</span>
    <small>${escapeHtml(formatFleetDateRange(previewEntry))}</small>
  `;
}

function getFleetOwnershipDays(entry) {
  const start = parseDateInput(entry.acquiredOn);
  const end = parseDateInput(entry.status === "active" ? formatDateForInput(new Date()) : entry.endedOn || entry.acquiredOn);
  if (!start || !end) return 0;
  return Math.max(1, Math.floor((end - start) / 86400000) + 1);
}

function formatFleetOwnershipLine(entry) {
  const duration = formatFleetDurationDays(getFleetOwnershipDays(entry));
  return entry.status === "active"
    ? fleetText("fleet.ownership.since", "Seit {duration} im Besitz", { duration })
    : fleetText("fleet.ownership.past", "{duration} im Besitz gewesen", { duration });
}

function formatFleetDurationDays(days) {
  return fleetText(days === 1 ? "fleet.ownership.day" : "fleet.ownership.days", "{count} Tage", { count: days });
}

function formatFleetDateRange(entry) {
  const start = formatDateDisplay(entry.acquiredOn);
  if (entry.status === "active") {
    return fleetText("fleet.ownership.untilToday", "{start} bis heute", { start });
  }
  return fleetText("fleet.ownership.range", "{start} bis {end}", { start, end: formatDateDisplay(entry.endedOn) });
}

function getFleetLongestOwnershipEntry() {
  return getFleetEntries().reduce((best, entry) => {
    if (!best) return entry;
    return getFleetOwnershipDays(entry) > getFleetOwnershipDays(best) ? entry : best;
  }, null);
}

function createFleetReplacementEntry(sourceEntry, registration = "") {
  return createFleetEntry({
    manufacturer: sourceEntry.manufacturer,
    model: sourceEntry.model,
    registration,
    refuelContainerSizeScu: sourceEntry.refuelContainerSizeScu,
    refuelContainerSizesScu: sourceEntry.refuelContainerSizesScu,
    acquiredOn: sourceEntry.endedOn || formatDateForInput(new Date()),
    endedOn: "",
    status: "active",
    patchVersion: "",
    ownerName: sourceEntry.ownerName,
    pilotId: sourceEntry.pilotId,
    pilotName: sourceEntry.pilotName,
    pledgePurchased: sourceEntry.pledgePurchased,
    notes: "",
    shipId: sourceEntry.shipId,
  });
}

function registerFleetEvents() {
  fleetViewTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setFleetView(button.dataset.fleetViewTarget || "ships");
    });
  });

  fleetWipeButton?.addEventListener("click", openFleetWipeDialog);
  fleetWipeCancel?.addEventListener("click", closeFleetWipeDialog);
  fleetWipeForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!fleetWipeForm.reportValidity()) return;
    applyFleetWipe();
  });
  fleetWipeDate?.addEventListener("input", () => fleetWipeDate.setCustomValidity(""));
  [fleetWipeModeReset, fleetWipeModeFull].forEach((input) => {
    input?.addEventListener("change", renderFleetPatchChangePreview);
  });
  fleetWipeDialog?.addEventListener("click", (event) => {
    if (event.target === fleetWipeDialog) closeFleetWipeDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && fleetWipeDialog && !fleetWipeDialog.hidden) closeFleetWipeDialog();
  });

  fleetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = readFleetDraft();
    if (!draft.shipId || !draft.manufacturer || !draft.model) {
      await showAppNotice(fleetText("fleet.alert.chooseProfile", "Bitte wähle ein Schiffsprofil aus."));
      return;
    }

    if (!draft.acquiredOn) {
      await showAppNotice(fleetText("fleet.alert.missingStart", "Bitte trage ein Startdatum ein."));
      return;
    }

    if (draft.status !== "active" && !draft.endedOn) {
      await showAppNotice(fleetText("fleet.alert.missingEnd", "Bitte trage ein Enddatum ein, wenn das Schiff nicht mehr aktiv ist."));
      return;
    }

    if (draft.endedOn && compareDateInputs(draft.endedOn, draft.acquiredOn) < 0) {
      await showAppNotice(fleetText("fleet.alert.endBeforeStart", "Das Enddatum darf nicht vor dem Startdatum liegen."));
      return;
    }

    const existingIndex = state.fleet.findIndex((entry) => entry.id === draft.id);
    const existingEntry = existingIndex >= 0 ? state.fleet[existingIndex] : null;
    const enteredPatchStatus = draft.status === "patch-replaced" && existingEntry?.status !== "patch-replaced";
    const enteredDestroyedPledgeStatus = draft.status === "destroyed" && draft.pledgePurchased && existingEntry?.status !== "destroyed";
    let replacementDecision = null;

    if (enteredDestroyedPledgeStatus) {
      replacementDecision = await showFleetReplacementDialog({ mode: "pledge-destroyed", entry: draft });
    } else if (enteredPatchStatus) {
      replacementDecision = await showFleetReplacementDialog({ mode: "patch-replaced", entry: draft });
    }
    if (replacementDecision?.aborted) return;

    const selectedPilot = isDispatcherMode()
      ? ensurePilotProfileByName(draft.pilotName)
      : getSoloPilotProfile();
    draft.pilotId = selectedPilot?.id || "";
    draft.pilotName = selectedPilot?.name || "";

    try {
      if (pendingFleetImageFile) {
        setFleetImageStatus(fleetText("fleet.image.uploading", "Bild wird auf den Server geladen ..."), "neutral");
        draft.imageUrl = await uploadFleetImage(pendingFleetImageFile, draft.id);
      } else if (fleetImageRemovalRequested && originalFleetImageUrl) {
        setFleetImageStatus(fleetText("fleet.image.removing", "Individuelles Bild wird entfernt ..."), "neutral");
        await deleteFleetImage(draft.id);
        draft.imageUrl = "";
      }
    } catch (error) {
      setFleetImageStatus(error?.message || fleetText("fleet.image.uploadFailed", "Das Bild konnte nicht importiert werden."), "error");
      return;
    }

    const nextEntry = createFleetEntry({
      ...draft,
      createdAt: existingEntry?.createdAt,
    });
    const replacementEntry = replacementDecision?.createReplacement
      ? createFleetReplacementEntry(nextEntry, replacementDecision.registration)
      : null;
    const wasActiveFleetEntry = state.activeFleetEntryId === nextEntry.id;

    if (existingIndex >= 0) {
      state.fleet.splice(existingIndex, 1, nextEntry);
    } else {
      state.fleet.unshift(nextEntry);
    }
    if (replacementEntry) {
      state.fleet.unshift(replacementEntry);
      if (wasActiveFleetEntry && !isDispatcherMode()) {
        state.activeFleetEntryId = replacementEntry.id;
      }
    } else if (wasActiveFleetEntry && nextEntry.status !== "active") {
      state.activeFleetEntryId = "";
    }

    resetFleetForm();
    setFleetView("ships");
    persist();
    render();
    setActivePage("fleet");
  });

  fleetForm.addEventListener("input", () => {
    updateFleetDurationHint();
  });

  fleetImageFileInput?.addEventListener("change", () => {
    selectFleetImageFile(fleetImageFileInput.files?.[0]);
  });

  fleetImageRemoveButton?.addEventListener("click", () => {
    clearPendingFleetImage();
    fleetImageRemovalRequested = Boolean(originalFleetImageUrl);
    if (fleetForm?.imageUrl) fleetForm.imageUrl.value = "";
    syncFleetImagePreview();
    setFleetImageStatus(
      originalFleetImageUrl
        ? fleetText("fleet.image.removedOnSave", "Das individuelle Bild wird beim Speichern entfernt.")
        : fleetText("fleet.image.selectionCleared", "Die Bildauswahl wurde verworfen."),
      "neutral",
    );
  });

  fleetImageRecognizeButton?.addEventListener("click", () => {
    void recognizeFleetRegistration();
  });

  fleetImagePreview?.addEventListener("load", () => fleetImagePreviewWrap?.classList.remove("is-image-error"));
  fleetImagePreview?.addEventListener("error", () => fleetImagePreviewWrap?.classList.add("is-image-error"));

  fleetStatusSelect?.addEventListener("change", () => {
    syncFleetLifecycleFields();
    syncFleetPatchVersionNote();
    updateFleetDurationHint();
  });

  fleetPatchVersionInput?.addEventListener("input", () => {
    syncFleetPatchVersionNote();
  });

  fleetManufacturerSelect?.addEventListener("change", () => {
    renderFleetPresetOptions("", fleetManufacturerSelect.value);
    renderFleetRefuelContainerFields([]);
    updateFleetDurationHint();
  });

  fleetPresetSelect?.addEventListener("change", () => {
    renderFleetRefuelContainerFields([]);
    updateFleetDurationHint();
  });

  fleetCancelButton?.addEventListener("click", () => {
    resetFleetForm();
    setFleetView("ships");
  });
}
