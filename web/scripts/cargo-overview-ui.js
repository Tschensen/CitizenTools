// Cargo summaries, load selection, manifest and stop presentation.
function renderSummary() {
  const preset = currentPreset();
  const fleetShip = currentFleetShip();
  const activeFleetEntry = currentActiveFleetEntry();
  const activeShipProfile = currentActiveShipProfile();
  const activeShipHasCargo = hasShipCargoGrid(activeShipProfile);
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const loads = getAllLoads();
  const currentShipLoadEntries = activeFleetEntry
    ? loads.filter(({ mission }) => String(mission.assignedFleetEntryId || "").trim() === activeFleetEntry.id)
    : loads;
  const activeMissionCount = state.missions.filter((mission) => isMissionActive(mission)).length;
  const placedLoads = getPlacedLoadEntries({ fleetEntryId: activeFleetEntry?.id || state.layout.fleetEntryId }).length;
  const totalCapacity = getTotalCapacity();
  const usedCapacity = getUsedCapacity();
  const totalPayout = state.missions
    .filter((mission) => isMissionActive(mission))
    .reduce((sum, mission) => sum + (mission.payout || 0), 0);
  const activeShipName = activeFleetEntry
    ? `${activeFleetEntry.manufacturer} ${activeFleetEntry.model}`.trim()
    : t("hub.summary.noActiveShip");
  const activeShipRegistration = activeFleetEntry
    ? formatFleetRegistration(activeFleetEntry)
    : t("hub.summary.chooseFleet");

  const locale = currentUiLanguage() === "en" ? "en-US" : "de-DE";
  const activeOrgShips = getActiveFleetEntries().length;
  const unassignedActiveMissions = state.missions.filter((mission) => isMissionActive(mission) && !String(mission.assignedFleetEntryId || "").trim()).length;
  const cards = dispatcherMode
    ? [
        { label: t("dispatcher.summary.orgShips"), value: t("dispatcher.summary.shipCount", { count: activeOrgShips }), target: "fleet" },
        { label: t("hub.summary.activeMissions"), value: activeMissionCount },
        { label: t("hub.summary.plannedPayout"), value: `${totalPayout.toLocaleString(locale)} aUEC` },
        { label: t("dispatcher.summary.unassignedMissions"), value: t("dispatcher.summary.unassignedCount", { count: unassignedActiveMissions }) },
      ]
    : [
        { label: t("hub.summary.activeShip"), value: activeShipName, detail: activeShipRegistration, target: "fleet", media: activeFleetEntry ? getFleetMediaEntry(activeFleetEntry) : null },
        { label: t("hub.summary.activeMissions"), value: activeMissionCount },
        { label: t("hub.summary.plannedPayout"), value: `${totalPayout.toLocaleString(locale)} aUEC` },
      ];

  if (!dispatcherMode && activeShipHasCargo) {
    cards.push(
      { label: t("hub.summary.loadedScu"), value: `${usedCapacity} / ${totalCapacity}` },
      { label: t("hub.summary.freeCapacity"), value: `${Math.max(totalCapacity - usedCapacity, 0)} SCU` },
      { label: t("hub.summary.placedLoads"), value: `${placedLoads}/${currentShipLoadEntries.length}` },
    );
  }

  if (overviewShipPanel) {
    overviewShipPanel.hidden = dispatcherMode || !activeShipHasCargo;
  }
  if (overviewLayout) {
    overviewLayout.classList.toggle("is-mission-only", dispatcherMode || !activeShipHasCargo);
  }

  summaryCards.innerHTML = cards
    .map(
      (card) => `
        <div class="summary-card${card.media ? " ship-art-card" : ""}${card.target ? " is-clickable" : ""}"${card.target ? ` role="button" tabindex="0" data-summary-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(t("hub.openCard", { label: card.label }))}"` : ""}>
          ${renderShipCardArt(card.media)}
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          ${card.detail ? `<small>${escapeHtml(card.detail)}</small>` : ""}
        </div>
      `,
    )
    .join("");

  bindShipProfileMedia(summaryCards);
  summaryCards.querySelectorAll("[data-summary-target]").forEach((card) => {
    const goToTarget = () => setActivePage(card.dataset.summaryTarget || "overview");
    card.addEventListener("click", goToTarget);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      goToTarget();
    });
  });

  if (overviewShipName) {
    overviewShipName.textContent = formatPlannerShipName(fleetShip, preset);
  }

  renderCreateShipIndicator();
}
function renderHomeLoads() {
  const entries = getAllLoads().filter(({ mission, load }) =>
    !isLoadDelivered(load) && canMissionUseCurrentCargoGrid(mission),
  );
  const placedCount = getPlacedLoadEntries().length;
  const selectedEntry = findLoadById(state.selectedLoadId);
  const unplacedCount = entries.length - placedCount;
  const loadAutoloadOptions = document.querySelector("#loadAutoloadOptions");
  if (loadAutoloadOptions) loadAutoloadOptions.hidden = entries.length === 0;

  homeLoadSummary.innerHTML = `
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(cargoText("contracts.load.selected", "Ausgewählte Ladung"))}</span>
      <strong>${escapeHtml(selectedEntry?.load?.label || cargoText("common.none", "Keine"))}</strong>
    </div>
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(cargoText("contracts.load.open", "Noch offen"))}</span>
      <strong>${unplacedCount}</strong>
    </div>
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(cargoText("contracts.load.inShip", "Bereits im Schiff"))}</span>
      <strong>${placedCount}</strong>
    </div>
  `;

  if (entries.length === 0) {
    homeLoadList.innerHTML = `<div class="empty-state">${escapeHtml(cargoText("contracts.empty.loads", "Noch keine Ladungen vorhanden. Erstelle zuerst auf der Seite „Auftrag anlegen“ deinen ersten Frachtauftrag."))}</div>`;
    return;
  }

  homeLoadList.innerHTML = "";

  state.missions.forEach((mission) => {
    if (!canMissionUseCurrentCargoGrid(mission)) {
      return;
    }
    const activeMissionLoads = getMissionActiveLoads(mission);
    if (activeMissionLoads.length === 0) {
      return;
    }
    const missionNode = missionTemplate.content.firstElementChild.cloneNode(true);
    missionNode.classList.add("mission-card-queue");
    decorateMissionShipCard(missionNode, mission);
    if (activeMissionLoads.some((load) => load.id === state.selectedLoadId)) {
      missionNode.classList.add("is-active-load");
    }

    missionNode.querySelector(".mission-color").style.background = mission.color;
    missionNode.querySelector(".mission-title").textContent = mission.title;
    missionNode.querySelector(".mission-route").textContent = summarizeMissionRoute(mission);

    const missionBody = missionNode.querySelector(".mission-body");
    const toggleMissionButton = missionNode.querySelector(".toggle-mission");
    const deleteMissionButton = missionNode.querySelector(".delete-mission");
    const statusBadge = missionNode.querySelector(".mission-status-badge");
    const editMissionButton = missionNode.querySelector(".edit-mission");
    const completeMissionButton = missionNode.querySelector(".complete-mission");
    const payMissionButton = missionNode.querySelector(".pay-mission");
    if (statusBadge) statusBadge.hidden = true;
    if (editMissionButton) editMissionButton.hidden = true;
    if (completeMissionButton) completeMissionButton.hidden = true;
    if (payMissionButton) payMissionButton.hidden = true;
    if (deleteMissionButton) {
      deleteMissionButton.setAttribute("aria-label", cargoText("contracts.actions.delete", "Auftrag löschen"));
      deleteMissionButton.setAttribute("title", cargoText("contracts.actions.delete", "Auftrag löschen"));
      deleteMissionButton.dataset.tooltip = cargoText("common.delete", "Löschen");
    }
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

    const assignedCount = activeMissionLoads.filter((load) => load.placement).length;
    const totalScu = getMissionSegments(mission).reduce((sum, segment) => sum + (Number(segment.totalScu) || 0), 0);
    const deliveredCount = (Array.isArray(mission.loads) ? mission.loads : []).filter((load) => isLoadDelivered(load)).length;
    const openCount = activeMissionLoads.length - assignedCount;
    const payoutLabel = mission.payout ? ` | ${mission.payout.toLocaleString(cargoLocale())} aUEC` : "";
    missionNode.querySelector(".mission-meta").textContent =
      [
        cargoText("contracts.meta.active", "{count} aktiv", { count: activeMissionLoads.length }),
        cargoText("contracts.meta.open", "{count} offen", { count: openCount }),
        cargoText("contracts.meta.inShip", "{count} im Schiff", { count: assignedCount }),
        deliveredCount > 0 ? cargoText("contracts.meta.delivered", "{count} geliefert", { count: deliveredCount }) : "",
        formatScuAmount(totalScu),
        mission.payout ? `${mission.payout.toLocaleString(cargoLocale())} aUEC` : "",
      ].filter(Boolean).join(" | ");

    missionNode.querySelector(".mission-segments").hidden = true;
    missionNode.querySelector(".mission-slots").hidden = true;

    const notes = missionNode.querySelector(".mission-notes");
    notes.textContent = mission.notes;
    notes.hidden = !mission.notes;

    const containerList = missionNode.querySelector(".container-list");
    const unplacedMissionLoadCount = activeMissionLoads.filter((load) => !load.placement).length;
    const autoLoadResult = lastAutoLoadResult?.missionId === mission.id ? lastAutoLoadResult : null;
    const autoLoadActions = document.createElement("div");
    autoLoadActions.className = "mission-autoload-actions";
    autoLoadActions.innerHTML = `
      ${renderAutoloadAreaControl(mission)}
      <button
        class="primary-button mission-autoload-button"
        type="button"
        aria-label="${escapeHtml(cargoText("contracts.load.autoloadTooltip", "Auftrag automatisch verladen"))}"
        data-tooltip="${escapeHtml(cargoText("contracts.load.autoloadTooltip", "Auftrag automatisch verladen"))}"
        ${unplacedMissionLoadCount === 0 ? "disabled" : ""}
      >
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm11-4h2v5.2l1.6-1.6L21 17l-4 4-4-4 1.4-1.4 1.6 1.6V12z" />
          </svg>
        </span>
        <span>${escapeHtml(cargoText("contracts.load.autoload", "Autoload"))}</span>
      </button>
      ${autoLoadResult
        ? `<span class="mission-autoload-result${autoLoadResult.skippedCount > 0 || autoLoadResult.overloadCount > 0 ? " is-warning" : ""}">${escapeHtml(
            formatAutoloadResultWithOverload(autoLoadResult, autoLoadResult.placedCount === 0
              ? cargoText("contracts.load.autoloadNone", "Kein passender Platz gefunden")
              : autoLoadResult.skippedCount > 0
                ? cargoText("contracts.load.autoloadPartial", "{placed} verladen · {skipped} ohne passenden Platz", {
                    placed: autoLoadResult.placedCount,
                    skipped: autoLoadResult.skippedCount,
                  })
                : cargoText("contracts.load.autoloadSuccess", "{count} Container verladen", { count: autoLoadResult.placedCount })),
          )}</span>`
        : ""}
    `;
    autoLoadActions.querySelector(".mission-autoload-button")?.addEventListener("click", () => {
      autoLoadMission(mission);
    });
    bindAutoloadAreaControls(autoLoadActions);
    missionBody.insertBefore(autoLoadActions, containerList);

    const sortedLoads = [...activeMissionLoads].sort((left, right) => {
      if (left.id === state.selectedLoadId) return -1;
      if (right.id === state.selectedLoadId) return 1;
      if (Boolean(left.placement) !== Boolean(right.placement)) {
        return left.placement ? 1 : -1;
      }
      const leftSegment = mission.segments?.find((segment) => segment.id === left.segmentId)?.order ?? 0;
      const rightSegment = mission.segments?.find((segment) => segment.id === right.segmentId)?.order ?? 0;
      if (leftSegment !== rightSegment) return leftSegment - rightSegment;
      return left.label.localeCompare(right.label, "de", { numeric: true });
    });

    sortedLoads.forEach((load) => {
      const dims = getLoadDimensions(load, placementRotation(load));
      const location = load.placement
        ? `${load.placement.slotId} | z ${load.placement.z} | ${formatDimensions(load, placementRotation(load))}`
        : cargoText("contracts.location.notInShip", "Noch nicht im Schiff");
      const item = document.createElement("div");
      item.className = "container-item load-queue-item";
      item.dataset.loadId = load.id;
      if (state.selectedLoadId === load.id) {
        item.classList.add("active", "is-active");
      }
      if (isLoadInSelectedStop(load, mission)) {
        item.classList.add("is-stop-target");
      }

      item.innerHTML = `
        <div>
          <div class="container-label">${escapeHtml(load.label)}</div>
          <div class="container-meta">${escapeHtml(formatLoadRoute(load, mission))}</div>
          <div class="container-meta">${dims.width}×${dims.depth}×${dims.height} · ${load.scu} SCU · ${escapeHtml(location)}</div>
        </div>
        <div class="container-actions load-queue-actions">
          ${load.placement ? `<button class="secondary-button load-queue-unload" type="button">${escapeHtml(cargoText("contracts.load.unload", "Ausladen"))}</button>` : ""}
          <button class="secondary-button load-queue-rotate" type="button">${escapeHtml(cargoText("common.rotate", "Drehen"))}</button>
          <button class="secondary-button load-queue-select" type="button">${escapeHtml(state.selectedLoadId === load.id ? cargoText("common.deselect", "Abwählen") : cargoText("common.select", "Auswählen"))}</button>
        </div>
      `;

      item.querySelector(".load-queue-unload")?.addEventListener("click", () => {
        unloadLoad(load);
      });

      item.querySelector(".load-queue-rotate")?.addEventListener("click", () => {
        rotateLoad(load);
      });

      item.querySelector(".load-queue-select")?.addEventListener("click", () => {
        if (state.selectedLoadId === load.id) {
          state.selectedLoadId = null;
          state.selectionCleared = true;
        } else {
          state.selectedLoadId = load.id;
          state.selectionCleared = false;
        }
        persist();
        render();
      });

      containerList.appendChild(item);
    });

    deleteMissionButton.addEventListener("click", () => {
      void deleteMissionEntry(mission);
    });

    toggleMissionButton.addEventListener("click", () => {
      if (collapsedMissionIds.has(mission.id)) {
        collapsedMissionIds.delete(mission.id);
      } else {
        collapsedMissionIds.add(mission.id);
      }
      render();
    });

    homeLoadList.appendChild(missionNode);
  });
}

function renderManifest() {
  const entries = getPlacedLoadEntries()
    .sort((left, right) => {
      const slotCompare = left.load.placement.slotId.localeCompare(right.load.placement.slotId, "de", { numeric: true });
      if (slotCompare !== 0) return slotCompare;
      return left.load.placement.z - right.load.placement.z;
    });

  manifestEmpty.hidden = entries.length > 0;
  manifestList.innerHTML = "";

  if (entries.length === 0) {
    return;
  }

  manifestList.innerHTML = entries
    .map(({ mission, load }) => {
      const dims = getLoadDimensions(load, placementRotation(load));
      const isStopTarget = isLoadInSelectedStop(load, mission);
      return `
        <article class="manifest-item${isStopTarget ? " is-stop-target" : ""}" data-load-id="${load.id}">
          <div class="manifest-slot">${escapeHtml(load.placement.slotId)}</div>
          <div class="manifest-main">
            <strong>${escapeHtml(load.label)}</strong>
            <p>${escapeHtml(mission.title)} · ${escapeHtml(formatLoadRoute(load, mission))}</p>
          </div>
          <div class="manifest-meta">
            <span>z ${load.placement.z}</span>
            <span>${dims.width}×${dims.depth}×${dims.height}</span>
            <span>${load.scu} SCU</span>
          </div>
          <button class="secondary-button manifest-select" type="button">${escapeHtml(cargoText("common.show", "Anzeigen"))}</button>
        </article>
      `;
    })
    .join("");

  manifestList.querySelectorAll(".manifest-item").forEach((node) => {
    node.querySelector(".manifest-select")?.addEventListener("click", () => {
      state.selectedLoadId = node.dataset.loadId || null;
      state.selectionCleared = false;
      persist();
      render();
    });
  });
}

function renderStopList() {
  if (!stopList || !stopListEmpty) return;
  const hasCargoShip = hasShipCargoGrid(currentActiveShipProfile());
  const placedEntries = getPlacedLoadEntries();
  const stops = buildUnloadStops();
  const displayStops = stops.filter((stop) => stop.placedLoads.length > 0);
  const shouldShow = hasCargoShip && placedEntries.length > 0 && displayStops.length > 0;

  if (unloadPlanPanel) {
    unloadPlanPanel.hidden = !shouldShow;
  }

  if (!shouldShow) {
    lastUnloadPlan = null;
    syncStopControls([]);
    if (unloadPlanResult) {
      unloadPlanResult.hidden = true;
      unloadPlanResult.innerHTML = "";
    }
    stopListEmpty.hidden = false;
    stopList.innerHTML = "";
    return;
  }

  syncStopControls(displayStops);
  renderUnloadPlanResult();

  stopListEmpty.hidden = displayStops.length > 0;
  stopList.innerHTML = "";

  stopList.innerHTML = displayStops
    .map((stop, index) => {
      const isSelectedStop = Boolean(state.selectedStopDropoff) && stop.dropoff === state.selectedStopDropoff;
      const analysis = stop.analysis;
      const slotSummary = stop.placedLoads
        .map(({ load }) => load.placement?.slotId)
        .filter(Boolean)
        .slice(0, 6)
        .join(", ");
      const remainingSlots = Math.max(stop.placedLoads.length - 6, 0);
      const slotText = slotSummary
        ? `${slotSummary}${remainingSlots > 0 ? ` +${remainingSlots}` : ""}`
        : cargoText("contracts.stop.nothingInShip", "Noch nichts im Schiff");
      const blockerText = formatUnloadBlockerSummary(analysis.blockers);
      const selectedWarning = isSelectedStop && blockerText
        ? `
          <div class="stop-warning">
            <strong>${escapeHtml(cargoText("contracts.stop.blockedDetailsTitle", "Diese Container blockieren die Entladung"))}</strong>
            ${renderUnloadBlockerDetails(analysis)}
          </div>
        `
        : "";
      const unloadDisabled = analysis.status !== "ready";
      const unloadTitle = unloadDisabled
        ? getStopActionHint(analysis)
        : cargoText("contracts.stop.completeTitle", "Diesen Stop als abgeschlossen markieren und alle geladenen Container daraus in die Historie verschieben.");
      const cargoGroups = buildStopCargoGroups(stop.dropoff);
      const cargoGroupRows = cargoGroups.map((group) => {
        const deliverDisabled = group.analysis.status !== "ready";
        const deliverLabel = cargoText("contracts.actions.deliverCargo", "Abliefern");
        const deliverTooltip = deliverDisabled
          ? getStopActionHint(group.analysis)
          : cargoText("contracts.stop.deliverCargo", "Nur diese Fracht am Ziel abliefern.");
        return `
          <div class="stop-cargo-row stop-cargo-status-${escapeHtml(group.analysis.status)}">
            <div class="stop-cargo-copy">
              <strong>${escapeHtml(group.label)}</strong>
              <span>${escapeHtml(group.mission.title)}</span>
            </div>
            <div class="stop-cargo-meta">
              <span>${formatScuAmount(group.totalScu)}</span>
              <span>${escapeHtml(cargoText("contracts.stop.inShip", "{placed}/{total} im Schiff", {
                placed: group.placedEntries.length,
                total: group.entries.length,
              }))}</span>
              <span>${escapeHtml(getStopStatusLabel(group.analysis.status))}</span>
            </div>
            <button
              class="secondary-button stop-cargo-deliver tooltip-button"
              type="button"
              data-dropoff="${escapeHtml(stop.dropoff)}"
              data-group-key="${escapeHtml(group.key)}"
              aria-label="${escapeHtml(`${group.label}: ${deliverLabel}`)}"
              data-tooltip="${escapeHtml(deliverTooltip)}"
              ${deliverDisabled ? "disabled" : ""}
            >
              <span class="button-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20 8.5V6.8a2 2 0 0 0-1-1.7l-6-3.4a2 2 0 0 0-2 0l-6 3.4a2 2 0 0 0-1 1.7v6.4a2 2 0 0 0 1 1.7l5 2.9" />
                  <path d="m4.3 5.8 7.7 4.4 7.7-4.4M12 10.2v8.6m4-1.8 2 2 4-4" />
                </svg>
              </span>
              <span>${escapeHtml(deliverLabel)}</span>
            </button>
          </div>
        `;
      }).join("");

      return `
        <article class="stop-item stop-status-${analysis.status}${isSelectedStop ? " is-selected-stop" : ""}">
          <div class="stop-index">${String(index + 1).padStart(2, "0")}</div>
          <div class="stop-main">
            <strong>${escapeHtml(stop.dropoff)}</strong>
            <p>${escapeHtml(stop.pickups.join(" · ") || cargoText("contracts.stop.pickupOpen", "Abholung offen"))}</p>
            <div class="stop-chips">
              <span class="stop-status-badge">${escapeHtml(getStopStatusLabel(analysis.status))}</span>
              <span>${formatScuAmount(stop.totalScu)}</span>
              <span>${escapeHtml(cargoText("contracts.stop.containerCount", "{count} Container", { count: stop.containerCount }))}</span>
              <span>${escapeHtml(cargoText("contracts.stop.inShip", "{placed}/{total} im Schiff", { placed: stop.placedLoads.length, total: stop.placeableCount }))}</span>
            </div>
            <div class="stop-cargo-groups">${cargoGroupRows}</div>
            ${selectedWarning}
          </div>
          <div class="stop-side">
            <div class="stop-slots">${escapeHtml(slotText)}</div>
            <button class="secondary-button stop-select" type="button" data-dropoff="${escapeHtml(stop.dropoff)}">
              ${escapeHtml(isSelectedStop ? cargoText("contracts.stop.active", "Aktiv") : cargoText("contracts.stop.selectNext", "Als nächstes"))}
            </button>
            <button class="secondary-button stop-unload" type="button" data-dropoff="${escapeHtml(stop.dropoff)}" title="${escapeHtml(unloadTitle)}" ${unloadDisabled ? "disabled" : ""}>
              ${escapeHtml(cargoText("contracts.route.completeStop", "Stop abschließen"))}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  stopList.querySelectorAll(".stop-select").forEach((button) => {
    button.addEventListener("click", () => {
      selectStopByDropoff(button.dataset.dropoff || "");
      persist();
      render();
    });
  });

  stopList.querySelectorAll(".stop-unload").forEach((button) => {
    button.addEventListener("click", () => {
      completeStop(button.dataset.dropoff || "");
    });
  });
  stopList.querySelectorAll(".stop-cargo-deliver").forEach((button) => {
    button.addEventListener("click", async () => {
      await deliverStopCargoGroup(button.dataset.dropoff || "", button.dataset.groupKey || "");
    });
  });
  bindUnloadGuidanceEvents(stopList);
  normalizeAppTooltipTitles(stopList);
}

function renderRouteProgress() {
  if (!routeProgressBar) return;
  const routeState = buildFlightRouteState();
  if (routeState.routeStops.length === 0) {
    routeProgressBar.hidden = true;
    routeProgressBar.innerHTML = "";
    return;
  }
  routeProgressBar.hidden = false;
  const unloadStops = buildUnloadStops();
  const currentRouteStop = routeState.currentStop;
  const currentCargoStop = currentRouteStop?.hasCargo
    ? unloadStops.find((stop) => stop.dropoff === currentRouteStop.dropoff) || null
    : null;
  const canCompleteCargo = Boolean(currentCargoStop && currentCargoStop.placeableCount > 0 && currentCargoStop.analysis.status === "ready");
  const canCompleteService = Boolean(currentRouteStop?.activeServiceMissionIds?.length);
  const completeDisabled = !currentRouteStop || (!canCompleteCargo && !canCompleteService);
  const advanceDisabled = !routeState.nextDropoff;
  const routeFinished = routeState.routeStops.length > 0 && routeState.openStops === 0;
  const serviceStopCount = routeState.routeStops.filter((stop) => stop.hasService).length;
  let routeHint = serviceStopCount > 0 || routeState.pickups.length > 0
    ? cargoText("contracts.route.fromMatching", "Route aus den passenden Auftragspunkten des aktiven Schiffs.")
    : cargoText("contracts.route.waiting", "Sobald passende Aufträge für das aktive Schiff vorhanden sind, erscheint hier deine Route.");
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (dispatcherMode) {
    routeHint = serviceStopCount > 0 || routeState.pickups.length > 0
      ? cargoText("contracts.route.dispatchFromActive", "Route aus offenen Dispositionspunkten.")
      : cargoText("contracts.route.dispatchWaiting", "Sobald offene Auftraege vorhanden sind, erscheint hier die Dispatcher-Route.");
  }
  const currentStopParts = [];
  if (currentCargoStop) {
    currentStopParts.push(`${getStopStatusLabel(currentCargoStop.analysis.status)} · ${currentCargoStop.placedLoads.length}/${currentCargoStop.placeableCount} Container im Schiff`);
  }
  if (canCompleteService) {
    currentStopParts.push(cargoText(
      currentRouteStop.activeServiceMissionIds.length === 1 ? "contracts.route.serviceOpen" : "contracts.route.serviceOpenPlural",
      "{count} Service-Aufträge offen",
      { count: currentRouteStop.activeServiceMissionIds.length },
    ));
  } else if (currentRouteStop?.hasService) {
    currentStopParts.push(cargoText("contracts.route.serviceDone", "Service erledigt"));
  }
  const currentStopText = currentStopParts.join(" · ") || (routeFinished
    ? cargoText("contracts.route.allDone", "Alle geplanten Stopps sind erledigt.")
    : cargoText("contracts.route.chooseStop", "Wähle einen Stop aus der Route."));
  const nextStopText = routeState.nextStop
    ? cargoText("contracts.route.after", "Danach: {target} · {types}", {
        target: routeState.nextStop.dropoff,
        types: [
          routeState.nextStop.hasCargo ? cargoText("contracts.route.cargo", "Fracht") : "",
          routeState.nextStop.hasService ? cargoText("contracts.route.serviceType", "Service") : "",
        ].filter(Boolean).join(" + "),
      })
    : routeState.openStops > 0
      ? cargoText("contracts.route.lastOpen", "Das ist der letzte offene Halt dieser Route.")
      : cargoText("contracts.route.allDone", "Alle geplanten Stopps sind erledigt.");
  const routePathMarkup = routeState.routePath.length > 0
    ? routeState.routePath
        .map(
          (stop, index) => `
            ${index > 0 ? '<span class="route-progress-separator" aria-hidden="true">→</span>' : ""}
            <span class="route-progress-chip is-${escapeHtml(stop.status)}">${escapeHtml(stop.dropoff)}</span>
          `,
        )
        .join("")
    : `<span class="route-progress-chip is-empty">${escapeHtml(cargoText("contracts.route.noTargets", "Noch keine Ziele"))}</span>`;

  routeProgressBar.innerHTML = `
    <article class="route-progress-card">
      <span class="route-progress-label">${escapeHtml(cargoText("contracts.route.flightRoute", "Flugroute"))}</span>
      <strong>${escapeHtml(routeState.routeStops.length > 0 ? cargoText("contracts.route.doneCount", "{done}/{total} Stopps erledigt", { done: routeState.completedStops, total: routeState.routeStops.length }) : cargoText("contracts.route.nonePlanned", "Noch keine Route geplant"))}</strong>
      <div class="route-progress-path">${routePathMarkup}</div>
      <p>${escapeHtml(routeHint)}</p>
    </article>
    <article class="route-progress-card">
      <span class="route-progress-label">${escapeHtml(cargoText("contracts.route.currentLeg", "Aktueller Flugabschnitt"))}</span>
      <strong>${escapeHtml(currentRouteStop?.dropoff || (routeFinished ? cargoText("contracts.route.completed", "Route abgeschlossen") : cargoText("contracts.route.noTarget", "Kein Ziel ausgewählt")))}</strong>
      <p>${escapeHtml(currentStopText)}</p>
      <p>${escapeHtml(nextStopText)}</p>
    </article>
    <article class="route-progress-card route-progress-actions">
      <span class="route-progress-label">${escapeHtml(cargoText("contracts.route.progress", "Fortschritt"))}</span>
      <strong>${escapeHtml(cargoText(routeState.completedStops === 1 ? "contracts.route.stopsCompleted" : "contracts.route.stopsCompletedPlural", "{count} Stops abgeschlossen", { count: routeState.completedStops }))}</strong>
      <div class="route-progress-buttons">
        <button id="routeAdvanceButton" class="secondary-button" type="button" ${advanceDisabled ? "disabled" : ""}>${escapeHtml(cargoText("contracts.route.advance", "Nächsten Halt wählen"))}</button>
        <button id="routeCompleteButton" class="primary-button" type="button" ${completeDisabled ? "disabled" : ""}>${escapeHtml(cargoText("contracts.route.completeStop", "Stop abschließen"))}</button>
      </div>
    </article>
  `;

  routeProgressBar.querySelector("#routeAdvanceButton")?.addEventListener("click", () => {
    const targetDropoff = routeState.nextDropoff;
    if (!targetDropoff) return;
    selectStopByDropoff(targetDropoff);
    persist();
    render();
  });

  routeProgressBar.querySelector("#routeCompleteButton")?.addEventListener("click", () => {
    const targetDropoff = state.selectedStopDropoff || routeState.currentDropoff;
    if (!targetDropoff) return;
    completeRouteStop(targetDropoff);
  });
}
function renderCurrentLocationControl() {
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (currentLocationForm) currentLocationForm.hidden = dispatcherMode;
  if (hubCurrentLocationControl) hubCurrentLocationControl.hidden = dispatcherMode;
  if (dispatcherMode) return;

  const location = String(state.currentLocation || "").trim();
  [hubCurrentLocationSelect, runCurrentLocationSelect].filter(Boolean).forEach((select) => {
    const suggestions = collectLocationSuggestions();
    select.innerHTML = [
      `<option value="">${escapeHtml(cargoText("hub.location.select", "Standort auswählen"))}</option>`,
      ...suggestions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    select.value = location;
  });

  if (currentLocationInput && document.activeElement !== currentLocationInput) {
    currentLocationInput.value = location;
  }
  if (clearCurrentLocationButton) clearCurrentLocationButton.disabled = !location;
  if (currentLocationHint) {
    currentLocationHint.textContent = location
      ? cargoText("contracts.route.locationActive", "Die Route beginnt bei {location}.", { location })
      : cargoText("contracts.route.locationMissing", "Lege den Ausgangspunkt fest, damit die Route dort beginnt.");
  }
}

function renderStopHistory(history = state.stopHistory) {
  if (!stopHistoryEmpty || !stopHistoryList) return;
  const entries = [...history].sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
  stopHistoryEmpty.hidden = entries.length > 0;
  stopHistoryList.innerHTML = "";

  if (entries.length === 0) {
    return;
  }

  stopHistoryList.innerHTML = entries
    .map(
      (entry) => {
        const serviceCount = Number(entry.serviceCount) || 0;
        const isServiceStop = serviceCount > 0;
        return `
          <article class="stop-history-item">
            <div class="stop-history-main">
              <strong>${escapeHtml(entry.dropoff)}</strong>
              <p>${escapeHtml(isServiceStop ? entry.note || cargoText("contracts.history.serviceDone", "Service-Stop abgeschlossen") : entry.pickups.join(" · ") || cargoText("contracts.history.pickupOpen", "Abholung offen"))}</p>
              <div class="stop-history-meta">
                <span>${escapeHtml(isServiceStop
                  ? cargoText(serviceCount === 1 ? "contracts.history.serviceCount" : "contracts.history.serviceCountPlural", "{count} Service-Aufträge", { count: serviceCount })
                  : cargoText("contracts.stop.containerCount", "{count} Container", { count: entry.loadCount }))}</span>
                <span>${formatScuAmount(entry.scu)}</span>
                <span>${escapeHtml(formatDateTimeDisplay(entry.completedAt))}</span>
              </div>
            </div>
            <div class="stop-history-side">
              <span>${escapeHtml(entry.missionTitles.join(" · ") || cargoText("contracts.history.fallbackMission", "Auftrag"))}</span>
            </div>
          </article>
        `;
      },
    )
    .join("");
}

function registerCargoOverviewEvents() {
  overviewDeselectButton?.addEventListener("click", () => {
    state.selectedLoadId = null;
    state.selectionCleared = true;
    persist();
    render();
  });

  nextStopSelect?.addEventListener("change", () => {
    selectStopByDropoff(nextStopSelect.value);
    lastUnloadPlan = null;
    persist();
    render();
  });

  currentLocationForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const location = String(currentLocationInput?.value || "").trim();
    state.currentLocation = location;
    consumeRunRoutePriority(location);
    lastUnloadPlan = null;
    closeLocationPicker();
    persist();
    render();
  });

  hubCurrentLocationSelect?.addEventListener("change", () => {
    state.currentLocation = String(hubCurrentLocationSelect.value || "").trim();
    consumeRunRoutePriority(state.currentLocation);
    lastUnloadPlan = null;
    closeLocationPicker();
    persist();
    render();
  });

  clearCurrentLocationButton?.addEventListener("click", () => {
    state.currentLocation = "";
    if (currentLocationInput) currentLocationInput.value = "";
    lastUnloadPlan = null;
    closeLocationPicker();
    persist();
    render();
  });

  suggestUnloadPlanButton?.addEventListener("click", () => {
    lastUnloadPlan = computeUnloadPlan({ activateFirst: true });
    persist();
    render();
  });
}
