const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../web/scripts/fleet-log.js');
const D = require('../web/scripts/telemetry-domain.js');
const at = '2026-11-05T12:00:00Z';
const event = {id:'loss:123',kind:'ship',at,name:'Origin 400i',owner:'Pilot',player:'Pilot',channel:'LIVE',entityId:'123',className:'ORIG_400i'};
const entry = {id:'mine',status:'active',shipId:'400i',manufacturer:'Origin Jumpworks',model:'400i',acquiredOn:'2026-01-01',endedOn:''};
const state = () => ({fleet:[structuredClone(entry)],shipLibrary:[{id:'400i',manufacturer:'Origin Jumpworks',model:'400i'}],missions:[{id:'cargo',loads:[{id:'box',placement:{row:1}}]}],ledgerEntries:[{id:'cost',amountAuec:20}],activeFleetEntryId:'mine'});
test('owner names are required and cannot be bypassed by a saved model link', () => {
  const s=state();
  for (const values of [{owner:'Other'},{owner:''},{player:''},{owner:'Pi-lot'}]) {
    assert.equal(F.shipPlan({...event,...values},s,{logAutoFleet:true},'Pilot',{'Origin 400i|Other':'mine'}).reason,'ship_owner');
  }
  assert.equal(F.shipPlan(event,s,{},'Pilot').fleetId,'mine');
  s.fleet[0].ownerName='Other';
  assert.equal(F.candidates(event,s).length,0);
});
test('two identical own ships require an instance mapping; a new ID never silently replaces a known one', () => {
  const s=state(); s.fleet.push({...entry,id:'second'});
  assert.equal(F.shipPlan(event,s,{},'Pilot').reason,'ship_instance');
  s.fleet[1].logIdentity=F.identity(event);
  assert.equal(F.shipPlan(event,s,{},'Pilot').fleetId,'second');
  s.fleet=s.fleet.slice(1);
  const next={...event,entityId:'456'};
  assert.equal(F.shipPlan(next,s,{},'Pilot').reason,'ship_instance');
  assert.equal(F.shipPlan(next,s,{},'Pilot',{[F.bindingKey(next)]:'second'}).reason,'ship_instance');
  assert.equal(F.sameIdentity(event,{...event,channel:'PTU'}),false);
});
test('automatic additions need a verified own instance, exactly one known model and no existing model', () => {
  const s=state();s.fleet=[];
  assert.equal(F.shipPlan(event,s,{logAutoFleet:true},'Pilot').action,'ship_create');
  assert.equal(F.shipPlan(event,s,{logAutoFleet:false},'Pilot').reason,'ship_new');
  assert.equal(F.shipPlan({...event,entityId:''},s,{logAutoFleet:true},'Pilot').reason,'ship_identity');
  s.fleet=[{...entry,status:'destroyed'}];
  assert.equal(F.shipPlan(event,s,{logAutoFleet:true},'Pilot').reason,'ship_new');
  s.shipLibrary.push({...s.shipLibrary[0],id:'duplicate'});
  assert.equal(F.shipPlan(event,s,{logAutoFleet:true},'Pilot').reason,'ship_profile');
  s.shipLibrary=[]; assert.equal(F.shipPlan(event,s,{},'Pilot').reason,'ship_profile');
});
test('loss requires the exact owned instance; unresolved losses remain available beyond the short live inbox', () => {
  const s=state(), loss={...event,kind:'ship_loss',evidence:'fatal_collision'};
  assert.equal(F.lossPlan(loss,s,'Pilot').reason,'ship_loss_link');
  s.fleet[0].logIdentity=F.identity(event);
  assert.deepEqual(F.lossPlan(loss,s,'Pilot'),{action:'ship_loss',fleetId:'mine'});
  assert.equal(F.lossPlan({...loss,entityId:'456'},s,'Pilot').reason,'ship_loss_link');
  assert.equal(F.candidates({...loss,entityId:'456'},s).length,0);
  assert.equal(F.candidates(loss,s).length,1);
  assert.equal(F.lossPlan({...loss,owner:'Other'},s,'Pilot').action,'discard');
  assert.equal(F.lossPlan({...loss,evidence:'player_died'},s,'Pilot').action,'discard');
  assert.equal(D.plan(loss,s,{logEnabled:true},[],false,Date.parse(at)+86400000,{player:'Pilot'}).action,'ship_loss');
});
test('loss confirmation, ignore and restoration preserve cargo, contracts and finances', () => {
  const s=state();s.fleet[0].logIdentity=F.identity(event);
  s.fleet[0].logLoss=F.loss({id:'loss',at,identity:event,status:'pending',evidence:'fatal_collision'});
  const cargo=structuredClone(s.missions), ledger=structuredClone(s.ledgerEntries);
  assert.equal(F.decideLoss(s,'mine','loss','confirm','2026-11-05'),true);
  assert.equal(s.fleet[0].status,'destroyed');assert.equal(s.activeFleetEntryId,'');
  assert.equal(F.decideLoss(s,'mine','loss','confirm','2026-11-05'),false);
  assert.equal(F.decideLoss(s,'mine','loss','restore','2026-11-05'),true);
  assert.equal(s.fleet[0].status,'active');assert.equal(s.activeFleetEntryId,'mine');
  assert.deepEqual(s.missions,cargo);assert.deepEqual(s.ledgerEntries,ledger);
  s.fleet[0].logLoss.status='pending';
  assert.equal(F.decideLoss(s,'mine','loss','dismiss','2026-11-05'),true);
  assert.equal(F.decideLoss(s,'mine','loss','confirm','2026-11-05'),false);
});
test('outdated confirmation cannot destroy a replacement or overwrite a later fleet edit', () => {
  const s=state();s.fleet[0].logIdentity=F.identity({...event,entityId:'456'});
  s.fleet[0].logLoss=F.loss({id:'loss',at,identity:event,status:'pending'});
  assert.equal(F.decideLoss(s,'mine','loss','confirm','2026-11-05'),false);
  s.fleet[0].logIdentity=F.identity(event);s.fleet[0].status='sold';
  assert.equal(F.decideLoss(s,'mine','loss','confirm','2026-11-05'),false);
});

test('replacement choices exclude wrong models, owners, channels, reused instances and existing links', () => {
  const s=state(), source=s.fleet[0];
  Object.assign(source,{status:'destroyed',logIdentity:F.identity(event)});
  const next={...entry,id:'next',logIdentity:F.identity({...event,entityId:'456'})};
  s.fleet.push(next);
  assert.deepEqual(F.replacementCandidates(s,source).map(item=>item.id),['next']);
  for(const changes of [{shipId:'other'},{ownerName:'Other'},{status:'sold'},{replacesFleetEntryId:'elsewhere'},
    {logIdentity:F.identity(event)},{logIdentity:F.identity({...event,entityId:'456',channel:'PTU'})}]) {
    s.fleet[1]={...next,...changes};assert.equal(F.replacementCandidates(s,source).length,0);
  }
  s.fleet[1]=next;
  source.replacesFleetEntryId='next';assert.equal(F.replacementCandidates(s,source).length,0,'no cycles');
  source.replacesFleetEntryId='';
  assert.equal(F.linkReplacement(s,'mine','next'),true);
  s.fleet.push({...entry,id:'third'});
  assert.equal(F.linkReplacement(s,'mine','third'),false,'a stale second choice must not overwrite the first');
});

test('the cockpit shows a visited foreign ship without borrowing the own ship registration or changing fleet selection', () => {
  const s=state();s.fleet[0].registration='MY-400I';s.fleet[0].logIdentity=F.identity(event);
  const before=structuredClone(s);
  const result=F.hubShip({enabled:true,live:true,ship:{...event,owner:'Other',entityId:'456'},
    player:'Pilot',at,settings:{gameChannel:'LIVE'}},s,s.fleet[0],'Pilot');
  assert.equal(result.name,'Origin 400i');assert.equal(result.owner,'Other');assert.equal(result.ownership,'other');
  assert.equal(result.entry,null);assert.equal(result.profile.id,'400i');assert.deepEqual(s,before);
});

test('the cockpit displays the known own instance but does not reuse its registration for an unlinked replacement', () => {
  const s=state();s.fleet[0].registration='MY-400I';s.fleet[0].logIdentity=F.identity(event);
  const context={enabled:true,live:true,ship:event,player:'Pilot',at,settings:{gameChannel:'LIVE'}};
  const result=F.hubShip(context,s,s.fleet[0],'Pilot');
  assert.equal(result.ownership,'own');assert.equal(result.entry.registration,'MY-400I');
  assert.equal(F.hubShip({...context,ship:{...event,entityId:'456'}},s,s.fleet[0],'Pilot').entry,null);
});

test('stale or disabled log observations fall back to the selected fleet ship; an unknown owner is never called own', () => {
  const s=state();s.fleet[0].ownerName='Pilot';
  const context={enabled:true,live:true,ship:{name:'RSI Hermes',owner:'Other'},player:'Pilot',at};
  for (const flags of [{live:false},{enabled:false}]) {
    const result=F.hubShip({...context,...flags},s,s.fleet[0],'Pilot');
    assert.equal(result.name,'Origin Jumpworks 400i');assert.equal(result.ownership,'own');assert.equal(result.live,false);
  }
  assert.equal(F.hubShip({...context,ship:{name:'RSI Hermes'}},s,s.fleet[0],'Pilot').ownership,'unknown');
  assert.equal(F.hubShip({settings:{pilotName:'Pilot'}},s,s.fleet[0],'Profile display name').ownership,'own');
});

test('leaving the ship removes the aboard claim while preserving the selected loading ship and all cargo', () => {
  const s=state(), before=structuredClone(s);
  const result=F.hubShip({enabled:true,live:true,ship:null,shipPresence:'outside',player:'Pilot'},s,s.fleet[0],'Pilot');
  assert.equal(result.live,false);assert.equal(result.presence,'outside');assert.equal(result.entry.id,'mine');
  assert.deepEqual(s,before);
  assert.equal(F.hubShip({enabled:true,live:false,shipPresence:'outside'},s,s.fleet[0],'Pilot').presence,'unknown');
});
