const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const areas = require('../web/scripts/cargo-areas.js');
const autoload = require('../web/scripts/autoload.js');
const context = vm.createContext({window:{}});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/scripts/presets.js'),'utf8'),context);
const presets = context.window.ShipPresets.SHIP_PRESETS;
function heightsFor(id) {
  const p=presets[id], result={};
  for(let r=0;r<p.rows;r++) for(let c=0;c<p.cols;c++) {
    const slot=areas.slotId(r,c);
    if(!p.blockedSlots.includes(slot)) result[slot]=p.heightOverrides[slot]||p.defaultHeight;
  }
  return result;
}
for(const [id, expected] of [['hermes',[144,144]],['origin_315p',[8,4]],['starlancer_max',[64,64,96]]]) {
  test(`${id}: named areas cover the existing grid exactly once`,()=>{
    const heights=heightsFor(id), defaults=areas.defaults(heights,id);
    assert.deepEqual(defaults.map(a=>a.slots.reduce((n,s)=>n+heights[s],0)),expected);
    assert.deepEqual([...areas.slotOwners(defaults).keys()].sort(),Object.keys(heights).sort());
  });
}
test('unknown grids seed disconnected holds and extended row labels',()=>{
  assert.equal(areas.slotId(26,0),'AA1');
  const defaults=areas.defaults({A1:2,A2:2,C1:1,AA1:1});
  assert.deepEqual(defaults.map(a=>a.slots),[['A1','A2'],['C1'],['AA1']]);
  assert.deepEqual(areas.defaults({}),[]);
});
test('empty custom areas remain empty instead of regenerating defaults',()=>{
  assert.deepEqual(areas.normalize([],heightsFor('hermes')),[]);
});
test('invalid slots, deleted grid cells and overlaps are removed deterministically',()=>{
  const input=[{id:'a',name:'A',slots:['A1','A1','A2','X5']},{id:'b',name:'B',slots:['A1','B1']},{id:'a',slots:['B1']}];
  const result=areas.normalize(input,{A1:2,A2:0,B1:1});
  assert.deepEqual(result.map(a=>a.slots),[['A1'],['B1']]);
  assert.deepEqual(input[0].slots,['A1','A1','A2','X5']);
});
test('rename, order, color and empty area ids survive normalization',()=>{
  const input=[{id:'back',name:'Reserve',color:'#abcd12',slots:[]},{id:'front',name:'Fracht',slots:['A1']}];
  const result=areas.normalize(input,{A1:1});
  assert.equal(result[0].id,'back');assert.equal(result[0].name,'Reserve');assert.equal(result[0].color,'#abcd12');
  assert.deepEqual(areas.normalize(result,{A1:1}),result);
});
test('unsafe color values and reserved ids are rejected',()=>{
  assert.equal(areas.normalize([{id:'a',color:'red;display:none',slots:[]}],{})[0].color,areas.colors[0]);
  assert.deepEqual(areas.normalize([{id:'__remaining__',slots:[]}],{}),[]);
});
test('whole container must stay inside one area, including unassigned space',()=>{
  const owners=areas.slotOwners([{id:'a',slots:['A1','A2']},{id:'b',slots:['B1']}]);
  assert.equal(areas.containingArea([{row:0,col:0},{row:0,col:1}],owners),'a');
  assert.equal(areas.containingArea([{row:0,col:0},{row:1,col:0}],owners),null);
  assert.equal(areas.containingArea([{row:0,col:1},{row:0,col:2}],owners),null);
  assert.equal(areas.containingArea([{row:2,col:1},{row:2,col:2}],owners),'');
});
test('area order precedes compact stacking while overload stays last',()=>{
  const candidates=[{areaRank:1,newFloorCells:0,row:0},{areaRank:0,newFloorCells:8,row:18},{areaRank:0,overloadCellCount:1,newFloorCells:0,row:0}];
  assert.deepEqual(autoload.sortPlacementCandidates(candidates,'areas'),[candidates[1],candidates[0],candidates[2]]);
});
test('old explicit fill preferences survive; new settings use ship areas',()=>{
  assert.equal(autoload.normalizeAutoloadSettings({}).fillOrder,'areas');
  for(const fillOrder of ['rows','left','right']) assert.equal(autoload.normalizeAutoloadSettings({fillOrder}).fillOrder,fillOrder);
});

test('named area filling keeps compact stacking instead of favoring the grid center',()=>{
  const candidates=[{area:'center',areaRank:0,newFloorCells:4,row:0},{area:'left',areaRank:0,newFloorCells:0,row:2}];
  assert.deepEqual(autoload.sortPlacementCandidates(candidates,'areas'),[candidates[1],candidates[0]]);
});
