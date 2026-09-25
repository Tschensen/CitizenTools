(function initUnloadGuidanceModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.UnloadGuidanceModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function getPlacedDimensions(load) {
    const width = Math.max(1, Number(load?.width) || 1);
    const depth = Math.max(1, Number(load?.depth) || 1);
    const height = Math.max(1, Number(load?.height) || 1);
    const rotated = Boolean(load?.placement?.rotated ?? load?.rotated);
    return {
      width: rotated ? depth : width,
      depth: rotated ? width : depth,
      height,
    };
  }

  function buildFootprint(load) {
    if (!load?.placement) return [];
    const dimensions = getPlacedDimensions(load);
    const cells = [];
    for (let rowOffset = 0; rowOffset < dimensions.depth; rowOffset += 1) {
      for (let colOffset = 0; colOffset < dimensions.width; colOffset += 1) {
        cells.push({
          row: Number(load.placement.row) + rowOffset,
          col: Number(load.placement.col) + colOffset,
        });
      }
    }
    return cells;
  }

  function loadCoversCell(load, row, col) {
    return buildFootprint(load).some((cell) => cell.row === row && cell.col === col);
  }

  function compareEntriesByPlacement(left, right) {
    const leftSlot = String(left?.load?.placement?.slotId || "");
    const rightSlot = String(right?.load?.placement?.slotId || "");
    const slotCompare = leftSlot.localeCompare(rightSlot, "de", { numeric: true });
    if (slotCompare !== 0) return slotCompare;
    return (Number(left?.load?.placement?.z) || 0) - (Number(right?.load?.placement?.z) || 0);
  }

  function findBlockingEntries(targetEntry, remainingEntries, allowedLoadIds = new Set()) {
    const load = targetEntry?.load;
    if (!load?.placement) return [];
    const dimensions = getPlacedDimensions(load);
    const targetTop = (Number(load.placement.z) || 0) + dimensions.height;
    const footprint = buildFootprint(load);
    const blockers = new Map();

    (Array.isArray(remainingEntries) ? remainingEntries : []).forEach((entry) => {
      const otherLoad = entry?.load;
      if (!otherLoad?.placement || otherLoad.id === load.id || allowedLoadIds.has(otherLoad.id)) return;
      if ((Number(otherLoad.placement.z) || 0) < targetTop) return;
      if (footprint.some((cell) => loadCoversCell(otherLoad, cell.row, cell.col))) {
        blockers.set(otherLoad.id, entry);
      }
    });

    return [...blockers.values()].sort(compareEntriesByPlacement);
  }

  function analyzeUnloadEntries(targetEntries, remainingEntries) {
    const normalizedTargets = Array.isArray(targetEntries) ? targetEntries : [];
    const normalizedRemaining = Array.isArray(remainingEntries) ? remainingEntries : [];
    const targetIds = new Set(normalizedTargets.map(({ load }) => load?.id).filter(Boolean));
    const blockedEntries = [];
    const freeEntries = [];
    const blockerMap = new Map();
    const blockerDetails = [];

    normalizedTargets.forEach((entry) => {
      const blockers = findBlockingEntries(entry, normalizedRemaining, targetIds);
      if (blockers.length > 0) {
        blockedEntries.push(entry);
        blockerDetails.push({ targetEntry: entry, blockers });
        blockers.forEach((blocker) => blockerMap.set(blocker.load.id, blocker));
      } else {
        freeEntries.push(entry);
      }
    });

    return {
      targetEntries: normalizedTargets,
      freeEntries,
      blockedEntries,
      blockers: [...blockerMap.values()].sort(compareEntriesByPlacement),
      blockerDetails,
    };
  }

  return {
    analyzeUnloadEntries,
    buildFootprint,
    compareEntriesByPlacement,
    findBlockingEntries,
    getPlacedDimensions,
    loadCoversCell,
  };
});
