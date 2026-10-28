const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const progress = require('../web/scripts/delivery-progress.js');
const unload = require('../web/scripts/unload-guidance.js');
const optimizer = require('../web/scripts/route-optimizer.js');
const merge = require('../web/scripts/solo-merge.js').merge;
const source = name => fs.readFileSync(require.resolve('../web/scripts/' + name), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const mission = { id: 'a', title: 'Contract A', type: 'cargo', status: 'active', assignedFleetEntryId: 'ship',
    segments: [{ id: 's', title: 'Titanium', pickup: 'A', dropoff: 'B' }],
    loads: [0, 1, 2].map(i => ({ id: `a-${i}`, segmentId: 's', cargoTitle: 'Titanium', label: `Titanium ${i}`,
      scu: 8, width: 2, depth: 2, height: 2, pickup: 'A', dropoff: 'B',
      placement: i < 2 ? { row: 0, col: i * 2, z: 0, slotId: `slot-${i}` } : null })) };
  const state = { missions: [mission], stopHistory: [], activeFleetEntryId: 'ship', fleet: [{ id: 'ship' }],
    layout: { rows: 4, cols: 4 }, ledgerEntries: [], currentLocation: 'B', runCompletedRoutePoints: [] };
  const c = { state, console, Date, Map, Set, DeliveryProgress: progress, RouteOptimizer: optimizer,
    cloneData: copy, sanitizeState: copy, createRuntimeId: () => 'delivery-' + state.stopHistory.length,
    getAllLoads: ({includeDelivered = false} = {}) => state.missions.flatMap(mission => mission.loads
      .filter(load => includeDelivered || !load.deliveredAt).map(load => ({mission, load}))),
    getMissionSegments: mission => mission.segments,
    getLoadDropoff: load => load.dropoff, getLoadPickup: load => load.pickup,
    getCurrentCargoGridFleetEntryId: () => 'ship',
    isLoadPlacementInCurrentLayout: load => Boolean(load.placement),
    isLoadPlacementForFleetEntry: load => Boolean(load.placement),
    getLoadPlacementFleetEntryId: () => 'ship',
    isLoadDelivered: load => Boolean(load.deliveredAt),
    isMissionActive: mission => mission.status === 'active',
    isMissionCompleted: mission => mission.status === 'completed',
    normalizeMissionType: type => type, isCargoMission: () => true,
    getMissionAssignmentWarning: () => '', getMissionActiveLoads: mission => mission.loads.filter(load => !load.deliveredAt),
    getActiveCargoCapacityState: () => ({hasCargo: true, totalCapacity: 16}),
    getCurrentShipMaxContainerProfile: () => ({scu: 16}),
    UnloadGuidance: unload, t: key => key, formatScuAmount: amount => String(amount),
    canAutoCompleteMissionProgress: mission => mission.loads.every(load => load.deliveredAt),
    collapsedMissionIds: new Set(), lastUnloadPlan: null, persist: () => {}, render: () => {},
    showMissionConfirmDialog: async () => true,
  };
  c.window = c;
  vm.createContext(c);
  for (const file of ['route-run-ui.js', 'run-route-state.js', 'delivery-workflow-ui.js']) vm.runInContext(source(file), c);
  c.buildRouteStops = () => [];
  c.computeUnloadPlan = () => ({steps: []});
  c.markMissionCompleted = mission => { mission.status = 'completed'; mission.completedAt = 'now'; };
  return { c, state, mission };
}

test('SCU accounting partitions every load without double counting', () => {
  const { mission } = fixture();
  mission.loads[0].deliveredAt = 'now';
  assert.deepEqual(progress.totals(mission.loads.map(load => ({load}))), { total:24, waiting:8, onBoard:8, delivered:8 });
});

test('oversized contract remains eligible and loaded delivery has no remaining-pickup prerequisite', () => {
  const { c, mission } = fixture();
  assert.equal(c.getRunMissionReadiness(mission).routeEligible, true);
  const route = c.buildOptimizedRunRoutePoints([{mission, readiness:{routeEligible:true}}], new Set(['pickup:a:s']));
  const delivery = route.plannedPoints.find(point => point.hasCargo);
  assert.deepEqual(Array.from(delivery.routeDependencies), []);
  assert.ok(route.plannedPoints.some(point => point.hasPickup));
  assert.ok(!route.completedPoints.some(point => point.hasPickup));
});

test('partial delivery changes only selected containers, keeps mission open and journals exact SCU', async () => {
  const { c, state, mission } = fixture();
  const group = c.buildStopCargoGroups('B')[0];
  assert.equal(await c.deliverStopCargoGroup('B', group.key, {loadIds:['a-0'], confirm:false}), true);
  assert.ok(mission.loads[0].deliveredAt);
  assert.ok(mission.loads[1].placement);
  assert.equal(mission.loads[2].deliveredAt, undefined);
  assert.equal(mission.status, 'active');
  assert.equal(state.stopHistory[0].scu, 8);
  assert.equal(progress.canUndo(state.stopHistory[0], state), true);
});

test('empty, stale, unknown, other-location and blocked selections do not mutate cargo', async () => {
  for (const variant of ['empty','unknown','waiting','elsewhere','blocked']) {
    const { c, state, mission } = fixture();
    if (variant === 'elsewhere') state.currentLocation = 'A';
    if (variant === 'blocked') mission.loads[1].placement = {...mission.loads[0].placement, z:2};
    const before = copy(state);
    const ids = variant === 'empty' ? [] : variant === 'unknown' ? ['gone'] : variant === 'waiting' ? ['a-2'] : ['a-0'];
    assert.equal(await c.deliverStopCargoGroup('B', c.buildStopCargoGroups('B')[0].key, {loadIds:ids, confirm:false, requireArrival:true}), false);
    assert.deepEqual(copy(state), before);
  }
});

test('selecting a full stack is valid, selecting only its bottom is not', async () => {
  const {c, mission} = fixture();
  mission.loads[1].placement = {...mission.loads[0].placement, z:2};
  assert.equal(await c.deliverStopCargoGroup('B', c.buildStopCargoGroups('B')[0].key, {loadIds:['a-0','a-1'], confirm:false}), true);
});

test('last delivery completes the mission; persisted undo restores cargo, status and statistics', async () => {
  const {c, state, mission} = fixture();
  mission.loads[2].deliveredAt = 'previous';
  const original = copy(mission);
  await c.deliverStopCargoGroup('B', c.buildStopCargoGroups('B')[0].key, {confirm:false});
  assert.equal(mission.status, 'completed');
  const restored = copy(state);
  assert.equal(progress.undo(restored.stopHistory[0], restored), true);
  assert.deepEqual(restored.missions[0], original);
  assert.deepEqual(restored.stopHistory, []);
});

test('undo refuses newer mission, ledger, occupancy, ship and layout edits', async () => {
  for (const edit of [s => s.missions[0].title='edited', s => s.ledgerEntries.push({missionId:'a',amountAuec:100}),
    s => s.layout.rows++, s => s.activeFleetEntryId='other',
    s => s.missions.push({id:'other',loads:[{id:'other-1',placement:{row:0,col:0,z:0}}]})]) {
    const {c, state} = fixture();
    await c.deliverStopCargoGroup('B', c.buildStopCargoGroups('B')[0].key, {loadIds:['a-0'],confirm:false});
    edit(state);
    const before = copy(state);
    assert.equal(progress.undo(state.stopHistory[0], state), false);
    assert.deepEqual(copy(state), before);
  }
});

test('undo preserves unrelated contracts, ledger entries and history', async () => {
  const {c, state} = fixture();
  await c.deliverStopCargoGroup('B', c.buildStopCargoGroups('B')[0].key, {loadIds:['a-0'],confirm:false});
  const entry = state.stopHistory[0];
  state.missions.push({id:'other',title:'New contract',loads:[]});
  state.ledgerEntries.push({missionId:'other',amountAuec:100});
  state.stopHistory.push({id:'other-event',scu:2});
  assert.equal(progress.undo(entry, state), true);
  assert.equal(state.missions[1].title, 'New contract');
  assert.equal(state.ledgerEntries.length, 1);
  assert.equal(state.stopHistory[0].id, 'other-event');
});

test('concurrent occupancy changes cannot be automatically merged with an undo', async () => {
  const {c, state} = fixture();
  await c.deliverStopCargoGroup('B', c.buildStopCargoGroups('B')[0].key, {loadIds:['a-0'],confirm:false});
  const base=copy(state), local=copy(state), remote=copy(state);
  progress.undo(local.stopHistory[0], local);
  remote.missions.push({id:'other',loads:[{id:'occupied',placement:{row:0,col:0,z:0}}]});
  assert.equal(merge(base,local,remote).ok,false);
  assert.equal(merge(base,remote,local).ok,false);
  assert.equal(merge(base,local,base).ok,true);
});

test('whole-stop delivery delivers only loaded cargo and clears the stale route selection', async () => {
  const {c, state, mission}=fixture();
  state.selectedRunRoutePointKey='delivery';
  assert.equal(await c.completeStop('B',{missionIds:['a'],confirm:false}),true);
  assert.equal(mission.loads.filter(load=>load.deliveredAt).length,2);
  assert.equal(mission.status,'active');
  assert.equal(state.stopHistory[0].scu,16);
  assert.equal(state.selectedRunRoutePointKey,'');
  assert.equal(progress.canUndo(state.stopHistory[0],state),true);
});
