const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create: createApi } = require('../web/scripts/state-api.js');
const { create: createStore } = require('../web/scripts/state-store.js');
const { create: createStorage } = require('../web/scripts/state-storage.js');
const { equal } = require('../web/scripts/solo-merge.js');
const clone = value => structuredClone(value);
const reply = (status, payload) => ({status, ok:status >= 200 && status < 300, json:async()=>payload});

test('state transport sends the revision, client version and import acknowledgement together', async()=>{
  let version='one'; const calls=[];
  const api=createApi({clientVersion:()=>version,fetch:async(url,options)=>{
    calls.push({url,options});
    return options.method==='POST'?reply(200,{updatedAt:'r2'}):reply(200,{scope:'solo',state:null,updatedAt:null});
  }});
  await api.fetchState();
  assert.equal(calls[0].options.cache,'no-store');
  version='two';await api.saveState({missions:[]},'r1',['import']);
  assert.deepEqual(JSON.parse(calls[1].options.body),{state:{missions:[]},baseUpdatedAt:'r1',clientVersion:'two',importIds:['import']});
});

test('malformed reads and conflict responses never enter the state coordinator', async()=>{
  for(const payload of [null,{}, {state:[],updatedAt:'r1'}, {state:{},updatedAt:12},
    {state:{},updatedAt:'r1',scope:'organization'}]) {
    for(const status of [200,409]) {
      const api=createApi({clientVersion:()=> 'test',fetch:async()=>reply(status,payload)});
      await assert.rejects(status===200?api.fetchState():api.saveState({},'r1'),/solo_state_invalid/);
    }
  }
  const api=createApi({clientVersion:()=> 'test',fetch:async()=>reply(200,{ok:true})});
  await assert.rejects(api.saveState({},'r1'),/solo_state_invalid/);
});

test('request timeout also aborts a response body that never finishes', async()=>{
  let aborted=false;
  const api=createApi({clientVersion:()=> 'test',timeoutMs:10,fetch:async(_url,{signal})=>({
    status:200,ok:true,json:()=>new Promise((resolve,reject)=>{
      signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true});
    }),
  })});
  await assert.rejects(api.fetchState(),/aborted/);assert.ok(aborted);
});

test('version mismatch is reported independently of ordinary HTTP errors', async()=>{
  let mismatches=0,status=500;
  const api=createApi({clientVersion:()=> 'old',onVersionMismatch:()=>mismatches++,
    fetch:async()=>reply(status,{error:'client_version_mismatch'})});
  await api.saveState({},'r1');assert.equal(mismatches,0);
  status=428;await api.saveState({},'r1');assert.equal(mismatches,1);
});

test('corrupt browser cache is ignored and failed writes retain the newest recoverable snapshot',()=>{
  let raw='{invalid',failure=false;const errors=[];
  const storage=createStorage({key:'state',onError:error=>errors.push(error),storage:{
    getItem:()=>raw,setItem:(_key,value)=>{if(failure)throw new Error('quota');raw=value;},
  }});
  assert.equal(storage.read(),null);assert.equal(errors.length,1);
  const value={missions:[{id:'first'}]};assert.equal(storage.write(value),true);
  value.missions[0].id='mutated';assert.equal(storage.read().missions[0].id,'first');
  failure=true;assert.equal(storage.write({missions:[{id:'newer'}]}),false);
  assert.equal(storage.read().missions[0].id,'newer');
  storage.recover({missions:[{id:'recovery'}]});
  const copy=storage.readRecovery();copy.missions.length=0;
  assert.equal(storage.readRecovery().missions.length,1);
  assert.equal(storage.read().missions[0].id,'newer');
});

test('state normalization and snapshots do not mutate their source or alias live data',()=>{
  let state={organization:{id:1},pilotGroups:[],missions:[{id:'one',participants:[1],title:'Title'}]};
  const store=createStore({read:()=>state,replace:value=>state=value,defaults:()=>({missions:[]}),
    clone,equal,normalize:value=>{value.normalized=true;return value;},storage:{write(){},recover(){}}});
  const snapshot=store.snapshot();assert.equal(snapshot.organization,undefined);
  assert.equal(snapshot.missions[0].participants,undefined);snapshot.missions[0].title='Edited';
  assert.equal(state.missions[0].title,'Title');assert.deepEqual(state.missions[0].participants,[1]);
  const normalized=store.normalize(state);assert.ok(normalized.normalized);assert.equal(state.normalized,undefined);
  assert.ok(store.normalize(null).normalized);
});

test('fresh reference timestamps are not personal state, but preferences and custom entries are',()=>{
  const defaults={missions:[],shipLibrary:[{id:'hermes',createdAt:'today'}],pilots:[{id:'solo',createdAt:'today'}],language:'de'};
  const store=createStore({read:()=>defaults,replace(){},defaults:()=>defaults,normalize:clone,clone,equal,storage:{}});
  const reference=clone(defaults);reference.shipLibrary[0].createdAt='yesterday';reference.pilots[0].createdAt='yesterday';
  assert.equal(store.hasPersonalState(reference),false);
  assert.equal(store.hasPersonalState({...reference,language:'en'}),true);
  assert.equal(store.hasPersonalState({...reference,shipLibrary:[...reference.shipLibrary,{id:'custom'}]}),true);
});
