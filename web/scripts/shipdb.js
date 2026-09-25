function shipDbText(key, fallback, params = {}) {
  if (typeof window.t === "function") return window.t(key, params);
  return String(fallback || "").replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function shipDbLocale() {
  return typeof currentUiLanguage === "function" && currentUiLanguage() === "en" ? "en-US" : "de-DE";
}

const SHIP_IMAGE_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
let pendingShipDbImageFile = null;
let shipDbImagePreviewObjectUrl = "";
let originalShipDbImageUrl = "";
let shipDbImageRemovalRequested = false;

function isManagedShipImageUrl(value) {
  return /^\/?data\/ship-images\/ship-[a-f0-9]{24}\.(?:png|jpg|webp)(?:\?|$)/i.test(String(value || "").trim());
}

function setShipDbImageStatus(message = "", severity = "neutral") {
  if (!shipDbImageImportStatus) return;
  shipDbImageImportStatus.textContent = message;
  shipDbImageImportStatus.className = `form-hint form-hint-${severity} shipdb-image-status`;
  shipDbImageImportStatus.hidden = !message;
}

function revokeShipDbImagePreviewObjectUrl() {
  if (!shipDbImagePreviewObjectUrl) return;
  URL.revokeObjectURL(shipDbImagePreviewObjectUrl);
  shipDbImagePreviewObjectUrl = "";
}

function clearPendingShipDbImage() {
  pendingShipDbImageFile = null;
  revokeShipDbImagePreviewObjectUrl();
  if (shipDbImageFileInput) shipDbImageFileInput.value = "";
}

function syncShipDbImageRemoveButton() {
  if (!shipDbImageRemoveButton) return;
  shipDbImageRemoveButton.disabled = !pendingShipDbImageFile && !normalizeShipImageUrl(shipDbForm?.imageUrl?.value);
}

function syncShipDbImagePreview() {
  if (!shipDbImagePreviewWrap || !shipDbImagePreview || !shipDbForm?.imageUrl) return;
  if (pendingShipDbImageFile && shipDbImagePreviewObjectUrl) {
    shipDbImagePreviewWrap.hidden = false;
    shipDbImagePreview.src = shipDbImagePreviewObjectUrl;
    syncShipDbImageRemoveButton();
    return;
  }
  const imageUrl = normalizeShipImageUrl(shipDbForm.imageUrl.value);
  shipDbImagePreviewWrap.hidden = !imageUrl;
  shipDbImagePreviewWrap.classList.remove("is-image-error");
  if (!imageUrl) {
    shipDbImagePreview.removeAttribute("src");
    shipDbImagePreview.alt = "";
    syncShipDbImageRemoveButton();
    return;
  }
  shipDbImagePreview.src = imageUrl;
  shipDbImagePreview.alt = [getShipDbManufacturerValue(), shipDbForm.model?.value, shipDbForm.variant?.value].filter(Boolean).join(" ");
  syncShipDbImageRemoveButton();
}

function selectShipDbImageFile(file) {
  if (!file) return;
  const supportedTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
  if (!supportedTypes.has(String(file.type || "").toLowerCase())) {
    if (shipDbImageFileInput) shipDbImageFileInput.value = "";
    setShipDbImageStatus(shipDbText("shipdb.image.unsupported", "Bitte wähle eine PNG-, JPG- oder WebP-Datei."), "error");
    return;
  }
  if (file.size <= 0 || file.size > SHIP_IMAGE_UPLOAD_MAX_BYTES) {
    if (shipDbImageFileInput) shipDbImageFileInput.value = "";
    setShipDbImageStatus(shipDbText("shipdb.image.tooLarge", "Das Bild darf höchstens 5 MB groß sein."), "error");
    return;
  }
  clearPendingShipDbImage();
  pendingShipDbImageFile = file;
  shipDbImageRemovalRequested = false;
  shipDbImagePreviewObjectUrl = URL.createObjectURL(file);
  shipDbImagePreviewWrap.hidden = false;
  shipDbImagePreviewWrap.classList.remove("is-image-error");
  shipDbImagePreview.src = shipDbImagePreviewObjectUrl;
  shipDbImagePreview.alt = file.name;
  syncShipDbImageRemoveButton();
  setShipDbImageStatus(
    shipDbText("shipdb.image.selected", "{name} wird beim Speichern importiert.", { name: file.name }),
    "success",
  );
}

async function uploadShipDbImage(file, profileId) {
  const params = new URLSearchParams({ scope: activeAppMode, profile: profileId });
  const response = await fetch(`./api/ship-images?${params}`, {
    method: "POST",
    headers: window.DispatcherAuth?.getHeaders(activeAppMode, {
      "Content-Type": file.type || "application/octet-stream",
      Accept: "application/json",
    }) || { "Content-Type": file.type || "application/octet-stream", Accept: "application/json" },
    body: file,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok || !payload.url) {
    const translatedMessage = payload.error === "SHIP_IMAGE_TOO_LARGE"
      ? shipDbText("shipdb.image.tooLarge", "Das Bild darf höchstens 5 MB groß sein.")
      : payload.error === "UNSUPPORTED_SHIP_IMAGE"
        ? shipDbText("shipdb.image.unsupported", "Bitte wähle eine PNG-, JPG- oder WebP-Datei.")
        : shipDbText("shipdb.image.uploadFailed", "Das Bild konnte nicht importiert werden.");
    throw new Error(translatedMessage);
  }
  return normalizeShipImageUrl(payload.url);
}

async function deleteShipDbImage(profileId) {
  const params = new URLSearchParams({ scope: activeAppMode, profile: profileId });
  const response = await fetch(`./api/ship-images?${params}`, {
    method: "DELETE",
    headers: window.DispatcherAuth?.getHeaders(activeAppMode, { Accept: "application/json" }) || { Accept: "application/json" },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || shipDbText("shipdb.image.removeFailed", "Das Serverbild konnte nicht entfernt werden."));
  }
}

function renderShipDatabase() {
  const entries = getShipLibraryEntries();
  const gridEntries = entries.filter((entry) => entry.gridRows && entry.gridCols && Object.keys(entry.gridHeights || {}).length > 0);
  const noGridEntries = entries.filter((entry) => !Object.keys(entry.gridHeights || {}).length);
  const pricedEntries = entries.filter((entry) => Number.isFinite(entry.priceAuec));
  const fueledEntries = entries.filter((entry) => Number.isFinite(entry.hydrogenFuel) || Number.isFinite(entry.quantumFuel));
  const refuelEntries = entries.filter((entry) => hasRefuelSupport(entry));
  const linkedFleetIds = new Set(state.fleet.map((entry) => entry.shipId).filter(Boolean));

  shipDbSummary.innerHTML = [
    { label: shipDbText("shipdb.summary.total", "Gesamte Schiffe"), value: entries.length },
    { label: shipDbText("shipdb.summary.withGrid", "Mit Rasterdaten"), value: gridEntries.length },
    { label: shipDbText("shipdb.summary.withoutGrid", "Ohne Cargo-Grid"), value: noGridEntries.length },
    { label: shipDbText("shipdb.summary.withPrice", "Mit Preisangabe"), value: pricedEntries.length },
    { label: shipDbText("shipdb.summary.withFuel", "Mit Tankdaten"), value: fueledEntries.length },
    { label: shipDbText("shipdb.summary.withRefuel", "Mit Refuel-Tank"), value: refuelEntries.length },
  ]
    .map(
      (card) => `
        <div class="summary-card summary-card-compact">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
        </div>
      `,
    )
    .join("");

  shipDbEmpty.hidden = entries.length > 0;
  shipDbList.innerHTML = "";

  if (entries.length === 0) {
    return;
  }

  shipDbList.innerHTML = entries
    .map((entry) => {
      const inFleet = linkedFleetIds.has(entry.id);
      const summary = getShipGridSummary(entry);
      const containerSupport = getShipStandardContainerSupport(entry);
      const manualContainerProfile = getCargoContainerProfileByKey(containerSupport.maxContainerSizeKey);
      const manualContainerNote = containerSupport.maxContainerSizeKey
        ? containerSupport.maxContainerSizeKey === "none"
          ? shipDbText("shipdb.card.manualNoContainer", "Manuell: kein Standardcontainer")
          : shipDbText("shipdb.card.manualLimited", "Manuell begrenzt: {value}", { value: manualContainerProfile?.label || containerSupport.maxContainerSizeKey })
        : "";
      const noStandardContainer = shipDbText("shipdb.card.noStandardContainerLower", "kein Standardcontainer");
      const notesMarkup = entry.notes ? `<p class="fleet-card-notes">${escapeHtml(entry.notes)}</p>` : "";
      return `
        <article class="fleet-card${inFleet ? " is-active-entry" : ""}" data-shipdb-id="${entry.id}">
          <div class="fleet-card-head">
            <div class="shipdb-card-identity">
              ${renderShipProfileMedia(entry, "shipdb-card-media")}
              <div class="fleet-card-copy">
                <span class="fleet-card-eyebrow">${escapeHtml(entry.manufacturer)}</span>
                <h3>${escapeHtml(getShipEntryDisplayName(entry))}</h3>
              </div>
            </div>
            <div class="fleet-card-actions">
              <button class="secondary-button shipdb-edit" type="button">${escapeHtml(shipDbText("common.edit", "Bearbeiten"))}</button>
              ${
                entry.presetId
                  ? ""
                  : `
                    <button class="ghost-button shipdb-delete icon-only-button" type="button" aria-label="${escapeHtml(shipDbText("shipdb.action.deleteEntry", "Eintrag löschen"))}" title="${escapeHtml(shipDbText("shipdb.action.deleteEntry", "Eintrag löschen"))}">
                      <span class="button-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" focusable="false">
                          <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
                        </svg>
                      </span>
                    </button>
                  `
              }
            </div>
          </div>
          <div class="fleet-card-meta">
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.cargo", "Frachtraum"))}</span>
              <strong>${escapeHtml(summary.overload.totalScu > 0 ? shipDbText("shipdb.card.cargoWithOverload", "{official} SCU ({total} SCU mit Überladung)", { official: summary.official.totalScu, total: summary.total.totalScu }) : entry.cargoScu ? `${entry.cargoScu} SCU` : shipDbText("shipdb.card.noCargoGrid", "Kein Cargo-Grid"))}</strong>
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.maxStandardContainer", "Max. Standardcontainer"))}</span>
              <strong>${escapeHtml(containerSupport.officialProfile?.label || noStandardContainer)}</strong>
              ${
                summary.overload.totalScu > 0
                  ? `<small>${escapeHtml(shipDbText("shipdb.card.overloaded", "Überladen: {value}", { value: containerSupport.totalProfile?.label || noStandardContainer }))}</small>`
                  : ""
              }
              ${manualContainerNote ? `<small>${escapeHtml(manualContainerNote)}</small>` : ""}
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.price", "Preis"))}</span>
              <strong>${escapeHtml(entry.priceAuec ? `${entry.priceAuec.toLocaleString(shipDbLocale())} aUEC` : shipDbText("common.open", "offen"))}</strong>
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.hangar", "Hangargröße"))}</span>
              <strong>${escapeHtml(formatHangarSize(entry.hangarSize) || shipDbText("common.open", "offen"))}</strong>
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.class", "Klasse"))}</span>
              <strong>${escapeHtml(getShipClassLabel(entry.shipClass) || shipDbText("common.open", "offen"))}</strong>
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.hydrogen", "Wasserstofftank"))}</span>
              <strong>${escapeHtml(Number.isFinite(entry.hydrogenFuel) ? entry.hydrogenFuel.toLocaleString(shipDbLocale(), { maximumFractionDigits: 2 }) : shipDbText("common.open", "offen"))}</strong>
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.quantum", "Quantentank"))}</span>
              <strong>${escapeHtml(Number.isFinite(entry.quantumFuel) ? entry.quantumFuel.toLocaleString(shipDbLocale(), { maximumFractionDigits: 2 }) : shipDbText("common.open", "offen"))}</strong>
            </div>
            <div>
              <span>${escapeHtml(shipDbText("shipdb.card.refuelContainers", "Refuel-Behälter"))}</span>
              <strong>${escapeHtml(formatRefuelSupport(entry) || shipDbText("shipdb.card.notAvailable", "nicht vorhanden"))}</strong>
            </div>
          </div>
          ${notesMarkup}
        </article>
      `;
    })
    .join("");

  bindShipProfileMedia(shipDbList);

  shipDbList.querySelectorAll(".shipdb-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.shipLibrary.find((candidate) => candidate.id === button.closest(".fleet-card")?.dataset.shipdbId);
      if (!entry) return;
      populateShipDbForm(entry);
      setShipDbView("create");
      setActivePage("ships");
    });
  });

  shipDbList.querySelectorAll(".shipdb-delete").forEach((button) => {
    button.addEventListener("click", async () => {
      const card = button.closest(".fleet-card");
      const entry = state.shipLibrary.find((candidate) => candidate.id === card?.dataset.shipdbId);
      if (!entry) return;
      const isLinked = state.fleet.some((candidate) => candidate.shipId === entry.id);
      if (isLinked) {
        await showAppNotice(shipDbText("shipdb.alert.linkedFleet", "Dieses Schiffsprofil ist noch mit Flotteneinträgen verknüpft und kann erst danach gelöscht werden."));
        return;
      }
      const shouldDelete = await showMissionConfirmDialog({
        kicker: shipDbText("settings.shipDatabase", "Schiffsdatenbank"),
        title: shipDbText("common.delete", "Löschen"),
        message: shipDbText("shipdb.confirm.delete", "Schiffseintrag \"{name}\" wirklich löschen?", {
          name: `${entry.manufacturer} ${entry.model}${entry.variant ? ` ${entry.variant}` : ""}`,
        }),
        confirmLabel: shipDbText("common.delete", "Löschen"),
        tone: "danger",
      });
      if (!shouldDelete) return;
      state.shipLibrary = state.shipLibrary.filter((candidate) => candidate.id !== entry.id);
      if (shipDbForm.entryId.value === entry.id) {
        resetShipDbForm();
      }
      persist();
      render();
    });
  });
}

function renderShipClassOptions() {
  if (!shipDbForm?.shipClass) return;
  const selectedClass = normalizeShipClass(shipDbForm.shipClass.value);
  shipDbForm.shipClass.innerHTML = SHIP_CLASS_OPTIONS
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(localizeLabel(option))}</option>`)
    .join("");
  shipDbForm.shipClass.value = selectedClass;
}

function syncShipDbClassFields() {
  if (!shipDbRefuelContainerWrap || !shipDbForm?.shipClass) return;
  const isRefuelClass = isRefuelShipClass(shipDbForm.shipClass.value);
  shipDbRefuelContainerWrap.hidden = !isRefuelClass;
  if (!isRefuelClass) {
    shipDbForm.refuelContainerCount.value = "";
  }
}

function readShipDbDraft() {
  const formData = new FormData(shipDbForm);
  const gridSummary = summarizeGridHeights(shipBuilderState.heights);
  const shipClass = String(formData.get("shipClass") || "").trim();
  return {
    id: String(formData.get("entryId") || "").trim() || createRuntimeId(),
    manufacturer: getShipDbManufacturerValue(),
    model: String(formData.get("model") || "").trim(),
    variant: String(formData.get("variant") || "").trim(),
    imageUrl: normalizeShipImageUrl(formData.get("imageUrl")),
    shipClass,
    cargoScu: gridSummary.totalScu,
    priceAuec: formData.get("priceAuec"),
    hydrogenFuel: formData.get("hydrogenFuel"),
    quantumFuel: formData.get("quantumFuel"),
    refuelContainerCount: isRefuelShipClass(shipClass) ? formData.get("refuelContainerCount") : "",
    hangarSize: String(formData.get("hangarSize") || "").trim(),
    maxContainerSizeKey: formData.get("maxContainerSizeKey"),
    presetId: String(formData.get("presetId") || "").trim(),
    gridRows: shipBuilderState.rows,
    gridCols: shipBuilderState.cols,
    gridLevels: shipBuilderState.levels,
    gridHeights: { ...shipBuilderState.heights },
    overloadGridHeights: { ...shipBuilderState.overloadHeights },
    notes: String(formData.get("notes") || "").trim(),
  };
}

function populateShipDbForm(entry) {
  clearPendingShipDbImage();
  setShipDbImageStatus();
  originalShipDbImageUrl = normalizeShipImageUrl(entry.imageUrl);
  shipDbImageRemovalRequested = false;
  shipDbForm.entryId.value = entry.id;
  if (SHIP_MANUFACTURERS.includes(entry.manufacturer)) {
    shipDbManufacturerSelect.value = entry.manufacturer;
    shipDbManufacturerCustom.value = "";
  } else {
    shipDbManufacturerSelect.value = "__custom__";
    shipDbManufacturerCustom.value = entry.manufacturer || "";
  }
  syncShipManufacturerField();
  shipDbForm.model.value = entry.model;
  shipDbForm.variant.value = entry.variant || "";
  shipDbForm.imageUrl.value = entry.imageUrl || "";
  shipDbForm.shipClass.value = entry.shipClass || "";
  shipDbForm.priceAuec.value = entry.priceAuec ?? "";
  shipDbForm.hydrogenFuel.value = entry.hydrogenFuel ?? "";
  shipDbForm.quantumFuel.value = entry.quantumFuel ?? "";
  shipDbForm.refuelContainerCount.value = entry.refuelContainerCount ?? "";
  shipDbForm.hangarSize.value = entry.hangarSize || "";
  shipDbForm.maxContainerSizeKey.value = entry.maxContainerSizeKey || "";
  shipDbForm.presetId.value = entry.presetId || "";
  syncShipDbClassFields();
  setShipBuilderState(
    createShipBuilderState({
      rows: entry.gridRows,
      cols: entry.gridCols,
      levels: entry.gridLevels || getShipGridSummary(entry).total.maxHeight,
      heights: entry.gridHeights,
      overloadHeights: entry.overloadGridHeights,
      mode: "base",
    }),
  );
  shipDbForm.notes.value = entry.notes || "";
  syncShipDbImagePreview();
  shipDbSubmitButton.textContent = shipDbText("common.saveChanges", "Änderungen speichern");
  shipDbCancelButton.hidden = false;
}

function resetShipDbForm() {
  clearPendingShipDbImage();
  setShipDbImageStatus();
  originalShipDbImageUrl = "";
  shipDbImageRemovalRequested = false;
  shipDbForm.reset();
  shipDbForm.entryId.value = "";
  shipDbForm.presetId.value = "";
  shipDbManufacturerSelect.value = "";
  shipDbManufacturerCustom.value = "";
  syncShipManufacturerField();
  if (shipDbForm.shipClass) {
    shipDbForm.shipClass.value = "";
  }
  if (shipDbForm.maxContainerSizeKey) {
    shipDbForm.maxContainerSizeKey.value = "";
  }
  syncShipDbClassFields();
  setShipBuilderState(createShipBuilderState({ mode: "base" }));
  syncShipDbImagePreview();
  shipDbSubmitButton.textContent = shipDbText("shipdb.form.save", "Schiff speichern");
  shipDbCancelButton.hidden = true;
}

function registerShipDbEvents() {
  shipDbForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = readShipDbDraft();
    if (!draft.manufacturer || !draft.model) {
      await showAppNotice(shipDbText("shipdb.alert.missingRequired", "Bitte trage mindestens Hersteller und Modell ein."));
      return;
    }
    const existingIndex = state.shipLibrary.findIndex((entry) => entry.id === draft.id);
    const existingEntry = existingIndex >= 0 ? state.shipLibrary[existingIndex] : null;
    if (shipDbSubmitButton) shipDbSubmitButton.disabled = true;
    try {
      if (pendingShipDbImageFile) {
        setShipDbImageStatus(shipDbText("shipdb.image.uploading", "Bild wird auf den Server geladen ..."), "neutral");
        draft.imageUrl = await uploadShipDbImage(pendingShipDbImageFile, draft.id);
      } else if (shipDbImageRemovalRequested && existingEntry) {
        setShipDbImageStatus(shipDbText("shipdb.image.removing", "Serverbild wird entfernt ..."), "neutral");
        await deleteShipDbImage(draft.id);
      }
    } catch (error) {
      setShipDbImageStatus(error?.message || shipDbText("shipdb.image.uploadFailed", "Das Bild konnte nicht importiert werden."), "error");
      if (shipDbSubmitButton) shipDbSubmitButton.disabled = false;
      return;
    }
    const nextEntry = createShipLibraryEntry({
      ...draft,
      createdAt: existingEntry?.createdAt,
    });
    if (existingIndex >= 0) {
      state.shipLibrary.splice(existingIndex, 1, nextEntry);
    } else {
      state.shipLibrary.unshift(nextEntry);
    }

    resetShipDbForm();
    persist();
    render();
    setShipDbView("database");
    setActivePage("ships");
    if (shipDbSubmitButton) shipDbSubmitButton.disabled = false;
  });

  shipDbCancelButton?.addEventListener("click", () => {
    resetShipDbForm();
    setShipDbView("database");
  });

  shipDbViewTabs.forEach((button) => {
    button.addEventListener("click", () => {
      const nextView = button.dataset.shipdbViewTarget || "database";
      setShipDbView(nextView);
    });
  });

  shipDbManufacturerSelect?.addEventListener("change", () => {
    syncShipManufacturerField();
  });

  shipDbForm?.shipClass?.addEventListener("change", () => {
    syncShipDbClassFields();
  });

  shipDbForm?.imageUrl?.addEventListener("input", () => {
    clearPendingShipDbImage();
    const nextImageUrl = normalizeShipImageUrl(shipDbForm.imageUrl.value);
    shipDbImageRemovalRequested = isManagedShipImageUrl(originalShipDbImageUrl) && nextImageUrl !== originalShipDbImageUrl;
    setShipDbImageStatus();
    syncShipDbImagePreview();
  });
  shipDbForm?.model?.addEventListener("input", syncShipDbImagePreview);
  shipDbForm?.variant?.addEventListener("input", syncShipDbImagePreview);
  shipDbImageFileInput?.addEventListener("change", () => selectShipDbImageFile(shipDbImageFileInput.files?.[0]));
  shipDbImageRemoveButton?.addEventListener("click", () => {
    clearPendingShipDbImage();
    if (shipDbForm?.imageUrl) shipDbForm.imageUrl.value = "";
    shipDbImageRemovalRequested = isManagedShipImageUrl(originalShipDbImageUrl);
    setShipDbImageStatus(shipDbText("shipdb.image.removedOnSave", "Das Bild wird beim Speichern entfernt."), "neutral");
    syncShipDbImagePreview();
  });
  shipDbImagePreview?.addEventListener("load", () => shipDbImagePreviewWrap?.classList.remove("is-image-error"));
  shipDbImagePreview?.addEventListener("error", () => shipDbImagePreviewWrap?.classList.add("is-image-error"));

  shipDbPresetSelect?.addEventListener("change", () => {
    const preset = SHIP_PRESETS[shipDbPresetSelect.value];
    if (!preset) return;

    if (!getShipDbManufacturerValue()) {
      if (SHIP_MANUFACTURERS.includes(preset.manufacturer)) {
        shipDbManufacturerSelect.value = preset.manufacturer;
        shipDbManufacturerCustom.value = "";
      } else {
        shipDbManufacturerSelect.value = "__custom__";
        shipDbManufacturerCustom.value = preset.manufacturer || "";
      }
      syncShipManufacturerField();
    }
    if (!shipDbForm.model.value) {
      shipDbForm.model.value = preset.name || "";
    }

    setShipBuilderState(buildShipBuilderStateFromPreset(preset.id));
  });

  shipDbGridRowsInput?.addEventListener("change", () => {
    setShipBuilderState({
      ...shipBuilderState,
      rows: clamp(Number(shipDbGridRowsInput.value) || shipBuilderState.rows, 2, MAX_GRID_ROWS),
    });
  });

  shipDbGridColsInput?.addEventListener("change", () => {
    setShipBuilderState({
      ...shipBuilderState,
      cols: clamp(Number(shipDbGridColsInput.value) || shipBuilderState.cols, 2, 12),
    });
  });

  shipDbGridLevelsInput?.addEventListener("change", () => {
    setShipBuilderState({
      ...shipBuilderState,
      levels: clamp(Number(shipDbGridLevelsInput.value) || shipBuilderState.levels, 1, 8),
      activeLevel: Math.min(shipBuilderState.activeLevel, clamp(Number(shipDbGridLevelsInput.value) || shipBuilderState.levels, 1, 8)),
    });
  });

  shipDbForm?.maxContainerSizeKey?.addEventListener("change", () => {
    renderShipGridBuilder();
  });

  shipDbGridClearLevelButton?.addEventListener("click", () => {
    clearShipBuilderLevel();
  });

  shipDbGridClearAllButton?.addEventListener("click", async () => {
    const shouldClear = await showMissionConfirmDialog({
      kicker: shipDbText("settings.shipDatabase", "Schiffsdatenbank"),
      title: shipDbText("shipdb.builder.clearAll", "Alles leeren"),
      message: shipBuilderState.mode === "overload"
        ? shipDbText("shipdb.confirm.clearOverload", "Soll die komplette Überladung dieses Schiffstyps geleert werden?")
        : shipDbText("shipdb.confirm.clearGrid", "Soll das komplette offizielle Cargogrid dieses Schiffstyps geleert werden?"),
      confirmLabel: shipDbText("shipdb.builder.clearAll", "Alles leeren"),
      tone: "danger",
    });
    if (!shouldClear) return;
    clearShipBuilderAll();
  });

  shipDbGridMode?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-shipdb-mode]");
    if (!button) return;
    const nextMode = button.dataset.shipdbMode === "overload" ? "overload" : "base";
    if (nextMode === shipBuilderState.mode) return;
    setShipBuilderState({
      ...shipBuilderState,
      mode: nextMode,
    });
  });
}
