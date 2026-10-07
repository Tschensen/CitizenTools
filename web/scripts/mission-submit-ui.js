// Mission submission controller: read a form once, validate by type, then commit.
async function submitMissionForm(event) {
  event.preventDefault();
  const formData = new FormData(missionForm);
  const payoutInput = Number(formData.get("payout"));
  const missionColor = formData.get("color") || DEFAULT_COLOR;
  const title = String(formData.get("title")).trim();
  const notes = String(formData.get("notes")).trim();
  const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : null;
  const maxContainerScu = normalizeMissionMaxContainerScu(formData.get("maxContainerScu"));
  const missionType = normalizeMissionType(formData.get("missionType"));
  const editingMissionId = getMissionEditId();
  const existingMission = editingMissionId
    ? state.missions.find((mission) => mission.id === editingMissionId) || null
    : null;
  const missionId = editingMissionId || createRuntimeId();
  const createdAt = existingMission?.createdAt || new Date().toISOString();

  const draft = { id: missionId, type: missionType, title, notes, payout, color: missionColor,
    status: existingMission?.status || "active", completedAt: existingMission?.completedAt || "",
    paidAt: existingMission?.paidAt || "", createdAt };
  const context = {formData, existingMission, draft, maxContainerScu};
  const handlers = {courier: submitCourierMission, delivery: submitDeliveryMission,
    refuel: submitRefuelMission, investigation: submitInvestigationMission, salvage: submitSalvageMission,
    procurement: submitProcurementMission, mining: submitMiningMission, other: submitOtherMission};
  return (handlers[missionType] || submitCargoMission)(context);
}

async function submitCourierMission({formData, existingMission, draft}) {
  const packages = collectCourierPackages(existingMission);
  if (packages.length === 0 || packages.some((item) => !item.name || !item.pickup || !item.destination)) {
    await showAppNotice(cargoText("contracts.alert.courierDetailsMissing", "Trage für jedes Paket Gegenstand, Abholort und Lieferziel ein."));
    return;
  }
  const serviceDetails = {
    customer: String(formData.get("courierCustomer") || "").trim(),
    location: packages[0]?.destination || "",
    packages,
    maxPackageScu: parseMissionDecimal(formData.get("courierMaxPackageScu")),
    instructions: String(formData.get("courierInstructions") || "").trim(),
  };

  saveMissionFormEntry({
    ...draft,
    pickup: packages[0]?.pickup || "",
    dropoff: packages.length === 1 ? packages[0].destination : `${new Set(packages.map((item) => item.destination)).size} Ziele`,
    assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : currentActiveFleetEntry()?.id || "",
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = packages[0]?.pickup || "";
  finishMissionSubmission();
  return;
}

async function submitDeliveryMission({formData, existingMission, draft}) {
  const items = collectDeliveryItems(existingMission);
  if (items.length === 0 || items.some((item) => !item.name || !item.pickup || !item.destination)) {
    await showAppNotice(cargoText("contracts.alert.deliveryDetailsMissing", "Trage für jede Lieferposition Gegenstand, Abholort und Lieferziel ein."));
    return;
  }
  const draftSegments = buildDeliverySegments(items);
  const requestedScu = draftSegments.reduce((sum, segment) => sum + (Number(segment.totalScu) || 0), 0);
  const cargoReadiness = requestedScu > 0 ? getCargoReadiness({ requestedScu }) : null;
  if (!existingMission && !isDispatcherMode() && cargoReadiness && !cargoReadiness.ok && (!cargoReadiness.fleetEntry || !cargoReadiness.hasCargo)) {
    await showAppNotice(cargoReadiness.message);
    return;
  }
  const cargoMerge = existingMission && isCargoMission(existingMission)
    ? mergeCargoMissionDraft(existingMission, draftSegments, {
        allowProgressRouteCorrection: isMissionCompleted(existingMission),
      })
    : {
        segments: draftSegments,
        loads: createLoadsFromConsignments(draftSegments),
        newLoadIds: [],
        blockedRouteCount: 0,
      };
  if (cargoMerge.blockedRouteCount > 0) {
    const shouldContinue = await showMissionConfirmDialog({
      kicker: cargoText("contracts.dialog.cargoEditKicker", "Frachtfortschritt"),
      title: cargoText("contracts.dialog.cargoEditTitle", "Verladene Fracht schützen?"),
      message: cargoText("contracts.dialog.cargoEditMessage", "Bereits verladene oder gelieferte Positionen bleiben unverändert; nur offene Lieferpositionen werden aktualisiert."),
      confirmLabel: cargoText("contracts.actions.updateOpenRoutes", "Offene Strecken aktualisieren"),
    });
    if (!shouldContinue) return;
  }
  const destinations = [...new Set(items.map((item) => item.destination).filter(Boolean))];
  const serviceDetails = {
    customer: String(formData.get("deliveryCustomer") || "").trim(),
    location: destinations[0] || "",
    packages: items,
    maxPackageScu: null,
    instructions: String(formData.get("deliveryInstructions") || "").trim(),
    dangerNote: "",
  };

  saveMissionFormEntry({
    ...draft,
    pickup: items[0]?.pickup || "",
    dropoff: destinations.length === 1 ? destinations[0] : `${destinations.length} Ziele`,
    maxContainerScu: draftSegments.length ? Math.max(...draftSegments.map((segment) => Number(segment.scuPerLoad) || 0)) : null,
    assignedFleetEntryId: existingMission
      ? existingMission.assignedFleetEntryId || ""
      : isDispatcherMode()
        ? ""
        : cargoReadiness?.fleetEntry?.id || currentActiveFleetEntry()?.id || "",
    serviceDetails,
    segments: cargoMerge.segments,
    loads: cargoMerge.loads,
  });

  state.selectedLoadId = cargoMerge.loads.find((load) => cargoMerge.newLoadIds.includes(load.id))?.id || null;
  state.selectionCleared = !state.selectedLoadId;
  state.selectedStopDropoff = items[0]?.pickup || "";
  finishMissionSubmission();
  return;
}

async function submitRefuelMission({formData, existingMission, draft}) {
  const serviceDetails = {
    customer: String(formData.get("refuelCustomer") || "").trim(),
    location: String(formData.get("refuelLocation") || "").trim(),
    serviceType: normalizeRefuelServiceType(formData.get("refuelServiceType")),
    hydrogenAmount: parseMissionDecimal(formData.get("refuelHydrogenAmount")),
    quantumAmount: parseMissionDecimal(formData.get("refuelQuantumAmount")),
    targetVehicle: String(formData.get("refuelTargetVehicle") || "").trim(),
    hydrogenRate: parseMissionDecimal(formData.get("refuelHydrogenRate")),
    quantumRate: parseMissionDecimal(formData.get("refuelQuantumRate")),
    bonus: String(formData.get("refuelBonus") || "").trim(),
  };
  const refuelReadiness = getRefuelReadiness(serviceDetails.serviceType, serviceDetails);
  if (!existingMission && !isDispatcherMode() && !refuelReadiness.ok) {
    await showAppNotice(refuelReadiness.message);
    return;
  }

  saveMissionFormEntry({
    ...draft,
    pickup: "",
    dropoff: serviceDetails.location,
    assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : refuelReadiness.activeEntry.id,
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = serviceDetails.location || "";
  finishMissionSubmission();
  return;
}

async function submitInvestigationMission({formData, existingMission, draft}) {
  const serviceDetails = {
    customer: String(formData.get("investigationCustomer") || "").trim(),
    location: String(formData.get("investigationLocation") || "").trim(),
    subject: String(formData.get("investigationSubject") || "").trim(),
    caseNumber: String(formData.get("investigationCaseNumber") || "").trim(),
    leadInvestigator: String(formData.get("investigationLead") || "").trim(),
    instructions: String(formData.get("investigationInstructions") || "").trim(),
    dangerNote: String(formData.get("investigationDangerNote") || "").trim(),
  };

  saveMissionFormEntry({
    ...draft,
    pickup: "",
    dropoff: serviceDetails.location,
    assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : currentActiveFleetEntry()?.id || "",
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = serviceDetails.location || "";
  finishMissionSubmission();
  return;
}

async function submitSalvageMission({formData, existingMission, draft}) {
  const serviceDetails = {
    customer: String(formData.get("salvageCustomer") || "").trim(),
    location: String(formData.get("salvageLocation") || "").trim(),
    salvageTarget: String(formData.get("salvageTarget") || "").trim(),
    claimNumber: String(formData.get("salvageClaimNumber") || "").trim(),
    instructions: String(formData.get("salvageInstructions") || "").trim(),
  };
  const readiness = getSalvageReadiness();
  if (!existingMission && !isDispatcherMode() && !readiness.ok) {
    await showAppNotice(readiness.message);
    return;
  }

  saveMissionFormEntry({
    ...draft,
    pickup: "",
    dropoff: serviceDetails.location,
    assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : readiness.activeEntry.id,
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = serviceDetails.location || "";
  finishMissionSubmission();
  return;
}

async function submitProcurementMission({formData, existingMission, draft}) {
  const location = String(formData.get("procurementLocation") || "").trim();
  const serviceDetails = {
    customer: String(formData.get("procurementCustomer") || "").trim(),
    location,
    items: collectProcurementItems(location),
    instructions: String(formData.get("procurementInstructions") || "").trim(),
  };
  if (serviceDetails.items.length === 0) {
    await showAppNotice(cargoText("contracts.alert.procurementItemMissing", "Trage mindestens einen Gegenstand mit Anzahl ein."));
    return;
  }

  saveMissionFormEntry({
    ...draft,
    pickup: "",
    dropoff: serviceDetails.location,
    assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : currentActiveFleetEntry()?.id || "",
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = serviceDetails.location || "";
  finishMissionSubmission();
  return;
}

async function submitMiningMission({formData, existingMission, draft}) {
  const serviceDetails = {
    customer: String(formData.get("miningCustomer") || "").trim(),
    location: String(formData.get("miningLocation") || "").trim(),
    miningMethod: String(formData.get("miningMethod") || "hand") === "ship" ? "ship" : "hand",
    searchArea: String(formData.get("miningSearchArea") || "").trim(),
    material: String(formData.get("miningMaterial") || "").trim(),
    targetAmount: parseMissionDecimal(formData.get("miningTargetAmount")),
    tool: String(formData.get("miningTool") || "").trim(),
    instructions: String(formData.get("miningInstructions") || "").trim(),
  };
  const readiness = getMiningReadiness(serviceDetails.miningMethod);
  if (!existingMission && !isDispatcherMode() && !readiness.ok) {
    await showAppNotice(readiness.message);
    return;
  }

  saveMissionFormEntry({
    ...draft,
    pickup: "",
    dropoff: serviceDetails.location,
    assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : readiness.activeEntry?.id || "",
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = serviceDetails.location || "";
  finishMissionSubmission();
  return;
}

async function submitOtherMission({formData, existingMission, draft}) {
  const serviceDetails = {
    customer: String(formData.get("miscCustomer") || "").trim(),
    location: String(formData.get("miscLocation") || "").trim(),
    serviceType: "both",
    hydrogenAmount: null,
    quantumAmount: null,
    targetVehicle: "",
    hydrogenRate: null,
    quantumRate: null,
    bonus: "",
  };

  saveMissionFormEntry({
    ...draft,
    pickup: "",
    dropoff: serviceDetails.location,
    assignedFleetEntryId: currentActiveFleetEntry()?.id || "",
    serviceDetails,
    segments: [],
    loads: [],
  });

  state.selectedLoadId = null;
  state.selectionCleared = true;
  state.selectedStopDropoff = serviceDetails.location || "";
  finishMissionSubmission();
  return;
}

async function submitCargoMission({formData, existingMission, draft, maxContainerScu}) {
  const consignments = collectConsignments();

  if (consignments.length === 0) {
    await showAppNotice("Lege mindestens eine Fracht mit Abholung, Lieferung und Containergröße an.");
    return;
  }

  const requestedScu = getPlannedConsignmentScu(consignments);
  const cargoReadiness = getCargoReadiness({ requestedScu });
  if (!existingMission && !isDispatcherMode() && !cargoReadiness.ok && (!cargoReadiness.fleetEntry || !cargoReadiness.hasCargo)) {
    await showAppNotice(cargoReadiness.message);
    return;
  }

  const validation = buildMissionDraftValidation();
  if (!validation.isValid && !missionValidationOverride?.checked) {
    renderMissionValidationHint();
    await showAppNotice("Die Auftragseingabe hat noch unvollständige oder unplausible Strecken. Prüfe die Hinweise oder aktiviere die Übersteuerung darunter.");
    return;
  }

  const cargoMerge = existingMission && isCargoMission(existingMission)
    ? mergeCargoMissionDraft(existingMission, consignments, {
        allowProgressRouteCorrection: isMissionCompleted(existingMission),
      })
    : {
        segments: consignments,
        loads: createLoadsFromConsignments(consignments),
        newLoadIds: [],
        blockedRouteCount: 0,
      };

  if (cargoMerge.blockedRouteCount > 0) {
    const shouldContinue = await showMissionConfirmDialog({
      kicker: cargoText("contracts.dialog.cargoEditKicker", "Frachtfortschritt"),
      title: cargoText("contracts.dialog.cargoEditTitle", "Verladene Fracht schützen?"),
      message: cargoText(
        "contracts.dialog.cargoEditMessage",
        "Mindestens eine bereits verladene oder gelieferte Strecke wurde geändert. Deren Fracht bleibt unverändert; nur offene Strecken und die übrigen Auftragsdaten werden aktualisiert.",
      ),
      confirmLabel: cargoText("contracts.actions.updateOpenRoutes", "Offene Strecken aktualisieren"),
    });
    if (!shouldContinue) return;
  }

  const { segments, loads } = cargoMerge;

  saveMissionFormEntry({
    ...draft,
    pickup: consignments[0]?.pickup || "",
    dropoff: consignments.length === 1 ? consignments[0]?.dropoff || "" : `${consignments.length} Ziele`,
    maxContainerScu,
    assignedFleetEntryId: existingMission
      ? existingMission.assignedFleetEntryId || ""
      : isDispatcherMode()
        ? ""
        : cargoReadiness.fleetEntry.id,
    serviceDetails: {
      ...getMissionServiceDetails(existingMission),
      customer: String(formData.get("cargoCustomer") || "").trim(),
    },
    segments,
    loads,
  });

  const selectedLoadSurvives = loads.some((load) => load.id === state.selectedLoadId);
  state.selectedLoadId = selectedLoadSurvives
    ? state.selectedLoadId
    : loads.find((load) => cargoMerge.newLoadIds.includes(load.id))?.id
      || loads.find((load) => !load.deliveredAt && !load.placement)?.id
      || null;
  state.selectionCleared = !state.selectedLoadId;
  state.selectedStopDropoff = "";
  lastUnloadPlan = null;
  lastCargoPage = existingMission && isMissionCompleted(existingMission)
    ? "overview"
    : loads.length > 0 && canUseLoadPage()
      ? "load"
      : "overview";
  finishMissionSubmission(lastCargoPage);
}

function saveMissionFormEntry(mission) {
  return saveMissionEntry(mission, {
    assignedFleetEntryId: missionForm.elements.assignedFleetEntryId?.value,
    importQuality: activeMissionImportQuality,
  });
}

function finishMissionSubmission(page = "overview") {
  lastUnloadPlan = null;
  lastCargoPage = activePage = page;
  resetMissionForm();
  persist();
  render();
}
