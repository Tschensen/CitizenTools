const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = fs.readFileSync(path.join(__dirname, '../web/scripts/solo-import-sounds.js'), 'utf8');

function fixture() {
  const played = [], timers = new Map();
  let enabled = true, clock = Date.now(), nextTimer = 0;
  const window = {soloSound:{canImport:() => enabled, playImport:async name => {played.push(name); return .1;}, stopImport() {}, unlock() {}}};
  vm.runInNewContext(source, {window, Date:{now:() => clock, parse:Date.parse},
    setTimeout:fn => {timers.set(++nextTimer, fn); return nextTimer;}, clearTimeout:id => timers.delete(id)});
  return {played, audio:window.soloImportSounds, mute:() => {enabled = false; window.soloImportSounds.clear();},
    async drain() {await tick(); while (timers.size) {const [id, fn] = timers.entries().next().value; timers.delete(id); fn(); await tick();}},
    job:(id,status) => ({id,status,createdAt:new Date(clock + 1).toISOString()})};
}

(async () => {
  let count = 0;
  {
    const f = fixture();
    f.audio.observe([f.job('old', 'completed')]); await f.drain();
    assert.deepEqual(f.played, [], 'Old results are silent when opening the app');
    for (const state of ['queued', 'processing', 'completed']) {
      f.audio.observe([f.job('new', state)]); await f.drain();
      f.audio.observe([f.job('new', state)]); await f.drain();
    }
    assert.deepEqual(f.played, ['import-read', 'import-processing', 'import-success']);
    count++;
  }
  {
    const f = fixture(); f.audio.observe([]);
    f.audio.observe([f.job('fast', 'processing')]); await f.drain();
    f.audio.observe([f.job('fast', 'failed')]); await f.drain();
    f.audio.observe([f.job('fast', 'failed')]); await f.drain();
    assert.deepEqual(f.played, ['import-read', 'import-processing', 'import-failure']);
    count++;
  }
  {
    const f = fixture();
    assert.equal(f.audio.begin({isTrusted:false}), null);
    const work = f.audio.begin({isTrusted:true}); await f.drain();
    work.processing(); await f.drain(); work.error(); await f.drain(); work.success(); await f.drain();
    assert.deepEqual(f.played, ['import-read', 'import-processing', 'import-failure']);
    count++;
  }
  {
    const f = fixture();
    const work = f.audio.begin({isTrusted:true});
    work.processing(); work.cancel(); work.success(); await f.drain();
    assert.deepEqual(f.played, ['import-read'], 'Cancel drops processing and late completion');
    count++;
  }
  {
    const f = fixture(); const work = f.audio.begin({isTrusted:true}); await f.drain();
    f.mute(); work.processing(); work.success(); await f.drain();
    assert.deepEqual(f.played, ['import-read']); count++;
  }
  // Verify the real OCR handler reports semantic success/failure, not HTTP alone.
  async function runOcr({recognized = true, ok = true, cancel = false} = {}) {
    const events = []; let finish;
    const sound = {processing:() => events.push('processing'), success:() => events.push('success'), error:() => events.push('error'), cancel:() => events.push('cancel')};
    const c = vm.createContext({window:{soloImportSounds:{begin:() => {events.push('read'); return sound;}}}, missionImportRequestId:0,
      missionImportPreview:{hidden:true}, selectedMissionImportId:'', OCR_URL:'/api/ocr', t:key => key,
      fetch:() => new Promise(resolve => {finish = () => resolve({ok,json:async () => ({ok,text:'OCR text'})});}),
      parseMissionObjectiveText:() => ({routes:recognized ? [{}] : []})});
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../web/scripts/mission-import-ui.js'), 'utf8'), c);
    Object.assign(c, {renderMissionImportInbox() {}, showMissionImportImage() {}, setMissionImportBusy() {}, setMissionImportStatus() {}, renderMissionImportPreview() {}, parseMissionObjectiveText:() => ({routes:recognized ? [{}] : []})});
    const run = c.importMissionScreenshot({type:'image/png'}, {isTrusted:true});
    if (cancel) {vm.runInContext('missionImportRequestId += 1; missionImportSound.cancel()', c);}
    finish(); await run;
    return events;
  }
  assert.deepEqual(await runOcr(), ['read', 'processing', 'success']); count++;
  assert.deepEqual(await runOcr({recognized:false}), ['read', 'processing', 'error']); count++;
  assert.deepEqual(await runOcr({ok:false}), ['read', 'processing', 'error']); count++;
  assert.deepEqual(await runOcr({cancel:true}), ['read', 'processing', 'cancel']); count++;
  console.log(`${count} import lifecycle sound tests passed.`);
})().catch(error => {console.error(error); process.exitCode = 1;});
