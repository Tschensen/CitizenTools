// Current-route planning, unload guidance, and stop completion UI.
function buildUnloadStops({ missionFilter = null } = {}) {
  const stops = new Map();

  getAllLoads()
    .filter(({ mission }) => typeof missionFilter !== "function" || missionFilter(mission))
    .forEach(({ mission, load }) => {
    const dropoff = String(getLoadDropoff(load, mission) || "Ziel offen").trim();
    if (!stops.has(dropoff)) {
      const missionIndex = state.missions.findIndex((candidate) => candidate.id === mission.id);
      const segment = getMissionSegments(mission).find((candidate) => candidate.id === load.segmentId);
      stops.set(dropoff, {
        dropoff,
        loadIds: [],
        pickups: [],
        missionTitles: [],
        totalScu: 0,
        containerCount: 0,
        placeableCount: 0,
        placedLoads: [],
        firstOrder: Math.max(missionIndex, 0) * 10000 + (Number.isInteger(segment?.order) ? segment.order : 0),
      });
    }

      const stop = stops.get(dropoff);
      stop.loadIds.push(load.id);
      const pickup = String(getLoadPickup(load, mission) || "").trim();
      if (pickup && !stop.pickups.includes(pickup)) {
        stop.pickups.push(pickup);
      }
      if (mission.title && !stop.missionTitles.includes(mission.title)) {
        stop.missionTitles.push(mission.title);
      }
      stop.totalScu += Number(load.scu) || 0;
      stop.containerCount += 1;
      stop.placeableCount += 1;
      if (isLoadPlacementInCurrentLayout(load, mission)) {
        stop.placedLoads.push({ mission, load });
      }
    });

  return [...stops.values()]
    .sort((left, right) => left.firstOrder - right.firstOrder)
    .map((stop) => ({
      ...stop,
      analysis: analyzeStopUnloadability(stop),
    }));
}

function getStopCargoGroupKey(mission, load) {
  const segment = getMissionSegments(mission).find((candidate) => candidate.id === load.segmentId);
  const normalizeKeyPart = (value) => String(value || "").trim().toLocaleLowerCase("de-DE");
  const cargoIdentity = Number.isInteger(segment?.cargoIndex)
    ? `cargo-${segment.cargoIndex}`
    : normalizeKeyPart(load.cargoTitle || segment?.title || load.label);
  return `${mission.id}|${cargoIdentity}|${normalizeKeyPart(getLoadDropoff(load, mission))}`;
}

function buildStopCargoGroups(dropoff) {
  const normalizedDropoff = String(dropoff || "").trim();
  if (!normalizedDropoff) return [];

  const groups = new Map();
  getAllLoads()
    .filter(({ mission, load }) => getLoadDropoff(load, mission) === normalizedDropoff)
    .forEach((entry) => {
      const { mission, load } = entry;
      const key = getStopCargoGroupKey(mission, load);
      if (!groups.has(key)) {
        const segment = getMissionSegments(mission).find((candidate) => candidate.id === load.segmentId);
        groups.set(key, {
          key,
          dropoff: normalizedDropoff,
          mission,
          label: String(load.cargoTitle || segment?.title || load.label || mission.title).trim(),
          entries: [],
        });
      }
      groups.get(key).entries.push(entry);
    });

  const placedEntries = getPlacedLoadEntries();
  return [...groups.values()].map((group) => {
    const groupPlacedEntries = group.entries.filter(({ mission, load }) => isLoadPlacementInCurrentLayout(load, mission));
    const baseAnalysis = analyzeUnloadEntries(groupPlacedEntries, placedEntries);
    let status = "ready";
    if (groupPlacedEntries.length === 0) {
      status = "not-loaded";
    } else if (groupPlacedEntries.length < group.entries.length) {
      status = "incomplete";
    } else if (baseAnalysis.blockedEntries.length > 0) {
      status = baseAnalysis.freeEntries.length > 0 ? "partial" : "blocked";
    }
    return {
      ...group,
      placedEntries: groupPlacedEntries,
      totalScu: group.entries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0),
      placedScu: groupPlacedEntries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0),
      analysis: { ...baseAnalysis, status },
    };
  });
}

function buildRouteStops({ includeDelivered = true, activeOnly = true } = {}) {
  const stops = new Map();

  getAllLoads({ includeDelivered })
    .filter(({ mission }) => !activeOnly || canMissionRunWithCurrentActiveShip(mission))
    .forEach(({ mission, load }) => {
    const dropoff = String(getLoadDropoff(load, mission) || "Ziel offen").trim();
    if (!stops.has(dropoff)) {
      const missionIndex = state.missions.findIndex((candidate) => candidate.id === mission.id);
      const segment = getMissionSegments(mission).find((candidate) => candidate.id === load.segmentId);
      stops.set(dropoff, {
        dropoff,
        pickups: [],
        cargoMissionIds: [],
        serviceMissionIds: [],
        activeServiceMissionIds: [],
        serviceSummaries: [],
        missionIds: [],
        missionTitles: [],
        hasCargo: false,
        hasService: false,
        firstOrder: Math.max(missionIndex, 0) * 10000 + (Number.isInteger(segment?.order) ? segment.order : 0),
      });
    }

    const stop = stops.get(dropoff);
    stop.hasCargo = true;
    if (mission.id && !stop.cargoMissionIds.includes(mission.id)) {
      stop.cargoMissionIds.push(mission.id);
    }
    const pickup = String(getLoadPickup(load, mission) || "").trim();
    if (pickup && !stop.pickups.includes(pickup)) {
      stop.pickups.push(pickup);
    }
    if (mission.id && !stop.missionIds.includes(mission.id)) {
      stop.missionIds.push(mission.id);
    }
    if (mission.title && !stop.missionTitles.includes(mission.title)) {
      stop.missionTitles.push(mission.title);
    }
  });

  state.missions.forEach((mission, missionIndex) => {
    if (activeOnly && !canMissionRunWithCurrentActiveShip(mission)) return;
    if (isCargoMission(mission) || normalizeMissionType(mission.type) === "courier" || normalizeMissionStatus(mission.status) === "cancelled") return;
    const details = getMissionServiceDetails(mission);
    const dropoff = String(details.location || mission.dropoff || "Einsatzort offen").trim();
    if (!stops.has(dropoff)) {
      stops.set(dropoff, {
        dropoff,
        pickups: [],
        cargoMissionIds: [],
        serviceMissionIds: [],
        activeServiceMissionIds: [],
        serviceSummaries: [],
        missionIds: [],
        missionTitles: [],
        hasCargo: false,
        hasService: false,
        firstOrder: Math.max(missionIndex, 0) * 10000,
      });
    }

    const stop = stops.get(dropoff);
    stop.hasService = true;
    stop.firstOrder = Math.min(stop.firstOrder, Math.max(missionIndex, 0) * 10000);
    if (mission.id && !stop.serviceMissionIds.includes(mission.id)) {
      stop.serviceMissionIds.push(mission.id);
    }
    if (mission.id && isMissionActive(mission) && !stop.activeServiceMissionIds.includes(mission.id)) {
      stop.activeServiceMissionIds.push(mission.id);
    }
    if (mission.id && !stop.missionIds.includes(mission.id)) {
      stop.missionIds.push(mission.id);
    }
    if (mission.title && !stop.missionTitles.includes(mission.title)) {
      stop.missionTitles.push(mission.title);
    }
    const serviceSummary = formatServiceMissionSummary(mission);
    if (serviceSummary && !stop.serviceSummaries.includes(serviceSummary)) {
      stop.serviceSummaries.push(serviceSummary);
    }
  });

  return [...stops.values()].sort((left, right) => left.firstOrder - right.firstOrder || left.dropoff.localeCompare(right.dropoff, "de"));
}

function buildRoutePoints({ activeOnly = true, missionFilter = null } = {}) {
  const points = [];
  const routeLegPoints = new Map();
  const mergePointDetails = (point, details = {}) => {
    if (!point) return null;
    point.hasPickup = Boolean(point.hasPickup || details.hasPickup);
    point.hasCargo = Boolean(point.hasCargo || details.hasCargo);
    point.hasService = Boolean(point.hasService || details.hasService);
    point.missionIds = [...new Set([...(point.missionIds || []), ...(details.missionIds || [])])];
    point.missionTitles = [...new Set([...(point.missionTitles || []), ...(details.missionTitles || [])])];
    if (Number.isFinite(Number(details.firstOrder))) {
      point.firstOrder = Math.min(Number(point.firstOrder) || 0, Number(details.firstOrder));
    }
    return point;
  };
  const appendPoint = (location, details = {}) => {
    const dropoff = String(location || "").trim();
    if (!dropoff) return null;
    const previousPoint = points.at(-1);
    if (previousPoint?.dropoff === dropoff) return mergePointDetails(previousPoint, details);
    const point = {
      dropoff,
      status: "upcoming",
      missionIds: [],
      missionTitles: [],
      firstOrder: points.length,
      ...details,
    };
    points.push(point);
    return point;
  };
  const normalizePointKey = (value) => String(value || "").trim().toLocaleLowerCase("de-DE");

  state.missions.forEach((mission, missionIndex) => {
    if (typeof missionFilter === "function") {
      if (!missionFilter(mission)) return;
    } else if (activeOnly && !canMissionRunWithCurrentActiveShip(mission)) {
      return;
    }
    if (normalizeMissionStatus(mission.status) === "cancelled") return;

    const missionId = mission.id ? [mission.id] : [];
    const missionTitles = mission.title ? [mission.title] : [];

    if (isCargoMission(mission)) {
      getMissionSegments(mission)
        .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
        .forEach((segment) => {
          const segmentOrder = Number(segment.order) || 0;
          const pickup = segment.pickup || mission.pickup || "";
          const dropoff = segment.dropoff || mission.dropoff || "Ziel offen";
          const routeLegKey = `${normalizePointKey(pickup)}->${normalizePointKey(dropoff)}`;
          const existingLeg = routeLegPoints.get(routeLegKey);
          if (existingLeg) {
            mergePointDetails(existingLeg.pickupPoint, { hasPickup: true, missionIds: missionId, missionTitles });
            mergePointDetails(existingLeg.dropoffPoint, { hasCargo: true, missionIds: missionId, missionTitles });
            return;
          }
          const pickupPoint = appendPoint(pickup, {
            hasPickup: true,
            missionIds: missionId,
            missionTitles,
            firstOrder: Math.max(missionIndex, 0) * 10000 + segmentOrder * 2,
          });
          const dropoffPoint = appendPoint(dropoff, {
            hasCargo: true,
            missionIds: missionId,
            missionTitles,
            firstOrder: Math.max(missionIndex, 0) * 10000 + segmentOrder * 2 + 1,
          });
          routeLegPoints.set(routeLegKey, { pickupPoint, dropoffPoint });
        });
      return;
    }

    const details = getMissionServiceDetails(mission);
    appendPoint(details.location || mission.dropoff || "Einsatzort offen", {
      hasService: true,
      missionIds: missionId,
      missionTitles,
      firstOrder: Math.max(missionIndex, 0) * 10000,
    });
  });

  return points;
}

function stopHistoryBelongsToCurrentRoute(entry, missionIdSet, missionTitleSet) {
  const missionIds = Array.isArray(entry?.missionIds) ? entry.missionIds.filter(Boolean) : [];
  if (missionIds.length > 0) {
    return missionIds.some((missionId) => missionIdSet.has(missionId));
  }

  const missionTitles = Array.isArray(entry?.missionTitles) ? entry.missionTitles.filter(Boolean) : [];
  if (missionTitles.length > 0) {
    return missionTitles.some((title) => missionTitleSet.has(title));
  }

  return false;
}

function buildFlightRouteState() {
  const orderedStops = buildRouteStops({ includeDelivered: true });
  const activeRouteMissions = state.missions.filter((mission) => canMissionRunWithCurrentActiveShip(mission));
  const missionIdSet = new Set(activeRouteMissions.map((mission) => mission.id));
  const missionTitleSet = new Set(activeRouteMissions.map((mission) => mission.title).filter(Boolean));
  const completedMissionIds = new Set(state.missions.filter((mission) => isMissionCompleted(mission)).map((mission) => mission.id));
  const relevantHistory = state.stopHistory
    .filter((entry) => stopHistoryBelongsToCurrentRoute(entry, missionIdSet, missionTitleSet))
    .sort((left, right) => new Date(left.completedAt).getTime() - new Date(right.completedAt).getTime());
  const completedDropoffSet = new Set(relevantHistory.map((entry) => entry.dropoff));
  const plan = computeUnloadPlan();
  const isStopCompleted = (stop) => {
    const cargoCompleted = !stop.hasCargo
      || completedDropoffSet.has(stop.dropoff)
      || (stop.cargoMissionIds.length > 0 && stop.cargoMissionIds.every((missionId) => completedMissionIds.has(missionId)));
    const serviceCompleted = !stop.hasService
      || (stop.serviceMissionIds.length > 0 && stop.serviceMissionIds.every((missionId) => completedMissionIds.has(missionId)));
    return cargoCompleted && serviceCompleted;
  };
  const openOrderedStops = orderedStops.filter((stop) => !isStopCompleted(stop));
  const selectedDropoff = openOrderedStops.some((stop) => stop.dropoff === state.selectedStopDropoff)
    ? state.selectedStopDropoff
    : "";
  const plannedDropoff = plan.steps.find((step) => openOrderedStops.some((stop) => stop.dropoff === step.dropoff))?.dropoff || "";
  const currentDropoff = String(selectedDropoff || plannedDropoff || openOrderedStops[0]?.dropoff || "").trim();
  const currentOpenIndex = currentDropoff ? openOrderedStops.findIndex((stop) => stop.dropoff === currentDropoff) : -1;
  const nextDropoff = currentOpenIndex >= 0
    ? openOrderedStops[currentOpenIndex + 1]?.dropoff || ""
    : openOrderedStops[0]?.dropoff || "";
  const routePoints = buildRoutePoints({ activeOnly: true });
  const pickups = [...new Set(routePoints.filter((point) => point.hasPickup).map((point) => point.dropoff))];

  const routeStops = orderedStops.map((stop) => {
    let status = "upcoming";
    if (isStopCompleted(stop)) {
      status = "completed";
    } else if (stop.dropoff === currentDropoff) {
      status = "current";
    } else if (stop.dropoff === nextDropoff) {
      status = "next";
    }

    return {
      ...stop,
      status,
    };
  });
  const currentLocation = isDispatcherMode() ? "" : String(state.currentLocation || "").trim();
  const normalizedCurrentLocation = currentLocation.toLocaleLowerCase("de-DE");
  const startsAtFirstRoutePoint = Boolean(
    normalizedCurrentLocation
      && routePoints[0]?.dropoff?.trim().toLocaleLowerCase("de-DE") === normalizedCurrentLocation,
  );
  const routeStart = !isDispatcherMode() && !startsAtFirstRoutePoint
    ? [{
        dropoff: currentLocation || t("contracts.route.locationOpen"),
        status: currentLocation ? "start" : "missing",
        isStart: true,
        firstOrder: -1000,
      }]
    : [];
  const routePath = routePoints.length > 0
    ? [
        ...routeStart,
        ...routePoints.map((point) => {
          const matchingStop = routeStops.find((stop) => stop.dropoff === point.dropoff);
          return matchingStop
            ? {
                ...matchingStop,
                ...point,
                status: matchingStop.status,
              }
            : point;
        }),
      ]
    : [];

  return {
    pickups,
    routeStops,
    routePath,
    completedStops: routeStops.filter((stop) => stop.status === "completed").length,
    openStops: routeStops.filter((stop) => stop.status !== "completed").length,
    currentDropoff,
    nextDropoff,
    currentLocation,
    currentStop: routeStops.find((stop) => stop.dropoff === currentDropoff) || null,
    nextStop: routeStops.find((stop) => stop.dropoff === nextDropoff) || null,
    plan,
  };
}

function syncStopControls(stops) {
  if (nextStopSelect) {
    const selectedDropoff = stops.some((stop) => stop.dropoff === state.selectedStopDropoff)
      ? state.selectedStopDropoff
      : "";

    nextStopSelect.disabled = stops.length === 0;
    nextStopSelect.innerHTML = `
      <option value="">Kein Ziel ausgewählt</option>
      ${stops.map((stop) => `<option value="${escapeHtml(stop.dropoff)}">${escapeHtml(stop.dropoff)}</option>`).join("")}
    `;
    nextStopSelect.value = selectedDropoff;
  }

  if (suggestUnloadPlanButton) {
    suggestUnloadPlanButton.disabled = stops.every((stop) => stop.placedLoads.length === 0);
  }
}

function renderUnloadPlanResult() {
  if (!unloadPlanResult) return;

  if (!lastUnloadPlan) {
    unloadPlanResult.hidden = true;
    unloadPlanResult.innerHTML = "";
    return;
  }

  unloadPlanResult.hidden = false;

  if (lastUnloadPlan.totalPlaced === 0) {
    unloadPlanResult.innerHTML = `
      <strong>Entladeplan</strong>
      <p>Aktuell liegt keine platzierte Ladung im Schiff.</p>
    `;
    return;
  }

  const stepsMarkup = lastUnloadPlan.steps.length > 0
    ? `
      <ol class="unload-plan-steps">
        ${lastUnloadPlan.steps
          .map(
            (step, index) => `
              <li>
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(step.dropoff)}</strong>
                <small>${step.loadCount} Container · ${formatScuAmount(step.scu)}</small>
              </li>
            `,
          )
          .join("")}
      </ol>
    `
    : `<p>Im aktuellen Stapel ist kein Ziel vollständig frei entladbar.</p>`;

  const blockedMarkup = lastUnloadPlan.blockedStops.length > 0
    ? `
      <div class="unload-plan-blockers">
        <strong>Noch blockiert</strong>
        ${lastUnloadPlan.blockedStops
          .map((stop) => `
            <section class="unload-plan-blocked-stop">
              <h3>${escapeHtml(stop.dropoff)}</h3>
              ${renderUnloadBlockerDetails(stop.analysis)}
            </section>
          `)
          .join("")}
      </div>
    `
    : `<p class="unload-plan-clear">Alle aktuell geladenen Ziele sind in dieser Reihenfolge erreichbar.</p>`;

  unloadPlanResult.innerHTML = `
    <strong>Entladeplan nach Stapelung</strong>
    ${stepsMarkup}
    ${blockedMarkup}
  `;
  bindUnloadGuidanceEvents(unloadPlanResult);
}

function unloadStop(dropoff) {
  completeStop(dropoff);
}

function buildUnloadPlan() {
  return computeUnloadPlan({ activateFirst: true });
}

function computeUnloadPlan({ activateFirst = false } = {}) {
  const baseStops = buildUnloadStops();
  let remainingEntries = getPlacedLoadEntries();
  const steps = [];
  const totalPlaced = remainingEntries.length;

  while (remainingEntries.length > 0) {
    const candidates = baseStops
      .map((stop) => ({
        ...stop,
        analysis: analyzeStopUnloadability(stop, remainingEntries),
      }))
      .filter((stop) => stop.analysis.targetEntries.length > 0);
    const readyStops = candidates.filter((stop) => stop.analysis.status === "ready");

    if (readyStops.length === 0) {
      break;
    }

    readyStops.sort((left, right) => left.firstOrder - right.firstOrder || left.dropoff.localeCompare(right.dropoff, "de"));
    const nextStop = readyStops[0];
    const unloadedIds = new Set(nextStop.analysis.targetEntries.map(({ load }) => load.id));
    steps.push({
      dropoff: nextStop.dropoff,
      loadCount: nextStop.analysis.targetEntries.length,
      scu: nextStop.analysis.targetEntries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0),
    });
    remainingEntries = remainingEntries.filter(({ load }) => !unloadedIds.has(load.id));
  }

  const blockedStops = baseStops
    .map((stop) => ({
      ...stop,
      analysis: analyzeStopUnloadability(stop, remainingEntries),
    }))
    .filter((stop) => stop.analysis.targetEntries.length > 0);

  if (activateFirst && steps.length > 0) {
    selectStopByDropoff(steps[0].dropoff);
  }

  return {
    totalPlaced,
    steps,
    blockedStops,
  };
}

function analyzeStopUnloadability(stop, remainingEntries = getPlacedLoadEntries()) {
  const stopLoadIds = new Set(stop.loadIds || []);
  const targetEntries = remainingEntries.filter(({ mission, load }) => (
    getLoadDropoff(load, mission) === stop.dropoff
    && (stopLoadIds.size === 0 || stopLoadIds.has(load.id))
  ));
  if (targetEntries.length === 0) {
    return {
      status: stop.placeableCount > 0 ? "not-loaded" : "no-cargo",
      targetEntries,
      freeEntries: [],
      blockedEntries: [],
      blockers: [],
      blockerDetails: [],
    };
  }

  const analysis = analyzeUnloadEntries(targetEntries, remainingEntries);
  if (targetEntries.length < stop.placeableCount) {
    return { ...analysis, status: "incomplete" };
  }
  if (analysis.blockedEntries.length === 0) {
    return { ...analysis, status: "ready" };
  }
  if (analysis.freeEntries.length > 0) {
    return { ...analysis, status: "partial" };
  }
  return { ...analysis, status: "blocked" };
}

function analyzeUnloadEntries(targetEntries, remainingEntries = getPlacedLoadEntries()) {
  return UnloadGuidance.analyzeUnloadEntries(targetEntries, remainingEntries);
}

function getPlacedLoadEntries({ fleetEntryId = getCurrentCargoGridFleetEntryId(), includeDelivered = false } = {}) {
  return getAllLoads({ includeDelivered })
    .filter(({ mission, load }) => isLoadPlacementForFleetEntry(load, mission, fleetEntryId));
}

function getStopStatusLabel(status) {
  switch (status) {
    case "ready":
      return t("contracts.stop.status.ready");
    case "incomplete":
      return t("contracts.stop.status.incomplete");
    case "partial":
      return t("contracts.stop.status.partial");
    case "blocked":
      return t("contracts.stop.status.blocked");
    case "no-cargo":
      return t("contracts.stop.status.no-cargo");
    case "not-loaded":
    default:
      return t("contracts.stop.status.not-loaded");
  }
}

function getStopActionHint(analysis) {
  if (analysis.status === "incomplete") return t("contracts.stop.hint.incomplete");
  if (analysis.status === "not-loaded") return t("contracts.stop.hint.notLoaded");
  if (analysis.status === "no-cargo") return t("contracts.stop.hint.noCargo");
  return formatUnloadBlockerSummary(analysis.blockers) || t("contracts.stop.hint.notUnloadable");
}

function formatUnloadBlockerSummary(blockers) {
  if (!blockers?.length) return "";
  const labels = blockers
    .slice(0, 4)
    .map(({ mission, load }) => {
      const slot = load.placement ? `${load.placement.slotId}, Ebene ${load.placement.z + 1}` : "ohne Position";
      return `${load.label} (${mission.title}, ${slot})`;
    });
  const remaining = Math.max(blockers.length - labels.length, 0);
  return t("contracts.stop.blockedBy", {
    items: labels.join("; "),
    more: remaining > 0 ? t("contracts.stop.moreBlockers", { count: remaining }) : "",
  });
}

function formatUnloadLoadPosition(load) {
  if (!load?.placement) return t("contracts.stop.positionUnknown");
  return t("contracts.stop.position", {
    slot: load.placement.slotId,
    level: (Number(load.placement.z) || 0) + 1,
  });
}

function renderUnloadLoadFocus(entry, kind) {
  if (!entry?.load) return "";
  const kindLabel = kind === "target"
    ? t("contracts.stop.blockedContainer")
    : t("contracts.stop.removeFirst");
  const ariaLabel = t("contracts.stop.showInGrid", { load: entry.load.label });
  return `
    <button
      class="unload-load-focus is-${escapeHtml(kind)}"
      type="button"
      data-unload-jump-load-id="${escapeHtml(entry.load.id)}"
      aria-label="${escapeHtml(ariaLabel)}"
      data-tooltip="${escapeHtml(ariaLabel)}"
    >
      <span class="unload-focus-kind">${escapeHtml(kindLabel)}</span>
      <strong>${escapeHtml(entry.load.label)}</strong>
      <small>${escapeHtml(entry.mission?.title || "")}</small>
      <span class="unload-focus-position">${escapeHtml(formatUnloadLoadPosition(entry.load))}</span>
    </button>
  `;
}

function renderUnloadBlockerDetails(analysis) {
  const details = Array.isArray(analysis?.blockerDetails) ? analysis.blockerDetails : [];
  if (details.length === 0) {
    return `<p>${escapeHtml(formatUnloadBlockerSummary(analysis?.blockers) || t("contracts.stop.blockerUnknown"))}</p>`;
  }
  return `
    <div class="unload-blocker-details">
      ${details.map(({ targetEntry, blockers }) => `
        <div class="unload-blocker-relation">
          ${renderUnloadLoadFocus(targetEntry, "target")}
          <div class="unload-blocker-link" aria-hidden="true">→</div>
          <div class="unload-blocker-items">
            ${blockers.map((blocker) => renderUnloadLoadFocus(blocker, "blocker")).join("")}
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function focusLoadInCargoGrid(loadId) {
  const entry = findLoadById(loadId);
  if (!entry?.load?.placement || !isLoadPlacementInCurrentLayout(entry.load, entry.mission)) {
    void showAppNotice(t("contracts.stop.loadPositionMissing"));
    return;
  }
  state.selectedLoadId = entry.load.id;
  state.selectionCleared = false;
  state.levelFilter = clamp(Number(entry.load.placement.z) || 0, 0, 8);
  state.selectedStopDropoff = getLoadDropoff(entry.load, entry.mission);
  setActivePage("load");
  setCollapsibleExpanded("loadTopdownBody", true);
  persist();
  render();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const focusedSlots = Array.from(shipGrid?.querySelectorAll(".slot.selected-load") || []);
      focusedSlots.forEach((slot) => slot.classList.add("is-guidance-focus"));
      shipGrid?.closest(".panel-ship")?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => focusedSlots.forEach((slot) => slot.classList.remove("is-guidance-focus")), 1800);
    });
  });
}

function bindUnloadGuidanceEvents(container) {
  container?.querySelectorAll("[data-unload-jump-load-id]").forEach((button) => {
    button.addEventListener("click", () => focusLoadInCargoGrid(button.dataset.unloadJumpLoadId || ""));
  });
  normalizeAppTooltipTitles(container);
}

function isLoadInSelectedStop(load, mission) {
  return Boolean(state.selectedStopDropoff) && getLoadDropoff(load, mission) === state.selectedStopDropoff;
}

function selectStopByDropoff(dropoff) {
  state.selectedStopDropoff = String(dropoff || "");
  const firstPlacedEntry = getPlacedLoadEntries().find(({ mission, load }) => getLoadDropoff(load, mission) === state.selectedStopDropoff);
  const firstOpenEntry = getAllLoads().find(({ mission, load }) => getLoadDropoff(load, mission) === state.selectedStopDropoff);
  const preferredEntry = firstPlacedEntry || firstOpenEntry || null;
  if (preferredEntry) {
    state.selectedLoadId = preferredEntry.load.id;
    state.selectionCleared = false;
  } else {
    state.selectedLoadId = null;
    state.selectionCleared = true;
  }
}

function bookMissionIncome(mission, completedAt) {
  if (!missionHasPayout(mission)) return null;
  return createMissionIncomeForCompletedMission({
    state,
    mission,
    completedAt,
    helpers: {
      createLedgerEntry,
      formatDateForInput,
      normalizeMissionType,
      getMissionTypeLabel,
    },
  });
}

function markMissionCompleted(mission, { completedAt = new Date().toISOString(), bookIncome = false } = {}) {
  if (!mission) return;
  const effectiveCompletedAt = mission.completedAt || completedAt;
  mission.completedAt = effectiveCompletedAt;

  if (bookIncome || !missionHasPayout(mission)) {
    bookMissionIncome(mission, effectiveCompletedAt);
    mission.status = "paid";
    mission.paidAt = mission.paidAt || effectiveCompletedAt;
    return;
  }

  if (getMissionIncomeEntry(mission)) {
    mission.status = "paid";
    mission.paidAt = mission.paidAt || effectiveCompletedAt;
    return;
  }

  mission.status = "completed";
  mission.paidAt = "";
}

function markMissionPaid(mission, { paidAt = new Date().toISOString() } = {}) {
  if (!mission) return;
  const completedAt = mission.completedAt || paidAt;
  mission.completedAt = completedAt;
  bookMissionIncome(mission, paidAt);
  mission.status = "paid";
  mission.paidAt = mission.paidAt || paidAt;
}

function unloadMissionLoadsForCompletion(mission, completedAt = new Date().toISOString()) {
  if (!isCargoMission(mission)) return;
  const loads = Array.isArray(mission.loads) ? mission.loads : [];
  const openLoads = loads.filter((load) => !isLoadDelivered(load));
  if (openLoads.length === 0) return;

  const selectedLoadWasOpen = state.selectedLoadId && openLoads.some((load) => load.id === state.selectedLoadId);
  openLoads.forEach((load) => {
    load.deliveredByFleetEntryId = getLoadPlacementFleetEntryId(load, mission);
    load.placement = null;
    load.deliveredAt = completedAt;
  });

  const segments = getMissionSegments(mission);
  const pickups = [...new Set(segments.map((segment) => segment.pickup).filter(Boolean))];
  const dropoffs = [...new Set(segments.map((segment) => segment.dropoff).filter(Boolean))];
  const scu = openLoads.reduce((sum, load) => sum + (Number(load.scu) || 0), 0);

  state.stopHistory.unshift({
    id: createRuntimeId(),
    dropoff: dropoffs.join(" + ") || mission.dropoff || mission.title,
    pickups,
    missionIds: mission.id ? [mission.id] : [],
    missionTitles: mission.title ? [mission.title] : [],
    loadCount: openLoads.length,
    scu,
    completedAt,
    note: t("contracts.history.missionAutoUnload"),
    order: state.stopHistory.length,
  });

  if (selectedLoadWasOpen) {
    state.selectedLoadId = null;
    state.selectionCleared = true;
  }
}

async function completeStop(dropoff, { missionIds = null } = {}) {
  const allowedMissionIds = missionIds ? new Set(missionIds) : null;
  const stop = buildUnloadStops({
    missionFilter: allowedMissionIds ? (mission) => allowedMissionIds.has(mission.id) : null,
  }).find((candidate) => candidate.dropoff === dropoff);
  if (!stop) {
    await showAppNotice(t("contracts.alert.stopMissing"));
    return;
  }

  if (stop.analysis.status !== "ready") {
    await showAppNotice(formatUnloadBlockerSummary(stop.analysis.blockers) || t("contracts.alert.stopNotCompletable"));
    return;
  }

  const shouldComplete = await showMissionConfirmDialog({
    kicker: t("contracts.dialog.cargoKicker"),
    title: t("contracts.route.completeStop"),
    message: t("contracts.confirm.unloadStop", { target: stop.dropoff, count: stop.placedLoads.length }),
    confirmLabel: t("contracts.route.completeStop"),
  });
  if (!shouldComplete) return;

  const completedAt = new Date().toISOString();
  const unloadedIds = new Set(stop.placedLoads.map(({ load }) => load.id));
  stop.placedLoads.forEach(({ mission, load }) => {
    load.deliveredByFleetEntryId = getLoadPlacementFleetEntryId(load, mission);
    load.placement = null;
    load.deliveredAt = completedAt;
  });

  const touchedMissionIds = new Set(stop.placedLoads.map(({ mission }) => mission.id).filter(Boolean));
  touchedMissionIds.forEach((missionId) => {
    const mission = state.missions.find((entry) => entry.id === missionId);
    if (mission && canAutoCompleteMissionProgress(mission)) {
      markMissionCompleted(mission, { completedAt });
      collapsedMissionIds.add(mission.id);
    }
  });

  state.stopHistory.unshift({
    id: createRuntimeId(),
    dropoff: stop.dropoff,
    pickups: [...stop.pickups],
    missionIds: [...new Set(stop.placedLoads.map(({ mission }) => mission.id).filter(Boolean))],
    missionTitles: [...stop.missionTitles],
    loadCount: stop.placedLoads.length,
    scu: stop.placedLoads.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0),
    completedAt,
    note: "",
    order: state.stopHistory.length,
  });

  if (state.selectedLoadId && unloadedIds.has(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = true;
  }

  const remainingServiceAtStop = buildRouteStops({ includeDelivered: true })
    .find((candidate) => candidate.dropoff === stop.dropoff)
    ?.activeServiceMissionIds?.length > 0;
  const nextPlan = computeUnloadPlan({ activateFirst: !remainingServiceAtStop });
  if (remainingServiceAtStop) {
    state.selectedStopDropoff = stop.dropoff;
  } else if (nextPlan.steps.length === 0) {
    state.selectedStopDropoff = "";
  }
  lastUnloadPlan = nextPlan;
  persist();
  render();
}

async function deliverStopCargoGroup(dropoff, groupKey) {
  const group = buildStopCargoGroups(dropoff).find((candidate) => candidate.key === groupKey);
  if (!group || group.analysis.status !== "ready") return;

  const shouldDeliver = await showMissionConfirmDialog({
    kicker: t("contracts.dialog.cargoKicker"),
    title: t("contracts.dialog.deliverCargoTitle"),
    message: t("contracts.confirm.deliverCargo", {
      cargo: group.label,
      count: group.placedEntries.length,
      scu: formatScuAmount(group.placedScu),
      target: group.dropoff,
    }),
    confirmLabel: t("contracts.actions.deliverCargo"),
  });
  if (!shouldDeliver) return;

  const completedAt = new Date().toISOString();
  const deliveredIds = new Set(group.placedEntries.map(({ load }) => load.id));
  group.placedEntries.forEach(({ mission, load }) => {
    load.deliveredByFleetEntryId = getLoadPlacementFleetEntryId(load, mission);
    load.placement = null;
    load.deliveredAt = completedAt;
  });

  if (canAutoCompleteMissionProgress(group.mission)) {
    markMissionCompleted(group.mission, { completedAt });
    collapsedMissionIds.add(group.mission.id);
  }

  state.stopHistory.unshift({
    id: createRuntimeId(),
    dropoff: group.dropoff,
    pickups: [...new Set(group.placedEntries.map(({ mission, load }) => getLoadPickup(load, mission)).filter(Boolean))],
    missionIds: group.mission.id ? [group.mission.id] : [],
    missionTitles: group.mission.title ? [group.mission.title] : [],
    loadCount: group.placedEntries.length,
    scu: group.placedScu,
    completedAt,
    note: t("contracts.history.cargoDelivered", { cargo: group.label }),
    order: state.stopHistory.length,
  });

  if (state.selectedLoadId && deliveredIds.has(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = true;
  }

  const remainingServiceAtStop = buildRouteStops({ includeDelivered: true })
    .find((candidate) => candidate.dropoff === group.dropoff)
    ?.activeServiceMissionIds?.length > 0;
  const nextPlan = computeUnloadPlan({ activateFirst: !remainingServiceAtStop });
  if (remainingServiceAtStop || buildStopCargoGroups(group.dropoff).length > 0) {
    state.selectedStopDropoff = group.dropoff;
  } else if (nextPlan.steps.length === 0) {
    state.selectedStopDropoff = "";
  }
  lastUnloadPlan = nextPlan;
  persist();
  render();
}

async function completeServiceStop(dropoff) {
  const routeState = buildFlightRouteState();
  const stop = routeState.routeStops.find((candidate) => candidate.dropoff === dropoff);
  if (!stop || stop.activeServiceMissionIds.length === 0) {
    await showAppNotice(t("contracts.alert.noServiceStop"));
    return;
  }

  const serviceMissions = stop.activeServiceMissionIds
    .map((missionId) => state.missions.find((mission) => mission.id === missionId))
    .filter(Boolean);
  const missionLabel = serviceMissions.length === 1
    ? serviceMissions[0].title
    : t("contracts.history.serviceCountPlural", { count: serviceMissions.length });
  const shouldComplete = await showMissionConfirmDialog({
    kicker: t("contracts.dialog.kicker"),
    title: t("run.actions.completeService"),
    message: t("contracts.confirm.completeServiceStop", { target: stop.dropoff, label: missionLabel }),
    confirmLabel: t("run.actions.completeService"),
  });
  if (!shouldComplete) return;

  const completedAt = new Date().toISOString();
  serviceMissions.forEach((mission) => {
    markMissionCompleted(mission, { completedAt });
    collapsedMissionIds.add(mission.id);
  });

  state.stopHistory.unshift({
    id: createRuntimeId(),
    dropoff: stop.dropoff,
    pickups: [],
    missionIds: serviceMissions.map((mission) => mission.id).filter(Boolean),
    missionTitles: serviceMissions.map((mission) => mission.title).filter(Boolean),
    serviceCount: serviceMissions.length,
    loadCount: 0,
    scu: serviceMissions.reduce((sum, mission) => {
      const details = getMissionServiceDetails(mission);
      return sum + (details.hydrogenAmount || 0) + (details.quantumAmount || 0);
    }, 0),
    completedAt,
    note: t("contracts.history.serviceDone"),
    order: state.stopHistory.length,
  });

  state.selectedStopDropoff = "";
  state.selectedLoadId = null;
  state.selectionCleared = true;
  const nextRouteState = buildFlightRouteState();
  state.selectedStopDropoff = nextRouteState.currentDropoff || "";
  persist();
  render();
}

async function completeRouteStop(dropoff, { missionIds = null } = {}) {
  const allowedMissionIds = missionIds ? new Set(missionIds) : null;
  const routeStop = buildFlightRouteState().routeStops.find((candidate) => candidate.dropoff === dropoff);
  const cargoStop = buildUnloadStops({
    missionFilter: allowedMissionIds ? (mission) => allowedMissionIds.has(mission.id) : null,
  }).find((candidate) => candidate.dropoff === dropoff);
  if (cargoStop && cargoStop.placeableCount > 0 && cargoStop.analysis.status === "ready") {
    await completeStop(dropoff, { missionIds });
    return;
  }
  if (routeStop?.activeServiceMissionIds?.length) {
    await completeServiceStop(dropoff);
    return;
  }
  if (cargoStop) {
    await completeStop(dropoff, { missionIds });
    return;
  }
  await completeServiceStop(dropoff);
}
