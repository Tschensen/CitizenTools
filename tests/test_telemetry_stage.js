const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../web/scripts/telemetry-domain.js');
const progress = require('../web/scripts/delivery-progress.js');
const copy = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const c = {console, Date, Map, Set, TelemetryDomain:D, DeliveryProgress:progress,
    cloneData:copy, sanitizeState:copy, soloCleanState:copy,
    state:{activeFleetEntryId:'ship', currentLocation:'A', selectedRunRoutePointKey:'old',
      fleet:[{id:'ship'}],layout:{rows:4,cols:4},ledgerEntries:[],stopHistory:[],runCompletedRoutePoints:[],
      missions:[{id:'m',title:'Cargo',type:'cargo',status:'active',assignedFleetEntryId:'ship',
        segments:[{id:'s',pickup:'A',dropoff:'B'},{id:'other',pickup:'A',dropoff:'C'}],
        loads:[{id:'one',segmentId:'s',scu:8,placement:{row:0}}, {id:'two',segmentId:'other',scu:8,placement:{row:2}}]}]},
    lastUnloadPlan:{existing:true}, createRuntimeId:()=>'history', t:key=>key,
    isCargoMission:mission=>mission.type==='cargo', isLoadDelivered:load=>Boolean(load.deliveredAt),
    getLoadPlacementFleetEntryId:()=> 'ship', getMissionSegments:mission=>mission.segments,
    missionHasPayout:()=>true, getMissionIncomeEntry:()=>null,
    persist:()=>{throw Error('Staging must not save');}, render:()=>{throw Error('Staging must not render');},
    consumeRunRoutePriority:()=>{}, buildRunRouteState:()=>({openPoints:[{key:'B',dropoff:'B',hasCargo:true}]}),
    getAllLoads:()=>c.state.missions.flatMap(mission=>mission.loads.map(load=>({mission,load}))),
    getPlacedLoadEntries:()=>c.getAllLoads().filter(({load})=>load.placement),
    getLoadDropoff:(load,mission)=>mission.segments.find(s=>s.id===load.segmentId).dropoff,
    getAutoloadSettings:()=>({}), isLoadPlacementInCurrentLayout:load=>Boolean(load.placement),
    getRunPickupTaskCompletionKey:(mission,segment)=>`pickup:${mission.id}:${segment.id}`,
  };
  vm.createContext(c);
  for (const file of ['route-run-ui.js','delivery-workflow-ui.js','telemetry-stage.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../web/scripts/'+file),'utf8'),c);
  }
  c.getPlacedLoadEntries=()=>c.getAllLoads().filter(({load})=>load.placement);
  return c;
}
const event = {id:'event',at:'2026-10-31T12:00:00Z'};
test('arrival selects the stop without delivering cargo or mutating live state', () => {
  const c=fixture(), before=copy(c.state), original=c.state;
  const staged=c.stageTelemetryEvent(event,{action:'location',value:'B'},{logAutoRoute:true});
  assert.equal(staged.state.currentLocation,'B');
  assert.equal(staged.state.selectedRunRoutePointKey,'B');
  assert.equal(staged.state.missions[0].loads[0].deliveredAt,undefined);
  assert.deepEqual(c.state,before); assert.equal(c.state,original);
});
test('confirmed full completion uses existing delivery logic and does not book income', () => {
  const c=fixture(), before=copy(c.state);
  const staged=c.stageTelemetryEvent(event,{action:'complete',missionId:'m'},{});
  assert.equal(staged.state.missions[0].status,'completed');
  assert.ok(staged.state.missions[0].loads.every(load=>load.deliveredAt===event.at && !load.placement));
  assert.equal(staged.state.stopHistory[0].scu,16);
  assert.deepEqual(staged.state.ledgerEntries,[]);
  assert.deepEqual(c.state,before);
});
test('bound cargo delivery affects only its segment and can be undone', () => {
  const c=fixture(), before=copy(c.state);
  const staged=c.stageTelemetryEvent(event,{action:'cargo',missionId:'m',targetId:'s',kind:'dropoff'},{});
  assert.equal(staged.state.missions[0].loads[0].deliveredAt,event.at);
  assert.ok(staged.state.missions[0].loads[1].placement);
  assert.equal(staged.state.missions[0].status,'active');
  assert.ok(progress.undo(staged.state.stopHistory[0],staged.state));
  assert.deepEqual(staged.state.missions,before.missions);
  assert.deepEqual(c.state,before);
});
test('a partially fitting pickup rolls back every staged placement and keeps the event pending', () => {
  const c=fixture(); c.state.missions[0].loads.forEach(load=>{load.placement=null;load.segmentId='s';});
  const before=copy(c.state);
  c.autoLoadEntries=(entries,options)=>{
    assert.equal(options.recordUndo,false); assert.equal(options.persistAfter,false);
    entries[0].load.placement={row:0}; c.lastUnloadPlan=null;
  };
  assert.equal(c.stageTelemetryEvent(event,{action:'cargo',missionId:'m',targetId:'s',kind:'pickup'},{}),null);
  assert.deepEqual(c.state,before); assert.deepEqual(c.lastUnloadPlan,{existing:true});
  c.autoLoadEntries=entries=>entries.forEach(({load})=>load.placement={row:0});
  const staged=c.stageTelemetryEvent(event,{action:'cargo',missionId:'m',targetId:'s',kind:'pickup'},{});
  assert.deepEqual(staged.state.runCompletedRoutePoints,['pickup:m:s']);
  assert.deepEqual(c.state,before);
});
test('balance snapshot leaves all accounting entries intact', () => {
  const c=fixture();c.state.ledgerEntries=[{id:'income',amountAuec:50,flow:'income'}];
  const staged=c.stageTelemetryEvent({...event,amount:500},{action:'balance'},{});
  assert.equal(staged.state.telemetryBalance.amount,500);
  assert.deepEqual(staged.state.ledgerEntries,c.state.ledgerEntries);
  assert.equal(c.state.telemetryBalance,undefined);
});

test('ship staging applies the existing grid synchronously and restores state on failure', () => {
  const c=fixture(), definition={rows:6,cols:4,defaultHeight:4,overloadMode:false};
  c.currentActiveFleetEntry=()=>({id:c.state.activeFleetEntryId,shipId:'profile'});
  c.currentActiveShipProfile=()=>({id:'profile'}); c.hasShipCargoGrid=()=>true;
  c.getShipGridDefinition=()=>definition; c.doesLayoutMatchDefinition=()=>false;
  c.applyLayoutDefinition=(layout,id)=>{c.state.layout={...layout,fleetEntryId:id};};
  c.pruneInvalidPlacements=value=>value;
  vm.runInContext(fs.readFileSync(require.resolve('../web/scripts/cargo-layout-ui.js'),'utf8'),c);
  const before=copy(c.state);
  const staged=c.stageTelemetryEvent(event,{action:'ship',fleetId:'next'},{});
  assert.equal(staged.state.layout.fleetEntryId,'next'); assert.equal(staged.state.layout.rows,6);
  assert.deepEqual(c.state,before);
  c.pruneInvalidPlacements=()=>{throw Error('invalid grid');};
  assert.throws(()=>c.stageTelemetryEvent(event,{action:'ship',fleetId:'next'},{}),/invalid grid/);
  assert.deepEqual(c.state,before);
});
