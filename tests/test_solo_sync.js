const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create: createSync } = require('../web/scripts/state-sync.js');
const { create: createStore } = require('../web/scripts/state-store.js');
const { create: createStorage } = require('../web/scripts/state-storage.js');
const { create: createApi } = require('../web/scripts/state-api.js');
const { equal, merge } = require('../web/scripts/solo-merge.js');
const clone = value => structuredClone(value);
const response = (status, payload) => ({status, ok:status>=200&&status<300, json:async()=>clone(payload)});
const deferred = () => { let resolve; const promise=new Promise(done=>resolve=done); return {promise,resolve}; };
async function fixture({initial={missions:[],marker:'local'}, remote=initial, hydrate=true, storageFailure=false}={}) {
  let state=clone(initial), editing=false, paused=false;
  const memory=new Map(), writes=[], events=[], timers=new Map();
  const transport = {fetch:async(_url, options={}) => {
    if (options.method === 'POST') {writes.push(JSON.parse(options.body)); return response(200,{updatedAt:'r'+(writes.length+1)});}
    return response(200,{state:remote,updatedAt:remote ? 'r1' : null});
  }};
  const storage=createStorage({key:'test',storage:{
    getItem:key=>memory.get(key) ?? null,
    setItem:(key,value)=>{if(storageFailure)throw new Error('quota');memory.set(key,value);},
  }});
  const store=createStore({read:()=>state,replace:value=>state=value,defaults:()=>({missions:[]}),
    normalize:clone,clone,equal,storage});
  let sync;
  const api=createApi({fetch:(...args)=>transport.fetch(...args),clientVersion:()=> 'current',
    onVersionMismatch:()=>sync.blockForUpdate()});
  sync=createSync({store,api,equal,merge,isEditing:()=>editing,isPaused:()=>paused,
    onRender:()=>events.push('render'),onMeta:()=>events.push('meta'),onOffline:()=>events.push('offline'),
    onConflict:()=>events.push('conflict'),onReload:()=>events.push('reload'),
    timers:{setTimeout:fn=>{const id={};timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)}});
  if(hydrate) await sync.hydrate();
  events.length=0;
  return {sync,store,storage,api,transport,writes,events,timers,memory,
    get state(){return state;},set state(value){state=clone(value);},
    edit(value){state=clone(value);sync.schedule(state);},
    editing(value){editing=value;},paused(value){paused=value;}};
}

test('a read without adoption cannot acknowledge a revision; passive refresh never writes', async()=>{
  const f=await fixture();
  f.transport.fetch=async()=>response(200,{state:{missions:[],marker:'peer'},updatedAt:'r2'});
  await f.api.fetchState();
  assert.equal(f.sync.status.revision,'r1');
  await f.sync.poll();
  assert.equal(f.state.marker,'peer');
  assert.equal(f.sync.status.revision,'r2');
  f.sync.schedule(f.state); await f.sync.flush();
  assert.equal(f.writes.length,0);
});
test('conflicting edits recover the local snapshot before adopting the shared state', async()=>{
  const f=await fixture();
  f.transport.fetch=async()=>response(409,{state:{missions:[],marker:'peer'},updatedAt:'r2'});
  assert.equal(await f.sync.save({missions:[],marker:'PC'}),false);
  assert.equal(f.state.marker,'peer');
  assert.equal(f.storage.readRecovery().marker,'PC');
  assert.ok(f.events.includes('conflict'));
  assert.equal(f.sync.status.pending,false);
});
test('edits made during a save are serialized against the newly committed revision', async()=>{
  const f=await fixture(), gate=deferred(), writes=[];
  f.transport.fetch=async(_url,options)=>{
    writes.push(JSON.parse(options.body));
    if(writes.length===1) await gate.promise;
    return response(200,{updatedAt:'r'+(writes.length+1)});
  };
  const first=f.sync.save({marker:'first'}), second=f.sync.save({marker:'second'});
  gate.resolve(); await Promise.all([first,second]);
  assert.deepEqual(writes.map(w=>w.baseUpdatedAt),['r1','r2']);
  assert.deepEqual(writes.map(w=>w.state.marker),['first','second']);
});
test('reverting an edit while its first save is in flight is also committed', async()=>{
  const f=await fixture(), original=clone(f.state), gate=deferred(), writes=[];
  f.transport.fetch=async(_url,options)=>{
    writes.push(JSON.parse(options.body)); if(writes.length===1) await gate.promise;
    return response(200,{updatedAt:'r'+(writes.length+1)});
  };
  const first=f.sync.save({...original,marker:'temporary'}), second=f.sync.save(original);
  gate.resolve();await Promise.all([first,second]);
  assert.equal(writes.length,2);
  assert.deepEqual(writes[1].state,original);
});
test('network failure retains the latest queued edit for reconnection', async()=>{
  const f=await fixture();
  f.transport.fetch=async()=>{throw new Error('stopped');};
  assert.equal(await f.sync.save({marker:'offline'}),false);
  assert.ok(f.sync.status.pending);
  f.transport.fetch=async(_url,options)=>{f.writes.push(JSON.parse(options.body));return response(200,{updatedAt:'r2'});};
  await f.sync.poll();
  assert.equal(f.writes[0].state.marker,'offline');
  assert.equal(f.writes[0].baseUpdatedAt,'r1');
});
test('a delayed read cannot undo a PC save completed while the read was in flight', async()=>{
  const f=await fixture(), gate=deferred();
  f.transport.fetch=async(_url,options={})=>options.method==='POST'
    ?response(200,{updatedAt:'r2'}):gate.promise;
  const read=f.sync.refresh();
  f.edit({missions:[],marker:'local',runRouteOrder:{ship:['b','a']}});
  assert.equal(await f.sync.flush(),true);
  gate.resolve(response(200,{state:{missions:[],marker:'old'},updatedAt:'r1'}));
  assert.equal(await read,false);
  assert.deepEqual(f.state.runRouteOrder,{ship:['b','a']});
  assert.equal(f.sync.status.revision,'r2');
});
test('typing, dragging and focus acquired during a read defer state adoption', async()=>{
  const f=await fixture(), gate=deferred();
  f.editing(true);f.transport.fetch=async()=>{throw new Error('must not read');};
  assert.equal(await f.sync.poll(),false);
  f.editing(false);f.transport.fetch=()=>gate.promise;
  const read=f.sync.refresh();f.editing(true);
  gate.resolve(response(200,{state:{marker:'peer'},updatedAt:'r2'}));await read;
  assert.equal(f.state.marker,'local');assert.equal(f.sync.status.revision,'r1');
});
test('independent edits, deletions and route order survive a concurrent import', async()=>{
  const initial={missions:[{id:'a',title:'A'},{id:'b',title:'B'}],runRouteOrder:{ship:['a','b']}};
  const f=await fixture({initial}), writes=[];
  const remote={...initial,missions:[...initial.missions,{id:'ocr',title:'Imported'}]};
  const local={missions:[{id:'a',title:'Edited'}],runRouteOrder:{ship:['b','a']}};
  f.transport.fetch=async(_url,options)=>{
    writes.push(JSON.parse(options.body));return writes.length===1
      ?response(409,{state:remote,updatedAt:'r2'}):response(200,{updatedAt:'r3'});
  };
  assert.equal(await f.sync.save(local),true);
  assert.deepEqual(writes[1].state.missions,[{id:'a',title:'Edited'},{id:'ocr',title:'Imported'}]);
  assert.deepEqual(writes[1].state.runRouteOrder,{ship:['b','a']});
  assert.equal(writes[1].baseUpdatedAt,'r2');
  assert.ok(!f.events.includes('conflict'));
});
test('additional changes during conflict resolution use the newest local snapshot', async()=>{
  const initial={missions:[{id:'a',title:'A'},{id:'b',title:'B'}]};
  const f=await fixture({initial}), gate=deferred(), writes=[];
  f.transport.fetch=async(_url,options)=>{
    writes.push(JSON.parse(options.body));
    if(writes.length===1){await gate.promise;return response(409,{state:{missions:[...initial.missions,{id:'c'}]},updatedAt:'r2'});}
    return response(200,{updatedAt:'r3'});
  };
  const first=f.sync.save({missions:[{id:'a',title:'Edit'},{id:'b',title:'B'}]});
  const second=f.sync.save({missions:[{id:'a',title:'Edit'}]});
  gate.resolve();await Promise.all([first,second]);
  assert.deepEqual(writes[1].state.missions,[{id:'a',title:'Edit'},{id:'c'}]);
});
test('lost success responses are idempotent', async()=>{
  const f=await fixture();
  const saved={missions:[],marker:'saved'};
  f.transport.fetch=async()=>response(409,{state:saved,updatedAt:'r2'});
  assert.equal(await f.sync.save(saved),true);
  assert.ok(!f.events.includes('conflict'));
});
test('conflict rebasing preserves form contents until editing ends', async()=>{
  const f=await fixture({initial:{missions:[{id:'a'}]}});f.editing(true);
  let calls=0;
  f.transport.fetch=async(_url,options={})=>{
    if(options.method!=='POST')return response(200,{state:f.state,updatedAt:'r3'});
    return ++calls===1?response(409,{state:{missions:[{id:'a'},{id:'b'}]},updatedAt:'r2'}):response(200,{updatedAt:'r3'});
  };
  await f.sync.save({missions:[{id:'a',title:'edit'}]});
  assert.ok(!f.events.includes('render'));
  f.editing(false);await f.sync.poll();assert.ok(f.events.includes('render'));
});
test('failed hydration retries and preserves edits whose original server revision is unknown', async()=>{
  const f=await fixture({hydrate:false});
  f.transport.fetch=async()=>{throw new Error('offline');};
  assert.equal(await f.sync.hydrate(),false);
  assert.ok(f.sync.status.initialized);assert.equal(f.sync.status.hydrated,false);
  f.edit({missions:[],marker:'cached edit'});
  f.transport.fetch=async()=>response(200,{state:{missions:[],marker:'server'},updatedAt:'r4'});
  await f.sync.poll();
  assert.equal(f.storage.readRecovery().marker,'cached edit');
  assert.equal(f.state.marker,'server');
  assert.ok(f.events.includes('conflict'));
});
test('an empty server accepts personal state but fresh reference defaults never race to upload', async()=>{
  const fresh=await fixture({initial:{missions:[]},remote:null});
  assert.equal(fresh.writes.length,0);
  const personal=await fixture({initial:{missions:[{id:'existing'}]},remote:null});
  assert.equal(personal.writes.length,1);assert.equal(personal.writes[0].baseUpdatedAt,null);
});
test('update rejection preserves unsaved work and stops all further requests', async()=>{
  const f=await fixture();let requests=0;
  f.transport.fetch=async(_url,options)=>{
    requests++;assert.equal(JSON.parse(options.body).clientVersion,'current');
    return response(428,{error:'client_version_mismatch',version:'new'});
  };
  const local={missions:[],runRouteOrder:{ship:['b','a']}};
  assert.equal(await f.sync.save(local),false);
  assert.ok(f.sync.status.blocked);assert.deepEqual(f.storage.readRecovery(),local);
  await f.sync.poll();await f.sync.flush();assert.equal(requests,1);
  assert.ok(!f.events.includes('conflict'));
});
test('import state and acknowledgements share one commit and preserve simultaneous local edits', async()=>{
  const initial={missions:[{id:'a'}],runRouteOrder:{ship:['a','b']}};
  const f=await fixture({initial}), gate=deferred(), writes=[];
  f.transport.fetch=async(_url,options)=>{
    writes.push(JSON.parse(options.body));if(writes.length===1)await gate.promise;
    return response(200,{updatedAt:'r'+(writes.length+1)});
  };
  const importing=f.sync.commitImports({state:{...initial,missions:[...initial.missions,{id:'ocr'}]},importIds:['ocr']},f.sync.checkpoint());
  assert.ok(f.sync.status.importing);
  assert.ok(f.sync.status.hasUnsaved,'Closing or updating must wait for the atomic import commit');
  f.edit({...initial,runRouteOrder:{ship:['b','a']}});
  assert.equal(await f.sync.flush(),false);
  gate.resolve();assert.equal(await importing,true);
  assert.deepEqual(f.state.missions,[{id:'a'},{id:'ocr'}]);
  assert.deepEqual(f.state.runRouteOrder,{ship:['b','a']});
  await f.sync.flush();
  assert.deepEqual(writes[0].importIds,['ocr']);assert.equal(writes[1].baseUpdatedAt,'r2');
  assert.ok(!f.events.includes('conflict'));
});
test('stale import tickets and competing importer conflicts cannot overwrite current state', async()=>{
  const f=await fixture(), ticket=f.sync.checkpoint();
  f.edit({...f.state,runRouteOrder:{ship:['b','a']}});await f.sync.flush();
  assert.equal(await f.sync.commitImports({state:{missions:[]},importIds:['old']},ticket),false);
  f.transport.fetch=async()=>response(409,{state:{missions:[{id:'other'}]},updatedAt:'r3'});
  assert.equal(await f.sync.commitImports({state:{missions:[{id:'ours'}]},importIds:['ours']},f.sync.checkpoint()),false);
  assert.deepEqual(f.state.runRouteOrder,{ship:['b','a']});
  assert.ok(!f.events.includes('conflict'));
});
test('restoration invalidates old network responses before hydrating the replacement state', async()=>{
  const f=await fixture(), gate=deferred();let calls=0;
  f.transport.fetch=async()=>++calls===1?gate.promise:response(200,{state:{missions:[],marker:'restored'},updatedAt:'r9'});
  const old=f.sync.refresh(), reset=f.sync.reset();
  gate.resolve(response(200,{state:{marker:'outdated'},updatedAt:'r2'}));
  await Promise.all([old,reset]);
  assert.equal(f.state.marker,'restored');assert.equal(f.sync.status.revision,'r9');
});
test('browser storage failure cannot block a server save or in-memory recovery', async()=>{
  const f=await fixture({storageFailure:true});
  assert.equal(await f.sync.save({marker:'saved'}),true);
  assert.equal(f.storage.read().marker,'saved');
  f.transport.fetch=async()=>response(409,{state:{marker:'remote'},updatedAt:'r3'});
  await f.sync.save({marker:'recoverable'});
  assert.equal(f.storage.readRecovery().marker,'recoverable');
});
test('status is read-only and exposes no mutable pending snapshot or internal locks', async()=>{
  const f=await fixture(), status=f.sync.status;
  assert.ok(Object.isFrozen(status));
  status.pending=true;status.revision='fake';
  assert.equal(f.sync.status.pending,false);assert.equal(f.sync.status.revision,'r1');
});
