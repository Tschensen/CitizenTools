// Mission changes and confirmation workflows; persistence goes through persist().
function saveMissionEntry(nextMission, { assignedFleetEntryId, importQuality = {} } = {}) {
  nextMission.color = getDistinctActiveMissionColor(nextMission.color, nextMission.id);
  const existingIndex = state.missions.findIndex((mission) => mission.id === nextMission.id);
  const existingMission = existingIndex >= 0 ? state.missions[existingIndex] : null;
  if (existingMission && assignedFleetEntryId !== undefined) {
    nextMission.assignedFleetEntryId = String(assignedFleetEntryId || "").trim();
  }
  const fleetChanged = String(existingMission?.assignedFleetEntryId || "") !== String(nextMission.assignedFleetEntryId || "");
  if (existingMission && !fleetChanged) {
    nextMission.assignedPilotId = String(existingMission.assignedPilotId || "");
    nextMission.assignedPilotName = String(existingMission.assignedPilotName || "");
    nextMission.assignmentUpdatedAt = existingMission.assignmentUpdatedAt || existingMission.createdAt || new Date().toISOString();
  } else {
    setMissionAssignment(nextMission, { fleetEntryId: nextMission.assignedFleetEntryId });
  }
  if (existingMission) {
    const incomeEntry = getMissionIncomeEntry(existingMission);
    if (incomeEntry) {
      const assignedFleetEntry = (state.fleet || []).find((entry) => entry.id === nextMission.assignedFleetEntryId) || null;
      incomeEntry.reference = nextMission.title || incomeEntry.reference;
      if (missionHasPayout(nextMission)) incomeEntry.amountAuec = getMissionPayout(nextMission);
      incomeEntry.fleetEntryId = assignedFleetEntry?.id || "";
      incomeEntry.shipId = assignedFleetEntry?.shipId || "";
    }
  }
  if (existingIndex >= 0) {
    nextMission.sourceImportId ||= existingMission.sourceImportId || "";
    nextMission.sourceImportFile ||= existingMission.sourceImportFile || "";
    nextMission.sourceImportDevice ||= existingMission.sourceImportDevice || "";
    nextMission.sourceImportQuality = existingMission.sourceImportId
      ? normalizeMissionImportQuality(
          Object.keys(importQuality).length > 0
            ? importQuality
            : existingMission.sourceImportQuality,
        )
      : {};
    void window.locationAliasLearningController?.queueMissionCorrection(existingMission, nextMission);
    state.missions.splice(existingIndex, 1, nextMission);
    return true;
  }
  state.missions.unshift(nextMission);
  return false;
}
async function deleteMissionEntry(mission) {
  const hasLinkedIncome = Boolean(getMissionIncomeEntry(mission));
  const shouldDelete = await showMissionConfirmDialog({
    kicker: cargoText("contracts.dialog.deleteKicker", "Auftragsverwaltung"),
    title: cargoText("contracts.dialog.deleteTitle", "Auftrag löschen?"),
    message: hasLinkedIncome
      ? cargoText("contracts.confirm.deleteWithLedger", "Auftrag \"{name}\" wirklich löschen? Die verknüpfte Finanzbuchung bleibt erhalten; Route, Fracht und Auftraggeber können danach jedoch nicht mehr ausgewertet werden.", { name: mission.title })
      : cargoText("contracts.confirm.delete", "Auftrag \"{name}\" wirklich löschen?", { name: mission.title }),
    confirmLabel: cargoText("common.delete", "Löschen"),
    tone: "danger",
  });
  if (!shouldDelete) return;
  state.missions = state.missions.filter((entry) => entry.id !== mission.id);
  collapsedMissionIds.delete(mission.id);
  if (getMissionEditId() === mission.id) {
    resetMissionForm();
  }
  if (state.selectedLoadId && !findLoadById(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = false;
  }
  persist();
  render();
}

function toggleMissionCard(mission) {
  if (collapsedMissionIds.has(mission.id)) {
    collapsedMissionIds.delete(mission.id);
  } else {
    collapsedMissionIds.add(mission.id);
  }
  render();
}

function moveActiveMissionBefore(sourceMissionId, targetMissionId) {
  if (!sourceMissionId || !targetMissionId || sourceMissionId === targetMissionId) return false;
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const activeMissionIds = activeMissions.map((mission) => mission.id);
  const activeMissionById = new Map(activeMissions.map((mission) => [mission.id, mission]));
  if (!activeMissionIds.includes(sourceMissionId) || !activeMissionIds.includes(targetMissionId)) return false;

  const nextActiveMissionIds = activeMissionIds.filter((missionId) => missionId !== sourceMissionId);
  const targetIndex = nextActiveMissionIds.indexOf(targetMissionId);
  if (targetIndex < 0) return false;
  nextActiveMissionIds.splice(targetIndex, 0, sourceMissionId);

  const activeQueue = [...nextActiveMissionIds];
  state.missions = state.missions.map((mission) => (
    isMissionActive(mission)
      ? activeMissionById.get(activeQueue.shift()) || mission
      : mission
  ));
  state.selectedStopDropoff = "";
  lastUnloadPlan = null;
  persist();
  render();
  return true;
}

function moveActiveMissionToEnd(sourceMissionId) {
  if (!sourceMissionId) return false;
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const activeMissionIds = activeMissions.map((mission) => mission.id);
  const activeMissionById = new Map(activeMissions.map((mission) => [mission.id, mission]));
  if (!activeMissionIds.includes(sourceMissionId) || activeMissionIds[activeMissionIds.length - 1] === sourceMissionId) return false;

  const nextActiveMissionIds = activeMissionIds.filter((missionId) => missionId !== sourceMissionId);
  nextActiveMissionIds.push(sourceMissionId);
  const activeQueue = [...nextActiveMissionIds];
  state.missions = state.missions.map((mission) => (
    isMissionActive(mission)
      ? activeMissionById.get(activeQueue.shift()) || mission
      : mission
  ));
  state.selectedStopDropoff = "";
  lastUnloadPlan = null;
  persist();
  render();
  return true;
}
function transferMissionToActiveShip(mission) {
  const readiness = getMissionTransferReadiness(mission);
  if (!readiness.ok) {
    return;
  }
  const activeLoads = getMissionActiveLoads(mission);
  activeLoads.forEach((load) => {
    load.placement = null;
  });
  setMissionAssignment(mission, {
    fleetEntryId: readiness.activeEntry?.id || currentActiveFleetEntry()?.id || "",
  });
  state.selectedLoadId = activeLoads[0]?.id ?? null;
  state.selectionCleared = !state.selectedLoadId;
  lastUnloadPlan = null;
  persist();
  render();
}

async function deleteActiveMissions(missions) {
  if (!missions.length) return;
  const linkedIncomeCount = missions.filter((mission) => Boolean(getMissionIncomeEntry(mission))).length;
  const ledgerNote = linkedIncomeCount > 0
    ? ` ${cargoText("contracts.bulk.deleteActiveLedgerNote", "Verknüpfte Finanzbuchungen bleiben erhalten: {count}.", { count: linkedIncomeCount })}`
    : "";
  const shouldDelete = await showMissionConfirmDialog({
    kicker: cargoText("contracts.bulk.kicker", "Sammelaktion"),
    title: cargoText("contracts.bulk.deleteActiveTitle", "Alle aktiven Aufträge löschen?"),
    message: `${cargoText("contracts.bulk.deleteActiveMessage", "Betroffene aktive Aufträge: {count}. Ihre Routen, Frachtzuordnungen und Fortschritte werden gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.", { count: missions.length })}${ledgerNote}`,
    confirmLabel: cargoText("contracts.bulk.deleteActiveConfirm", "Aktive löschen"),
    tone: "danger",
  });
  if (!shouldDelete) return;

  const missionIds = new Set(missions.map((mission) => mission.id).filter(Boolean));
  state.missions = state.missions.filter((mission) => !missionIds.has(mission.id));
  missionIds.forEach((missionId) => collapsedMissionIds.delete(missionId));
  if (missionIds.has(getMissionEditId())) resetMissionForm();
  if (state.selectedLoadId && !findLoadById(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = false;
  }
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

async function completeActiveMissions(missions) {
  const incompleteMissions = missions.filter((mission) => isMissionIncomplete(mission));
  const splitRequiredMissions = missions.filter((mission) => isMissionPayoutSplitRequired(mission));
  const completableMissions = missions.filter((mission) => !isMissionIncomplete(mission) && !isMissionPayoutSplitRequired(mission));
  if (!completableMissions.length) return;
  const noPayoutCount = completableMissions.filter((mission) => !missionHasPayout(mission)).length;
  const incompleteNote = incompleteMissions.length > 0
    ? ` ${cargoText("contracts.bulk.completeActiveIncompleteNote", "Unvollständig und weiterhin aktiv: {count}.", { count: incompleteMissions.length })}`
    : "";
  const noPayoutNote = noPayoutCount > 0
    ? ` ${cargoText("contracts.bulk.completeActiveNoPayoutNote", "Ohne Verdienst und danach direkt unter Bezahlt: {count}.", { count: noPayoutCount })}`
    : "";
  const splitRequiredNote = splitRequiredMissions.length > 0
    ? ` ${cargoText("contracts.bulk.splitRequiredNote", "Mit mehreren Piloten und noch offener Erlösaufteilung: {count}.", { count: splitRequiredMissions.length })}`
    : "";
  const shouldComplete = await showMissionConfirmDialog({
    kicker: cargoText("contracts.bulk.kicker", "Sammelaktion"),
    title: cargoText("contracts.bulk.completeActiveTitle", "Aktive Aufträge abschließen?"),
    message: `${cargoText("contracts.bulk.completeActiveMessage", "Vollständige aktive Aufträge: {count}. Sie werden abgeschlossen und noch verladene Fracht wird als ausgeladen markiert; es werden noch keine Einnahmen gebucht.", { count: completableMissions.length })}${incompleteNote}${noPayoutNote}${splitRequiredNote}`,
    confirmLabel: cargoText("contracts.bulk.completeActiveConfirm", "Aktive abschließen"),
  });
  if (!shouldComplete) return;

  const completedAt = new Date().toISOString();
  completableMissions.forEach((mission) => {
    unloadMissionLoadsForCompletion(mission, completedAt);
    markMissionCompleted(mission, { completedAt });
    collapsedMissionIds.add(mission.id);
  });
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

async function payCompletedMissions(missions) {
  const splitRequiredMissions = missions.filter((mission) => isMissionPayoutSplitRequired(mission));
  const payableMissions = missions.filter((mission) => !isMissionPayoutSplitRequired(mission));
  if (!payableMissions.length) return;
  const payoutMissions = payableMissions.filter((mission) => missionHasPayout(mission));
  const totalPayout = payoutMissions.reduce((sum, mission) => sum + getMissionPayout(mission), 0);
  const shouldPay = await showMissionConfirmDialog({
    kicker: cargoText("contracts.bulk.kicker", "Sammelaktion"),
    title: cargoText("contracts.bulk.payCompletedTitle", "Alle abgeschlossenen Aufträge bezahlen?"),
    message: cargoText("contracts.bulk.payCompletedMessage", "Abgeschlossene Aufträge: {count}. Sie werden als bezahlt markiert. Für {payoutCount} davon werden Einnahmen über insgesamt {total} in Finanzen gebucht.", {
      count: payableMissions.length,
      payoutCount: payoutMissions.length,
      total: `${totalPayout.toLocaleString(cargoLocale())} aUEC`,
    }) + (splitRequiredMissions.length ? ` ${cargoText("contracts.bulk.splitRequiredNote", "Mit mehreren Piloten und noch offener Erlösaufteilung: {count}.", { count: splitRequiredMissions.length })}` : ""),
    confirmLabel: cargoText("contracts.bulk.payCompletedConfirm", "Alle bezahlt buchen"),
  });
  if (!shouldPay) return;

  const paidAt = new Date().toISOString();
  payableMissions.forEach((mission) => {
    unloadMissionLoadsForCompletion(mission, paidAt);
    markMissionPaid(mission, { paidAt });
    collapsedMissionIds.add(mission.id);
  });
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

function isMissionPayoutSplitRequired(mission) {
  return Boolean(
    isDispatcherMode()
    && missionHasPayout(mission)
    && getMissionParticipants(mission).length > 1
    && (!Array.isArray(mission.payoutSplit?.items) || mission.payoutSplit.items.length !== getMissionParticipants(mission).length),
  );
}

async function completeMission(missionId, { bookIncome = false } = {}) {
  const mission = state.missions.find((entry) => entry.id === missionId);
  if (!mission) return;

  if (typeof isOrganizationMissionReadyForCompletion === "function" && !isOrganizationMissionReadyForCompletion(mission)) {
    await showAppNotice(t("contracts.organization.progressIncomplete"));
    return;
  }

  if (isMissionIncomplete(mission)) {
    const shouldEdit = await showMissionConfirmDialog({
      title: t("contracts.dialog.incompleteTitle"),
      message: t("contracts.dialog.incompleteMessage"),
      confirmLabel: t("contracts.actions.completeDetails"),
    });
    if (shouldEdit) populateMissionForm(mission);
    return;
  }

  if (isMissionPaid(mission)) return;
  if (isMissionCompleted(mission)) {
    if (bookIncome) await payMission(missionId);
    return;
  }

  const confirmMessage = bookIncome && missionHasPayout(mission)
    ? t("contracts.confirm.completeAndBook", { name: mission.title })
    : t("contracts.confirm.complete", { name: mission.title });
  const shouldComplete = await showMissionConfirmDialog({
    title: bookIncome && missionHasPayout(mission)
      ? t("contracts.dialog.completeAndBookTitle")
      : t("contracts.dialog.completeTitle"),
    message: confirmMessage,
    confirmLabel: bookIncome && missionHasPayout(mission)
      ? t("contracts.actions.completeAndPay")
      : t("contracts.actions.complete"),
  });
  if (!shouldComplete) return;
  if (!(await ensureMissionPayoutSplit(mission))) return;

  const completedAt = new Date().toISOString();
  unloadMissionLoadsForCompletion(mission, completedAt);
  markMissionCompleted(mission, { completedAt, bookIncome });
  collapsedMissionIds.add(mission.id);

  persist();
  render();
}

async function payMission(missionId) {
  const mission = state.missions.find((entry) => entry.id === missionId);
  if (!mission || isMissionPaid(mission)) return;

  if (typeof isOrganizationMissionReadyForCompletion === "function" && !isOrganizationMissionReadyForCompletion(mission)) {
    await showAppNotice(t("contracts.organization.progressIncomplete"));
    return;
  }

  if (isMissionIncomplete(mission)) {
    const shouldEdit = await showMissionConfirmDialog({
      title: t("contracts.dialog.incompleteTitle"),
      message: t("contracts.dialog.incompleteMessage"),
      confirmLabel: t("contracts.actions.completeDetails"),
    });
    if (shouldEdit) populateMissionForm(mission);
    return;
  }

  const confirmMessage = isMissionCompleted(mission)
    ? t("contracts.confirm.bookPayment", { name: mission.title })
    : t("contracts.confirm.completeAndBook", { name: mission.title });
  const shouldPay = missionHasPayout(mission)
    ? await showMissionConfirmDialog({
        title: isMissionCompleted(mission)
          ? t("contracts.dialog.bookPaymentTitle")
          : t("contracts.dialog.completeAndBookTitle"),
        message: confirmMessage,
        confirmLabel: isMissionCompleted(mission)
          ? t("contracts.actions.bookPayment")
          : t("contracts.actions.completeAndPay"),
      })
    : true;
  if (!shouldPay) return;
  if (!(await ensureMissionPayoutSplit(mission))) return;

  unloadMissionLoadsForCompletion(mission, new Date().toISOString());
  markMissionPaid(mission);
  collapsedMissionIds.add(mission.id);
  persist();
  render();
}

async function ensureMissionPayoutSplit(mission) {
  if (!isDispatcherMode() || !missionHasPayout(mission) || getMissionParticipants(mission).length < 2) return true;
  const split = await showMissionPayoutSplitDialog(mission);
  if (!split) return false;
  mission.payoutSplit = split;
  return true;
}
