const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../web/scripts/solo-loader.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(files, request) {
  const timers = new Map(), requests = [], executed = [], nodes = [];
  let serial = 0;
  const soundControls = [{disabled:false}, {disabled:true}];
  const soundStatus = {hidden:true, textContent:''};
  const soundPanel = {querySelectorAll:() => soundControls};
  const entries = files.map(([name, optional]) => ({dataset:{soloSrc:name, soloOptional:optional}}));
  const window = {soloErrors:[], soloLoadErrors:[], location:{reload() {window.reloaded = true;}}};
  let context;
  const document = {
    baseURI:'http://192.168.2.10:4174/', documentElement:{lang:'de'},
    createElement(tag) {
      const node = {tag, style:{}, textContent:'', children:[], setAttribute(key,value) {this[key]=value;},
        append(...children) {this.children.push(...children);}, remove() {this.removed=true;},
        addEventListener(name, callback) {this[name]=callback;}};
      nodes.push(node); return node;
    },
    body:{append() {}},
    head:{append(script) {
      executed.push(script.textContent);
      try { vm.runInContext(script.textContent, context); }
      catch (error) { window.soloErrors.push(error.message); }
      // Deliberately never dispatch a script load event. Inline execution must
      // finish startup without waiting for an event or racing a tablet timer.
    }},
    querySelector:selector => selector === '#soloSoundPanel' ? soundPanel : soundStatus,
    querySelectorAll:selector => selector.includes('optional') ? entries.filter(entry => entry.dataset.soloOptional) : entries,
  };
  context = vm.createContext({window, document, URL, AbortController,
    setTimeout(callback, delay) {const id=++serial; timers.set(id,{callback,delay}); return id;},
    clearTimeout:id => timers.delete(id),
    fetch(url, options) {requests.push(url); return request(url, options, requests.filter(value => value === url).length);},
  });
  vm.runInContext(source, context);
  return {window, nodes, executed, requests, timers, soundControls, soundStatus,
    async fire(delay) {
      const entry = [...timers].find(([,timer]) => timer.delay === delay);
      assert.ok(entry, `expected timer ${delay}`);
      timers.delete(entry[0]); entry[1].callback(); await tick();
    },
  };
}
const response = code => Promise.resolve({ok:true, text:async () => code});

test('LAN scripts execute once in order, sharing globals without a load-event timeout', async () => {
  const f = fixture([['first.js'], ['app.js']], name => response(name === 'first.js'
    ? 'const sharedValue = 42;' : 'window.value = sharedValue; window.soloAppReady = true;'));
  await tick();
  assert.equal(f.window.soloStartup.phase, 'ready');
  assert.equal(f.window.value, 42);
  assert.equal(f.executed.length, 2);
  assert.equal(f.timers.size, 0);
  assert.match(f.executed[0], /sourceURL=http:\/\/192\.168\.2\.10:4174\/first\.js/);
});

test('a timed-out body is aborted and retried; its late result never executes', async () => {
  let lateBody, firstSignal;
  const f = fixture([['app.js']], (name, options, attempt) => {
    if (attempt > 1) return response('window.executions = (window.executions || 0) + 1; window.soloAppReady = true;');
    firstSignal = options.signal;
    return Promise.resolve({ok:true, text:() => new Promise(resolve => {lateBody=resolve;})});
  });
  await tick(); await f.fire(15000);
  assert.equal(firstSignal.aborted, true);
  await f.fire(250);
  assert.equal(f.window.soloStartup.phase, 'ready');
  lateBody('window.executions = 999;'); await tick();
  assert.equal(f.window.executions, 1);
  assert.equal(f.requests.length, 2);
});

test('permanent core download failure keeps a working reload action', async () => {
  const f = fixture([['app.js']], () => Promise.resolve({ok:false}));
  await tick(); await f.fire(250); await f.fire(500);
  assert.equal(f.window.soloStartup.phase, 'failed');
  assert.equal(f.requests.length, 3);
  assert.equal(f.executed.length, 0);
  f.nodes.find(node => node.tag === 'button').click();
  assert.equal(f.window.reloaded, true);
});

test('a core execution error stops dependent scripts and is never retried', async () => {
  const f = fixture([['broken.js'], ['app.js']], () => response('throw new Error("broken core");'));
  await tick();
  assert.equal(f.window.soloStartup.phase, 'failed');
  assert.deepEqual(f.requests, ['broken.js']);
});

test('missing audio cannot block the ready application or its later core modules', async () => {
  const f = fixture([['solo-sounds.js','audio'], ['app.js'], ['telemetry.js']], name => name === 'solo-sounds.js'
    ? new Promise(() => {}) : response(name === 'app.js' ? 'window.soloAppReady = true;' : 'window.telemetryReady = true;'));
  await tick();
  assert.equal(f.window.soloStartup.phase, 'ready');
  assert.equal(f.window.telemetryReady, true);
  assert.equal(f.nodes[0].removed, true);
  await f.fire(15000); await f.fire(250); await f.fire(15000); await f.fire(500); await f.fire(15000);
  assert.equal(f.window.soloStartup.phase, 'ready');
  assert.equal(f.window.soloStartup.optionalErrors.length, 1);
  assert.equal(f.window.soloErrors.length, 0);
  assert.equal(f.soundStatus.hidden, false);
  assert.ok(f.soundControls.every(control => control.disabled));
});

test('audio executes after core startup and restores the original disabled controls', async () => {
  const f = fixture([['presets.js','audio'], ['sound.js','audio'], ['app.js']], name => response(name === 'app.js'
    ? 'window.soloAppReady = true;' : name === 'presets.js' ? 'const tone = 440;' : 'window.tone = tone;'));
  await tick();
  assert.deepEqual(f.requests, ['app.js','presets.js','sound.js']);
  assert.equal(f.window.tone, 440);
  assert.deepEqual(f.soundControls.map(control => control.disabled), [false,true]);
});

test('audio execution errors leave the app usable and skip dependent audio modules', async () => {
  const f = fixture([['app.js'], ['sound.js','audio'], ['sound-settings.js','audio']], name => response(name === 'app.js'
    ? 'window.soloAppReady = true;' : 'throw new Error("audio unavailable");'));
  await tick();
  assert.equal(f.window.soloStartup.phase, 'ready');
  assert.equal(f.window.soloStartup.optionalErrors[0], 'audio unavailable');
  assert.deepEqual(f.requests, ['app.js','sound.js']);
});

test('optional audio failure does not hide unrelated asynchronous app errors', async () => {
  let finishAudio;
  const f = fixture([['app.js'], ['sound.js','audio']], name => name === 'app.js'
    ? response('window.soloAppReady = true;') : new Promise(resolve => {finishAudio=resolve;}));
  await tick();
  f.window.soloErrors.push('unrelated app error');
  finishAudio({ok:true,text:async () => 'throw new Error("audio unavailable");'});
  await tick();
  assert.deepEqual(f.window.soloErrors, ['unrelated app error']);
  assert.equal(f.window.soloStartup.optionalErrors[0], 'audio unavailable');
});
