// Conservative matching. Decisions are pure; the view stages all mutations
// before committing them with the event acknowledgement in one transaction.
(function(root) {
  const key = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Inventory names observed on arrival at these stations. Resolve against
  // existing locations so archived or renamed entries are not recreated.
  const inventoryLocations = {RR_CRU_LEO:'Seraphim Station', RR_CRU_L4:'CRU-L4 Shallow Fields Station'};
  function links(value) {
    const result = {};
    for (const name of ['ships', 'locations', 'missions', 'objectives']) {
      result[name] = Object.fromEntries(Object.entries(value?.[name] || {}).slice(0, 500)
        .filter(([k, v]) => k.length <= 300 && typeof v === 'string' && v.length <= 200));
    }
    return result;
  }
  function resolveLocation(raw, choices, saved = {}) {
    if (!raw) return '';
    if (Object.hasOwn(saved, raw)) return saved[raw];
    const code = key(raw);
    const suffix = key(String(raw).split('_').at(-1));
    let matches = choices.filter(place => [place.name, ...(place.aliases || [])]
      .some(name => key(name) === code));
    const knownName = inventoryLocations[String(raw).trim().toUpperCase()];
    if (!matches.length && knownName) {
      matches = choices.filter(place => [place.name, ...(place.aliases || [])]
        .some(name => key(name) === key(knownName)));
    }
    if (!matches.length && suffix.length > 3) {
      matches = choices.filter(place => [place.name, ...(place.aliases || [])]
        .some(name => key(name) === suffix));
    }
    const names = [...new Set(matches.map(place => place.name))];
    return names.length === 1 ? names[0] : null;
  }
  function plan(event, state, settings, choices, live, now = Date.now(), context = {}) {
    const age = now - Date.parse(event.at);
    if (!Number.isFinite(age) || age < -5000 || age > 15 * 60 * 1000) return {action:'discard', reason:'expired'};
    const player = context.player || settings.pilotName;
    if (event.player && player && key(event.player) !== key(player)) return {action:'discard', reason:'player'};
    if (['ship', 'location'].includes(event.kind) && event.session && context.session && event.session !== context.session) return {action:'discard', reason:'session'};
    if (event.kind === 'ship' && Object.hasOwn(context, 'ship')
        && (!context.ship || event.name !== context.ship.name || event.owner !== context.ship.owner)) return {action:'discard', reason:'superseded'};
    if (event.kind === 'location' && Object.hasOwn(context, 'location') && event.value !== context.location) return {action:'discard', reason:'superseded'};
    const saved = links(state.telemetryLinks);
    if (event.kind === 'balance') {
      if (!settings.balanceOcrEnabled) return {reason:'disabled'};
      if (!Number.isSafeInteger(event.amount) || event.amount < 0) return {action:'discard', reason:'invalid'};
      if (Date.parse(state.telemetryBalance?.at) >= Date.parse(event.at)) return {action:'discard', reason:'older'};
      return {action:'balance'};
    }
    if (!settings.logEnabled || (!live && ['ship', 'location'].includes(event.kind))) return {reason:'offline'};
    if (event.kind === 'ship') {
      if (!settings.logAutoShip) return {reason:'disabled'};
      const shipKey = `${event.name}|${event.owner}`;
      const active = state.fleet.filter(entry => entry.status === 'active' && entry.shipId);
      const explicit = active.find(entry => entry.id === saved.ships[shipKey]);
      const matches = explicit ? [explicit] : active.filter(entry =>
        (!event.owner || key(event.owner) === key(event.player) || key(event.owner) === key(entry.ownerName))
        && [entry.model, `${entry.manufacturer} ${entry.model}`].some(name => key(name) === key(event.name)));
      return matches.length === 1 ? {action:'ship', fleetId:matches[0].id} : {reason:'ship', bindingKey:shipKey};
    }
    if (event.kind === 'location') {
      if (!settings.logAutoLocation) return {reason:'disabled'};
      const value = resolveLocation(event.value, choices, saved.locations);
      return value !== null ? {action:'location', value} : {reason:'location', bindingKey:event.value};
    }
    if (!['objective', 'completed', 'payment'].includes(event.kind)) return {action:'discard'};
    const enabled = event.kind === 'payment' ? settings.logAutoPayment
      : event.kind === 'completed' ? settings.logAutoComplete : settings.logAutoRoute;
    if (!enabled) return {reason:'disabled'};
    const missionId = saved.missions[event.missionId];
    const mission = state.missions.find(item => item.id === missionId);
    if (!mission) return {reason:'mission', bindingKey:event.missionId};
    if (event.kind === 'payment') {
      const delay = Date.parse(event.at) - Date.parse(event.completedAt);
      if (!Number.isSafeInteger(event.amount) || event.amount <= 0 || event.amount > 999999999999
          || event.match !== 'adjacent_notifications' || !Number.isFinite(delay) || delay < 0 || delay > 2000) {
        return {action:'discard', reason:'invalid'};
      }
      if (['paid','cancelled'].includes(mission.status) || mission.paidAt
          || (state.ledgerEntries || []).some(entry => entry.telemetryEventId === event.id
            || (entry.missionId === missionId && entry.flow === 'income' && Number(entry.amountAuec) > 0))) {
        return {action:'discard', reason:'already_paid'};
      }
      if (mission.status !== 'completed') return {reason:'payment_completion', missionId};
      return {action:'payment', missionId, amount:event.amount};
    }
    if (['completed', 'paid', 'cancelled'].includes(mission.status)) return {action:'discard'};
    if (event.kind === 'completed') return {action:'complete', missionId};
    const kind = event.objectiveId.startsWith('pickup_') ? 'pickup' : event.objectiveId.startsWith('dropoff_') ? 'dropoff' : '';
    if (!kind) return {action:'discard'};
    const bindingKey = `${event.missionId}:${event.objectiveId}`;
    const bound = saved.objectives[bindingKey];
    const location = resolveLocation(event.location, choices, saved.locations);
    const packages = mission.type === 'courier' ? mission.serviceDetails?.packages || [] : [];
    const candidates = packages.length ? packages.filter(item => bound ? item.id === bound
      : location && key(kind === 'pickup' ? item.pickup : item.destination) === key(location))
      : (mission.segments || []).filter(segment => bound && segment.id === bound);
    if (candidates.length !== 1) return {reason:'objective', bindingKey, missionId};
    return {action:packages.length ? 'package' : 'cargo', missionId, targetId:candidates[0].id, kind};
  }
  function balance(value) {
    if (!value || !Number.isSafeInteger(value.amount) || value.amount < 0 || !Number.isFinite(Date.parse(value.at))) return null;
    return {amount:value.amount, at:value.at, sourceFile:String(value.sourceFile || '').slice(0, 240)};
  }
  const api = {key, links, resolveLocation, plan, balance};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TelemetryDomain = api;
})(globalThis);
