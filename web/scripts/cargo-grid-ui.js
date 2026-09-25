// Cargo-grid rendering, placement, stacking, zoom, and autoload integration.
function renderShipGrid() {
  const { rows, cols } = state.layout;
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

      slotButton.addEventListener("click", () => handleCellClick(row, col));
      rowElement.appendChild(slotButton);
    }

    shipGrid.appendChild(rowElement);
  }
}

function renderIsometricView() {
  const rawSelectedEntry = findLoadById(state.selectedLoadId);
  const selectedEntry = rawSelectedEntry && canMissionUseCurrentCargoGrid(rawSelectedEntry.mission) ? rawSelectedEntry : null;
  const levelFilter = getEffectiveLevelFilter();
  const placedLoads = getPlacedLoadEntries()
    .filter(({ load }) => loadTouchesLevel(load, levelFilter))
    .sort((left, right) => compareLoadDrawOrder(left.load, right.load));
  const occupiedIsoCells = buildIsoOccupancyMap(placedLoads);

  const activeCells = buildActiveCells();
  const maxHeight = activeCells.reduce((best, cell) => Math.max(best, cell.capacity), 0);
  const sizeScale = clamp(18 / Math.max(state.layout.rows, state.layout.cols, 10), 0.62, 1);
  const tileWidth = 48 * sizeScale;
  const tileHeight = 24 * sizeScale;
  const levelHeight = 18 * sizeScale;
  const originX = 0;
  const originY = maxHeight * levelHeight + 26 * sizeScale;

  const allPoints = [];

  activeCells.forEach((cell) => {
    allPoints.push(
      projectIso(cell.col, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col + 1, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col + 1, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
    );
  });

  placedLoads.forEach(({ load }) => {
    const dims = getLoadDimensions(load, placementRotation(load));
    const baseX = load.placement.col;
    const baseY = load.placement.row;
    const baseZ = load.placement.z;
    allPoints.push(
      projectIso(baseX, baseY, baseZ, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX + dims.width, baseY, baseZ, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX + dims.width, baseY + dims.depth, baseZ, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX, baseY + dims.depth, baseZ, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX, baseY, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX + dims.width, baseY, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX + dims.width, baseY + dims.depth, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(baseX, baseY + dims.depth, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
    );
  });

  const bugLabelPoint = projectIso(0, -1.8, 0, originX, originY, tileWidth, tileHeight, levelHeight);
  const heckLabelPoint = projectIso(0, state.layout.rows + 1.15, 0, originX, originY, tileWidth, tileHeight, levelHeight);
  allPoints.push(
    { x: bugLabelPoint.x, y: bugLabelPoint.y - 30 * sizeScale },
    { x: heckLabelPoint.x, y: heckLabelPoint.y + 18 * sizeScale },
  );

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const paddingX = 42 * sizeScale;
  const paddingTop = 42 * sizeScale;
  const paddingBottom = 56 * sizeScale;

  isoView.setAttribute(
    "viewBox",
    `${minX - paddingX} ${minY - paddingTop} ${maxX - minX + paddingX * 2} ${maxY - minY + paddingTop + paddingBottom}`,
  );
  isoView.setAttribute("preserveAspectRatio", "xMidYMid meet");
  isoView.innerHTML = "";

  const isoStatusText =
    placedLoads.length > 0
      ? `${placedLoads.length} Ladung${placedLoads.length === 1 ? "" : "en"} · ${formatLevelMeta(levelFilter)}`
      : `Grid bereit · ${formatLevelMeta(levelFilter)}`;
  if (overviewIsoStats) {
    overviewIsoStats.textContent = isoStatusText;
  }
  if (loadIsoStats) {
    loadIsoStats.textContent = isoStatusText;
  }
  isoEmpty.hidden = true;
  isoView.hidden = false;

  const svgNamespace = "http://www.w3.org/2000/svg";

  const floorGroup = document.createElementNS(svgNamespace, "g");
  floorGroup.setAttribute("class", "iso-floor-group");
  activeCells
    .sort((left, right) => left.row + left.col - (right.row + right.col))
    .forEach((cell) => {
      const candidate = selectedEntry ? resolvePlacementTarget(selectedEntry.load, cell.row, cell.col, selectedEntry.load.id) : null;
      const corners = [
        projectIso(cell.col, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
        projectIso(cell.col + 1, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
        projectIso(cell.col + 1, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
        projectIso(cell.col, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      ];
      const polygon = document.createElementNS(svgNamespace, "polygon");
      polygon.setAttribute("class", "iso-floor");
      if (cell.isOverload) {
        polygon.classList.add("is-overload");
      }
      if (candidate?.valid) {
        polygon.classList.add("placeable");
      }
      polygon.setAttribute("points", pointsToString(corners));
      polygon.addEventListener("click", () => handleCellClick(cell.row, cell.col));
      floorGroup.appendChild(polygon);

      const capacityLabel = document.createElementNS(svgNamespace, "text");
      const center = averagePoint(corners);
      capacityLabel.setAttribute("class", "iso-floor-label");
      capacityLabel.setAttribute("x", String(center.x));
      capacityLabel.setAttribute("y", String(center.y + 4));
      capacityLabel.textContent = String(cell.capacity);
      floorGroup.appendChild(capacityLabel);
    });
  isoView.appendChild(floorGroup);

  placedLoads.forEach(({ mission, load }) => {
    const dims = getLoadDimensions(load, placementRotation(load));
    const baseX = load.placement.col;
    const baseY = load.placement.row;
    const baseZ = load.placement.z;
    const stackCandidate =
      selectedEntry && selectedEntry.load.id !== load.id
        ? resolvePlacementTarget(selectedEntry.load, baseY, baseX, selectedEntry.load.id)
        : null;

    const loadGroup = document.createElementNS(svgNamespace, "g");
    loadGroup.setAttribute("class", "iso-load");
    loadGroup.dataset.loadId = load.id;
    if (state.selectedLoadId === load.id) {
      loadGroup.classList.add("selected");
    }
    if (isLoadInSelectedStop(load, mission)) {
      loadGroup.classList.add("stop-target");
    }
    if (stackCandidate?.valid) {
      loadGroup.classList.add("stack-placeable");
    }
    loadGroup.addEventListener("mouseenter", () => {
      renderIsoDetails({ mission, load });
    });
    loadGroup.addEventListener("click", () => {
      state.selectedLoadId = load.id;
      state.selectionCleared = false;
      persist();
      render();
    });

    const title = document.createElementNS(svgNamespace, "title");
    title.textContent = `${mission.title} | ${formatLoadRoute(load, mission)} | ${load.label} | ${formatDimensions(load, placementRotation(load))} | z ${baseZ}–${baseZ + dims.height}`;

    loadGroup.appendChild(title);

    const faceFragments = [];
    const faceOrder = { left: 0, right: 1, front: 2, top: 3 };

    const appendFace = (type, fill, points, cellX, cellY, cellZ) => {
      const polygon = document.createElementNS(svgNamespace, "polygon");
      polygon.setAttribute("class", `iso-face iso-face-${type}`);
      polygon.setAttribute("fill", fill);
      polygon.setAttribute("points", pointsToString(points));
      faceFragments.push({
        type,
        polygon,
        row: cellY,
        col: cellX,
        z: cellZ,
        depth: cellY + cellX,
      });
    };

    for (let heightOffset = 0; heightOffset < dims.height; heightOffset += 1) {
      for (let rowOffset = 0; rowOffset < dims.depth; rowOffset += 1) {
        for (let colOffset = 0; colOffset < dims.width; colOffset += 1) {
          const cellX = baseX + colOffset;
          const cellY = baseY + rowOffset;
          const cellZ = baseZ + heightOffset;

          if (!occupiedIsoCells.has(getIsoVoxelKey(cellX, cellY, cellZ + 1))) {
            appendFace(
              "top",
              shadeColor(mission.color, 12),
              [
                projectIso(cellX, cellY, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY + 1, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX, cellY + 1, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
              ],
              cellX,
              cellY,
              cellZ + 1,
            );
          }

          if (!occupiedIsoCells.has(getIsoVoxelKey(cellX - 1, cellY, cellZ))) {
            appendFace(
              "left",
              shadeColor(mission.color, -18),
              [
                projectIso(cellX, cellY, cellZ, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX, cellY + 1, cellZ, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX, cellY + 1, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX, cellY, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
              ],
              cellX,
              cellY,
              cellZ,
            );
          }

          if (!occupiedIsoCells.has(getIsoVoxelKey(cellX + 1, cellY, cellZ))) {
            appendFace(
              "right",
              shadeColor(mission.color, -8),
              [
                projectIso(cellX + 1, cellY, cellZ, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY + 1, cellZ, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY + 1, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
              ],
              cellX,
              cellY,
              cellZ,
            );
          }

          if (!occupiedIsoCells.has(getIsoVoxelKey(cellX, cellY + 1, cellZ))) {
            appendFace(
              "front",
              shadeColor(mission.color, -12),
              [
                projectIso(cellX, cellY + 1, cellZ, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY + 1, cellZ, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX + 1, cellY + 1, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
                projectIso(cellX, cellY + 1, cellZ + 1, originX, originY, tileWidth, tileHeight, levelHeight),
              ],
              cellX,
              cellY,
              cellZ,
            );
          }
        }
      }
    }

    faceFragments
      .sort((left, right) => {
        if (left.depth !== right.depth) return left.depth - right.depth;
        if (left.z !== right.z) return left.z - right.z;
        if (left.row !== right.row) return left.row - right.row;
        if (left.col !== right.col) return left.col - right.col;
        return faceOrder[left.type] - faceOrder[right.type];
      })
      .forEach((fragment) => {
        loadGroup.appendChild(fragment.polygon);
      });

    if (selectedEntry && selectedEntry.load.id !== load.id) {
      for (let rowOffset = 0; rowOffset < dims.depth; rowOffset += 1) {
        for (let colOffset = 0; colOffset < dims.width; colOffset += 1) {
          const cellRow = baseY + rowOffset;
          const cellCol = baseX + colOffset;
          const cellCandidate = resolvePlacementTarget(selectedEntry.load, cellRow, cellCol, selectedEntry.load.id);
          if (!cellCandidate.valid) continue;

          const stackCellPolygon = document.createElementNS(svgNamespace, "polygon");
          stackCellPolygon.setAttribute("class", "iso-stack-cell placeable");
          stackCellPolygon.setAttribute(
            "points",
            pointsToString([
              projectIso(cellCol, cellRow, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
              projectIso(cellCol + 1, cellRow, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
              projectIso(cellCol + 1, cellRow + 1, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
              projectIso(cellCol, cellRow + 1, baseZ + dims.height, originX, originY, tileWidth, tileHeight, levelHeight),
            ]),
          );
          stackCellPolygon.addEventListener("click", (event) => {
            event.stopPropagation();
            handleCellClick(cellRow, cellCol);
          });
          loadGroup.appendChild(stackCellPolygon);
        }
      }
    }

    isoView.appendChild(loadGroup);
  });

  const axisGroup = document.createElementNS(svgNamespace, "g");
  axisGroup.setAttribute("class", "iso-axis-group");
  axisGroup.appendChild(createSvgText(svgNamespace, bugLabelPoint.x, bugLabelPoint.y - 8, "iso-axis-label", "Vorne"));
  axisGroup.appendChild(createSvgText(svgNamespace, heckLabelPoint.x, heckLabelPoint.y + 10, "iso-axis-label", "Heck"));
  isoView.appendChild(axisGroup);

  renderIsoDetails(selectedEntry ?? null);
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

  syncSvgPreview(isoView, overviewIsoView);
  syncSvgPreview(isoView, selectionIsoView);
  stripSelectionIsoPreview(selectionIsoView);
  applyIsoZoomToViews();
}

function syncSvgPreview(source, target) {
  if (!source || !target) return;
  target.innerHTML = source.innerHTML;
  target.querySelectorAll(".placeable, .stack-placeable").forEach((node) => {
    node.classList.remove("placeable", "stack-placeable");
  });
  const viewBox = source.getAttribute("viewBox");
  const preserveAspectRatio = source.getAttribute("preserveAspectRatio");
  if (viewBox) {
    target.setAttribute("viewBox", viewBox);
  }
  if (preserveAspectRatio) {
    target.setAttribute("preserveAspectRatio", preserveAspectRatio);
  }
}

function getIsoZoomBaseHeight(view) {
  if (view === isoView) return 232;
  if (view === selectionIsoView) return 210;
  return 280;
}

function applyIsoZoomToView(view, { center = false } = {}) {
  if (!view) return;
  const frame = view.closest(".iso-frame");
  const isZoomed = isoZoomLevel > 1;
  if (isZoomed) {
    view.style.width = `${isoZoomLevel * 100}%`;
    view.style.minHeight = `${Math.round(getIsoZoomBaseHeight(view) * isoZoomLevel)}px`;
  } else {
    view.style.removeProperty("width");
    view.style.removeProperty("min-height");
  }
  frame?.classList.toggle("is-zoomed", isZoomed);

  if (center && frame) {
    requestAnimationFrame(() => {
      frame.scrollLeft = Math.max(0, (frame.scrollWidth - frame.clientWidth) / 2);
    });
  }
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

function applyIsoZoomToViews(options = {}) {
  [isoView, overviewIsoView, selectionIsoView].forEach((view) => applyIsoZoomToView(view, options));
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
  applyIsoZoomToViews({ center: true });
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

  selectedEntry.load.placement = {
    row: result.anchorRow,
    col: result.anchorCol,
    slotId: createSlotId(result.anchorRow, result.anchorCol),
    z: result.baseZ,
    rotated: selectedEntry.load.rotated,
    fleetEntryId: getCurrentCargoGridFleetEntryId(),
  };
  selectedEntry.load.loadedByFleetEntryId = getCurrentCargoGridFleetEntryId();
  selectedEntry.load.loadedAt = new Date().toISOString();
  state.selectedLoadId = getNextLoadIdAfterPlacement(selectedEntry.load);
  state.selectionCleared = false;
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

function unloadLoad(load) {
  if (isDispatcherMode()) return;
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

  load.placement = null;
  if (state.selectedLoadId === load.id) {
    state.selectedLoadId = load.id;
    state.selectionCleared = false;
  }
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

function rotateLoad(load) {
  if (isDispatcherMode()) return;
  const entry = findLoadById(load.id);
  if (load.placement && entry && !isLoadPlacementInCurrentLayout(load, entry.mission)) {
    return;
  }
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
  persist();
  render();
}

function canPlaceLoadAt(load, anchorRow, anchorCol, ignoreLoadId = null) {
  const dimensions = getLoadDimensions(load);
  const footprint = buildFootprint(anchorRow, anchorCol, dimensions.width, dimensions.depth);

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
    const capacity = getCellCapacityById(slotId);
    if (baseZ + dimensions.height > capacity) {
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
  lastAutoLoadResult = null;
  if (typeof lastRunAutoLoadResult !== "undefined") lastRunAutoLoadResult = null;
  persist();
  render();
}

function initializeAutoloadControls() {
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

function findAutoPlacementForLoad(load, settings = getAutoloadSettings()) {
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
        const result = canPlaceLoadAt(load, row, col, load.id);
        if (!result.valid) continue;
        const overloadCellCount = result.footprint.reduce(
          (count, cell) => count + (overloadSlotIds.has(createSlotId(cell.row, cell.col)) ? 1 : 0),
          0,
        );
        if (!normalizedSettings.allowOverload && overloadCellCount > 0) continue;
        candidates.push({
          row,
          col,
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
  return Autoload.sortPlacementCandidates(candidates)[0] || null;
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
  })), normalizedSettings.strategy);
  let placedCount = 0;
  let overloadCount = 0;
  const skippedLoadIds = [];
  sortedEntries.forEach(({ load }) => {
    const placement = findAutoPlacementForLoad(load, normalizedSettings);
    if (!placement) {
      skippedLoadIds.push(load.id);
      return;
    }
    load.rotated = placement.rotated;
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
  const direct = canPlaceLoadAt(load, clickedRow, clickedCol, ignoreLoadId);
  if (direct.valid) {
    return { ...direct, anchorRow: clickedRow, anchorCol: clickedCol };
  }

  const dimensions = getLoadDimensions(load);
  const candidates = [];

  for (let anchorRow = clickedRow - dimensions.depth + 1; anchorRow <= clickedRow; anchorRow += 1) {
    for (let anchorCol = clickedCol - dimensions.width + 1; anchorCol <= clickedCol; anchorCol += 1) {
      const result = canPlaceLoadAt(load, anchorRow, anchorCol, ignoreLoadId);
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

function buildIsoOccupancyMap(entries) {
  const occupied = new Set();

  entries.forEach(({ load }) => {
    if (!load.placement) return;
    const dims = getLoadDimensions(load, placementRotation(load));

    for (let heightOffset = 0; heightOffset < dims.height; heightOffset += 1) {
      for (let rowOffset = 0; rowOffset < dims.depth; rowOffset += 1) {
        for (let colOffset = 0; colOffset < dims.width; colOffset += 1) {
          occupied.add(
            getIsoVoxelKey(load.placement.col + colOffset, load.placement.row + rowOffset, load.placement.z + heightOffset),
          );
        }
      }
    }
  });

  return occupied;
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
