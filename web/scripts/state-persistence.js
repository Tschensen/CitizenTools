// App mode, local persistence, server synchronization, and state migrations.
function normalizeAppMode(value) {
  const normalized = String(value || "solo").trim().toLowerCase();
  return APP_MODES.includes(normalized) ? normalized : "solo";
}

function loadAppMode() {
  return normalizeAppMode(localStorage.getItem(APP_MODE_STORAGE_KEY));
}

function getStateStorageKey(mode = activeAppMode) {
  const normalizedMode = normalizeAppMode(mode);
  return normalizedMode === "solo" ? STORAGE_KEY : `${STORAGE_KEY}:${normalizedMode}`;
}

function hasStoredState(mode = activeAppMode) {
  return Boolean(localStorage.getItem(getStateStorageKey(mode)));
}

function getRemoteStateUrl(mode = activeAppMode) {
  const normalizedMode = normalizeAppMode(mode);
  return `${REMOTE_STATE_URL}?scope=${encodeURIComponent(normalizedMode)}`;
}

function getDispatcherRequestHeaders(mode, headers = {}) {
  return window.DispatcherAuth?.getHeaders(mode, headers) || { ...headers };
}

function createRemoteStatusState() {
  return {
    connected: false,
    stateUpdatedAt: null,
    lastBackupAt: null,
    lastRestoreAt: null,
  };
}

function isRemoteScopeCompatible(payload, mode = activeAppMode) {
  const normalizedMode = normalizeAppMode(mode);
  if (normalizedMode === "solo") {
    return !payload?.scope || payload.scope === "solo";
  }
  return payload?.scope === normalizedMode;
}

function persist() {
  syncRunRouteProgress();
  localStorage.setItem(getStateStorageKey(), JSON.stringify(state));
  scheduleRemotePersist();
}

function loadState(mode = activeAppMode) {
  const raw = localStorage.getItem(getStateStorageKey(mode));
  if (!raw) {
    return sanitizeState(cloneData(defaultState), { mode });
  }

  try {
    return sanitizeState(JSON.parse(raw), { mode });
  } catch (error) {
    return sanitizeState(cloneData(defaultState), { mode });
  }
}

async function initializeRemotePersistence(mode = activeAppMode, { preserveEditing = false } = {}) {
  const hydrationMode = normalizeAppMode(mode);
  if (!canUseRemotePersistence()) {
    if (hydrationMode === activeAppMode) {
      remoteHydrationComplete = true;
      remoteStatus.connected = false;
      renderRemoteStatus();
    }
    return;
  }

  try {
    const payload = await fetchRemoteState(hydrationMode);
    if (hydrationMode !== activeAppMode) {
      return;
    }
    if (!payload) {
      remoteHydrationComplete = true;
      remoteStatus.connected = false;
      renderRemoteStatus();
      return;
    }

    if (!isRemoteScopeCompatible(payload, hydrationMode)) {
      remoteStatus.connected = false;
      renderRemoteStatus();
      return;
    }

    if (preserveEditing && (soloEditing() || soloPending)) return;
    soloRevision = payload.updatedAt;
    soloHydrated = true;
    applyRemoteMeta(payload);

    if (payload?.state) {
      applySoloState(payload);
    } else {
      soloBaseState = null;
      if (typeof soloHasPersonalState === 'function' ? soloHasPersonalState(state) : hasMeaningfulState(state)) await saveRemoteState(cloneData(state), hydrationMode);
      else soloBaseState = soloCleanState(state);
    }
  } catch (error) {
    // Keep localStorage as offline fallback when the local API is unavailable.
    if (hydrationMode === activeAppMode) {
      remoteStatus.connected = false;
      renderRemoteStatus();
    }
  } finally {
    if (hydrationMode === activeAppMode) {
      remoteHydrationComplete = true;
    }
  }
  if (hydrationMode === activeAppMode) {
    await autoImportPendingMissions(hydrationMode);
  }
}

async function fetchRemoteState(mode = activeAppMode) {
  const response = await fetch(getRemoteStateUrl(mode), {
    headers: getDispatcherRequestHeaders(mode, {
      Accept: "application/json",
    }),
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

function canUseRemotePersistence() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

function hasMeaningfulState(candidateState) {
  if (!candidateState) return false;
  if (candidateState.missions?.length) return true;
  if (candidateState.fleet?.length) return true;
  if (candidateState.pilots?.some((pilot) => pilot.id !== SOLO_PILOT_ID || pilot.name !== SOLO_PILOT_DEFAULT_NAME)) return true;
  if (candidateState.ledgerEntries?.length) return true;
  if (candidateState.shipLibrary?.length) return true;
  if (candidateState.layout?.presetId && candidateState.layout.presetId !== "custom") return true;
  return (
    candidateState.layout?.rows !== defaultState.layout.rows ||
    candidateState.layout?.cols !== defaultState.layout.cols ||
    candidateState.layout?.defaultHeight !== defaultState.layout.defaultHeight
  );
}

function scheduleRemotePersist() {
  if (!remoteHydrationComplete || !canUseRemotePersistence()) {
    return;
  }

  if (remoteSaveTimer) {
    window.clearTimeout(remoteSaveTimer);
  }

  const snapshot = cloneData(state);
  const snapshotMode = activeAppMode;
  remoteSaveTimer = window.setTimeout(() => {
    remoteSaveTimer = null;
    void saveRemoteState(snapshot, snapshotMode);
  }, 250);
}

async function saveRemoteState(snapshot, mode = activeAppMode) {
  const saveMode = normalizeAppMode(mode);
  try {
    const response = await fetch(getRemoteStateUrl(saveMode), {
      method: "POST",
      headers: getDispatcherRequestHeaders(saveMode, {
        "Content-Type": "application/json",
        Accept: "application/json",
      }),
      body: JSON.stringify({ state: snapshot }),
    });
    if (!response.ok) {
      throw new Error("remote_save_failed");
    }
    const payload = await response.json();
    if (!isRemoteScopeCompatible(payload, saveMode)) {
      throw new Error("remote_scope_mismatch");
    }
    if (saveMode !== activeAppMode) {
      return true;
    }
    remoteStatus.connected = true;
    remoteStatus.stateUpdatedAt = payload.updatedAt || new Date().toISOString();
    renderRemoteStatus();
    return true;
  } catch (error) {
    // Local browser cache remains the fallback if the shared server is offline.
    if (saveMode === activeAppMode) {
      remoteStatus.connected = false;
      renderRemoteStatus();
    }
    return false;
  }
}

function applyRemoteMeta(payload) {
  remoteStatus.connected = true;
  remoteStatus.stateUpdatedAt = payload?.updatedAt || null;
  remoteStatus.lastBackupAt = payload?.meta?.lastBackupAt || null;
  remoteStatus.lastRestoreAt = payload?.meta?.lastRestoreAt || null;
  renderRemoteStatus();
}

function renderRemoteStatus() {
  window.soloConnection?.render();
  if (!serverStatusCard || !serverStatusLabel || !serverStatusMeta) {
    return;
  }

  const usesHttp = canUseRemotePersistence();
  const connection = window.soloConnection?.phase;
  const mode = !usesHttp ? "local-only"
    : connection === "offline" || connection === "checking" ? connection
    : remoteStatus.connected ? "connected" : "http-no-sync";
  const backupFreshness = BackupUi.calculateBackupFreshness(
    remoteStatus.lastBackupAt,
    state.backupReminderDays,
  );

  serverStatusCard.classList.toggle("is-connected", mode === "connected");
  serverStatusCard.classList.toggle("is-warning", ["http-no-sync", "offline", "checking"].includes(mode));
  serverStatusCard.classList.toggle("is-offline", mode === "offline");
  serverStatusCard.classList.toggle("is-local", mode === "local-only");
  serverStatusCard.classList.toggle("is-backup-due", mode === "connected" && backupFreshness.due);
  if (serverStatusDot) {
    serverStatusDot.setAttribute("aria-hidden", "true");
  }

  if (mode === "local-only") {
    if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t("server.link.local");
    serverStatusLabel.textContent = t("server.local.title");
    serverStatusMeta.textContent = t("server.local.meta");
    serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
    return;
  }

  if (mode === "offline" || mode === "checking") {
    if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t(mode === "offline" ? "server.link.warning" : "server.link.checking");
    serverStatusLabel.textContent = t(`server.${mode}.title`);
    serverStatusMeta.textContent = t(`server.${mode}.meta`);
    serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
    return;
  }

  if (mode === "http-no-sync") {
    if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t("server.link.syncPending");
    serverStatusLabel.textContent = t("server.warning.title");
    serverStatusMeta.textContent = t("server.warning.meta");
    serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
    return;
  }

  if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t("server.link.connected");
  serverStatusLabel.textContent = t("server.connected.title");
  const parts = [];
  if (remoteStatus.stateUpdatedAt) {
    parts.push(t("server.connected.synced", { value: formatDateTimeDisplay(remoteStatus.stateUpdatedAt) }));
  }
  if (remoteStatus.lastBackupAt) {
    parts.push(t("server.connected.backup", { value: formatDateTimeDisplay(remoteStatus.lastBackupAt) }));
  }
  if (remoteStatus.lastRestoreAt) {
    parts.push(t("server.connected.restore", { value: formatDateTimeDisplay(remoteStatus.lastRestoreAt) }));
  }
  if (backupFreshness.due) {
    parts.push(backupFreshness.state === "missing"
      ? t("server.connected.backupMissing")
      : t("server.connected.backupDue", { days: backupFreshness.ageDays }));
  }
  serverStatusMeta.textContent = parts.join(" · ") || t("server.connected.meta");
  serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
}

function sanitizeState(input, { mode = activeAppMode } = {}) {
  const normalizedMode = normalizeAppMode(mode);
  const seededShipLibrary = getDefaultShipLibraryEntries();
  const rawShipLibrary = Array.isArray(input?.shipLibrary) && input.shipLibrary.length > 0 ? input.shipLibrary : seededShipLibrary;
  const legacyRefuelContainerSizeByShipId = new Map(
    rawShipLibrary
      .filter((entry) => entry?.id && normalizePositiveDecimal(entry.refuelContainerSizeScu) > 0)
      .map((entry) => [entry.id, entry.refuelContainerSizeScu]),
  );
  const parsedShipLibrary = rawShipLibrary
    .map((entry) => ({
      ...entry,
      ...createShipLibraryEntry({
        id: entry.id || createRuntimeId(),
        manufacturer: entry.manufacturer,
        model: entry.model,
        variant: entry.variant,
        imageUrl: entry.imageUrl,
        shipClass: entry.shipClass,
        cargoScu: entry.cargoScu,
        maxContainerSizeKey: entry.maxContainerSizeKey,
        priceAuec: entry.priceAuec,
        hydrogenFuel: entry.hydrogenFuel,
        quantumFuel: entry.quantumFuel,
        refuelContainerCount: entry.refuelContainerCount,
        hangarSize: entry.hangarSize,
        presetId: entry.presetId,
        notes: entry.notes,
        gridRows: entry.gridRows,
        gridCols: entry.gridCols,
        gridLevels: entry.gridLevels,
        gridHeights: entry.gridHeights,
        overloadGridHeights: entry.overloadGridHeights,
        gridBlockedSlots: entry.gridBlockedSlots,
        gridHeightOverrides: entry.gridHeightOverrides,
        createdAt: entry.createdAt,
      }),
    }))
    .filter((entry) => entry.manufacturer && entry.model);

  const shipLibrary = [
    ...parsedShipLibrary,
    ...seededShipLibrary.filter(
      (seedEntry) => !parsedShipLibrary.some((entry) => entry.id === seedEntry.id || (entry.presetId && entry.presetId === seedEntry.presetId)),
    ),
  ];

  const shipLibraryByPresetId = new Map(
    shipLibrary
      .filter((entry) => entry.presetId)
      .map((entry) => [entry.presetId, entry]),
  );

  const rawFleetEntries = Array.isArray(input?.fleet) ? input.fleet : [];
  const rawMissionEntries = Array.isArray(input?.missions) ? input.missions : [];
  const pilots = [];
  const pilotsById = new Map();
  const pilotsByName = new Map();
  const registerPilot = (name, { id = "", role = "", createdAt = "" } = {}) => {
    const normalizedName = normalizePilotName(name);
    if (!normalizedName) return null;
    const normalizedId = String(id || "").trim();
    const identityKey = getPilotIdentityKey(normalizedName);
    const existing = (normalizedId ? pilotsById.get(normalizedId) : null) || pilotsByName.get(identityKey) || null;
    if (existing) {
      if (normalizedId && !pilotsById.has(normalizedId)) pilotsById.set(normalizedId, existing);
      if (role) existing.role = "pilot";
      return existing;
    }
    const pilot = createPilotProfile({
      id: normalizedId || createRuntimeId(),
      name: normalizedName,
      role: "pilot",
      createdAt,
    });
    pilots.push(pilot);
    pilotsById.set(pilot.id, pilot);
    pilotsByName.set(identityKey, pilot);
    return pilot;
  };

  (Array.isArray(input?.pilots) ? input.pilots : []).forEach((pilot) => {
    registerPilot(pilot?.name, { id: pilot?.id, role: pilot?.role, createdAt: pilot?.createdAt });
  });
  rawFleetEntries.forEach((entry) => {
    registerPilot(entry?.pilotName, { id: entry?.pilotId, createdAt: entry?.createdAt });
  });
  rawMissionEntries.forEach((mission) => {
    registerPilot(mission?.assignedPilotName, { id: mission?.assignedPilotId, createdAt: mission?.createdAt });
    (Array.isArray(mission?.participants) ? mission.participants : []).forEach((participant) => {
      registerPilot(participant?.pilotName, { id: participant?.pilotId, createdAt: mission?.createdAt });
    });
  });

  let soloPilotId = String(input?.soloPilotId || "").trim();
  if (normalizedMode === "solo") {
    let soloPilot = pilotsById.get(soloPilotId) || null;
    if (!soloPilot) {
      soloPilot = registerPilot(input?.soloPilotName || SOLO_PILOT_DEFAULT_NAME, { id: SOLO_PILOT_ID });
    }
    soloPilotId = soloPilot?.id || SOLO_PILOT_ID;
  } else if (!pilotsById.has(soloPilotId)) {
    soloPilotId = "";
  }

  const resolvePilotId = (pilotId, pilotName, fallbackPilotId = "") => {
    const normalizedPilotId = String(pilotId || "").trim();
    if (pilotsById.has(normalizedPilotId)) return pilotsById.get(normalizedPilotId).id;
    const pilotByName = pilotsByName.get(getPilotIdentityKey(pilotName));
    if (pilotByName) return pilotByName.id;
    return pilotsById.get(fallbackPilotId)?.id || "";
  };
  const rawFleetById = new Map(rawFleetEntries.filter((entry) => entry?.id).map((entry) => [String(entry.id), entry]));

  const missions = rawMissionEntries.length > 0
    ? rawMissionEntries.map((mission) => {
        const sourceLoads = Array.isArray(mission.loads)
          ? mission.loads
          : Array.isArray(mission.containers)
            ? mission.containers
            : [];

        const segments = Array.isArray(mission.segments) && mission.segments.length > 0
          ? mission.segments.map((segment, index) => {
              const quantityPending = Boolean(segment.quantityPending);
              const isHandheld = Boolean(segment.isHandheld) || segment.containerSize === "hand";
              const width = quantityPending || isHandheld ? 0 : clamp(Number(segment.width) || 1, 1, 8);
              const depth = quantityPending || isHandheld ? 0 : clamp(Number(segment.depth) || 1, 1, 8);
              const height = quantityPending || isHandheld ? 0 : clamp(Number(segment.height) || 1, 1, 8);
              const quantity = quantityPending ? 0 : clamp(Number(segment.quantity) || 1, 1, 64);
              const scuPerLoad = quantityPending ? 0 : isHandheld ? 0.125 : width * depth * height;
              return {
                id: segment.id || createRuntimeId(),
                title: String(segment.title || (mission.segments.length === 1 ? "Fracht" : `Teilfracht ${index + 1}`)),
                pickup: String(segment.pickup || mission.pickup || ""),
                dropoff: String(segment.dropoff || mission.dropoff || ""),
                quantity,
                containerSize: quantityPending ? "" : isHandheld ? "hand" : String(segment.containerSize || getCargoContainerProfileByDimensions(width, depth, height)?.key || ""),
                width,
                depth,
                height,
                isHandheld,
                isPlaceable: !quantityPending && !isHandheld,
                scuPerLoad,
                totalScu: scuPerLoad * quantity,
                routeTargetScu: Number.isFinite(Number(segment.routeTargetScu)) ? Number(segment.routeTargetScu) : 0,
                expectedCargoScu: Number.isFinite(Number(segment.expectedCargoScu)) ? Number(segment.expectedCargoScu) : 0,
                quantityPending,
                cargoIndex: Number.isInteger(segment.cargoIndex) ? segment.cargoIndex : 0,
                cargoRouteIndex: Number.isInteger(segment.cargoRouteIndex) ? segment.cargoRouteIndex : 0,
                cargoGroupIndex: Number.isInteger(segment.cargoGroupIndex) ? segment.cargoGroupIndex : index,
                order: Number.isInteger(segment.order) ? segment.order : index,
              };
            })
          : [];

        const loads = sourceLoads.map((entry, index) => {
          const legacyDimensions =
            entry.width && entry.depth && entry.height
              ? { width: entry.width, depth: entry.depth, height: entry.height }
              : deriveDimensionsFromScu(entry.scu || 1);

          const placement =
            sanitizePlacement(entry.placement) ??
            sanitizeLegacySlot(entry.slotId, Boolean(entry.rotated), legacyDimensions);
          if (placement && !placement.fleetEntryId) {
            const placementFleetEntryId = String(
              entry.placement?.fleetEntryId ||
              entry.placementFleetEntryId ||
              mission.assignedFleetEntryId ||
              input?.layout?.fleetEntryId ||
              "",
            ).trim();
            if (placementFleetEntryId) {
              placement.fleetEntryId = placementFleetEntryId;
            }
          }

          return createLoad({
            id: entry.id || createRuntimeId(),
            label: String(entry.label || `${mission.title || "Ladung"} #${index + 1}`),
            width: legacyDimensions.width,
            depth: legacyDimensions.depth,
            height: legacyDimensions.height,
            rotated: Boolean(entry.rotated),
            placement,
            pickup: String(entry.pickup || mission.pickup || ""),
            dropoff: String(entry.dropoff || mission.dropoff || ""),
            cargoTitle: String(entry.cargoTitle || entry.label || mission.title || "Ladung"),
            segmentId: entry.segmentId || null,
            loadedByFleetEntryId: entry.loadedByFleetEntryId || entry.placement?.fleetEntryId || "",
            loadedAt: entry.loadedAt || null,
            deliveredByFleetEntryId: entry.deliveredByFleetEntryId || "",
            deliveredAt: entry.deliveredAt || null,
          });
        });

        const normalizedSegments = segments.length > 0
          ? segments
          : (() => {
              if (loads.length === 0) return [];
              const grouped = new Map();
              loads.forEach((load, index) => {
                const key = `${load.pickup}|${load.dropoff}|${load.width}|${load.depth}|${load.height}|${load.cargoTitle}`;
                if (!grouped.has(key)) {
                  grouped.set(key, {
                    id: load.segmentId || createRuntimeId(),
                    title: load.cargoTitle || load.label || (loads.length === 1 ? "Fracht" : `Teilfracht ${index + 1}`),
                    pickup: load.pickup || mission.pickup || "",
                    dropoff: load.dropoff || mission.dropoff || "",
                    quantity: 0,
                    containerSize: getCargoContainerProfileByDimensions(load.width, load.depth, load.height)?.key || "",
                    width: load.width,
                    depth: load.depth,
                    height: load.height,
                    isHandheld: false,
                    isPlaceable: true,
                    scuPerLoad: load.scu,
                    totalScu: 0,
                    order: grouped.size,
                  });
                }
                const segment = grouped.get(key);
                segment.quantity += 1;
                segment.totalScu += load.scu;
                if (!load.segmentId) {
                  load.segmentId = segment.id;
                }
              });
              return [...grouped.values()];
            })();
        const missionType = normalizeMissionType(mission.type);
        const serviceDetails = getMissionServiceDetails({ serviceDetails: mission.serviceDetails });
        if (missionType === "courier" || missionType === "delivery") {
          serviceDetails.packages = serviceDetails.packages.map((item) => ({
            ...item,
            id: item.id || createRuntimeId(),
            cargoSegmentId: missionType === "delivery" && Number(item.containerScu) > 0
              ? item.cargoSegmentId
                || normalizedSegments.find((segment) => (
                  segment.title === item.name
                  && segment.pickup === item.pickup
                  && segment.dropoff === item.destination
                ))?.id
                || createRuntimeId()
              : "",
          }));
          serviceDetails.location = serviceDetails.location || serviceDetails.packages[0]?.destination || "";
        }
        const missionUsesCargoGrid = missionType === "cargo" || (missionType === "delivery" && normalizedSegments.length > 0);
        const assignedFleetEntryId = String(mission.assignedFleetEntryId || "").trim();
        const rawAssignedFleetEntry = rawFleetById.get(assignedFleetEntryId) || null;
        const fleetPilotId = resolvePilotId(rawAssignedFleetEntry?.pilotId, rawAssignedFleetEntry?.pilotName);
        const assignedPilotId = resolvePilotId(
          mission.assignedPilotId,
          mission.assignedPilotName,
          fleetPilotId || (normalizedMode === "solo" ? soloPilotId : ""),
        );
        const assignedPilotName = pilotsById.get(assignedPilotId)?.name || normalizePilotName(mission.assignedPilotName);
        const participantIds = (Array.isArray(mission.participants) ? mission.participants : [])
          .map((participant) => resolvePilotId(participant?.pilotId, participant?.pilotName))
          .filter((pilotId, index, entries) => pilotId && entries.indexOf(pilotId) === index);
        if (participantIds.length === 0 && assignedPilotId) participantIds.push(assignedPilotId);
        const participants = participantIds.map((pilotId) => ({
          pilotId,
          pilotName: pilotsById.get(pilotId)?.name || "",
        }));
        const primaryParticipant = participants[0] || null;
        const rawPayoutSplit = mission.payoutSplit && typeof mission.payoutSplit === "object" ? mission.payoutSplit : null;
        const payoutSplitMode = rawPayoutSplit?.mode === "amount" ? "amount" : "percent";
        const payoutSplitItems = Array.isArray(rawPayoutSplit?.items)
          ? rawPayoutSplit.items
              .map((item) => {
                const pilotId = resolvePilotId(item?.pilotId, item?.pilotName);
                const value = Number(item?.value);
                const amountAuec = Number(item?.amountAuec);
                return pilotId && Number.isFinite(value) && Number.isFinite(amountAuec)
                  ? { pilotId, pilotName: pilotsById.get(pilotId)?.name || "", value, amountAuec: Math.round(amountAuec) }
                  : null;
              })
              .filter(Boolean)
          : [];
        const rawAllocations = mission.participantAllocations && typeof mission.participantAllocations === "object"
          ? mission.participantAllocations
          : {};
        const participantAllocations = Object.fromEntries(participants.map((participant) => {
          const allocation = rawAllocations[participant.pilotId] && typeof rawAllocations[participant.pilotId] === "object"
            ? rawAllocations[participant.pilotId]
            : {};
          const loadIds = Array.isArray(allocation.loadIds)
            ? [...new Set(allocation.loadIds.map((loadId) => String(loadId || "").trim()).filter(Boolean))]
            : [];
          return [participant.pilotId, { pilotId: participant.pilotId, pilotName: participant.pilotName, loadIds }];
        }));
        const rawParticipantProgress = mission.participantProgress && typeof mission.participantProgress === "object"
          ? mission.participantProgress
          : {};
        const participantProgress = Object.fromEntries(Object.entries(rawParticipantProgress)
          .map(([pilotId, progress]) => {
            if (!progress || typeof progress !== "object") return null;
            const normalizedPilotId = String(pilotId || progress.pilotId || "").trim();
            if (!normalizedPilotId) return null;
            const normalizeCount = (value) => Math.max(0, Math.round(Number(value) || 0));
            const normalizeScu = (value) => Math.max(0, Number(value) || 0);
            return [normalizedPilotId, {
              pilotId: normalizedPilotId,
              pilotName: normalizePilotName(progress.pilotName),
              assignedLoadIds: Array.isArray(progress.assignedLoadIds)
                ? [...new Set(progress.assignedLoadIds.map((loadId) => String(loadId || "").trim()).filter(Boolean))]
                : [],
              totalCount: normalizeCount(progress.totalCount),
              placedCount: normalizeCount(progress.placedCount),
              deliveredCount: normalizeCount(progress.deliveredCount),
              totalScu: normalizeScu(progress.totalScu),
              placedScu: normalizeScu(progress.placedScu),
              deliveredScu: normalizeScu(progress.deliveredScu),
              completedAt: String(progress.completedAt || ""),
              updatedAt: String(progress.updatedAt || ""),
            }];
          })
          .filter(Boolean));

        return {
          ...mission,
          id: mission.id || createRuntimeId(),
          type: missionType,
          title: String(mission.title || "Unbenannter Auftrag"),
          pickup: String(mission.pickup || (missionUsesCargoGrid ? normalizedSegments[0]?.pickup || "" : ["courier", "delivery"].includes(missionType) ? serviceDetails.packages[0]?.pickup || "" : "")),
          dropoff: String(mission.dropoff || (missionUsesCargoGrid ? (normalizedSegments.length === 1 ? normalizedSegments[0]?.dropoff || "" : `${normalizedSegments.length} Ziele`) : serviceDetails.location || "")),
          notes: String(mission.notes || ""),
          payout: Number.isFinite(Number(mission.payout)) && Number(mission.payout) > 0 ? Math.round(Number(mission.payout)) : null,
          maxContainerScu: missionUsesCargoGrid ? normalizeMissionMaxContainerScu(mission.maxContainerScu) : null,
          color: normalizeMissionColor(mission.color) || MISSION_COLOR_PALETTE[0],
          assignedFleetEntryId,
          assignedPilotId: primaryParticipant?.pilotId || assignedPilotId,
          assignedPilotName: primaryParticipant?.pilotName || assignedPilotName,
          participants,
          participantAllocations,
          participantProgress,
          payoutSplit: payoutSplitItems.length > 0 ? { mode: payoutSplitMode, items: payoutSplitItems } : null,
          assignmentUpdatedAt: String(mission.assignmentUpdatedAt || mission.createdAt || new Date().toISOString()),
          createdAt: mission.createdAt || new Date().toISOString(),
          completedAt: mission.completedAt || "",
          paidAt: mission.paidAt || "",
          status: normalizeMissionStatus(mission.status),
          sourceImportId: String(mission.sourceImportId || ""),
          sourceImportFile: String(mission.sourceImportFile || ""),
          sourceImportDevice: String(mission.sourceImportDevice || ""),
          sourceImportQuality: normalizeMissionImportQuality(mission.sourceImportQuality),
          serviceDetails,
          segments: missionUsesCargoGrid ? normalizedSegments : [],
          loads: missionUsesCargoGrid ? loads : [],
        };
      })
    : [];

  // Reading shared state must preserve existing colors. New/edit actions
  // choose a suitable color themselves; recoloring here changes old missions
  // whenever an import is prepended and creates false editing conflicts.

  const fleet = rawFleetEntries.length > 0
    ? rawFleetEntries
        .map((entry) => {
          const shipId = entry.shipId || shipLibraryByPresetId.get(entry.presetId || "")?.id || "";
          const pilotId = resolvePilotId(entry.pilotId, entry.pilotName, normalizedMode === "solo" ? soloPilotId : "");
          return {...entry, ...createFleetEntry({
            id: entry.id || createRuntimeId(),
            manufacturer: entry.manufacturer,
            model: entry.model,
            registration: entry.registration,
            imageUrl: entry.imageUrl,
            refuelContainerSizeScu: entry.refuelContainerSizeScu ?? legacyRefuelContainerSizeByShipId.get(shipId),
            refuelContainerSizesScu: entry.refuelContainerSizesScu,
            acquiredOn: entry.acquiredOn,
            endedOn: entry.endedOn,
            status: entry.status,
            patchVersion: entry.patchVersion,
            ownerName: entry.ownerName,
            pilotId,
            pilotName: pilotsById.get(pilotId)?.name || normalizePilotName(entry.pilotName),
            pledgePurchased: Boolean(entry.pledgePurchased),
            notes: entry.notes,
            shipId,
            createdAt: entry.createdAt,
          })};
        })
        .filter((entry) => entry.manufacturer && entry.model && entry.acquiredOn)
    : [];

  const ledgerEntries = Array.isArray(input?.ledgerEntries)
    ? input.ledgerEntries
        .map((entry) => {
          const linkedMission = missions.find((mission) => mission.id === entry.missionId) || null;
          const explicitFleetEntryId = String(entry.fleetEntryId || "").trim();
          const missionFleetEntryId = String(linkedMission?.assignedFleetEntryId || "").trim();
          const matchingFleetEntries = fleet.filter((fleetEntry) => fleetEntry.shipId && fleetEntry.shipId === entry.shipId);
          const inferredFleetEntryId = explicitFleetEntryId
            || (fleet.some((fleetEntry) => fleetEntry.id === missionFleetEntryId) ? missionFleetEntryId : "")
            || (matchingFleetEntries.length === 1 ? matchingFleetEntries[0].id : "");
          const inferredShipId = String(entry.shipId || fleet.find((fleetEntry) => fleetEntry.id === inferredFleetEntryId)?.shipId || "").trim();
          return {...entry, ...createLedgerEntry({
            id: entry.id || createRuntimeId(),
            bookedOn: entry.bookedOn,
            scope: entry.scope,
            flow: entry.flow,
            category: entry.category,
            amountAuec: entry.amountAuec,
            reference: entry.reference,
            shipId: inferredShipId,
            missionId: entry.missionId,
            purchaseShipProfileId: entry.purchaseShipProfileId,
            purchaseRegistration: entry.purchaseRegistration,
            fleetEntryId: inferredFleetEntryId,
            shipWorkflowType: entry.shipWorkflowType,
            sourceFleetEntryId: entry.sourceFleetEntryId,
            targetFleetEntryId: entry.targetFleetEntryId,
            targetShipProfileId: entry.targetShipProfileId,
            targetRegistration: entry.targetRegistration,
            sourcePreviousStatus: entry.sourcePreviousStatus,
            sourcePreviousEndedOn: entry.sourcePreviousEndedOn,
            sourceWasActive: entry.sourceWasActive,
            notes: entry.notes,
            createdAt: entry.createdAt,
          })};
        })
        .filter((entry) => entry.bookedOn && entry.category && entry.amountAuec > 0)
    : [];

  const stopHistory = Array.isArray(input?.stopHistory)
    ? input.stopHistory
        .map((entry, index) => ({
          id: entry.id || createRuntimeId(),
          dropoff: String(entry.dropoff || "Unbekanntes Ziel"),
          pickups: Array.isArray(entry.pickups) ? entry.pickups.map((value) => String(value || "").trim()).filter(Boolean) : [],
          missionIds: Array.isArray(entry.missionIds) ? entry.missionIds.map((value) => String(value || "").trim()).filter(Boolean) : [],
          missionTitles: Array.isArray(entry.missionTitles) ? entry.missionTitles.map((value) => String(value || "").trim()).filter(Boolean) : [],
          loadCount: clamp(Number(entry.loadCount) || 0, 0, 9999),
          scu: Math.max(0, Number(entry.scu) || 0),
          completedAt: entry.completedAt || new Date().toISOString(),
          note: String(entry.note || ""),
          order: Number.isInteger(entry.order) ? entry.order : index,
        }))
        .sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime())
    : [];


  const rows = clamp(Number(input?.layout?.rows) || defaultState.layout.rows, 2, MAX_GRID_ROWS);
  const cols = clamp(Number(input?.layout?.cols) || defaultState.layout.cols, 2, 12);
  const fleetEntryId = String(input?.layout?.fleetEntryId || "");
  const shipId = String(input?.layout?.shipId || fleet.find((entry) => entry.id === fleetEntryId)?.shipId || "");
  const requestedActiveFleetEntryId = String(input?.activeFleetEntryId || fleetEntryId || "");
  const activeFleetEntryId = fleet.some((entry) => entry.id === requestedActiveFleetEntryId && entry.status === "active")
    ? requestedActiveFleetEntryId
    : "";
  const legacyPresetId = SHIP_PRESETS[input?.layout?.presetId] ? input.layout.presetId : "custom";
  const legacyPreset = SHIP_PRESETS[legacyPresetId] || null;
  const defaultHeight = clamp(Number(input?.layout?.defaultHeight) || legacyPreset?.defaultHeight || defaultState.layout.defaultHeight, 1, 8);
  const overloadMode = Boolean(input?.layout?.overloadMode);
  const blockedSlots = normalizeGridBlockedSlots(
    Array.isArray(input?.layout?.blockedSlots) && input.layout.blockedSlots.length > 0
      ? input.layout.blockedSlots
      : legacyPreset?.blockedSlots || [],
    rows,
    cols,
  );
  const heightOverrides = normalizeGridHeightOverrides(
    Object.keys(input?.layout?.heightOverrides || {}).length > 0
      ? input.layout.heightOverrides
      : legacyPreset?.heightOverrides || {},
    rows,
    cols,
  );

  return {
    layout: {
      shipId,
      fleetEntryId,
      rows,
      cols,
      presetId: shipId || legacyPresetId || "custom",
      blockedSlots,
      defaultHeight,
      heightOverrides,
      overloadMode,
      overloadSlotIds: normalizeGridBlockedSlots(input?.layout?.overloadSlotIds || [], rows, cols),
    },
    missions,
    fleet,
    pilots,
    soloPilotId,
    activeFleetEntryId,
    uiLanguage: normalizeUiLanguage(input?.uiLanguage),
    backupReminderDays: BackupUi.normalizeBackupReminderDays(input?.backupReminderDays),
    autoload: Autoload.normalizeAutoloadSettings(input?.autoload),
    ledgerEntries,
    shipLibrary,
    // Retain personal online contacts even though Solo has no contact editor.
    contacts: Array.isArray(input?.contacts) ? cloneData(input.contacts) : [],
    stopHistory,
    selectedLoadId: null,
    selectionCleared: Boolean(input?.selectionCleared),
    levelFilter: input?.levelFilter === "all" ? "all" : clamp(Number(input?.levelFilter) || 0, 0, 8),
    selectedStopDropoff: String(input?.selectedStopDropoff || ""),
    currentLocation: String(input?.currentLocation || "").trim(),
    selectedRunRoutePointKey: String(input?.selectedRunRoutePointKey || "").trim(),
    runPriorityRouteLocation: String(input?.runPriorityRouteLocation || "").trim(),
    runRouteProgress: Object.fromEntries(fleet.map((entry) => [entry.id, [...new Set(
      (Array.isArray(input?.runRouteProgress?.[entry.id]) ? input.runRouteProgress[entry.id] : [])
        .filter((id) => typeof id === "string" && missions.some((mission) => mission.id === id)),
    )]])),
    runCompletedRoutePoints: [...new Set(
      (Array.isArray(input?.runCompletedRoutePoints) ? input.runCompletedRoutePoints : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    )].slice(0, 500),
  };
}

function sanitizePlacement(placement) {
  if (!placement || typeof placement !== "object") return null;
  const row = Number(placement.row);
  const col = Number(placement.col);
  const z = clamp(Number(placement.z) || 0, 0, 7);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return null;
  return {
    row,
    col,
    z,
    rotated: Boolean(placement.rotated),
    slotId: createSlotId(row, col),
    fleetEntryId: String(placement.fleetEntryId || "").trim(),
  };
}

function sanitizeLegacySlot(slotId, rotated, dimensions) {
  const position = slotIdToPosition(slotId);
  if (!position) return null;
  return {
    row: position.row,
    col: position.col,
    z: 0,
    rotated,
    slotId: createSlotId(position.row, position.col),
    width: dimensions.width,
    depth: dimensions.depth,
    height: dimensions.height,
  };
}

function pruneInvalidPlacements(candidateState) {
  const previousState = state;
  state = candidateState;
  const placementEntries = getAllLoads()
    .filter(({ mission, load }) => (
      load.placement
      && isLoadPlacementForFleetEntry(load, mission, state.layout.fleetEntryId)
    ))
    .map((entry) => ({
      ...entry,
      savedPlacement: { ...entry.load.placement },
    }))
    .sort((left, right) => (
      (Number(left.savedPlacement.z) || 0) - (Number(right.savedPlacement.z) || 0)
      || (Number(left.savedPlacement.row) || 0) - (Number(right.savedPlacement.row) || 0)
      || (Number(left.savedPlacement.col) || 0) - (Number(right.savedPlacement.col) || 0)
    ));

  placementEntries.forEach(({ load }) => {
    load.placement = null;
  });

  placementEntries.forEach(({ mission, load, savedPlacement }) => {
    const result = canPlaceLoadAt(load, savedPlacement.row, savedPlacement.col, load.id);
    if (!result.valid) {
      load.placement = null;
    } else {
      load.placement = {
        row: savedPlacement.row,
        col: savedPlacement.col,
        z: result.baseZ,
        rotated: load.rotated,
        slotId: createSlotId(savedPlacement.row, savedPlacement.col),
        fleetEntryId: savedPlacement.fleetEntryId || String(mission.assignedFleetEntryId || "").trim(),
      };
    }
  });
  const normalized = cloneData(state);
  state = previousState;
  return normalized;
}

function deriveDimensionsFromScu(scu) {
  const volume = clamp(Number(scu) || 1, 1, 512);
  let best = { width: volume, depth: 1, height: 1 };
  let bestScore = Number.POSITIVE_INFINITY;

  for (let width = 1; width <= Math.min(volume, 8); width += 1) {
    for (let depth = 1; depth <= Math.min(volume, 8); depth += 1) {
      for (let height = 1; height <= Math.min(volume, 8); height += 1) {
        if (width * depth * height !== volume) continue;
        const maxDimension = Math.max(width, depth, height);
        const minDimension = Math.min(width, depth, height);
        const score = maxDimension * 10 + (maxDimension - minDimension) * 3 + height * 2;
        if (score < bestScore) {
          best = { width, depth, height };
          bestScore = score;
        }
      }
    }
  }

  return best;
}
