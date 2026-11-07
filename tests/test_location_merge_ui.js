const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../web/scripts/telemetry-domain.js');
const ViewRenderer = require('../web/scripts/view-renderer.js');
const source = file => fs.readFileSync(require.resolve('../web/scripts/'+file), 'utf8');

async function locationFixture(locations) {
  const context = {window:{location:{protocol:'http:'}},
    document:{querySelector:()=>null,querySelectorAll:()=>[]},
    fetch:async()=>({ok:true,json:async()=>({locations})})};
  vm.createContext(context);
  vm.runInContext(source('systemdb.js'), context);
  const controller = context.window.createSystemDatabaseController({helpers:{t:key=>key,escapeHtml:String,renderLocationSuggestions:()=>{}}});
  await controller.load();
  return {context, controller};
}

test('large location catalogs resolve names and aliases without rescanning every record', async () => {
  let nameReads = 0;
  const locations = Array.from({length:650}, (_, index) => ({id:String(index),status:'active',
    get name() {nameReads++; return `Place ${index}`;}, aliases:[`Legacy ${index}`]}));
  const {controller} = await locationFixture(locations);
  nameReads = 0;
  for (let index = 0; index < 650; index++) {
    assert.equal(controller.resolveLocationName(`LEGACY ${index}`), `Place ${index}`);
    assert.equal(controller.resolveLocationName(`Place ${index}`), `Place ${index}`);
  }
  assert.ok(nameReads < 10000, `catalog was scanned repeatedly (${nameReads} name reads)`);
});

test('reloads update aliases, ambiguity and archived records; failed loads clear old matches', async () => {
  const locations = [{id:'orison',name:'Orison',status:'active',aliases:['August Dunlow Spaceport','Stanton2_Orison']}];
  const {context,controller} = await locationFixture(locations);
  assert.equal(controller.resolveLocationName('August Dunlow Spaceport'), 'Orison');
  locations.push({id:'duplicate',name:'Other Place',status:'active',aliases:['August Dunlow Spaceport']});
  await controller.load();
  assert.equal(controller.resolveLocationName('August Dunlow Spaceport'), 'August Dunlow Spaceport');
  locations[1].status = 'archived';
  await controller.load();
  assert.equal(controller.resolveLocationName('August Dunlow Spaceport'), 'Orison');
  locations[0].aliases = ['New alias'];
  await controller.load();
  assert.equal(controller.resolveLocationName('Stanton2_Orison'), 'Stanton2_Orison');
  assert.equal(controller.resolveLocationName('New alias'), 'Orison');
  context.fetch = async () => {throw new Error('offline');};
  await controller.load();
  assert.equal(controller.resolveLocationName('New alias'), 'New alias');
});

test('learning an alias immediately refreshes the location lookup', async () => {
  const {context,controller} = await locationFixture([{id:'orison',name:'Orison',status:'active',aliases:[]}]);
  context.fetch = async () => ({ok:true,json:async()=>({location:{id:'orison',name:'Orison',status:'active',aliases:['Stanton2_Orison']}})});
  await controller.addAlias('orison','Stanton2_Orison');
  assert.equal(controller.resolveLocationName('Stanton2_Orison'), 'Orison');
  context.window.location.protocol = 'file:';
  await controller.load();
  assert.equal(controller.resolveLocationName('Stanton2_Orison'), 'Stanton2_Orison');
});

test('merged seed locations and old mission names appear once and resolve in telemetry', async () => {
  const name = 'August Dunlow Spaceport in Orison';
  const locations = [{name:'Orison',status:'archived',aliases:[]},
    {name,status:'active',aliases:['Orison']}];
  const context = {window:{location:{protocol:'http:'}},
    document:{querySelector:()=>null,querySelectorAll:()=>[]},
    fetch:async()=>({ok:true,json:async()=>({locations})}),
    LOCATION_SUGGESTIONS:['Orison'], state:{currentLocation:'Orison',missions:[]},
    consignmentList:null,quickDestinationList:null,quickPickup:null};
  vm.createContext(context);
  vm.runInContext(source('systemdb.js'), context);
  const controller = context.window.createSystemDatabaseController({helpers:{t:key=>key,escapeHtml:String,renderLocationSuggestions:()=>{}}});
  context.window.systemDatabaseController = controller;
  await controller.load();
  vm.runInContext(source('location-picker-ui.js'), context);
  const suggestions = Array.from(context.collectLocationSuggestions());
  assert.deepEqual(suggestions,[name]);
  assert.equal(controller.resolveLocationName('Unrelated Place'),'Unrelated Place');
  assert.equal(D.resolveLocation('Stanton2_Orison', controller.getActiveLocations()),name);
  locations.push({name:'Other active place',status:'active',aliases:['Orison']});
  await controller.load();
  assert.equal(controller.resolveLocationName('Orison'),'Orison','ambiguous aliases must not choose arbitrarily');
});

test('hub and current route show the latest location after a state update', () => {
  let displayed, location='Orison';
  const context = {activePage:'hub',ViewRenderer,
    renderCurrentLocationControl:()=>{displayed=location;},renderHub:()=>{},renderRunMode:()=>{},
    normalizeAppTooltipTitles:()=>{}};
  vm.createContext(context);
  vm.runInContext(source('app-render.js'),context);
  context.renderVisiblePage();
  assert.equal(displayed,'Orison');
  location='August Dunlow Spaceport';
  context.invalidateAppViews();context.renderVisiblePage();
  assert.equal(displayed,location);
  context.activePage='run';location='Seraphim Station';
  context.renderVisiblePage();
  assert.equal(displayed,location);
});

test('merge search finds names and aliases without choosing a hidden or unreviewed target', async () => {
  const locations=[{id:'source',name:'August Dunlow Spaceport',status:'active'},
    {id:'orison',name:'Orison',status:'active',starSystem:'Stanton',parentLocation:'Crusader',aliases:['Stanton2_Orison']},
    {id:'archived',name:'Orison old',status:'archived'}];
  const nodes=Object.fromEntries(['systemDbList','systemDbMergeDialog','systemDbMergeSource','systemDbMergeSearch',
    'systemDbMergeTarget','systemDbMergeCount','systemDbMergePreview','systemDbMergeStatus','systemDbMergeCancel','systemDbMergeConfirm']
    .map(id=>[id,{value:'',hidden:true,disabled:false,innerHTML:'',textContent:'',focus(){this.focused=true;},addEventListener(type,handler){this[type]=handler;}}]));
  const context={window:{location:{protocol:'http:'}},document:{querySelector:selector=>nodes[selector.slice(1)] || null,
    querySelectorAll:()=>[],addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({locations})})};
  vm.createContext(context);vm.runInContext(source('systemdb.js'),context);
  const controller=context.window.createSystemDatabaseController({helpers:{t:key=>key,escapeHtml:String,renderLocationSuggestions:()=>{}}});
  controller.init();await controller.load();
  nodes.systemDbList.click({target:{closest:selector=>selector==='[data-location-id]'?{dataset:{locationId:'source'}}:selector==='.systemdb-merge'?{}:null}});
  assert.equal(nodes.systemDbMergeSearch.focused,true);
  assert.equal(nodes.systemDbMergeConfirm.disabled,true);
  assert.ok(!nodes.systemDbMergeTarget.innerHTML.includes('value="source"'));
  assert.ok(!nodes.systemDbMergeTarget.innerHTML.includes('value="archived"'));
  nodes.systemDbMergeSearch.value='Stanton2';nodes.systemDbMergeSearch.input();
  assert.match(nodes.systemDbMergeTarget.innerHTML,/Orison/);
  assert.equal(nodes.systemDbMergeConfirm.disabled,true,'one match still needs explicit selection');
  nodes.systemDbMergeTarget.value='orison';nodes.systemDbMergeTarget.change();
  assert.equal(nodes.systemDbMergeConfirm.disabled,false);
  nodes.systemDbMergeSearch.value='Crusader Orison';nodes.systemDbMergeSearch.input();
  assert.equal(nodes.systemDbMergeTarget.value,'orison');
  nodes.systemDbMergeSearch.value='Nowhere';nodes.systemDbMergeSearch.input();
  assert.equal(nodes.systemDbMergeTarget.value,'');assert.equal(nodes.systemDbMergeConfirm.disabled,true);
  assert.equal(nodes.systemDbMergePreview.textContent,'');assert.equal(nodes.systemDbMergeTarget.disabled,true);
});
