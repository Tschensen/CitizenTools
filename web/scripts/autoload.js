(function initAutoloadModule(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.AutoloadModule = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const AUTOLOAD_STRATEGIES = Object.freeze(["compact", "route", "largest"]);

  function normalizeAutoloadStrategy(value) {
    const normalized = String(value || "").trim().toLowerCase();
    return AUTOLOAD_STRATEGIES.includes(normalized) ? normalized : "compact";
  }

  function normalizeAutoloadSettings(value) {
    return {
      strategy: normalizeAutoloadStrategy(value?.strategy),
      fillOrder: ['left', 'right'].includes(value?.fillOrder) ? value.fillOrder : 'rows',
      allowOverload: Boolean(value?.allowOverload),
    };
  }

  function getLoadMetric(entry, key) {
    const value = Number(entry?.load?.[key]);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function compareCompactEntries(left, right) {
    const leftWidth = getLoadMetric(left, "width");
    const leftDepth = getLoadMetric(left, "depth");
    const rightWidth = getLoadMetric(right, "width");
    const rightDepth = getLoadMetric(right, "depth");
    const leftArea = leftWidth * leftDepth;
    const rightArea = rightWidth * rightDepth;
    const areaCompare = rightArea - leftArea;
    if (areaCompare !== 0) return areaCompare;
    const longestSideCompare = Math.max(rightWidth, rightDepth) - Math.max(leftWidth, leftDepth);
    if (longestSideCompare !== 0) return longestSideCompare;
    const scuCompare = getLoadMetric(right, "scu") - getLoadMetric(left, "scu");
    if (scuCompare !== 0) return scuCompare;
    const segmentCompare = (Number(left?.segmentOrder) || 0) - (Number(right?.segmentOrder) || 0);
    if (segmentCompare !== 0) return segmentCompare;
    return String(left?.load?.label || "").localeCompare(String(right?.load?.label || ""), "de", { numeric: true });
  }

  function compareLargestEntries(left, right) {
    const scuCompare = getLoadMetric(right, "scu") - getLoadMetric(left, "scu");
    if (scuCompare !== 0) return scuCompare;
    const volumeCompare = (
      getLoadMetric(right, "width") * getLoadMetric(right, "depth") * getLoadMetric(right, "height")
    ) - (
      getLoadMetric(left, "width") * getLoadMetric(left, "depth") * getLoadMetric(left, "height")
    );
    if (volumeCompare !== 0) return volumeCompare;
    return compareCompactEntries(left, right);
  }

  function compareRouteEntries(left, right) {
    const routeCompare = (Number(right?.routeRank) || 0) - (Number(left?.routeRank) || 0);
    return routeCompare || compareCompactEntries(left, right);
  }

  function sortAutoloadEntries(entries, strategy = "compact") {
    const normalizedStrategy = normalizeAutoloadStrategy(strategy);
    const comparator = normalizedStrategy === "route"
      ? compareRouteEntries
      : normalizedStrategy === "largest"
        ? compareLargestEntries
        : compareCompactEntries;
    return [...(Array.isArray(entries) ? entries : [])].sort(comparator);
  }

  function normalizeCargoArea(value) {
    return ['left', 'right'].includes(value) ? value : 'all';
  }

  function placementArea(footprint, cols) {
    if (!footprint?.length) return 'center';
    if (footprint.every(cell => cell.col < Math.floor(cols / 2))) return 'left';
    if (footprint.every(cell => cell.col >= Math.ceil(cols / 2))) return 'right';
    return 'center';
  }

  function sortPlacementCandidates(candidates, fillOrder = 'rows') {
    const sideRank = candidate => fillOrder === 'rows' ? 0 : candidate.area === fillOrder ? 0 : candidate.area === 'center' ? 1 : 2;
    return [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) =>
      (Number(left?.overloadCellCount) || 0) - (Number(right?.overloadCellCount) || 0)
        || sideRank(left) - sideRank(right)
        || (Number(left?.newFloorCells) || 0) - (Number(right?.newFloorCells) || 0)
        || (Number(left?.row) || 0) - (Number(right?.row) || 0)
        || ((Number(left?.col) || 0) - (Number(right?.col) || 0)) * (fillOrder === 'right' ? -1 : 1)
        || (Number(right?.baseZ) || 0) - (Number(left?.baseZ) || 0)
        || (Number(left?.rotationIndex) || 0) - (Number(right?.rotationIndex) || 0),
    );
  }

  return {
    AUTOLOAD_STRATEGIES,
    normalizeAutoloadStrategy,
    normalizeAutoloadSettings,
    sortAutoloadEntries,
    sortPlacementCandidates,
    normalizeCargoArea,
    placementArea,
  };
});
