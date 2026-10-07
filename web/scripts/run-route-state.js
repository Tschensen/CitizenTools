// Flight plan derivation and progress using the existing mission and cargo domain adapters.
function getRunRoutePointKey(point) {
  const types = [
    point?.hasPickup ? "pickup" : "",
    point?.hasCargo ? "cargo" : "",
    point?.hasCourierPickup ? "courier-pickup" : "",
    point?.hasCourierDelivery ? "courier-delivery" : "",
    point?.hasService ? "service" : "",
  ]
    .filter(Boolean)
    .join("+");
  const missionIds = [...(point?.missionIds || [])].sort().join(",");
  return `${Number(point?.firstOrder) || 0}|${types}|${String(point?.dropoff || "").trim().toLocaleLowerCase("de-DE")}|${missionIds}`;
}

function getRunRoutePointTypeLabels(point) {
  return [
    point?.hasPickup ? cargoText("run.types.pickup", "Abholung") : "",
    point?.hasCargo ? cargoText("run.types.delivery", "Lieferung") : "",
    point?.hasCourierPickup ? cargoText("run.types.courierPickup", "Paketabholung") : "",
    point?.hasCourierDelivery ? cargoText("run.types.courierDelivery", "Paketübergabe") : "",
    point?.hasService ? cargoText("run.types.service", "Einsatz") : "",
  ].filter(Boolean);
}

function getRunRouteReasonLabels(point) {
  const labels = {
    current: cargoText("run.route.reason.current", "Bereits am aktuellen Standort"),
    priority: cargoText("run.route.reason.priority", "Manuell priorisiert"),
    "priority-prerequisite": cargoText("run.route.reason.priorityPrerequisite", "Notwendiger Halt vor der Priorität"),
    clearance: cargoText("run.route.reason.clearance", "Gibt eine blockierte Lieferung frei"),
    onboard: cargoText("run.route.reason.onboard", "Geladene Lieferung zuerst"),
    combined: cargoText("run.route.reason.combined", "{count} Aktionen gebündelt", { count: point?.routeTaskCount || 0 }),
    "same-area": cargoText("run.route.reason.sameArea", "Im gleichen Gebiet"),
    "same-system": cargoText("run.route.reason.sameSystem", "Im gleichen Sternensystem"),
    order: cargoText("run.route.reason.order", "Nach Auftragsreihenfolge"),
    manual: t("run.route.reason.manual"),
  };
  return [...new Set((point?.routeReasonCodes || []).map((code) => labels[code]).filter(Boolean))].slice(0, 3);
}

function getRunMissionReadiness(mission) {
  if (!mission || !isMissionActive(mission)) {
    return { status: "ignored", routeEligible: false, message: "" };
  }

  const assignmentWarning = getMissionAssignmentWarning(mission);
  if (assignmentWarning) {
    return { status: "ignored", routeEligible: false, message: assignmentWarning };
  }

  const missionType = normalizeMissionType(mission.type);
  if (missionType === "delivery") {
    const items = getMissionServiceDetails(mission).packages;
    if (items.length === 0 || items.some((entry) => !entry.name || !entry.pickup || !entry.destination)) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.missingDeliveryDetails", "Für diesen Lieferauftrag fehlen Gegenstand, Abholort oder Lieferziel."),
      };
    }
    if (!isCargoMission(mission)) {
      return { status: "ready", routeEligible: true, message: "" };
    }
  }
  if (missionType === "courier") {
    const packages = getMissionServiceDetails(mission).packages;
    if (packages.length === 0 || packages.some((entry) => !entry.name || !entry.pickup || !entry.destination)) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.missingCourierDetails", "Für diesen Kurierauftrag fehlen Paket, Abholort oder Lieferziel."),
      };
    }
    return { status: "ready", routeEligible: true, message: "" };
  }
  if (isCargoMission(mission)) {
    const cargoState = getActiveCargoCapacityState();
    if (!cargoState.hasCargo || cargoState.totalCapacity <= 0) {
      return {
        status: "blocked",
        routeEligible: false,
        message: getCargoReadiness().message,
      };
    }

    const segments = getMissionSegments(mission);
    if (segments.length === 0) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.missingCargoDetails", "Für diesen Auftrag fehlen die Frachtdetails."),
      };
    }

    const activeLoads = getMissionActiveLoads(mission);
    const requestedScu = activeLoads.reduce((sum, load) => sum + (Number(load.scu) || 0), 0);
    if (requestedScu > cargoState.totalCapacity) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.capacity", "{needed} benötigt, aber das aktive Schiff bietet nur {capacity}.", {
          needed: formatScuAmount(requestedScu),
          capacity: formatScuAmount(cargoState.totalCapacity),
        }),
      };
    }

    const maxProfile = getCurrentShipMaxContainerProfile();
    const oversizedLoad = maxProfile
      ? activeLoads.find((load) => Number(load.scu) > maxProfile.scu)
      : null;
    if (oversizedLoad) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.containerTooLarge", "Ein {size}-Container überschreitet die maximale Containergröße des Schiffs von {max}.", {
          size: formatScuAmount(oversizedLoad.scu),
          max: maxProfile.label,
        }),
      };
    }
    const pendingAmount = segments.some((segment) => Boolean(segment.quantityPending));
    if (pendingAmount) {
      return {
        status: "warning",
        routeEligible: true,
        message: cargoText("run.warning.missingAmount", "Abholmenge fehlt und muss am Abholort ergänzt werden."),
      };
    }
    if (requestedScu <= 0) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.noCargo", "Für diesen Auftrag wurde keine verladefähige Fracht erzeugt."),
      };
    }
    return { status: "ready", routeEligible: true, message: "" };
  }

  let readiness = { ok: true, message: "" };
  if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    readiness = getRefuelReadiness(details.serviceType, details);
  } else if (missionType === "salvage") {
    readiness = getSalvageReadiness();
  } else if (missionType === "mining") {
    readiness = getMiningReadiness(getMissionServiceDetails(mission).miningMethod);
  }
  return readiness.ok
    ? { status: "ready", routeEligible: true, message: "" }
    : { status: "blocked", routeEligible: false, message: readiness.message || cargoText("run.warning.wrongShip", "Das aktive Schiff ist für diesen Auftrag nicht geeignet.") };
}

function canMissionParticipateInRun(mission) {
  return getRunMissionReadiness(mission).routeEligible;
}

function normalizeRunRouteLocation(value) {
  return String(value || "").trim().toLocaleLowerCase("de-DE");
}

function consumeRunRoutePriority(location) {
  if (
    state.runPriorityRouteLocation
    && normalizeRunRouteLocation(state.runPriorityRouteLocation) === normalizeRunRouteLocation(location)
  ) {
    state.runPriorityRouteLocation = "";
  }
}

function getRunPickupTaskCompletionKey(mission, segment, segmentIndex = 0) {
  const missionId = String(mission?.id || "mission").trim();
  const segmentId = String(segment?.id || `segment-${segmentIndex}`).trim();
  return `pickup:${missionId}:${segmentId}`;
}

function isLegacyRunPickupCompletionKey(value, missionId, location) {
  const key = String(value || "");
  if (!key || key.startsWith("pickup:")) return false;
  const parts = key.split("|");
  if (parts.length < 4 || !parts[1].split("+").includes("pickup")) return false;
  if (parts[2] !== normalizeRunRouteLocation(location)) return false;
  return parts[3].split(",").includes(String(missionId || "").trim());
}

function mergeRunRouteTask(point, task) {
  point.hasPickup = Boolean(point.hasPickup || task.kind === "pickup");
  point.hasCargo = Boolean(point.hasCargo || task.kind === "delivery");
  point.hasCourierPickup = Boolean(point.hasCourierPickup || task.kind === "courier-pickup");
  point.hasCourierDelivery = Boolean(point.hasCourierDelivery || task.kind === "courier-delivery");
  point.hasService = Boolean(point.hasService || task.kind === "service");
  point.missionIds = [...new Set([...(point.missionIds || []), task.missionId].filter(Boolean))];
  point.missionTitles = [...new Set([...(point.missionTitles || []), task.missionTitle].filter(Boolean))];
  point.pickupTaskKeys = [...new Set([
    ...(point.pickupTaskKeys || []),
    ...(task.kind === "pickup" ? [task.id] : []),
  ])];
  const pointOrder = Number(point.firstOrder);
  point.firstOrder = Number.isFinite(pointOrder) ? Math.min(pointOrder, task.firstOrder) : task.firstOrder;
  return point;
}

function buildOptimizedRunRoutePoints(missionStates, completedPickupKeys) {
  const tasks = [];
  const normalizedCurrentLocation = normalizeRunRouteLocation(state.currentLocation);
  const completedKeys = completedPickupKeys instanceof Set ? completedPickupKeys : new Set(completedPickupKeys || []);

  missionStates.forEach(({ mission, readiness }, missionIndex) => {
    if (!readiness.routeEligible) return;
    const missionId = String(mission.id || `mission-${missionIndex}`).trim();
    const missionTitle = String(mission.title || "").trim();

    if (normalizeMissionType(mission.type) === "delivery") {
      getMissionServiceDetails(mission).packages
        .filter((entry) => !(Number(entry.containerScu) > 0))
        .forEach((entry, packageIndex) => {
          const packageId = String(entry.id || `package-${packageIndex}`).trim();
          const pickupTaskId = `courier-pickup:${missionId}:${packageId}`;
          tasks.push({
            id: pickupTaskId,
            kind: "courier-pickup",
            location: entry.pickup,
            locationKey: normalizeRunRouteLocation(entry.pickup),
            missionId,
            missionTitle,
            packageId,
            firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2,
            dependencies: [],
            completed: isMissionCompleted(mission) || Boolean(entry.pickedUpAt || entry.deliveredAt),
          });
          tasks.push({
            id: `courier-delivery:${missionId}:${packageId}`,
            kind: "courier-delivery",
            location: entry.destination,
            locationKey: normalizeRunRouteLocation(entry.destination),
            missionId,
            missionTitle,
            packageId,
            firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2 + 1,
            dependencies: [pickupTaskId],
            completed: isMissionCompleted(mission) || Boolean(entry.deliveredAt),
            onBoard: Boolean(entry.pickedUpAt && !entry.deliveredAt),
          });
        });
      if (!isCargoMission(mission)) return;
    }

    if (normalizeMissionType(mission.type) === "courier") {
      getMissionServiceDetails(mission).packages.forEach((entry, packageIndex) => {
        const packageId = String(entry.id || `package-${packageIndex}`).trim();
        const pickupTaskId = `courier-pickup:${missionId}:${packageId}`;
        tasks.push({
          id: pickupTaskId,
          kind: "courier-pickup",
          location: entry.pickup,
          locationKey: normalizeRunRouteLocation(entry.pickup),
          missionId,
          missionTitle,
          packageId,
          firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2,
          dependencies: [],
          completed: isMissionCompleted(mission) || Boolean(entry.pickedUpAt || entry.deliveredAt),
        });
        tasks.push({
          id: `courier-delivery:${missionId}:${packageId}`,
          kind: "courier-delivery",
          location: entry.destination,
          locationKey: normalizeRunRouteLocation(entry.destination),
          missionId,
          missionTitle,
          packageId,
          firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2 + 1,
          dependencies: [pickupTaskId],
          completed: isMissionCompleted(mission) || Boolean(entry.deliveredAt),
          onBoard: Boolean(entry.pickedUpAt && !entry.deliveredAt),
        });
      });
      return;
    }

    if (!isCargoMission(mission)) {
      const details = getMissionServiceDetails(mission);
      const location = String(details.location || mission.dropoff || "Einsatzort offen").trim();
      tasks.push({
        id: `service:${missionId}`,
        kind: "service",
        location,
        locationKey: normalizeRunRouteLocation(location),
        missionId,
        missionTitle,
        firstOrder: Math.max(missionIndex, 0) * 10000,
        dependencies: [],
        completed: isMissionCompleted(mission),
      });
      return;
    }

    getMissionSegments(mission)
      .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
      .forEach((segment, segmentIndex) => {
        const pickup = String(segment.pickup || mission.pickup || "").trim();
        const dropoff = String(segment.dropoff || mission.dropoff || "Ziel offen").trim();
        if (!pickup || !dropoff) return;
        const pickupTaskKey = getRunPickupTaskCompletionKey(mission, segment, segmentIndex);
        const segmentLoads = (Array.isArray(mission.loads) ? mission.loads : [])
          .filter((load) => String(load.segmentId || "") === String(segment.id || ""));
        const allDelivered = isMissionCompleted(mission) || (segmentLoads.length > 0 && segmentLoads.every((load) => isLoadDelivered(load)));
        const allPlacedOrDelivered = segmentLoads.length > 0 && segmentLoads.every((load) => (
          isLoadDelivered(load) || isLoadPlacementInCurrentLayout(load, mission)
        ));
        const explicitlyCompleted = completedKeys.has(pickupTaskKey)
          || [...completedKeys].some((key) => isLegacyRunPickupCompletionKey(key, missionId, pickup));
        const pickupCompleted = explicitlyCompleted
          || allDelivered
          || (allPlacedOrDelivered && normalizeRunRouteLocation(pickup) !== normalizedCurrentLocation);
        const placedSegmentEntries = segmentLoads
          .filter((load) => isLoadPlacementInCurrentLayout(load, mission))
          .map((load) => ({ mission, load }));
        const unloadAnalysis = placedSegmentEntries.length > 0
          ? analyzeUnloadEntries(placedSegmentEntries)
          : null;
        const blockerLocationKeys = [...new Set(
          (unloadAnalysis?.blockers || [])
            .map(({ mission: blockerMission, load }) => normalizeRunRouteLocation(getLoadDropoff(load, blockerMission)))
            .filter(Boolean),
        )];
        const segmentOrder = Number(segment.order) || 0;

        tasks.push({
          id: pickupTaskKey,
          kind: "pickup",
          location: pickup,
          locationKey: normalizeRunRouteLocation(pickup),
          missionId,
          missionTitle,
          firstOrder: Math.max(missionIndex, 0) * 10000 + segmentOrder * 2,
          dependencies: [],
          completed: pickupCompleted,
        });
        tasks.push({
          id: `delivery:${missionId}:${String(segment.id || `segment-${segmentIndex}`).trim()}`,
          kind: "delivery",
          location: dropoff,
          locationKey: normalizeRunRouteLocation(dropoff),
          missionId,
          missionTitle,
          firstOrder: Math.max(missionIndex, 0) * 10000 + segmentOrder * 2 + 1,
          dependencies: [pickupTaskKey],
          completed: allDelivered,
          onBoard: placedSegmentEntries.length > 0 && !allDelivered,
          unloadBlocked: Boolean(unloadAnalysis?.blockedEntries?.length),
          blockerLocationKeys,
        });
      });
  });

  const taskPriority = { delivery: 0, "courier-delivery": 0, pickup: 1, "courier-pickup": 1, service: 2 };
  const compareTasks = (left, right) => (
    (taskPriority[left.kind] ?? 9) - (taskPriority[right.kind] ?? 9)
    || left.firstOrder - right.firstOrder
    || left.location.localeCompare(right.location, "de")
  );
  const createPoint = (task, completed) => mergeRunRouteTask({
    dropoff: task.location,
    status: completed ? "completed" : "upcoming",
    completed,
    hasPickup: false,
    hasCargo: false,
    hasCourierPickup: false,
    hasCourierDelivery: false,
    hasService: false,
    missionIds: [],
    missionTitles: [],
    pickupTaskKeys: [],
    firstOrder: task.firstOrder,
  }, task);

  const completedPointMap = new Map();
  tasks.filter((task) => task.completed).sort(compareTasks).forEach((task) => {
    const existing = completedPointMap.get(task.locationKey);
    completedPointMap.set(task.locationKey, existing ? mergeRunRouteTask(existing, task) : createPoint(task, true));
  });
  const optimized = RouteOptimizer.optimizeRouteTasks(tasks, {
    currentLocation: state.currentLocation,
    priorityLocation: state.runPriorityRouteLocation,
    taskOrder: state.runRouteOrder?.[state.activeFleetEntryId] || [],
    locations: window.systemDatabaseController?.getActiveLocations?.() || [],
  });
  const plannedPoints = optimized.batches.map((batch) => {
    const point = createPoint(batch.tasks[0], false);
    batch.tasks.slice(1).forEach((task) => mergeRunRouteTask(point, task));
    return {
      ...point,
      routeReasonCodes: [...batch.reasonCodes],
      routeTaskCount: batch.tasks.length,
      routeTaskIds: batch.tasks.map(task => task.id),
      routeDependencies: [...new Set(batch.tasks.flatMap(task => task.dependencies))],
      routeScore: batch.score,
    };
  });

  return {
    completedPoints: [...completedPointMap.values()].sort((left, right) => left.firstOrder - right.firstOrder),
    plannedPoints,
    priorityReachable: optimized.priorityReachable,
  };
}

// Keep the mission cohort of a flight until the next flight starts. Completed
// missions must not disappear from the progress denominator when archived/paid.

function syncRunRouteProgress() {
  const fleetId = currentActiveFleetEntry()?.id;
  if (!fleetId) return;
  const previousIds = new Set(state.runRouteProgress?.[fleetId] || []);
  const previous = state.missions.filter((mission) => (
    previousIds.has(mission.id)
    && mission.assignedFleetEntryId === fleetId
    && (isMissionActive(mission) || isMissionCompleted(mission))
    && normalizeMissionStatus(mission.status) !== "cancelled"
  ));
  const eligible = state.missions.filter((mission) => getRunMissionReadiness(mission).routeEligible);
  const newFlight = !previous.some(isMissionActive) && eligible.some((mission) => !previousIds.has(mission.id));
  if (newFlight && state.runRouteOrder) delete state.runRouteOrder[fleetId];
  const ids = [...new Set([...(newFlight ? [] : previous.map((mission) => mission.id)), ...eligible.map((mission) => mission.id)])];
  state.runRouteProgress ||= {};
  state.runRouteProgress[fleetId] = ids;
}
function buildRunRouteState() {
  syncRunRouteProgress();
  const flightRoute = buildFlightRouteState();
  const completedPickupKeys = new Set(state.runCompletedRoutePoints || []);
  const stopByLocation = new Map(flightRoute.routeStops.map((stop) => [stop.dropoff, stop]));
  const missionStates = state.missions
    .filter((mission) => isMissionActive(mission))
    .map((mission) => ({ mission, readiness: getRunMissionReadiness(mission) }));
  const eligibleMissionIds = new Set(
    missionStates.filter(({ readiness }) => readiness.routeEligible).map(({ mission }) => mission.id),
  );
  const routeMissionIds = new Set(state.runRouteProgress?.[state.activeFleetEntryId] || []);
  const completedMissionStates = state.missions
    .filter((mission) => routeMissionIds.has(mission.id) && isMissionCompleted(mission))
    .map((mission) => ({ mission, readiness: { routeEligible: true } }));
  const optimizedRoute = buildOptimizedRunRoutePoints([...missionStates, ...completedMissionStates], completedPickupKeys);
  const points = [...optimizedRoute.completedPoints, ...optimizedRoute.plannedPoints].map((point) => {
    const key = getRunRoutePointKey(point);
    return {
      ...point,
      key,
      completed: Boolean(point.completed),
    };
  });
  const openPoints = points.filter((point) => !point.completed);
  // Several actions (or visits) at one location are one progress target.
  // Finishing only one package must not add an extra "completed stop" while
  // the rest of the same pickup is still open.
  const progressLocations = new Map();
  points.forEach((point) => {
    const location = normalizeRunRouteLocation(point.dropoff);
    progressLocations.set(location, (progressLocations.get(location) ?? true) && point.completed);
  });
  const priorityLocation = optimizedRoute.priorityReachable
    ? String(state.runPriorityRouteLocation || "").trim()
    : "";
  const selectedPoint = openPoints.find((point) => point.key === state.selectedRunRoutePointKey) || openPoints[0] || null;
  const selectedIndex = selectedPoint ? openPoints.findIndex((point) => point.key === selectedPoint.key) : -1;
  const routeStop = selectedPoint ? stopByLocation.get(selectedPoint.dropoff) || null : null;
  const cargoGroups = selectedPoint?.hasCargo
    ? buildStopCargoGroups(selectedPoint.dropoff).filter(({ mission }) => (
        eligibleMissionIds.has(mission.id)
        && (selectedPoint.missionIds || []).includes(mission.id)
      ))
    : [];
  const pickupEntries = selectedPoint?.hasPickup
    ? getAllLoads().filter(({ mission, load }) => (
        (selectedPoint.missionIds || []).includes(mission.id)
        && getLoadPickup(load, mission) === selectedPoint.dropoff
      ))
    : [];
  const placedPickupEntries = pickupEntries.filter(({ mission, load }) => isLoadPlacementInCurrentLayout(load, mission));
  const pendingPickupSegments = selectedPoint?.hasPickup
    ? missionStates.flatMap(({ mission, readiness }) => {
        if (!readiness.routeEligible || !(selectedPoint.missionIds || []).includes(mission.id)) return [];
        return getMissionSegments(mission)
          .filter((segment) => Boolean(segment.quantityPending) && String(segment.pickup || mission.pickup || "").trim() === selectedPoint.dropoff)
          .map((segment) => ({ mission, segment }));
      })
    : [];
  const selectedLocationKey = normalizeRunRouteLocation(selectedPoint?.dropoff);
  const courierPickupEntries = selectedPoint?.hasCourierPickup
    ? missionStates.flatMap(({ mission, readiness }) => {
        if (!readiness.routeEligible || !(selectedPoint.missionIds || []).includes(mission.id)) return [];
        return getMissionServiceDetails(mission).packages
          .filter((entry) => !entry.pickedUpAt && !entry.deliveredAt && normalizeRunRouteLocation(entry.pickup) === selectedLocationKey)
          .map((entry) => ({ mission, package: entry }));
      })
    : [];
  const courierDeliveryEntries = selectedPoint?.hasCourierDelivery
    ? missionStates.flatMap(({ mission, readiness }) => {
        if (!readiness.routeEligible || !(selectedPoint.missionIds || []).includes(mission.id)) return [];
        return getMissionServiceDetails(mission).packages
          .filter((entry) => entry.pickedUpAt && !entry.deliveredAt && normalizeRunRouteLocation(entry.destination) === selectedLocationKey)
          .map((entry) => ({ mission, package: entry }));
      })
    : [];
  const currentLocation = String(state.currentLocation || "").trim();
  const arrived = Boolean(
    selectedPoint
      && currentLocation
      && currentLocation.toLocaleLowerCase("de-DE") === selectedPoint.dropoff.toLocaleLowerCase("de-DE"),
  );

  return {
    flightRoute,
    missionStates,
    eligibleMissionIds,
    points,
    openPoints,
    selectedPoint,
    selectedIndex,
    nextPoint: selectedIndex >= 0 ? openPoints[selectedIndex + 1] || null : null,
    priorityLocation,
    routeStop,
    cargoGroups,
    pickupEntries,
    placedPickupEntries,
    pendingPickupSegments,
    courierPickupEntries,
    courierDeliveryEntries,
    currentLocation,
    arrived,
    progressTotal: progressLocations.size,
    completedCount: [...progressLocations.values()].filter(Boolean).length,
  };
}

function getRunStopStatus(runState) {
  const point = runState.selectedPoint;
  if (!point) {
    return {
      tone: "complete",
      title: cargoText("run.stop.completeTitle", "Route abgeschlossen"),
      text: cargoText("run.stop.completeText", "Alle vorgesehenen Halte sind erledigt."),
    };
  }
  if (!runState.arrived) {
    return {
      tone: "en-route",
      title: cargoText("run.stop.enRouteTitle", "Anreise"),
      text: cargoText("run.stop.enRouteText", "Bestätige deine Ankunft, sobald du {target} erreicht hast.", { target: point.dropoff }),
    };
  }

  const details = [];
  const pendingAmountCount = runState.pendingPickupSegments.length;
  const unplacedPickupCount = Math.max(runState.pickupEntries.length - runState.placedPickupEntries.length, 0);
  const blockedDeliveryCount = runState.cargoGroups.filter((group) => group.analysis.status !== "ready").length;
  const readyDeliveryCount = runState.cargoGroups.length - blockedDeliveryCount;
  const courierPickupCount = runState.courierPickupEntries.length;
  const courierDeliveryCount = runState.courierDeliveryEntries.length;
  const serviceCount = runState.routeStop?.activeServiceMissionIds?.length || 0;

  if (pendingAmountCount > 0) {
    details.push(cargoText(
      pendingAmountCount === 1 ? "run.stop.amountOpen" : "run.stop.amountsOpen",
      pendingAmountCount === 1 ? "1 Mengenangabe offen" : "{count} Mengenangaben offen",
      { count: pendingAmountCount },
    ));
  }
  if (unplacedPickupCount > 0) {
    details.push(cargoText("run.stop.loadsWaiting", "{count} Container noch verladen", { count: unplacedPickupCount }));
  } else if (point.hasPickup && runState.pickupEntries.length > 0 && pendingAmountCount === 0) {
    details.push(cargoText("run.stop.pickupConfirm", "Abholung bestätigen"));
  }
  if (readyDeliveryCount > 0) {
    details.push(cargoText(
      readyDeliveryCount === 1 ? "run.stop.deliveryReady" : "run.stop.deliveriesReady",
      readyDeliveryCount === 1 ? "1 Lieferung entladebereit" : "{count} Lieferungen entladebereit",
      { count: readyDeliveryCount },
    ));
  }
  if (blockedDeliveryCount > 0) {
    details.push(cargoText(
      blockedDeliveryCount === 1 ? "run.stop.deliveryBlocked" : "run.stop.deliveriesBlocked",
      blockedDeliveryCount === 1 ? "1 Lieferung noch nicht entladebereit" : "{count} Lieferungen noch nicht entladebereit",
      { count: blockedDeliveryCount },
    ));
  }
  if (courierPickupCount > 0) {
    details.push(cargoText(
      courierPickupCount === 1 ? "run.stop.courierPickup" : "run.stop.courierPickups",
      courierPickupCount === 1 ? "1 Paket abholen" : "{count} Pakete abholen",
      { count: courierPickupCount },
    ));
  }
  if (courierDeliveryCount > 0) {
    details.push(cargoText(
      courierDeliveryCount === 1 ? "run.stop.courierDelivery" : "run.stop.courierDeliveries",
      courierDeliveryCount === 1 ? "1 Paket übergeben" : "{count} Pakete übergeben",
      { count: courierDeliveryCount },
    ));
  }
  if (serviceCount > 0) {
    details.push(cargoText(
      serviceCount === 1 ? "run.stop.serviceOpen" : "run.stop.servicesOpen",
      serviceCount === 1 ? "1 Einsatz abschließen" : "{count} Einsätze abschließen",
      { count: serviceCount },
    ));
  }

  const needsAttention = pendingAmountCount > 0 || unplacedPickupCount > 0 || blockedDeliveryCount > 0;
  return {
    tone: needsAttention ? "attention" : "action",
    title: needsAttention
      ? cargoText("run.stop.attentionTitle", "Vor dem Weiterflug offen")
      : cargoText("run.stop.actionTitle", "Aktionen am Halt"),
    text: details.join(" · ") || cargoText("run.stop.noAction", "An diesem Halt ist keine weitere Aktion offen."),
  };
}
