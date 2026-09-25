// Mission types, workflow state, readiness, service details, and route summaries.
function getCargoReadiness({ requestedScu = 0 } = {}) {
  const cargoState = getActiveCargoCapacityState();
  const { activeEntry, shipProfile, totalCapacity, usedCapacity, freeCapacity } = cargoState;
  const requestedCapacity = Math.max(0, Number(requestedScu) || 0);

  if (!activeEntry || !shipProfile) {
    return {
      ok: false,
      ...cargoState,
      fleetEntry: null,
      message: t("contracts.readiness.chooseFleetShip"),
    };
  }

  if (!cargoState.hasCargo || totalCapacity <= 0) {
    return {
      ok: false,
      ...cargoState,
      fleetEntry: activeEntry,
      message: t("contracts.readiness.noCargo", { ship: formatFleetEntryDisplayName(activeEntry) }),
    };
  }

  if (requestedCapacity > 0 && requestedCapacity > freeCapacity) {
    return {
      ok: false,
      ...cargoState,
      fleetEntry: activeEntry,
      message: t("contracts.readiness.notEnoughCargo", {
        ship: formatFleetEntryDisplayName(activeEntry),
        free: formatScuAmount(freeCapacity),
        needed: formatScuAmount(requestedCapacity),
      }),
    };
  }

  if (requestedCapacity <= 0 && freeCapacity <= 0) {
    return {
      ok: false,
      ...cargoState,
      fleetEntry: activeEntry,
      message: t("contracts.readiness.noFreeCargo", { ship: formatFleetEntryDisplayName(activeEntry) }),
    };
  }

  return {
    ok: true,
    ...cargoState,
    fleetEntry: activeEntry,
    shipProfile,
    message: t("contracts.readiness.cargoUsage", { ship: formatFleetEntryDisplayName(activeEntry), used: usedCapacity, total: totalCapacity }),
  };
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

function normalizeMissionType(type) {
  const normalized = String(type || "").trim().toLowerCase();
  return MISSION_TYPE_LABELS[normalized] ? normalized : "cargo";
}

function getMissionTypeLabel(missionOrType) {
  const type = typeof missionOrType === "string"
    ? normalizeMissionType(missionOrType)
    : normalizeMissionType(missionOrType?.type);
  return t(`mission.type.${type}`) || MISSION_TYPE_LABELS[type] || MISSION_TYPE_LABELS.cargo;
}

function isCargoMission(mission) {
  const missionType = normalizeMissionType(mission?.type);
  return missionType === "cargo"
    || (missionType === "delivery" && Array.isArray(mission?.segments) && mission.segments.length > 0);
}

function getMissionIncompleteReasons(mission) {
  const missionType = normalizeMissionType(mission?.type);
  if (missionType === "courier" || missionType === "delivery") {
    const packages = getMissionServiceDetails(mission).packages;
    if (packages.length === 0) {
      return [t(missionType === "delivery" ? "contracts.incomplete.deliveryItems" : "contracts.incomplete.courierPackages")];
    }
    if (packages.some((item) => !item.name || !item.pickup || !item.destination)) {
      return [t(missionType === "delivery" ? "contracts.incomplete.deliveryDetails" : "contracts.incomplete.courierDetails")];
    }
    return [];
  }
  if (!isCargoMission(mission)) return [];
  const segments = getMissionSegments(mission);
  if (segments.length === 0) return [t("contracts.incomplete.cargoDetails")];
  if (segments.some((segment) => Boolean(segment.quantityPending))) {
    return [t("contracts.incomplete.pickupAmounts")];
  }
  return [];
}

function isMissionIncomplete(mission) {
  return getMissionIncompleteReasons(mission).length > 0;
}

function normalizeMissionStatus(status) {
  const normalized = String(status || "active").trim().toLowerCase();
  if (normalized === "completed_paid" || normalized === "completed-paid") return "paid";
  return ["active", "completed", "paid", "cancelled"].includes(normalized) ? normalized : "active";
}

function isMissionCompleted(mission) {
  if (!mission) return false;
  const status = normalizeMissionStatus(mission.status);
  if (status === "completed" || status === "paid" || mission.completedAt) {
    return true;
  }
  if (normalizeMissionType(mission.type) === "delivery") {
    if (isMissionIncomplete(mission)) return false;
    const packages = getMissionServiceDetails(mission).packages;
    const handheldPackages = packages.filter((item) => !(Number(item.containerScu) > 0));
    const handheldCompleted = handheldPackages.every((item) => Boolean(item.deliveredAt));
    const cargoCompleted = !isCargoMission(mission) || getMissionLoadStats(mission).isCompleted;
    return packages.length > 0 && handheldCompleted && cargoCompleted;
  }
  return isCargoMission(mission) && !isMissionIncomplete(mission) && getMissionLoadStats(mission).isCompleted;
}

function canAutoCompleteMissionProgress(mission) {
  if (normalizeMissionType(mission?.type) === "delivery") {
    return isMissionCompleted(mission);
  }
  return getMissionLoadStats(mission).isCompleted;
}

function isMissionActive(mission) {
  return normalizeMissionStatus(mission?.status) === "active" && !isMissionCompleted(mission);
}

function getMissionPayout(mission) {
  const payout = Math.round(Number(mission?.payout) || 0);
  return payout > 0 ? payout : 0;
}

function missionHasPayout(mission) {
  return getMissionPayout(mission) > 0;
}

function getMissionIncomeEntry(mission) {
  if (!mission?.id) return null;
  return (state.ledgerEntries || []).find(
    (entry) =>
      entry.missionId === mission.id
      && entry.flow === "income"
      && (Number(entry.amountAuec) || 0) > 0,
  ) || null;
}

function isMissionPaid(mission) {
  if (!mission || !isMissionCompleted(mission)) return false;
  if (normalizeMissionStatus(mission.status) === "paid" || mission.paidAt) return true;
  if (!missionHasPayout(mission)) return true;
  return Boolean(getMissionIncomeEntry(mission));
}

function getMissionWorkflowStatus(mission) {
  if (isMissionPaid(mission)) return "paid";
  if (isMissionCompleted(mission)) return "completed";
  if (normalizeMissionStatus(mission?.status) === "cancelled") return "cancelled";
  return "active";
}

function getMissionWorkflowLabel(mission) {
  switch (getMissionWorkflowStatus(mission)) {
    case "paid":
      return t("contracts.workflow.paid");
    case "completed":
      return t("contracts.workflow.completed");
    case "cancelled":
      return t("contracts.workflow.cancelled");
    case "active":
    default:
      return t("contracts.workflow.active");
  }
}

function parseMissionDecimal(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100) / 100;
}

function normalizeRefuelServiceType(value) {
  const normalized = String(value || "both").trim().toLowerCase();
  return ["hydrogen", "quantum", "both"].includes(normalized) ? normalized : "both";
}

function getRefuelServiceLabel(value) {
  const serviceType = normalizeRefuelServiceType(value);
  if (serviceType === "hydrogen") return "Hydrogen";
  if (serviceType === "quantum") return "Quantumfuel";
  return "Hydrogen + Quantum";
}

function getSalvageReadiness() {
  const activeEntry = currentActiveFleetEntry();
  const shipProfile = currentActiveShipProfile();
  if (!activeEntry || !shipProfile) {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.chooseOperationShip"),
    };
  }
  if (normalizeShipClass(shipProfile.shipClass) !== "salvage") {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.noSalvageShip", { ship: formatFleetEntryDisplayName(activeEntry) }),
    };
  }
  return {
    ok: true,
    activeEntry,
    shipProfile,
    message: `${formatFleetEntryDisplayName(activeEntry)} · ${getShipClassLabel(shipProfile.shipClass)}`,
  };
}

function getMiningReadiness(miningMethod = "hand") {
  const activeEntry = currentActiveFleetEntry();
  const shipProfile = currentActiveShipProfile();
  if (String(miningMethod || "hand").trim().toLowerCase() !== "ship") {
    return {
      ok: true,
      activeEntry,
      shipProfile,
      message: t("contracts.form.everyShipAllowed"),
    };
  }
  if (!activeEntry || !shipProfile) {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.chooseOperationShip"),
    };
  }
  if (normalizeShipClass(shipProfile.shipClass) !== "mining") {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.noMiningShip", { ship: formatFleetEntryDisplayName(activeEntry) }),
    };
  }
  return {
    ok: true,
    activeEntry,
    shipProfile,
    message: `${formatFleetEntryDisplayName(activeEntry)} · ${getShipClassLabel(shipProfile.shipClass)}`,
  };
}

function getRefuelReadiness(serviceType = "both", serviceDetails = {}) {
  const activeEntry = currentActiveFleetEntry();
  const shipProfile = currentActiveShipProfile();
  const normalizedServiceType = normalizeRefuelServiceType(serviceType);
  if (!activeEntry || !shipProfile) {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.chooseOperationShip"),
    };
  }
  const config = getRefuelContainerConfig(shipProfile, activeEntry);
  if (!config.hasRefuelContainers) {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.noRefuelTank", {
        ship: formatFleetEntryDisplayName(activeEntry),
        service: getRefuelServiceLabel(normalizedServiceType),
      }),
    };
  }
  if (!config.hasConfiguredCapacity) {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.configureRefuel", { count: config.containerCount }),
    };
  }
  const hydrogenAmount = parseMissionDecimal(serviceDetails.hydrogenAmount);
  const quantumAmount = parseMissionDecimal(serviceDetails.quantumAmount);
  const requestedCapacity = (hydrogenAmount || 0) + (quantumAmount || 0);
  if (requestedCapacity > config.totalCapacity) {
    return {
      ok: false,
      activeEntry,
      shipProfile,
      message: t("contracts.readiness.notEnoughRefuel", {
        ship: formatFleetEntryDisplayName(activeEntry),
        capacity: formatScuAmount(config.totalCapacity),
        needed: formatScuAmount(requestedCapacity),
      }),
    };
  }
  return {
    ok: true,
    activeEntry,
    shipProfile,
    message: `${formatFleetEntryDisplayName(activeEntry)} · ${formatFleetRefuelSupport(activeEntry, shipProfile)}`,
  };
}

function normalizeProcurementItems(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item) => ({
      name: String(item?.name || "").trim(),
      quantity: Math.max(0, Math.round(Number(item?.quantity) || 0)),
      destination: String(item?.destination || "").trim(),
    }))
    .filter((item) => item.name && item.quantity > 0);
}

function normalizeCourierPackages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 20)
    .map((item) => ({
      id: String(item?.id || "").trim(),
      quantity: Math.max(1, Math.round(Number(item?.quantity) || 1)),
      name: String(item?.name || "").trim(),
      pickup: String(item?.pickup || "").trim(),
      destination: String(item?.destination || "").trim(),
      containerScu: parseMissionDecimal(item?.containerScu),
      cargoSegmentId: String(item?.cargoSegmentId || "").trim(),
      pickedUpAt: String(item?.pickedUpAt || "").trim(),
      deliveredAt: String(item?.deliveredAt || "").trim(),
    }))
    .filter((item) => item.name || item.pickup || item.destination);
}

function getMissionServiceDetails(mission) {
  const details = mission?.serviceDetails && typeof mission.serviceDetails === "object" && !Array.isArray(mission.serviceDetails)
    ? mission.serviceDetails
    : {};
  return {
    customer: String(details.customer || "").trim(),
    location: String(details.location || "").trim(),
    serviceType: normalizeRefuelServiceType(details.serviceType),
    hydrogenAmount: parseMissionDecimal(details.hydrogenAmount),
    quantumAmount: parseMissionDecimal(details.quantumAmount),
    targetVehicle: String(details.targetVehicle || "").trim(),
    hydrogenRate: parseMissionDecimal(details.hydrogenRate),
    quantumRate: parseMissionDecimal(details.quantumRate),
    bonus: String(details.bonus || "").trim(),
    subject: String(details.subject || "").trim(),
    caseNumber: String(details.caseNumber || "").trim(),
    leadInvestigator: String(details.leadInvestigator || "").trim(),
    instructions: String(details.instructions || "").trim(),
    dangerNote: String(details.dangerNote || "").trim(),
    salvageTarget: String(details.salvageTarget || "").trim(),
    claimNumber: String(details.claimNumber || "").trim(),
    packages: normalizeCourierPackages(details.packages),
    maxPackageScu: parseMissionDecimal(details.maxPackageScu),
    items: normalizeProcurementItems(details.items),
    miningMethod: String(details.miningMethod || "hand").trim().toLowerCase() === "ship" ? "ship" : "hand",
    searchArea: String(details.searchArea || "").trim(),
    material: String(details.material || "").trim(),
    targetAmount: parseMissionDecimal(details.targetAmount),
    tool: String(details.tool || "").trim(),
  };
}

function formatServiceMissionSummary(mission) {
  const details = getMissionServiceDetails(mission);
  const missionType = normalizeMissionType(mission?.type);
  if (missionType === "courier" || missionType === "delivery") {
    const packageCount = details.packages.reduce((sum, item) => sum + item.quantity, 0);
    const countLabel = missionType === "delivery"
      ? t("contracts.delivery.itemCount", { count: packageCount })
      : t("contracts.courier.packageCount", { count: packageCount });
    return [getMissionTypeLabel(mission), packageCount ? countLabel : "", details.customer].filter(Boolean).join(" · ");
  }
  if (normalizeMissionType(mission?.type) === "refuel") {
    const parts = [getRefuelServiceLabel(details.serviceType)];
    if (details.hydrogenAmount !== null) {
      parts.push(`Hydrogen ${formatScuAmount(details.hydrogenAmount)}`);
    }
    if (details.quantumAmount !== null) {
      parts.push(`Quantum ${formatScuAmount(details.quantumAmount)}`);
    }
    if (details.targetVehicle) parts.push(details.targetVehicle);
    if (details.customer) parts.push(details.customer);
    return parts.join(" · ");
  }
  if (normalizeMissionType(mission?.type) === "investigation") {
    return [getMissionTypeLabel(mission), details.subject, details.caseNumber, details.customer].filter(Boolean).join(" · ");
  }
  if (normalizeMissionType(mission?.type) === "salvage") {
    return [getMissionTypeLabel(mission), details.salvageTarget, details.claimNumber, details.customer].filter(Boolean).join(" · ");
  }
  if (normalizeMissionType(mission?.type) === "procurement") {
    const itemCount = details.items.reduce((sum, item) => sum + item.quantity, 0);
    return [getMissionTypeLabel(mission), itemCount ? `${itemCount} ${t("contracts.form.procurementItems")}` : "", details.customer].filter(Boolean).join(" · ");
  }
  if (normalizeMissionType(mission?.type) === "mining") {
    return [getMissionTypeLabel(mission), details.material, details.searchArea, details.customer].filter(Boolean).join(" · ");
  }
  return [getMissionTypeLabel(mission), details.customer].filter(Boolean).join(" · ");
}

function renderServiceMissionCards(mission) {
  const details = getMissionServiceDetails(mission);
  if (normalizeMissionType(mission?.type) === "delivery") {
    const packages = details.packages.map((item) => {
      const cargoLoads = Number(item.containerScu) > 0
        ? (mission.loads || []).filter((load) => String(load.segmentId || "") === String(item.cargoSegmentId || ""))
        : [];
      const delivered = Number(item.containerScu) > 0
        ? cargoLoads.length > 0 && cargoLoads.every((load) => isLoadDelivered(load))
        : Boolean(item.deliveredAt);
      const onBoard = Number(item.containerScu) > 0
        ? cargoLoads.some((load) => Boolean(load.placement) && !isLoadDelivered(load))
        : Boolean(item.pickedUpAt);
      const status = delivered
        ? t("contracts.delivery.delivered")
        : onBoard
          ? t("contracts.delivery.onBoard")
          : t("contracts.delivery.toCollect");
      const containerLabel = Number(item.containerScu) > 0
        ? t("contracts.delivery.container", { value: item.containerScu.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE") })
        : t("contracts.delivery.handPackage");
      return `
        <li>
          <strong>${escapeHtml(`${item.quantity} × ${item.name || t("contracts.delivery.item")}`)}</strong>
          <span>${escapeHtml(`${item.pickup || t("common.open")} → ${item.destination || t("common.open")}`)}</span>
          <small>${escapeHtml(`${containerLabel} · ${status}`)}</small>
        </li>
      `;
    }).join("");
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(getMissionTypeLabel(mission))}</strong>
        ${details.customer ? `<p>${escapeHtml(details.customer)}</p>` : ""}
        ${packages ? `<ul class="service-item-list">${packages}</ul>` : ""}
        ${details.instructions ? `<p>${escapeHtml(details.instructions)}</p>` : ""}
        ${details.dangerNote ? `<p>${escapeHtml(details.dangerNote)}</p>` : ""}
      </article>
    `;
  }
  if (normalizeMissionType(mission?.type) === "courier") {
    const packages = details.packages.map((item) => {
      const status = item.deliveredAt
        ? t("contracts.courier.delivered")
        : item.pickedUpAt
          ? t("contracts.courier.onBoard")
          : t("contracts.courier.toCollect");
      return `
        <li>
          <strong>${escapeHtml(`${item.quantity} × ${item.name || t("contracts.courier.package")}`)}</strong>
          <span>${escapeHtml(`${item.pickup || t("common.open")} → ${item.destination || t("common.open")}`)}</span>
          <small>${escapeHtml(status)}</small>
        </li>
      `;
    }).join("");
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(getMissionTypeLabel(mission))}</strong>
        ${details.customer ? `<p>${escapeHtml(details.customer)}</p>` : ""}
        ${packages ? `<ul class="service-item-list">${packages}</ul>` : ""}
        ${details.maxPackageScu !== null ? `<p>${escapeHtml(t("contracts.courier.maxSize", { value: details.maxPackageScu.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE") }))}</p>` : ""}
        ${details.instructions ? `<p>${escapeHtml(details.instructions)}</p>` : ""}
      </article>
    `;
  }
  if (normalizeMissionType(mission?.type) === "refuel") {
    const hydrogenLabel = details.hydrogenAmount === null
      ? t("common.notSpecified")
      : formatScuAmount(details.hydrogenAmount);
    const quantumLabel = details.quantumAmount === null
      ? t("common.notSpecified")
      : formatScuAmount(details.quantumAmount);
    const hasAmounts = details.hydrogenAmount !== null || details.quantumAmount !== null;
    const rates = [
      details.hydrogenRate !== null ? `Hydrogen ${details.hydrogenRate.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC/SCU` : "",
      details.quantumRate !== null ? `Quantum ${details.quantumRate.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC/SCU` : "",
    ].filter(Boolean).join(" · ");
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(getRefuelServiceLabel(details.serviceType))}</strong>
        <p>${escapeHtml(details.location || t("hub.mission.locationOpen"))}${details.customer ? ` · ${escapeHtml(details.customer)}` : ""}</p>
        ${details.targetVehicle ? `<p>${escapeHtml(t("contracts.service.target", { value: details.targetVehicle }))}</p>` : ""}
        <p>${escapeHtml(hasAmounts ? `Hydrogen: ${hydrogenLabel} · Quantumfuel: ${quantumLabel}` : t("contracts.service.amountOpen"))}</p>
        ${rates ? `<p>${escapeHtml(t("contracts.service.rates", { value: rates }))}</p>` : ""}
        ${details.bonus ? `<p>${escapeHtml(details.bonus)}</p>` : ""}
      </article>
    `;
  }

  if (normalizeMissionType(mission?.type) === "investigation") {
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(details.subject || getMissionTypeLabel(mission))}</strong>
        <p>${escapeHtml(details.location || t("hub.mission.locationOpen"))}${details.customer ? ` · ${escapeHtml(details.customer)}` : ""}</p>
        ${details.caseNumber ? `<p>${escapeHtml(t("contracts.investigation.case", { value: details.caseNumber }))}</p>` : ""}
        ${details.leadInvestigator ? `<p>${escapeHtml(t("contracts.investigation.lead", { value: details.leadInvestigator }))}</p>` : ""}
        ${details.instructions ? `<p>${escapeHtml(details.instructions)}</p>` : ""}
        ${details.dangerNote ? `<p>${escapeHtml(t("contracts.investigation.danger", { value: details.dangerNote }))}</p>` : ""}
      </article>
    `;
  }

  if (normalizeMissionType(mission?.type) === "salvage") {
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(details.salvageTarget || getMissionTypeLabel(mission))}</strong>
        <p>${escapeHtml(details.location || t("hub.mission.locationOpen"))}${details.customer ? ` · ${escapeHtml(details.customer)}` : ""}</p>
        ${details.claimNumber ? `<p>${escapeHtml(t("contracts.salvage.claim", { value: details.claimNumber }))}</p>` : ""}
        ${details.instructions ? `<p>${escapeHtml(details.instructions)}</p>` : ""}
      </article>
    `;
  }

  if (normalizeMissionType(mission?.type) === "procurement") {
    const items = details.items.map((item) => `
      <li>
        <strong>${escapeHtml(`${item.quantity} × ${item.name}`)}</strong>
        ${item.destination ? `<span>${escapeHtml(item.destination)}</span>` : ""}
      </li>
    `).join("");
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(getMissionTypeLabel(mission))}</strong>
        <p>${escapeHtml(details.location || t("hub.mission.locationOpen"))}${details.customer ? ` · ${escapeHtml(details.customer)}` : ""}</p>
        ${items ? `<ul class="service-item-list">${items}</ul>` : ""}
        ${details.instructions ? `<p>${escapeHtml(details.instructions)}</p>` : ""}
      </article>
    `;
  }

  if (normalizeMissionType(mission?.type) === "mining") {
    const methodLabel = t(`contracts.form.miningMethod${details.miningMethod === "ship" ? "Ship" : "Hand"}`);
    return `
      <article class="mission-segment">
        <strong>${escapeHtml(details.material || methodLabel || getMissionTypeLabel(mission))}</strong>
        <p>${escapeHtml(details.location || t("hub.mission.locationOpen"))}${details.customer ? ` · ${escapeHtml(details.customer)}` : ""}</p>
        ${details.searchArea ? `<p>${escapeHtml(`${t("contracts.form.searchArea")}: ${details.searchArea}`)}</p>` : ""}
        ${details.targetAmount !== null ? `<p>${escapeHtml(`${t("contracts.form.targetAmount")}: ${details.targetAmount.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")}`)}</p>` : ""}
        ${details.tool ? `<p>${escapeHtml(`${t("contracts.form.recommendedTool")}: ${details.tool}`)}</p>` : ""}
        ${details.instructions ? `<p>${escapeHtml(details.instructions)}</p>` : ""}
      </article>
    `;
  }

  return `
      <article class="mission-segment">
      <strong>${escapeHtml(getMissionTypeLabel(mission))}</strong>
      <p>${escapeHtml(details.location || t("hub.mission.locationOpen"))}${details.customer ? ` · ${escapeHtml(details.customer)}` : ""}</p>
    </article>
  `;
}

function getMissionActiveLoads(mission) {
  return (Array.isArray(mission?.loads) ? mission.loads : []).filter((load) => !isLoadDelivered(load));
}

function getMissionDeliveredLoads(mission) {
  return (Array.isArray(mission?.loads) ? mission.loads : []).filter((load) => isLoadDelivered(load));
}

function getMissionLoadStats(mission) {
  const allLoads = Array.isArray(mission?.loads) ? mission.loads : [];
  const activeLoads = allLoads.filter((load) => !isLoadDelivered(load));
  const deliveredLoads = allLoads.filter((load) => isLoadDelivered(load));
  const placedLoads = activeLoads.filter((load) => Boolean(load.placement));
  const totalScu = allLoads.reduce((sum, load) => sum + (Number(load.scu) || 0), 0);
  const deliveredScu = deliveredLoads.reduce((sum, load) => sum + (Number(load.scu) || 0), 0);

  return {
    allLoads,
    activeLoads,
    deliveredLoads,
    placedLoads,
    totalCount: allLoads.length,
    activeCount: activeLoads.length,
    deliveredCount: deliveredLoads.length,
    placedCount: placedLoads.length,
    totalScu,
    deliveredScu,
    isCompleted: allLoads.length > 0 && deliveredLoads.length === allLoads.length,
  };
}

function getCurrentCargoGridFleetEntryId() {
  return String(state.layout?.fleetEntryId || state.activeFleetEntryId || "").trim();
}

function getLoadPlacementFleetEntryId(load, mission = null) {
  if (!load?.placement) return "";
  const explicitFleetEntryId = String(load.placement.fleetEntryId || "").trim();
  if (explicitFleetEntryId) return explicitFleetEntryId;
  const assignedFleetEntryId = String(mission?.assignedFleetEntryId || "").trim();
  if (assignedFleetEntryId) return assignedFleetEntryId;
  return String(state.layout?.fleetEntryId || state.activeFleetEntryId || "").trim();
}

function isLoadPlacementForFleetEntry(load, mission, fleetEntryId = getCurrentCargoGridFleetEntryId()) {
  if (!load?.placement) return false;
  const targetFleetEntryId = String(fleetEntryId || "").trim();
  if (!targetFleetEntryId) return true;
  return getLoadPlacementFleetEntryId(load, mission) === targetFleetEntryId;
}

function isLoadPlacementInCurrentLayout(load, mission) {
  return isLoadPlacementForFleetEntry(load, mission, getCurrentCargoGridFleetEntryId());
}

function canMissionUseCurrentCargoGrid(mission) {
  if (!mission || !isCargoMission(mission) || !isMissionActive(mission)) return false;
  // The organization workspace is a shared dispatch board. Cargo placement
  // belongs to the pilot-specific execution workspace, not to this shared view.
  if (isDispatcherMode()) return false;
  const currentFleetEntryId = getCurrentCargoGridFleetEntryId();
  if (!currentFleetEntryId) return true;
  if (!isDispatcherMode()) return String(mission.assignedFleetEntryId || "").trim() === currentFleetEntryId;
  return false;
}

function isMissionAssignedToCurrentActiveShip(mission) {
  const activeEntry = currentActiveFleetEntry();
  if (!activeEntry) return false;
  return String(mission?.assignedFleetEntryId || "").trim() === activeEntry.id;
}

function canMissionRunWithCurrentActiveShip(mission) {
  if (isDispatcherMode()) {
    return Boolean(mission && isMissionActive(mission));
  }
  if (!mission || !isMissionActive(mission) || !isMissionAssignedToCurrentActiveShip(mission)) return false;
  const missionType = normalizeMissionType(mission.type);

  if (isCargoMission(mission)) {
    const cargoState = getActiveCargoCapacityState();
    const hasPendingAmount = getMissionSegments(mission).some((segment) => Boolean(segment.quantityPending));
    const requestedScu = getMissionActiveLoads(mission).reduce((sum, load) => sum + (Number(load.scu) || 0), 0);
    return Boolean(
      cargoState.hasCargo
      && cargoState.totalCapacity > 0
      && (
        (hasPendingAmount && requestedScu <= cargoState.totalCapacity)
        || (requestedScu > 0 && requestedScu <= cargoState.totalCapacity)
      ),
    );
  }

  if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    return getRefuelReadiness(details.serviceType, details).ok;
  }

  if (missionType === "salvage") {
    return getSalvageReadiness().ok;
  }

  if (missionType === "mining") {
    return getMiningReadiness(getMissionServiceDetails(mission).miningMethod).ok;
  }

  return true;
}

function getMissionCompletedAt(mission) {
  if (mission?.completedAt) return mission.completedAt;
  const deliveredLoads = getMissionDeliveredLoads(mission);
  if (deliveredLoads.length === 0) return "";
  const timestamps = deliveredLoads
    .map((load) => load.deliveredAt)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  if (timestamps.length === 0) return "";
  return new Date(Math.max(...timestamps)).toISOString();
}

function getMissionSegments(mission) {
  if (!isCargoMission(mission)) {
    return [];
  }

  if (Array.isArray(mission.segments) && mission.segments.length > 0) {
    return mission.segments;
  }

  const firstLoad = Array.isArray(mission.loads) ? mission.loads[0] : null;
  const width = firstLoad?.width || 1;
  const depth = firstLoad?.depth || 1;
  const height = firstLoad?.height || 1;

  return [
    {
      id: createRuntimeId(),
      title: mission.title || "Fracht",
      pickup: mission.pickup || "",
      dropoff: mission.dropoff || "",
      quantity: Array.isArray(mission.loads) ? mission.loads.length : 1,
      width,
      depth,
      height,
      isHandheld: false,
      isPlaceable: true,
      scuPerLoad: width * depth * height,
      totalScu: width * depth * height * (Array.isArray(mission.loads) ? mission.loads.length : 1),
      order: 0,
    },
  ];
}

function formatMissionSegmentCargo(segment) {
  if (segment.quantityPending) {
    const expected = Number(segment.expectedCargoScu) > 0
      ? t("contracts.incomplete.expectedTotal", { value: formatScuAmount(segment.expectedCargoScu) })
      : "";
    return [t("contracts.incomplete.pickupAmountOpen"), expected].filter(Boolean).join(" · ");
  }
  const quantity = Number(segment.quantity) || 0;
  if (segment.isHandheld) {
    return `${quantity}x · Handfracht · ${formatScuAmount(segment.totalScu)}`;
  }
  return `${quantity}x · ${segment.width}×${segment.depth}×${segment.height} · ${formatScuAmount(segment.totalScu)}`;
}

function getLoadPickup(load, mission) {
  return String(load.pickup || mission.pickup || "").trim();
}

function getLoadDropoff(load, mission) {
  return String(load.dropoff || mission.dropoff || "").trim();
}

function formatLoadRoute(load, mission) {
  return `${getLoadPickup(load, mission)} → ${getLoadDropoff(load, mission)}`;
}

function summarizeMissionRoute(mission) {
  if (!isCargoMission(mission)) {
    const details = getMissionServiceDetails(mission);
    if (["courier", "delivery"].includes(normalizeMissionType(mission?.type))) {
      const pickups = [...new Set(details.packages.map((item) => item.pickup).filter(Boolean))];
      const destinations = [...new Set(details.packages.map((item) => item.destination).filter(Boolean))];
      if (pickups.length === 1 && destinations.length === 1) return `${pickups[0]} → ${destinations[0]}`;
      return t(normalizeMissionType(mission?.type) === "delivery" ? "contracts.delivery.routeSummary" : "contracts.courier.routeSummary", {
        pickups: pickups.length,
        destinations: destinations.length,
      });
    }
    return details.location || mission.dropoff || mission.pickup || "Einsatzort offen";
  }

  const segments = getMissionSegments(mission);
  const pickups = [...new Set(segments.map((segment) => segment.pickup).filter(Boolean))];
  const dropoffs = [...new Set(segments.map((segment) => segment.dropoff).filter(Boolean))];
  const pickupSummary = pickups.length === 1
    ? pickups[0]
    : pickups.length > 1
      ? t("contracts.route.startCount", { count: pickups.length })
      : t("contracts.route.startOpen");
  const dropoffSummary = dropoffs.length === 1
    ? dropoffs[0]
    : dropoffs.length > 1
      ? t("contracts.route.targetCount", { count: dropoffs.length })
      : t("contracts.route.targetOpen");

  return `${pickupSummary} → ${dropoffSummary}`;
}
