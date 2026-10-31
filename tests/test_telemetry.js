const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../web/scripts/telemetry-domain.js');
const at = '2026-10-31T12:00:00Z', now = Date.parse(at);
const settings = {logEnabled:true,logAutoShip:true,logAutoLocation:true,logAutoRoute:true,logAutoComplete:true,balanceOcrEnabled:true};
const locations = [{name:'Orison'}, {name:'Bountiful Harvest',aliases:['Stanton2b_IndyFarmer_BountifulHarvest']}];
function fixture() { return {fleet:[{id:'fleet',shipId:'hermes',status:'active',manufacturer:'RSI',model:'Hermes'}],missions:[{id:'m',status:'active',type:'courier',serviceDetails:{packages:[{id:'p',pickup:'Orison',destination:'Bountiful Harvest'}]}}],telemetryLinks:{missions:{game:'m'}}}; }
const plan = (event, state=fixture(), flags=settings, live=true) => D.plan({at,...event}, state, flags, locations, live, now);

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
  assert.equal(plan(event,state).reason,'ship');
  assert.equal(plan({...event,owner:'Other'}).reason,'ship');
});
test('locations use unique exact names or aliases, never a fuzzy substring', () => {
  assert.equal(plan({kind:'location',value:'Stanton2_Orison'}).value,'Orison');
  assert.equal(plan({kind:'location',value:'Stanton2b_IndyFarmer_BountifulHarvest'}).value,'Bountiful Harvest');
  assert.equal(plan({kind:'location',value:'station_orison_unknown'}).reason,'location');
  assert.equal(plan({kind:'location',value:''}).value,'');
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
