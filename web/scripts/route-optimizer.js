(function initRouteOptimizerModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RouteOptimizerModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DELIVERY_KINDS = new Set(["delivery", "courier-delivery"]);

  function normalizeLocation(value) {
    return String(value || "").trim().toLocaleLowerCase("de-DE");
  }

  function normalizeTask(task, index = 0) {
    const location = String(task?.location || "").trim();
    const firstOrder = Number(task?.firstOrder);
    return {
      ...task,
      id: String(task?.id || `task-${index}`).trim(),
      kind: String(task?.kind || "service").trim(),
      location,
      locationKey: normalizeLocation(task?.locationKey || location),
      dependencies: [...new Set(
        (Array.isArray(task?.dependencies) ? task.dependencies : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      )],
      blockerLocationKeys: [...new Set(
        (Array.isArray(task?.blockerLocationKeys) ? task.blockerLocationKeys : [])
          .map(normalizeLocation)
          .filter(Boolean),
      )],
      firstOrder: Number.isFinite(firstOrder) ? firstOrder : index,
      completed: Boolean(task?.completed),
      onBoard: Boolean(task?.onBoard),
      unloadBlocked: Boolean(task?.unloadBlocked),
    };
  }

  function buildLocationIndex(locations = []) {
    const index = new Map();
    (Array.isArray(locations) ? locations : []).forEach((entry) => {
      if (!entry || entry.status === "archived") return;
      const name = String(entry.name || "").trim();
      const nameKey = normalizeLocation(name);
      if (!nameKey) return;
      const profile = {
        name,
        nameKey,
        parentKey: normalizeLocation(entry.parentLocation),
        systemKey: normalizeLocation(entry.starSystem),
        type: String(entry.type || "other").trim(),
      };
      index.set(nameKey, profile);
      (Array.isArray(entry.aliases) ? entry.aliases : []).forEach((alias) => {
        const aliasKey = normalizeLocation(alias);
        if (aliasKey && !index.has(aliasKey)) index.set(aliasKey, profile);
      });
    });
    return index;
  }

  function getLocationAffinity(fromKey, toKey, locationIndex) {
    const normalizedFrom = normalizeLocation(fromKey);
    const normalizedTo = normalizeLocation(toKey);
    if (!normalizedFrom || !normalizedTo) return { cost: 5, reasonCode: "order" };
    if (normalizedFrom === normalizedTo) return { cost: 0, reasonCode: "current" };

    const from = locationIndex.get(normalizedFrom);
    const to = locationIndex.get(normalizedTo);
    if (!from || !to) return { cost: 5, reasonCode: "order" };
    const sameParent = from.parentKey && from.parentKey === to.parentKey;
    const parentChild = from.nameKey === to.parentKey || to.nameKey === from.parentKey;
    if (sameParent || parentChild) return { cost: 1, reasonCode: "same-area" };
    if (from.systemKey && from.systemKey === to.systemKey) return { cost: 3, reasonCode: "same-system" };
    if (from.systemKey && to.systemKey && from.systemKey !== to.systemKey) {
      return { cost: 9, reasonCode: "different-system" };
    }
    return { cost: 5, reasonCode: "order" };
  }

  function compareTasks(left, right) {
    const priority = { delivery: 0, "courier-delivery": 0, pickup: 1, "courier-pickup": 1, service: 2 };
    return (priority[left.kind] ?? 9) - (priority[right.kind] ?? 9)
      || left.firstOrder - right.firstOrder
      || left.location.localeCompare(right.location, "de")
      || left.id.localeCompare(right.id, "de");
  }

  function collectLocationBatch(tasks, locationKey, processedTaskIds) {
    const processed = new Set(processedTaskIds);
    const batch = [];
    let foundTasks = true;
    while (foundTasks) {
      foundTasks = false;
      tasks
        .filter((task) => (
          !processed.has(task.id)
          && task.locationKey === locationKey
          && task.dependencies.every((dependency) => processed.has(dependency))
        ))
        .sort(compareTasks)
        .forEach((task) => {
          processed.add(task.id);
          batch.push(task);
          foundTasks = true;
        });
    }
    return batch;
  }

  function collectPriorityDependencyIds(tasks, priorityLocationKey) {
    if (!priorityLocationKey) return new Set();
    const byId = new Map(tasks.map((task) => [task.id, task]));
    const required = new Set();
    const visit = (taskId) => {
      const task = byId.get(taskId);
      if (!task) return;
      task.dependencies.forEach((dependency) => {
        if (required.has(dependency)) return;
        required.add(dependency);
        visit(dependency);
      });
    };
    tasks.filter((task) => task.locationKey === priorityLocationKey).forEach((task) => visit(task.id));
    return required;
  }

  function buildCandidate({
    locationKey,
    tasks,
    processedTaskIds,
    plannerLocationKey,
    currentLocationKey,
    priorityLocationKey,
    priorityDependencyIds,
    locationIndex,
  }) {
    const batch = collectLocationBatch(tasks, locationKey, processedTaskIds);
    const affinity = getLocationAffinity(plannerLocationKey, locationKey, locationIndex);
    const isCurrentLocation = Boolean(currentLocationKey && locationKey === currentLocationKey);
    const isPriority = Boolean(priorityLocationKey && locationKey === priorityLocationKey);
    const isPriorityPrerequisite = batch.some((task) => priorityDependencyIds.has(task.id));
    const pendingTasks = tasks.filter((task) => !processedTaskIds.has(task.id));
    const clearsBlockedDelivery = pendingTasks.some((task) => (
      task.unloadBlocked && task.blockerLocationKeys.includes(locationKey)
    ));
    const onBoardDeliveries = batch.filter((task) => DELIVERY_KINDS.has(task.kind) && task.onBoard).length;
    const blockedDeliveries = batch.filter((task) => DELIVERY_KINDS.has(task.kind) && task.unloadBlocked).length;
    const deliveryCount = batch.filter((task) => DELIVERY_KINDS.has(task.kind)).length;
    const firstOrder = Math.min(...batch.map((task) => task.firstOrder));
    const score = (isCurrentLocation ? -10000 : 0)
      + (isPriority ? -8000 : 0)
      + (isPriorityPrerequisite ? -6500 : 0)
      + (clearsBlockedDelivery ? -1800 : 0)
      - onBoardDeliveries * 500
      + blockedDeliveries * 900
      + affinity.cost * 100
      - Math.max(batch.length - 1, 0) * 30
      - deliveryCount * 20
      + firstOrder * 0.0001;
    const reasonCodes = [];
    if (isCurrentLocation) reasonCodes.push("current");
    if (isPriority) reasonCodes.push("priority");
    if (isPriorityPrerequisite) reasonCodes.push("priority-prerequisite");
    if (clearsBlockedDelivery) reasonCodes.push("clearance");
    if (onBoardDeliveries > 0) reasonCodes.push("onboard");
    if (batch.length > 1) reasonCodes.push("combined");
    if (!isCurrentLocation && ["same-area", "same-system"].includes(affinity.reasonCode)) {
      reasonCodes.push(affinity.reasonCode);
    }
    if (reasonCodes.length === 0) reasonCodes.push("order");
    return {
      location: batch[0]?.location || "",
      locationKey,
      tasks: batch,
      score,
      reasonCodes,
      affinity: affinity.reasonCode,
      onBoardDeliveries,
      blockedDeliveries,
    };
  }

  function optimizeRouteTasks(inputTasks, options = {}) {
    const tasks = (Array.isArray(inputTasks) ? inputTasks : [])
      .map(normalizeTask)
      .filter((task) => task.id && task.locationKey);
    const knownTaskIds = new Set(tasks.map((task) => task.id));
    tasks.forEach((task) => {
      task.dependencies = task.dependencies.filter((dependency) => knownTaskIds.has(dependency));
    });
    const processedTaskIds = new Set(
      (Array.isArray(options.completedTaskIds) ? options.completedTaskIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    );
    tasks.filter((task) => task.completed).forEach((task) => processedTaskIds.add(task.id));
    const currentLocationKey = normalizeLocation(options.currentLocation);
    const priorityLocationKey = normalizeLocation(options.priorityLocation);
    const priorityDependencyIds = collectPriorityDependencyIds(tasks, priorityLocationKey);
    const locationIndex = buildLocationIndex(options.locations);
    const priorityReachable = Boolean(
      priorityLocationKey
      && tasks.some((task) => !processedTaskIds.has(task.id) && task.locationKey === priorityLocationKey),
    );
    const batches = [];
    let plannerLocationKey = currentLocationKey;

    while (tasks.some((task) => !processedTaskIds.has(task.id))) {
      let availableTasks = tasks.filter((task) => (
        !processedTaskIds.has(task.id)
        && task.dependencies.every((dependency) => processedTaskIds.has(dependency))
      ));
      if (availableTasks.length === 0) {
        availableTasks = tasks.filter((task) => !processedTaskIds.has(task.id)).sort(compareTasks).slice(0, 1);
      }
      const locationKeys = [...new Set(availableTasks.map((task) => task.locationKey))];
      const candidates = locationKeys
        .map((locationKey) => buildCandidate({
          locationKey,
          tasks,
          processedTaskIds,
          plannerLocationKey,
          currentLocationKey: batches.length === 0 ? currentLocationKey : "",
          priorityLocationKey,
          priorityDependencyIds,
          locationIndex,
        }))
        .filter((candidate) => candidate.tasks.length > 0)
        .sort((left, right) => (
          left.score - right.score
          || compareTasks(left.tasks[0], right.tasks[0])
          || left.location.localeCompare(right.location, "de")
        ));
      const selected = candidates[0];
      if (!selected) break;
      selected.tasks.forEach((task) => processedTaskIds.add(task.id));
      batches.push(selected);
      plannerLocationKey = selected.locationKey;
    }

    return {
      batches,
      orderedTaskIds: batches.flatMap((batch) => batch.tasks.map((task) => task.id)),
      priorityReachable,
    };
  }

  return {
    normalizeLocation,
    buildLocationIndex,
    getLocationAffinity,
    optimizeRouteTasks,
  };
});
