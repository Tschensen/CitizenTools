const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../web/scripts/solo-sounds.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({saved = null, blockedStorage = false, brokenAudio = false, suspended = false, customWav = false, invalidWav = false, catalog = {}} = {}) {
  const handlers = new Map(), timers = [], oscillators = [], peaks = [], gains = [], requests = [], contexts = [], storage = new Map();
  if (saved !== null) storage.set('citizen-tools:interface-sounds:v1', saved);
  let now = 1000, resume;
  const node = () => ({checked:false, value:'25', textContent:'', hidden:false, dataset:{},
    addEventListener(name, handler) { this[name] = handler; }, dispatchEvent(event) {this[event.type]?.(event);}, setAttribute() {}, querySelectorAll:() => []});
  const nodes = Object.fromEntries(['soloSoundPanel', 'soloSoundEnabled', 'soloSoundVolume', 'soloSoundLevel', 'soloSoundPreview', 'soloSoundStatus', 'uiLanguageSelect', 'soloSoundSample', 'soloImportSoundsEnabled', 'soloSoundDirectory', 'soloSoundReload'].map(id => [id, node()]));
  nodes.soloSoundSample.value = 'navigation';
  const document = {hidden:false, dialogs:[], querySelector:selector => nodes[selector.slice(1)], querySelectorAll() {return this.dialogs;}, addEventListener(name, handler) {handlers.set(name, handler);}};
  class AudioContext {
    constructor() {
      if (brokenAudio) throw new Error('No audio device');
      this.state = suspended ? 'suspended' : 'running'; this.currentTime = 1; this.destination = {}; contexts.push(this);
    }
    resume() { return new Promise(resolve => {resume = () => {this.state = 'running'; resolve();};}); }
    suspend() {this.state = 'suspended'; return Promise.resolve();}
    decodeAudioData() {return invalidWav ? Promise.reject(Error('invalid WAV')) : Promise.resolve({duration:.12});}
    createBufferSource() {
      const voice = {isBuffer:true, connect() {}, disconnect() {}, start() {voice.started = true;}, stop() {voice.cancelled = true;}};
      oscillators.push(voice); return voice;
    }
    createOscillator() {
      const oscillator = {frequency:{setValueAtTime(value) {oscillator.hz = value;}, exponentialRampToValueAtTime() {}}, connect() {}, disconnect() {}, start() {oscillator.started = true;}, stop(time) {if (time === undefined) oscillator.cancelled = true;}};
      oscillators.push(oscillator); return oscillator;
    }
    createGain() {return {connect() {}, disconnect() {}, gain:{setValueAtTime(value) {gains.push(value);}, linearRampToValueAtTime(value) {peaks.push(value);}, exponentialRampToValueAtTime() {}}};}
  }
  const window = {AudioContext};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../web/scripts/sound-presets.js'), 'utf8'), {window});
  vm.runInNewContext(source, {window, document, Event, AbortSignal, fetch:async url => {requests.push(url); return url.endsWith('/api/solo/sounds') ? {ok:true, json:async () => ({sounds:catalog})} : {ok:customWav, arrayBuffer:async () => new ArrayBuffer(32)};}, performance:{now:() => now}, currentUiLanguage:() => 'de',
    setTimeout:fn => timers.push(fn), localStorage:{getItem:key => {if (blockedStorage) throw Error('blocked'); return storage.get(key);}, setItem:(key,value) => {if (blockedStorage) throw Error('blocked'); storage.set(key,value);}}, console});
  const button = ({nav = false, primary = false, disabled = false, form = null, type = 'button'} = {}) => ({disabled, form, type,
    closest:() => null, getAttribute:() => null, getClientRects:() => [1], matches:selector => selector.includes('.module-tab') ? nav : primary});
  function click(target = button({nav:true}), trusted = true) {handlers.get('click')({isTrusted:trusted, target:{closest:() => target}});}
  async function flush() {while (timers.length) timers.shift()(); await tick();}
  async function enable(value) {nodes.soloSoundEnabled.checked = value; nodes.soloSoundEnabled.change({isTrusted:true}); await tick(); now += 100;}
  async function volume(value) {nodes.soloSoundVolume.value = String(value); nodes.soloSoundVolume.input({isTrusted:true}); await tick(); now += 100;}
  return {nodes, contexts, oscillators, peaks, gains, requests, storage, document, handlers, window, click, flush, enable, volume, button,
    advance:() => {now += 100;}, resume:() => resume()};
}

(async () => {
  let count = 0;
  // Silent startup, disabled default and scripted/background activity.
  {
    const f = fixture();
    assert.equal(f.nodes.soloSoundEnabled.checked, false);
    f.click(); await f.flush();
    assert.equal(f.contexts.length, 0);
    f.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.equal(f.oscillators.length, 2, 'Preview works while disabled, without enabling regular sounds');
    assert.equal(f.nodes.soloSoundEnabled.checked, false);
    count++;
  }
  {
    const f = fixture({saved:'{"enabled":true,"volume":20}'});
    assert.equal(f.contexts.length, 0, 'Remembered preference must not autoplay');
    f.click(undefined, false); await f.flush();
    assert.equal(f.contexts.length, 0, 'Programmatic clicks stay silent');
    f.click(); await f.flush();
    assert.deepEqual(f.oscillators.map(x => x.hz), [1080, 1540]);
    assert.ok(f.peaks.every(value => value <= .024));
    count++;
  }
  // Immediate mute including an in-progress preview, persisted per device.
  {
    const f = fixture();
    await f.enable(true);
    await f.volume(0);
    assert.ok(f.oscillators.every(x => x.cancelled));
    const before = f.oscillators.length;
    f.click(); f.window.soloSound.preview('navigation', {isTrusted:true}); await f.flush();
    assert.equal(f.oscillators.length, before);
    const saved = JSON.parse(f.storage.get('citizen-tools:interface-sounds:v1'));
    assert.equal(saved.enabled, true); assert.equal(saved.volume, 0); assert.equal(saved.imports, true);
    count++;
  }
  // Rapid clicks replace pending cues, and hidden views cannot emit sounds.
  {
    const f = fixture({saved:'{"enabled":true,"volume":25}'});
    for (let i = 0; i < 20; i++) f.click();
    await f.flush();
    assert.equal(f.oscillators.length, 2);
    f.document.hidden = true; f.handlers.get('visibilitychange')();
    assert.ok(f.oscillators.every(x => x.cancelled));
    f.advance(); f.click(); await f.flush();
    assert.equal(f.oscillators.length, 2);
    count++;
  }
  // Actual form validation overrides the submit confirmation; dialogs have one cue.
  {
    const f = fixture({saved:'{"enabled":true,"volume":25}'});
    const form = {}, button = f.button({primary:true, form});
    f.click(button);
    f.handlers.get('invalid')({isTrusted:true, target:{form}});
    await f.flush();
    assert.deepEqual(f.oscillators.map(x => x.hz), [280, 190]);
    f.advance(); f.click(); f.document.dialogs = [{querySelector:() => null}]; await f.flush();
    assert.deepEqual(f.oscillators.slice(2).map(x => x.hz), [480, 960]);
    count++;
  }
  // Async completion requires a user action and must not survive mute/re-enable.
  {
    const f = fixture({saved:'{"enabled":true,"volume":25}'});
    const complete = f.window.soloSound.feedbackFor({isTrusted:true});
    await f.enable(false); await f.enable(true);
    const before = f.oscillators.length;
    complete('confirm'); await tick();
    f.window.soloSound.feedbackFor({isTrusted:false})('error'); await tick();
    assert.equal(f.oscillators.length, before);
    f.advance(); const error = f.window.soloSound.feedbackFor({isTrusted:true});
    error('error'); error('error'); await tick();
    assert.equal(f.oscillators.length, before + 2, 'Completion is consumed once');
    count++;
  }
  // Delayed browser audio unlock cannot resurrect a muted preview.
  {
    const f = fixture({suspended:true});
    f.window.soloSound.preview('navigation', {isTrusted:true});
    await f.volume(0); f.resume(); await tick();
    assert.equal(f.oscillators.length, 0);
    count++;
  }
  // No audio device, blocked storage and corrupt preferences remain non-fatal.
  {
    const f = fixture({blockedStorage:true, brokenAudio:true});
    await f.enable(true);
    assert.match(f.nodes.soloSoundStatus.textContent, /Audio/);
    assert.equal(f.oscillators.length, 0);
    assert.equal(fixture({saved:'broken JSON'}).nodes.soloSoundEnabled.checked, false);
    assert.equal(fixture({saved:'{"enabled":"true","volume":800}'}).nodes.soloSoundEnabled.checked, false);
    assert.equal(fixture({saved:'{"volume":800}'}).nodes.soloSoundLevel.textContent, '100 %');
    count++;
  }
  {
    const f = fixture({customWav:true});
    f.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.equal(f.oscillators.length, 1);
    assert.ok(f.oscillators[0].isBuffer, 'Personal WAV is played instead of synthesizing');
    f.nodes.soloSoundReload.click();
    assert.ok(f.oscillators[0].cancelled);
    f.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.equal(f.oscillators.length, 2);
    const bad = fixture({customWav:true, invalidWav:true});
    bad.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.deepEqual(bad.oscillators.map(x => x.hz), [1080, 1540], 'Broken WAV falls back to the original cue');
    count++;
  }
  {
    const f = fixture({saved:'{"enabled":true,"volume":25}'});
    f.document.hidden = true;
    await f.window.soloSound.playImport('import-success');
    assert.equal(f.oscillators.length, 3, 'Opted-in import cues work in the background');
    f.nodes.soloImportSoundsEnabled.checked = false;
    f.nodes.soloImportSoundsEnabled.change();
    await f.window.soloSound.playImport('import-failure');
    assert.equal(f.oscillators.length, 3, 'Import switch immediately mutes that channel');
    assert.ok(f.oscillators.every(x => x.cancelled));
    count++;
  }
  {
    const f = fixture({customWav:true, catalog:{navigation:{available:true, filename:'my-clip.wav', revision:'r1'}}}); await tick();
    assert.equal(f.window.soloSound.cue('navigation').source, 'custom', 'Existing personal file is migrated');
    f.window.soloSound.setCue('navigation', {volume:40});
    f.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.equal(f.gains.at(-1), .1, 'Master 25% × cue 40% = 10%');
    assert.ok(f.requests.includes('./api/solo/sounds/navigation.wav'));
    f.window.soloSound.setCue('navigation', {source:'standard'});
    f.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.ok(f.requests.includes('./assets/sounds/navigation.wav'), 'Default bypasses the personal file');
    const before = f.oscillators.length;
    f.window.soloSound.setCue('navigation', {volume:0});
    f.window.soloSound.preview('navigation', {isTrusted:true}); await tick();
    assert.equal(f.oscillators.length, before, 'One cue can be muted independently');
    f.window.soloSound.preview('confirm', {isTrusted:true}); await tick();
    assert.equal(f.oscillators.length, before + 1);
    const saved = f.storage.get('citizen-tools:interface-sounds:v1');
    const reloaded = fixture({saved, catalog:{navigation:{available:true, revision:'r2'}}}); await tick();
    assert.equal(reloaded.window.soloSound.cue('navigation').volume, 0);
    assert.equal(reloaded.window.soloSound.cue('navigation').source, 'standard', 'Reload must preserve an explicit Default choice');
    count++;
  }
  console.log(`${count} interface sound tests passed.`);
})().catch(error => {console.error(error); process.exitCode = 1;});
