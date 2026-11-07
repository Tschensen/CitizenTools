// Game entity IDs identify observed instances, not permanent purchases.
(function(root) {
  const text = value => String(value || '').trim();
  const handle = value => text(value).toLowerCase();
  const key = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  function identity(value) {
    if (!value || !['LIVE','PTU','EPTU','HOTFIX'].includes(value.channel)
        || !/^[1-9][0-9]{0,19}$/.test(value.entityId) || !text(value.owner)
        || text(value.owner).length > 100 || !/^[A-Za-z0-9_]{1,100}$/.test(value.className)
        || !Number.isFinite(Date.parse(value.at))) return null;
    return {entityId:String(value.entityId), channel:value.channel, owner:text(value.owner),
      className:value.className, at:value.at};
  }
  function bindingKey(event) {
    const value = identity(event);
    return value ? `${value.channel}|${handle(value.owner)}|${value.entityId}` : `${event.name}|${event.owner}`;
  }
  function sameIdentity(left, right) {
    const a = identity(left), b = identity(right);
    return Boolean(a && b && a.entityId === b.entityId && a.channel === b.channel
      && handle(a.owner) === handle(b.owner) && a.className === b.className);
  }
  function own(event, player) {
    return Boolean(text(player) && text(event.player) && text(event.owner)
      && handle(player) === handle(event.player) && handle(event.owner) === handle(player));
  }
  function matchesModel(event, entry) {
    const aliases = {'originjumpworks':'Origin', 'robertsspaceindustries':'RSI',
      'drakeinterplanetary':'Drake', 'anvilaerospace':'Anvil', 'aegisdynamics':'Aegis', 'crusaderindustries':'Crusader'};
    const model = text(entry.model), fullModel = [model, entry.variant].filter(Boolean).join(' ');
    const makers = [entry.manufacturer, aliases[key(entry.manufacturer)]].filter(Boolean);
    return [model, fullModel, ...makers.flatMap(maker => [`${maker} ${model}`, `${maker} ${fullModel}`])]
      .some(name => key(name) === key(event.name));
  }
  function candidates(event, state) {
    return (state.fleet || []).filter(entry => entry.status === 'active' && entry.shipId && matchesModel(event, entry)
      && (!text(entry.ownerName) || handle(entry.ownerName) === handle(event.owner))
      && (!identity(entry.logIdentity) || handle(entry.logIdentity.owner) === handle(event.owner))
      && (event.kind !== 'ship_loss' || !identity(entry.logIdentity) || sameIdentity(entry.logIdentity, event)));
  }
  function profiles(event, state) {
    return (state.shipLibrary || []).filter(entry => entry.id && !entry.archived && matchesModel(event, entry));
  }
  function shipPlan(event, state, settings, player, saved = {}) {
    if (!own(event, player)) return {reason:'ship_owner'};
    const observed = identity(event), binding = bindingKey(event), available = candidates(event, state);
    const exact = observed ? (state.fleet || []).filter(entry => sameIdentity(entry.logIdentity, observed)) : [];
    if (exact.length) {
      return exact.length === 1 && available.some(entry => entry.id === exact[0].id)
        ? {action:'ship', fleetId:exact[0].id} : {reason:'ship_instance', bindingKey:binding};
    }
    const explicit = available.filter(entry => entry.id === saved[binding]
      && (!observed || !identity(entry.logIdentity)));
    if (explicit.length === 1) return {action:'ship', fleetId:explicit[0].id};
    // Never transfer an existing instance binding silently to a different ID.
    if (available.length === 1 && !identity(available[0].logIdentity)) return {action:'ship', fleetId:available[0].id};
    if (!observed && available.length === 1) return {action:'ship', fleetId:available[0].id};
    if (available.length) return {reason:'ship_instance', bindingKey:binding};
    const known = profiles(event, state);
    if (known.length !== 1) return {reason:'ship_profile', bindingKey:binding};
    if (!observed) return {reason:'ship_identity', bindingKey:binding};
    const previous = (state.fleet || []).some(entry => matchesModel(event, entry));
    if (!previous && settings.logAutoFleet) return {action:'ship_create', shipId:known[0].id};
    return {reason:'ship_new', bindingKey:binding, shipId:known[0].id};
  }
  function loss(value) {
    if (!value || !identity(value.identity) || !text(value.id) || text(value.id).length > 200
        || !['pending','confirmed','dismissed','restored'].includes(value.status)
        || !Number.isFinite(Date.parse(value.at))) return null;
    return {id:value.id, identity:identity(value.identity), at:value.at, status:value.status,
      evidence:text(value.evidence).slice(0,80), zone:text(value.zone).slice(0,150),
      previousEndedOn:text(value.previousEndedOn), previousActive:Boolean(value.previousActive)};
  }
  // The ship being visited can belong to somebody else. Display it without
  // changing the selected fleet ship or borrowing that ship's registration.
  function hubShip(context, state, activeEntry, pilotName = '') {
    const presence = context.enabled && context.live ? context.shipPresence || 'unknown' : 'unknown';
    const observed = context.enabled && context.live && context.ship?.name ? context.ship : null;
    if (observed) {
      const event = {...observed, player:context.player, at:context.at, channel:context.settings?.gameChannel};
      const exact = (state.fleet || []).filter(entry => sameIdentity(entry.logIdentity, event));
      const entry = exact.length === 1 ? exact[0] : null;
      const known = profiles(event, state);
      return {live:true, presence:'aboard', name:observed.name, owner:text(observed.owner),
        ownership: !text(observed.owner) || !text(context.player) ? 'unknown' : own(event, context.player) ? 'own' : 'other',
        entry, profile:known.length === 1 ? known[0] : null};
    }
    if (!activeEntry) return presence === 'outside' ? {live:false,presence,entry:null,profile:null,name:'',owner:'',ownership:'unknown'} : null;
    const owner = text(activeEntry.ownerName) || text(activeEntry.logIdentity?.owner);
    const player = text(context.player) || text(context.settings?.pilotName) || text(pilotName);
    return {live:false, presence, name:[activeEntry.manufacturer, activeEntry.model].filter(Boolean).join(' '), owner,
      ownership:!owner || !player ? 'unknown' : handle(owner) === handle(player) ? 'own' : 'other',
      entry:activeEntry, profile:null};
  }
  function lossPlan(event, state, player, saved = {}) {
    if (!own(event, player) || !identity(event)
        || !['fatal_collision','destroyed_vehicle'].includes(event.evidence)) return {action:'discard', reason:'invalid'};
    if ((state.fleet || []).some(entry => entry.logLoss?.id === event.id)) return {action:'discard'};
    const binding = bindingKey(event);
    const exact = (state.fleet || []).filter(entry => sameIdentity(entry.logIdentity, event));
    if (exact.length === 1 && exact[0].status !== 'active') return {action:'discard'};
    const available = candidates(event, state);
    const matches = exact.length ? exact : available.filter(entry => entry.id === saved[binding] && !identity(entry.logIdentity));
    return matches.length === 1 && available.some(entry => entry.id === matches[0].id)
      ? {action:'ship_loss', fleetId:matches[0].id} : {reason:'ship_loss_link', bindingKey:binding};
  }
  function replacement(state, sourceId) {
    return (state.fleet || []).find(entry => entry.replacesFleetEntryId === sourceId) || null;
  }
  function replacementCandidates(state, source) {
    if (!source || source.status !== 'destroyed' || !source.shipId) return [];
    const sourceOwner = handle(source.ownerName || source.logIdentity?.owner);
    return (state.fleet || []).filter(entry => {
      const owner = handle(entry.ownerName || entry.logIdentity?.owner);
      if (entry.id === source.id || entry.status !== 'active' || entry.shipId !== source.shipId
          || (entry.replacesFleetEntryId && entry.replacesFleetEntryId !== source.id)
          || (sourceOwner && owner && sourceOwner !== owner)
          || sameIdentity(entry.logIdentity, source.logIdentity)
          || (entry.logIdentity?.channel && source.logIdentity?.channel && entry.logIdentity.channel !== source.logIdentity.channel)) return false;
      // Even imported or manually restored histories must not form a cycle.
      const seen = new Set();
      let previous = source;
      while (previous) {
        if (previous.id === entry.id || seen.has(previous.id)) return false;
        seen.add(previous.id);
        previous = state.fleet.find(item => item.id === previous.replacesFleetEntryId);
      }
      return true;
    });
  }
  function linkReplacement(state, sourceId, targetId, expectedId = '') {
    const source = state.fleet.find(entry => entry.id === sourceId);
    const linked = state.fleet.filter(entry => entry.replacesFleetEntryId === sourceId);
    if (!source || source.status !== 'destroyed' || linked.length > 1 || (linked[0]?.id || '') !== expectedId) return false;
    if (!targetId) {
      if (!linked.length) return false;
      linked[0].replacesFleetEntryId = '';
      return true;
    }
    const target = replacementCandidates(state, source).find(entry => entry.id === targetId);
    if (!target || (linked.length && linked[0].id !== targetId)) return false;
    target.replacesFleetEntryId = sourceId;
    return true;
  }
  function decideLoss(state, fleetId, lossId, decision, date) {
    const entry = state.fleet.find(item => item.id === fleetId), value = loss(entry?.logLoss);
    if (!entry || !value || value.id !== lossId) return false;
    if (decision === 'dismiss' && value.status === 'pending') { value.status = 'dismissed'; }
    else if (decision === 'confirm' && value.status === 'pending' && entry.status === 'active'
        && sameIdentity(entry.logIdentity, value.identity) && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= entry.acquiredOn) {
      value.previousEndedOn = entry.endedOn || ''; value.previousActive = state.activeFleetEntryId === entry.id;
      entry.status = 'destroyed'; entry.endedOn = date; value.status = 'confirmed';
      if (value.previousActive) state.activeFleetEntryId = '';
    } else if (decision === 'restore' && value.status === 'confirmed' && entry.status === 'destroyed'
        && sameIdentity(entry.logIdentity, value.identity)) {
      entry.status = 'active'; entry.endedOn = value.previousEndedOn; value.status = 'restored';
      for (const replacement of state.fleet) {
        if (replacement.replacesFleetEntryId === entry.id) replacement.replacesFleetEntryId = '';
      }
      if (value.previousActive && !state.activeFleetEntryId) state.activeFleetEntryId = entry.id;
    } else return false;
    entry.logLoss = value;
    return true;
  }
  const api = {identity, bindingKey, sameIdentity, own, matchesModel, candidates, profiles, shipPlan, loss, lossPlan,
    replacement, replacementCandidates, linkReplacement, decideLoss, hubShip};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FleetLog = api;
})(globalThis);
