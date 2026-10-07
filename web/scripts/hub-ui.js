// Start page presentation.
function renderHub() {
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const activeMissionCount = activeMissions.length;
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const activeFleetEntry = currentActiveFleetEntry();
  const activeShipMedia = activeFleetEntry ? getFleetMediaEntry(activeFleetEntry) : null;
  const activeShipName = activeFleetEntry
    ? `${activeFleetEntry.manufacturer} ${activeFleetEntry.model}`.trim()
    : t("hub.summary.noActiveShip");
  const activeShipRegistration = activeFleetEntry ? formatFleetRegistration(activeFleetEntry) : t("hub.summary.chooseFleet");
  const locale = currentUiLanguage() === "en" ? "en-US" : "de-DE";
  const routeState = buildRunRouteState();
  const compatibleActiveMissions = dispatcherMode
    ? activeMissions
    : activeMissions.filter((mission) => canMissionRunWithCurrentActiveShip(mission));
  const currentRouteMissionIds = new Set(routeState.selectedPoint?.missionIds || []);
  const focusMission = compatibleActiveMissions.find((mission) => currentRouteMissionIds.has(mission.id))
    || compatibleActiveMissions[0]
    || null;
  const focusMissionTitle = focusMission?.title || (activeMissionCount > 0 ? t("hub.mission.noCompatible") : t("hub.mission.noActive"));
  const focusMissionText = focusMission
    ? `${getMissionTypeLabel(focusMission)} · ${summarizeMissionRoute(focusMission)}`
    : activeMissionCount > 0
      ? t("hub.mission.incompatibleActive")
      : t("hub.mission.createFirst");
  const focusMissionTarget = focusMission || activeMissionCount > 0 ? "overview" : "create";
  const routeTargets = routeState.openPoints || [];
  const currentRouteTarget = routeState.selectedPoint || routeTargets[0] || null;
  const formatRouteTargetType = (point) => {
    if (!point) return "";
    if (point.hasPickup && !point.hasCargo) return t("hub.route.pickup");
    if (point.hasCargo) return t("hub.route.delivery");
    if (point.hasService) return t("hub.route.service");
    return t("hub.route.target");
  };
  const plannedPayout = activeMissions.reduce((sum, mission) => sum + (Number(mission.payout) || 0), 0);
  const activeOrgShips = getActiveFleetEntries().length;
  const accountBalance = (state.ledgerEntries || []).reduce((sum, entry) => {
    const amount = Number(entry.amountAuec) || 0;
    return entry.flow === "expense" ? sum - amount : sum + amount;
  }, 0);
  const compatibleMissionIds = new Set(compatibleActiveMissions.map((mission) => mission.id));
  const todayLoadEntries = getAllLoads().filter(({ mission, load }) => (
    compatibleMissionIds.has(mission.id) && !isLoadDelivered(load)
  ));
  const todayPlacedLoads = todayLoadEntries.filter(({ mission, load }) => isLoadPlacementInCurrentLayout(load, mission)).length;
  const todayOpenLoads = Math.max(todayLoadEntries.length - todayPlacedLoads, 0);
  const cargoCapacityState = getActiveCargoCapacityState();
  const unpaidMissions = state.missions.filter((mission) => (
    isMissionCompleted(mission) && !isMissionPaid(mission) && missionHasPayout(mission)
  ));
  const unpaidPayout = unpaidMissions.reduce((sum, mission) => sum + getMissionPayout(mission), 0);
  const routeProgressMeta = routeState.points.length > 0
    ? routeState.arrived
      ? t("hub.today.routeReady")
      : t("hub.today.routeProgress", {
          open: routeState.openPoints.length,
          done: routeState.completedCount,
          total: routeState.progressTotal,
        })
    : t("hub.today.routeEmpty");
  const cargoMeta = todayLoadEntries.length > 0
    ? t("hub.today.cargoMeta", {
        open: todayOpenLoads,
        used: cargoCapacityState.usedCapacity,
        capacity: cargoCapacityState.totalCapacity,
      })
    : t("hub.today.cargoClearMeta");
  const paymentMeta = unpaidMissions.length === 0
    ? t("hub.today.paymentsClearMeta")
    : t(unpaidMissions.length === 1 ? "hub.today.paymentsMetaSingle" : "hub.today.paymentsMetaPlural", { count: unpaidMissions.length });
  const bindHubTargets = (root) => {
    root?.querySelectorAll?.("[data-hub-target]").forEach((card) => {
      const goToTarget = () => setActivePage(card.dataset.hubTarget || "hub");
      card.addEventListener("click", goToTarget);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        goToTarget();
      });
    });
  };

  const previousShipMedia = hubSummary.querySelector('.hub-ship-media');
  hubSummary.innerHTML = [
    dispatcherMode
      ? { key:"ship", label: t("dispatcher.summary.orgShips"), value: t("dispatcher.summary.shipCount", { count: activeOrgShips }), target: "fleet" }
      : { key:"ship", label: t("hub.summary.activeShip"), value: activeShipName, detail: activeShipRegistration, target: "fleet" },
    { key:"mission", label: t("hub.summary.activeMissions"), badge: t("hub.summary.activeCount", { count: activeMissionCount }), value: focusMissionTitle, detail: focusMissionText, target: focusMissionTarget, mission: true },
    { key:"payout", label: t("hub.summary.plannedPayout"), value: `${plannedPayout.toLocaleString(locale)} aUEC` },
    { key:"balance", label: t("hub.summary.balance"), value: `${accountBalance.toLocaleString(locale)} aUEC`, target: "finance" },
  ]
    .map(
      (card) => `
        <div data-cockpit-card="${card.key}" class="summary-card hub-summary-card${card.key === "ship" ? " hub-ship-card" : ""}${card.mission ? " hub-mission-summary" : ""}${card.target ? " is-clickable" : ""}"${card.target ? ` role="button" tabindex="0" data-hub-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(t("hub.openCard", { label: card.label }))}"` : ""}>
          ${card.key === "ship" ? `<div class="hub-ship-art" aria-hidden="true">${renderShipProfileMedia(activeShipMedia, "hub-ship-media")}</div>` : ""}
          <div class="hub-summary-heading"><span>${escapeHtml(card.label)}</span>${card.badge ? `<span class="hub-mission-count" data-flight-stat="mission-count">${escapeHtml(card.badge)}</span>` : ""}</div>
          <strong data-flight-stat="${card.key}" title="${escapeHtml(String(card.value))}">${escapeHtml(String(card.value))}</strong>
          ${card.detail ? `<small title="${escapeHtml(String(card.detail))}">${escapeHtml(String(card.detail))}</small>` : ""}
        </div>
      `,
    )
    .join("");

  bindHubTargets(hubSummary);
  const nextShipMedia = hubSummary.querySelector('.hub-ship-media');
  const previousImage = previousShipMedia?.querySelector('img');
  const nextImage = nextShipMedia?.querySelector('img');
  if (previousShipMedia && nextShipMedia
      && previousImage?.getAttribute('src') === nextImage?.getAttribute('src')
      && previousImage?.getAttribute('alt') === nextImage?.getAttribute('alt')) {
    // Retain the decoded image and its fallback state during routine renders.
    nextShipMedia.replaceWith(previousShipMedia);
  } else {
    bindShipProfileMedia(hubSummary);
  }

  if (hubTodayList) {
    const todayCards = [
      {
        key: "route",
        label: t("hub.today.route"),
        value: currentRouteTarget?.dropoff || (routeState.points.length > 0 ? t("hub.route.completed") : t("hub.route.none")),
        meta: currentRouteTarget ? `${formatRouteTargetType(currentRouteTarget)} · ${routeProgressMeta}` : routeProgressMeta,
        target: "run",
        state: routeState.arrived || (routeState.points.length > 0 && !routeState.openPoints.length) ? "ready" : routeState.openPoints.length > 0 ? "attention" : "idle",
        meter: {value:routeState.completedCount, max:routeState.progressTotal, label:t("hub.today.routeMeter")},
      },
      cargoCapacityState.hasCargo ? {
        key: "cargo",
        label: t("hub.today.cargo"),
        value: todayLoadEntries.length > 0
          ? t("hub.today.cargoValue", { placed: todayPlacedLoads, total: todayLoadEntries.length })
          : t("hub.today.cargoEmpty"),
        meta: cargoMeta,
        target: "load",
        state: todayOpenLoads > 0 ? "attention" : todayLoadEntries.length > 0 ? "ready" : "idle",
        meter: {value:cargoCapacityState.usedCapacity, max:cargoCapacityState.totalCapacity, label:t("hub.today.cargoMeter")},
      } : null,
      {
        key: "payments",
        label: t("hub.today.payments"),
        value: unpaidMissions.length > 0
          ? t("hub.today.paymentsValue", { amount: unpaidPayout.toLocaleString(locale) })
          : t("hub.today.paymentsClear"),
        meta: paymentMeta,
        target: unpaidMissions.length > 0 ? "overview" : "finance",
        state: unpaidMissions.length > 0 ? "attention" : "ready",
      },
    ].filter(Boolean);

    hubTodayList.innerHTML = todayCards.map((card) => {
      const percent = card.meter?.max > 0 ? Math.max(0, Math.min(100, card.meter.value / card.meter.max * 100)) : 0;
      const meterLabel = card.meter ? `${card.meter.label}: ${card.meter.value.toLocaleString(locale)} / ${card.meter.max.toLocaleString(locale)}` : "";
      const paymentLabel = unpaidMissions.length > 0 ? t("hub.today.paymentsPending") : t("hub.today.paymentsClear");
      return `
      <article data-cockpit-card="${card.key}" class="hub-today-card is-${escapeHtml(card.state)}" role="button" tabindex="0" data-hub-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(t("hub.openCard", { label: card.label }))}">
        <span class="hub-today-label">${escapeHtml(card.label)}<i class="hub-status-light" aria-hidden="true"></i></span>
        <strong data-flight-stat="${card.key}">${escapeHtml(String(card.value))}</strong>
        <p>${escapeHtml(String(card.meta))}</p>
        <div class="hub-today-footer">
          <span class="hub-today-action">${escapeHtml(card.key === "route" && card.meter.max > 0 ? t("run.progress.stops", { done: card.meter.value, total: card.meter.max, percent: Math.round(percent) }) : t("hub.today.open"))}</span>
          ${card.meter ? `<span class="hub-meter${card.meter.max > 0 ? "" : " is-empty"}" title="${escapeHtml(meterLabel)}" aria-label="${escapeHtml(meterLabel)}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${escapeHtml(meterLabel)}"><i data-flight-meter="${card.key}" data-value="${percent}" style="transform:scaleX(${percent / 100})"></i></span>`
            : `<span class="hub-payment-signal" title="${escapeHtml(paymentLabel)}" aria-label="${escapeHtml(paymentLabel)}">${unpaidMissions.length > 0 ? "◷" : "✓"}</span>`}
        </div>
      </article>
    `; }).join("");
    bindHubTargets(hubTodayList);
  }
  window.soloCockpit?.apply();
  window.soloEffects?.hub({
    ship:[activeFleetEntry?.id, activeFleetEntry?.manufacturer, activeFleetEntry?.model],
    'mission-count':activeMissionCount,
    mission:[focusMission?.id, focusMission?.title],
    payout:plannedPayout,
    balance:accountBalance,
    route:[currentRouteTarget?.key, routeState.arrived, routeState.completedCount],
    cargo:[todayPlacedLoads, todayLoadEntries.length, cargoCapacityState.usedCapacity, cargoCapacityState.totalCapacity],
    payments:[unpaidMissions.length, unpaidPayout],
  });
}
