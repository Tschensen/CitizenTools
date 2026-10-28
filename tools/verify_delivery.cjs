/* Full browser workflow against a temporary SQLite database, never live data. */
const {chromium} = require('playwright');
const {spawn} = require('node:child_process');
const {mkdtempSync, mkdirSync} = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, '.delivery-verification');
mkdirSync(output, {recursive:true});
const data = mkdtempSync(path.join(output, 'data-'));
const server = spawn(process.env.CITIZENTOOLS_PYTHON || 'python', [path.join(__dirname,'delivery_preview.py'),'--data-dir',data], {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});
let errors = '';
server.stderr.on('data', chunk => {errors += chunk;});
const urlPromise = new Promise((resolve,reject) => {
  let text='';
  server.stdout.on('data', chunk => {text+=chunk; const match=text.match(/http:\/\/127\.0\.0\.1:\d+/); if(match) resolve(match[0]);});
  server.once('exit', code => reject(new Error(`Server exited ${code}: ${errors}`)));
  setTimeout(()=>reject(new Error('Server startup timed out: '+errors)),20000).unref();
});
let browser, page;
const checks=[];
async function ready(p) {
  await p.waitForFunction(()=>window.soloStartup?.phase==='ready' && window.soloSync?.status.hydrated && !soloSync.status.busy && !soloSync.status.hasUnsaved);
}
async function save(p) {assert.equal(await p.evaluate(()=>flushSoloState()),true); await ready(p);}
async function seed(p) {
  await p.evaluate(()=>{
    const make=(id,dropoff,quantity)=>({id,type:'cargo',title:'Transport '+id,status:'active',payout:12000,assignedFleetEntryId:'test-hermes',pickup:'Area18',dropoff,
      segments:[{id:'segment-'+id,title:'Titanium',pickup:'Area18',dropoff,width:1,depth:1,height:1,quantity,order:0}],
      loads:Array.from({length:quantity},(_,i)=>({id:id+'-'+i,segmentId:'segment-'+id,cargoTitle:'Titanium',label:'Titanium '+(i+1),width:1,depth:1,height:1,scu:1,pickup:'Area18',dropoff,placement:null}))});
    state=sanitizeState({...state,fleet:[{id:'test-hermes',shipId:'ship:hermes',manufacturer:'RSI',model:'Hermes',status:'active',acquiredOn:'2026-09-01'}],activeFleetEntryId:'test-hermes',
      missions:[make('A','Lorville',4),make('B','Orison',1)],stopHistory:[],ledgerEntries:[],runRouteProgress:{},runRouteOrder:{},currentLocation:'Area18',runCompletedRoutePoints:[],selectedRunRoutePointKey:''});
    applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:hermes')),'test-hermes','ship:hermes');
    autoLoadEntries(getAllLoads().filter(({load})=>['A-0','A-1','B-0'].includes(load.id)).sort((a,b)=>b.mission.id.localeCompare(a.mission.id)),{persistAfter:false,renderAfter:false,settings:{...getAutoloadSettings(),strategy:'largest'}});
    state.currentLocation='Lorville'; state.runPriorityRouteLocation='Lorville';
    persist();render();setActivePage('run');
  });
  await save(p);
}
async function selectOne(p) {
  await p.locator('.run-deliver-group').first().click();
  await p.locator('#deliverySelectionDialog').waitFor({state:'visible'});
  await p.locator('[data-delivery-all]').uncheck();
  // Pick the uppermost container, which must be accessible on its own.
  const id=await p.evaluate(()=>[...buildStopCargoGroups('Lorville')[0].placedEntries].sort((a,b)=>b.load.placement.z-a.load.placement.z)[0].load.id);
  await p.locator(`#deliverySelectionList input[value="${id}"]`).check();
  await p.locator('#deliverySelectionDialog [type=submit]').click();
  await p.waitForFunction(()=>state.stopHistory.length===1 && !deliveryActionBusy);
  await save(p);
  return id;
}
(async()=>{
  try {
    const url=await urlPromise;
    browser=await chromium.launch({channel:'msedge',headless:true});
    page=await browser.newPage({viewport:{width:1366,height:960},reducedMotion:'reduce'});
    await page.goto(url); await ready(page); await seed(page);
    assert.equal(await page.locator('.delivery-stop-section').count(),3);
    assert.ok((await page.locator('#runDeliveryOverview').innerText()).includes('Transport B'));
    checks.push('stop overview separates same goods by contract and destination');
    await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
    const id=await selectOne(page);
    assert.deepEqual(await page.evaluate(()=>({delivered:state.missions[0].loads.filter(l=>l.deliveredAt).length,waiting:state.missions[0].loads.filter(l=>!l.placement&&!l.deliveredAt).length,status:state.missions[0].status,scu:state.stopHistory[0].scu})),{delivered:1,waiting:2,status:'active',scu:1});
    checks.push('checkbox delivery leaves the remaining containers and contract open');
    await page.reload();await ready(page);await page.evaluate(()=>setActivePage('run'));
    assert.equal(await page.locator('[data-undo-delivery]').first().isEnabled(),true);
    checks.push('undo journal survives reload and normalization');
    const tablet=await browser.newPage({viewport:{width:820,height:1180},reducedMotion:'reduce'});
    await tablet.goto(url);await ready(tablet);await tablet.evaluate(()=>setActivePage('run'));
    await tablet.screenshot({path:path.join(output,'tablet.png'),fullPage:true});
    await tablet.locator('[data-undo-delivery]').first().click();
    await tablet.locator('#missionConfirmDialog').waitFor({state:'visible'});
    await tablet.locator('#missionConfirmDialogConfirm').click();
    await tablet.waitForFunction(()=>state.stopHistory.length===0 && !deliveryActionBusy);await save(tablet);
    await page.evaluate(()=>getSoloSync().refresh());
    assert.equal(await page.evaluate(id=>Boolean(state.missions[0].loads.find(l=>l.id===id).placement),id),true);
    checks.push('tablet undo restores PC cargo and removes delivery statistics');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{uiLanguageSelect.value='en';uiLanguageSelect.dispatchEvent(new Event('change'));});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.locator('.run-deliver-group').first().click();
    await page.locator('#deliverySelectionDialog').waitFor({state:'visible'});
    await page.screenshot({path:path.join(output,'phone-dialog.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!deliveryActionBusy);
    checks.push('English phone dialog fits viewport and Escape cancels without mutations');
    await page.setViewportSize({width:1366,height:960});
    await selectOne(page);
    await tablet.evaluate(()=>getSoloSync().refresh());
    await tablet.evaluate(()=>{state.missions[0].title='Edited on tablet';persist();render();});await save(tablet);
    await page.evaluate(()=>getSoloSync().refresh());
    assert.equal(await page.locator('[data-undo-delivery]').first().isDisabled(),true);
    checks.push('newer tablet contract edit disables unsafe undo');
    const download=await page.request.get(url+'/api/backup');
    assert.equal(download.status(),200);assert.ok((await download.body()).length>100);
    checks.push('backup endpoint includes the shared delivery state');
    await seed(page);
    await page.evaluate(()=>{
      state.missions=state.missions.filter(m=>m.id==='A');
      state.currentLocation='Area18';state.runPriorityRouteLocation='';state.selectedRunRoutePointKey='';
      state.runRouteOrder['test-hermes']=['pickup:A:segment-A','delivery:A:segment-A'];
      persist();render();
    });await save(page);
    await page.locator('#runCompletePickupButton').click();
    await page.locator('#missionConfirmDialogConfirm').click();
    await page.waitForFunction(()=>buildRunRouteState().selectedPoint?.dropoff==='Lorville');
    await save(page);
    await page.locator('#runArriveButton').click();await save(page);
    await page.locator('#runCompleteStopButton').click();
    await page.locator('#missionConfirmDialogConfirm').click();
    await page.waitForFunction(()=>state.stopHistory.length===1);await save(page);
    assert.equal(await page.evaluate(()=>state.missions[0].status),'active');
    assert.equal(await page.evaluate(()=>buildRunRouteState().selectedPoint?.dropoff),'Area18');
    await page.locator('#runArriveButton').click();await save(page);
    await page.locator('#runAutoLoadButton').click();await save(page);
    await page.locator('#runCompletePickupButton').click();await save(page);
    await page.waitForFunction(()=>buildRunRouteState().selectedPoint?.dropoff==='Lorville');
    await page.locator('#runArriveButton').click();await save(page);
    await page.locator('#runCompleteStopButton').click();
    await page.locator('#missionConfirmDialogConfirm').click();
    await page.waitForFunction(()=>state.stopHistory.length===2);await save(page);
    assert.deepEqual(await page.evaluate(()=>({status:state.missions[0].status,delivered:state.missions[0].loads.filter(l=>l.deliveredAt).length,scu:state.stopHistory.reduce((sum,e)=>sum+e.scu,0),open:buildRunRouteState().openPoints.length})),{status:'completed',delivered:4,scu:4,open:0});
    assert.equal(await page.locator('[data-undo-delivery]').first().isEnabled(),true);
    checks.push('two complete trips preserve remaining pickup, manual route and exact totals');
    await page.locator('[data-undo-delivery]').first().click();
    await page.locator('#missionConfirmDialogConfirm').click();
    await page.waitForFunction(()=>state.missions[0].status==='active' && !deliveryActionBusy);await save(page);
    assert.deepEqual(await page.evaluate(()=>({loaded:state.missions[0].loads.filter(l=>l.placement).length,scu:state.stopHistory.reduce((sum,e)=>sum+e.scu,0)})),{loaded:2,scu:2});
    checks.push('undo of final delivery reopens completed contract and corrects statistics');
    assert.deepEqual(await page.evaluate(()=>window.soloErrors),[]);
    assert.deepEqual(await tablet.evaluate(()=>window.soloErrors),[]);
    console.log(JSON.stringify({ok:true,checks,screenshots:output},null,2));
  } catch(error) {
    console.error(error);
    if(page) {
      console.error(await page.evaluate(()=>({errors:window.soloErrors,dialogs:[...document.querySelectorAll('.app-dialog-backdrop:not([hidden])')].map(e=>e.id),buttons:[...document.querySelectorAll('#missionConfirmDialog button')].map(e=>e.id),sync:window.soloSync?.status})).catch(()=>({})));
      await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});
    }
    process.exitCode=1;
  } finally {
    await browser?.close();
    server.stdin.end();
    await new Promise(resolve=>{if(server.exitCode!==null) return resolve(); server.once('exit',resolve); setTimeout(()=>{server.kill();resolve();},5000).unref();});
  }
})();
