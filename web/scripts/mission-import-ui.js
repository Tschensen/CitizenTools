// Quick capture, screenshot OCR, and Companion import UI.
let missionImportSound = null;
function addQuickDestinationRow(values = {}) {
  if (!quickDestinationList) return null;
  const row = document.createElement("article");
  row.className = "quick-destination-row";
  row.innerHTML = `
    <label data-i18n-label="contracts.consignments.pickup">
      Abholung
      <input type="text" data-field="quickPickup" list="locationSuggestions" placeholder="Standard" />
    </label>
    <label data-i18n-label="contracts.quick.target">
      Ziel
      <input type="text" data-field="quickDropoff" list="locationSuggestions" placeholder="z. B. Baijini Point" />
    </label>
    <label>
      SCU
      <input type="number" data-field="quickScu" min="1" step="1" placeholder="121" />
    </label>
    <button type="button" class="ghost-button quick-destination-remove icon-only-button" aria-label="Ziel entfernen" title="Ziel entfernen" data-i18n-aria-label="contracts.quick.removeTarget" data-i18n-title="contracts.quick.removeTarget">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
        </svg>
      </span>
    </button>
  `;

  row.querySelector('[data-field="quickPickup"]').value = values.pickup || quickPickup?.value || "";
  row.querySelector('[data-field="quickDropoff"]').value = values.dropoff || "";
  row.querySelector('[data-field="quickScu"]').value = values.targetScu ? String(values.targetScu) : "";
  translateStaticText(row);
  quickDestinationList.appendChild(row);
  refreshQuickDestinationActions();
  return row;
}

function syncQuickPickupFallbacks() {
  const fallbackPickup = String(quickPickup?.value || "").trim();
  Array.from(quickDestinationList?.querySelectorAll('[data-field="quickPickup"]') || []).forEach((field) => {
    if (!field.value.trim()) {
      field.value = fallbackPickup;
    }
  });
}

function refreshQuickDestinationActions() {
  const rows = Array.from(quickDestinationList?.querySelectorAll(".quick-destination-row") || []);
  rows.forEach((row) => {
    const removeButton = row.querySelector(".quick-destination-remove");
    if (removeButton) {
      removeButton.disabled = rows.length <= 1;
    }
  });
}

function readQuickMissionDraft() {
  const routes = Array.from(quickDestinationList?.querySelectorAll(".quick-destination-row") || [])
    .map((row) => ({
      pickup: String(row.querySelector('[data-field="quickPickup"]')?.value || quickPickup?.value || "").trim(),
      dropoff: String(row.querySelector('[data-field="quickDropoff"]')?.value || "").trim(),
      targetScu: Number(String(row.querySelector('[data-field="quickScu"]')?.value || "").replace(",", ".").trim()) || 0,
    }))
    .filter((route) => route.pickup || route.dropoff || route.targetScu > 0);

  return {
    title: String(quickCargoTitle?.value || "").trim(),
    pickup: String(quickPickup?.value || "").trim(),
    routes,
  };
}

function syncQuickMissionHint() {
  if (!quickMissionHint) return;
  const draft = readQuickMissionDraft();
  const validRoutes = draft.routes.filter((route) => route.pickup && route.dropoff && Number.isInteger(route.targetScu) && route.targetScu > 0);
  const totalScu = validRoutes.reduce((sum, route) => sum + route.targetScu, 0);
  const incompleteCount = draft.routes.length - validRoutes.length;
  const missingBasics = !draft.title;

  quickMissionHint.innerHTML = `
    <strong>${validRoutes.length} Strecke${validRoutes.length === 1 ? "" : "n"} · ${formatScuAmount(totalScu)} geplant</strong>
    <span>${missingBasics ? "Fracht ergänzen" : incompleteCount > 0 ? `${incompleteCount} unvollständige Zeile${incompleteCount === 1 ? "" : "n"}` : "Bereit zum Erzeugen"}</span>
  `;
}

async function applyQuickMissionCapture() {
  const draft = readQuickMissionDraft();
  const validRoutes = draft.routes.filter((route) => route.pickup && route.dropoff && Number.isInteger(route.targetScu) && route.targetScu > 0);

  if (!draft.title || validRoutes.length === 0) {
    await showAppNotice("Bitte trage Fracht und mindestens eine vollständige Strecke mit Abholung, Ziel und voller SCU-Menge ein.");
    return;
  }

  const routes = validRoutes.map((route) => {
    const groups = buildContainerGroupsForScu(route.targetScu, getMissionFormMaxContainerScu());
    return {
      pickup: route.pickup,
      dropoff: route.dropoff,
      targetScu: route.targetScu,
      groups: groups.length > 0 ? groups : [{ quantity: 1, containerSize: "1" }],
    };
  });

  const firstEmptyConsignment =
    consignmentList.children.length === 1 &&
    !readConsignmentDraft(consignmentList.firstElementChild).title &&
    readConsignmentDraft(consignmentList.firstElementChild).routes.every((route) => !route.pickup && !route.dropoff);

  if (firstEmptyConsignment) {
    consignmentList.innerHTML = "";
  }

  addConsignmentRow({
    title: draft.title,
    routes,
  });
  updateMissionTitleFromQuickDraft(draft);
  setCollapsibleExpanded("quickCaptureBody", false);
  setCollapsibleExpanded("consignmentBuilderBody", true);
  updateDimensionHint();
}

function updateMissionTitleFromQuickDraft(draft) {
  const titleField = missionForm?.elements?.title;
  if (!titleField || titleField.value.trim()) return;
  titleField.value = summarizeQuickMissionDraft(draft);
}

function summarizeQuickMissionDraft(draft) {
  const routes = draft.routes.filter((route) => route.pickup || route.dropoff);
  const pickups = [...new Set(routes.map((route) => route.pickup).filter(Boolean))];
  const dropoffs = [...new Set(routes.map((route) => route.dropoff).filter(Boolean))];
  if (pickups.length === 1 && dropoffs.length === 1) {
    return `${pickups[0]} → ${dropoffs[0]}`;
  }
  if (pickups.length === 1) {
    return `${pickups[0]} → ${dropoffs.length || routes.length} Ziele`;
  }
  if (dropoffs.length === 1) {
    return `${pickups.length || routes.length} Starts → ${dropoffs[0]}`;
  }
  return `${pickups.length || routes.length} Starts · ${dropoffs.length || routes.length} Ziele`;
}

function openMissionImportDialog() {
  if (!missionImportDialog) return;
  resetMissionImportDialog();
  translateStaticText(missionImportDialog);
  missionImportDialog.hidden = false;
  void loadMissionImportInbox();
  missionImportInboxTimer = window.setInterval(() => {
    void loadMissionImportInbox({ quiet: true });
  }, 6000);
  missionImportClipboardButton?.focus();
}

function closeMissionImportDialog() {
  if (!missionImportDialog) return;
  missionImportRequestId += 1;
  if (missionImportInboxTimer) {
    window.clearInterval(missionImportInboxTimer);
    missionImportInboxTimer = null;
  }
  missionImportDialog.hidden = true;
  resetMissionImportDialog();
  openMissionImportDialogButton?.focus();
}

function resetMissionImportDialog() {
  missionImportSound?.cancel();
  missionImportSound = null;
  missionImportBusy = false;
  if (missionImportImageUrl) {
    URL.revokeObjectURL(missionImportImageUrl);
    missionImportImageUrl = "";
  }
  if (missionImportClipboardButton) missionImportClipboardButton.disabled = false;
  if (missionImportFileInput) {
    missionImportFileInput.value = "";
    missionImportFileInput.disabled = false;
  }
  if (missionImportImage) missionImportImage.removeAttribute("src");
  if (missionImportImageWrap) missionImportImageWrap.hidden = true;
  if (missionImportPreview) missionImportPreview.hidden = true;
  if (missionImportDuplicateWarning) {
    missionImportDuplicateWarning.hidden = true;
    missionImportDuplicateWarning.innerHTML = "";
  }
  if (missionImportStatus) {
    missionImportStatus.hidden = true;
    missionImportStatus.innerHTML = "";
  }
  if (missionImportConsignmentList) missionImportConsignmentList.innerHTML = "";
  if (missionImportPreviewSummary) missionImportPreviewSummary.textContent = "";
  if (missionImportApply) missionImportApply.disabled = true;
  selectedMissionImportId = "";
  missionImportDraftMetadata = { payout: null, maxContainerScu: null };
  missionImportOriginalDraft = null;
  missionImportInboxItems = [];
  if (missionImportInboxList) missionImportInboxList.innerHTML = "";
  if (missionImportInboxStatus) missionImportInboxStatus.textContent = t("contracts.import.liveLoading");
  missionImportDropzone?.classList.remove("is-dragging", "is-busy");
}

function getMissionImportsUrl(path = "") {
  const scope = encodeURIComponent(activeAppMode);
  return `${MISSION_IMPORTS_URL}${path}?scope=${scope}`;
}

function getMissionImportHeaders(headers = {}, mode = activeAppMode) {
  return window.DispatcherAuth?.getHeaders(mode, headers) || { ...headers };
}

function buildMissionFromCompanionImport(item) {
  const draft = item?.draft || {};
  const importedPayout = Math.round(Number(draft.payout) || 0);
  const importedType = normalizeMissionType(draft.type);
  if (importedType === "delivery") {
    const serviceDetails = getMissionServiceDetails({ serviceDetails: draft.serviceDetails });
    serviceDetails.packages = serviceDetails.packages.map((entry) => {
      const id = entry.id || createRuntimeId();
      return {
        ...entry,
        id,
        cargoSegmentId: Number(entry.containerScu) > 0 ? entry.cargoSegmentId || createRuntimeId() : "",
      };
    });
    serviceDetails.location = serviceDetails.location || serviceDetails.packages[0]?.destination || "";
    const segments = buildDeliverySegments(serviceDetails.packages);
    const loads = createLoadsFromConsignments(segments);
    const assignedEntry = !isDispatcherMode()
      && (segments.length === 0 || hasShipCargoGrid(currentActiveShipProfile()))
      ? currentActiveFleetEntry()
      : null;
    const destinations = [...new Set(serviceDetails.packages.map((entry) => entry.destination).filter(Boolean))];
    return {
      id: createRuntimeId(),
      type: "delivery",
      title: String(draft.title || t("mission.type.delivery")),
      pickup: serviceDetails.packages[0]?.pickup || String(draft.pickup || ""),
      dropoff: destinations.length === 1 ? destinations[0] : `${destinations.length} Ziele`,
      notes: "",
      payout: importedPayout > 0 ? importedPayout : null,
      maxContainerScu: segments.length ? Math.max(...segments.map((segment) => Number(segment.scuPerLoad) || 0)) : null,
      color: randomColor(),
      assignedFleetEntryId: assignedEntry?.id || "",
      serviceDetails,
      segments,
      loads,
      status: "active",
      completedAt: "",
      paidAt: "",
      createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
      sourceImportId: String(item.id || ""),
      sourceImportFile: String(item.sourceFile || ""),
      sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
      sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
    };
  }
  if (importedType === "courier") {
    const serviceDetails = getMissionServiceDetails({ serviceDetails: draft.serviceDetails });
    serviceDetails.packages = serviceDetails.packages.map((entry) => ({
      ...entry,
      id: entry.id || createRuntimeId(),
    }));
    serviceDetails.location = serviceDetails.location || serviceDetails.packages[0]?.destination || "";
    const assignedEntry = !isDispatcherMode() ? currentActiveFleetEntry() : null;
    const destinations = [...new Set(serviceDetails.packages.map((entry) => entry.destination).filter(Boolean))];
    return {
      id: createRuntimeId(),
      type: "courier",
      title: String(draft.title || t("mission.type.courier")),
      pickup: serviceDetails.packages[0]?.pickup || String(draft.pickup || ""),
      dropoff: destinations.length === 1 ? destinations[0] : `${destinations.length} Ziele`,
      notes: "",
      payout: importedPayout > 0 ? importedPayout : null,
      maxContainerScu: null,
      color: randomColor(),
      assignedFleetEntryId: assignedEntry?.id || "",
      serviceDetails,
      segments: [],
      loads: [],
      status: "active",
      completedAt: "",
      paidAt: "",
      createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
      sourceImportId: String(item.id || ""),
      sourceImportFile: String(item.sourceFile || ""),
      sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
      sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
    };
  }
  if (importedType === "refuel") {
    const serviceDetails = getMissionServiceDetails({ serviceDetails: draft.serviceDetails });
    const readiness = getRefuelReadiness(serviceDetails.serviceType, serviceDetails);
    const assignedEntry = !isDispatcherMode() && readiness.ok ? readiness.activeEntry : null;
    return {
      id: createRuntimeId(),
      type: "refuel",
      title: String(draft.title || t("mission.type.refuel")),
      pickup: "",
      dropoff: serviceDetails.location,
      notes: "",
      payout: importedPayout > 0 ? importedPayout : null,
      maxContainerScu: null,
      color: randomColor(),
      assignedFleetEntryId: assignedEntry?.id || "",
      serviceDetails,
      segments: [],
      loads: [],
      status: "active",
      completedAt: "",
      paidAt: "",
      createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
      sourceImportId: String(item.id || ""),
      sourceImportFile: String(item.sourceFile || ""),
      sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
      sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
    };
  }
  if (importedType === "investigation") {
    const serviceDetails = getMissionServiceDetails({ serviceDetails: draft.serviceDetails });
    const assignedEntry = !isDispatcherMode() ? currentActiveFleetEntry() : null;
    return {
      id: createRuntimeId(),
      type: "investigation",
      title: String(draft.title || t("mission.type.investigation")),
      pickup: "",
      dropoff: serviceDetails.location,
      notes: "",
      payout: importedPayout > 0 ? importedPayout : null,
      maxContainerScu: null,
      color: randomColor(),
      assignedFleetEntryId: assignedEntry?.id || "",
      serviceDetails,
      segments: [],
      loads: [],
      status: "active",
      completedAt: "",
      paidAt: "",
      createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
      sourceImportId: String(item.id || ""),
      sourceImportFile: String(item.sourceFile || ""),
      sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
      sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
    };
  }
  if (importedType === "salvage") {
    const serviceDetails = getMissionServiceDetails({ serviceDetails: draft.serviceDetails });
    const readiness = getSalvageReadiness();
    const assignedEntry = !isDispatcherMode() && readiness.ok ? readiness.activeEntry : null;
    return {
      id: createRuntimeId(),
      type: "salvage",
      title: String(draft.title || t("mission.type.salvage")),
      pickup: "",
      dropoff: serviceDetails.location,
      notes: "",
      payout: importedPayout > 0 ? importedPayout : null,
      maxContainerScu: null,
      color: randomColor(),
      assignedFleetEntryId: assignedEntry?.id || "",
      serviceDetails,
      segments: [],
      loads: [],
      status: "active",
      completedAt: "",
      paidAt: "",
      createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
      sourceImportId: String(item.id || ""),
      sourceImportFile: String(item.sourceFile || ""),
      sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
      sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
    };
  }
  if (["procurement", "mining"].includes(importedType)) {
    const serviceDetails = getMissionServiceDetails({ serviceDetails: draft.serviceDetails });
    const miningReadiness = importedType === "mining"
      ? getMiningReadiness(serviceDetails.miningMethod)
      : null;
    const assignedEntry = !isDispatcherMode()
      && (importedType === "procurement" || serviceDetails.miningMethod === "hand" || miningReadiness?.ok)
      ? currentActiveFleetEntry()
      : null;
    return {
      id: createRuntimeId(),
      type: importedType,
      title: String(draft.title || t(`mission.type.${importedType}`)),
      pickup: "",
      dropoff: serviceDetails.location,
      notes: "",
      payout: importedPayout > 0 ? importedPayout : null,
      maxContainerScu: null,
      color: randomColor(),
      assignedFleetEntryId: assignedEntry?.id || "",
      serviceDetails,
      segments: [],
      loads: [],
      status: "active",
      completedAt: "",
      paidAt: "",
      createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
      sourceImportId: String(item.id || ""),
      sourceImportFile: String(item.sourceFile || ""),
      sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
      sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
    };
  }
  const importedMaxContainerScu = normalizeMissionMaxContainerScu(draft.maxContainerScu);
  const importedConsignments = normalizeMissionImportConsignments(draft);
  const segments = [];

  importedConsignments.forEach((consignment, cargoIndex) => {
    const expectedCargoScu = Number(consignment.totalScu) || 0;
    const routes = Array.isArray(consignment.routes) ? consignment.routes : [];
    routes.forEach((route, routeIndex) => {
      const pickup = String(route.pickup || consignment.pickup || "").trim();
      const dropoff = String(route.dropoff || "").trim();
      if (!pickup || !dropoff) return;
      const routeTargetScu = Number(route.targetScu) || 0;
      const groups = routeTargetScu > 0 ? buildContainerGroupsForScu(routeTargetScu, importedMaxContainerScu) : [];
      const title = String(consignment.title || draft.title || `${pickup} → ${dropoff}`).trim();

      if (groups.length === 0) {
        segments.push({
          id: createRuntimeId(),
          title,
          pickup,
          dropoff,
          quantity: 0,
          containerSize: "",
          width: 0,
          depth: 0,
          height: 0,
          isHandheld: false,
          isPlaceable: false,
          scuPerLoad: 0,
          totalScu: 0,
          routeTargetScu: 0,
          expectedCargoScu,
          quantityPending: true,
          cargoIndex,
          cargoRouteIndex: routeIndex,
          cargoGroupIndex: 0,
          order: cargoIndex * 10000 + routeIndex * 100,
        });
        return;
      }

      groups.forEach((group, groupIndex) => {
        const container = parseCargoContainerValue(group.containerSize);
        const quantity = Math.max(1, Number(group.quantity) || 1);
        segments.push({
          id: createRuntimeId(),
          title,
          pickup,
          dropoff,
          quantity,
          containerSize: container.key,
          width: container.width,
          depth: container.depth,
          height: container.height,
          isHandheld: container.isHandheld,
          isPlaceable: container.isPlaceable,
          scuPerLoad: container.scu,
          totalScu: container.scu * quantity,
          routeTargetScu,
          expectedCargoScu: expectedCargoScu || routeTargetScu,
          quantityPending: false,
          cargoIndex,
          cargoRouteIndex: routeIndex,
          cargoGroupIndex: groupIndex,
          order: cargoIndex * 10000 + routeIndex * 100 + groupIndex,
        });
      });
    });
  });

  if (segments.length === 0) return null;
  const dropoffs = [...new Set(segments.map((segment) => segment.dropoff).filter(Boolean))];
  const assignedEntry = !isDispatcherMode() && hasShipCargoGrid(currentActiveShipProfile())
    ? currentActiveFleetEntry()
    : null;
  const mission = {
    id: createRuntimeId(),
    type: "cargo",
    title: String(draft.title || importedConsignments.map((entry) => entry.title).filter(Boolean).join(" + ") || t("contracts.import.liveUntitled")),
    pickup: segments[0]?.pickup || "",
    dropoff: dropoffs.length === 1 ? dropoffs[0] : `${dropoffs.length} Ziele`,
    notes: "",
    payout: importedPayout > 0 ? importedPayout : null,
    maxContainerScu: importedMaxContainerScu,
    color: randomColor(),
    assignedFleetEntryId: assignedEntry?.id || "",
    serviceDetails: getMissionServiceDetails({ serviceDetails: draft.serviceDetails }),
    segments,
    loads: [],
    status: "active",
    completedAt: "",
    paidAt: "",
    createdAt: item.capturedAt || item.createdAt || new Date().toISOString(),
    sourceImportId: String(item.id || ""),
    sourceImportFile: String(item.sourceFile || ""),
    sourceImportDevice: String(item.sourceLabel || item.sourceDevice || ""),
    sourceImportQuality: normalizeMissionImportQuality(draft.fieldQuality),
  };
  mission.loads = createLoadsFromConsignments(segments);
  return mission;
}

async function syncImportedMissionMetadata(mode = activeAppMode) {
  const importMode = normalizeAppMode(mode);
  if (missionImportMetadataSyncedModes.has(importMode)) return;

  const scope = encodeURIComponent(importMode);
  const { response, payload } = await soloRequestJson(`${MISSION_IMPORTS_URL}?scope=${scope}&status=imported`, {
    headers: getMissionImportHeaders({ Accept: "application/json" }, importMode),
    cache: "no-store",
  });
  if (!response.ok || !payload.ok || payload.scope !== importMode || soloPending || soloSaving || soloEditing()) return;

  const importsById = new Map(
    (Array.isArray(payload.imports) ? payload.imports : [])
      .filter((item) => item?.id && item?.draft)
      .map((item) => [String(item.id), item.draft]),
  );
  let changed = false;

  state.missions.forEach((mission) => {
    const draft = importsById.get(String(mission.sourceImportId || ""));
    if (!draft) return;

    const importedPayout = Math.round(Number(draft.payout) || 0);
    if (!missionHasPayout(mission) && importedPayout > 0) {
      mission.payout = importedPayout;
      changed = true;
    }

    const importedMaxContainerScu = normalizeMissionMaxContainerScu(draft.maxContainerScu);
    if (!normalizeMissionMaxContainerScu(mission.maxContainerScu) && importedMaxContainerScu) {
      mission.maxContainerScu = importedMaxContainerScu;
      changed = true;
    }

    const importedCustomer = getMissionServiceDetails({ serviceDetails: draft.serviceDetails }).customer;
    const missionDetails = getMissionServiceDetails(mission);
    if (!missionDetails.customer && importedCustomer) {
      mission.serviceDetails = { ...missionDetails, customer: importedCustomer };
      changed = true;
    }

    const importedQuality = normalizeMissionImportQuality(draft.fieldQuality);
    if (
      Object.keys(importedQuality).length > 0
      && Object.keys(normalizeMissionImportQuality(mission.sourceImportQuality)).length === 0
    ) {
      mission.sourceImportQuality = importedQuality;
      changed = true;
    }
  });

  if (changed) {
    localStorage.setItem(getStateStorageKey(importMode), JSON.stringify(state));
    render();
    const saved = await saveRemoteState(cloneData(state), importMode);
    if (!saved) return;
  }

  missionImportMetadataSyncedModes.add(importMode);
}

function stageSoloImports(items, importMode) {
  const previousState = state;
  state = cloneData(state);
  try {
    const existingImportIds = new Set(
      state.missions.map((mission) => String(mission.sourceImportId || "")).filter(Boolean),
    );
    const importResults = items.map((item) => ({
      item,
      alreadyCreated: Boolean(item?.id && existingImportIds.has(String(item.id))),
      mission: item?.id && !existingImportIds.has(String(item.id))
        ? buildMissionFromCompanionImport(item)
        : null,
    }));
    const newMissionResults = importResults.filter((result) => result.mission);
    newMissionResults.forEach(({ item, mission }) => {
      const importedPilotName = normalizePilotName(item?.pilotName);
      const soloPilot = importMode === "solo" ? getSoloPilotProfile() : null;
      const importedPilot = importedPilotName
        ? ensurePilotProfileByName(importedPilotName, {
            preferredId: importMode === "solo" ? soloPilot?.id || state.soloPilotId || SOLO_PILOT_ID : "",
          })
        : null;
      if (importedPilot && importMode === "solo") {
        state.soloPilotId = importedPilot.id;
      }
      if (importMode === "solo") {
        setMissionAssignment(mission, {
          fleetEntryId: mission.assignedFleetEntryId,
          pilotId: importedPilot?.id,
          assignedAt: mission.createdAt,
        });
      } else if (importedPilot) {
        mission.submittedByPilotId = importedPilot.id;
      }
    });
    const newMissions = newMissionResults.map((result) => result.mission);
    const reservedImportColors = [];
    newMissions.forEach((mission) => {
      mission.color = getNextMissionColor("", reservedImportColors);
      reservedImportColors.push(mission.color);
    });
    const acknowledgedItems = importResults
      .filter((result) => result.alreadyCreated || result.mission)
      .map((result) => result.item);

    state.missions.unshift(...newMissions);
    syncRunRouteProgress();
    return { state: soloCleanState(state), importIds: acknowledgedItems.map(item => String(item.id)) };
  } finally { state = previousState; }
}

async function autoImportPendingMissions(mode = activeAppMode) {
  if (window.personalTransferBusy) return;
  const importMode = normalizeAppMode(mode);
  if (
    missionAutoImportBusy
    || soloPending || soloSaving || soloPolling
    || document.activeElement?.matches("input,select,textarea")
    || document.querySelector('.app-dialog-backdrop:not([hidden])')
    || !remoteHydrationComplete
    || importMode !== activeAppMode
    || !canUseRemotePersistence()
  ) return;

  missionAutoImportBusy = true;
  try {
    if (remoteSaveTimer) return;
    const remotePayload = await fetchRemoteState(importMode);
    if (soloPending || soloSaving || remoteSaveTimer || soloEditing()) return;
    if (
      remotePayload?.state
      && isRemoteScopeCompatible(remotePayload, importMode)
      && remotePayload.updatedAt !== soloRevision
    ) {
      applySoloState(remotePayload);
    }

    await syncImportedMissionMetadata(importMode);

    const { response, payload } = await soloRequestJson(`${getMissionImportsUrl()}&status=pending`, {
      headers: getMissionImportHeaders({ Accept: "application/json" }, importMode),
      cache: "no-store",
    });
    if (!response.ok || !payload.ok || payload.scope !== importMode) return;

    const items = Array.isArray(payload.imports) ? payload.imports : [];
    if (items.length === 0) return;
    if (soloPending || soloSaving || remoteSaveTimer || soloEditing()) return;
    const staged = stageSoloImports(items, importMode);
    if (!staged.importIds.length) return;
    // The PC commits the state and acknowledges these imports in one SQLite
    // transaction. A competing importer simply reads that result next time.
    soloPolling = true;
    try {
      const { response: saved, payload: committed } = await soloRequestJson("./api/state?scope=solo", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...staged, baseUpdatedAt: soloRevision }),
      });
      if (saved.status === 409) return;
      if (!saved.ok) throw new Error(committed.error || "solo_import_save_failed");
      const shared = { ...committed, state: staged.state };
      if (!rebaseSoloState(shared)) {
        localStorage.setItem(`${STORAGE_KEY}:conflict-recovery`, JSON.stringify(soloPending || state));
        soloPending = null;
        applySoloState(shared);
        showSoloConflict();
      }
    } finally { soloPolling = false; }

    if (missionImportDialog && !missionImportDialog.hidden) {
      await loadMissionImportInbox({ quiet: true });
    }
  } catch (error) {
    // Pending imports remain on the server and are retried on the next poll.
  } finally {
    missionAutoImportBusy = false;
  }
}

function startMissionAutoImportPolling() {
  if (missionAutoImportTimer) return;
  missionAutoImportTimer = window.setInterval(() => {
    void autoImportPendingMissions(activeAppMode);
  }, 6000);
}

function isMissionImportCreated(importId) {
  const normalizedImportId = String(importId || "").trim();
  return Boolean(
    normalizedImportId
      && state.missions.some((mission) => String(mission.sourceImportId || "") === normalizedImportId),
  );
}

function getMissionImportJobDisplayStatus(job) {
  if (job?.status !== "completed") return String(job?.status || "failed");
  return isMissionImportCreated(job.importId) ? "imported" : "recognized";
}

function sortMissionImportProgressJobs(jobs) {
  const priority = { processing: 0, queued: 1, failed: 2, completed: 3 };
  return jobs.slice().sort((left, right) => {
    const statusDifference = (priority[left?.status] ?? 9) - (priority[right?.status] ?? 9);
    if (statusDifference !== 0) return statusDifference;
    if (["queued", "processing"].includes(left?.status)) {
      const positionDifference = (Number(left.queuePosition) || 0) - (Number(right.queuePosition) || 0);
      if (positionDifference !== 0) return positionDifference;
      return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
    }
    return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
  });
}

function setMissionImportProgressPanelOpen(isOpen) {
  const shouldOpen = Boolean(isOpen && missionImportProgressJobs.length > 0);
  if (companionImportQueuePanel) companionImportQueuePanel.hidden = !shouldOpen;
  companionImportActivity?.setAttribute("aria-expanded", String(shouldOpen));
}

function renderMissionImportProgressQueue(jobs) {
  if (!companionImportQueueList || !companionImportQueueMeta) return;
  const sortedJobs = sortMissionImportProgressJobs(jobs).slice(0, 20);
  const activeCount = sortedJobs.filter((job) => ["queued", "processing"].includes(job?.status)).length;
  companionImportQueueMeta.textContent = activeCount > 0
    ? t("contracts.import.progress.queueActive", { active: activeCount, total: sortedJobs.length })
    : t("contracts.import.progress.queueRecent", { count: sortedJobs.length });

  if (sortedJobs.length === 0) {
    companionImportQueueList.innerHTML = `<p class="companion-import-queue-empty">${escapeHtml(t("contracts.import.progress.queueEmpty"))}</p>`;
    return;
  }

  const locale = currentUiLanguage() === "en" ? "en-US" : "de-DE";
  companionImportQueueList.innerHTML = sortedJobs.map((job) => {
    const displayStatus = getMissionImportJobDisplayStatus(job);
    const updatedAt = new Date(job.updatedAt || job.createdAt || 0);
    const timeLabel = Number.isNaN(updatedAt.getTime())
      ? t("common.notSpecified")
      : updatedAt.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const sourceLabel = job.sourceLabel || job.sourceDevice || t("contracts.import.liveUnknownDevice");
    const sourceFile = job.sourceFile || t("contracts.import.progress.screenshot");
    const detail = displayStatus === "queued"
      ? Number(job.queuePosition) > 0
        ? t("contracts.import.progress.queuePosition", { position: Number(job.queuePosition) })
        : t("contracts.import.progress.queuedMeta")
      : displayStatus === "processing"
        ? t("contracts.import.progress.processing")
        : displayStatus === "recognized"
          ? t("contracts.import.progress.completedMeta")
          : displayStatus === "imported"
            ? t("contracts.import.progress.importedMeta")
            : job.message || t("contracts.import.progress.failedMeta");
    return `
      <article class="companion-import-job" data-status="${escapeHtml(displayStatus)}" role="listitem">
        <span class="companion-import-job-indicator" aria-hidden="true"></span>
        <span class="companion-import-job-copy">
          <strong>${escapeHtml(sourceFile)}</strong>
          <span>${escapeHtml(t("contracts.import.progress.jobMeta", { device: sourceLabel, time: timeLabel }))}</span>
          <small>${escapeHtml(detail)}</small>
        </span>
        <span class="companion-import-job-state">${escapeHtml(t(`contracts.import.progress.status.${displayStatus}`))}</span>
      </article>
    `;
  }).join("");
}

function initializeMissionImportProgressPanel() {
  companionImportActivity?.addEventListener("click", () => {
    setMissionImportProgressPanelOpen(Boolean(companionImportQueuePanel?.hidden));
  });
  companionImportQueueClose?.addEventListener("click", () => {
    setMissionImportProgressPanelOpen(false);
    companionImportActivity?.focus();
  });
  companionImportOpenContracts?.addEventListener("click", () => {
    setMissionImportProgressPanelOpen(false);
    setActivePage("overview");
  });
  document.addEventListener("click", (event) => {
    if (companionImportQueuePanel?.hidden) return;
    const target = event.target instanceof Node ? event.target : null;
    if (!target || companionImportQueuePanel.contains(target) || companionImportActivity?.contains(target)) return;
    setMissionImportProgressPanelOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && companionImportQueuePanel && !companionImportQueuePanel.hidden) {
      setMissionImportProgressPanelOpen(false);
      companionImportActivity?.focus();
    }
  });
}

function renderMissionImportProgress(jobs = missionImportProgressJobs) {
  if (!companionImportActivity || !companionImportActivityTitle || !companionImportActivityMeta || !companionImportActivityCount) return;
  missionImportProgressJobs = Array.isArray(jobs) ? jobs : [];
  renderMissionImportProgressQueue(missionImportProgressJobs);

  const now = Date.now();
  const activeJobs = missionImportProgressJobs.filter((job) => ["queued", "processing"].includes(job?.status));
  const latestFinishedJob = missionImportProgressJobs
    .filter((job) => ["completed", "failed"].includes(job?.status))
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime())[0] || null;
  const latestFinishedAge = latestFinishedJob
    ? now - new Date(latestFinishedJob.updatedAt || 0).getTime()
    : Number.POSITIVE_INFINITY;

  if (activeJobs.length > 0) {
    const processingCount = activeJobs.filter((job) => job.status === "processing").length;
    const waitingCount = activeJobs.length - processingCount;
    companionImportActivity.dataset.state = processingCount > 0 ? "processing" : "queued";
    companionImportActivityTitle.textContent = activeJobs.length === 1
      ? processingCount > 0
        ? t("contracts.import.progress.processingSingle")
        : t("contracts.import.progress.queuedSingle")
      : t("contracts.import.progress.activePlural", { count: activeJobs.length });
    companionImportActivityMeta.textContent = processingCount > 0
      ? waitingCount > 0
        ? t(waitingCount === 1
          ? "contracts.import.progress.processingWithQueueSingle"
          : "contracts.import.progress.processingWithQueue", { waiting: waitingCount })
        : t("contracts.import.progress.processing")
      : t(waitingCount === 1
        ? "contracts.import.progress.waitingSingle"
        : "contracts.import.progress.waiting", { count: waitingCount });
    companionImportActivityCount.textContent = String(activeJobs.length);
    companionImportActivity.hidden = false;
  } else if (latestFinishedJob?.status === "failed" && latestFinishedAge <= 90000) {
    companionImportActivity.dataset.state = "failed";
    companionImportActivityTitle.textContent = t("contracts.import.progress.failed");
    companionImportActivityMeta.textContent = latestFinishedJob.message || t("contracts.import.progress.failedMeta");
    companionImportActivityCount.textContent = "!";
    companionImportActivity.hidden = false;
  } else if (latestFinishedJob?.status === "completed" && latestFinishedAge <= 45000) {
    const wasImported = isMissionImportCreated(latestFinishedJob.importId);
    companionImportActivity.dataset.state = "completed";
    companionImportActivityTitle.textContent = t(wasImported
      ? "contracts.import.progress.imported"
      : "contracts.import.progress.completed");
    companionImportActivityMeta.textContent = t(wasImported
      ? "contracts.import.progress.importedMeta"
      : "contracts.import.progress.completedMeta");
    companionImportActivityCount.textContent = "✓";
    companionImportActivity.hidden = false;
  } else if (!companionImportQueuePanel?.hidden && missionImportProgressJobs.length > 0) {
    companionImportActivity.hidden = false;
  } else {
    companionImportActivity.hidden = true;
    setMissionImportProgressPanelOpen(false);
  }

  if (!companionImportActivity.hidden) {
    companionImportActivity.setAttribute(
      "aria-label",
      `${companionImportActivityTitle.textContent}. ${companionImportActivityMeta.textContent}`,
    );
  }
}

async function pollMissionImportProgress() {
  if (missionImportProgressBusy || !canUseRemotePersistence()) return;
  missionImportProgressBusy = true;
  try {
    const scope = encodeURIComponent(activeAppMode);
    const { response, payload } = await soloRequestJson(`${MISSION_IMPORT_PROGRESS_URL}?scope=${scope}`, {
      headers: getMissionImportHeaders({ Accept: "application/json" }),
      cache: "no-store",
    });
    if (!response.ok || !payload.ok || payload.scope !== activeAppMode) {
      return;
    }
    const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    window.soloImportSounds?.observe(jobs);
    renderMissionImportProgress(jobs);
    const hasRecognizedImport = jobs.some((job) => (
      job?.status === "completed"
      && job.importId
      && !isMissionImportCreated(job.importId)
    ));
    if (hasRecognizedImport) {
      await autoImportPendingMissions(activeAppMode);
      renderMissionImportProgress(jobs);
    }
  } catch (error) {
    // Keep the last known queue visible during a transient connection issue.
  } finally {
    missionImportProgressBusy = false;
  }
}

function startMissionImportProgressPolling() {
  if (missionImportProgressTimer) return;
  void pollMissionImportProgress();
  missionImportProgressTimer = window.setInterval(() => {
    void pollMissionImportProgress();
  }, 2000);
}

async function loadMissionImportInbox({ quiet = false } = {}) {
  if (!missionImportInboxList || !missionImportInboxStatus) return;
  if (!quiet) missionImportInboxStatus.textContent = t("contracts.import.liveLoading");
  if (missionImportRefresh) missionImportRefresh.disabled = true;

  try {
    const { response, payload } = await soloRequestJson(`${getMissionImportsUrl()}&status=pending`, {
      headers: getMissionImportHeaders({ Accept: "application/json" }),
      cache: "no-store",
    });
    if (!response.ok || !payload.ok) throw new Error("import_inbox_unavailable");
    if (payload.scope !== activeAppMode || missionImportDialog?.hidden) return;
    missionImportInboxItems = Array.isArray(payload.imports) ? payload.imports : [];
    renderMissionImportInbox();
  } catch (error) {
    if (!quiet || missionImportInboxItems.length === 0) {
      missionImportInboxStatus.textContent = t("contracts.import.liveUnavailable");
    }
  } finally {
    if (missionImportRefresh) missionImportRefresh.disabled = false;
  }
}

function renderMissionImportInbox() {
  if (!missionImportInboxList || !missionImportInboxStatus) return;
  const locale = currentUiLanguage() === "en" ? "en-US" : "de-DE";
  missionImportInboxStatus.textContent = missionImportInboxItems.length
    ? t("contracts.import.liveCount", { count: missionImportInboxItems.length })
    : t("contracts.import.liveEmpty");
  missionImportInboxList.innerHTML = missionImportInboxItems
    .map((item) => {
      const draft = item?.draft || {};
      const consignments = Array.isArray(draft.consignments) ? draft.consignments : [];
      const routes = consignments.length > 0
        ? consignments.flatMap((consignment) => Array.isArray(consignment.routes) ? consignment.routes : [])
        : Array.isArray(draft.routes) ? draft.routes : [];
      const totalScu = consignments.length > 0
        ? consignments.reduce((sum, consignment) => sum + (Number(consignment.totalScu) || 0), 0)
        : routes.reduce((sum, route) => sum + (Number(route.targetScu) || 0), 0);
      const timestamp = item.capturedAt || item.createdAt;
      const timeLabel = timestamp
        ? new Date(timestamp).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })
        : t("common.notSpecified");
      const sourceLabel = item.sourceLabel || item.sourceDevice || t("contracts.import.liveUnknownDevice");
      const correctionCount = Array.isArray(item.locationCorrections) ? item.locationCorrections.length : 0;
      const maxContainerScu = normalizeMissionMaxContainerScu(draft.maxContainerScu);
      const payout = Math.round(Number(draft.payout) || 0);
      const importedType = normalizeMissionType(draft.type);
      const isCourierImport = importedType === "courier";
      const isDeliveryImport = importedType === "delivery";
      const isRefuelImport = importedType === "refuel";
      const isInvestigationImport = importedType === "investigation";
      const isSalvageImport = importedType === "salvage";
      const isProcurementImport = importedType === "procurement";
      const isMiningImport = importedType === "mining";
      const courierDetails = isCourierImport || isDeliveryImport ? getMissionServiceDetails({ serviceDetails: draft.serviceDetails }) : null;
      const refuelDetails = isRefuelImport ? getMissionServiceDetails({ serviceDetails: draft.serviceDetails }) : null;
      const investigationDetails = isInvestigationImport ? getMissionServiceDetails({ serviceDetails: draft.serviceDetails }) : null;
      const salvageDetails = isSalvageImport ? getMissionServiceDetails({ serviceDetails: draft.serviceDetails }) : null;
      const procurementDetails = isProcurementImport ? getMissionServiceDetails({ serviceDetails: draft.serviceDetails }) : null;
      const miningDetails = isMiningImport ? getMissionServiceDetails({ serviceDetails: draft.serviceDetails }) : null;
      const importDetails = (isCourierImport || isDeliveryImport
        ? [
            getMissionTypeLabel(importedType),
            courierDetails.packages.map((entry) => `${entry.quantity} × ${entry.name}${Number(entry.containerScu) > 0 ? ` (${entry.containerScu} SCU)` : ""}`).join(", "),
            courierDetails.packages.map((entry) => `${entry.pickup} → ${entry.destination}`).join(", "),
            courierDetails.customer,
            payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
          ]
        : isRefuelImport
        ? [
            getMissionTypeLabel("refuel"),
            refuelDetails.location,
            refuelDetails.targetVehicle,
            payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
          ]
        : isInvestigationImport
          ? [
              getMissionTypeLabel("investigation"),
              investigationDetails.location,
              investigationDetails.subject,
              investigationDetails.caseNumber,
              payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
            ]
          : isSalvageImport
            ? [
                getMissionTypeLabel("salvage"),
                salvageDetails.salvageTarget,
                salvageDetails.claimNumber,
                salvageDetails.customer,
                payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
              ]
          : isProcurementImport
            ? [
                getMissionTypeLabel("procurement"),
                procurementDetails.items.map((item) => `${item.quantity} × ${item.name}`).join(", "),
                procurementDetails.location,
                procurementDetails.customer,
                payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
              ]
          : isMiningImport
            ? [
                getMissionTypeLabel("mining"),
                miningDetails.searchArea,
                miningDetails.location,
                miningDetails.tool,
                payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
              ]
        : [
            t("contracts.import.summary", { count: routes.length, scu: formatScuAmount(totalScu) }),
            maxContainerScu ? t("contracts.meta.maxContainer", { value: `${maxContainerScu} SCU` }) : "",
            payout > 0 ? `${payout.toLocaleString(locale)} aUEC` : "",
          ]
      ).concat(
        correctionCount > 0
          ? t(correctionCount === 1 ? "contracts.import.locationMatch" : "contracts.import.locationMatches", { count: correctionCount })
          : "",
      ).filter(Boolean).join(" · ");
      return `
        <article class="mission-import-inbox-item${item.id === selectedMissionImportId ? " is-selected" : ""}" data-import-id="${escapeHtml(item.id || "")}">
          <div class="mission-import-inbox-copy">
            <strong>${escapeHtml(draft.title || t("contracts.import.liveUntitled"))}</strong>
            <span>${escapeHtml(t("contracts.import.liveMeta", { device: sourceLabel, time: timeLabel }))}</span>
            <small>${escapeHtml(importDetails)}</small>
          </div>
          <div class="mission-import-inbox-actions">
            <button class="secondary-button" type="button" data-import-action="preview">${escapeHtml(t("contracts.import.liveReview"))}</button>
            <button class="ghost-button icon-only-button tooltip-button" type="button" data-import-action="dismiss" aria-label="${escapeHtml(t("contracts.import.liveDismiss"))}" data-tooltip="${escapeHtml(t("contracts.import.liveDismiss"))}">
              <span class="button-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
                </svg>
              </span>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
  normalizeAppTooltipTitles(missionImportInboxList);
}

function previewMissionImportInboxItem(importId) {
  const item = missionImportInboxItems.find((candidate) => candidate.id === importId);
  if (!item?.draft) return;
  selectedMissionImportId = item.id;
  if (missionImportImageWrap) missionImportImageWrap.hidden = true;
  renderMissionImportPreview(item.draft);
  renderMissionImportInbox();
  const correctionCount = Array.isArray(item.locationCorrections) ? item.locationCorrections.length : 0;
  setMissionImportStatus(
    t("contracts.import.liveSelectedTitle"),
    correctionCount > 0
      ? t(correctionCount === 1 ? "contracts.import.liveSelectedMatch" : "contracts.import.liveSelectedMatches", { count: correctionCount })
      : t("contracts.import.liveSelectedMessage"),
    "success",
  );
}

async function updateMissionImportServerStatus(importId, status) {
  const { response, payload } = await soloRequestJson(getMissionImportsUrl(`/${encodeURIComponent(importId)}/status`), {
    method: "POST",
    headers: getMissionImportHeaders({ "Content-Type": "application/json", Accept: "application/json" }),
    body: JSON.stringify({ status }),
  });
  if (!response.ok || !payload.ok) throw new Error("import_status_failed");
  return payload;
}

async function dismissMissionImportInboxItem(importId) {
  try {
    await updateMissionImportServerStatus(importId, "dismissed");
    if (selectedMissionImportId === importId) {
      selectedMissionImportId = "";
      if (missionImportPreview) missionImportPreview.hidden = true;
      if (missionImportApply) missionImportApply.disabled = true;
    }
    await loadMissionImportInbox({ quiet: true });
  } catch (error) {
    setMissionImportStatus(t("contracts.import.liveActionFailedTitle"), t("contracts.import.liveActionFailedMessage"), "error");
  }
}

function setMissionImportStatus(title, message, severity = "neutral") {
  if (!missionImportStatus) return;
  missionImportStatus.className = `form-hint form-hint-${severity}`;
  missionImportStatus.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    ${message ? `<span>${escapeHtml(message)}</span>` : ""}
  `;
  missionImportStatus.hidden = false;
}

function setMissionImportBusy(busy) {
  missionImportBusy = Boolean(busy);
  missionImportDropzone?.classList.toggle("is-busy", missionImportBusy);
  if (missionImportClipboardButton) missionImportClipboardButton.disabled = missionImportBusy;
  if (missionImportFileInput) missionImportFileInput.disabled = missionImportBusy;
  if (missionImportApply) missionImportApply.disabled = missionImportBusy || !isMissionImportPreviewValid();
}

function showMissionImportImage(file) {
  if (!missionImportImage || !missionImportImageWrap) return;
  if (missionImportImageUrl) URL.revokeObjectURL(missionImportImageUrl);
  missionImportImageUrl = URL.createObjectURL(file);
  missionImportImage.src = missionImportImageUrl;
  missionImportImageWrap.hidden = false;
}

async function importMissionScreenshot(file, event, sound = null) {
  const operation = sound || window.soloImportSounds?.begin(event);
  if (missionImportSound !== operation) missionImportSound?.cancel();
  missionImportSound = operation;
  const requestId = ++missionImportRequestId;
  if (!file || !String(file.type || "").startsWith("image/")) {
    operation?.error();
    setMissionImportStatus(t("contracts.import.invalidTitle"), t("contracts.import.invalidMessage"), "error");
    return;
  }

  selectedMissionImportId = "";
  renderMissionImportInbox();
  showMissionImportImage(file);
  if (missionImportPreview) missionImportPreview.hidden = true;
  setMissionImportBusy(true);
  setMissionImportStatus(t("contracts.import.readingTitle"), t("contracts.import.readingMessage"), "neutral");

  try {
    operation?.processing();
    const response = await fetch(OCR_URL, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (requestId !== missionImportRequestId) return;

    if (!response.ok || !payload.ok) {
      throw new Error(payload.message || t("contracts.import.ocrUnavailableMessage"));
    }

    const parsed = parseMissionObjectiveText(payload.text || "");
    if (!parsed || parsed.routes.length === 0) {
      operation?.error();
      setMissionImportStatus(t("contracts.import.notRecognizedTitle"), t("contracts.import.notRecognizedMessage"), "warning");
      return;
    }

    renderMissionImportPreview(parsed);
    operation?.success();
    setMissionImportStatus(
      t("contracts.import.recognizedTitle"),
      t("contracts.import.recognizedMessage", { count: parsed.routes.length }),
      "success",
    );
  } catch (error) {
    if (requestId !== missionImportRequestId) return;
    operation?.error();
    const fallback = t("contracts.import.ocrUnavailableMessage");
    setMissionImportStatus(t("contracts.import.ocrUnavailableTitle"), error?.message || fallback, "error");
  } finally {
    if (requestId === missionImportRequestId) setMissionImportBusy(false);
  }
}

async function importMissionFromClipboard(event) {
  missionImportSound?.cancel();
  const sound = missionImportSound = window.soloImportSounds?.begin(event);
  if (!navigator.clipboard?.read) {
    sound?.error();
    setMissionImportStatus(t("contracts.import.clipboardEmptyTitle"), t("contracts.import.clipboardUnsupported"), "warning");
    return;
  }

  try {
    const items = await navigator.clipboard.read();
    const imageItem = items
      .flatMap((item) => item.types.map((type) => ({ item, type })))
      .find(({ type }) => type.startsWith("image/"));
    if (!imageItem) {
      sound?.error();
      setMissionImportStatus(t("contracts.import.clipboardEmptyTitle"), t("contracts.import.clipboardEmptyMessage"), "warning");
      return;
    }
    const image = await imageItem.item.getType(imageItem.type);
    if (missionImportSound !== sound || missionImportDialog?.hidden) return;
    await importMissionScreenshot(image, event, sound);
  } catch (error) {
    if (missionImportSound !== sound || missionImportDialog?.hidden) return;
    sound?.error();
    setMissionImportStatus(t("contracts.import.clipboardEmptyTitle"), t("contracts.import.clipboardDenied"), "warning");
  }
}

function renderMissionImportPreview(parsed) {
  if (!missionImportPreview || !missionImportConsignmentList) return;
  const payout = Math.round(Number(parsed?.payout) || 0);
  const normalizedConsignments = normalizeMissionImportConsignments(parsed);
  missionImportDraftMetadata = {
    payout: payout > 0 ? payout : null,
    maxContainerScu: normalizeMissionMaxContainerScu(parsed?.maxContainerScu),
  };
  missionImportOriginalDraft = {
    ...parsed,
    consignments: normalizedConsignments.map((consignment) => ({
      ...consignment,
      routes: (Array.isArray(consignment?.routes) ? consignment.routes : []).map((route) => ({ ...route })),
    })),
  };
  missionImportConsignmentList.innerHTML = "";
  normalizedConsignments.forEach((consignment) => addMissionImportConsignment(consignment));
  missionImportPreview.hidden = false;
  syncMissionImportPreview();
}

function normalizeMissionImportConsignments(parsed) {
  if (Array.isArray(parsed?.consignments) && parsed.consignments.length > 0) {
    return parsed.consignments;
  }
  const routes = Array.isArray(parsed?.routes) ? parsed.routes : [];
  return [
    {
      title: parsed?.title || "",
      pickup: parsed?.pickup || "",
      totalScu: routes.reduce((sum, route) => sum + (Number(route.targetScu) || 0), 0),
      routes,
    },
  ];
}

function buildMissionDuplicateCandidateFromImportDraft(draft) {
  const consignments = Array.isArray(draft?.consignments) ? draft.consignments : [];
  const segments = consignments.flatMap((consignment, cargoIndex) => (
    (Array.isArray(consignment?.routes) ? consignment.routes : []).map((route, routeIndex) => ({
      id: `import-preview-${cargoIndex}-${routeIndex}`,
      title: String(consignment?.title || draft?.title || "").trim(),
      pickup: String(route?.pickup || consignment?.pickup || "").trim(),
      dropoff: String(route?.dropoff || "").trim(),
      routeTargetScu: Number(route?.targetScu) || 0,
      totalScu: Number(route?.targetScu) || 0,
      cargoIndex,
      cargoRouteIndex: routeIndex,
    }))
  ));
  return {
    id: "",
    type: "cargo",
    title: String(draft?.title || consignments.map((entry) => entry?.title).filter(Boolean).join(" + ")).trim(),
    payout: Number(draft?.payout) || null,
    pickup: segments[0]?.pickup || "",
    dropoff: segments.length === 1 ? segments[0]?.dropoff || "" : "",
    serviceDetails: {},
    segments,
    createdAt: new Date().toISOString(),
    status: "active",
  };
}

function isOlderDuplicateCandidate(existing, mission) {
  const existingTimestamp = new Date(existing?.createdAt || 0).getTime();
  const missionTimestamp = new Date(mission?.createdAt || 0).getTime();
  if (Number.isFinite(existingTimestamp) && Number.isFinite(missionTimestamp) && existingTimestamp !== missionTimestamp) {
    return existingTimestamp < missionTimestamp;
  }
  const existingIndex = state.missions.indexOf(existing);
  const missionIndex = state.missions.indexOf(mission);
  return existingIndex >= 0 && missionIndex >= 0 && existingIndex > missionIndex;
}

function findMissionDuplicateMatches(mission, { olderOnly = false, limit = 3 } = {}) {
  const detector = window.MissionDuplicateDetector;
  if (!detector?.findPotentialDuplicates || !mission) return [];
  const candidates = state.missions.filter((entry) => (
    entry !== mission
    && String(entry?.id || "") !== String(mission?.id || "")
    && (!olderOnly || isOlderDuplicateCandidate(entry, mission))
  ));
  return detector.findPotentialDuplicates(mission, candidates, { limit });
}

function missionDuplicateReasonLabels(match) {
  return (Array.isArray(match?.reasons) ? match.reasons : [])
    .map((reason) => t(`contracts.duplicate.reason.${reason}`))
    .filter(Boolean);
}

function formatMissionDuplicateWarning(match) {
  if (!match) return "";
  const reasons = missionDuplicateReasonLabels(match);
  const summary = t("contracts.duplicate.match", {
    title: match.title,
    score: match.score,
  });
  return reasons.length > 0
    ? `${summary} ${t("contracts.duplicate.reasons", { reasons: reasons.join(", ") })}`
    : summary;
}

function getMissionDuplicateWarning(mission) {
  if (!mission?.sourceImportId) return { matches: [], text: "" };
  const matches = findMissionDuplicateMatches(mission, { olderOnly: true });
  return {
    matches,
    text: matches.length > 0 ? formatMissionDuplicateWarning(matches[0]) : "",
  };
}

function renderMissionImportDuplicateWarning(draft) {
  if (!missionImportDuplicateWarning) return;
  const candidate = buildMissionDuplicateCandidateFromImportDraft(draft);
  const detector = window.MissionDuplicateDetector;
  const matches = detector?.findPotentialDuplicates
    ? detector.findPotentialDuplicates(candidate, state.missions, { limit: 3 })
    : [];
  if (matches.length === 0) {
    missionImportDuplicateWarning.hidden = true;
    missionImportDuplicateWarning.innerHTML = "";
    return;
  }
  const primaryMatch = matches[0];
  const additionalText = matches.length > 1
    ? ` ${t("contracts.import.duplicateAdditional", { count: matches.length - 1 })}`
    : "";
  missionImportDuplicateWarning.innerHTML = `
    <strong>${escapeHtml(t("contracts.import.duplicateTitle"))}</strong>
    <span>${escapeHtml(`${formatMissionDuplicateWarning(primaryMatch)}${additionalText} ${t("contracts.import.duplicateAllowed")}`)}</span>
  `;
  missionImportDuplicateWarning.hidden = false;
}

function addMissionImportConsignment(consignment = {}) {
  if (!missionImportConsignmentList) return null;
  const item = document.createElement("article");
  item.className = "mission-import-consignment";
  item.innerHTML = `
    <div class="mission-import-consignment-head">
      <label>
        ${escapeHtml(t("contracts.quick.cargo"))}
        <input type="text" data-field="importCargo" />
      </label>
      <label>
        ${escapeHtml(t("contracts.import.totalScu"))}
        <input type="number" data-field="importTotalScu" min="1" step="1" />
      </label>
    </div>
    <div class="quick-destination-head">
      <span class="consignment-section-label">${escapeHtml(t("contracts.quick.routesAndAmounts"))}</span>
      <button class="secondary-button mission-import-route-add" type="button">${escapeHtml(t("contracts.quick.addTarget"))}</button>
    </div>
    <div class="mission-import-route-list"></div>
    <div class="form-hint mission-import-consignment-hint"></div>
  `;
  item.querySelector('[data-field="importCargo"]').value = consignment.title || "";
  item.querySelector('[data-field="importTotalScu"]').value = consignment.totalScu ? String(consignment.totalScu) : "";
  missionImportConsignmentList.appendChild(item);
  const routes = Array.isArray(consignment.routes) ? consignment.routes : [];
  routes.forEach((route) => addMissionImportRouteRow(item, route, consignment.pickup || ""));
  if (routes.length === 0) addMissionImportRouteRow(item, {}, consignment.pickup || "");
  return item;
}

function addMissionImportRouteRow(consignmentItem, route = {}, defaultPickup = "") {
  const routeList = consignmentItem?.querySelector(".mission-import-route-list");
  if (!routeList) return null;
  const row = document.createElement("div");
  row.className = "mission-import-route-row";
  row.innerHTML = `
    <label>
      ${escapeHtml(t("contracts.consignments.pickup"))}
      <input type="text" data-field="importPickup" list="locationSuggestions" />
    </label>
    <label>
      ${escapeHtml(t("contracts.quick.target"))}
      <input type="text" data-field="importDropoff" list="locationSuggestions" />
    </label>
    <label>
      SCU
      <input type="number" data-field="importScu" min="1" step="1" />
    </label>
    <button type="button" class="ghost-button mission-import-route-remove icon-only-button tooltip-button" aria-label="${escapeHtml(t("contracts.quick.removeTarget"))}" data-tooltip="${escapeHtml(t("contracts.quick.removeTarget"))}">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
        </svg>
      </span>
    </button>
  `;
  row.querySelector('[data-field="importPickup"]').value = route.pickup || defaultPickup || "";
  row.querySelector('[data-field="importDropoff"]').value = route.dropoff || "";
  row.querySelector('[data-field="importScu"]').value = route.targetScu ? String(route.targetScu) : "";
  routeList.appendChild(row);
  enhanceLocationPickerInputs(row);
  normalizeAppTooltipTitles(row);
  refreshMissionImportRouteActions(consignmentItem);
  return row;
}

function readMissionImportPreview() {
  const consignments = Array.from(missionImportConsignmentList?.children || []).map((item) => ({
    title: String(item.querySelector('[data-field="importCargo"]')?.value || "").trim(),
    totalScu: Number(String(item.querySelector('[data-field="importTotalScu"]')?.value || "").replace(",", ".")) || 0,
    routes: Array.from(item.querySelectorAll(".mission-import-route-row")).map((row) => ({
      pickup: String(row.querySelector('[data-field="importPickup"]')?.value || "").trim(),
      dropoff: String(row.querySelector('[data-field="importDropoff"]')?.value || "").trim(),
      targetScu: Number(String(row.querySelector('[data-field="importScu"]')?.value || "").replace(",", ".")) || 0,
    })),
  }));
  return {
    title: consignments.map((item) => item.title).filter(Boolean).join(" + "),
    consignments,
    ...missionImportDraftMetadata,
  };
}

function isMissionImportPreviewValid() {
  const draft = readMissionImportPreview();
  return Boolean(draft.consignments.length > 0 && draft.consignments.every(isMissionImportConsignmentValid));
}

function isMissionImportConsignmentValid(consignment) {
  const allocatedScu = consignment.routes.reduce((sum, route) => sum + route.targetScu, 0);
  return Boolean(
    consignment.title &&
      Number.isInteger(consignment.totalScu) &&
      consignment.totalScu > 0 &&
      allocatedScu <= consignment.totalScu &&
      consignment.routes.length > 0 &&
      consignment.routes.every(
        (route) => route.pickup && route.dropoff && Number.isInteger(route.targetScu) && route.targetScu >= 0,
      ),
  );
}

function syncMissionImportPreview() {
  const draft = readMissionImportPreview();
  const allRoutes = draft.consignments.flatMap((consignment) => consignment.routes);
  const totalScu = draft.consignments.reduce((sum, consignment) => sum + consignment.totalScu, 0);
  Array.from(missionImportConsignmentList?.children || []).forEach((item, index) => {
    const consignment = draft.consignments[index];
    const hint = item.querySelector(".mission-import-consignment-hint");
    const allocatedScu = consignment.routes.reduce((sum, route) => sum + route.targetScu, 0);
    const remainingScu = consignment.totalScu - allocatedScu;
    const allocationClass = remainingScu === 0 ? "form-hint-success" : remainingScu > 0 ? "form-hint-warning" : "form-hint-error";
    hint.className = `form-hint mission-import-consignment-hint ${allocationClass}`;
    hint.innerHTML = remainingScu === 0
      ? `<strong>${escapeHtml(t("contracts.import.allocationComplete"))}</strong>`
      : remainingScu > 0
        ? `<strong>${escapeHtml(t("contracts.import.allocationOpen", { value: formatScuAmount(remainingScu) }))}</strong>`
        : `<strong>${escapeHtml(t("contracts.import.allocationExceeded", { value: formatScuAmount(Math.abs(remainingScu)) }))}</strong>`;
    refreshMissionImportRouteActions(item);
  });
  if (missionImportPreviewSummary) {
    const summary = [t("contracts.import.summary", {
      count: allRoutes.length,
      scu: formatScuAmount(totalScu),
    })];
    if (draft.maxContainerScu) {
      summary.push(t("contracts.meta.maxContainer", { value: `${draft.maxContainerScu} SCU` }));
    }
    if (draft.payout) {
      summary.push(`${draft.payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC`);
    }
    missionImportPreviewSummary.textContent = summary.join(" · ");
  }
  renderMissionImportDuplicateWarning(draft);
  if (missionImportApply) missionImportApply.disabled = missionImportBusy || !isMissionImportPreviewValid();
}

function refreshMissionImportRouteActions(consignmentItem) {
  const rows = Array.from(consignmentItem?.querySelectorAll(".mission-import-route-row") || []);
  rows.forEach((row) => {
    const removeButton = row.querySelector(".mission-import-route-remove");
    if (removeButton) removeButton.disabled = rows.length <= 1;
  });
}

async function applyMissionImportPreview() {
  if (!isMissionImportPreviewValid()) {
    setMissionImportStatus(t("contracts.import.incompleteTitle"), t("contracts.import.incompleteMessage"), "warning");
    return;
  }

  const draft = readMissionImportPreview();
  if (missionImportOriginalDraft) {
    void locationAliasLearningController.queueMissionCorrection(
      buildMissionDuplicateCandidateFromImportDraft(missionImportOriginalDraft),
      buildMissionDuplicateCandidateFromImportDraft(draft),
      { force: true },
    );
  }
  if (selectedMissionImportId) {
    setMissionImportBusy(true);
    try {
      await updateMissionImportServerStatus(selectedMissionImportId, "imported");
    } catch (error) {
      setMissionImportBusy(false);
      setMissionImportStatus(t("contracts.import.liveActionFailedTitle"), t("contracts.import.liveActionFailedMessage"), "error");
      return;
    }
  }
  missionTypeSelect.value = "cargo";
  syncMissionTypeFields();
  if (missionForm?.elements?.maxContainerScu) {
    missionForm.elements.maxContainerScu.value = draft.maxContainerScu ? String(draft.maxContainerScu) : "";
  }
  const firstEmptyConsignment =
    consignmentList.children.length === 1 &&
    !readConsignmentDraft(consignmentList.firstElementChild).title &&
    readConsignmentDraft(consignmentList.firstElementChild).routes.every((route) => !route.pickup && !route.dropoff);
  if (firstEmptyConsignment) consignmentList.innerHTML = "";
  draft.consignments.forEach((consignment) => {
    addConsignmentRow({
      title: consignment.title,
      expectedTotalScu: consignment.totalScu,
      routes: consignment.routes.map((route) => {
        const groups = buildContainerGroupsForScu(route.targetScu, draft.maxContainerScu);
        return {
          ...route,
          groups,
        };
      }),
    });
  });
  if (missionForm?.elements?.title && !missionForm.elements.title.value.trim()) {
    missionForm.elements.title.value = draft.title;
  }
  if (missionForm?.elements?.payout && draft.payout) {
    missionForm.elements.payout.value = String(draft.payout);
  }
  setCollapsibleExpanded("consignmentBuilderBody", true);
  updateDimensionHint();
  closeMissionImportDialog();
}

function setQuickMissionStatus(title, message) {
  if (!quickMissionHint) return;
  quickMissionHint.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(message)}</span>
  `;
}

function parseMissionObjectiveText(text) {
  const normalizedText = String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[◇◆◈]/g, "\n")
    .replace(/[ \t]+/g, " ");
  const events = [];
  const collectPattern = /Collect\s+(.+?)\s+from\s+(.+?)(?:\.|\n|$)/gi;
  const deliverPattern = /Deliver\s+(?:0\s*\/\s*)?(\d+(?:[.,]\d+)?)\s*SCU(?:\s+of\s+(.+?))?\s+to\s+(.+?)(?:\.|\n|$)/gi;

  for (const match of normalizedText.matchAll(collectPattern)) {
    events.push({
      type: "collect",
      index: match.index ?? 0,
      cargo: cleanObjectiveText(match[1]),
      pickup: cleanObjectiveText(match[2]),
    });
  }

  for (const match of normalizedText.matchAll(deliverPattern)) {
    events.push({
      type: "deliver",
      index: match.index ?? 0,
      targetScu: Number(String(match[1]).replace(",", ".")) || 0,
      cargo: cleanObjectiveText(match[2] || ""),
      dropoff: cleanObjectiveText(match[3]),
    });
  }

  events.sort((left, right) => left.index - right.index);

  let activeCargo = "";
  let activePickup = "";
  const cargoNames = [];
  const routes = [];

  events.forEach((event) => {
    if (event.type === "collect") {
      activeCargo = event.cargo || activeCargo;
      activePickup = event.pickup || activePickup;
      if (activeCargo && !cargoNames.includes(activeCargo)) {
        cargoNames.push(activeCargo);
      }
      return;
    }

    const cargo = event.cargo || activeCargo;
    if (cargo && !cargoNames.includes(cargo)) {
      cargoNames.push(cargo);
    }
    routes.push({
      pickup: activePickup,
      dropoff: event.dropoff,
      targetScu: event.targetScu,
    });
  });

  return {
    title: cargoNames.length === 1 ? cargoNames[0] : cargoNames.length > 1 ? "Gemischte Fracht" : "",
    pickup: routes.length > 0 && routes.every((route) => route.pickup === routes[0].pickup) ? routes[0].pickup : "",
    routes,
  };
}

function cleanObjectiveText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-–•\s]+/, "")
    .trim();
}

function fillQuickMissionCapture(parsed) {
  if (quickCargoTitle) quickCargoTitle.value = parsed.title || "";
  if (quickPickup) quickPickup.value = parsed.pickup || "";
  if (quickDestinationList) {
    quickDestinationList.innerHTML = "";
  }
  parsed.routes.forEach((route) => addQuickDestinationRow(route));
  ensureQuickMissionRows();
  syncQuickMissionHint();
}
