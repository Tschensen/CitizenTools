const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../web/scripts/mission-cargo-edit.js');
function fixture() {
  let next=0;
  return create({getMissionSegments: mission=>mission.segments,
    createLoad: value=>({...value,id:'new-'+(++next),placement:null})});
}
const segment = (extra={}) => ({id:'s1',title:'Titanium',pickup:'Area18',dropoff:'Lorville',
  cargoIndex:0,cargoRouteIndex:0,cargoGroupIndex:0,order:0,quantity:1,containerSize:'8',
  width:2,depth:2,height:2,isPlaceable:true,routeTargetScu:8,...extra});
const mission = (extra={}) => ({segments:[segment()],loads:[{id:'l1',segmentId:'s1',placement:null,...extra}]});

test('unchanged routes retain load identity, placement and delivery history',()=>{
  const before=mission({placement:{row:1,col:2,z:0},deliveredAt:'done'}), copy=structuredClone(before);
  const result=fixture().mergeDraft(before,[segment({id:'draft'})]);
  assert.deepEqual(result.loads,before.loads);assert.deepEqual(result.newLoadIds,[]);
  assert.equal(result.segments[0].id,'s1');assert.deepEqual(before,copy);
});
test('unstarted routes can be replaced and new containers receive distinct ids',()=>{
  const result=fixture().mergeDraft(mission(),[segment({id:'s2',quantity:2,routeTargetScu:16})]);
  assert.equal(result.loads.length,2);assert.deepEqual(result.newLoadIds,['new-1','new-2']);
  assert.ok(result.loads.every(load=>load.segmentId==='s2'));assert.equal(result.blockedRouteCount,0);
});
test('placed and delivered routes cannot be deleted or resized while open routes can',()=>{
  for(const progress of [{placement:{row:0,col:0,z:0}},{deliveredAt:'done'}]) {
    const before=mission(progress), service=fixture();
    const resized=service.mergeDraft(before,[segment({quantity:4})]);
    assert.equal(resized.blockedRouteCount,1);assert.equal(resized.segments[0].quantity,1);
    assert.deepEqual(resized.loads,before.loads);
    assert.equal(service.mergeDraft(before,[]).loads[0].id,'l1');
    assert.deepEqual(service.mergeDraft(mission(),[]).loads,[]);
  }
});
test('completed route correction preserves cargo identity and synchronizes load metadata',()=>{
  const before=mission({placement:{row:0,col:0,z:0}}), copy=structuredClone(before);
  const result=fixture().mergeDraft(before,[segment({title:'Gold',pickup:'Orison',dropoff:'Levski'})],{allowProgressRouteCorrection:true});
  assert.equal(result.blockedRouteCount,0);assert.equal(result.loads[0].id,'l1');
  assert.equal(result.loads[0].cargoTitle,'Gold');assert.equal(result.loads[0].dropoff,'Levski');
  assert.equal(result.segments[0].pickup,'Orison');assert.deepEqual(before,copy);
});
test('metadata corrections cannot resize progressed cargo and orphaned legacy loads survive',()=>{
  const before=mission({deliveredAt:'done'});before.loads.push({id:'legacy',segmentId:'missing'});
  const result=fixture().mergeDraft(before,[segment({quantity:3,dropoff:'Orison'})],{allowProgressRouteCorrection:true});
  assert.equal(result.blockedRouteCount,1);assert.equal(result.segments[0].quantity,1);
  assert.deepEqual(result.loads.map(load=>load.id),['l1','legacy']);
});
test('handheld and unallocated positions never become placeable cargo containers',()=>{
  const result=fixture().createLoads([segment({id:'box'}),segment({id:'hand',isPlaceable:false}),segment({id:'pending',isPlaceable:false,quantityPending:true})]);
  assert.deepEqual(result.map(load=>load.segmentId),['box']);
});
