const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({cloneData: structuredClone});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/scripts/solo-merge.js'), 'utf8'), context);
const merge = (b,l,r) => context.soloMergeStates(b,l,r);
const mission = (title, id='a') => ({id,title});
const base = {missions:[mission('before')]};
assert.equal(merge(base, {missions:[]}, {missions:[mission('edited')]}).ok, false, 'Delete versus edit is a genuine conflict');
assert.equal(merge(base, {missions:[mission('tablet')]}, {missions:[mission('PC')]}).ok, false, 'Competing edits to a mission stay atomic');
assert.deepEqual(merge(base, {missions:[]}, {missions:[]}).state, {missions:[]});
assert.deepEqual(merge(base, {missions:[mission('before'),mission('tablet','b')]}, {missions:[mission('PC'),mission('import','c')]}).state,
  {missions:[mission('PC'),mission('import','c'),mission('tablet','b')]});
const ordered={missions:['a','b','c'].map(id=>mission(id,id))};
assert.deepEqual(merge(ordered, {missions:[...ordered.missions].reverse()}, ordered).state.missions.map(m=>m.id), ['c','b','a']);
assert.equal(merge(ordered,{missions:[ordered.missions[1],ordered.missions[0],ordered.missions[2]]},
  {missions:[ordered.missions[0],ordered.missions[2],ordered.missions[1]]}).ok,false);
assert.deepEqual(merge({runCompletedRoutePoints:['a']}, {runCompletedRoutePoints:['a','b']}, {runCompletedRoutePoints:['c']}).state,
  {runCompletedRoutePoints:['c','b']});
assert.deepEqual(merge({currentLocation:'A',uiLanguage:'de'}, {currentLocation:'A',uiLanguage:'en'}, {currentLocation:'B',uiLanguage:'de'}).state,
  {currentLocation:'B',uiLanguage:'en'});
assert.equal(context.soloEqual({b:2,a:1},{a:1,b:2}),true);
console.log('9 shared-state merge tests passed.');
