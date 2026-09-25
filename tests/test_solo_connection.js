const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../web/scripts/solo-connection.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(instant = '2026-09-23T12:00:00Z') {
  let wall = Date.parse(instant), mono = 100;
  const elements = Object.fromEntries(['flightClock', 'flightLocalClock', 'soloConnectionBanner', 'soloConnectionMessage', 'soloConnectionRetry']
    .map(id => [id, {hidden:true, textContent:'', dataset:{}, addEventListener(){}}]));
  const events = {}, intervals = new Map();
  const c = vm.createContext({
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [wall - 240000])); } static now() { return wall - 240000; } },
    performance:{now:()=>mono},
    document:{hidden:false, documentElement:{lang:'de'}, getElementById:id=>elements[id], addEventListener:(name,fn)=>events[name]=fn},
    window:{addEventListener:(name,fn)=>events[name]=fn},
    setInterval:(fn,ms)=>intervals.set(ms,fn),
    renderRemoteStatus(){}, soloHydrated:true, pollSoloState:async()=>{},
    soloRequestJson:async()=>({response:{ok:true},payload:{ok:true,edition:'solo',serverTime:new Date(wall).toISOString()}}),
  });
  vm.runInContext(source,c);
  return {c,api:c.window.soloConnection,elements,events,intervals,advance(ms){wall+=ms;mono+=ms;},serverNow:()=>wall};
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
  console.log('8 connection and clock tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
