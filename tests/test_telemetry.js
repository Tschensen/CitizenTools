const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../web/scripts/telemetry-domain.js');
const at = '2026-10-31T12:00:00Z', now = Date.parse(at);
const settings = {logEnabled:true,logAutoShip:true,logAutoLocation:true,logAutoRoute:true,logAutoComplete:true,balanceOcrEnabled:true};
const locations = [{name:'Orison'}, {name:'Bountiful Harvest',aliases:['Stanton2b_IndyFarmer_BountifulHarvest']}];
function fixture() { return {fleet:[{id:'fleet',shipId:'hermes',status:'active',manufacturer:'RSI',model:'Hermes'}],missions:[{id:'m',status:'active',type:'courier',serviceDetails:{packages:[{id:'p',pickup:'Orison',destination:'Bountiful Harvest'}]}}],telemetryLinks:{missions:{game:'m'}}}; }
const plan = (event, state=fixture(), flags=settings, live=true) => D.plan({at,...event}, state, flags, locations, live, now);

test('failure requires an explicit game-ID link, survives age and does not depend on completion automation', () => {
  const state = fixture(), failed = {id:'failed:game', kind:'failed', missionId:'game', at:'2026-10-11T12:00:00Z', player:'Pilot'};
  const flags = {...settings, pilotName:'Pilot', logAutoComplete:false, logAutoPayment:false};
  assert.deepEqual(plan(failed,state,flags,false), {action:'failed',missionId:'m'});
  assert.equal(plan({...failed,missionId:'same-title-other-id'},state,flags).reason,'mission');
  assert.equal(plan({...failed,player:'Other'},state,flags).reason,'player');
  assert.equal(plan(failed,state,{...flags,logEnabled:false}).reason,'offline');
  for (const status of ['blocked','overridden']) {
    state.missions[0].logFailure = {id:failed.id,status};
    assert.equal(plan(failed,state,flags).action,'discard');
  }
});

test('blocked contracts cannot be completed, delivered or paid automatically until overridden', () => {
  const state=fixture(), flags={...settings,logAutoPayment:true};
  state.missions[0].status='completed';
  state.missions[0].logFailure={id:'failed',status:'blocked'};
  const events=[{kind:'completed'}, {kind:'objective',objectiveId:'dropoff_0'},
    {kind:'payment',amount:500,match:'adjacent_notifications',completedAt:at}];
  for (const event of events) assert.equal(plan({...event,missionId:'game'},state,flags).reason,'mission_failed');
  state.missions[0].logFailure.status='overridden';
  assert.equal(plan({...events[2],missionId:'game'},state,flags).action,'payment');
});

test('payment needs an enabled option, linked completed contract and confirmed actual amount', () => {
  const state=fixture(); Object.assign(state.missions[0], {status:'completed', payout:50250});
  const event={id:'payment:game:',kind:'payment',missionId:'game',amount:50250,completedAt:at,match:'adjacent_notifications'};
  const flags={...settings,logAutoPayment:true};
  assert.equal(plan(event,state).reason,'disabled');
  assert.deepEqual(plan(event,state,flags,false),{action:'payment',missionId:'m',amount:50250});
  assert.equal(plan({...event,missionId:'other'},state,flags).reason,'mission');
  for (const amount of [50000,16750,60000]) {
    assert.deepEqual(plan({...event,amount},state,flags),{action:'payment',missionId:'m',amount});
  }
  state.missions[0].status='active';
  assert.equal(plan(event,state,flags).reason,'payment_completion');
  state.missions[0].status='completed';
  for (const invalid of [{amount:0},{amount:-1},{amount:50250.5},{amount:1e12},{match:'guess'},
    {completedAt:'invalid'},{completedAt:'2026-10-31T11:59:57Z'},{completedAt:'2026-10-31T12:00:01Z'}]) {
    assert.equal(plan({...event,...invalid},state,flags).reason,'invalid');
  }
  for (const status of ['paid','cancelled']) {
    state.missions[0].status=status;
    assert.equal(plan(event,state,flags).reason,'already_paid');
  }
  state.missions[0].status='completed'; state.missions[0].paidAt=at;
  assert.equal(plan(event,state,flags).reason,'already_paid');
  delete state.missions[0].paidAt;
  for (const entry of [{missionId:'m',flow:'income',amountAuec:1}, {telemetryEventId:event.id}]) {
    state.ledgerEntries=[entry];
    assert.equal(plan(event,state,flags).reason,'already_paid');
  }
});

test('queued observations from another session or player cannot affect the current session', () => {
  const context={session:'new',player:'Pilot'};
  assert.equal(D.plan({at,kind:'location',value:'Orison',session:'old',player:'Pilot'},fixture(),settings,locations,true,now,context).reason,'session');
  assert.equal(D.plan({at,kind:'completed',missionId:'game',player:'Other'},fixture(),settings,locations,true,now,context).reason,'player');
  assert.equal(D.plan({at,kind:'ship',name:'RSI Hermes',owner:'Pilot'},fixture(),settings,locations,true,now,{ship:null}).reason,'superseded');
  assert.equal(D.plan({at,kind:'location',value:'Orison'},fixture(),settings,locations,true,now,{location:''}).reason,'superseded');
});

test('exact ship selection rejects ambiguity and ships owned by someone else', () => {
  const event = {kind:'ship',name:'RSI Hermes',player:'Pilot',owner:'Pilot'};
  assert.equal(plan(event).fleetId,'fleet');
  const state=fixture(); state.fleet.push({...state.fleet[0],id:'other'});
  assert.equal(plan(event,state).reason,'ship_instance');
  assert.equal(plan({...event,owner:'Other'}).reason,'ship_owner');
});
test('locations use unique exact names or aliases, never a fuzzy substring', () => {
  assert.equal(plan({kind:'location',value:'Stanton2_Orison'}).value,'Orison');
  assert.equal(plan({kind:'location',value:'Stanton2b_IndyFarmer_BountifulHarvest'}).value,'Bountiful Harvest');
  assert.equal(plan({kind:'location',value:'station_orison_unknown'}).reason,'location');
  assert.equal(plan({kind:'location',value:''}).value,'');
});
test('Seraphim inventory code resolves to an existing station and respects user mappings', () => {
  const places = [{name:'Orison'}, {name:'Seraphim Station'}];
  assert.equal(D.resolveLocation('RR_CRU_LEO', places), 'Seraphim Station');
  assert.equal(D.resolveLocation('RR_CRU_LEO', [{name:'Seraphim',aliases:['Seraphim Station']}]), 'Seraphim');
  assert.equal(D.resolveLocation('RR_CRU_LEO', places, {RR_CRU_LEO:'Custom station'}), 'Custom station');
  assert.equal(D.resolveLocation('RR_CRU_LEO', [...places, {name:'Custom station',aliases:['RR_CRU_LEO']}]), 'Custom station');
  assert.equal(D.resolveLocation('RR_CRU_LEO', [{name:'Orison'}]), null);
  assert.equal(D.resolveLocation('RR_CRU_LEO', [{name:'First',aliases:['Seraphim Station']}, {name:'Second',aliases:['Seraphim Station']}]), null);
  assert.equal(D.resolveLocation('RR_CRU_LEO_unknown', places), null);
  const event = {at,kind:'location',value:'RR_CRU_LEO'};
  assert.deepEqual(D.plan(event,fixture(),settings,places,true,now,{location:'RR_CRU_LEO'}), {action:'location',value:'Seraphim Station'});
});

test('imported exact log identifiers take precedence over a matching system suffix', () => {
  const places = [{name:'Pyro'}, {name:'Nyx - Pyro Jump Point',aliases:['Nyx_JumpPoint_Pyro']}];
  assert.equal(D.resolveLocation('Nyx_JumpPoint_Pyro', places), 'Nyx - Pyro Jump Point');
  assert.equal(D.resolveLocation('Nyx_JumpPoint_Pyro', places, {Nyx_JumpPoint_Pyro:'Custom'}), 'Custom');
  assert.equal(D.resolveLocation('Nyx_JumpPoint_Pyro', [...places,
    {name:'Ambiguous',aliases:['Nyx_JumpPoint_Pyro']}]), null);
});
test('mission title alone cannot complete a contract, linked IDs can', () => {
  assert.equal(plan({kind:'completed',missionId:'other',title:'same title'}).reason,'mission');
  assert.equal(plan({kind:'completed',missionId:'game'}).action,'complete');
  assert.equal(plan({kind:'completed',missionId:'game'},fixture(),settings,false).action,'complete','final completion survives disconnect');
});
test('pickup/dropoff only affect one uniquely identified package, phase does nothing', () => {
  const event={kind:'objective',missionId:'game',objectiveId:'pickup_box_0',location:'Stanton2_Orison'};
  assert.equal(plan(event).targetId,'p');
  const state=fixture(); state.missions[0].serviceDetails.packages.push({...state.missions[0].serviceDetails.packages[0],id:'p2'});
  assert.equal(plan(event,state).reason,'objective');
  assert.equal(plan({...event,objectiveId:'phase_box'}).action,'discard');
});
test('cargo objectives require an explicit whole-line binding; no inferred full delivery', () => {
  const state=fixture(); state.missions[0]={id:'m',status:'active',type:'cargo',segments:[{id:'s',pickup:'Orison',dropoff:'Bountiful Harvest'}]};
  const event={kind:'objective',missionId:'game',objectiveId:'dropoff_x_0',location:'Bountiful Harvest'};
  assert.equal(plan(event,state).reason,'objective');
  state.telemetryLinks.objectives={'game:dropoff_x_0':'s'};
  assert.equal(plan(event,state).targetId,'s');
});
test('stale and future events cannot change state and offline locations wait', () => {
  for (const age of [-6000, 901000]) assert.equal(D.plan({at:new Date(now-age).toISOString(),kind:'completed',missionId:'game'},fixture(),settings,locations,true,now).action,'discard');
  assert.equal(plan({kind:'location',value:'Orison'},fixture(),settings,false).reason,'offline');
  assert.equal(plan({kind:'completed',missionId:'game'},fixture(),{...settings,logAutoComplete:false}).reason,'disabled');
});
test('balance only accepts valid newer snapshots and never returns a ledger mutation', () => {
  const state=fixture(); state.telemetryBalance={amount:20,at};
  assert.equal(plan({kind:'balance',amount:100},state).action,'discard');
  assert.equal(plan({kind:'balance',amount:0}).action,'balance');
  assert.equal(plan({kind:'balance',amount:NaN}).action,'discard');
  assert.equal(D.balance({amount:-1,at}),null);
});

test('unmapped locations clear the old station once, remain linkable, and allow a manual route location', () => {
  const state=fixture(), event={id:'new-place',kind:'location',value:'UnknownCode',at};state.currentLocation='Orison';
  assert.equal(plan(event,state).action,'location_unresolved');
  state.telemetryLocation=D.locationObservation({...event,raw:event.value,value:''});
  state.currentLocation='Manual route start';
  assert.equal(plan(event,state).reason,'location');
  state.telemetryLinks.locations={'UnknownCode':'Bountiful Harvest'};
  assert.deepEqual(plan(event,state),{action:'location',value:'Bountiful Harvest'});
  assert.deepEqual(plan({...event,value:''},state),{action:'location',value:''});
});

test('location labels distinguish confirmed, last known, manually selected and unknown locations', () => {
  const state=fixture();state.currentLocation='Orison';
  state.telemetryLocation=D.locationObservation({id:'place',at,raw:'Stanton2_Orison',value:'Orison',session:'session'});
  const context={enabled:true,live:true,location:'Stanton2_Orison',lastLocation:'Stanton2_Orison',session:'session'};
  assert.equal(D.locationStatus(state,context,locations).kind,'confirmed');
  assert.equal(D.locationStatus(state,{...context,live:false},locations).kind,'stale');
  assert.equal(D.locationStatus(state,{...context,location:''},locations).kind,'stale');
  state.currentLocation='Manual';assert.equal(D.locationStatus(state,context,locations).kind,'selected');
  state.currentLocation='';assert.deepEqual(D.locationStatus(state,{...context,location:''},locations),{kind:'unknown',previous:'Orison',offline:false});
});

test('space and travel stay separate from route locations and respect manual selection and disabled detection', () => {
  const state=fixture(); state.currentLocation='';
  const context={enabled:true,live:true,location:'',lastLocation:'Stanton2_Orison',session:'current',
    locationContext:{kind:'space',system:'Stanton',near:'CRU-L4',destination:'RR_CRU_L1',at}};
  const status=D.locationStatus(state,context,locations);
  assert.equal(status.kind,'space'); assert.equal(status.previous,'Orison');
  assert.equal(status.destination,'CRU-L1 Ambitious Dream Station');
  const event={id:'space',kind:'location',at,value:'',locationContext:context.locationContext};
  assert.deepEqual(D.plan(event,state,settings,locations,true,now,context),{action:'location',value:''});
  assert.equal(D.locationStatus(state,{...context,locationContext:{kind:'travel'}},locations).kind,'travel');
  state.currentLocation='Manually chosen start';
  assert.equal(D.locationStatus(state,context,locations).kind,'selected');
  state.currentLocation='';
  for (const change of [{enabled:false},{live:false},{settings:{logAutoLocation:false}}]) {
    assert.equal(D.locationStatus(state,{...context,...change},locations).kind,'unknown');
  }
});

test('planet regions resolve against existing locations without creating an arrival at a city', () => {
  const state=fixture(), places=[...locations,{name:'Crusader',aliases:['Stanton2'],type:'planet',starSystem:'Stanton'}];
  const event={id:'body',kind:'location',at,value:'Crusader',session:'current',locationContext:{kind:'body',system:'Stanton',at}};
  assert.deepEqual(D.plan(event,state,settings,places,true,now),{action:'location',value:'Crusader'});
  state.currentLocation='Crusader';
  state.telemetryLocation=D.locationObservation({...event,raw:'Crusader'});
  const context={enabled:true,live:true,location:'Crusader',session:'current',locationContext:event.locationContext};
  assert.deepEqual(D.locationStatus(state,context,places),{kind:'confirmed',scope:'body'});
  // A region absent from the user's database is still readable, but does not
  // invent a route location or duplicate the catalog.
  state.currentLocation=''; state.telemetryLocation=null;
  assert.deepEqual(D.plan(event,state,settings,locations,true,now),{action:'location_unresolved',value:''});
  assert.equal(D.locationStatus(state,context,locations).name,'Crusader');
});

test('newer empty location observations supersede older space and travel observations', () => {
  const event={id:'old-space',kind:'location',at,value:'',locationContext:{kind:'space',at:'2026-10-31T11:59:50Z'}};
  assert.equal(D.plan(event,fixture(),settings,locations,true,now,
    {location:'',locationContext:{kind:'travel',at}}).reason,'superseded');
});
