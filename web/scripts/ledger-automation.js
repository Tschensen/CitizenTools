(function registerLedgerAutomationModule() {
  function createMissionIncomeForCompletedMission({
    state,
    mission,
    completedAt = new Date().toISOString(),
    helpers,
  }) {
    const payout = Math.round(Number(mission?.payout) || 0);
    if (!state || !mission?.id || payout <= 0) return null;

    const missionType = helpers.normalizeMissionType
      ? helpers.normalizeMissionType(mission.type)
      : String(mission.type || "cargo");
    const missionTypeLabel = helpers.getMissionTypeLabel
      ? helpers.getMissionTypeLabel(mission)
      : missionType;
    const ledgerScope = "mission";
    const ledgerCategory = "Auftragserlös";

    const existingEntry = (state.ledgerEntries || []).find(
      (entry) =>
        entry.missionId === mission.id
        && entry.scope === ledgerScope
        && entry.flow === "income"
        && entry.category === ledgerCategory,
    );
    if (existingEntry) return existingEntry;

    const linkedFleetEntry = (state.fleet || []).find(
      (entry) => entry.id === mission.assignedFleetEntryId,
    ) || null;
    const activeFleetEntry = linkedFleetEntry || (state.fleet || []).find(
      (entry) => entry.id === state.activeFleetEntryId && entry.status === "active",
    ) || null;
    const nextEntry = helpers.createLedgerEntry({
      bookedOn: helpers.formatDateForInput(completedAt),
      scope: ledgerScope,
      flow: "income",
      category: ledgerCategory,
      amountAuec: payout,
      reference: mission.title || `${missionTypeLabel}-Auftrag`,
      shipId: activeFleetEntry?.shipId || state.layout?.shipId || "",
      fleetEntryId: activeFleetEntry?.id || "",
      missionId: mission.id,
      notes: `Automatisch beim Abschluss des ${missionTypeLabel}-Auftrags erstellt.`,
      createdAt: completedAt,
    });

    state.ledgerEntries = Array.isArray(state.ledgerEntries) ? state.ledgerEntries : [];
    state.ledgerEntries.unshift(nextEntry);
    return nextEntry;
  }

  function createCargoIncomeForCompletedMission(options) {
    return createMissionIncomeForCompletedMission(options);
  }

  window.LedgerAutomation = {
    createMissionIncomeForCompletedMission,
    createCargoIncomeForCompletedMission,
  };
})();
