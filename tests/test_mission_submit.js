const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../web/scripts/mission-submit-ui.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const packageItem={id:'package',name:'Parcel',pickup:'Area18',destination:'Lorville',containerScu:8};
function fixture(type,existing=null) {
  const fields=new Map(Object.entries({missionType:type,title:' New title ',notes:' Note ',payout:'12500.4',maxContainerScu:'8'}));
  for(const prefix of ['cargo','courier','delivery','refuel','investigation','salvage','procurement','mining','misc']) {
    fields.set(prefix+'Customer',' Customer ');fields.set(prefix+'Location',' Lorville ');
  }
  fields.set('refuelHydrogenAmount','100');fields.set('miningTargetAmount','16');fields.set('miningMethod','hand');
  const saves=[],notices=[],effects=[];
  const c=vm.createContext({
    state:{missions:existing?[existing]:[],selectedLoadId:'old'},DEFAULT_COLOR:'#fff',activeMissionImportQuality:{payout:'verified'},
    missionForm:{elements:{assignedFleetEntryId:{value:existing?'assigned-ship':''}}},
    missionValidationOverride:{checked:false},lastCargoPage:'create',activePage:'create',lastUnloadPlan:{},
    FormData:class {get(name){return fields.get(name) ?? null;}},
    normalizeMissionMaxContainerScu:Number,normalizeMissionType:value=>value,
    getMissionEditId:()=>existing?.id || '',createRuntimeId:()=> 'new-id',
    cargoText:(_key,fallback)=>fallback,parseMissionDecimal:value=>value==null?null:Number(value),
    normalizeRefuelServiceType:()=> 'both',isDispatcherMode:()=>false,
    currentActiveFleetEntry:()=>({id:'active-ship'}),
    collectCourierPackages:()=>[packageItem],collectDeliveryItems:()=>[packageItem],
    collectProcurementItems:()=>[{name:'Medpens',quantity:2,destination:'Lorville'}],
    buildDeliverySegments:()=>[{id:'segment',totalScu:8,scuPerLoad:8}],
    collectConsignments:()=>[{id:'segment',pickup:'Area18',dropoff:'Lorville'}],
    createLoadsFromConsignments:()=>[{id:'load'}],getPlannedConsignmentScu:()=>8,
    getCargoReadiness:()=>({ok:true,fleetEntry:{id:'active-ship'},hasCargo:true}),
    getRefuelReadiness:()=>({ok:true,activeEntry:{id:'active-ship'}}),
    getSalvageReadiness:()=>({ok:true,activeEntry:{id:'active-ship'}}),
    getMiningReadiness:()=>({ok:true,activeEntry:{id:'active-ship'}}),
    buildMissionDraftValidation:()=>({isValid:true}),renderMissionValidationHint(){},
    getMissionServiceDetails:mission=>mission?.serviceDetails || {},isCargoMission:mission=>['cargo','delivery'].includes(mission.type),
    isMissionCompleted:mission=>mission?.status==='completed',canUseLoadPage:()=>true,
    mergeCargoMissionDraft:()=>({segments:[{id:'kept'}],loads:[{id:'old',placement:{row:0}}],newLoadIds:[],blockedRouteCount:0}),
    saveMissionEntry:(mission,options)=>saves.push({mission:clone(mission),options:clone(options)}),
    resetMissionForm:()=>effects.push('reset'),persist:()=>effects.push('persist'),render:()=>effects.push('render'),
    showAppNotice:async message=>notices.push(message),showMissionConfirmDialog:async()=>true,
  });
  vm.runInContext(source,c);
  return {c,fields,saves,notices,effects,submit:()=>c.submitMissionForm({preventDefault(){}})};
}
for(const type of ['cargo','courier','delivery','refuel','investigation','salvage','procurement','mining','other']) {
  test(type+': creation and editing share metadata while preserving existing progress',async()=>{
    const fresh=fixture(type);await fresh.submit();
    assert.equal(fresh.saves.length,1);const saved=fresh.saves[0].mission;
    assert.equal(saved.id,'new-id');assert.equal(saved.type,type);assert.equal(saved.title,'New title');
    assert.equal(saved.notes,'Note');assert.equal(saved.payout,12500);assert.equal(saved.status,'active');
    assert.ok(saved.createdAt);assert.equal(saved.serviceDetails.customer,'Customer');
    assert.deepEqual(fresh.effects,['reset','persist','render']);
    const edited=fixture(type,{id:'existing',type,status:'completed',createdAt:'created',completedAt:'completed',paidAt:'paid',assignedFleetEntryId:'old-ship'});
    await edited.submit();const update=edited.saves[0];
    assert.equal(update.mission.id,'existing');assert.equal(update.mission.createdAt,'created');
    assert.equal(update.mission.completedAt,'completed');assert.equal(update.mission.paidAt,'paid');
    assert.equal(update.options.assignedFleetEntryId,'assigned-ship');
    assert.deepEqual(update.options.importQuality,{payout:'verified'});
    if(type==='cargo')assert.equal(edited.c.state.selectedLoadId,'old');
  });
}
test('invalid packages and unsuitable ships leave the form and saved state untouched',async()=>{
  for(const [type,override] of [['courier',{collectCourierPackages:()=>[]}],['delivery',{collectDeliveryItems:()=>[]}],
    ['refuel',{getRefuelReadiness:()=>({ok:false,message:'unsuitable'})}],['salvage',{getSalvageReadiness:()=>({ok:false,message:'unsuitable'})}],
    ['cargo',{buildMissionDraftValidation:()=>({isValid:false})}]]) {
    const f=fixture(type);Object.assign(f.c,override);await f.submit();
    assert.equal(f.saves.length,0);assert.equal(f.effects.length,0);assert.equal(f.notices.length,1);
  }
});
test('declining a change to loaded cargo preserves the open form',async()=>{
  const f=fixture('cargo',{id:'existing',type:'cargo'});
  f.c.mergeCargoMissionDraft=()=>({blockedRouteCount:1});f.c.showMissionConfirmDialog=async()=>false;
  await f.submit();assert.equal(f.saves.length,0);assert.deepEqual(f.effects,[]);
});
