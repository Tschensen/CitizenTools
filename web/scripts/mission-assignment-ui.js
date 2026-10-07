// Assignment details, suitability and mission transfer readiness.
function formatMissionPaidAt(mission) {
  const incomeEntry = getMissionIncomeEntry(mission);
  const paidAt = mission.paidAt || incomeEntry?.createdAt || mission.completedAt || incomeEntry?.bookedOn || "";
  if (!paidAt) return cargoText("common.open", "offen");
  return String(paidAt).includes("T") ? formatDateTimeDisplay(paidAt) : formatDateDisplay(paidAt);
}

function formatMissionAssignedShip(mission) {
  const fleetEntry = (state.fleet || []).find((entry) => entry.id === mission.assignedFleetEntryId) || null;
  if (!fleetEntry) {
    return typeof isDispatcherMode === "function" && isDispatcherMode()
      ? cargoText("contracts.meta.assignmentOpen", "Disposition: offen")
      : cargoText("contracts.meta.assignedShipMissing", "Schiff: nicht zugeordnet");
  }
  const assignedShipKey = typeof isDispatcherMode === "function" && isDispatcherMode()
    ? "contracts.meta.dispatchAssignedShip"
    : "contracts.meta.assignedShip";
  return cargoText(assignedShipKey, "Schiff: {ship}", {
    ship: `${fleetEntry.manufacturer} ${fleetEntry.model} · ${formatFleetRegistration(fleetEntry)}`,
  });
}

function formatMissionAssignedPilot(mission) {
  const pilotNames = getMissionParticipantNames(mission);
  if (pilotNames) {
    const participantCount = getMissionParticipants(mission).length;
    return participantCount > 1
      ? cargoText("contracts.meta.assignedParticipants", "Piloten: {pilots}", { pilots: pilotNames })
      : cargoText("contracts.meta.assignedPilot", "Pilot: {pilot}", { pilot: pilotNames });
  }
  return typeof isDispatcherMode === "function" && isDispatcherMode()
    ? cargoText("contracts.meta.pilotOpen", "Pilot: offen")
    : "";
}

function formatMissionPayoutSplit(mission) {
  const items = Array.isArray(mission?.payoutSplit?.items) ? mission.payoutSplit.items : [];
  if (items.length < 2) return "";
  const locale = cargoLocale();
  const details = items.map((item) => `${item.pilotName || getPilotProfiles().find((pilot) => pilot.id === item.pilotId)?.name || "?"}: ${(Number(item.amountAuec) || 0).toLocaleString(locale)} aUEC`);
  return cargoText("contracts.meta.payoutSplit", "Erlös geteilt: {details}", { details: details.join(" · ") });
}

function formatMissionTransportSummary(mission) {
  if (!isCargoMission(mission) || !isDispatcherMode()) return "";
  const shippedByFleetEntry = new Map();
  (mission.loads || []).forEach((load) => {
    const fleetEntryId = String(load.deliveredByFleetEntryId || load.loadedByFleetEntryId || load.placement?.fleetEntryId || "").trim();
    if (!fleetEntryId) return;
    shippedByFleetEntry.set(fleetEntryId, (shippedByFleetEntry.get(fleetEntryId) || 0) + (Number(load.scu) || 0));
  });
  if (shippedByFleetEntry.size === 0) return "";
  const details = [...shippedByFleetEntry.entries()].map(([fleetEntryId, scu]) => {
    const fleetEntry = state.fleet.find((entry) => entry.id === fleetEntryId);
    const pilotName = getFleetEntryPilotName(fleetEntry) || formatFleetEntryDisplayName(fleetEntry) || "?";
    return `${pilotName}: ${formatScuAmount(scu)}`;
  });
  return cargoText("contracts.meta.transportSplit", "Transportanteile: {details}", { details: details.join(" · ") });
}

function getDispatcherMissionAssignmentSuitability(entry, mission) {
  if (!entry || entry.status !== "active") {
    return { ok: false, reason: cargoText("fleet.status.inactive", "Nicht aktiv") };
  }
  const shipType = findShipLibraryEntryForFleetEntry(entry);
  if (!shipType) {
    return { ok: false, reason: cargoText("common.unlinked", "Nicht verknüpft") };
  }
  const missionType = normalizeMissionType(mission?.type);
  if (isCargoMission(mission) && !hasShipCargoGrid(shipType)) {
    return { ok: false, reason: cargoText("contracts.assignment.noCargoShip", "kein Frachtschiff") };
  }
  if (missionType === "refuel") {
    const refuelConfig = getRefuelContainerConfig(shipType, entry);
    if (!refuelConfig.hasRefuelContainers) {
      return { ok: false, reason: cargoText("contracts.assignment.noRefuelShip", "kein Tankschiff") };
    }
    if (!refuelConfig.hasConfiguredCapacity) {
      return { ok: false, reason: cargoText("contracts.assignment.refuelOpen", "Refuel-Konfiguration offen") };
    }
  }
  if (missionType === "salvage") {
    if (normalizeShipClass(shipType.shipClass) !== "salvage") {
      return { ok: false, reason: cargoText("contracts.assignment.noSalvageShip", "kein Bergungsschiff") };
    }
  }
  if (missionType === "mining") {
    const details = getMissionServiceDetails(mission);
    if (details.miningMethod === "ship" && normalizeShipClass(shipType.shipClass) !== "mining") {
      return { ok: false, reason: cargoText("contracts.assignment.noMiningShip", "kein Bergbauschiff") };
    }
  }
  return { ok: true, reason: "" };
}

function formatDispatcherAssignmentOption(entry) {
  return typeof formatFleetAssignmentDisplayName === "function"
    ? formatFleetAssignmentDisplayName(entry)
    : `${entry.manufacturer} ${entry.model} · ${formatFleetRegistration(entry)}`;
}

function distributeMissionLoadsToParticipants(mission) {
  const participants = getMissionParticipants(mission);
  const allocations = Object.fromEntries(participants.map((participant) => [participant.pilotId, {
    pilotId: participant.pilotId,
    pilotName: participant.pilotName,
    loadIds: [],
  }]));
  const pilotIds = participants.map((participant) => participant.pilotId);
  if (pilotIds.length === 0) {
    mission.participantAllocations = {};
    return;
  }

  const assignedScu = Object.fromEntries(pilotIds.map((pilotId) => [pilotId, 0]));
  (Array.isArray(mission.loads) ? mission.loads : [])
    .filter((load) => String(load?.id || "").trim())
    .slice()
    .sort((left, right) => (Number(right.scu) || 0) - (Number(left.scu) || 0) || String(left.id).localeCompare(String(right.id)))
    .forEach((load) => {
      const pilotId = pilotIds.slice().sort((left, right) => assignedScu[left] - assignedScu[right] || left.localeCompare(right))[0];
      allocations[pilotId].loadIds.push(load.id);
      assignedScu[pilotId] += Math.max(0, Number(load.scu) || 0);
    });
  mission.participantAllocations = allocations;
  mission.participantProgress = {};
}

function hasMissionParticipantProgress(mission) {
  return Object.values(mission?.participantProgress || {}).some((progress) => (
    (Number(progress?.placedCount) || 0) > 0
    || (Number(progress?.deliveredCount) || 0) > 0
    || (Number(progress?.placedScu) || 0) > 0
    || (Number(progress?.deliveredScu) || 0) > 0
  ));
}

function getMissionParticipantProgressRows(mission) {
  const allocations = mission?.participantAllocations && typeof mission.participantAllocations === "object"
    ? mission.participantAllocations
    : {};
  const progressByPilot = mission?.participantProgress && typeof mission.participantProgress === "object"
    ? mission.participantProgress
    : {};
  return getMissionParticipants(mission).map((participant) => {
    const allocation = allocations[participant.pilotId] || {};
    const progress = progressByPilot[participant.pilotId] || {};
    const loadIds = Array.isArray(allocation.loadIds) ? allocation.loadIds : [];
    const allocatedLoads = (Array.isArray(mission.loads) ? mission.loads : [])
      .filter((load) => loadIds.includes(load.id));
    const allocatedScu = allocatedLoads.reduce((sum, load) => sum + Math.max(0, Number(load.scu) || 0), 0);
    return {
      pilotName: participant.pilotName || cargoText("contracts.assignment.pilotOpen", "Pilot offen"),
      totalCount: Number(progress.totalCount) || allocatedLoads.length,
      placedCount: Number(progress.placedCount) || 0,
      deliveredCount: Number(progress.deliveredCount) || 0,
      totalScu: Number(progress.totalScu) || allocatedScu,
      deliveredScu: Number(progress.deliveredScu) || 0,
    };
  });
}

function renderMissionParticipantProgress(mission) {
  const rows = getMissionParticipantProgressRows(mission);
  if (rows.length === 0 || !isCargoMission(mission)) return "";
  const totalScu = rows.reduce((sum, row) => sum + row.totalScu, 0);
  const deliveredScu = rows.reduce((sum, row) => sum + row.deliveredScu, 0);
  return `
    <section class="mission-participant-progress">
      <strong>${escapeHtml(cargoText("contracts.assignment.progressTitle", "Frachtfortschritt"))}</strong>
      <p>${escapeHtml(cargoText("contracts.assignment.progressTotal", "{delivered} von {total} geliefert", {
        delivered: formatScuAmount(deliveredScu),
        total: formatScuAmount(totalScu),
      }))}</p>
      <ul>
        ${rows.map((row) => `<li><span>${escapeHtml(row.pilotName)}</span><span>${escapeHtml(cargoText("contracts.assignment.progressPilot", "{delivered}/{total} geliefert · {placed} verladen", {
          delivered: row.deliveredCount,
          total: row.totalCount,
          placed: row.placedCount,
        }))}</span></li>`).join("")}
      </ul>
    </section>
  `;
}

function isOrganizationMissionReadyForCompletion(mission) {
  if (!isDispatcherMode() || !mission?.organizationOrigin || !isCargoMission(mission)) return true;
  const rows = getMissionParticipantProgressRows(mission);
  if (rows.length === 0) return false;
  return rows.every((row) => row.totalCount === 0 || row.deliveredCount >= row.totalCount);
}

function renderMissionDispatcherAssignment(target, mission) {
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (!target || !dispatcherMode || !isMissionActive(mission)) {
    if (target) {
      target.hidden = true;
      target.innerHTML = "";
    }
    return;
  }

  const assignedFleetEntryId = String(mission.assignedFleetEntryId || "").trim();
  const participantIds = new Set(getMissionParticipants(mission).map((participant) => participant.pilotId));
  const options = getFleetEntries()
    .filter((entry) => entry.status === "active" || entry.id === assignedFleetEntryId)
    .map((entry) => ({
      entry,
      suitability: getDispatcherMissionAssignmentSuitability(entry, mission),
    }));
  const hasSuitableEntries = options.some((option) => option.suitability.ok);
  const availablePilots = getPilotProfiles()
    .filter((pilot) => String(pilot?.role || "pilot") !== "viewer")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, typeof currentUiLanguage === "function" ? currentUiLanguage() : "de"));

  target.hidden = false;
  target.innerHTML = `
    <div class="mission-dispatch-assignment-fields">
      <label>
        <span>${escapeHtml(cargoText("contracts.assignment.shipLabel", "Einsatzschiff"))}</span>
        <select data-role="dispatcher-assignment">
          <option value="">${escapeHtml(cargoText("contracts.assignment.dispatchOpen", "Disposition offen"))}</option>
          ${options.map(({ entry, suitability }) => `
            <option value="${escapeHtml(entry.id)}" ${!suitability.ok && entry.id !== assignedFleetEntryId ? "disabled" : ""}>
              ${escapeHtml(formatDispatcherAssignmentOption(entry))}${suitability.ok ? "" : ` · ${escapeHtml(suitability.reason)}`}
            </option>
          `).join("")}
        </select>
      </label>
      <fieldset class="mission-dispatch-participants">
        <legend>${escapeHtml(cargoText("contracts.assignment.participantsLabel", "Einsatzbeteiligte"))}</legend>
        <small>${escapeHtml(cargoText("contracts.assignment.participantsHint", "Mehrere Piloten können denselben Auftrag gemeinsam ausführen."))}</small>
        <div class="mission-dispatch-participant-list">
          ${availablePilots.map((pilot) => `
            <label><input type="checkbox" data-role="dispatcher-participant" value="${escapeHtml(pilot.id)}" ${participantIds.has(pilot.id) ? "checked" : ""} /> <span>${escapeHtml(pilot.name)}</span></label>
          `).join("") || `<small>${escapeHtml(cargoText("contracts.assignment.pilotOpen", "Pilot offen"))}</small>`}
        </div>
      </fieldset>
    </div>
    ${renderMissionParticipantProgress(mission)}
    ${!isOrganizationMissionReadyForCompletion(mission) ? `<small>${escapeHtml(cargoText("contracts.organization.progressIncomplete", "Der Auftrag bleibt offen, bis alle zugeteilten Container geliefert wurden."))}</small>` : ""}
    ${hasSuitableEntries ? "" : `<small>${escapeHtml(cargoText("contracts.assignment.noSuitableShips", "Keine passenden aktiven Schiffe verfügbar."))}</small>`}
  `;

  const select = target.querySelector('[data-role="dispatcher-assignment"]');
  if (select) {
    select.value = assignedFleetEntryId;
    select.addEventListener("change", () => {
      const nextFleetEntryId = String(select.value || "").trim();
      if (nextFleetEntryId === assignedFleetEntryId) return;
      getMissionActiveLoads(mission).forEach((load) => {
        load.placement = null;
      });
      const nextFleetEntry = getFleetEntries().find((entry) => entry.id === nextFleetEntryId) || null;
      const participantIdsForShip = getMissionParticipants(mission).map((participant) => participant.pilotId);
      if (participantIdsForShip.length === 0 && nextFleetEntry?.pilotId) participantIdsForShip.push(nextFleetEntry.pilotId);
      setMissionAssignment(mission, { fleetEntryId: nextFleetEntryId, participantIds: participantIdsForShip });
      if (!hasMissionParticipantProgress(mission)) distributeMissionLoadsToParticipants(mission);
      state.selectedLoadId = null;
      state.selectionCleared = true;
      lastUnloadPlan = null;
      persist();
      render();
    });
  }
  target.querySelectorAll('[data-role="dispatcher-participant"]').forEach((participantInput) => {
    participantInput.addEventListener("change", () => {
      const selectedParticipantIds = Array.from(target.querySelectorAll('[data-role="dispatcher-participant"]:checked'))
        .map((input) => String(input.value || "").trim())
        .filter(Boolean);
      const currentParticipantIds = getMissionParticipants(mission).map((participant) => participant.pilotId).sort();
      const changedParticipants = currentParticipantIds.length !== selectedParticipantIds.length
        || currentParticipantIds.some((pilotId) => !selectedParticipantIds.includes(pilotId));
      if (changedParticipants && hasMissionParticipantProgress(mission)) {
        void showAppNotice(cargoText("contracts.assignment.progressLocked", "Die Beteiligten können nicht mehr geändert werden, sobald Teilfracht unterwegs ist."));
        render();
        return;
      }
      setMissionAssignment(mission, {
        fleetEntryId: mission.assignedFleetEntryId,
        participantIds: selectedParticipantIds,
      });
      distributeMissionLoadsToParticipants(mission);
      persist();
      render();
    });
  });
}

function getMissionAssignmentWarning(mission) {
  if (!isMissionActive(mission)) return "";
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const assignedFleetEntryId = String(mission.assignedFleetEntryId || "").trim();
  if (!assignedFleetEntryId) {
    if (dispatcherMode) return "";
    return cargoText("contracts.assignment.unassigned", "Diesem aktiven Auftrag ist kein Schiff zugeordnet.");
  }

  const assignedEntry = (state.fleet || []).find((entry) => entry.id === assignedFleetEntryId) || null;
  if (!assignedEntry) {
    return cargoText("contracts.assignment.missingShip", "Das zugeordnete Schiff ist nicht mehr in der Flotte vorhanden.");
  }
  if (assignedEntry.status !== "active") {
    return cargoText("contracts.assignment.shipInactive", "{ship} ist aktuell nicht aktiv.", { ship: formatFleetEntryDisplayName(assignedEntry) });
  }
  if (dispatcherMode) {
    return "";
  }
  if (!state.activeFleetEntryId) {
    return cargoText("contracts.assignment.noActiveShip", "Es ist kein aktives Schiff ausgewählt.");
  }
  if (assignedFleetEntryId !== state.activeFleetEntryId) {
    const activeEntry = currentActiveFleetEntry();
    return activeEntry
      ? cargoText("contracts.assignment.otherActive", "Auftrag ist {assigned} zugeordnet, aktiv ist {active}.", {
          assigned: formatFleetEntryDisplayName(assignedEntry),
          active: formatFleetEntryDisplayName(activeEntry),
        })
      : cargoText("contracts.assignment.noActiveButAssigned", "Auftrag ist {assigned} zugeordnet, aber kein aktives Schiff ist ausgewählt.", {
          assigned: formatFleetEntryDisplayName(assignedEntry),
        });
  }
  return "";
}

function getMissionTransferReadiness(mission) {
  const activeEntry = currentActiveFleetEntry();
  if (!isMissionActive(mission)) {
    return { ok: false, message: cargoText("contracts.transfer.onlyActive", "Nur aktive Aufträge können umgeladen werden.") };
  }
  if (!activeEntry) {
    return { ok: false, message: cargoText("contracts.transfer.chooseShip", "Wähle zuerst ein aktives Schiff aus.") };
  }
  if (mission.assignedFleetEntryId === activeEntry.id) {
    return { ok: false, message: cargoText("contracts.transfer.alreadyAssigned", "Dieser Auftrag ist bereits dem aktiven Schiff zugeordnet.") };
  }

  const missionType = normalizeMissionType(mission.type);
  if (isCargoMission(mission)) {
    const requestedScu = getMissionActiveLoads(mission).reduce((sum, load) => sum + (Number(load.scu) || 0), 0);
    return getCargoReadiness({ requestedScu });
  }
  if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    return getRefuelReadiness(details.serviceType, details);
  }
  if (missionType === "salvage") {
    return getSalvageReadiness();
  }
  if (missionType === "mining") {
    return getMiningReadiness(getMissionServiceDetails(mission).miningMethod);
  }

  return {
    ok: true,
    activeEntry,
    message: cargoText("contracts.transfer.canTake", "{ship} kann diesen Auftrag übernehmen.", { ship: formatFleetEntryDisplayName(activeEntry) }),
  };
}
