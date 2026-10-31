const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../web/scripts/telemetry-domain.js');
const ViewRenderer = require('../web/scripts/view-renderer.js');
const source = file => fs.readFileSync(require.resolve('../web/scripts/'+file), 'utf8');

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
