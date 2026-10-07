// Run the shared renderer without loading the application or any global app state.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({channel:'msedge',headless:true});
  try {
    const page = await browser.newPage({viewport:{width:1000,height:600}});
    await page.setContent('<svg id="ship" tabindex="0" style="width:400px;height:400px"></svg><svg id="warehouse" tabindex="0" style="width:400px;height:400px"></svg>');
    await page.addScriptTag({path:path.resolve('web/scripts/cargo-scene.js')});
    await page.evaluate(() => {
      const cells=[{col:0,row:0,capacity:3}];
      const items=[{id:'box',x:0,y:0,z:0,width:1,depth:1,height:1}];
      const ship=CargoScene.create(document.getElementById('ship'));
      const warehouse=CargoScene.create(document.getElementById('warehouse'));
      const render=scene=>{scene.frame(CargoScene.bounds(cells,items));scene.render({cells,items});scene.zoom(1);};
      render(ship);render(warehouse);
      window.fixture={ship,warehouse,cells,items,render};
      fixture.disposeShip=CargoScene.bindCamera(document.getElementById('ship'),ship.camera,{onChange:()=>render(ship),onZoom:()=>ship.zoom(2)});
      fixture.disposeWarehouse=CargoScene.bindCamera(document.getElementById('warehouse'),warehouse.camera,{onChange:()=>render(warehouse)});
    });
    const warehouseMarkup=await page.locator('#warehouse').innerHTML();
    await page.locator('#ship').focus();
    await page.keyboard.press('ArrowLeft');
    assert(await page.evaluate(()=>fixture.ship.camera.yaw!==fixture.warehouse.camera.yaw));
    assert.equal(await page.locator('#warehouse').innerHTML(),warehouseMarkup);
    await page.mouse.move(200,200);await page.keyboard.down('Control');
    await page.mouse.down();await page.mouse.move(250,220,{steps:5});await page.mouse.up();
    await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
    assert(await page.evaluate(()=>document.getElementById('ship').getAttribute('viewBox')!==document.getElementById('warehouse').getAttribute('viewBox')));
    assert.equal(await page.locator('#warehouse').innerHTML(),warehouseMarkup);
    console.log('PASS independent keyboard, orbit and zoom state for two simultaneous scenes');
    await page.evaluate(()=>fixture.disposeShip());
    const stoppedCamera=await page.evaluate(()=>JSON.stringify(fixture.ship.camera));
    await page.locator('#ship').focus();await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(()=>JSON.stringify(fixture.ship.camera)),stoppedCamera);
    await page.locator('#warehouse').focus();await page.keyboard.press('ArrowRight');
    assert.notEqual(await page.locator('#warehouse').innerHTML(),warehouseMarkup);
    console.log('PASS disposing one viewport leaves the other functional');
    assert(await page.evaluate(()=>{
      const {warehouse}=fixture;
      CargoScene.setView(warehouse.camera,'reset');
      const items=[{id:'bottom',x:0,y:0,z:0,width:1,depth:1,height:1},{id:'top',x:0,y:0,z:1,width:1,depth:1,height:1}];
      let lowerTop=false,ghost=false;
      warehouse.render({items,level:0},{face:({item,definition,isContext,fragment})=>{
        if(item.id==='bottom' && definition.type==='top') lowerTop=true;
        if(item.id==='top' && isContext) ghost=true;
        return fragment.polygon;
      }});
      const emptyBounds=CargoScene.bounds([],[]);
      const preview=warehouse.preview({...items[0]},'preview');
      return lowerTop && ghost && Number.isFinite(emptyBounds.maxCol) && preview.children.length===6;
    }));
    console.log('PASS independent geometry handles ghost layers, empty scenes and placement previews');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
