const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/scripts/solo-connection.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(instant = '2026-09-23T12:00:00Z', storage = new Map()) {
  let wall = Date.parse(instant), mono = 100;
  let reloads = 0;
  const elements = Object.fromEntries(['flightClock', 'flightLocalClock', 'soloConnectionBanner', 'soloConnectionMessage', 'soloConnectionRetry']
    .map(id => [id, {hidden:true, textContent:'', dataset:{}, addEventListener(name,fn){this[name]=fn;}}]));
  const events = {}, intervals = new Map();
  const c = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [wall - 240000])); } static now() { return wall - 240000; } },
    performance:{now:()=>mono},
    document:{hidden:false, documentElement:{lang:'de'}, getElementById:id=>elements[id], addEventListener:(name,fn)=>events[name]=fn,
      querySelectorAll:()=>[{dataset:{page:'hub'}},{dataset:{page:'run'}}]},
    window:{addEventListener:(name,fn)=>events[name]=fn,soloClientVersion:'test-current',location:{search:'',reload:()=>reloads++}},
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    URLSearchParams, queueMicrotask,
    activePage:'run', soloSync:{status:{hydrated:true,pending:false,saving:false,scheduled:false,busy:false,
      get hasUnsaved(){return this.pending || this.saving || this.scheduled;}}}, missionAutoImportBusy:false,soloEditing:()=>false,
    setInterval:(fn,ms)=>intervals.set(ms,fn),
    renderRemoteStatus(){}, pollSoloState:async()=>{},
    soloRequestJson:async()=>({response:{ok:true},payload:{ok:true,edition:'solo',serverTime:new Date(wall).toISOString()}}),
  });
  vm.runInContext(source,c);
  c.setActivePage=page=>{c.activePage=page;};
  c.requireSoloReload=()=>{c.window.soloUpdateRequired=true;c.window.soloConnection.requireReload();};
  return {c,api:c.window.soloConnection,elements,events,intervals,storage,get reloads(){return reloads;},advance(ms){wall+=ms;mono+=ms;},serverNow:()=>wall};
}

function updatedServer(f) {
  f.c.soloRequestJson=async()=>({response:{ok:true},payload:{ok:true,edition:'solo',version:'test-new',serverTime:new Date(f.serverNow()).toISOString()}});
}

(async()=>{
  {
    const f=fixture(); f.api.start(); await f.api.probe();
    assert.equal(f.api.phase,'online');
    assert.equal(Date.parse(f.elements.flightClock.dateTime),f.serverNow(),'PC time corrects a slow tablet');
    assert.equal(f.elements.flightLocalClock.dateTime, f.elements.flightClock.dateTime, 'Both clocks use the same aligned instant');
    assert.equal(f.elements.soloConnectionBanner.hidden,true);
    f.c.soloRequestJson=async()=>{throw new Error('stopped');};
    await f.api.probe();
    assert.equal(f.api.phase,'offline');
    assert.equal(f.elements.soloConnectionBanner.hidden,false);
    f.advance(240000); f.intervals.get(1000)();
    assert.equal(Date.parse(f.elements.flightClock.dateTime),f.serverNow(),'The clock advances using actual elapsed time, not interval counts');
    assert.equal(f.elements.flightLocalClock.dateTime, f.elements.flightClock.dateTime, 'Both clocks keep advancing while disconnected');
  }
  {
    const f=fixture(); let calls=0,release;
    f.c.soloRequestJson=async()=>{calls++;return new Promise(resolve=>release=resolve);};
    f.api.start(); void f.api.probe(); void f.api.probe();
    assert.equal(calls,1,'Normal polls do not overlap');
    release({response:{ok:true},payload:{ok:true,edition:'solo',serverTime:new Date(f.serverNow()).toISOString()}});
    await f.api.probe(); assert.equal(f.api.phase,'online');
  }
  {
    const f=fixture(); let releaseOld;
    f.c.soloRequestJson=async()=>new Promise(resolve=>releaseOld=resolve);
    f.api.start(); f.advance(300000);
    f.c.soloRequestJson=async()=>({response:{ok:true},payload:{ok:true,edition:'solo',serverTime:new Date(f.serverNow()).toISOString()}});
    f.events.pageshow(); await f.api.probe();
    releaseOld({response:{ok:true},payload:{ok:true,edition:'solo',serverTime:'2000-01-01T00:00:00Z'}});
    await tick();
    assert.equal(f.api.phase,'online');
    assert.equal(Date.parse(f.elements.flightClock.dateTime),f.serverNow(),'A late pre-sleep response cannot reset the clock');
  }
  {
    const f=fixture(); f.c.soloRequestJson=async()=>({response:{ok:true},payload:{ok:true,edition:'other',serverTime:new Date().toISOString()}});
    f.api.start(); await f.api.probe();
    assert.equal(f.api.phase,'offline','An unrelated HTTP service is not a running suite');
  }
  {
    const f=fixture(); let count=0;
    const original=f.c.soloRequestJson;
    f.c.soloRequestJson=async()=>{count++;return original();};
    f.api.start(); await f.api.probe();
    f.c.document.hidden=true; f.intervals.get(5000)();
    assert.equal(count,1,'Hidden pages do not send heartbeat polls');
    f.c.document.hidden=false; f.events.visibilitychange(); await f.api.probe();
    assert.equal(count,2,'Visibility resumes immediately');
  }
  const originalZone = process.env.TZ;
  try {
    process.env.TZ = 'Europe/Berlin';
    const spring = fixture('2026-03-29T00:59:59Z'); spring.api.start(); await spring.api.probe();
    assert.equal(spring.elements.flightLocalClock.textContent, '01:59:59');
    spring.advance(1000); spring.intervals.get(1000)();
    assert.equal(spring.elements.flightClock.textContent, '01:00:00');
    assert.equal(spring.elements.flightLocalClock.textContent, '03:00:00', 'Local time follows the summer-time transition');
    const autumn = fixture('2026-10-25T00:59:59Z'); autumn.api.start(); await autumn.api.probe();
    assert.equal(autumn.elements.flightLocalClock.textContent, '02:59:59');
    autumn.advance(1000); autumn.intervals.get(1000)();
    assert.equal(autumn.elements.flightLocalClock.textContent, '02:00:00', 'Local time follows the winter-time transition');
    process.env.TZ = 'Asia/Kathmandu';
    const midnight = fixture('2026-09-24T18:15:00Z'); midnight.api.start(); await midnight.api.probe();
    assert.equal(midnight.elements.flightClock.textContent, '18:15:00');
    assert.equal(midnight.elements.flightLocalClock.textContent, '00:00:00', 'Non-whole-hour zones and midnight use a 24-hour clock');
    assert.ok(midnight.elements.flightLocalClock.title.includes('Ortszeit'));
    midnight.c.document.documentElement.lang='en';midnight.api.render();
    assert.ok(midnight.elements.flightLocalClock.title.includes('Local time'));
  } finally {
    if (originalZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalZone;
  }
  {
    const f=fixture();let reloads=0,polls=0;
    f.c.soloEditing=()=>true;
    f.c.window.location={reload:()=>reloads++};
    f.c.pollSoloState=async()=>polls++;
    f.c.soloRequestJson=async()=>({response:{ok:true},payload:{ok:true,edition:'solo',version:'test-new',serverTime:new Date(f.serverNow()).toISOString()}});
    f.api.start();await f.api.probe();
    assert.equal(f.api.phase,'update-required');
    assert.equal(f.elements.soloConnectionBanner.hidden,false);
    assert.ok(f.elements.soloConnectionMessage.textContent.includes('aktualisiert'));
    assert.equal(f.elements.soloConnectionRetry.textContent,'Ansicht neu laden');
    assert.equal(polls,0,'An outdated view must not refresh state after reconnecting');
    await f.api.probe();
    assert.equal(f.api.phase,'update-required','A successful heartbeat must not hide the update notice');
    f.c.document.documentElement.lang='en';f.api.render();
    assert.ok(f.elements.soloConnectionMessage.textContent.includes('updated'));
    assert.equal(f.elements.soloConnectionRetry.textContent,'Reload view');
    f.elements.soloConnectionRetry.click();
    assert.equal(reloads,1);
  }
  {
    const f=fixture();updatedServer(f);f.api.start();await f.api.probe();
    assert.equal(f.reloads,1,'A passive external view reloads on an app version change');
    await f.api.probe();assert.equal(f.reloads,1,'Only one navigation is requested');
    const cached=fixture(undefined,f.storage);updatedServer(cached);cached.api.start();await cached.api.probe();
    assert.equal(cached.reloads,0,'A stale page returned by a cache cannot cause a reload loop');
    assert.equal(cached.api.phase,'update-required');
    const refreshed=fixture(undefined,f.storage);refreshed.c.window.soloClientVersion='test-new';refreshed.c.activePage='hub';
    updatedServer(refreshed);refreshed.api.start();await refreshed.api.probe();
    assert.equal(refreshed.c.activePage,'run','The flight plan is restored after the automatic reload');
    assert.equal(refreshed.api.phase,'online');assert.equal(refreshed.reloads,0);
    assert.equal(f.storage.size,0,'A successful update clears the retry marker');
  }
  {
    for(const lock of ['pending','saving','scheduled','busy','missionAutoImportBusy']) {
      const f=fixture();if(lock === 'missionAutoImportBusy') f.c[lock]=true; else f.c.soloSync.status[lock]=true;updatedServer(f);f.api.start();await f.api.probe();
      assert.equal(f.reloads,0,`${lock} prevents an automatic reload`);
      if(lock === 'missionAutoImportBusy') f.c[lock]=false; else f.c.soloSync.status[lock]=false;
      await f.api.probe();assert.equal(f.reloads,1,'A later check can reload when the operation has finished');
    }
    for(const hold of [f=>f.c.window.location.search='?desktop=1',f=>f.c.window.personalTransferBusy=true,f=>f.c.document.hidden=true,f=>f.c.soloEditing=()=>true]) {
      const f=fixture();hold(f);updatedServer(f);f.api.start();await f.api.probe();assert.equal(f.reloads,0);
    }
  }
  {
    for(const event of ['input','change']) {
      const f=fixture(),form={isConnected:true};
      f.events[event]({target:{form,matches:()=>true}});updatedServer(f);f.api.start();await f.api.probe();
      assert.equal(f.reloads,0,'A draft stays protected after its field loses focus');
      f.events.reset({target:form,defaultPrevented:true});await tick();await f.api.probe();assert.equal(f.reloads,0);
      f.events.reset({target:form,defaultPrevented:false});await tick();await f.api.probe();assert.equal(f.reloads,1,'A discarded/reset form releases the draft protection');
    }
  }
  {
    const f=fixture();f.c.sessionStorage.setItem=()=>{throw new Error('disabled');};
    updatedServer(f);f.api.start();await f.api.probe();assert.equal(f.reloads,0);
    assert.equal(f.api.phase,'update-required','Unavailable session storage falls back to the reload button');
  }
  {
    for(const event of ['click','pointerdown']) {
      const f=fixture(),form={isConnected:true};
      f.events[event]({target:{closest:()=>event==='click'?{form}:{closest:()=>form}}});
      updatedServer(f);f.api.start();await f.api.probe();
      assert.equal(f.reloads,0,'Form buttons and grid painting also protect unsaved drafts');
    }
  }
  console.log('Connection, clock and automatic update tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
