// Mission cards, grouped actions and completed mission tables.
function createMissionGroupActions(id, missions) {
  if (!missions.length || !["active", "completed"].includes(id)) return null;
  const actions = document.createElement("div");
  actions.className = "mission-group-actions";

  if (id === "active") {
    const completableCount = missions.filter((mission) => !isMissionIncomplete(mission)).length;
    actions.innerHTML = `
      <button class="secondary-button icon-text-button mission-group-complete-all" type="button"${completableCount ? "" : " disabled"} aria-label="${escapeHtml(cargoText("contracts.bulk.completeActive", "Aktive abschließen"))}" data-tooltip="${escapeHtml(cargoText("contracts.bulk.completeActive", "Aktive abschließen"))}">
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M9.2 16.2 4.8 11.8 3.4 13.2 9.2 19 21 7.2 19.6 5.8 9.2 16.2z" /></svg>
        </span>
        <span>${escapeHtml(cargoText("contracts.bulk.completeActive", "Aktive abschließen"))}</span>
      </button>
      <button class="secondary-button secondary-button-danger icon-text-button mission-group-delete-all" type="button" aria-label="${escapeHtml(cargoText("contracts.bulk.deleteActive", "Aktive löschen"))}" data-tooltip="${escapeHtml(cargoText("contracts.bulk.deleteActive", "Aktive löschen"))}">
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" /></svg>
        </span>
        <span>${escapeHtml(cargoText("contracts.bulk.deleteActive", "Aktive löschen"))}</span>
      </button>
    `;
    actions.querySelector(".mission-group-complete-all")?.addEventListener("click", () => {
      void completeActiveMissions(missions);
    });
    actions.querySelector(".mission-group-delete-all")?.addEventListener("click", () => {
      void deleteActiveMissions(missions);
    });
    return actions;
  }

  actions.innerHTML = `
    <button class="primary-button icon-text-button mission-group-pay-all" type="button" aria-label="${escapeHtml(cargoText("contracts.bulk.payCompleted", "Alle bezahlt buchen"))}" data-tooltip="${escapeHtml(cargoText("contracts.bulk.payCompleted", "Alle bezahlt buchen"))}">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M15.8 6.2c-1-.8-2.1-1.2-3.5-1.2-2.7 0-4.7 1.5-5.5 4H5v2h1.4a8 8 0 0 0 0 2H5v2h1.8c.8 2.5 2.8 4 5.5 4 1.4 0 2.6-.4 3.6-1.1l-.9-1.8c-.8.5-1.6.8-2.6.8-1.5 0-2.7-.7-3.3-1.9h4.7v-2H8.6a6.2 6.2 0 0 1 0-2h5.2V9H9.1c.6-1.2 1.8-1.9 3.3-1.9 1 0 1.8.3 2.6.9l.8-1.8z" /></svg>
      </span>
      <span>${escapeHtml(cargoText("contracts.bulk.payCompleted", "Alle bezahlt buchen"))}</span>
    </button>
  `;
  actions.querySelector(".mission-group-pay-all")?.addEventListener("click", () => {
    void payCompletedMissions(missions);
  });
  return actions;
}

function createMissionGroupSection({ id, title, description, missions, mode }) {
  const section = document.createElement("section");
  section.className = `mission-group mission-group-${id}`;
  const bodyId = `missionGroup-${id}`;
  const isCollapsed = collapsedMissionGroupIds.has(id);
  section.innerHTML = `
    <button class="mission-group-toggle" type="button" aria-expanded="${String(!isCollapsed)}" aria-controls="${bodyId}">
      <span class="mission-group-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </span>
      <span class="mission-group-count">${missions.length}</span>
      <span class="collapse-indicator" aria-hidden="true"></span>
    </button>
    <div id="${bodyId}" class="mission-group-body"${isCollapsed ? " hidden" : ""}></div>
  `;

  const toggleButton = section.querySelector(".mission-group-toggle");
  const body = section.querySelector(".mission-group-body");
  body.dataset.missionGroup = id;
  if (id === "active") {
    body.classList.add("mission-sortable-list");
  }
  toggleButton.addEventListener("click", () => {
    if (collapsedMissionGroupIds.has(id)) {
      collapsedMissionGroupIds.delete(id);
    } else {
      collapsedMissionGroupIds.add(id);
    }
    render();
  });

  const groupActions = createMissionGroupActions(id, missions);
  if (groupActions) body.appendChild(groupActions);

  if (missions.length === 0) {
    body.innerHTML = `<div class="empty-state">${escapeHtml(cargoText("contracts.groups.empty", "In diesem Bereich sind keine Aufträge vorhanden."))}</div>`;
    return section;
  }

  if (mode === "table") {
    body.appendChild(createPaidMissionsTable(missions));
    return section;
  }

  missions.forEach((mission) => {
    body.appendChild(createMissionCard(mission));
  });

  if (id === "active") {
    body.addEventListener("dragover", (event) => {
      if (!draggedMissionId) return;
      event.preventDefault();
      const targetCard = event.target.closest(".mission-card");
      body.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
      if (!targetCard || targetCard.dataset.missionId === draggedMissionId) return;
      const rect = targetCard.getBoundingClientRect();
      const isAfter = event.clientY > rect.top + rect.height / 2;
      targetCard.classList.add(isAfter ? "is-drag-over-after" : "is-drag-over-before");
    });

    body.addEventListener("dragleave", (event) => {
      if (body.contains(event.relatedTarget)) return;
      body.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
    });

    body.addEventListener("drop", (event) => {
      if (!draggedMissionId) return;
      event.preventDefault();
      const targetCard = event.target.closest(".mission-card");
      body.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
      if (!targetCard) {
        moveActiveMissionToEnd(draggedMissionId);
        draggedMissionId = "";
        return;
      }
      if (targetCard.dataset.missionId === draggedMissionId) {
        draggedMissionId = "";
        return;
      }
      const rect = targetCard.getBoundingClientRect();
      const isAfter = event.clientY > rect.top + rect.height / 2;
      if (!isAfter) {
        moveActiveMissionBefore(draggedMissionId, targetCard.dataset.missionId || "");
        draggedMissionId = "";
        return;
      }
      const activeCards = [...body.querySelectorAll(".mission-card")].filter((card) => card.dataset.missionId !== draggedMissionId);
      const targetIndex = activeCards.indexOf(targetCard);
      const nextCard = activeCards[targetIndex + 1] || null;
      if (nextCard) {
        moveActiveMissionBefore(draggedMissionId, nextCard.dataset.missionId || "");
      } else {
        moveActiveMissionToEnd(draggedMissionId);
      }
      draggedMissionId = "";
    });
  }
  return section;
}

function createPaidMissionsTable(missions) {
  const table = document.createElement("div");
  table.className = "paid-mission-table";
  table.innerHTML = `
    <div class="paid-mission-row is-head">
      <span>${escapeHtml(cargoText("contracts.table.contract", "Auftrag"))}</span>
      <span>${escapeHtml(cargoText("contracts.table.type", "Typ"))}</span>
      <span>${escapeHtml(cargoText("contracts.table.paid", "Bezahlt"))}</span>
      <span>${escapeHtml(cargoText("contracts.table.payout", "Verdienst"))}</span>
      <span></span>
    </div>
    ${missions
      .map((mission) => {
        const payout = missionHasPayout(mission)
          ? `${getMissionPayout(mission).toLocaleString(cargoLocale())} aUEC`
          : cargoText("contracts.table.noPayout", "ohne Verdienst");
        return `
          <div class="paid-mission-row" data-mission-id="${escapeHtml(mission.id)}">
            <span class="paid-mission-title">
              <strong>${escapeHtml(mission.title)}</strong>
              <span>${escapeHtml(summarizeMissionRoute(mission))}</span>
            </span>
            <span>${escapeHtml(getMissionTypeLabel(mission))}</span>
            <span>${escapeHtml(formatMissionPaidAt(mission))}</span>
            <span>${escapeHtml(payout)}</span>
            <span class="paid-mission-actions">
              <button class="secondary-button icon-only-button tooltip-button paid-mission-edit" type="button" aria-label="${escapeHtml(cargoText("common.edit", "Bearbeiten"))}" data-tooltip="${escapeHtml(cargoText("common.edit", "Bearbeiten"))}">
                <span class="button-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M19.4 13.5c.04-.5.04-1 .04-1.5s0-1-.04-1.5l2.1-1.6-2-3.46-2.5 1a7.4 7.4 0 0 0-2.6-1.5L14 2h-4l-.4 2.94a7.4 7.4 0 0 0-2.6 1.5l-2.5-1-2 3.46 2.1 1.6A9.4 9.4 0 0 0 4.56 12c0 .5 0 1 .04 1.5L2.5 15.1l2 3.46 2.5-1a7.4 7.4 0 0 0 2.6 1.5L10 22h4l.4-2.94a7.4 7.4 0 0 0 2.6-1.5l2.5 1 2-3.46-2.1-1.6zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
                  </svg>
                </span>
              </button>
              <button class="ghost-button icon-only-button tooltip-button paid-mission-delete" type="button" aria-label="${escapeHtml(cargoText("contracts.actions.delete", "Auftrag löschen"))}" data-tooltip="${escapeHtml(cargoText("common.delete", "Löschen"))}">
                <span class="button-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
                  </svg>
                </span>
              </button>
            </span>
          </div>
        `;
      })
      .join("")}
  `;

  table.querySelectorAll(".paid-mission-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const missionId = button.closest(".paid-mission-row")?.dataset.missionId || "";
      const mission = state.missions.find((entry) => entry.id === missionId);
      if (mission) populateMissionForm(mission);
    });
  });

  table.querySelectorAll(".paid-mission-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const missionId = button.closest(".paid-mission-row")?.dataset.missionId || "";
      const mission = state.missions.find((entry) => entry.id === missionId);
      if (mission) void deleteMissionEntry(mission);
    });
  });

  return table;
}

function decorateMissionShipCard(missionNode, mission) {
  const entry = (state.fleet || []).find((candidate) => candidate.id === mission.assignedFleetEntryId);
  const head = missionNode.querySelector('.mission-head');
  if (!entry || !head) return;
  head.classList.add('ship-art-card', 'mission-ship-card');
  head.insertAdjacentHTML('afterbegin', renderShipCardArt(getFleetMediaEntry(entry)));
  bindShipProfileMedia(head);
}

function createMissionCard(mission) {
  const isCargo = isCargoMission(mission);
  const isDelivery = normalizeMissionType(mission?.type) === "delivery";
  const segments = getMissionSegments(mission);
  const missionStats = getMissionLoadStats(mission);
  const activeMissionLoads = missionStats.activeLoads;
  const deliveredCount = missionStats.deliveredCount;
  const isCompleted = isMissionCompleted(mission);
  const isPaid = isMissionPaid(mission);
  const workflowStatus = getMissionWorkflowStatus(mission);
  const isIncomplete = isMissionIncomplete(mission);
  const completedAt = getMissionCompletedAt(mission);
  const missionNode = missionTemplate.content.firstElementChild.cloneNode(true);
  missionNode.dataset.missionId = mission.id || "";
  decorateMissionShipCard(missionNode, mission);
  missionNode.querySelector(".mission-color").style.background = mission.color;
  missionNode.querySelector(".mission-title").textContent = mission.title;
  missionNode.querySelector(".mission-route").textContent = summarizeMissionRoute(mission);
  missionNode.classList.toggle("is-completed-mission", workflowStatus === "completed");
  missionNode.classList.toggle("is-paid-mission", workflowStatus === "paid");
  missionNode.classList.toggle("is-sortable-mission", isMissionActive(mission));
  if (isMissionActive(mission)) {
    missionNode.draggable = true;
    missionNode.setAttribute("aria-grabbed", "false");
    missionNode.addEventListener("dragstart", (event) => {
      draggedMissionId = mission.id || "";
      missionNode.classList.add("is-dragging");
      missionNode.setAttribute("aria-grabbed", "true");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedMissionId);
    });
    missionNode.addEventListener("dragend", () => {
      draggedMissionId = "";
      missionNode.classList.remove("is-dragging");
      missionNode.setAttribute("aria-grabbed", "false");
      document.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
    });
  }

  const missionBody = missionNode.querySelector(".mission-body");
  const dispatchAssignment = missionNode.querySelector(".mission-dispatch-assignment");
  const toggleMissionButton = missionNode.querySelector(".toggle-mission");
  const assignmentWarning = missionNode.querySelector(".mission-assignment-warning");
  const duplicateWarning = missionNode.querySelector(".mission-duplicate-warning");
  const statusBadge = missionNode.querySelector(".mission-status-badge");
  const transferMissionButton = missionNode.querySelector(".transfer-mission");
  const shareMissionButton = missionNode.querySelector(".share-mission");
  const editMissionButton = missionNode.querySelector(".edit-mission");
  const completeMissionButton = missionNode.querySelector(".complete-mission");
  const payMissionButton = missionNode.querySelector(".pay-mission");
  const deleteMissionButton = missionNode.querySelector(".delete-mission");
  const isCollapsed = collapsedMissionIds.has(mission.id);
  missionNode.classList.toggle("is-collapsed", isCollapsed);
  missionBody.hidden = isCollapsed;
  toggleMissionButton.setAttribute("aria-expanded", String(!isCollapsed));
  toggleMissionButton.setAttribute(
    "title",
    isCollapsed
      ? cargoText("contracts.actions.expand", "Auftrag ausklappen")
      : cargoText("contracts.actions.collapse", "Auftrag einklappen"),
  );

  if (assignmentWarning) {
    const assignmentWarningText = getMissionAssignmentWarning(mission);
    assignmentWarning.hidden = !assignmentWarningText;
    const warningFallback = cargoText("contracts.actions.checkAssignment", "Schiffszuordnung prüfen");
    assignmentWarning.setAttribute("title", assignmentWarningText || warningFallback);
    assignmentWarning.setAttribute("aria-label", assignmentWarningText || warningFallback);
    assignmentWarning.dataset.tooltip = assignmentWarningText || warningFallback;
  }

  const duplicateInfo = getMissionDuplicateWarning(mission);
  if (duplicateWarning) {
    duplicateWarning.hidden = duplicateInfo.matches.length === 0;
    const duplicateFallback = cargoText("contracts.duplicate.title", "Möglicher Doppelauftrag");
    duplicateWarning.setAttribute("title", duplicateInfo.text || duplicateFallback);
    duplicateWarning.setAttribute("aria-label", duplicateInfo.text || duplicateFallback);
    duplicateWarning.dataset.tooltip = duplicateInfo.text || duplicateFallback;
  }

  if (transferMissionButton) {
    const transferReadiness = getMissionTransferReadiness(mission);
    const canTransfer = Boolean(getMissionAssignmentWarning(mission)) && transferReadiness.ok;
    transferMissionButton.hidden = !canTransfer;
    const transferLabel = transferReadiness.activeEntry
      ? cargoText("contracts.actions.transferTo", "Auf {ship} umladen", { ship: formatFleetEntryDisplayName(transferReadiness.activeEntry) })
      : cargoText("contracts.actions.assignActiveShip", "Auftrag aktivem Schiff zuordnen");
    transferMissionButton.setAttribute("aria-label", transferLabel);
    transferMissionButton.setAttribute("title", transferLabel);
    transferMissionButton.dataset.tooltip = transferLabel;
    transferMissionButton.addEventListener("click", () => {
      transferMissionToActiveShip(mission);
    });
  }

  if (shareMissionButton) shareMissionButton.remove();

  if (statusBadge) {
    statusBadge.hidden = false;
    statusBadge.textContent = isIncomplete ? cargoText("contracts.workflow.incomplete", "Unvollständig") : getMissionWorkflowLabel(mission);
    statusBadge.classList.toggle("is-open", workflowStatus === "active" && !isIncomplete);
    statusBadge.classList.toggle("is-paid", workflowStatus === "paid");
    statusBadge.classList.toggle("is-incomplete", isIncomplete);
    statusBadge.title = isIncomplete
      ? getMissionIncompleteReasons(mission).join(" · ")
      : completedAt
      ? `${getMissionWorkflowLabel(mission)} am ${formatDateTimeDisplay(completedAt)}`
      : getMissionWorkflowLabel(mission);
  }

  const assignedCount = missionStats.placedCount;
  const totalScu = segments.reduce((sum, segment) => sum + (Number(segment.totalScu) || 0), 0);
  const maxContainerScu = normalizeMissionMaxContainerScu(mission.maxContainerScu);
  const pilotGroup = getPilotGroupForMission(mission.id);
  const pilotGroupLabel = pilotGroup
    ? cargoText("contracts.meta.pilotGroup", "Einsatzgruppe: {name}", { name: pilotGroup.name })
    : "";
  const payoutLabel = mission.payout ? ` | ${mission.payout.toLocaleString(cargoLocale())} aUEC` : "";
  const assignedShipLabel = ` | ${formatMissionAssignedShip(mission)}`;
  missionNode.querySelector(".mission-meta").textContent =
    isCargo
      ? [
          isDelivery ? getMissionTypeLabel(mission) : "",
          cargoText(segments.length === 1 ? "contracts.meta.cargoOne" : "contracts.meta.cargoMany", "{count} Teilfrachten", { count: segments.length }),
          cargoText("contracts.meta.active", "{count} aktiv", { count: activeMissionLoads.length }),
          cargoText("contracts.meta.placed", "{count} platziert", { count: assignedCount }),
          isIncomplete ? cargoText("contracts.incomplete.pickupAmountOpen", "Abholmenge offen") : "",
          deliveredCount > 0 ? cargoText("contracts.meta.delivered", "{count} geliefert", { count: deliveredCount }) : "",
          formatScuAmount(totalScu),
          maxContainerScu ? cargoText("contracts.meta.maxContainer", "Max. Container: {value}", { value: `${maxContainerScu} SCU` }) : "",
          formatMissionAssignedShip(mission),
          formatMissionAssignedPilot(mission),
          formatMissionTransportSummary(mission),
          formatMissionPayoutSplit(mission),
          pilotGroupLabel,
          mission.organizationLink?.missionId ? cargoText("contracts.meta.organizationShared", "Organisation geteilt") : "",
          mission.sourceImportId ? cargoText("contracts.meta.gameImport", "Spielimport") : "",
          duplicateInfo.matches.length > 0 ? cargoText("contracts.duplicate.meta", "ähnlicher Auftrag vorhanden") : "",
          isCompleted && completedAt ? cargoText("contracts.meta.completedAt", "abgeschlossen {value}", { value: formatDateTimeDisplay(completedAt) }) : "",
          mission.payout ? `${mission.payout.toLocaleString(cargoLocale())} aUEC` : "",
        ].filter(Boolean).join(" | ")
      : [
          getMissionTypeLabel(mission),
          isCompleted && completedAt ? cargoText("contracts.meta.completedAt", "abgeschlossen {value}", { value: formatDateTimeDisplay(completedAt) }) : cargoText("common.active", "Aktiv").toLowerCase(),
          formatMissionAssignedShip(mission),
          formatMissionAssignedPilot(mission),
          formatMissionTransportSummary(mission),
          formatMissionPayoutSplit(mission),
          pilotGroupLabel,
          mission.organizationLink?.missionId ? cargoText("contracts.meta.organizationShared", "Organisation geteilt") : "",
          mission.sourceImportId ? cargoText("contracts.meta.gameImport", "Spielimport") : "",
          duplicateInfo.matches.length > 0 ? cargoText("contracts.duplicate.meta", "ähnlicher Auftrag vorhanden") : "",
          mission.payout ? `${mission.payout.toLocaleString(cargoLocale())} aUEC` : "",
        ].filter(Boolean).join(" | ");

  renderMissionDispatcherAssignment(dispatchAssignment, mission);

  const segmentList = missionNode.querySelector(".mission-segments");
  segmentList.innerHTML = isDelivery
    ? renderServiceMissionCards(mission)
    : isCargo
    ? segments
      .map(
        (segment) => `
          <article class="mission-segment${segment.quantityPending ? " is-incomplete" : ""}">
            <strong>${escapeHtml(segment.title)}</strong>
            <p>${escapeHtml(segment.pickup)} → ${escapeHtml(segment.dropoff)}</p>
            <p>${escapeHtml(formatMissionSegmentCargo(segment))}</p>
          </article>
        `,
      )
      .join("")
    : renderServiceMissionCards(mission);

  const slotSummary = activeMissionLoads
    .filter((load) => load.placement)
    .map((load) => {
      const dims = getLoadDimensions(load, placementRotation(load));
      return `${load.placement.slotId} (${dims.width}×${dims.depth}×${dims.height})`;
    })
    .sort((left, right) => left.localeCompare(right));
  missionNode.querySelector(".mission-slots").textContent =
    isCargo
      ? slotSummary.length > 0
        ? cargoText("contracts.positions.list", "Positionen: {value}", { value: slotSummary.join(", ") })
        : cargoText("contracts.positions.none", "Positionen: noch keine Zuordnung")
      : "";
  missionNode.querySelector(".mission-notes").textContent = mission.notes;

  const containerList = missionNode.querySelector(".container-list");
  if (!isCargo) {
    containerList.hidden = true;
    containerList.innerHTML = "";
  } else if (activeMissionLoads.length === 0) {
    containerList.hidden = false;
    containerList.innerHTML = `<div class="empty-state mission-complete-note">${escapeHtml(
      isIncomplete
        ? cargoText("contracts.incomplete.noLoads", "Für die offenen Abholmengen wurden noch keine Container erzeugt.")
        : cargoText("contracts.empty.allUnloaded", "Alle Raster-Container dieses Auftrags wurden ausgeladen."),
    )}</div>`;
  } else {
    containerList.hidden = false;
    const canUseCurrentGrid = canMissionUseCurrentCargoGrid(mission);
    const canEditCargo = !isDispatcherMode() && canUseCurrentGrid;
    activeMissionLoads.forEach((load) => {
      const item = document.createElement("div");
      item.className = "container-item";
      if (state.selectedLoadId === load.id) {
        item.classList.add("active");
      }

      const dims = getLoadDimensions(load);
      const location = load.placement
        ? `${load.placement.slotId} | z ${load.placement.z} | ${formatDimensions(load, placementRotation(load))}`
        : cargoText("contracts.location.notPlaced", "Noch nicht platziert");
      item.innerHTML = `
        <div>
          <div class="container-label">${escapeHtml(load.label)}</div>
          <div class="container-meta">${escapeHtml(formatLoadRoute(load, mission))}</div>
          <div class="container-meta">${dims.width}×${dims.depth}×${dims.height} · ${load.scu} SCU · ${escapeHtml(location)}</div>
        </div>
        <div class="container-actions">
          <span class="pill">${escapeHtml(getLoadDropoff(load, mission))}</span>
          <button class="secondary-button rotate-load" type="button"${canEditCargo ? "" : " disabled"}>${escapeHtml(cargoText("common.rotate", "Drehen"))}</button>
          <button class="secondary-button select-container" type="button"${canEditCargo ? "" : " disabled"}>
            ${escapeHtml(state.selectedLoadId === load.id ? cargoText("common.selected", "Ausgewählt") : cargoText("common.select", "Auswählen"))}
          </button>
        </div>
      `;

      if (isDispatcherMode()) {
        item.querySelectorAll(".rotate-load, .select-container").forEach((button) => {
          button.hidden = true;
        });
      }

      item.querySelector(".rotate-load").addEventListener("click", () => {
        if (!canEditCargo) return;
        rotateLoad(load);
      });

      item.querySelector(".select-container").addEventListener("click", () => {
        if (!canEditCargo) return;
        state.selectedLoadId = load.id;
        state.selectionCleared = false;
        persist();
        render();
      });

      containerList.appendChild(item);
    });
  }

  if (completeMissionButton) {
    const completeLabel = isIncomplete
      ? cargoText("contracts.actions.completeDetails", "Angaben vervollständigen")
      : cargoText("contracts.actions.complete", "Abschließen");
    completeMissionButton.setAttribute("aria-label", completeLabel);
    completeMissionButton.setAttribute("title", completeLabel);
    completeMissionButton.dataset.tooltip = completeLabel;
    const canCompleteDirectly = !isCompleted && !isPaid
      && (isDispatcherMode() || !mission.organizationLink?.missionId)
      && isOrganizationMissionReadyForCompletion(mission);
    completeMissionButton.hidden = !canCompleteDirectly;
    completeMissionButton.addEventListener("click", () => {
      if (isIncomplete) {
        populateMissionForm(mission);
      } else {
        completeMission(mission.id);
      }
    });
  }

  if (payMissionButton) {
    const canBookPayment = missionHasPayout(mission) && !isPaid && !isIncomplete
      && (isDispatcherMode() || !mission.organizationLink?.missionId)
      && isOrganizationMissionReadyForCompletion(mission);
    payMissionButton.hidden = !canBookPayment;
    const payLabel = isCompleted
      ? cargoText("contracts.actions.bookPayment", "Zahlung buchen")
      : cargoText("contracts.actions.completeAndPay", "Abschließen und bezahlen");
    payMissionButton.setAttribute("aria-label", payLabel);
    payMissionButton.setAttribute("title", payLabel);
    payMissionButton.dataset.tooltip = payLabel;
    payMissionButton.addEventListener("click", () => {
      if (isCompleted) {
        payMission(mission.id);
      } else {
        completeMission(mission.id, { bookIncome: true });
      }
    });
  }

  if (editMissionButton) {
    const editLabel = cargoText("common.edit", "Bearbeiten");
    editMissionButton.setAttribute("aria-label", editLabel);
    editMissionButton.setAttribute("title", editLabel);
    editMissionButton.dataset.tooltip = editLabel;
    editMissionButton.hidden = false;
    editMissionButton.addEventListener("click", () => {
      populateMissionForm(mission);
    });
  }

  if (deleteMissionButton) {
    const deleteLabel = cargoText("common.delete", "Löschen");
    deleteMissionButton.setAttribute("aria-label", cargoText("contracts.actions.delete", "Auftrag löschen"));
    deleteMissionButton.setAttribute("title", cargoText("contracts.actions.delete", "Auftrag löschen"));
    deleteMissionButton.dataset.tooltip = deleteLabel;
    deleteMissionButton.addEventListener("click", () => {
      void deleteMissionEntry(mission);
    });
  }

  toggleMissionButton.addEventListener("click", () => {
    toggleMissionCard(mission);
  });

  return missionNode;
}

function renderMissions() {
  emptyState.hidden = state.missions.length > 0;
  missionsList.innerHTML = "";

  if (state.missions.length === 0) {
    return;
  }

  const byCompletedDesc = (left, right) => {
    const rightDate = new Date(right.paidAt || getMissionCompletedAt(right) || right.createdAt || 0).getTime();
    const leftDate = new Date(left.paidAt || getMissionCompletedAt(left) || left.createdAt || 0).getTime();
    return rightDate - leftDate;
  };
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const completedMissions = state.missions
    .filter((mission) => isMissionCompleted(mission) && !isMissionPaid(mission))
    .sort(byCompletedDesc);
  const paidMissions = state.missions
    .filter((mission) => isMissionPaid(mission))
    .sort(byCompletedDesc);

  [
    {
      id: "active",
      title: cargoText("contracts.groups.active.title", "Aktiv"),
      description: cargoText("contracts.groups.active.description", "Offene Aufträge, die noch geflogen, geliefert oder erledigt werden müssen."),
      missions: activeMissions,
      mode: "cards",
    },
    {
      id: "completed",
      title: cargoText("contracts.groups.completed.title", "Abgeschlossen"),
      description: cargoText("contracts.groups.completed.description", "Erledigte Aufträge, die noch nicht als bezahlt gebucht wurden."),
      missions: completedMissions,
      mode: "cards",
    },
    {
      id: "paid",
      title: cargoText("contracts.groups.paid.title", "Bezahlt"),
      description: cargoText("contracts.groups.paid.description", "Erledigte Aufträge mit gebuchter Zahlung oder ohne Verdienst."),
      missions: paidMissions,
      mode: "table",
    },
  ].forEach((group) => {
    missionsList.appendChild(createMissionGroupSection(group));
  });
}
