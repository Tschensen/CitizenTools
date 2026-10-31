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

function paymentFixture() {
  const c=fixture(); c.window={CalendarDate:require('../web/scripts/calendar-date.js')};
  for (const file of ['finance.js','ledger-automation.js']) {
    vm.runInContext(fs.readFileSync(require.resolve('../web/scripts/'+file),'utf8'),c);
  }
  c.createMissionIncomeForCompletedMission=c.window.LedgerAutomation.createMissionIncomeForCompletedMission;
  Object.assign(c,{createLedgerEntry:c.window.FinanceModule.createLedgerEntry, formatDateForInput:at=>at.slice(0,10),normalizeMissionType:type=>type,
    getMissionTypeLabel:()=> 'Fracht',cargoLocale:()=> 'de-DE',
    cargoText:(_key,fallback,params={})=>fallback.replace(/\{(\w+)\}/g,(_,key)=>String(params[key]))});
  c.getMissionIncomeEntry=mission=>c.state.ledgerEntries.find(entry=>entry.missionId===mission.id && entry.flow==='income' && entry.amountAuec>0);
  Object.assign(c.state.missions[0],{status:'completed',payout:50250,completedAt:'2026-10-31T11:59:59.950Z'});
  return c;
}

test('payment stages exactly one real ledger entry and paid status without changing live state or cargo', () => {
  const c=paymentFixture();
  const before=copy(c.state), original=c.state, payment={...event,kind:'payment',amount:50250};
  const staged=c.stageTelemetryEvent(payment,{action:'payment',missionId:'m'},{});
  assert.equal(staged.state.missions[0].status,'paid');
  assert.equal(staged.state.missions[0].paidAt,event.at);
  assert.equal(staged.state.missions[0].completedAt,before.missions[0].completedAt);
  assert.deepEqual(staged.state.missions[0].loads,before.missions[0].loads);
  assert.equal(staged.state.ledgerEntries.length,1);
  const income=staged.state.ledgerEntries[0];
  assert.equal(income.amountAuec,50250); assert.equal(income.missionId,'m');
  assert.equal(income.category,'Auftragserlös'); assert.equal(income.fleetEntryId,'ship');
  assert.equal(income.telemetryEventId,event.id); assert.equal(income.createdAt,event.at);
  assert.equal(income.notes,'Auszahlung aus Game.log bestätigt.');
  assert.deepEqual(Array.from(staged.telemetryIds),[event.id]);
  assert.deepEqual(c.state,before); assert.equal(c.state,original);
  for (const amount of [0,-1,50250.5,1e12]) {
    assert.equal(c.stageTelemetryEvent({...payment,amount},{action:'payment',missionId:'m'},{}),null);
  }
  assert.deepEqual(c.state,before);
  c.state=staged.state;
  assert.equal(c.stageTelemetryEvent(payment,{action:'payment',missionId:'m'},{}),null);
  c.state.missions[0].status='completed'; delete c.state.missions[0].paidAt;
  assert.equal(c.stageTelemetryEvent(payment,{action:'payment',missionId:'m'},{}),null);
  assert.equal(c.state.ledgerEntries.length,1);
});

test('reduced rewards, group shares and bonuses book the receipt without rewriting planned rewards or splits', () => {
  for (const amount of [45000,16750,60000]) {
    const c=paymentFixture();
    Object.assign(c.state.missions[0],{
      participants:[{pilotId:'pilot-1'},{pilotId:'pilot-2'},{pilotId:'pilot-3'}],
      payoutSplit:{mode:'amount',items:[{pilotId:'pilot-1',amountAuec:16750},{pilotId:'pilot-2',amountAuec:16750},{pilotId:'pilot-3',amountAuec:16750}]},
    });
    const before=copy(c.state), payment={...event,kind:'payment',amount};
    const staged=c.stageTelemetryEvent(payment,{action:'payment',missionId:'m'},{});
    assert.equal(staged.state.ledgerEntries.length,1);
    assert.equal(staged.state.ledgerEntries[0].amountAuec,amount);
    assert.equal(staged.state.ledgerEntries[0].notes,'Auszahlung aus Game.log bestätigt. Ursprünglicher Auftragserlös: 50.250 aUEC.');
    assert.equal(staged.state.missions[0].payout,50250);
    assert.equal(staged.state.missions[0].status,'paid');
    assert.deepEqual(staged.state.missions[0].payoutSplit,before.missions[0].payoutSplit);
    assert.deepEqual(staged.state.missions[0].participants,before.missions[0].participants);
    assert.deepEqual(c.state,before);
    c.state=staged.state;
    assert.equal(c.stageTelemetryEvent(payment,{action:'payment',missionId:'m'},{}),null);
  }
});

test('manual payments still use the planned reward and contract edits preserve actual log receipts', () => {
  const c=paymentFixture();
  c.markMissionPaid(c.state.missions[0],{paidAt:event.at});
  assert.equal(c.state.ledgerEntries[0].amountAuec,50250);
  assert.equal(c.state.ledgerEntries[0].telemetryEventId,undefined);
  const actual=paymentFixture();
  actual.state=actual.stageTelemetryEvent({...event,kind:'payment',amount:16750},{action:'payment',missionId:'m'},{}).state;
  for (const context of [c,actual]) {
    Object.assign(context,{window:{},getDistinctActiveMissionColor:color=>color,getMissionPayout:mission=>mission.payout});
    vm.runInContext(fs.readFileSync(require.resolve('../web/scripts/mission-actions.js'),'utf8'),context);
    context.saveMissionEntry({...context.state.missions[0],title:'Edited contract',payout:60000});
    assert.equal(context.state.ledgerEntries[0].reference,'Edited contract');
  }
  assert.equal(c.state.ledgerEntries[0].amountAuec,60000);
  assert.equal(actual.state.ledgerEntries[0].amountAuec,16750);
  assert.equal(actual.state.ledgerEntries[0].telemetryEventId,event.id);
});
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
