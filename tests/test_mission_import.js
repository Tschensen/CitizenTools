const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = name => fs.readFileSync(path.join(__dirname, '../web/scripts', name + '.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const cargo = {
  type:'cargo', title:'Titan contract', payout:0, fieldQuality:{payout:'verified'},
  serviceDetails:{customer:'Test Pilot'}, maxContainerScu:8, routes:[],
  consignments:[{title:'Titan', totalScu:16, pickup:'', routes:[
    {pickup:'Area18', dropoff:'Lorville', targetScu:0},
    {pickup:'Baijini Point', dropoff:'Lorville', targetScu:0},
  ]}],
};
const refuel = {type:'refuel', title:'REFUEL REQUEST', payout:0, routes:[], fieldQuality:{payout:'verified'},
  serviceDetails:{customer:'Test Pilot', location:'Lorville', targetVehicle:'Freelancer', hydrogenRate:12}};

function fixture() {
  const requests = [], statuses = [], forms = [], rendered = [];
  const c = vm.createContext({
    window:{}, missionImportRequestId:0, MISSION_RECOGNITION_URL:'/api/imports/recognize',
    missionImportPreview:{hidden:true}, missionImportConsignmentList:{innerHTML:''},
    missionImportPreviewSummary:{textContent:''}, missionImportApply:{disabled:true},
    missionImportDropzone:null, missionImportClipboardButton:null, missionImportFileInput:null,
    missionImportBusy:false, missionImportOriginalDraft:null, missionImportDraftMetadata:{},
    selectedMissionImportId:'',
    normalizeMissionType:type => type || 'cargo', getMissionTypeLabel:type => type,
    normalizeMissionMaxContainerScu:value => value || null, currentUiLanguage:() => 'de',
    getMissionServiceDetails:mission => mission.serviceDetails || {},
    escapeHtml:value => String(value).replaceAll('<', '&lt;'), t:(key, values) => key + (values ? JSON.stringify(values) : ''),
    locationAliasLearningController:{queueMissionCorrection() {}},
  });
  vm.runInContext(read('mission-import-ui'), c);
  Object.assign(c, {
    renderMissionImportInbox() {}, showMissionImportImage() {},
    renderMissionImportDuplicateWarning() {},
    setMissionImportStatus:(...args) => statuses.push(args),
    populateMissionForm:(...args) => forms.push(clone(args)),
    closeMissionImportDialog() {},
    addMissionImportConsignment:item => rendered.push(clone(item)),
    fetch:async (url, options) => {requests.push({url, options}); return {ok:true, json:async () => ({ok:true, draft:clone(cargo)})};},
  });
  c.missionImportConsignmentList.querySelectorAll = () => [];
  return {c, requests, statuses, forms, rendered};
}

test('manual upload uses the server draft, including unallocated German consignments', async () => {
  const f = fixture(), previews = [];
  f.c.renderMissionImportPreview = draft => previews.push(clone(draft));
  const file = {type:'image/png'};
  await f.c.importMissionScreenshot(file);
  assert.equal(f.requests[0].url, '/api/imports/recognize');
  assert.equal(f.requests[0].options.body, file);
  assert.deepEqual(previews, [cargo]);
  assert.match(f.statuses.at(-1)[1], /"count":2/);
  assert.equal(f.c.missionImportBusy, false);
});

test('service contract with no routes is still recognized', async () => {
  const f = fixture();
  f.c.fetch = async () => ({ok:true, json:async () => ({ok:true, draft:clone(refuel)})});
  await f.c.importMissionScreenshot({type:'image/jpeg'});
  assert.equal(f.c.missionImportPreview.hidden, false);
  assert.equal(f.c.missionImportApply.disabled, false);
  assert.equal(f.statuses.at(-1)[2], 'success');
  assert.equal(f.c.readMissionImportPreview().serviceDetails.targetVehicle, 'Freelancer');
  await f.c.applyMissionImportPreview();
  assert.equal(f.forms.length, 1);
  assert.equal(f.forms[0][0].type, 'refuel');
  assert.equal(f.forms[0][0].id, '', 'Import fills an unsaved new contract');
  assert.equal(f.forms[0][0].payout, 0);
  assert.deepEqual(f.forms[0][0].sourceImportQuality, {payout:'verified'});
  assert.deepEqual(f.forms[0][1], {create:true});
});

test('cargo preview preserves reward, customer and contract title independently of cargo names', () => {
  const f = fixture();
  f.c.syncMissionImportPreview = () => {};
  f.c.renderMissionImportPreview(cargo);
  assert.deepEqual(f.rendered, cargo.consignments);
  assert.equal(f.c.missionImportDraftMetadata.title, 'Titan contract');
  assert.equal(f.c.missionImportDraftMetadata.payout, 0);
  assert.equal(f.c.missionImportDraftMetadata.serviceDetails.customer, 'Test Pilot');
});

test('successful OCR without a recognized contract shows a warning', async () => {
  const f = fixture();
  f.c.fetch = async () => ({ok:true, json:async () => ({ok:true, draft:null})});
  await f.c.importMissionScreenshot({type:'image/png'});
  assert.equal(f.statuses.at(-1)[2], 'warning');
  assert.equal(f.c.missionImportPreview.hidden, true);
  assert.equal(f.c.missionImportBusy, false);
});

test('closing or starting another import ignores a late OCR result', async () => {
  const f = fixture();
  let resolve;
  f.c.fetch = () => new Promise(done => {resolve = done;});
  const pending = f.c.importMissionScreenshot({type:'image/png'});
  f.c.missionImportRequestId += 1;
  resolve({ok:true, json:async () => ({ok:true, draft:refuel})});
  await pending;
  assert.equal(f.c.missionImportPreview.hidden, true);
});

test('existing contract editor stays in edit mode while imports use create mode', () => {
  const f = fixture(), elements = new Proxy({}, {get:(target, key) => target[key] ||= {value:''}});
  Object.assign(f.c, {
    missionForm:{elements}, missionTypeSelect:{value:''},
    missionFormTitle:{textContent:''}, missionSubmitButton:{textContent:''}, missionCancelButton:{hidden:true},
    DEFAULT_COLOR:'#fff', cargoText:(_key, fallback) => fallback,
  });
  vm.runInContext(read('cargo-ui'), f.c);
  Object.assign(f.c, {
    resetMissionForm() {
      f.c.missionFormTitle.textContent = 'Create';
      f.c.missionSubmitButton.textContent = 'Create';
      f.c.missionCancelButton.hidden = true;
    },
    renderMissionAssignmentEditor() {}, syncMissionTypeFields() {},
    renderMissionImportQuality() {}, updateDimensionHint() {}, renderLocationSuggestions() {}, setActivePage() {},
  });
  f.c.populateMissionForm({...refuel, id:'existing'});
  assert.equal(elements.entryId.value, 'existing');
  assert.equal(f.c.missionCancelButton.hidden, false);
  f.c.populateMissionForm({...refuel, id:'do-not-use'}, {create:true});
  assert.equal(elements.entryId.value, '');
  assert.equal(elements.refuelTargetVehicle.value, 'Freelancer');
  assert.equal(elements.refuelHydrogenRate.value, 12);
  assert.equal(elements.payout.value, 0);
  assert.equal(f.c.missionFormTitle.textContent, 'Create');
  assert.equal(f.c.missionSubmitButton.textContent, 'Create');
  assert.equal(f.c.missionCancelButton.hidden, true);
});
