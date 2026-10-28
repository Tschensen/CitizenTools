let deliveryActionBusy = false;

function captureDeliveryUndo(entries) {
  return DeliveryProgress.capture(sanitizeState(cloneData(state)), [...new Set(entries.map(({ mission }) => mission.id))]);
}

function finishDeliveryUndo(snapshot) {
  // Keep ten reversible deliveries without growing full mission snapshots forever.
  state.stopHistory.filter(entry => entry.deliveryUndo).slice(9).forEach(entry => { delete entry.deliveryUndo; });
  return DeliveryProgress.finish(snapshot, sanitizeState(cloneData(state)));
}

function getDeliveryProgressGroups(missions) {
  const groups = new Map();
  missions.filter(isCargoMission).forEach(mission => {
    (mission.loads || []).forEach(load => {
      const segment = getMissionSegments(mission).find(item => item.id === load.segmentId);
      // Keep separate pickup locations and contracts even for identical goods.
      const key = `${getStopCargoGroupKey(mission, load)}|${getLoadPickup(load, mission)}`;
      if (!groups.has(key)) groups.set(key, { key, mission, label: load.cargoTitle || segment?.title || load.label,
        pickup: getLoadPickup(load, mission), dropoff: getLoadDropoff(load, mission), entries: [] });
      groups.get(key).entries.push({ mission, load });
    });
  });
  return [...groups.values()].map(group => ({ ...group, amounts: DeliveryProgress.totals(group.entries) }));
}

function renderDeliveryAmounts(amounts) {
  return `<dl class="delivery-amounts">${['total', 'waiting', 'onBoard', 'delivered'].map(key =>
    `<div><dt>${escapeHtml(t(`delivery.amount.${key}`))}</dt><dd>${escapeHtml(formatScuAmount(amounts[key]))}</dd></div>`
  ).join('')}</dl>`;
}

function renderDeliveryOverview(runState) {
  const root = document.getElementById('runDeliveryOverview');
  if (!root) return;
  const fleetId = currentActiveFleetEntry()?.id;
  const cohort = new Set(state.runRouteProgress?.[fleetId] || []);
  const missions = state.missions.filter(mission => mission.assignedFleetEntryId === fleetId
    && (isMissionActive(mission) || cohort.has(mission.id)) && normalizeMissionStatus(mission.status) !== 'cancelled');
  const groups = getDeliveryProgressGroups(missions);
  const location = normalizeRunRouteLocation(runState.selectedPoint?.dropoff);
  const sections = [
    ['unload', group => location && normalizeRunRouteLocation(group.dropoff) === location && group.amounts.onBoard > 0],
    ['pickup', group => location && normalizeRunRouteLocation(group.pickup) === location && group.amounts.waiting > 0],
    ['keep', group => group.amounts.onBoard > 0 && (!location || normalizeRunRouteLocation(group.dropoff) !== location)],
  ];
  root.innerHTML = sections.map(([kind, filter]) => {
    const selected = groups.filter(filter);
    return `<section class="delivery-stop-section"><h3>${escapeHtml(t(`delivery.stop.${kind}`))}</h3>${selected.map(group =>
      `<div class="delivery-progress-row"><strong>${escapeHtml(group.label)}</strong><p>${escapeHtml(group.mission.title)} · ${escapeHtml(group.pickup)} → ${escapeHtml(group.dropoff)}</p>${renderDeliveryAmounts(group.amounts)}</div>`
    ).join('') || `<p class="delivery-empty">${escapeHtml(t('delivery.none'))}</p>`}</section>`;
  }).join('');
  const progress = document.getElementById('runDeliveryProgress');
  progress.innerHTML = groups.map(group => `<div class="delivery-progress-row"><strong>${escapeHtml(group.label)}</strong><p>${escapeHtml(group.mission.title)} · ${escapeHtml(group.pickup)} → ${escapeHtml(group.dropoff)}</p>${renderDeliveryAmounts(group.amounts)}</div>`).join('')
    || `<p class="delivery-empty">${escapeHtml(t('delivery.none'))}</p>`;
  const history = document.getElementById('runDeliveryHistory');
  const normalized = sanitizeState(cloneData(state));
  history.innerHTML = state.stopHistory.filter(entry => entry.deliveryUndo
    && entry.deliveryUndo.missions.some(mission => mission.assignedFleetEntryId === fleetId)).slice(0, 10).map(entry => {
    const enabled = DeliveryProgress.canUndo(entry, normalized);
    return `<div class="delivery-history-row"><div><strong>${escapeHtml(entry.dropoff)} · ${escapeHtml(formatScuAmount(entry.scu))}</strong><p>${escapeHtml(entry.missionTitles.join(' · '))}</p><small>${escapeHtml(formatDateTimeDisplay(entry.completedAt))}</small>${enabled ? '' : `<p>${escapeHtml(t('delivery.undoChanged'))}</p>`}</div><button class="secondary-button" type="button" data-undo-delivery="${escapeHtml(entry.id)}" ${enabled ? '' : 'disabled'}>${escapeHtml(t('delivery.undo'))}</button></div>`;
  }).join('') || `<p class="delivery-empty">${escapeHtml(t('delivery.noHistory'))}</p>`;
  history.querySelectorAll('[data-undo-delivery]').forEach(button => button.addEventListener('click', () => undoDelivery(button.dataset.undoDelivery)));
}

async function refreshDeliveryState() {
  if (!await flushSoloState()) return false;
  return getSoloSync().refresh();
}

function showDeliverySelection(group) {
  const backdrop = document.getElementById('deliverySelectionDialog');
  const form = backdrop.querySelector('form');
  const list = document.getElementById('deliverySelectionList');
  const message = document.getElementById('deliverySelectionMessage');
  const submit = form.querySelector('[type=submit]');
  const cancel = form.querySelector('[data-delivery-cancel]');
  const selectAll = form.querySelector('[data-delivery-all]');
  document.getElementById('deliverySelectionTarget').textContent = `${group.mission.title} · ${group.label} · ${group.dropoff}`;
  list.innerHTML = group.placedEntries.map(({ load }) => `<label class="delivery-container"><input type="checkbox" value="${escapeHtml(load.id)}" checked><span><strong>${escapeHtml(load.label)}</strong><small>${escapeHtml(formatScuAmount(load.scu))} · ${escapeHtml(load.placement.slotId || '')}</small></span></label>`).join('');
  return new Promise(resolve => {
    let result = null;
    const dialog = window.createSoloDialog(backdrop, () => {
      form.removeEventListener('submit', onSubmit);
      list.removeEventListener('change', update);
      cancel.removeEventListener('click', onCancel);
      selectAll.removeEventListener('change', onAll);
      resolve(result);
    });
    const selected = () => new Set([...list.querySelectorAll('input:checked')].map(input => input.value));
    const update = () => {
      const ids = selected();
      const entries = group.placedEntries.filter(({ load }) => ids.has(load.id));
      const analysis = analyzeUnloadEntries(entries, getPlacedLoadEntries());
      submit.disabled = entries.length === 0 || analysis.blockedEntries.length > 0;
      selectAll.checked = entries.length === group.placedEntries.length;
      selectAll.indeterminate = entries.length > 0 && !selectAll.checked;
      message.textContent = analysis.blockedEntries.length
        ? t('delivery.selectionBlocked')
        : t('delivery.selectionSummary', { count: entries.length, scu: formatScuAmount(DeliveryProgress.totals(entries).total) });
    };
    const onSubmit = event => { event.preventDefault(); update(); if (!submit.disabled) { result = [...selected()]; dialog.close(); } };
    const onCancel = () => dialog.close();
    const onAll = () => { list.querySelectorAll('input').forEach(input => { input.checked = selectAll.checked; }); update(); };
    form.addEventListener('submit', onSubmit);
    list.addEventListener('change', update);
    cancel.addEventListener('click', onCancel);
    selectAll.addEventListener('change', onAll);
    update();
    dialog.open();
  });
}

async function chooseDeliveryContainers(dropoff, groupKey, { requireArrival = true } = {}) {
  if (deliveryActionBusy) return false;
  deliveryActionBusy = true;
  try {
    if (!await refreshDeliveryState()) { await showAppNotice(t('delivery.syncRequired')); return false; }
    const group = buildStopCargoGroups(dropoff).find(item => item.key === groupKey);
    if (!group?.placedEntries.length || !isMissionActive(group.mission)
        || (requireArrival && normalizeRunRouteLocation(state.currentLocation) !== normalizeRunRouteLocation(dropoff))) return false;
    const fingerprint = DeliveryProgress.fingerprint(group.placedEntries);
    const ids = await showDeliverySelection(group);
    if (!ids) return false;
    if (!await refreshDeliveryState()) { await showAppNotice(t('delivery.syncRequired')); return false; }
    const fresh = buildStopCargoGroups(dropoff).find(item => item.key === groupKey);
    if (!fresh || DeliveryProgress.fingerprint(fresh.placedEntries) !== fingerprint) {
      await showAppNotice(t('delivery.changed')); return false;
    }
    const changed = await deliverStopCargoGroup(dropoff, groupKey, { loadIds: ids, confirm: false, requireArrival });
    return changed ? await flushSoloState() : false;
  } finally { deliveryActionBusy = false; }
}

async function undoDelivery(id) {
  if (deliveryActionBusy) return false;
  deliveryActionBusy = true;
  try {
    if (!await refreshDeliveryState()) { await showAppNotice(t('delivery.syncRequired')); return false; }
    const entry = state.stopHistory.find(item => item.id === id);
    if (!entry || !DeliveryProgress.canUndo(entry, sanitizeState(cloneData(state)))) {
      await showAppNotice(t('delivery.undoChanged')); return false;
    }
    if (!await showMissionConfirmDialog({ title: t('delivery.undoTitle'), message: t('delivery.undoMessage', { target: entry.dropoff, scu: formatScuAmount(entry.scu) }), confirmLabel: t('delivery.undo') })) return false;
    if (!await refreshDeliveryState()) { await showAppNotice(t('delivery.syncRequired')); return false; }
    const fresh = state.stopHistory.find(item => item.id === id);
    if (!fresh || !DeliveryProgress.canUndo(fresh, sanitizeState(cloneData(state)))) {
      await showAppNotice(t('delivery.undoChanged')); return false;
    }
    // Use the normalized state for the guard, then apply only the owned records.
    const normalized = sanitizeState(cloneData(state));
    if (!DeliveryProgress.undo(fresh, normalized)) return false;
    state.missions = normalized.missions;
    state.stopHistory = normalized.stopHistory;
    state.selectedRunRoutePointKey = '';
    state.selectedStopDropoff = fresh.dropoff;
    lastUnloadPlan = null;
    persist(); render();
    return await flushSoloState();
  } finally { deliveryActionBusy = false; }
}
