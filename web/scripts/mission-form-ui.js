// Mission form state, editing and ship readiness presentation.
function resetMissionForm() {
  clearMissionImportQuality();
  missionForm.reset();
  if (missionForm.elements.entryId) {
    missionForm.elements.entryId.value = "";
  }
  if (missionTypeSelect) {
    missionTypeSelect.value = "other";
  }
  if (missionFormTitle) {
    missionFormTitle.textContent = cargoText("contracts.form.title.create", "Neuen Auftrag anlegen");
  }
  if (missionSubmitButton) {
    missionSubmitButton.textContent = cargoText("contracts.form.submit.create", "Auftrag erstellen");
  }
  if (missionCancelButton) {
    missionCancelButton.hidden = true;
  }
  const assignmentFields = document.querySelector("#missionAssignmentEditFields");
  if (assignmentFields) assignmentFields.hidden = true;
  if (missionForm.elements.assignedFleetEntryId) {
    missionForm.elements.assignedFleetEntryId.innerHTML = "";
  }
  missionForm.color.value = typeof getNextMissionColor === "function" ? getNextMissionColor() : DEFAULT_COLOR;
  consignmentList.innerHTML = "";
  ensureConsignmentRows();
  resetCourierPackages();
  resetDeliveryItems();
  resetProcurementItems();
  resetQuickMissionCapture();
  if (missionValidationOverride) {
    missionValidationOverride.checked = false;
  }
  if (missionValidationOverrideWrap) {
    missionValidationOverrideWrap.hidden = true;
  }
  if (missionValidationHint) {
    missionValidationHint.hidden = true;
    missionValidationHint.innerHTML = "";
  }
  setCollapsibleExpanded("quickCaptureBody", false);
  setCollapsibleExpanded("consignmentBuilderBody", true);
  syncMissionTypeFields();
  updateDimensionHint();
}

function renderMissionAssignmentEditor(mission) {
  const assignmentFields = document.querySelector("#missionAssignmentEditFields");
  const assignmentSelect = missionForm.elements.assignedFleetEntryId;
  if (!assignmentFields || !assignmentSelect || !mission?.id) return;

  const fleetEntries = [...(state.fleet || [])]
    .filter((entry) => entry?.id && entry?.shipId)
    .sort((left, right) => {
      const statusCompare = Number(right.status === "active") - Number(left.status === "active");
      if (statusCompare !== 0) return statusCompare;
      return formatFleetEntryDisplayName(left).localeCompare(formatFleetEntryDisplayName(right), cargoLocale(), { numeric: true });
    });
  assignmentSelect.innerHTML = [
    `<option value="">${escapeHtml(cargoText("contracts.form.noAssignedShip", "Kein Schiff zugeordnet"))}</option>`,
    ...fleetEntries.map((entry) => {
      const status = entry.status === "active"
        ? cargoText("common.active", "Aktiv")
        : cargoText(`fleet.status.${entry.status}`, entry.status || "");
      return `<option value="${escapeHtml(entry.id)}">${escapeHtml(`${formatFleetEntryDisplayName(entry)} · ${status}`)}</option>`;
    }),
  ].join("");
  assignmentSelect.value = fleetEntries.some((entry) => entry.id === mission.assignedFleetEntryId)
    ? mission.assignedFleetEntryId
    : "";
  assignmentFields.hidden = false;
}

function recalculateMissionContainerGroups() {
  const missionMaxContainerScu = getMissionFormMaxContainerScu();
  const routeNodes = Array.from(consignmentList?.querySelectorAll(".route-group-row") || []);

  routeNodes.forEach((routeNode) => {
    const targetScu = readRouteTargetScu(routeNode);
    if (!Number.isInteger(targetScu) || targetScu <= 0) return;

    const suggestedGroups = buildContainerGroupsForScu(targetScu, missionMaxContainerScu);
    const groupList = routeNode.querySelector('[data-role="container-group-list"]');
    if (!groupList || suggestedGroups.length === 0) return;

    groupList.innerHTML = "";
    suggestedGroups.forEach((group) => addContainerGroupRow(routeNode, group));
    syncRouteGroupHint(routeNode);
    syncConsignmentHint(routeNode.closest(".consignment-item"));
  });

  refreshConsignmentTitles();
  updateDimensionHint();
}

function getMissionEditId() {
  return String(missionForm.elements.entryId?.value || "").trim();
}
function buildConsignmentRowsFromMission(mission) {
  const cargoRows = new Map();
  getMissionSegments(mission).forEach((segment, index) => {
    const cargoIndex = Number.isInteger(segment.cargoIndex) ? segment.cargoIndex : index;
    const routeIndex = Number.isInteger(segment.cargoRouteIndex) ? segment.cargoRouteIndex : 0;
    const cargoKey = String(cargoIndex);
    if (!cargoRows.has(cargoKey)) {
      cargoRows.set(cargoKey, {
        order: cargoIndex,
        title: segment.title || mission.title || "",
        expectedTotalScu: Number(segment.expectedCargoScu) || 0,
        routes: new Map(),
      });
    }

    const cargoRow = cargoRows.get(cargoKey);
    cargoRow.expectedTotalScu = Math.max(cargoRow.expectedTotalScu, Number(segment.expectedCargoScu) || 0);
    const routeKey = `${routeIndex}|${segment.pickup || ""}|${segment.dropoff || ""}`;
    if (!cargoRow.routes.has(routeKey)) {
      cargoRow.routes.set(routeKey, {
        order: routeIndex,
        pickup: segment.pickup || "",
        dropoff: segment.dropoff || "",
        targetScu: segment.routeTargetScu || "",
        groups: [],
      });
    }

    const route = cargoRow.routes.get(routeKey);
    if (!segment.quantityPending) {
      route.groups.push({
        quantity: segment.quantity,
        containerSize: segment.containerSize,
        width: segment.width,
        depth: segment.depth,
        height: segment.height,
      });
    }
  });

  return [...cargoRows.values()]
    .sort((left, right) => left.order - right.order)
    .map((row) => ({
      title: row.title,
      expectedTotalScu: row.expectedTotalScu,
      routes: [...row.routes.values()]
        .sort((left, right) => left.order - right.order)
        .map((route) => ({
          pickup: route.pickup,
          dropoff: route.dropoff,
          targetScu: route.targetScu,
          groups: route.groups,
        })),
    }));
}

function populateMissionForm(mission, { create = false } = {}) {
  resetMissionForm();
  const missionType = normalizeMissionType(mission?.type);
  if (missionForm.elements.entryId) missionForm.elements.entryId.value = create ? "" : mission.id || "";
  if (missionTypeSelect) missionTypeSelect.value = missionType;
  if (missionForm.elements.title) missionForm.elements.title.value = mission.title || "";
  if (missionForm.elements.payout) {
    const importedZeroPayout = mission?.sourceImportQuality?.payout === "verified" && mission.payout == null;
    missionForm.elements.payout.value = importedZeroPayout ? 0 : mission.payout ?? "";
  }
  if (missionForm.elements.maxContainerScu) missionForm.elements.maxContainerScu.value = mission.maxContainerScu ?? "";
  if (missionForm.elements.color) missionForm.elements.color.value = mission.color || DEFAULT_COLOR;
  if (missionForm.elements.notes) missionForm.elements.notes.value = mission.notes || "";
  if (!create) renderMissionAssignmentEditor(mission);

  if (missionType === "cargo") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.cargoCustomer) missionForm.elements.cargoCustomer.value = details.customer || "";
    consignmentList.innerHTML = "";
    const rows = buildConsignmentRowsFromMission(mission);
    if (rows.length > 0) {
      rows.forEach((row) => addConsignmentRow(row));
    } else {
      ensureConsignmentRows();
    }
  } else if (missionType === "courier") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.courierCustomer) missionForm.elements.courierCustomer.value = details.customer || "";
    if (missionForm.elements.courierMaxPackageScu) missionForm.elements.courierMaxPackageScu.value = details.maxPackageScu ?? "";
    if (missionForm.elements.courierInstructions) missionForm.elements.courierInstructions.value = details.instructions || "";
    resetCourierPackages(details.packages);
  } else if (missionType === "delivery") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.deliveryCustomer) missionForm.elements.deliveryCustomer.value = details.customer || "";
    if (missionForm.elements.deliveryInstructions) missionForm.elements.deliveryInstructions.value = details.instructions || details.dangerNote || "";
    resetDeliveryItems(details.packages);
  } else if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.refuelCustomer) missionForm.elements.refuelCustomer.value = details.customer || "";
    if (missionForm.elements.refuelLocation) missionForm.elements.refuelLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.refuelServiceType) missionForm.elements.refuelServiceType.value = details.serviceType || "both";
    if (missionForm.elements.refuelHydrogenAmount) missionForm.elements.refuelHydrogenAmount.value = details.hydrogenAmount ?? "";
    if (missionForm.elements.refuelQuantumAmount) missionForm.elements.refuelQuantumAmount.value = details.quantumAmount ?? "";
    if (missionForm.elements.refuelTargetVehicle) missionForm.elements.refuelTargetVehicle.value = details.targetVehicle || "";
    if (missionForm.elements.refuelHydrogenRate) missionForm.elements.refuelHydrogenRate.value = details.hydrogenRate ?? "";
    if (missionForm.elements.refuelQuantumRate) missionForm.elements.refuelQuantumRate.value = details.quantumRate ?? "";
    if (missionForm.elements.refuelBonus) missionForm.elements.refuelBonus.value = details.bonus || "";
  } else if (missionType === "investigation") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.investigationCustomer) missionForm.elements.investigationCustomer.value = details.customer || "";
    if (missionForm.elements.investigationLocation) missionForm.elements.investigationLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.investigationSubject) missionForm.elements.investigationSubject.value = details.subject || "";
    if (missionForm.elements.investigationCaseNumber) missionForm.elements.investigationCaseNumber.value = details.caseNumber || "";
    if (missionForm.elements.investigationLead) missionForm.elements.investigationLead.value = details.leadInvestigator || "";
    if (missionForm.elements.investigationInstructions) missionForm.elements.investigationInstructions.value = details.instructions || "";
    if (missionForm.elements.investigationDangerNote) missionForm.elements.investigationDangerNote.value = details.dangerNote || "";
  } else if (missionType === "salvage") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.salvageCustomer) missionForm.elements.salvageCustomer.value = details.customer || "";
    if (missionForm.elements.salvageLocation) missionForm.elements.salvageLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.salvageTarget) missionForm.elements.salvageTarget.value = details.salvageTarget || "";
    if (missionForm.elements.salvageClaimNumber) missionForm.elements.salvageClaimNumber.value = details.claimNumber || "";
    if (missionForm.elements.salvageInstructions) missionForm.elements.salvageInstructions.value = details.instructions || "";
  } else if (missionType === "procurement") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.procurementCustomer) missionForm.elements.procurementCustomer.value = details.customer || "";
    if (missionForm.elements.procurementLocation) missionForm.elements.procurementLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.procurementInstructions) missionForm.elements.procurementInstructions.value = details.instructions || "";
    resetProcurementItems(details.items);
  } else if (missionType === "mining") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.miningCustomer) missionForm.elements.miningCustomer.value = details.customer || "";
    if (missionForm.elements.miningLocation) missionForm.elements.miningLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.miningMethod) missionForm.elements.miningMethod.value = details.miningMethod || "hand";
    if (missionForm.elements.miningSearchArea) missionForm.elements.miningSearchArea.value = details.searchArea || "";
    if (missionForm.elements.miningMaterial) missionForm.elements.miningMaterial.value = details.material || "";
    if (missionForm.elements.miningTargetAmount) missionForm.elements.miningTargetAmount.value = details.targetAmount ?? "";
    if (missionForm.elements.miningTool) missionForm.elements.miningTool.value = details.tool || "";
    if (missionForm.elements.miningInstructions) missionForm.elements.miningInstructions.value = details.instructions || "";
  } else if (missionType === "other") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.miscCustomer) missionForm.elements.miscCustomer.value = details.customer || "";
    if (missionForm.elements.miscLocation) missionForm.elements.miscLocation.value = details.location || mission.dropoff || "";
  } else {
    consignmentList.innerHTML = "";
    const rows = buildConsignmentRowsFromMission(mission);
    if (rows.length > 0) {
      rows.forEach((row) => addConsignmentRow(row));
    } else {
      ensureConsignmentRows();
    }
  }

  if (missionFormTitle && !create) {
    missionFormTitle.textContent = cargoText("contracts.form.title.edit", "Auftrag bearbeiten");
  }
  if (missionSubmitButton && !create) {
    missionSubmitButton.textContent = cargoText("common.saveChanges", "Änderungen speichern");
  }
  if (missionCancelButton && !create) {
    missionCancelButton.hidden = false;
  }

  syncMissionTypeFields();
  renderMissionImportQuality(mission.sourceImportQuality);
  updateDimensionHint();
  renderLocationSuggestions();
  setActivePage("create");
}

function renderCreateShipIndicator() {
  if (!createShipIndicator || !createShipName || !createShipMeta) return;

  const missionType = getSelectedMissionType();
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const activeEntry = dispatcherMode ? null : currentActiveFleetEntry();
  const media = activeEntry ? getFleetMediaEntry(activeEntry) : null;
  const imageKey = JSON.stringify([activeEntry?.id, media?.imageUrl, media?.manufacturer, media?.model, media?.variant]);
  if (createShipIndicator.dataset.shipImageKey !== imageKey) {
    createShipIndicator.querySelector(':scope > .ship-card-art')?.remove();
    createShipIndicator.insertAdjacentHTML('beforeend', renderShipCardArt(media));
    createShipIndicator.dataset.shipImageKey = imageKey;
    createShipIndicator.classList.toggle('ship-art-card', Boolean(media));
    bindShipProfileMedia(createShipIndicator);
  }
  const indicatorLabel = createShipIndicator.querySelector(":scope > span");
  if (indicatorLabel) {
    indicatorLabel.textContent = dispatcherMode
      ? cargoText("contracts.form.dispatchAssignment", "Disposition")
      : cargoText("contracts.form.currentShip", "Aktuelles Schiff");
  }

  if (dispatcherMode) {
    createShipName.textContent = cargoText("contracts.form.assignmentLater", "Zuweisung später");
    if (createShipRegistration) {
      createShipRegistration.textContent = cargoText("contracts.form.assignmentLaterDetail", "Auftrag kann später einem oder mehreren Schiffen zugeordnet werden.");
    }
    const deliveryUsesCargo = missionType === "delivery" && collectDeliveryItems().some((item) => Number(item.containerScu) > 0);
    const unrestrictedMission = ["other", "courier", "investigation", "procurement"].includes(missionType)
      || (missionType === "delivery" && !deliveryUsesCargo)
      || (missionType === "mining" && String(missionForm?.elements?.miningMethod?.value || "hand") === "hand");
    createShipMeta.textContent = unrestrictedMission
      ? cargoText("contracts.form.noShipLimit", "Keine Schiffsbeschränkung")
      : cargoText("contracts.form.dispatchCheckLater", "Fachliche Prüfung erfolgt bei der Zuweisung.");
    if (createShipStatus) {
      createShipStatus.hidden = true;
      createShipStatus.textContent = "";
      createShipStatus.title = createShipMeta.textContent;
    }
    createShipIndicator.classList.remove("is-warning", "is-error");
    createShipIndicator.classList.add("is-ready");
    return;
  }

  const shipProfile = currentActiveShipProfile();
  const shipName = activeEntry
    ? `${activeEntry.manufacturer} ${activeEntry.model}`.trim()
    : t("hub.summary.noActiveShip");

  createShipName.textContent = shipName;
  if (createShipRegistration) {
    createShipRegistration.textContent = activeEntry
      ? formatFleetRegistration(activeEntry)
      : cargoText("contracts.form.chooseFleet", "Wähle ein Schiff in der Flotte");
  }

  createShipIndicator.classList.remove("is-ready", "is-warning", "is-error");

  const deliveryUsesCargo = missionType === "delivery" && collectDeliveryItems().some((item) => Number(item.containerScu) > 0);
  if (["other", "courier", "investigation", "procurement"].includes(missionType)
    || (missionType === "delivery" && !deliveryUsesCargo)
    || (missionType === "mining" && String(missionForm?.elements?.miningMethod?.value || "hand") === "hand")) {
    createShipMeta.textContent = cargoText("contracts.form.noShipLimit", "Keine Schiffsbeschränkung");
    if (createShipStatus) {
      createShipStatus.hidden = true;
      createShipStatus.textContent = "";
      createShipStatus.title = cargoText("contracts.form.everyShipAllowed", "Jedes aktive Schiff ist für diesen Auftrag zulässig.");
    }
    createShipIndicator.classList.add("is-ready");
    return;
  }

  if (missionType === "refuel") {
    const formData = new FormData(missionForm);
    const serviceType = normalizeRefuelServiceType(formData.get("refuelServiceType"));
    const hydrogenAmount = parseMissionDecimal(formData.get("refuelHydrogenAmount"));
    const quantumAmount = parseMissionDecimal(formData.get("refuelQuantumAmount"));
    const readiness = getRefuelReadiness(serviceType, { hydrogenAmount, quantumAmount });
    createShipMeta.textContent = activeEntry && shipProfile
      ? formatFleetRefuelSupport(activeEntry, shipProfile)
      : cargoText("contracts.form.noRefuelCapacityChecked", "Keine Refuel-Kapazität geprüft");
    if (createShipStatus) {
      createShipStatus.hidden = readiness.ok;
      createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
      createShipStatus.title = readiness.message;
    }
    createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
    return;
  }
  if (missionType === "salvage") {
    const readiness = getSalvageReadiness();
    createShipMeta.textContent = activeEntry && shipProfile
      ? getShipClassLabel(shipProfile.shipClass) || cargoText("contracts.form.noShipClass", "Keine Schiffsklasse")
      : cargoText("contracts.form.noSalvageCapacityChecked", "Keine Bergungsklasse geprüft");
    if (createShipStatus) {
      createShipStatus.hidden = readiness.ok;
      createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
      createShipStatus.title = readiness.message;
    }
    createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
    return;
  }
  if (missionType === "mining") {
    const readiness = getMiningReadiness(missionForm?.elements?.miningMethod?.value || "hand");
    createShipMeta.textContent = activeEntry && shipProfile
      ? getShipClassLabel(shipProfile.shipClass) || cargoText("contracts.form.noShipClass", "Keine Schiffsklasse")
      : cargoText("contracts.form.noMiningCapacityChecked", "Keine Bergbauklasse geprüft");
    if (createShipStatus) {
      createShipStatus.hidden = readiness.ok;
      createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
      createShipStatus.title = readiness.message;
    }
    createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
    return;
  }

  const consignments = missionType === "delivery"
    ? buildDeliverySegments(collectDeliveryItems())
    : collectConsignments();
  const requestedScu = getPlannedConsignmentScu(consignments);
  const cargoState = getActiveCargoCapacityState();
  const readiness = getCargoReadiness({ requestedScu });
  if (cargoState.totalCapacity > 0) {
    createShipMeta.textContent = cargoState.layoutMatchesActive
      ? cargoText("contracts.form.cargoUsage", "{used} / {total} SCU belegt · {free} SCU frei", {
          used: cargoState.usedCapacity,
          total: cargoState.totalCapacity,
          free: cargoState.freeCapacity,
        })
      : cargoText("contracts.form.cargoSpace", "{value} Frachtraum", { value: formatScuAmount(cargoState.totalCapacity) });
  } else {
    createShipMeta.textContent = activeEntry
      ? cargoText("contracts.form.noCargoGrid", "Kein Cargo-Grid")
      : cargoText("contracts.form.noCargoCapacityChecked", "Keine Frachtkapazität geprüft");
  }
  if (createShipStatus) {
    createShipStatus.hidden = readiness.ok;
    createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
    createShipStatus.title = readiness.message;
  }
  createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
}

let missionCargoEditor = null;
function getMissionCargoEditor() {
  missionCargoEditor ||= MissionCargoEdit.create({getMissionSegments, createLoad});
  return missionCargoEditor;
}
function createLoadsFromConsignments(consignments) { return getMissionCargoEditor().createLoads(consignments); }
function mergeCargoMissionDraft(mission, segments, options) { return getMissionCargoEditor().mergeDraft(mission, segments, options); }

function registerMissionFormEvents() {
  createShipIndicator?.addEventListener("click", () => {
    setActivePage("fleet");
  });

  createShipIndicator?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setActivePage("fleet");
  });

  missionTypeSelect?.addEventListener("change", () => {
    syncMissionTypeFields();
    renderCreateShipIndicator();
    updateDimensionHint();
  });

  addProcurementItemButton?.addEventListener("click", () => {
    createProcurementItemRow();
    renderCreateDraftSummary();
    procurementItemList?.querySelector(".procurement-item-row:last-child [name=procurementItemQuantity]")?.focus();
  });

  procurementItemList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".procurement-item-remove");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest(".procurement-item-row")?.remove();
    syncProcurementItemRows();
    renderMissionImportQuality();
    renderCreateDraftSummary();
  });

  addCourierPackageButton?.addEventListener("click", () => {
    createCourierPackageRow();
    renderCreateDraftSummary();
    courierPackageList?.querySelector(".courier-package-row:last-child [name=courierPackageName]")?.focus();
  });

  courierPackageList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".courier-package-remove");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest(".courier-package-row")?.remove();
    syncCourierPackageRows();
    renderMissionImportQuality();
    renderCreateDraftSummary();
  });

  addDeliveryItemButton?.addEventListener("click", () => {
    createDeliveryItemRow();
    renderMissionImportQuality();
    renderCreateDraftSummary();
    deliveryItemList?.querySelector(".delivery-item-row:last-child [name=deliveryItemName]")?.focus();
  });

  deliveryItemList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".delivery-item-remove");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest(".delivery-item-row")?.remove();
    syncDeliveryItemRows();
    renderMissionImportQuality();
    renderCreateDraftSummary();
  });

  missionCancelButton?.addEventListener("click", () => {
    resetMissionForm();
    setActivePage("overview");
  });

  missionForm.addEventListener("input", (event) => {
    markMissionImportFieldReviewed(event.target);
    if (event.target === missionForm.elements.maxContainerScu) {
      refreshContainerGroupCompatibility();
      updateDimensionHint();
      return;
    }
    renderCreateDraftSummary();
  });

  missionForm.addEventListener("change", () => {
    renderCreateDraftSummary();
  });

  recalculateContainerGroupsButton?.addEventListener("click", recalculateMissionContainerGroups);

  missionForm.addEventListener("submit", submitMissionForm);
}

function getSelectedMissionType() {
  return normalizeMissionType(missionTypeSelect?.value || "other");
}

function setSectionControlsDisabled(section, disabled) {
  if (!section) return;
  section.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = disabled;
  });
}

function syncMissionTypeFields() {
  const missionType = getSelectedMissionType();
  const isCargo = missionType === "cargo";
  const isCourier = missionType === "courier";
  const isDelivery = missionType === "delivery";
  const isRefuel = missionType === "refuel";
  const isInvestigation = missionType === "investigation";
  const isSalvage = missionType === "salvage";
  const isProcurement = missionType === "procurement";
  const isMining = missionType === "mining";
  const isOther = missionType === "other";

  if (missionTypeSelect) {
    missionTypeSelect.value = missionType;
  }
  if (missionForm?.title) {
    missionForm.title.placeholder =
      isCargo
        ? t("contracts.form.titlePlaceholderCargo")
        : isCourier
          ? t("contracts.form.titlePlaceholderCourier")
        : isDelivery
          ? t("contracts.form.titlePlaceholderDelivery")
        : isRefuel
          ? t("contracts.form.titlePlaceholderRefuel")
          : isInvestigation
            ? t("contracts.form.titlePlaceholderInvestigation")
            : isSalvage
              ? t("contracts.form.titlePlaceholderSalvage")
            : isProcurement
              ? t("contracts.form.titlePlaceholderProcurement")
            : isMining
              ? t("contracts.form.titlePlaceholderMining")
          : t("contracts.form.titlePlaceholderOther");
  }
  if (missionQuickCapture) {
    missionQuickCapture.hidden = !isCargo;
    setSectionControlsDisabled(missionQuickCapture, !isCargo);
  }
  if (consignmentBuilder) {
    consignmentBuilder.hidden = !isCargo;
    setSectionControlsDisabled(consignmentBuilder, !isCargo);
  }
  if (cargoFields) {
    cargoFields.hidden = !isCargo;
    setSectionControlsDisabled(cargoFields, !isCargo);
  }
  if (courierFields) {
    courierFields.hidden = !isCourier;
    setSectionControlsDisabled(courierFields, !isCourier);
    if (isCourier && courierPackageList && courierPackageList.children.length === 0) {
      resetCourierPackages();
    }
  }
  if (deliveryFields) {
    deliveryFields.hidden = !isDelivery;
    setSectionControlsDisabled(deliveryFields, !isDelivery);
    if (isDelivery && deliveryItemList && deliveryItemList.children.length === 0) {
      resetDeliveryItems();
    }
  }
  if (refuelFields) {
    refuelFields.hidden = !isRefuel;
    setSectionControlsDisabled(refuelFields, !isRefuel);
  }
  if (investigationFields) {
    investigationFields.hidden = !isInvestigation;
    setSectionControlsDisabled(investigationFields, !isInvestigation);
  }
  if (salvageFields) {
    salvageFields.hidden = !isSalvage;
    setSectionControlsDisabled(salvageFields, !isSalvage);
  }
  if (procurementFields) {
    procurementFields.hidden = !isProcurement;
    setSectionControlsDisabled(procurementFields, !isProcurement);
    if (isProcurement && procurementItemList && procurementItemList.children.length === 0) {
      resetProcurementItems();
    }
  }
  if (miningFields) {
    miningFields.hidden = !isMining;
    setSectionControlsDisabled(miningFields, !isMining);
  }
  if (miscFields) {
    miscFields.hidden = !isOther;
    setSectionControlsDisabled(miscFields, !isOther);
  }
  if (!isCargo) {
    if (missionValidationOverride) missionValidationOverride.checked = false;
    if (missionValidationOverrideWrap) missionValidationOverrideWrap.hidden = true;
    if (missionValidationHint) {
      missionValidationHint.innerHTML = "";
      missionValidationHint.hidden = true;
    }
  }
  renderCreateDraftSummary();
}
