// Conservative matching. Decisions are pure; the view stages all mutations
// before committing them with the event acknowledgement in one transaction.
(function(root) {
  const FleetLog = typeof module !== 'undefined' && module.exports ? require('./fleet-log.js') : root.FleetLog;
  const key = value => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Inventory names observed on arrival at these stations. Resolve against
  // existing locations so archived or renamed entries are not recreated.
  const inventoryLocations = {RR_CRU_LEO:'Seraphim Station', RR_CRU_L4:'CRU-L4 Shallow Fields Station',
    RR_CRU_L1:'CRU-L1 Ambitious Dream Station'};
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
    if (!Number.isFinite(age) || age < -5000 || (event.kind !== 'ship_loss' && age > 15 * 60 * 1000)) return {action:'discard', reason:'expired'};
    const player = context.player || settings.pilotName;
    if (event.player && player && key(event.player) !== key(player)) return {action:'discard', reason:'player'};
    if (['ship', 'location'].includes(event.kind) && event.session && context.session && event.session !== context.session) return {action:'discard', reason:'session'};
    if (event.kind === 'ship' && Object.hasOwn(context, 'ship')
        && (!context.ship || event.name !== context.ship.name || event.owner !== context.ship.owner
          || (event.entityId && event.entityId !== context.ship.entityId))) return {action:'discard', reason:'superseded'};
    if (event.kind === 'location' && Object.hasOwn(context, 'location') && event.value !== context.location) return {action:'discard', reason:'superseded'};
    if (event.kind === 'location' && event.locationContext?.at && context.locationContext?.at
        && event.locationContext.at !== context.locationContext.at) return {action:'discard', reason:'superseded'};
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
      return FleetLog.shipPlan(event, state, settings, player || event.player, saved.ships);
    }
    if (event.kind === 'ship_loss') return FleetLog.lossPlan(event, state, player || event.player, saved.ships);
    if (event.kind === 'location') {
      if (!settings.logAutoLocation) return {reason:'disabled'};
      const value = resolveLocation(event.value, choices, saved.locations);
      if (value === null && event.id && locationObservation(state.telemetryLocation)?.id !== event.id) {
        return {action:'location_unresolved', value:''};
      }
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
  function locationObservation(value) {
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 200
        || !Number.isFinite(Date.parse(value.at))) return null;
    return {id:value.id, at:value.at, raw:String(value.raw || '').slice(0,300),
      value:String(value.value || '').slice(0,300), session:String(value.session || '').slice(0,100),
      ...(value.locationContext ? {locationContext:locationContext(value.locationContext)} : {})};
  }
  function locationContext(value) {
    const result = {kind:['place','body','space','travel','unknown'].includes(value?.kind) ? value.kind : 'unknown'};
    for (const name of ['system','near','destination','previous','at']) result[name] = String(value?.[name] || '').slice(0,300);
    return result;
  }
  function locationName(raw, choices, saved) {
    return resolveLocation(raw, choices, saved) || inventoryLocations[raw] || raw || '';
  }
  function locationStatus(state, context, choices = []) {
    const current = String(state.currentLocation || '').trim(), observation = locationObservation(state.telemetryLocation);
    if (current) {
      if (!observation || observation.value !== current) return {kind:'selected'};
      const confirmed = context.enabled && context.live && context.settings?.logAutoLocation !== false && context.location === observation.raw
        && (!observation.session || observation.session === context.session);
      return {kind:confirmed ? 'confirmed' : 'stale',
        ...(confirmed && context.locationContext?.kind === 'body' ? {scope:'body'} : {})};
    }
    const active = context.enabled && context.settings?.logAutoLocation !== false;
    const saved = links(state.telemetryLinks).locations;
    const previous = active && context.live ? locationName(context.lastLocation, choices, saved) : '';
    if (active && context.live && context.locationContext) {
      const details = locationContext(context.locationContext);
      return {...details, previous, name:locationName(context.location, choices, saved),
        destination:locationName(details.destination, choices, saved), offline:false};
    }
    // A disconnected/disabled reader must not display a saved space or travel
    // observation as the player's current position.
    return {kind:'unknown', previous:previous || '', offline:Boolean(context.enabled && !context.live)};
  }
  const api = {key, links, resolveLocation, plan, balance, locationObservation, locationContext, locationStatus};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TelemetryDomain = api;
})(globalThis);
