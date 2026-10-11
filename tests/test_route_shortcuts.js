const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = name => fs.readFileSync(require.resolve('../web/scripts/' + name), 'utf8');

function fixture() {
  const calls = [];
  const context = {
    console, Date, Object, missionAutoImportBusy:false,
    document:{querySelector:() => null},
    soloEditing:() => false,
    flushSoloState:async () => {calls.push('save'); return true;},
    confirmRunArrival:() => {calls.push('arrive'); return true;},
    autoLoadRunPickup:() => {calls.push('load'); return true;},
    autoUnloadRunStop:async () => {calls.push('unload'); return true;},
    soloAppReady:true,
    soloSync:{status:{hydrated:true, blocked:false}, refresh:async () => {calls.push('refresh'); return true;}},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source('solo-route-shortcuts.js'), context);
  return {context, calls, run:context.soloRouteShortcuts.run};
}

test('native dispatch refreshes shared state before action and saves afterward', async () => {
  const f = fixture();
  assert.equal(await f.run('unload'), true);
  assert.deepEqual(f.calls, ['save','refresh','unload','save']);
});

test('editing, recording, import, update and uninitialized state cannot execute keys', async () => {
  const changes = [c => c.soloEditing = () => true, c => c.document.querySelector = () => ({}),
    c => c.missionAutoImportBusy = true, c => c.personalTransferBusy = true,
    c => c.soloSync.status.blocked = true, c => c.soloSync.status.hydrated = false,
    c => c.soloAppReady = false];
  for (const change of changes) {
    const f = fixture(); change(f.context);
    assert.equal(await f.run('arrive'), false);
    assert.deepEqual(f.calls, []);
  }
});

test('offline refresh or failed saves do not execute a route action', async () => {
  for (const member of ['flushSoloState','refresh']) {
    const f = fixture();
    if (member === 'refresh') f.context.soloSync.refresh = async () => false;
    else f.context.flushSoloState = async () => false;
    assert.equal(await f.run('load'), false);
    assert.ok(!f.calls.includes('load'));
  }
});

test('overlapping key presses are dropped and the lock is released after exceptions', async () => {
  const f = fixture();
  let release;
  f.context.flushSoloState = () => new Promise(resolve => {release = resolve;});
  const first = f.run('arrive');
  assert.equal(await f.run('load'), false);
  release(false);
  assert.equal(await first, false);
  f.context.flushSoloState = async () => true;
  assert.equal(await f.run('load'), true);
});

test('home uses the saved location and rejects unknown actions', async () => {
  const f = fixture();
  f.context.returnRunHome = location => {f.calls.push(location); return true;};
  f.context.soloRouteShortcuts.setHomeLocation(' Orison ');
  assert.equal(await f.run('home'),true);
  assert.ok(f.calls.includes('Orison'));
  const before = f.calls.length;
  assert.equal(await f.run('unknown'),false);
  assert.equal(f.calls.length,before);
});

test('late requests and a dialog opened during synchronization are discarded', async () => {
  for (const change of [c => c.Date = {now:() => 3000}, c => c.soloEditing = () => true]) {
    const f = fixture(); f.context.Date = {now:() => 0};
    f.context.soloSync.refresh = async () => {change(f.context); return true;};
    assert.equal(await f.run('arrive'), false);
    assert.ok(!f.calls.includes('arrive'));
  }
});

test('route actions enforce arrival, cargo readiness and mission scope without reading hidden buttons', async () => {
  const calls = [];
  let route = {arrived:false, selectedPoint:{dropoff:'B',hasCargo:true,missionIds:['own','other']}, eligibleMissionIds:new Set(['own'])};
  let status = 'ready';
  const context = {buildRunRouteState:() => route, currentActiveFleetEntry:() => ({}),
    buildUnloadStops:({missionFilter}) => {
      assert.equal(missionFilter({id:'own'}),true);
      assert.equal(missionFilter({id:'other'}),false);
      return [{dropoff:'B',placeableCount:2,analysis:{status}}];
    },
    completeStop:async (location,options) => {calls.push({location,...options}); return true;},
  };
  vm.createContext(context); vm.runInContext(source('run-mode-ui.js'),context);
  assert.equal(await context.autoUnloadRunStop(),false);
  route.arrived = true; status = 'blocked';
  assert.equal(await context.autoUnloadRunStop(),false);
  status = 'ready';
  assert.equal(await context.autoUnloadRunStop(),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].confirm,false);
  assert.deepEqual(Array.from(calls[0].missionIds),['own']);
  route.selectedPoint.hasCargo = false;
  assert.equal(await context.autoUnloadRunStop(),false);
});

test('home detour preserves cargo, manual order and selection, including arrival and ship switching', () => {
  const context = {
    state:{activeFleetEntryId:'ship', currentLocation:'Area18', selectedRunRoutePointKey:'delivery:b',
      missions:[{id:'a',loads:[{placement:{slotId:'one'}}]}], runRouteOrder:{ship:['pickup:a','delivery:b']},
      runHomeDestinations:{}},
    currentActiveFleetEntry:() => ({id:context.state.activeFleetEntryId}),
    normalizeRunRouteLocation:value => String(value || '').toLowerCase(),
    persist:() => {}, render:() => {},
    selectStopByDropoff:() => {throw Error('A home stop must not select cargo');},
    buildRunRouteState:() => ({selectedPoint:{key:'home:ship',dropoff:'Orison',isHome:true},openPoints:[{}],arrived:false}),
  };
  vm.createContext(context);
  vm.runInContext(source('run-route-state.js'),context);
  vm.runInContext(source('run-mode-ui.js'),context);
  context.buildRunRouteState = () => ({selectedPoint:{key:'home:ship',dropoff:'Orison',isHome:true},openPoints:[{}],arrived:false});
  const original = JSON.stringify({missions:context.state.missions,order:context.state.runRouteOrder});
  assert.equal(context.returnRunHome(''),false);
  assert.equal(context.returnRunHome('Area18'),false);
  assert.equal(context.returnRunHome('Orison'),true);
  assert.equal(context.returnRunHome('Orison'),false);
  context.state.activeFleetEntryId = 'other';
  assert.equal(context.state.runHomeDestinations.other,undefined);
  context.state.activeFleetEntryId = 'ship';
  assert.equal(context.confirmRunArrival(),true);
  assert.equal(context.state.currentLocation,'Orison');
  assert.equal(context.state.runHomeDestinations.ship,'');
  assert.equal(context.state.selectedRunRoutePointKey,'delivery:b');
  assert.equal(JSON.stringify({missions:context.state.missions,order:context.state.runRouteOrder}),original);
});

test('pickup shortcut never skips missing quantities or unplaced cargo', async () => {
  const route = {arrived:true, selectedPoint:{hasPickup:true,key:'pickup',pickupTaskKeys:['pickup:a']},
    pendingPickupSegments:[{}], pickupEntries:[{},{}],placedPickupEntries:[]};
  const context = {state:{runCompletedRoutePoints:[]},buildRunRouteState:() => route,
    persist:() => {},render:() => {},showMissionConfirmDialog:() => {throw Error('No background dialog');}};
  vm.createContext(context); vm.runInContext(source('run-mode-ui.js'),context);
  assert.equal(await context.completeRunPickup({allowIncomplete:false}),false);
  route.pendingPickupSegments = [];
  assert.equal(await context.completeRunPickup({allowIncomplete:false}),false);
  route.placedPickupEntries = [{},{}];
  assert.equal(await context.completeRunPickup({allowIncomplete:false}),true);
  assert.deepEqual(Array.from(context.state.runCompletedRoutePoints),['pickup:a']);
});
