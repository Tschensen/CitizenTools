// Flight plan and cockpit presentation, pickup dialogs and user actions.
let lastRunAutoLoadResult = null;

function renderRunWaypoints(runState) {
  const root = document.getElementById("runWaypoints");
  if (!root) return;
  const openLocations = new Set(runState.openPoints.map((point) => normalizeRunRouteLocation(point.dropoff)));
  const completed = runState.points.filter((point) => point.completed && !openLocations.has(normalizeRunRouteLocation(point.dropoff)));
  const open = runState.openPoints;
  const focus = runState.selectedPoint;
  const upcoming = open.filter((point) => point !== focus);
  const preview = [...completed.slice(-1), ...(focus ? [focus] : []), ...upcoming.slice(0, 2)];
  const remaining = Math.max(0, upcoming.length - 2);
  root.innerHTML = preview.map((point) => {
    const current = point === focus;
    const label = point.completed ? t("run.waypoint.done")
      : current ? t(runState.arrived ? "run.waypoint.arrived" : "run.waypoint.target") : t("run.waypoint.next");
    return `<li class="run-waypoint${point.completed ? " is-done" : current ? " is-current" : ""}"${current ? ' aria-current="step"' : ""}>
      <span class="run-waypoint-marker" aria-hidden="true">${point.completed ? "✓" : "•"}</span>
      <span class="run-waypoint-copy"><small>${escapeHtml(label)}</small><strong title="${escapeHtml(point.dropoff)}">${escapeHtml(point.dropoff)}</strong></span>
    </li>`;
  }).join("") + (remaining ? `<li class="run-waypoint-more">${escapeHtml(t("run.waypoint.more", { count: remaining }))}</li>` : "");
}

function renderRunTaskIcon(kind) {
  const paths = {
    pickup: '<path d="M12 3v12m0 0-5-5m5 5 5-5M5 19h14v2H5v-2Z" />',
    delivery: '<path d="M12 21V9m0 0-5 5m5-5 5 5M5 3h14v2H5V3Z" />',
    service: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z" />',
  };
  return `<span class="run-task-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${paths[kind] || paths.service}</svg></span>`;
}

function renderRunMissionState(runState, activeShip) {
  if (!runMissionPanel || !runMissionList || !runMissionSummary) return;
  const missionStates = runState.missionStates || [];
  runMissionPanel.hidden = !activeShip || missionStates.length === 0;
  if (runMissionPanel.hidden) {
    runMissionList.innerHTML = "";
    return;
  }

  const readyCount = missionStates.filter(({ readiness }) => readiness.routeEligible).length;
  const blockedCount = missionStates.length - readyCount;
  runMissionSummary.textContent = cargoText("run.missions.summary", "{ready} im Flugplan · {blocked} nicht berücksichtigt", {
    ready: readyCount,
    blocked: blockedCount,
  });
  runMissionList.innerHTML = missionStates.map(({ mission, readiness }) => {
    const stateLabel = readiness.status === "ready"
      ? cargoText("run.missions.ready", "Im Flugplan")
      : readiness.status === "warning"
        ? cargoText("run.missions.warning", "Angaben fehlen")
        : readiness.status === "blocked"
          ? cargoText("run.missions.blocked", "Nicht ausführbar")
          : cargoText("run.missions.otherShip", "Anderes Schiff");
    return `
      <article class="run-mission-row is-${escapeHtml(readiness.status)}">
        <span class="run-mission-marker" aria-hidden="true"></span>
        <div class="run-mission-copy">
          <strong>${escapeHtml(mission.title || cargoText("contracts.untitled", "Unbenannter Auftrag"))}</strong>
          <p>${escapeHtml(`${getMissionTypeLabel(mission)} · ${summarizeMissionRoute(mission)}`)}</p>
          ${readiness.message ? `<small>${escapeHtml(readiness.message)}</small>` : ""}
        </div>
        <span class="run-mission-state">${escapeHtml(stateLabel)}</span>
      </article>
    `;
  }).join("");
}
function renderRunManifest(runState, activeShip) {
  if (!runManifestPanel || !runOnBoardList || !runWaitingList || !runWaitingSection) return;
  const cargoState = getActiveCargoCapacityState();
  runManifestPanel.hidden = !activeShip || !cargoState.hasCargo;
  if (runManifestPanel.hidden) return;

  const fleetEntryId = activeShip.id || getCurrentCargoGridFleetEntryId();
  const onBoardEntries = getPlacedLoadEntries({ fleetEntryId });
  const onBoardScu = onBoardEntries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0);
  runManifestSummary.textContent = cargoText("run.manifest.summary", "{count} Container · {used} von {capacity} belegt", {
    count: onBoardEntries.length,
    used: formatScuAmount(onBoardScu),
    capacity: formatScuAmount(cargoState.totalCapacity),
  });

  const currentTarget = runState.selectedPoint?.dropoff || "";
  const canUnloadHere = Boolean(runState.arrived && runState.selectedPoint?.hasCargo);
  runOnBoardList.innerHTML = onBoardEntries.length > 0
    ? onBoardEntries.map(({ mission, load }) => {
        const destination = getLoadDropoff(load, mission);
        const unloadHere = canUnloadHere && destination === currentTarget;
        const slot = load.placement?.slotId || "";
        return `
          <article class="run-manifest-row${unloadHere ? " is-unload" : ""}">
            <div class="run-manifest-copy">
              <strong>${escapeHtml(load.label)}</strong>
              <p>${escapeHtml(`${mission.title} · ${formatScuAmount(load.scu)}${slot ? ` · ${slot}` : ""}`)}</p>
            </div>
            <span>${escapeHtml(unloadHere
              ? cargoText("run.manifest.unloadHere", "Hier entladen")
              : cargoText("run.manifest.keepOnBoard", "Bleibt an Bord bis {target}", { target: destination || cargoText("common.notSpecified", "Nicht angegeben") }))}</span>
          </article>
        `;
      }).join("")
    : `<p class="empty-state">${escapeHtml(cargoText("run.manifest.emptyOnBoard", "Der Frachtraum ist leer."))}</p>`;

  const currentLocation = String(runState.currentLocation || "").trim();
  const waitingLoads = currentLocation
    ? getAllLoads().filter(({ mission, load }) => (
        isMissionActive(mission)
        && isMissionAssignedToCurrentActiveShip(mission)
        && !load.placement
        && getLoadPickup(load, mission) === currentLocation
      ))
    : [];
  const pendingHere = (runState.missionStates || []).flatMap(({ mission }) =>
    isMissionAssignedToCurrentActiveShip(mission) ? getMissionSegments(mission)
      .filter((segment) => Boolean(segment.quantityPending) && String(segment.pickup || mission.pickup || "").trim() === currentLocation)
      .map((segment) => ({ mission, segment })) : [],
  );
  runWaitingSection.hidden = waitingLoads.length === 0 && pendingHere.length === 0;
  runWaitingList.innerHTML = [
    ...pendingHere.map(({ mission, segment }) => `
      <article class="run-manifest-row is-warning">
        <div class="run-manifest-copy">
          <strong>${escapeHtml(segment.title || mission.title)}</strong>
          <p>${escapeHtml(mission.title)}</p>
        </div>
        <span>${escapeHtml(cargoText("run.manifest.amountOpen", "Menge offen"))}</span>
      </article>
    `),
    ...waitingLoads.map(({ mission, load }) => `
      <article class="run-manifest-row">
        <div class="run-manifest-copy">
          <strong>${escapeHtml(load.label)}</strong>
          <p>${escapeHtml(`${mission.title} · ${formatScuAmount(load.scu)}`)}</p>
        </div>
        <span>${escapeHtml(cargoText("run.manifest.waiting", "Noch zu verladen"))}</span>
      </article>
    `),
  ].join("");
}

function showRunQuantityDialog(mission, segment) {
  if (!runQuantityDialog || !runQuantityDialogForm || !runQuantityDialogInput || !runQuantityDialogCancel) {
    return Promise.resolve(null);
  }
  hideAppTooltip(true);
  runQuantityDialogMission.textContent = `${mission.title} · ${segment.title || cargoText("run.tasks.pickup", "Fracht abholen")} · ${segment.pickup} → ${segment.dropoff}`;
  const cargoState = getActiveCargoCapacityState();
  const maxProfile = getCurrentShipMaxContainerProfile();
  runQuantityDialogHint.textContent = cargoText("run.quantity.hint", "Freier Frachtraum: {free} · Max. Container: {max}", {
    free: formatScuAmount(cargoState.freeCapacity),
    max: maxProfile?.label || cargoText("common.notSpecified", "Nicht angegeben"),
  });
  runQuantityDialogInput.value = Number(segment.expectedCargoScu) > 0 ? String(Math.round(Number(segment.expectedCargoScu))) : "";
  runQuantityDialog.hidden = false;
  runQuantityDialogInput.focus();
  runQuantityDialogInput.select();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      runQuantityDialog.hidden = true;
      resolve(value);
    };
    const handleSubmit = (event) => {
      event.preventDefault();
      const amount = Number(runQuantityDialogInput.value);
      if (!Number.isInteger(amount) || amount <= 0) {
        runQuantityDialogInput.setCustomValidity(cargoText("run.quantity.invalid", "Bitte trage eine volle SCU-Menge größer als 0 ein."));
        runQuantityDialogInput.reportValidity();
        return;
      }
      runQuantityDialogInput.setCustomValidity("");
      finish(amount);
    };
    const handleCancel = () => finish(null);
    const handleBackdrop = (event) => {
      if (event.target === runQuantityDialog) finish(null);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };
    const cleanup = () => {
      runQuantityDialogForm.removeEventListener("submit", handleSubmit);
      runQuantityDialogCancel.removeEventListener("click", handleCancel);
      runQuantityDialog.removeEventListener("click", handleBackdrop);
      document.removeEventListener("keydown", handleKeydown);
    };
    runQuantityDialogForm.addEventListener("submit", handleSubmit);
    runQuantityDialogCancel.addEventListener("click", handleCancel);
    runQuantityDialog.addEventListener("click", handleBackdrop);
    document.addEventListener("keydown", handleKeydown);
  });
}

function applyRunPickupQuantity(mission, segment, targetScu) {
  const groups = buildContainerGroupsForScu(targetScu, mission.maxContainerScu);
  const segmentIndex = Array.isArray(mission.segments)
    ? mission.segments.findIndex((candidate) => candidate.id === segment.id)
    : -1;
  if (groups.length === 0 || segmentIndex < 0) return false;

  const nextSegments = groups.map((group, groupIndex) => {
    const container = parseCargoContainerValue(group.containerSize);
    return {
      ...segment,
      id: createRuntimeId(),
      quantity: group.quantity,
      containerSize: container.key,
      width: container.width,
      depth: container.depth,
      height: container.height,
      isHandheld: container.isHandheld,
      isPlaceable: container.isPlaceable,
      scuPerLoad: container.scu,
      totalScu: container.scu * group.quantity,
      routeTargetScu: targetScu,
      expectedCargoScu: Number(segment.expectedCargoScu) || targetScu,
      quantityPending: false,
      cargoGroupIndex: (Number(segment.cargoGroupIndex) || 0) + groupIndex,
      order: (Number(segment.order) || 0) + groupIndex,
    };
  });
  mission.segments.splice(segmentIndex, 1, ...nextSegments);
  mission.loads = [...(Array.isArray(mission.loads) ? mission.loads : []), ...createLoadsFromConsignments(nextSegments)];
  mission.updatedAt = new Date().toISOString();
  lastRunAutoLoadResult = null;
  persist();
  render();
  return true;
}

function renderRunMode() {
  if (!runContent || !runEmptyState || !runRouteList) return;
  const activeShip = currentActiveFleetEntry();
  const runState = buildRunRouteState();
  const totalPoints = runState.progressTotal;
  const progressPercent = totalPoints > 0 ? Math.round((runState.completedCount / totalPoints) * 100) : 0;

  runShipName.textContent = activeShip
    ? `${activeShip.manufacturer} ${activeShip.model}`.trim()
    : cargoText("run.ship.none", "Kein aktives Schiff");
  runShipRegistration.textContent = activeShip ? formatFleetRegistration(activeShip) : FLEET_REGISTRATION_PLACEHOLDER;

  const noShip = !activeShip;
  const noRoute = !noShip && totalPoints === 0;
  renderRunMissionState(runState, activeShip);
  renderRunManifest(runState, activeShip);
  runEmptyState.hidden = !noShip && !noRoute;
  runContent.hidden = noShip;
  if (runFocusPanel) runFocusPanel.hidden = noRoute;
  if (runRoutePanel) runRoutePanel.hidden = noRoute;
  if (noShip || noRoute) {
    if (runAutoloadOptions) runAutoloadOptions.hidden = true;
    runEmptyTitle.textContent = noShip
      ? cargoText("run.empty.noShipTitle", "Kein aktives Schiff")
      : cargoText("run.empty.noRouteTitle", "Noch kein ausführbarer Einsatz");
    runEmptyText.textContent = noShip
      ? cargoText("run.empty.noShipText", "Wähle zuerst ein aktives Schiff in deiner Flotte.")
      : cargoText("run.empty.noRouteText", "Für das aktive Schiff sind derzeit keine passenden offenen Auftragspunkte vorhanden. Prüfe die Auftragslage.");
    runEmptyAction.textContent = noShip
      ? cargoText("run.empty.openFleet", "Zur Flotte")
      : cargoText("run.empty.openContracts", "Zu den Aufträgen");
    runEmptyAction.dataset.target = noShip ? "fleet" : "overview";
    return;
  }

  runProgressText.textContent = t("run.progress.stops", {
    done: runState.completedCount,
    total: totalPoints,
    percent: progressPercent,
  });
  runProgressFill.style.width = `${progressPercent}%`;
  const progressTrack = runProgressFill.parentElement;
  progressTrack.setAttribute("aria-valuenow", String(progressPercent));
  progressTrack.setAttribute("aria-valuetext", runProgressText.textContent);
  renderRunWaypoints(runState);
  runRouteSummary.textContent = runState.priorityLocation
    ? cargoText("run.route.summaryPriority", "{open} offen · Priorität: {location}", {
        open: runState.openPoints.length,
        location: runState.priorityLocation,
      })
    : cargoText("run.route.summary", "{open} offen · {done} erledigt", {
        open: runState.openPoints.length,
        done: runState.completedCount,
      });

  const point = runState.selectedPoint;
  const routeCompleted = !point;
  runTargetEyebrow.textContent = routeCompleted
    ? cargoText("run.target.completed", "Einsatz abgeschlossen")
    : runState.arrived
      ? cargoText("run.target.current", "Aktueller Halt")
      : cargoText("run.target.next", "Nächstes Ziel");
  runTargetName.textContent = point?.dropoff || cargoText("run.target.completed", "Einsatz abgeschlossen");
  const selectedRouteReason = getRunRouteReasonLabels(point).join(" · ");
  const targetMeta = routeCompleted
    ? cargoText("run.target.completedText", "Alle Punkte dieser Route sind erledigt.")
    : runState.arrived
      ? cargoText("run.target.arrived", "Du bist am Ziel. Die passenden Aktionen sind jetzt verfügbar.")
      : cargoText("run.target.leg", "{start} → {target}", {
          start: runState.currentLocation || cargoText("run.location.open", "Standort offen"),
          target: point.dropoff,
        });
  runTargetMeta.textContent = selectedRouteReason && !routeCompleted
    ? `${targetMeta} · ${selectedRouteReason}`
    : targetMeta;

  const stopStatus = getRunStopStatus(runState);
  if (runFocusSummary) {
    runFocusSummary.textContent = `${point?.dropoff || cargoText("run.target.completed", "Einsatz abgeschlossen")} · ${stopStatus.title}`;
  }
  if (runStopStatus && runStopStatusTitle && runStopStatusText) {
    runStopStatus.className = `run-stop-status is-${stopStatus.tone}`;
    runStopStatusTitle.textContent = stopStatus.title;
    runStopStatusText.textContent = stopStatus.text;
  }

  const tasks = [];
  runState.courierPickupEntries.forEach(({ mission, package: courierPackage }) => {
    tasks.push(`
      <article class="run-task-row">
        ${renderRunTaskIcon("pickup")}
        <div class="run-task-copy">
          <strong>${escapeHtml(`${courierPackage.quantity} × ${courierPackage.name}`)}</strong>
          <p>${escapeHtml(`${mission.title} · ${courierPackage.destination}`)}</p>
        </div>
        <button class="secondary-button run-courier-pickup" type="button" data-mission-id="${escapeHtml(mission.id)}" data-package-id="${escapeHtml(courierPackage.id)}" ${runState.arrived ? "" : "disabled"}>${escapeHtml(cargoText("run.actions.collectPackage", "Paket aufnehmen"))}</button>
      </article>
    `);
  });
  runState.courierDeliveryEntries.forEach(({ mission, package: courierPackage }) => {
    tasks.push(`
      <article class="run-task-row">
        ${renderRunTaskIcon("delivery")}
        <div class="run-task-copy">
          <strong>${escapeHtml(`${courierPackage.quantity} × ${courierPackage.name}`)}</strong>
          <p>${escapeHtml(`${mission.title} · ${courierPackage.pickup}`)}</p>
        </div>
        <button class="secondary-button run-courier-delivery" type="button" data-mission-id="${escapeHtml(mission.id)}" data-package-id="${escapeHtml(courierPackage.id)}" ${runState.arrived ? "" : "disabled"}>${escapeHtml(cargoText("run.actions.deliverPackage", "Paket übergeben"))}</button>
      </article>
    `);
  });
  if (point?.hasPickup) {
    runState.pendingPickupSegments.forEach(({ mission, segment }) => {
      tasks.push(`
        <article class="run-task-row is-warning">
          ${renderRunTaskIcon("pickup")}
          <div class="run-task-copy">
            <strong>${escapeHtml(segment.title || mission.title)}</strong>
            <p>${escapeHtml(cargoText("run.tasks.pickupOpenForMission", "{mission} · Abholmenge offen", { mission: mission.title }))}</p>
          </div>
          <button class="secondary-button run-enter-quantity" type="button" data-mission-id="${escapeHtml(mission.id)}" data-segment-id="${escapeHtml(segment.id)}" ${runState.arrived ? "" : "disabled"}>${escapeHtml(cargoText("run.actions.enterAmount", "Menge eintragen"))}</button>
        </article>
      `);
    });
    if (runState.pickupEntries.length > 0) {
      const totalScu = runState.pickupEntries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0);
      tasks.push(`
        <article class="run-task-row">
          ${renderRunTaskIcon("pickup")}
          <div class="run-task-copy">
            <strong>${escapeHtml(cargoText("run.tasks.pickup", "Fracht abholen"))}</strong>
            <p>${escapeHtml(cargoText("run.tasks.pickupDetail", "{placed}/{total} Container · {scu}", {
              placed: runState.placedPickupEntries.length,
              total: runState.pickupEntries.length,
              scu: formatScuAmount(totalScu),
            }))}</p>
          </div>
          <span class="run-task-status${runState.arrived ? " is-ready" : ""}">${escapeHtml(runState.arrived
            ? cargoText("run.tasks.ready", "bereit")
            : cargoText("run.tasks.pendingArrival", "Anreise"))}</span>
        </article>
      `);
    }
  }
  runState.cargoGroups.forEach((group) => {
    const ready = runState.arrived && group.analysis.status === "ready";
    const statusKey = ["ready", "not-loaded", "incomplete", "partial", "blocked"].includes(group.analysis.status)
      ? group.analysis.status
      : "blocked";
    tasks.push(`
      <article class="run-task-row${statusKey === "ready" ? "" : " is-warning"}">
        ${renderRunTaskIcon("delivery")}
        <div class="run-task-copy">
          <strong>${escapeHtml(group.label)}</strong>
          <p>${escapeHtml(cargoText("run.tasks.deliveryDetail", "{placed}/{total} Container · {scu}", {
            placed: group.placedEntries.length,
            total: group.entries.length,
            scu: formatScuAmount(group.totalScu),
          }))}</p>
        </div>
        <button class="secondary-button run-deliver-group" type="button" data-dropoff="${escapeHtml(group.dropoff)}" data-group-key="${escapeHtml(group.key)}" ${ready ? "" : "disabled"}>${escapeHtml(cargoText(`run.delivery.${statusKey}`, statusKey === "ready" ? "Entladen" : "Nicht bereit"))}</button>
      </article>
    `);
  });
  if (point?.hasService) {
    const activeServiceCount = runState.routeStop?.activeServiceMissionIds?.length || 0;
    tasks.push(`
      <article class="run-task-row">
        ${renderRunTaskIcon("service")}
        <div class="run-task-copy">
          <strong>${escapeHtml(cargoText("run.tasks.service", "Einsatz durchführen"))}</strong>
          <p>${escapeHtml((runState.routeStop?.serviceSummaries || []).join(" · ") || (point.missionTitles || []).join(" · "))}</p>
        </div>
        <span class="run-task-status${runState.arrived && activeServiceCount > 0 ? " is-ready" : ""}">${escapeHtml(activeServiceCount > 0
          ? runState.arrived ? cargoText("run.tasks.ready", "bereit") : cargoText("run.tasks.pendingArrival", "Anreise")
          : cargoText("run.tasks.done", "erledigt"))}</span>
      </article>
    `);
  }
  if (point && lastRunAutoLoadResult?.pointKey === point.key) {
    const baseResultText = lastRunAutoLoadResult.placedCount > 0
      ? lastRunAutoLoadResult.skippedCount > 0
        ? cargoText("run.autoload.partial", "{placed} verladen · {skipped} passen nicht mehr in das Schiff", {
            placed: lastRunAutoLoadResult.placedCount,
            skipped: lastRunAutoLoadResult.skippedCount,
          })
        : cargoText("run.autoload.success", "{placed} Container automatisch verladen", {
            placed: lastRunAutoLoadResult.placedCount,
          })
      : cargoText("run.autoload.failed", "Kein Container konnte passend platziert werden.");
    const resultText = formatAutoloadResultWithOverload(lastRunAutoLoadResult, baseResultText);
    tasks.push(`<p class="run-action-result${lastRunAutoLoadResult.skippedCount > 0 || lastRunAutoLoadResult.overloadCount > 0 ? " is-warning" : " is-success"}">${escapeHtml(resultText)}</p>`);
  }
  runTaskList.innerHTML = tasks.join("") || `<p class="empty-state">${escapeHtml(cargoText("run.tasks.none", "Für diesen Halt gibt es keine offene Aktion."))}</p>`;

  runArriveButton.hidden = routeCompleted || runState.arrived;
  runArriveButton.disabled = routeCompleted;
  runArriveButton.dataset.pointKey = point?.key || "";
  const unplacedPickupCount = runState.pickupEntries.length - runState.placedPickupEntries.length;
  runOpenLoadButton.hidden = !point?.hasPickup || runState.pickupEntries.length === 0 || !canUseLoadPage();
  runOpenLoadButton.disabled = !runState.arrived;
  runAutoLoadButton.hidden = !point?.hasPickup || runState.pickupEntries.length === 0 || !canUseLoadPage();
  runAutoLoadButton.disabled = !runState.arrived || unplacedPickupCount <= 0;
  if (runAutoloadOptions) runAutoloadOptions.hidden = runAutoLoadButton.hidden;
  renderRunAutoloadAreas(runState.pickupEntries);
  runCompletePickupButton.hidden = !point?.hasPickup;
  runCompletePickupButton.disabled = !runState.arrived || runState.pendingPickupSegments.length > 0;
  if (runState.pendingPickupSegments.length > 0) {
    runCompletePickupButton.dataset.tooltip = cargoText("run.warning.completeNeedsAmount", "Trage zuerst alle offenen Abholmengen ein.");
  } else {
    delete runCompletePickupButton.dataset.tooltip;
  }
  runCompletePickupButton.removeAttribute("title");
  runCompletePickupButton.dataset.pointKey = point?.key || "";
  const pointMissionIds = new Set(point?.missionIds || []);
  const cargoStop = point?.hasCargo
    ? buildUnloadStops({
        missionFilter: (mission) => runState.eligibleMissionIds.has(mission.id) && pointMissionIds.has(mission.id),
      }).find((stop) => stop.dropoff === point.dropoff) || null
    : null;
  const canCompleteCargo = Boolean(cargoStop && cargoStop.placeableCount > 0 && cargoStop.analysis.status === "ready");
  const canCompleteService = Boolean(runState.routeStop?.activeServiceMissionIds?.length);
  runCompleteStopButton.hidden = !point || (!point.hasCargo && !point.hasService);
  runCompleteStopButton.disabled = !runState.arrived || (!canCompleteCargo && !canCompleteService);
  runCompleteStopButton.dataset.dropoff = point?.dropoff || "";
  runCompleteStopButton.textContent = canCompleteCargo
    ? point?.hasService
      ? cargoText("run.actions.unloadCargo", "Fracht entladen")
      : cargoText("run.actions.unloadAll", "Alle Lieferungen entladen")
    : canCompleteService
      ? cargoText("run.actions.completeService", "Einsatz abschließen")
      : cargoText("run.actions.stopBlocked", "Halt noch offen");
  runActionBar.hidden = routeCompleted;

  runRouteList.innerHTML = runState.points.map((routePoint) => {
    const isCurrent = routePoint.key === point?.key;
    const status = routePoint.completed ? "completed" : isCurrent ? "current" : "upcoming";
    const typeLabel = getRunRoutePointTypeLabels(routePoint).join(" + ");
    const reasonLabel = getRunRouteReasonLabels(routePoint).join(" · ");
    const isPriority = Boolean(
      runState.priorityLocation
      && normalizeRunRouteLocation(runState.priorityLocation) === normalizeRunRouteLocation(routePoint.dropoff),
    );
    return `
      <div class="run-route-row is-${status}${isPriority ? " is-priority" : ""}" ${!routePoint.completed ? `data-route-order-index="${runState.openPoints.indexOf(routePoint)}"` : ""}>
        <button class="run-route-select" type="button" data-run-point-key="${escapeHtml(routePoint.key)}" ${routePoint.completed ? "disabled" : ""}>
          <span class="run-route-index">${routePoint.completed ? "✓" : runState.openPoints.indexOf(routePoint) + 1}</span>
          <span class="run-route-copy">
            <strong>${escapeHtml(routePoint.dropoff)}</strong>
            <small>${escapeHtml(typeLabel)}</small>
            ${reasonLabel && !routePoint.completed ? `<small class="run-route-reason">${escapeHtml(reasonLabel)}</small>` : ""}
          </span>
        </button>
        ${!routePoint.completed ? `
          ${renderRunRouteOrderControls(runState.openPoints, runState.openPoints.indexOf(routePoint))}
        ` : routePoint.hasPickup && routePoint.missionIds.some((id) => runState.eligibleMissionIds.has(id)) ? `
          <button class="run-route-reopen icon-only-button tooltip-button" type="button" data-run-reopen-key="${escapeHtml(routePoint.key)}" data-run-reopen-task-keys="${escapeHtml((routePoint.pickupTaskKeys || []).join(","))}" data-run-reopen-location="${escapeHtml(routePoint.dropoff)}" data-run-reopen-mission-ids="${escapeHtml((routePoint.missionIds || []).join(","))}" aria-label="${escapeHtml(cargoText("run.actions.reopenPickup", "Abholung wieder öffnen"))}" data-tooltip="${escapeHtml(cargoText("run.actions.reopenPickup", "Abholung wieder öffnen"))}">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 5v5h5M5.6 9A7 7 0 1 1 6 16l1.7-1A5 5 0 1 0 7 10.4L10 13H3V6l2.6 3Z" /></svg>
          </button>
        ` : ""}
      </div>
    `;
  }).join("");

  bindRunRouteOrdering(runState);
  runRouteList.querySelectorAll("[data-run-point-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRunRoutePointKey = button.dataset.runPointKey || "";
      const selected = buildRunRouteState().selectedPoint;
      if (selected && (selected.hasCargo || selected.hasService)) selectStopByDropoff(selected.dropoff);
      persist();
      render();
    });
  });
  runRouteList.querySelectorAll("[data-run-reopen-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.runReopenKey || "";
      const pickupTaskKeys = new Set(String(button.dataset.runReopenTaskKeys || "").split(",").filter(Boolean));
      const missionIds = String(button.dataset.runReopenMissionIds || "").split(",").filter(Boolean);
      const location = button.dataset.runReopenLocation || "";
      state.runCompletedRoutePoints = (state.runCompletedRoutePoints || []).filter((value) => (
        value !== key
        && !pickupTaskKeys.has(value)
        && !missionIds.some((missionId) => isLegacyRunPickupCompletionKey(value, missionId, location))
      ));
      state.selectedRunRoutePointKey = key;
      persist();
      render();
    });
  });
  runTaskList.querySelectorAll(".run-deliver-group").forEach((button) => {
    button.addEventListener("click", async () => {
      await deliverStopCargoGroup(button.dataset.dropoff || "", button.dataset.groupKey || "");
    });
  });
  runTaskList.querySelectorAll(".run-enter-quantity").forEach((button) => {
    button.addEventListener("click", async () => {
      const mission = state.missions.find((entry) => entry.id === button.dataset.missionId);
      const segment = mission?.segments?.find((entry) => entry.id === button.dataset.segmentId);
      if (!mission || !segment || !segment.quantityPending) return;
      const amount = await showRunQuantityDialog(mission, segment);
      if (amount !== null) applyRunPickupQuantity(mission, segment, amount);
    });
  });
  runTaskList.querySelectorAll(".run-courier-pickup").forEach((button) => {
    button.addEventListener("click", () => {
      const mission = state.missions.find((entry) => entry.id === button.dataset.missionId);
      const courierPackage = mission?.serviceDetails?.packages?.find((entry) => String(entry.id) === button.dataset.packageId);
      if (!mission || !courierPackage || courierPackage.pickedUpAt || courierPackage.deliveredAt) return;
      courierPackage.pickedUpAt = new Date().toISOString();
      mission.updatedAt = courierPackage.pickedUpAt;
      state.selectedRunRoutePointKey = "";
      persist();
      render();
    });
  });
  runTaskList.querySelectorAll(".run-courier-delivery").forEach((button) => {
    button.addEventListener("click", async () => {
      const mission = state.missions.find((entry) => entry.id === button.dataset.missionId);
      const courierPackage = mission?.serviceDetails?.packages?.find((entry) => String(entry.id) === button.dataset.packageId);
      if (!mission || !courierPackage || !courierPackage.pickedUpAt || courierPackage.deliveredAt) return;
      const confirmed = await showMissionConfirmDialog({
        kicker: cargoText("run.dialog.kicker", "Einsatzmodus"),
        title: cargoText("run.dialog.deliverPackageTitle", "Paket übergeben?"),
        message: cargoText("run.dialog.deliverPackageMessage", "{package} am aktuellen Ziel als übergeben markieren?", { package: courierPackage.name }),
        confirmLabel: cargoText("run.actions.deliverPackage", "Paket übergeben"),
      });
      if (!confirmed) return;
      courierPackage.deliveredAt = new Date().toISOString();
      mission.updatedAt = courierPackage.deliveredAt;
      const missionProgressComplete = normalizeMissionType(mission.type) === "delivery"
        ? canAutoCompleteMissionProgress(mission)
        : mission.serviceDetails.packages.every((entry) => entry.deliveredAt);
      if (missionProgressComplete) {
        markMissionCompleted(mission, { completedAt: courierPackage.deliveredAt });
      }
      state.selectedRunRoutePointKey = "";
      persist();
      render();
    });
  });
  normalizeAppTooltipTitles(runRouteList);
}

function registerRunModeEvents() {
  runCurrentLocationSelect?.addEventListener("change", () => {
    state.currentLocation = String(runCurrentLocationSelect.value || "").trim();
    consumeRunRoutePriority(state.currentLocation);
    lastUnloadPlan = null;
    persist();
    render();
  });

  runShipButton?.addEventListener("click", () => setActivePage("fleet"));

  runEmptyAction?.addEventListener("click", () => {
    setActivePage(runEmptyAction.dataset.target || "overview");
  });

  runArriveButton?.addEventListener("click", () => {
    const runState = buildRunRouteState();
    const point = runState.selectedPoint;
    if (!point) return;
    state.selectedRunRoutePointKey = point.key;
    state.currentLocation = point.dropoff;
    consumeRunRoutePriority(point.dropoff);
    if (point.hasCargo || point.hasService) selectStopByDropoff(point.dropoff);
    lastUnloadPlan = null;
    persist();
    render();
  });

  runOpenLoadButton?.addEventListener("click", () => {
    const runState = buildRunRouteState();
    const firstOpenLoad = runState.pickupEntries.find(({ mission, load }) => !isLoadPlacementInCurrentLayout(load, mission));
    if (firstOpenLoad) {
      state.selectedLoadId = firstOpenLoad.load.id;
      state.selectionCleared = false;
      persist();
    }
    setActivePage("load");
  });

  runAutoLoadButton?.addEventListener("click", () => {
    const runState = buildRunRouteState();
    const point = runState.selectedPoint;
    if (!point?.hasPickup || !runState.arrived) return;
    const result = autoLoadEntries(runState.pickupEntries.filter(({ mission, load }) => (
      !load.placement && getLoadPickup(load, mission) === point.dropoff
    )), {
      persistAfter: false,
      renderAfter: false,
      settings: getAutoloadSettings(),
    });
    lastRunAutoLoadResult = { ...result, pointKey: point.key };
    persist();
    render();
  });

  runCompletePickupButton?.addEventListener("click", async () => {
    const runState = buildRunRouteState();
    const point = runState.selectedPoint;
    if (!point?.hasPickup || !runState.arrived || runState.pendingPickupSegments.length > 0) return;
    const incomplete = runState.pickupEntries.length === 0 || runState.placedPickupEntries.length < runState.pickupEntries.length;
    if (incomplete) {
      const confirmed = await showMissionConfirmDialog({
        kicker: cargoText("run.dialog.kicker", "Einsatzmodus"),
        title: cargoText("run.dialog.pickupIncompleteTitle", "Abholung trotzdem abschließen?"),
        message: runState.pickupEntries.length === 0
          ? cargoText("run.dialog.pickupAmountOpen", "Für diese Abholung ist noch keine konkrete Frachtmenge hinterlegt.")
          : cargoText("run.dialog.pickupIncomplete", "Erst {placed} von {total} Containern sind im aktuellen Schiff verladen.", {
              placed: runState.placedPickupEntries.length,
              total: runState.pickupEntries.length,
            }),
        confirmLabel: cargoText("run.actions.completePickup", "Abholung erledigt"),
      });
      if (!confirmed) return;
    }
    const pickupTaskKeys = point.pickupTaskKeys?.length ? point.pickupTaskKeys : [point.key];
    state.runCompletedRoutePoints = [...new Set([...(state.runCompletedRoutePoints || []), ...pickupTaskKeys])];
    state.selectedRunRoutePointKey = "";
    persist();
    render();
  });

  runCompleteStopButton?.addEventListener("click", async () => {
    const dropoff = runCompleteStopButton.dataset.dropoff || "";
    if (!dropoff) return;
    const runState = buildRunRouteState();
    const missionIds = runState.selectedPoint?.dropoff === dropoff
      ? runState.selectedPoint.missionIds || []
      : [];
    await completeRouteStop(dropoff, { missionIds });
  });
}
