// Service mission summaries and detail cards.
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
