// Planner layout selection, level filters and layout controls.
async function syncLayoutToActiveFleetShip({ confirmChange = false, persistChanges = true } = {}) {
  const activeEntry = currentActiveFleetEntry();
  const shipProfile = currentActiveShipProfile();

  if (!activeEntry || !shipProfile || !hasShipCargoGrid(shipProfile)) {
    return true;
  }

  const overloadMode = state.layout.overloadMode || getAutoloadSettings().allowOverload;
  const shipDefinition = getShipGridDefinition(shipProfile, overloadMode);
  if (doesLayoutMatchDefinition(shipDefinition, activeEntry.id, activeEntry.shipId)) {
    return true;
  }

  const nextLayout = {
    shipId: activeEntry.shipId,
    fleetEntryId: activeEntry.id,
    presetId: activeEntry.shipId,
    rows: shipDefinition.rows,
    cols: shipDefinition.cols,
    defaultHeight: shipDefinition.defaultHeight,
    overloadMode: shipDefinition.overloadMode,
  };

  if (confirmChange && !(await confirmShipLayoutChange(nextLayout))) {
    return false;
  }

  applyLayoutDefinition(shipDefinition, activeEntry.id, activeEntry.shipId, overloadMode);
  state = pruneInvalidPlacements(state);
  if (persistChanges) persist();
  return true;
}

function ensureFleetPlannerSelection() {
  // Rendering a remote snapshot is not a user edit on this device.
  syncLayoutToActiveFleetShip({ persistChanges: false });
}
function ensureSelectedLoad() {
  const entries = getAllLoads().filter(({ mission, load }) =>
    !isLoadDelivered(load) && canMissionUseCurrentCargoGrid(mission),
  );
  if (entries.length === 0) {
    if (state.selectedLoadId !== null) {
      state.selectedLoadId = null;
      state.selectionCleared = false;
    }
    return null;
  }

  const current = findLoadById(state.selectedLoadId);
  if (current && entries.some(({ load }) => load.id === current.load.id)) {
    return current;
  }

  if (state.selectionCleared) {
    return null;
  }

  const preferredEntry = entries.find(({ load }) => !load.placement);
  if (!preferredEntry) {
    return null;
  }
  state.selectedLoadId = preferredEntry.load.id;
  state.selectionCleared = false;
  return preferredEntry;
}

function renderLevelFilters() {
  const targets = [topdownLevelFilter, isoLevelFilter].filter(Boolean);
  if (targets.length === 0) return;

  const { bounds: { maxHeight } } = getCargoViewGeometry();
  const options = ["all", ...Array.from({ length: maxHeight }, (_, index) => index)];
  const current = getEffectiveLevelFilter(maxHeight);
  const markup = options
    .map((option) => {
      const activeClass = option === current ? " is-active" : "";
      const label = option === "all"
        ? cargoText("contracts.level.all", "Alle Ebenen")
        : cargoText("contracts.level.level", "Ebene {number}", { number: Number(option) + 1 });
      const value = String(option);
      return `<button type="button" class="level-filter-button${activeClass}" data-level-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  targets.forEach((target) => {
    target.innerHTML = markup;
    target.querySelectorAll("[data-level-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.levelFilter;
        state.levelFilter = value === "all" ? "all" : clamp(Number(value) || 0, 0, 8);
        persist();
        render();
      });
    });
  });
}

function registerCargoLayoutEvents() {
  document.querySelectorAll("[data-iso-zoom-action]").forEach((button) => {
    button.addEventListener("click", () => changeIsoZoom(button.dataset.isoZoomAction));
  });

  presetSelect.addEventListener("change", async () => {
    const selection = decodeFleetPresetValue(presetSelect.value);
    if (selection.isCustom) {
      const nextLayout = {
        shipId: "",
        fleetEntryId: "",
        presetId: "custom",
        rows: state.layout.rows,
        cols: state.layout.cols,
        defaultHeight: state.layout.defaultHeight,
        overloadMode: false,
      };
      if (!(await confirmShipLayoutChange(nextLayout))) {
        syncLayoutInputs();
        return;
      }
      state.layout.shipId = "";
      state.layout.fleetEntryId = "";
      state.layout.presetId = "custom";
      state.layout.blockedSlots = [];
      state.layout.heightOverrides = {};
      state.layout.overloadMode = false;
      state.layout.overloadSlotIds = [];
      persist();
      render();
      return;
    }

    const selectedShip = getCargoFleetEntries().find((entry) => entry.id === selection.fleetEntryId) || null;
    if (!selectedShip) {
      syncLayoutInputs();
      return;
    }
    const shipDefinition = getShipGridDefinition(findShipLibraryEntryById(selectedShip.shipId), selection.overloadMode);
    const nextLayout = {
      shipId: selectedShip.shipId,
      fleetEntryId: selectedShip.id,
      presetId: selectedShip.shipId,
      rows: shipDefinition.rows,
      cols: shipDefinition.cols,
      defaultHeight: shipDefinition.defaultHeight,
      overloadMode: selection.overloadMode,
    };
    if (!(await confirmShipLayoutChange(nextLayout))) {
      syncLayoutInputs();
      return;
    }
    applyLayoutDefinition(shipDefinition, selectedShip.id, selectedShip.shipId, selection.overloadMode);
    state = pruneInvalidPlacements(state);
    persist();
    render();
  });

  layoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selection = decodeFleetPresetValue(presetSelect.value);
    if (selection.isCustom) {
      const nextLayout = {
        shipId: "",
        fleetEntryId: "",
        presetId: "custom",
        rows: clamp(Number(layoutForm.rows.value) || 4, 2, MAX_GRID_ROWS),
        cols: clamp(Number(layoutForm.cols.value) || 6, 2, 12),
        defaultHeight: clamp(Number(layoutForm.cellHeight.value) || 3, 1, 8),
        overloadMode: false,
      };
      if (!(await confirmShipLayoutChange(nextLayout))) {
        syncLayoutInputs();
        return;
      }
      state.layout.shipId = "";
      state.layout.fleetEntryId = "";
      state.layout.presetId = "custom";
      state.layout.rows = nextLayout.rows;
      state.layout.cols = nextLayout.cols;
      state.layout.defaultHeight = nextLayout.defaultHeight;
      state.layout.blockedSlots = [];
      state.layout.heightOverrides = {};
      state.layout.overloadMode = false;
      state.layout.overloadSlotIds = [];
      state = pruneInvalidPlacements(state);
      persist();
      render();
      return;
    }

    const selectedShip = getCargoFleetEntries().find((entry) => entry.id === selection.fleetEntryId) || null;
    if (!selectedShip) {
      syncLayoutInputs();
      return;
    }
    const shipDefinition = getShipGridDefinition(findShipLibraryEntryById(selectedShip.shipId), selection.overloadMode);
    const nextLayout = {
      shipId: selectedShip.shipId,
      fleetEntryId: selectedShip.id,
      presetId: selectedShip.shipId,
      rows: shipDefinition.rows,
      cols: shipDefinition.cols,
      defaultHeight: shipDefinition.defaultHeight,
      overloadMode: selection.overloadMode,
    };

    if (!(await confirmShipLayoutChange(nextLayout))) {
      syncLayoutInputs();
      return;
    }

    applyLayoutDefinition(shipDefinition, selectedShip.id, selectedShip.shipId, selection.overloadMode);
    state = pruneInvalidPlacements(state);
    persist();
    render();
  });
}
