const test = require('node:test');
const assert = require('node:assert/strict');
const route = require('../web/scripts/route-optimizer.js');
const cargo = require('../web/scripts/autoload.js');
const tasks = [
  {id:'pa',kind:'pickup',location:'A'}, {id:'da',kind:'delivery',location:'B',dependencies:['pa']},
  {id:'pc',kind:'pickup',location:'C'}, {id:'dc',kind:'delivery',location:'D',dependencies:['pc']},
];
const plan = (order, data=tasks) => route.optimizeRouteTasks(data, {taskOrder:order});
test('manual order overrides current location and automatic scores', () => {
  assert.deepEqual(route.optimizeRouteTasks(tasks, {taskOrder:['pc','dc','pa','da'],currentLocation:'A'}).orderedTaskIds, ['pc','dc','pa','da']);
});
test('pickup dependencies are enforced even for invalid saved order', () => {
  assert.deepEqual(plan(['da','dc','pa','pc']).orderedTaskIds, ['pa','da','pc','dc']);
});
test('removed and completed tasks disappear, new tasks are appended', () => {
  const data=[...tasks.map(t=>({...t,completed:t.id==='pa'})),{id:'new',location:'E'}];
  assert.deepEqual(plan(['gone','pa','da','pc','dc'],data).orderedTaskIds,['da','pc','dc','new']);
});
test('a repeated location stays a separate visit after its prerequisite', () => {
  const data=[{id:'a',location:'A'}, {id:'b',location:'B',dependencies:['a']}, {id:'c',location:'A',dependencies:['b']}];
  assert.deepEqual(plan(['a','b','c'],data).batches.map(b=>b.location),['A','B','A']);
});
const stops = tasks.map(t=>({routeTaskIds:[t.id],routeDependencies:t.dependencies||[]}));
test('move stop is immutable and rejects delivery before pickup', () => {
  assert.equal(route.moveRouteStop(stops,1,0),null);
  assert.deepEqual(route.moveRouteStop(stops,2,0).map(p=>p.routeTaskIds[0]),['pc','pa','da','dc']);
  assert.equal(stops[0].routeTaskIds[0],'pa');
  assert.equal(route.moveRouteStop(stops,0,-1),null);
});
test('dependencies within a combined stop remain valid', () => {
  const combined=[{routeTaskIds:['pa','da'],routeDependencies:['pa']},stops[2]];
  assert.ok(route.moveRouteStop(combined,0,1));
});
test('old autoload settings retain row-by-row defaults', () => {
  assert.deepEqual(cargo.normalizeAutoloadSettings({strategy:'route'}),{strategy:'route',fillOrder:'rows',allowOverload:false});
  assert.equal(cargo.normalizeCargoArea('unexpected'),'all');
});
test('Hermes sides exclude the middle aisle and crossing footprints', () => {
  assert.equal(cargo.placementArea([{col:0},{col:3}],9),'left');
  assert.equal(cargo.placementArea([{col:5},{col:8}],9),'right');
  assert.equal(cargo.placementArea([{col:3},{col:5}],9),'center');
  assert.equal(cargo.placementArea([{col:4}],9),'center');
  assert.equal(cargo.placementArea([{col:3}],8),'left');
  assert.equal(cargo.placementArea([{col:4}],8),'right');
});
const candidates=[{id:'right',area:'right',row:0,col:5,newFloorCells:0},{id:'left',area:'left',row:15,col:0,newFloorCells:8}];
test('left first fills the whole left half before using right', () => {
  assert.equal(cargo.sortPlacementCandidates(candidates,'left')[0].id,'left');
});
test('right first fills the whole right half', () => {
  assert.equal(cargo.sortPlacementCandidates([...candidates].reverse(),'right')[0].id,'right');
});
test('official grid is preferred over overload even with side preference', () => {
  assert.equal(cargo.sortPlacementCandidates([{...candidates[1],overloadCellCount:1},candidates[0]],'left')[0].id,'right');
});
test('existing row-by-row compact and stacking behavior is retained', () => {
  assert.equal(cargo.sortPlacementCandidates(candidates)[0].id,'right');
  assert.equal(cargo.sortPlacementCandidates([{area:'left',row:0,col:0,newFloorCells:2},{area:'left',row:5,col:0,newFloorCells:0}],'left')[0].row,5);
});
