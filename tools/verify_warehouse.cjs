const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1600,height:1300},hasTouch:true});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.argv[2]);
  await page.waitForFunction(()=>window.soloStartup?.phase==='ready'&&soloSync.status.hydrated&&!soloSync.status.busy);
  await page.evaluate(()=>{
    state=sanitizeState({...state,levelFilter:'all',autoload:{allowOverload:false},fleet:[{id:'warehouse-ship',shipId:'ship:hermes',manufacturer:'RSI',model:'Hermes',status:'active',acquiredOn:'2026-10-01'}],activeFleetEntryId:'warehouse-ship',missions:[{id:'warehouse-contract',type:'cargo',title:'Warehouse test',status:'active',assignedFleetEntryId:'warehouse-ship',pickup:'Area18',dropoff:'Lorville',loads:['wa','wb'].map(id=>({id,label:id,width:1,depth:1,height:1,scu:1,pickup:'Area18',dropoff:'Lorville'}))}]});
    applyLayoutDefinition(getShipGridDefinition(findShipLibraryEntryById('ship:hermes')),'warehouse-ship','ship:hermes');
    state.selectedLoadId=null;state.selectionCleared=true;setActivePage('load');render();setCargoCamera('top');
    if(!warehouseScene) throw new Error(JSON.stringify({activePage,canLoad:canUseLoadPage(),fleet:state.fleet,mission:state.missions[0],svg:!!document.getElementById('warehouseView')}));
    CargoScene.setView(warehouseScene.camera,'top');renderWarehouse();
  });
  await page.waitForFunction(()=>!cargoCameraFrame);
  await page.waitForFunction(()=>!cargoAlignmentFrame);
  assert(await page.evaluate(()=>{
    const a=document.querySelector('.warehouse-frame').getBoundingClientRect(),b=document.querySelector('#loadIsoBody .cargo-camera-frame').getBoundingClientRect();
    return Math.abs(a.top-b.top)<2 && Math.abs(a.height-b.height)<2;
  }));
  assert(await page.locator('.cargo-info-button[data-tooltip]').count()===2);
  console.log('PASS aligned frame tops and heights with info tooltips');
  await page.locator('#warehouseView').evaluate(n=>n.scrollIntoView({block:'center'}));
  const center=async locator=>{const b=await locator.boundingBox();return {x:b.x+b.width/2,y:b.y+b.height/2};};
  const from=await center(page.locator('#warehouseView [data-load-id="wa"] .iso-face').first());
  const to=await center(page.locator('#isoView .iso-floor').first());
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:20});
  assert(await page.locator('#isoView .cargo-placement-preview.is-valid').count());
  await page.mouse.up();
  assert(await page.evaluate(()=>!!findLoadById('wa').load.placement));
  assert.equal(await page.locator('#warehouseView [data-load-id="wa"]').count(),0);
  console.log('PASS drag warehouse to ship places cargo and updates warehouse');
  const loaded=await center(page.locator('#isoView [data-load-id="wa"] .iso-face').first());
  const back=await center(page.locator('#warehouseView'));
  await page.mouse.move(loaded.x,loaded.y);await page.mouse.down();await page.mouse.move(back.x,back.y,{steps:20});await page.mouse.up();
  assert(await page.evaluate(()=>!findLoadById('wa').load.placement));
  await page.locator('#cargoUndoButton').click();
  assert(await page.evaluate(()=>!!findLoadById('wa').load.placement));
  console.log('PASS reverse drag unloads and undo restores cargo');
  await page.locator('#warehouseView').evaluate(n=>n.scrollIntoView({block:'center'}));
  const source=await center(page.locator('#warehouseView [data-load-id="wb"] .iso-face').first());
  await page.mouse.move(source.x,source.y);await page.mouse.down();await page.mouse.move(source.x+40,source.y+30,{steps:5});
  await page.keyboard.press('Escape');await page.mouse.up();
  assert(await page.evaluate(()=>!findLoadById('wb').load.placement));
  assert.equal(await page.locator('#cargoDragLabel').count(),0);
  console.log('PASS cancelled drag leaves cargo unchanged');
  await page.evaluate(()=>{findLoadById('wb').load.width=2;render();});
  await page.locator('#warehouseView [data-load-id="wb"] .iso-face').first().click({button:'right'});
  assert.equal(await page.locator('.cargo-context-menu [data-cargo-action="unload"]').count(),0);
  await page.locator('.cargo-context-menu [data-cargo-action="rotate"]').click();
  assert(await page.evaluate(()=>findLoadById('wb').load.rotated && !findLoadById('wb').load.placement && getLoadDimensions(findLoadById('wb').load).depth===2));
  assert(await page.locator('#warehouseView .iso-floor').count()>=140);
  console.log('PASS warehouse context rotates unplaced cargo over continuous grid');
  const cdp=await page.context().newCDPSession(page);
  for(const id of ['warehouseView','isoView']) {
    await page.locator('#'+id).evaluate(n=>n.scrollIntoView({block:'center'}));
    const p=await center(page.locator('#'+id));
    const before=await page.evaluate(id=>({yaw:id==='isoView'?cargoCamera.yaw:warehouseScene.camera.yaw,zoom:id==='isoView'?isoZoomLevel:warehouseZoom,loads:JSON.stringify(state.missions)}),id);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:p.x-25,y:p.y,id:1},{x:p.x+25,y:p.y,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x-40,y:p.y+25,id:1},{x:p.x+90,y:p.y+25,id:2}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForFunction(()=>!cargoCameraFrame);
    const after=await page.evaluate(id=>({yaw:id==='isoView'?cargoCamera.yaw:warehouseScene.camera.yaw,zoom:id==='isoView'?isoZoomLevel:warehouseZoom,loads:JSON.stringify(state.missions)}),id);
    assert.notEqual(after.yaw,before.yaw);assert.notEqual(after.zoom,before.zoom);assert.equal(after.loads,before.loads);
    console.log('PASS two-finger orbit and pinch without cargo mutation: '+id);
  }
  fs.mkdirSync('.build/container-view-check',{recursive:true});
  await page.locator('.load-layout').screenshot({path:'.build/container-view-check/warehouse-layout.png'});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log('PASS mobile layout and no JavaScript errors');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

