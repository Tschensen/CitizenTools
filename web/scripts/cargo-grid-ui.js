// Cargo-grid rendering, placement, stacking, zoom, and autoload integration.
function setCargoButtonIcon(button, icon, label) {
  if (!button) return;
  const paths = {
    autoload: 'M3 4h6v6H3z M3 14h6v6H3z M15 3v12 M11 11l4 4 4-4 M12 20h9',
    unload: 'M3 10h10v11H3z M8 10V6h12 M16 2l4 4-4 4',
    unloadMission: 'M3 3h9v18H3z M6 7h3 M6 11h3 M14 12h8 M18 8l4 4-4 4',
    unloadAll: 'M4 20V7 M1 10l3-3 3 3 M12 20V3 M9 6l3-3 3 3 M20 20V7 M17 10l3-3 3 3',
    front: 'M9 14a3 4 0 1 0 6 0 3 4 0 1 0-6 0 M1 15l8-2 M15 13l8 2 M12 10V3 M9 12l3-2 3 2 M8 19v2 M16 19v2',
    rear: 'M12 3v11 M1 14h22 M8 11l4 3 4-3 M6 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0 M14 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0',
    left: 'M2 15l5-4h9l3-6h2l-1 8 2 3H5z M7 11l2 4 M10 15l5 5h3l-3-5',
    right: 'M22 15l-5-4H8L5 5H3l1 8-2 3h17z M17 11l-2 4 M14 15l-5 5H6l3-5',
    top: 'M12 2c-1 0-2 2-2 4v3l-8 5v2l8-2v4l-3 2v2l5-1 5 1v-2l-3-2v-4l8 2v-2l-8-5V6c0-2-1-4-2-4z',
    rotate: 'M19 8a8 8 0 1 0 1 8 M19 2v6h-6',
    undo: 'M9 5L3 11l6 6 M3 11h11a6 6 0 0 1 6 6',
    fix: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
    unfix: 'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0 M12 14v3',
    select: 'M3 3l6 18 3-8 8-3z',
    deselect: 'M3 3l5 16 3-7 7-3z M16 16l6 6 M22 16l-6 6',
    focus: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M8 8h8v8H8z',
    reset: 'M4 8a9 9 0 1 1-1 8 M4 2v6h6 M9 10l3-2 3 2v5l-3 2-3-2z',
  };
  button.classList.add('cargo-icon-button');
  button.removeAttribute('data-i18n');
  button.setAttribute('aria-label', label);
  button.dataset.tooltip = label;
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[icon] || paths.select}"/></svg>`;
}

function renderShipGrid() {
  const { rows, cols } = state.layout;
  const cargoAreaContext = getAutoloadAreaContext();
  const selectedEntry = findLoadById(state.selectedLoadId);
  const selected = selectedEntry && canMissionUseCurrentCargoGrid(selectedEntry.mission) ? selectedEntry : null;
  const levelFilter = getEffectiveLevelFilter();
  shipGrid.innerHTML = "";
  shipGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

  const activeCells = buildActiveCells();
  const maxHeight = activeCells.reduce((best, cell) => Math.max(best, cell.capacity), 0);
  const overloadCellCount = activeCells.filter((cell) => cell.isOverload).length;
  const preset = currentPreset();
  const fleetShip = currentFleetShip();
  presetTitle.textContent = formatPlannerShipName(fleetShip, preset);
  presetDescription.textContent =
    fleetShip
      ? `${preset.description}${preset.overloadMode ? " Überladungsfelder sind gelb markiert und werden auf eigenes Risiko genutzt." : ""} Auswahl aus deiner Flotte: ${fleetShip.registration || "ohne Registriernummer"}.`
      : preset.id === "custom"
        ? "Nutze das freie Frachtgitter für Leihschiffe, fehlende Presets oder ein komplett eigenes Layout."
        : "Lege in der Flotte ein aktives Schiff mit verknüpftem Schiffsprofil an, damit es hier auswählbar wird.";
  presetStats.textContent = preset.officialCargoScu
    ? `${activeCells.length} Bodenfelder${overloadCellCount > 0 ? ` · ${overloadCellCount} Überladung` : ""} · bis ${maxHeight} SCU hoch · ${getTotalCapacity()} SCU Raster · offiziell ${preset.officialCargoScu} SCU${preset.overloadCargoScu ? ` · mit Überladung ${preset.officialCargoScu + preset.overloadCargoScu} SCU` : ""}`
    : `${activeCells.length} Bodenfelder · bis ${maxHeight} SCU hoch · ${getTotalCapacity()} SCU Gesamtvolumen`;

  for (let row = 0; row < rows; row += 1) {
    const rowElement = document.createElement("div");
    rowElement.className = "ship-row";
    rowElement.style.gridTemplateColumns = `repeat(${cols}, var(--ship-slot-size, minmax(0, 1fr)))`;

    for (let col = 0; col < cols; col += 1) {
      const slotId = createSlotId(row, col);
      if (isBlockedSlot(slotId)) {
        const blocked = document.createElement("div");
        blocked.className = "slot blocked";
        blocked.setAttribute("aria-hidden", "true");
        rowElement.appendChild(blocked);
        continue;
      }

      const capacity = getCellCapacityById(slotId);
      const stackHeight = getStackHeightAtCell(row, col);
      const stackEntries = getLoadsAtCell(row, col);
      const visibleEntries = filterEntriesByLevel(stackEntries, levelFilter);
      const topLoadEntry = visibleEntries.at(-1) ?? null;
      const candidate = selected ? resolvePlacementTarget(selected.load, row, col, selected.load.id) : null;
      const selectedCoversCell = selected ? loadCoversCell(selected.load, row, col) : false;
      const stackMarkup = renderStackBadges(visibleEntries);
      const stackSummary =
        visibleEntries.length > 1
          ? `<span class="slot-stack-count" data-count="${visibleEntries.length}" aria-label="${visibleEntries.length} Ebenen">${visibleEntries.length} Ebenen</span>`
          : "";
      const isAnchor = Boolean(
        topLoadEntry &&
          topLoadEntry.load.placement &&
          topLoadEntry.load.placement.row === row &&
          topLoadEntry.load.placement.col === col,
      );
      const isStopTarget = Boolean(topLoadEntry && isLoadInSelectedStop(topLoadEntry.load, topLoadEntry.mission));
      const slotButton = document.createElement("button");
      slotButton.className = "slot";
      slotButton.type = "button";
      slotButton.dataset.slotId = slotId;
      slotButton.style.setProperty("--fill", `${capacity === 0 ? 0 : (stackHeight / capacity) * 100}%`);
      if (isOverloadSlot(slotId)) {
        slotButton.classList.add("overload-slot");
      }

      if (topLoadEntry) {
        const { mission, load } = topLoadEntry;
        const levelMeta = formatLevelMeta(levelFilter, load.placement.z);
        const compactLabel = [
          slotId,
          isAnchor ? mission.title : `Teil von ${load.label}`,
          isAnchor ? load.label : mission.title,
          formatLoadRoute(load, mission),
          `${formatDimensions(load, placementRotation(load))} · ${load.scu} SCU`,
          `${stackHeight}/${capacity} hoch · ${levelMeta}`,
          visibleEntries.length > 1 ? `${visibleEntries.length} Ebenen` : "",
          candidate?.valid ? `Stapelbar auf z ${candidate.baseZ}` : "",
        ].filter(Boolean).join(" · ");
        slotButton.classList.add("filled");
        slotButton.title = compactLabel;
        slotButton.setAttribute("aria-label", compactLabel);
        if (isStopTarget) {
          slotButton.classList.add("stop-target");
        }
        if (visibleEntries.length > 1) {
          slotButton.classList.add("stacked");
        }
        if (!isAnchor) {
          slotButton.classList.add("continuation");
        }
        if (candidate?.valid) {
          slotButton.classList.add("stack-target");
        }
        slotButton.style.background = `linear-gradient(145deg, ${mission.color}, ${shadeColor(mission.color, -16)})`;
        slotButton.innerHTML = isAnchor
          ? `
            <span class="slot-name">${slotId}</span>
            <span class="slot-mission">${escapeHtml(mission.title)}</span>
            <span class="slot-note">${escapeHtml(load.label)}<br />${formatDimensions(load, placementRotation(load))} · ${load.scu} SCU</span>
            <span class="slot-capacity">${stackHeight}/${capacity} hoch · ${levelMeta}</span>
            ${stackSummary}
            ${stackMarkup}
            ${candidate?.valid ? `<span class="slot-hint">Stapelbar auf z ${candidate.baseZ}</span>` : ""}
            <span class="slot-clear">Zuordnung lösen</span>
          `
          : `
            <span class="slot-name">${slotId}</span>
            <span class="slot-mission">${escapeHtml(load.label)}</span>
            <span class="slot-note">Teil der Ladung</span>
            <span class="slot-capacity">${stackHeight}/${capacity} hoch · ${levelMeta}</span>
            ${stackSummary}
            ${stackMarkup}
            ${candidate?.valid ? `<span class="slot-hint">Stapelbar</span>` : ""}
          `;
      } else {
        const emptyLabel = [
          slotId,
          isOverloadSlot(slotId) ? "Überladung" : "Frei",
          `${stackHeight}/${capacity} hoch · ${formatLevelMeta(levelFilter)}`,
          candidate?.valid ? (candidate.baseZ > 0 ? `Stapelbar auf z ${candidate.baseZ}` : "Platzierbar") : "",
        ].filter(Boolean).join(" · ");
        slotButton.title = emptyLabel;
        slotButton.setAttribute("aria-label", emptyLabel);
        slotButton.innerHTML = `
          <span class="slot-name">${slotId}</span>
          <span class="slot-note">${isOverloadSlot(slotId) ? "Überladung" : "Frei"}</span>
          <span class="slot-capacity">${stackHeight}/${capacity} hoch · ${formatLevelMeta(levelFilter)}</span>
          ${candidate?.valid ? `<span class="slot-hint">${candidate.baseZ > 0 ? `Stapelbar auf z ${candidate.baseZ}` : "Platzierbar"}</span>` : ""}
        `;
      }

      if (candidate?.valid) {
        slotButton.classList.add("valid-target");
      }

      if (selectedCoversCell) {
        slotButton.classList.add("selected-load");
      }

      const cargoArea = cargoAreaContext.areas.find(area => area.id === cargoAreaContext.owners.get(slotId));
      if (cargoArea) {
        const areaLabel = cargoAreaName(cargoArea);
        slotButton.insertAdjacentHTML('beforeend', `<span class="cargo-area-dot" style="background:${cargoArea.color}" aria-hidden="true"></span>`);
        slotButton.title = [slotButton.title, areaLabel].filter(Boolean).join(' · ');
        slotButton.setAttribute('aria-label', [slotButton.getAttribute('aria-label') || slotId, areaLabel].join(' · '));
      }
      slotButton.addEventListener("click", () => handleCellClick(row, col));
      rowElement.appendChild(slotButton);
    }

    shipGrid.appendChild(rowElement);
  }
}

// Orthographic camera: cargo coordinates and placement rules remain unchanged.
const cargoCamera = CargoScene.createCamera();
let cargoScene = null;
function getCargoScene() { return cargoScene ||= CargoScene.create(isoView, { camera: cargoCamera }); }
let cargoCameraFrame = 0;
let cargoContextMenu = null;
let cargoContextReturnFocus = null;
const cargoUndoHistory = [];
let cargoPreviewKey = '';
let cargoStopFocusEnabled = false;

function toggleCargoFixed(load) {
  const entry = findLoadById(load.id);
  if (!entry || !load.placement || !canMissionUseCurrentCargoGrid(entry.mission) || isDispatcherMode()) return;
  const before = captureCargoAction();
  load.cargoFixed = !load.cargoFixed;
  recordCargoAction(before);
  persist(); render();
}

function unloadCargoBatch(missionId = null) {
  if (isDispatcherMode()) return;
  const placed = getPlacedLoadEntries();
  const entries = placed.filter(({mission}) => missionId === null || mission.id === missionId);
  if (!entries.length) return;
  const analysis = analyzeUnloadEntries(entries, placed);
  if (analysis.blockers.length) {
    void showAppNotice(formatUnloadBlockerSummary(analysis.blockers));
    return;
  }
  const before = captureCargoAction();
  entries.forEach(({load}) => { load.placement = null; load.cargoFixed = false; });
  state.selectedLoadId = entries[0].load.id;
  state.selectionCleared = false;
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  recordCargoAction(before);
  persist(); render();
}

function getCargoStopFocus(loads) {
  if (!cargoStopFocusEnabled) return null;
  const dropoff = buildFlightRouteState().currentDropoff;
  const targets = loads.filter(({mission, load}) => getLoadDropoff(load, mission) === dropoff);
  const analysis = analyzeUnloadEntries(targets, loads);
  return { dropoff, targets: new Set(targets.map(({load}) => load.id)),
    blockers: new Set(analysis.blockers.map(({load}) => load.id)),
    blocked: new Set(analysis.blockedEntries.map(({load}) => load.id)) };
}

function renderCargoStopFocus(focus) {
  document.getElementById('cargoStopFocusButton')?.setAttribute('aria-pressed', String(cargoStopFocusEnabled));
  const status = document.getElementById('cargoStopFocusStatus');
  if (!status) return;
  status.hidden = !focus;
  status.replaceChildren();
  if (!focus) return;
  const heading = document.createElement('strong');
  heading.textContent = focus.dropoff || t('contracts.iso.noStop');
  status.appendChild(heading);
  for (const [kind, count] of [['target', focus.targets.size], ['blocker', focus.blockers.size], ['blocked', focus.blocked.size]]) {
    const label = document.createElement('span');
    label.className = `cargo-stop-${kind}`;
    label.textContent = `${t(`contracts.iso.stop.${kind}`)}: ${count}`;
    status.appendChild(label);
  }
}

function cargoUndoFingerprint() {
  return JSON.stringify([state.missions, state.layout, state.activeFleetEntryId, isDispatcherMode()]);
}

function captureCargoAction() {
  const fingerprint = cargoUndoFingerprint();
  if (cargoUndoHistory.length && cargoUndoHistory.at(-1).after !== fingerprint) cargoUndoHistory.length = 0;
  return { fingerprint, selectedLoadId: state.selectedLoadId, selectionCleared: state.selectionCleared,
    loads: getAllLoads().map(({ load }) => ({ id: load.id, values: structuredClone({
      placement: load.placement, rotated: load.rotated, loadedAt: load.loadedAt, loadedByFleetEntryId: load.loadedByFleetEntryId, cargoFixed: load.cargoFixed,
    }) })) };
}

function recordCargoAction(before) {
  const after = cargoUndoFingerprint();
  if (after === before.fingerprint) return;
  cargoUndoHistory.push({ before, after });
  if (cargoUndoHistory.length > 30) cargoUndoHistory.shift();
}

function canUndoCargoAction() {
  if (cargoUndoHistory.length && cargoUndoHistory.at(-1).after !== cargoUndoFingerprint()) cargoUndoHistory.length = 0;
  return !isDispatcherMode() && cargoUndoHistory.length > 0;
}

function undoCargoAction() {
  if (!canUndoCargoAction()) return;
  const { before } = cargoUndoHistory.pop();
  before.loads.forEach(({ id, values }) => {
    const entry = findLoadById(id);
    if (entry) Object.assign(entry.load, structuredClone(values));
  });
  state.selectedLoadId = before.selectedLoadId;
  state.selectionCleared = before.selectionCleared;
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist(); render();
}

function clearCargoPlacementPreview() {
  cargoPreviewKey = '';
  isoView.querySelector('.cargo-placement-preview')?.remove();
  const status = document.getElementById('cargoPlacementStatus');
  if (status) status.textContent = '';
}

function showCargoPlacementPreview(row, col) {
  const key = `${state.selectedLoadId}:${row}:${col}`;
  if (cargoPreviewKey === key) return;
  clearCargoPlacementPreview();
  const entry = findLoadById(state.selectedLoadId);
  if (!entry || !canMissionUseCurrentCargoGrid(entry.mission)) return;
  cargoPreviewKey = key;
  const result = resolvePlacementTarget(entry.load, row, col, entry.load.id);
  const dims = getLoadDimensions(entry.load);
  const x = result.anchorCol ?? col, y = result.anchorRow ?? row;
  const z = result.baseZ ?? getStackHeightAtCell(row, col, entry.load.id);
  const group = getCargoScene().preview({x, y, z, ...dims}, `cargo-placement-preview ${result.valid ? 'is-valid' : 'is-invalid'}`);
  group.dataset.row = y; group.dataset.col = x; group.dataset.z = z;
  isoView.appendChild(group);
  const status = document.getElementById('cargoPlacementStatus');
  if (status) status.textContent = result.valid
    ? `${t('contracts.iso.previewValid')} · ${createSlotId(y,x)} · z ${z}`
    : `${t('contracts.iso.previewInvalid')} · ${result.reason}`;
}

function closeCargoContextMenu(restoreFocus = false) {
  if (!cargoContextMenu) return;
  cargoContextMenu.remove();
  cargoContextMenu = null;
  if (restoreFocus) (cargoContextReturnFocus || isoView).focus({ preventScroll: true });
}

function openCargoContextMenu(loadId, x, y, { warehouse = false } = {}) {
  const entry = findLoadById(loadId);
  if (!entry || Boolean(entry.load.placement) === warehouse || !canMissionUseCurrentCargoGrid(entry.mission)) return;
  state.selectedLoadId = loadId;
  state.selectionCleared = false;
  persist();
  render();
  const menu = document.createElement('div');
  cargoContextReturnFocus = warehouse ? document.getElementById('warehouseView') : isoView;
  menu.dataset.surface = warehouse ? 'warehouse' : 'ship';
  menu.className = 'cargo-context-menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', entry.load.label);
  const title = document.createElement('div');
  title.className = 'cargo-context-title';
  title.textContent = entry.load.label;
  menu.appendChild(title);
  const actions = warehouse ? [['rotate', 'common.rotate'], ['deselect', 'common.deselect']]
    : [['unload', 'contracts.iso.contextUnload'], ['rotate', 'common.rotate'], ['deselect', 'common.deselect'], ['fix', entry.load.cargoFixed ? 'contracts.iso.unfix' : 'contracts.iso.fix']];
  for (const [action, key] of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.dataset.cargoAction = action;
    button.textContent = t(key);
    button.disabled = Boolean(entry.load.cargoFixed && ['unload', 'rotate'].includes(action));
    button.addEventListener('click', () => {
      closeCargoContextMenu(true);
      const current = findLoadById(loadId);
      if (!current || !canMissionUseCurrentCargoGrid(current.mission)) return;
      if (action === 'unload') unloadLoad(current.load);
      else if (action === 'rotate') rotateLoad(current.load);
      else if (action === 'fix') toggleCargoFixed(current.load);
      else {
        state.selectedLoadId = null;
        state.selectionCleared = true;
        persist(); render();
      }
    });
    menu.appendChild(button);
  }
  menu.addEventListener('keydown', event => {
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault();
      closeCargoContextMenu(true);
    }
  });
  document.body.appendChild(menu);
  cargoContextMenu = menu;
  const box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth-box.width-8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight-box.height-8))}px`;
  menu.querySelector('button:not(:disabled)').focus({ preventScroll: true });
}

function projectCargoPoint(x, y, z) {
  return getCargoScene().project(x, y, z);
}

function requestCargoCameraRender() {
  if (cargoCameraFrame) return;
  cargoCameraFrame = requestAnimationFrame(() => {
    cargoCameraFrame = 0;
    renderIsometricView();
    syncStaticPreviews();
  });
}

function setupCargoCamera() {
  if (isoView.dataset.cameraReady) return;
  isoView.dataset.cameraReady = 'true';
  isoView.setAttribute('tabindex', '0');
  document.getElementById('cargoUndoButton')?.addEventListener('click', undoCargoAction);
  document.getElementById('cargoUnloadAllButton')?.addEventListener('click', () => unloadCargoBatch());
  document.getElementById('cargoFixButton')?.addEventListener('click', () => {
    const entry = findLoadById(state.selectedLoadId);
    if (entry) toggleCargoFixed(entry.load);
  });
  document.getElementById('cargoStopFocusButton')?.addEventListener('click', () => {
    cargoStopFocusEnabled = !cargoStopFocusEnabled;
    renderIsometricView(); syncStaticPreviews();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Control') clearCargoPlacementPreview();
    if (activePage !== 'load' || !event.ctrlKey || event.shiftKey || event.altKey || event.key.toLowerCase() !== 'z') return;
    if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if (!canUndoCargoAction()) return;
    event.preventDefault(); undoCargoAction();
  });
  isoView.addEventListener('pointerleave', clearCargoPlacementPreview);
  isoView.addEventListener('contextmenu', event => {
    const load = event.target.closest('.iso-load:not(.is-context-level)');
    if (!load) { closeCargoContextMenu(); return; }
    event.preventDefault();
    openCargoContextMenu(load.dataset.loadId, event.clientX, event.clientY);
  });
  document.addEventListener('pointerdown', event => {
    if (cargoContextMenu && !cargoContextMenu.contains(event.target)) closeCargoContextMenu();
  }, true);
  window.addEventListener('resize', () => closeCargoContextMenu());
  window.addEventListener('scroll', () => closeCargoContextMenu(), true);
  CargoScene.bindCamera(isoView, cargoCamera, {
    onChange: requestCargoCameraRender,
    onZoom: changeIsoZoom,
    onReset: () => changeIsoZoom('reset'),
    onHover: event => {
      const target = event.target.closest('[data-cargo-row]');
      if (!event.ctrlKey && target && !cargoContextMenu) showCargoPlacementPreview(Number(target.dataset.cargoRow), Number(target.dataset.cargoCol));
      else clearCargoPlacementPreview();
    },
  });
  isoView.addEventListener('keydown', event => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      const box = isoView.getBoundingClientRect();
      openCargoContextMenu(state.selectedLoadId, box.x + box.width/2, box.y + box.height/2);
      return;
    }
  });
  document.querySelectorAll('[data-cargo-camera]').forEach(button => {
    button.addEventListener('click', () => setCargoCamera(button.dataset.cargoCamera));
  });
  document.getElementById('cargoCameraUnload')?.addEventListener('click', () => {
    const entry = findLoadById(state.selectedLoadId);
    if (entry && canMissionUseCurrentCargoGrid(entry.mission)) unloadLoad(entry.load);
  });
}

function setCargoCamera(view) {
  if (!CargoScene.setView(cargoCamera, view)) return;
  if (view === 'reset') changeIsoZoom('reset');
  requestCargoCameraRender();
}

function getCargoCameraView() { return CargoScene.getView(cargoCamera); }

function cargoSceneItems(loads) {
  return loads.map(entry => {
    const { load } = entry;
    const dims = getLoadDimensions(load, placementRotation(load));
    return { id: load.id, x: load.placement.col, y: load.placement.row, z: load.placement.z,
      ...dims, data: entry };
  });
}

function buildVisibleCargoCells() {
  const cells = buildActiveCells();
  if (getAutoloadSettings().allowOverload) return cells;
  const profile = findShipLibraryEntryById(state.layout.shipId);
  return cells.map(cell => {
    const capacity = profile
      ? Math.min(cell.capacity, Number(profile.gridHeights?.[cell.slotId]) || 0)
      : cell.isOverload ? 0 : cell.capacity;
    return { ...cell, capacity, isOverload: false };
  }).filter(cell => cell.capacity > 0);
}

function getCargoViewGeometry() {
  const cells = buildVisibleCargoCells();
  const loads = getPlacedLoadEntries();
  // Include retained overload cargo even when permission to add more is off.
  return { cells, loads, bounds: CargoScene.bounds(cells, cargoSceneItems(loads)) };
}

function renderIsometricView() {
  clearCargoPlacementPreview();
  const undoButton = document.getElementById('cargoUndoButton');
  if (undoButton) undoButton.disabled = !canUndoCargoAction();
  closeCargoContextMenu();
  setupCargoCamera();
  const raw = findLoadById(state.selectedLoadId);
  const selected = raw && canMissionUseCurrentCargoGrid(raw.mission) ? raw : null;
  const unloadButton = document.getElementById('cargoCameraUnload');
  if (unloadButton) unloadButton.disabled = !selected?.load.placement || selected.load.cargoFixed || isDispatcherMode();
  const fixButton = document.getElementById('cargoFixButton');
  if (fixButton) {
    fixButton.disabled = !selected?.load.placement || isDispatcherMode();
    fixButton.textContent = t(selected?.load.cargoFixed ? 'contracts.iso.unfix' : 'contracts.iso.fix');
    fixButton.setAttribute('aria-pressed', String(Boolean(selected?.load.cargoFixed)));
  }
  document.querySelectorAll('[data-cargo-camera]').forEach(button => setCargoButtonIcon(button, button.dataset.cargoCamera, t(`contracts.iso.${button.dataset.cargoCamera === 'reset' ? 'resetView' : button.dataset.cargoCamera}`)));
  for (const [id, icon, key] of [
    ['cargoCameraUnload','unload','unloadSelected'], ['cargoUndoButton','undo','undo'],
    ['cargoFixButton',selected?.load.cargoFixed ? 'unfix' : 'fix',selected?.load.cargoFixed ? 'unfix' : 'fix'],
    ['cargoUnloadAllButton','unloadAll','unloadAll'], ['cargoStopFocusButton','focus','stopFocus'],
  ]) setCargoButtonIcon(document.getElementById(id), icon, t(`contracts.iso.${key}`));
  const { cells: activeCells, loads, bounds } = getCargoViewGeometry();
  const unloadAllButton = document.getElementById('cargoUnloadAllButton');
  if (unloadAllButton) unloadAllButton.disabled = !loads.length || isDispatcherMode();
  const stopFocus = getCargoStopFocus(loads);
  renderCargoStopFocus(stopFocus);
  const { minCol, minRow, maxCol, maxRow, maxHeight } = bounds;
  const level = getEffectiveLevelFilter(maxHeight);
  const cameraView = getCargoCameraView();
  getCargoScene().frame(bounds);
  document.querySelectorAll('[data-cargo-camera]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.cargoCamera === cameraView));
  });
  const namespace = 'http://www.w3.org/2000/svg';
  const cameraNormal = CargoScene.normal(cargoCamera);
  const scene = getCargoScene();
  const makePolygon = scene.polygon;
  scene.render({ cells: activeCells, items: cargoSceneItems(loads), level }, {
    floor: (cell, face) => {
      const candidate = selected ? resolvePlacementTarget(selected.load, cell.row, cell.col, selected.load.id) : null;
      face.polygon.dataset.row = cell.row;
      face.polygon.dataset.col = cell.col;
      face.polygon.dataset.cargoRow = cell.row;
      face.polygon.dataset.cargoCol = cell.col;
      const title = document.createElementNS(namespace, 'title');
      title.textContent = `${createSlotId(cell.row, cell.col)} · ${cell.capacity} SCU`;
      face.polygon.appendChild(title);
      if (cell.isOverload) face.polygon.classList.add('is-overload');
      if (candidate?.valid) face.polygon.classList.add('placeable');
      face.polygon.addEventListener('click', () => handleCellClick(cell.row, cell.col));
      const group = document.createElementNS(namespace, 'g');
      group.appendChild(face.polygon);
      const center = averagePoint(face.projected);
      group.appendChild(createSvgText(namespace, center.x, center.y + 4, 'iso-floor-label',
        cameraView === 'top' ? createSlotId(cell.row, cell.col) : String(cell.capacity)));
      return group;
    },
    face: ({item, x, y, z, definition, isContext, fragment: face}) => {
      const { mission, load } = item.data;
      const dims = item;
      const base = load.placement;
      face.polygon.setAttribute('fill', shadeColor(mission.color, definition.shade));
      const group = document.createElementNS(namespace, 'g');
      group.setAttribute('class', 'iso-load');
      if (isContext) group.classList.add('is-context-level');
      group.dataset.loadId = load.id;
      if (load.cargoFixed) group.classList.add('is-fixed');
      if (state.selectedLoadId === load.id) group.classList.add('selected');
      if (stopFocus ? stopFocus.targets.has(load.id) : isLoadInSelectedStop(load, mission)) group.classList.add('stop-target');
      let stopRole = '';
      if (stopFocus?.targets.has(load.id)) stopRole = stopFocus.blocked.has(load.id) ? 'blocked' : 'target';
      else if (stopFocus?.blockers.has(load.id)) stopRole = 'blocker';
      else if (stopFocus?.targets.size) group.classList.add('is-stop-background');
      if (stopRole) group.classList.add(`is-stop-${stopRole}`);
      const title = document.createElementNS(namespace, 'title');
      title.textContent = `${mission.title} | ${formatLoadRoute(load, mission)} | ${load.label} | ${formatDimensions(load, placementRotation(load))} | z ${base.z}–${base.z+dims.height}`;
      if (load.cargoFixed) title.textContent += ` | ${t('contracts.iso.fixed')}`;
      if (stopRole) title.textContent += ` | ${t(`contracts.iso.stop.${stopRole}`)}: ${stopFocus.dropoff}`;
      group.append(title, face.polygon);
      if (load.cargoFixed && x === base.col && y === base.row && z === base.z + dims.height - 1
          && (definition.type === 'top' || cargoCamera.elevation < 1e-6)) {
        const center = averagePoint(face.projected);
        group.appendChild(createSvgText(namespace, center.x, center.y + 3, 'cargo-fixed-marker', '🔒'));
      }
      if (!isContext) {
        group.addEventListener('mouseenter', () => renderIsoDetails({ mission, load }));
        group.addEventListener('click', () => {
          const deselect = state.selectedLoadId === load.id;
          state.selectedLoadId = deselect ? null : load.id;
          state.selectionCleared = deselect;
          persist();
          render();
        });
      }
      if (!isContext && definition.type === 'top' && selected && selected.load.id !== load.id) {
        const candidate = resolvePlacementTarget(selected.load, y, x, selected.load.id);
        if (candidate.valid && candidate.baseZ === z+1) {
          group.classList.add('stack-placeable');
          const target = makePolygon(definition.corners(x,y,z), 'iso-stack-cell placeable').polygon;
          target.dataset.cargoRow = y;
          target.dataset.cargoCol = x;
          target.addEventListener('click', event => { event.stopPropagation(); handleCellClick(y,x); });
          group.appendChild(target);
        }
      }
      return group;
    },
  });
  const front = projectCargoPoint((minCol + maxCol) / 2, minRow - 1.5, 0);
  const rear = projectCargoPoint((minCol + maxCol) / 2, maxRow + 1.5, 0);
  if (cameraView !== 'free' && cameraView !== 'top') {
    renderCargoCapacityGuide(activeCells, level, cameraView, namespace);
  }
  if (Math.hypot(front.x-rear.x, front.y-rear.y) < 40) {
    isoView.append(createSvgText(namespace, front.x, front.y + 24, 'iso-axis-label',
      t(cameraNormal[1] < 0 ? 'contracts.iso.front' : 'contracts.iso.rear')));
  } else {
    isoView.append(createSvgText(namespace, front.x, front.y, 'iso-axis-label', t('contracts.iso.front')),
      createSvgText(namespace, rear.x, rear.y, 'iso-axis-label', t('contracts.iso.rear')));
  }
  applyIsoZoomToView(isoView);
  isoView.hidden = false;
  renderIsoDetails(selected);
}

function renderCargoCapacityGuide(cells, level, view, namespace) {
  const alongColumns = view === 'front' || view === 'rear';
  const heights = new Map();
  cells.forEach(cell => {
    const index = alongColumns ? cell.col : cell.row;
    heights.set(index, Math.max(heights.get(index) || 0, cell.capacity));
  });
  const guide = document.createElementNS(namespace, 'g');
  guide.setAttribute('class', 'cargo-capacity-guide');
  heights.forEach((height, index) => {
    for (let z = 0; z < height; z++) {
      const corners = alongColumns
        ? [[index,0,z], [index+1,0,z], [index+1,0,z+1], [index,0,z+1]]
        : [[0,index,z], [0,index+1,z], [0,index+1,z+1], [0,index,z+1]];
      const polygon = document.createElementNS(namespace, 'polygon');
      if (level !== 'all' && z !== Number(level)) polygon.setAttribute('opacity', '0.15');
      polygon.setAttribute('points', pointsToString(corners.map(point => projectCargoPoint(...point))));
      guide.appendChild(polygon);
    }
  });
  isoView.prepend(guide);
}

function syncStaticPreviews() {
  if (selectionShipGrid) {
    selectionShipGrid.innerHTML = shipGrid.innerHTML;
    selectionShipGrid.style.gridTemplateRows = shipGrid.style.gridTemplateRows;
    selectionShipGrid.querySelectorAll("button").forEach((button) => {
      button.disabled = true;
      button.tabIndex = -1;
      button.classList.remove("valid-target", "stack-target", "selected-load");
    });
    stripSelectionShipPreview(selectionShipGrid);
  }

  syncSvgPreview(isoView, selectionIsoView);
  stripSelectionIsoPreview(selectionIsoView);
  applyIsoZoomToViews();
}

function syncSvgPreview(source, target) {
  if (!source || !target) return;
  target.innerHTML = source.innerHTML;
  target.querySelector('.cargo-placement-preview')?.remove();
  target.querySelectorAll(".placeable, .stack-placeable").forEach((node) => {
    node.classList.remove("placeable", "stack-placeable");
  });
  const viewBox = source.getAttribute("viewBox");
  target.dataset.cameraSpan = source.dataset.cameraSpan;
  const preserveAspectRatio = source.getAttribute("preserveAspectRatio");
  if (viewBox) {
    target.setAttribute("viewBox", viewBox);
  }
  if (preserveAspectRatio) {
    target.setAttribute("preserveAspectRatio", preserveAspectRatio);
  }
}

function applyIsoZoomToView(view) {
  if (!view) return;
  const frame = view.closest(".iso-frame");
  CargoScene.applyZoom(view, isoZoomLevel);
  view.style.removeProperty('width');
  view.style.removeProperty('min-height');
  frame?.classList.remove('is-zoomed');
}

function updateIsoZoomControls() {
  const currentIndex = ISO_ZOOM_LEVELS.indexOf(isoZoomLevel);
  document.querySelectorAll("[data-iso-zoom-value]").forEach((value) => {
    value.textContent = `${Math.round(isoZoomLevel * 100)} %`;
  });
  document.querySelectorAll('[data-iso-zoom-action="out"]').forEach((button) => {
    button.disabled = currentIndex <= 0;
  });
  document.querySelectorAll('[data-iso-zoom-action="in"]').forEach((button) => {
    button.disabled = currentIndex >= ISO_ZOOM_LEVELS.length - 1;
  });
}

function applyIsoZoomToViews() {
  [isoView, selectionIsoView].forEach((view) => applyIsoZoomToView(view));
  updateIsoZoomControls();
}

function changeIsoZoom(action) {
  const currentIndex = Math.max(0, ISO_ZOOM_LEVELS.indexOf(isoZoomLevel));
  if (action === "reset") {
    isoZoomLevel = ISO_ZOOM_LEVELS[0];
  } else if (action === "in") {
    isoZoomLevel = ISO_ZOOM_LEVELS[Math.min(currentIndex + 1, ISO_ZOOM_LEVELS.length - 1)];
  } else if (action === "out") {
    isoZoomLevel = ISO_ZOOM_LEVELS[Math.max(currentIndex - 1, 0)];
  }
  applyIsoZoomToViews();
}

function stripSelectionShipPreview(container) {
  if (!container) return;
  container.querySelectorAll(".slot").forEach((slot) => {
    const slotId = slot.dataset.slotId || "";
    slot.classList.remove("filled", "stacked", "continuation", "stack-target", "selected-load", "selected");
    slot.style.background = "";
    slot.style.removeProperty("--fill");
    slot.innerHTML = slotId ? `<span class="slot-name">${escapeHtml(slotId)}</span>` : "";
  });
}

function stripSelectionIsoPreview(target) {
  if (!target) return;
  target.querySelectorAll(".iso-load").forEach((node) => node.remove());
}

function handleCellClick(row, col) {
  if (isDispatcherMode()) return;
  const selectedEntry = findLoadById(state.selectedLoadId);
  const topLoadEntry = findTopLoadAtCell(row, col);

  if (!selectedEntry) {
    if (topLoadEntry) {
      unloadLoad(topLoadEntry.load);
    }
    return;
  }

  if (!canMissionUseCurrentCargoGrid(selectedEntry.mission)) {
    void showAppNotice(t("contracts.alert.assignmentMismatch"));
    return;
  }

  const result = resolvePlacementTarget(selectedEntry.load, row, col, selectedEntry.load.id);
  if (!result.valid) {
    void showAppNotice(result.reason);
    return;
  }

  const before = captureCargoAction();
  selectedEntry.load.placement = {
    row: result.anchorRow,
    col: result.anchorCol,
    slotId: createSlotId(result.anchorRow, result.anchorCol),
    z: result.baseZ,
    rotated: selectedEntry.load.rotated,
    fleetEntryId: getCurrentCargoGridFleetEntryId(),
  };
  selectedEntry.load.cargoFixed = false;
  selectedEntry.load.loadedByFleetEntryId = getCurrentCargoGridFleetEntryId();
  selectedEntry.load.loadedAt = new Date().toISOString();
  state.selectedLoadId = getNextLoadIdAfterPlacement(selectedEntry.load);
  state.selectionCleared = false;
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  recordCargoAction(before);
  persist();
  render();
}

function unloadLoad(load) {
  if (isDispatcherMode()) return;
  if (load.cargoFixed && load.placement) { void showAppNotice(t('contracts.iso.fixedHint')); return; }
  const entry = findLoadById(load.id);
  if (!entry || !load.placement) return;
  if (!isLoadPlacementInCurrentLayout(load, entry.mission)) {
    return;
  }

  const analysis = analyzeUnloadEntries([entry]);
  if (analysis.blockedEntries.length > 0) {
    void showAppNotice(formatUnloadBlockerSummary(analysis.blockers) || "Diese Ladung ist aktuell von anderer Fracht blockiert.");
    return;
  }

  const before = captureCargoAction();
  load.placement = null;
  if (state.selectedLoadId === load.id) {
    state.selectedLoadId = load.id;
    state.selectionCleared = false;
  }
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  recordCargoAction(before);
  persist();
  render();
}

function rotateLoad(load) {
  if (isDispatcherMode()) return;
  if (load.cargoFixed && load.placement) { void showAppNotice(t('contracts.iso.fixedHint')); return; }
  const entry = findLoadById(load.id);
  if (load.placement && entry && !isLoadPlacementInCurrentLayout(load, entry.mission)) {
    return;
  }
  const before = captureCargoAction();
  load.rotated = !load.rotated;
  if (load.placement) {
    const currentRow = load.placement.row;
    const currentCol = load.placement.col;
    const result = canPlaceLoadAt(load, currentRow, currentCol, load.id);
    if (!result.valid) {
      load.placement = null;
    } else {
      load.placement.rotated = load.rotated;
      load.placement.z = result.baseZ;
    }
  }
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  recordCargoAction(before);
  persist();
  render();
}

function canPlaceLoadAt(load, anchorRow, anchorCol, ignoreLoadId = null, allowOverload = true) {
  const dimensions = getLoadDimensions(load);
  const footprint = buildFootprint(anchorRow, anchorCol, dimensions.width, dimensions.depth);
  // Saved placements are validated independently of permission to add new
  // overload cargo. Manual placement explicitly passes the current setting.
  const profile = !allowOverload ? findShipLibraryEntryById(state.layout.shipId) : null;

  for (const cell of footprint) {
    if (!isCellInside(cell.row, cell.col) || isBlockedSlot(createSlotId(cell.row, cell.col))) {
      return { valid: false, reason: "Die Ladung würde außerhalb des Cargo-Grids oder in einem Sperrbereich liegen." };
    }
  }

  const baseHeights = footprint.map((cell) => getStackHeightAtCell(cell.row, cell.col, ignoreLoadId));
  const uniqueHeights = new Set(baseHeights);
  if (uniqueHeights.size > 1) {
    return { valid: false, reason: "Die Ladung braucht eine ebene Unterlage. Die ausgewählten Zellen sind unterschiedlich hoch belegt." };
  }

  const baseZ = baseHeights[0] ?? 0;
  for (const cell of footprint) {
    const slotId = createSlotId(cell.row, cell.col);
    const capacity = !allowOverload
      ? profile ? Number(profile.gridHeights?.[slotId]) || 0 : isOverloadSlot(slotId) ? 0 : getCellCapacityById(slotId)
      : getCellCapacityById(slotId);
    if (baseZ + dimensions.height > capacity) {
      if (!allowOverload && baseZ + dimensions.height <= getCellCapacityById(slotId)) {
        return { valid: false, reason: t('autoload.overload.manualDisabled') };
      }
      return { valid: false, reason: "Die Ladung ist an dieser Stelle zu hoch für das Höhenprofil des Schiffs." };
    }
  }

  return { valid: true, baseZ, footprint };
}

function getAutoloadSettings() {
  return Autoload.normalizeAutoloadSettings(state.autoload);
}

function getAutoloadOverloadDefinition() {
  const shipId = String(state.layout?.shipId || currentActiveFleetEntry()?.shipId || "").trim();
  const fleetEntryId = String(state.layout?.fleetEntryId || state.activeFleetEntryId || "").trim();
  const profile = findShipLibraryEntryById(shipId);
  if (!profile || !fleetEntryId) return null;
  const definition = getShipGridDefinition(profile, true);
  return definition.overloadSlotIds.length > 0
    ? { definition, shipId, fleetEntryId }
    : null;
}

function canAutoloadUseOverload() {
  return Boolean(getAutoloadOverloadDefinition());
}

function prepareAutoloadLayout(settings) {
  if (!settings.allowOverload || state.layout.overloadMode) return;
  const overload = getAutoloadOverloadDefinition();
  if (!overload) return;
  applyLayoutDefinition(overload.definition, overload.fleetEntryId, overload.shipId, true);
}

function syncAutoloadControls() {
  const settings = getAutoloadSettings();
  const overloadAvailable = canAutoloadUseOverload();
  autoloadStrategySelects.forEach((select) => {
    select.value = settings.strategy;
  });
  document.querySelectorAll('[data-autoload-fill]').forEach(select => {
    const modes = ['areas', 'rows', ...(['left','right'].includes(settings.fillOrder) ? [settings.fillOrder] : [])];
    select.innerHTML = modes.map(value=>`<option value="${value}">${escapeHtml(t(`autoload.fill.${value}`))}</option>`).join('');
    select.value = settings.fillOrder;
  });
  const areas = getAutoloadAreaContext().areas;
  document.querySelectorAll('[data-autoload-area-order]').forEach(label => {
    label.textContent = t('cargoAreas.sequence',{names:areas.map(cargoAreaName).join(' → ') || t('cargoAreas.unassigned')});
    label.hidden = settings.fillOrder !== 'areas';
  });
  autoloadOverloadInputs.forEach((input) => {
    input.checked = settings.allowOverload;
    input.disabled = !overloadAvailable;
    const label = input.closest(".autoload-overload-toggle");
    if (!label) return;
    label.classList.toggle("is-disabled", !overloadAvailable);
    label.dataset.tooltip = overloadAvailable
      ? t("autoload.overload.tooltip")
      : t("autoload.overload.unavailable");
  });
}

function updateAutoloadSettings(nextValue) {
  state.autoload = Autoload.normalizeAutoloadSettings({
    ...getAutoloadSettings(),
    ...nextValue,
  });
  prepareAutoloadLayout(state.autoload);
  lastAutoLoadResult = null;
  if (typeof lastRunAutoLoadResult !== "undefined") lastRunAutoLoadResult = null;
  persist();
  render();
}

function initializeAutoloadControls() {
  document.querySelectorAll('[data-autoload-fill]').forEach(select => {
    select.addEventListener('change', () => updateAutoloadSettings({ fillOrder: select.value }));
  });
  autoloadStrategySelects.forEach((select) => {
    select.addEventListener("change", () => updateAutoloadSettings({ strategy: select.value }));
  });
  autoloadOverloadInputs.forEach((input) => {
    input.addEventListener("change", () => updateAutoloadSettings({ allowOverload: input.checked }));
  });
}

function buildAutoloadRouteRanks() {
  const ranks = new Map();
  if (typeof buildRunRouteState !== "function") return ranks;
  const routeState = buildRunRouteState();
  (routeState?.openPoints || []).forEach((point, index) => {
    const key = normalizeRunRouteLocation(point?.dropoff);
    if (key && !ranks.has(key)) ranks.set(key, index);
  });
  return ranks;
}

function findAutoPlacementForLoad(load, settings = getAutoloadSettings(), cargoArea = 'all', selection = { id: '', unavailable: false }) {
  if (selection.unavailable) return null;
  const areaContext = getAutoloadAreaContext();
  const normalizedSettings = Autoload.normalizeAutoloadSettings(settings);
  const overloadSlotIds = new Set(state.layout.overloadSlotIds || []);
  const originalRotation = Boolean(load.rotated);
  const rotations = load.width === load.depth
    ? [originalRotation]
    : [originalRotation, !originalRotation];
  const candidates = [];

  rotations.forEach((rotated, rotationIndex) => {
    load.rotated = rotated;
    for (let row = 0; row < state.layout.rows; row += 1) {
      for (let col = 0; col < state.layout.cols; col += 1) {
        const result = canPlaceLoadAt(load, row, col, load.id, normalizedSettings.allowOverload);
        if (!result.valid) continue;
        const area = Autoload.placementArea(result.footprint, state.layout.cols);
        if (Autoload.normalizeCargoArea(cargoArea) !== 'all' && area !== cargoArea) continue;
        const region = CargoAreas.containingArea(result.footprint, areaContext.owners);
        if (region === null) continue;
        if (selection.id && region !== (selection.id === '__remaining__' ? '' : selection.id)) continue;
        const overloadCellCount = result.footprint.reduce(
          (count, cell) => {
            const slotId = createSlotId(cell.row, cell.col);
            const officialHeight = Number(areaContext.profile?.gridHeights?.[slotId]) || 0;
            return count + (overloadSlotIds.has(slotId) && result.baseZ + load.height > officialHeight ? 1 : 0);
          },
          0,
        );
        if (!normalizedSettings.allowOverload && overloadCellCount > 0) continue;
        candidates.push({
          row,
          col,
          area,
          areaRank: region ? areaContext.areas.findIndex(item => item.id === region) : areaContext.areas.length,
          baseZ: result.baseZ,
          rotated,
          rotationIndex,
          newFloorCells: result.footprint.reduce(
            (count, cell) => count + (getStackHeightAtCell(cell.row, cell.col, load.id) === 0 ? 1 : 0),
            0,
          ),
          overloadCellCount,
        });
      }
    }
  });

  load.rotated = originalRotation;
  return Autoload.sortPlacementCandidates(candidates, normalizedSettings.fillOrder)[0] || null;
}

function autoLoadEntries(entries, {
  persistAfter = true,
  renderAfter = true,
  settings = getAutoloadSettings(),
  resultMissionId = "",
} = {}) {
  const normalizedSettings = Autoload.normalizeAutoloadSettings(settings);
  const uniqueEntries = [...new Map(
    (Array.isArray(entries) ? entries : [])
      .filter(({ mission, load }) => (
        mission
        && load
        && !load.placement
        && !isLoadDelivered(load)
        && canMissionUseCurrentCargoGrid(mission)
      ))
      .map((entry) => [entry.load.id, entry]),
  ).values()];
  if (uniqueEntries.length === 0) {
    const emptyResult = {
      missionId: resultMissionId,
      strategy: normalizedSettings.strategy,
      placedCount: 0,
      skippedCount: 0,
      overloadCount: 0,
    };
    if (resultMissionId) lastAutoLoadResult = emptyResult;
    if (renderAfter) render();
    return emptyResult;
  }

  prepareAutoloadLayout(normalizedSettings);
  const before = captureCargoAction();
  const routeRanks = buildAutoloadRouteRanks();
  const segmentOrders = new Map(uniqueEntries.map(({ mission }) => [
    mission.id,
    new Map((Array.isArray(mission.segments) ? mission.segments : [])
      .map((segment, index) => [segment.id, Number.isInteger(segment.order) ? segment.order : index])),
  ]));
  const sortedEntries = Autoload.sortAutoloadEntries(uniqueEntries.map(({ mission, load }) => ({
    mission,
    load,
    segmentOrder: segmentOrders.get(mission.id)?.get(load.segmentId) ?? 0,
    routeRank: routeRanks.get(normalizeRunRouteLocation(getLoadDropoff(load, mission))) ?? -1,
  })), normalizedSettings.strategy).sort((left, right) => {
    const fixed = entry => Boolean(entry.mission.autoloadAreaId || Autoload.normalizeCargoArea(entry.mission.autoloadArea) !== 'all');
    return Number(fixed(right)) - Number(fixed(left));
  });
  let placedCount = 0;
  let overloadCount = 0;
  const skippedLoadIds = [];
  sortedEntries.forEach(({ mission, load }) => {
    const placement = findAutoPlacementForLoad(load, normalizedSettings, mission.autoloadArea,
      getMissionCargoAreaSelection(mission, getAutoloadAreaContext().profile));
    if (!placement) {
      skippedLoadIds.push(load.id);
      return;
    }
    load.rotated = placement.rotated;
    load.cargoFixed = false;
    load.placement = {
      row: placement.row,
      col: placement.col,
      slotId: createSlotId(placement.row, placement.col),
      z: placement.baseZ,
      rotated: placement.rotated,
      fleetEntryId: getCurrentCargoGridFleetEntryId(),
    };
    load.loadedByFleetEntryId = getCurrentCargoGridFleetEntryId();
    load.loadedAt = new Date().toISOString();
    placedCount += 1;
    if (placement.overloadCellCount > 0) overloadCount += 1;
  });

  const result = {
    missionId: resultMissionId,
    strategy: normalizedSettings.strategy,
    placedCount,
    skippedCount: skippedLoadIds.length,
    overloadCount,
  };
  if (resultMissionId) lastAutoLoadResult = result;
  state.selectedLoadId = skippedLoadIds[0] || null;
  state.selectionCleared = skippedLoadIds.length === 0;
  lastUnloadPlan = null;
  recordCargoAction(before);
  if (persistAfter) persist();
  if (renderAfter) render();
  return { ...result };
}

function autoLoadMission(mission, {
  persistAfter = true,
  renderAfter = true,
  loadFilter = null,
  settings = getAutoloadSettings(),
} = {}) {
  if (!canMissionUseCurrentCargoGrid(mission)) {
    return {
      missionId: mission?.id || "",
      strategy: Autoload.normalizeAutoloadStrategy(settings?.strategy),
      placedCount: 0,
      skippedCount: 0,
      overloadCount: 0,
    };
  }
  const entries = getMissionActiveLoads(mission)
    .filter((load) => !load.placement && (typeof loadFilter !== "function" || loadFilter(load)))
    .map((load) => ({ mission, load }));
  return autoLoadEntries(entries, {
    persistAfter,
    renderAfter,
    settings,
    resultMissionId: mission.id,
  });
}

function resolvePlacementTarget(load, clickedRow, clickedCol, ignoreLoadId = null) {
  if (load.cargoFixed && load.placement) return {valid:false, reason:t('contracts.iso.fixedHint')};
  const allowOverload = getAutoloadSettings().allowOverload;
  const direct = canPlaceLoadAt(load, clickedRow, clickedCol, ignoreLoadId, allowOverload);
  if (direct.valid) {
    return { ...direct, anchorRow: clickedRow, anchorCol: clickedCol };
  }

  const dimensions = getLoadDimensions(load);
  const candidates = [];

  for (let anchorRow = clickedRow - dimensions.depth + 1; anchorRow <= clickedRow; anchorRow += 1) {
    for (let anchorCol = clickedCol - dimensions.width + 1; anchorCol <= clickedCol; anchorCol += 1) {
      const result = canPlaceLoadAt(load, anchorRow, anchorCol, ignoreLoadId, allowOverload);
      if (!result.valid) continue;

      const footprint = result.footprint;
      const containsClicked = footprint.some((cell) => cell.row === clickedRow && cell.col === clickedCol);
      if (!containsClicked) continue;

      const topLoad = findTopLoadAtCell(clickedRow, clickedCol, ignoreLoadId);
      const samePlatform =
        topLoad &&
        footprint.every((cell) => getStackHeightAtCell(cell.row, cell.col, ignoreLoadId) === topLoad.top);

      candidates.push({
        ...result,
        anchorRow,
        anchorCol,
        samePlatform,
        score:
          result.baseZ * 1000 +
          (samePlatform ? 100 : 0) -
          Math.abs(clickedRow - anchorRow) * 4 -
          Math.abs(clickedCol - anchorCol),
      });
    }
  }

  if (candidates.length === 0) {
    return direct;
  }

  candidates.sort((left, right) => right.score - left.score || left.anchorRow - right.anchorRow || left.anchorCol - right.anchorCol);
  return candidates[0];
}

function findTopLoadAtCell(row, col, ignoreLoadId = null) {
  return getLoadsAtCell(row, col, ignoreLoadId).at(-1) ?? null;
}

function getStackHeightAtCell(row, col, ignoreLoadId = null) {
  const topLoad = findTopLoadAtCell(row, col, ignoreLoadId);
  return topLoad ? topLoad.top : 0;
}

function getLoadsAtCell(row, col, ignoreLoadId = null) {
  const entries = [];
  for (const mission of state.missions) {
    for (const load of mission.loads) {
      if (!load.placement || load.id === ignoreLoadId) continue;
      if (!isLoadPlacementInCurrentLayout(load, mission)) continue;
      if (!loadCoversCell(load, row, col)) continue;
      const top = load.placement.z + getLoadDimensions(load, placementRotation(load)).height;
      entries.push({ mission, load, top });
    }
  }
  entries.sort((left, right) => left.load.placement.z - right.load.placement.z || left.top - right.top);
  return entries;
}

function filterEntriesByLevel(entries, levelFilter) {
  if (levelFilter === "all") return entries;
  return entries.filter(({ load }) => loadTouchesLevel(load, levelFilter));
}

function loadTouchesLevel(load, levelFilter) {
  if (!load.placement || levelFilter === "all") return true;
  const baseZ = load.placement.z;
  const topZ = baseZ + getLoadDimensions(load, placementRotation(load)).height;
  return levelFilter >= baseZ && levelFilter < topZ;
}

function loadCoversCell(load, row, col) {
  if (!load.placement) return false;
  const dimensions = getLoadDimensions(load, placementRotation(load));
  const startRow = load.placement.row;
  const startCol = load.placement.col;
  return (
    row >= startRow &&
    row < startRow + dimensions.depth &&
    col >= startCol &&
    col < startCol + dimensions.width
  );
}

function findLoadById(loadId) {
  if (!loadId) return null;
  for (const mission of state.missions) {
    const load = mission.loads.find((entry) => entry.id === loadId);
    if (load) {
      return { mission, load };
    }
  }
  return null;
}

function isLoadDelivered(load) {
  return Boolean(load?.deliveredAt);
}

function getAllLoads({ includeDelivered = false } = {}) {
  return state.missions.flatMap((mission) =>
    (Array.isArray(mission.loads) ? mission.loads : [])
      .filter((load) => includeDelivered || !isLoadDelivered(load))
      .map((load) => ({ mission, load })),
  );
}

function hasPlacedLoads({ fleetEntryId = null } = {}) {
  if (fleetEntryId === null) {
    return getAllLoads().some(({ load }) => Boolean(load.placement));
  }
  return getPlacedLoadEntries({ fleetEntryId }).length > 0;
}

function clearAllPlacements({ fleetEntryId = null } = {}) {
  const clearedLoadIds = new Set();
  getAllLoads().forEach(({ mission, load }) => {
    if (fleetEntryId !== null && !isLoadPlacementForFleetEntry(load, mission, fleetEntryId)) return;
    if (load.placement) {
      clearedLoadIds.add(load.id);
    }
    load.placement = null;
  });
  if (!state.selectedLoadId || clearedLoadIds.has(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = false;
  }
  lastUnloadPlan = null;
}

function isSameLayout(nextLayout) {
  return (
    state.layout.shipId === (nextLayout.shipId || "") &&
    state.layout.fleetEntryId === (nextLayout.fleetEntryId || "") &&
    state.layout.presetId === nextLayout.presetId &&
    state.layout.rows === nextLayout.rows &&
    state.layout.cols === nextLayout.cols &&
    state.layout.defaultHeight === nextLayout.defaultHeight &&
    Boolean(state.layout.overloadMode) === Boolean(nextLayout.overloadMode)
  );
}

function doesLayoutMatchDefinition(definition, fleetEntryId, shipId) {
  return (
    state.layout.shipId === (shipId || "") &&
    state.layout.fleetEntryId === (fleetEntryId || "") &&
    state.layout.rows === definition.rows &&
    state.layout.cols === definition.cols &&
    state.layout.defaultHeight === definition.defaultHeight &&
    Boolean(state.layout.overloadMode) === Boolean(definition.overloadMode) &&
    JSON.stringify([...state.layout.blockedSlots].sort()) === JSON.stringify([...definition.blockedSlots].sort()) &&
    JSON.stringify([...state.layout.overloadSlotIds].sort()) === JSON.stringify([...(definition.overloadSlotIds || [])].sort()) &&
    JSON.stringify(state.layout.heightOverrides) === JSON.stringify(definition.heightOverrides)
  );
}

async function confirmShipLayoutChange(nextLayout) {
  if (isSameLayout(nextLayout)) {
    return true;
  }

  const currentFleetEntryId = state.layout.fleetEntryId || "";
  if (!hasPlacedLoads({ fleetEntryId: currentFleetEntryId })) {
    return true;
  }

  const shouldChange = await showMissionConfirmDialog({
    kicker: t("nav.contracts"),
    title: t("run.ship.change"),
    message: "Beim Wechsel des Schiffs oder Rasters wird das Schiff vollständig entladen. Aufträge bleiben erhalten. Möchtest du fortfahren?",
    confirmLabel: t("run.ship.change"),
  });
  if (!shouldChange) {
    return false;
  }

  clearAllPlacements({ fleetEntryId: currentFleetEntryId });
  return true;
}

function getNextLoadIdAfterPlacement(placedLoad) {
  const entries = getAllLoads().filter(({ mission, load }) =>
    !isLoadDelivered(load) && canMissionUseCurrentCargoGrid(mission),
  );
  const matchingSibling = entries.find(
    ({ load }) =>
      load.id !== placedLoad.id &&
      !load.placement &&
      load.segmentId &&
      load.segmentId === placedLoad.segmentId,
  );
  if (matchingSibling) {
    return matchingSibling.load.id;
  }

  const matchingProfile = entries.find(
    ({ load }) =>
      load.id !== placedLoad.id &&
      !load.placement &&
      load.cargoTitle === placedLoad.cargoTitle &&
      load.width === placedLoad.width &&
      load.depth === placedLoad.depth &&
      load.height === placedLoad.height,
  );
  if (matchingProfile) {
    return matchingProfile.load.id;
  }

  return entries.find(({ load }) => load.id !== placedLoad.id && !load.placement)?.load.id ?? null;
}

function getEffectiveLevelFilter(maxHeight = 8) {
  const maxLevelIndex = Math.max(maxHeight - 1, 0);
  return state.levelFilter === "all" ? "all" : clamp(Number(state.levelFilter) || 0, 0, maxLevelIndex);
}

function formatLevelMeta(levelFilter, baseZ = null) {
  if (levelFilter === "all") {
    return baseZ === null ? "alle Ebenen" : `z ${baseZ}`;
  }
  return `Ebene ${levelFilter + 1}`;
}

function buildFootprint(anchorRow, anchorCol, width, depth) {
  const cells = [];
  for (let rowOffset = 0; rowOffset < depth; rowOffset += 1) {
    for (let colOffset = 0; colOffset < width; colOffset += 1) {
      cells.push({ row: anchorRow + rowOffset, col: anchorCol + colOffset });
    }
  }
  return cells;
}

function buildActiveCells() {
  const cells = [];
  for (let row = 0; row < state.layout.rows; row += 1) {
    for (let col = 0; col < state.layout.cols; col += 1) {
      const slotId = createSlotId(row, col);
      if (!isBlockedSlot(slotId)) {
        cells.push({ slotId, row, col, capacity: getCellCapacityById(slotId), isOverload: isOverloadSlot(slotId) });
      }
    }
  }
  return cells;
}

function getTotalCapacity() {
  return buildActiveCells().reduce((sum, cell) => sum + cell.capacity, 0);
}

function getUsedCapacity() {
  return getPlacedLoadEntries().reduce((sum, { load }) => sum + (load.scu || 0), 0);
}

function getCellCapacityById(slotId) {
  if (isBlockedSlot(slotId)) return 0;
  return clamp(Number(state.layout.heightOverrides[slotId] ?? state.layout.defaultHeight) || 1, 1, 8);
}

function isBlockedSlot(slotId) {
  return state.layout.blockedSlots.includes(slotId);
}

function isOverloadSlot(slotId) {
  return state.layout.overloadSlotIds.includes(slotId);
}

function isCellInside(row, col) {
  return row >= 0 && row < state.layout.rows && col >= 0 && col < state.layout.cols;
}

function rowIndexToLabel(rowIndex) {
  let index = Number(rowIndex);
  if (!Number.isInteger(index) || index < 0) return "";

  let label = "";
  do {
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);

  return label;
}

function rowLabelToIndex(rowLabel) {
  if (typeof rowLabel !== "string" || rowLabel.trim() === "") return -1;
  const normalized = rowLabel.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(normalized)) return -1;

  let index = 0;
  for (const character of normalized) {
    index = index * 26 + (character.charCodeAt(0) - 64);
  }
  return index - 1;
}

function createSlotId(rowIndex, colIndex) {
  const rowLabel = rowIndexToLabel(rowIndex);
  return `${rowLabel}${colIndex + 1}`;
}

function slotIdToPosition(slotId) {
  if (typeof slotId !== "string" || slotId.length < 2) return null;
  const match = slotId.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const row = rowLabelToIndex(match[1]);
  const col = Number(match[2]) - 1;
  return row >= 0 && Number.isFinite(col) ? { row, col } : null;
}

function getLoadDimensions(load, rotated = load.rotated) {
  return {
    width: rotated ? load.depth : load.width,
    depth: rotated ? load.width : load.depth,
    height: load.height,
  };
}

function placementRotation(load) {
  return load.placement?.rotated ?? load.rotated;
}

function renderStackBadges(stackEntries) {
  if (stackEntries.length <= 1) return "";
  return `
    <span class="slot-stack" aria-hidden="true">
      ${stackEntries
        .map(({ mission, load }) => {
          const start = load.placement?.z ?? 0;
          const end = start + getLoadDimensions(load, placementRotation(load)).height;
          return `<span class="stack-chip${isLoadInSelectedStop(load, mission) ? " is-stop-target" : ""}" style="--stack-color:${mission.color}">z${start}-${end}</span>`;
        })
        .join("")}
    </span>
  `;
}

function projectIso(x, y, z, originX, originY, tileWidth, tileHeight, levelHeight) {
  return {
    x: originX + (x - y) * (tileWidth / 2),
    y: originY + (x + y) * (tileHeight / 2) - z * levelHeight,
  };
}

function pointsToString(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function getIsoVoxelKey(x, y, z) {
  return `${x}|${y}|${z}`;
}

function averagePoint(points) {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

function createSvgText(namespace, x, y, className, text) {
  const node = document.createElementNS(namespace, "text");
  node.setAttribute("x", String(x));
  node.setAttribute("y", String(y));
  node.setAttribute("class", className);
  node.textContent = text;
  return node;
}

function compareLoadDrawOrder(left, right) {
  if (!left.placement || !right.placement) return 0;
  const leftDims = getLoadDimensions(left, placementRotation(left));
  const rightDims = getLoadDimensions(right, placementRotation(right));
  const leftBackDepth = left.placement.row + left.placement.col;
  const rightBackDepth = right.placement.row + right.placement.col;
  const leftFrontDepth = left.placement.row + leftDims.depth + left.placement.col + leftDims.width;
  const rightFrontDepth = right.placement.row + rightDims.depth + right.placement.col + rightDims.width;
  const leftTop = left.placement.z + leftDims.height;
  const rightTop = right.placement.z + rightDims.height;

  if (leftFrontDepth !== rightFrontDepth) return leftFrontDepth - rightFrontDepth;
  if (leftTop !== rightTop) return leftTop - rightTop;
  if (leftBackDepth !== rightBackDepth) return leftBackDepth - rightBackDepth;
  if (left.placement.row !== right.placement.row) return left.placement.row - right.placement.row;
  if (left.placement.col !== right.placement.col) return left.placement.col - right.placement.col;
  return leftDims.width * leftDims.depth * leftDims.height - rightDims.width * rightDims.depth * rightDims.height;
}

function formatDimensions(load, rotated = load.rotated) {
  const dims = getLoadDimensions(load, rotated);
  return `${dims.width}×${dims.depth}×${dims.height}`;
}
