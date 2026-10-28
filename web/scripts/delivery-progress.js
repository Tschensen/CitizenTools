(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DeliveryProgress = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stable(value[key])]),
    );
    return value;
  }
  const fingerprint = value => JSON.stringify(stable(value));
  const clone = value => JSON.parse(JSON.stringify(value));

  function totals(entries) {
    const result = { total: 0, waiting: 0, onBoard: 0, delivered: 0 };
    entries.forEach(({ load }) => {
      const scu = Math.max(0, Number(load.scu) || 0);
      result.total += scu;
      result[load.deliveredAt ? 'delivered' : load.placement ? 'onBoard' : 'waiting'] += scu;
    });
    return result;
  }

  // Reversible deliveries own only their missions and history entry. Guard the
  // occupied grid too, so restoring a container cannot overlap newer cargo.
  function guard(state, missionIds) {
    const ids = new Set(missionIds);
    return fingerprint({
      missions: state.missions.filter(mission => ids.has(mission.id)),
      ledger: (state.ledgerEntries || []).filter(entry => ids.has(entry.missionId)),
      layout: state.layout,
      ship: state.activeFleetEntryId,
      fleet: (state.fleet || []).filter(entry => entry.id === state.activeFleetEntryId),
      occupied: state.missions.flatMap(mission => (mission.loads || [])
        .filter(load => load.placement).map(load => ({ missionId: mission.id, load }))),
    });
  }

  function capture(state, missionIds) {
    const ids = new Set(missionIds);
    return { version: 1, missions: clone(state.missions.filter(mission => ids.has(mission.id))) };
  }

  function finish(snapshot, state) {
    return { ...snapshot, after: guard(state, snapshot.missions.map(mission => mission.id)) };
  }

  function canUndo(entry, state) {
    const undo = entry?.deliveryUndo;
    return Boolean(undo?.version === 1 && Array.isArray(undo.missions) && undo.missions.length
      && typeof undo.after === 'string'
      && guard(state, undo.missions.map(mission => mission.id)) === undo.after);
  }

  function undo(entry, state) {
    if (!canUndo(entry, state)) return false;
    const replacements = new Map(entry.deliveryUndo.missions.map(mission => [mission.id, clone(mission)]));
    state.missions = state.missions.map(mission => replacements.get(mission.id) || mission);
    state.stopHistory = state.stopHistory.filter(item => item.id !== entry.id);
    state.selectedRunRoutePointKey = '';
    state.selectedStopDropoff = entry.dropoff;
    return true;
  }

  return { totals, fingerprint, capture, finish, canUndo, undo };
});
