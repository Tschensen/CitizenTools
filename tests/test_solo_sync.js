const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const storage = new Map();
  const c = vm.createContext({
    console, setTimeout, clearTimeout, AbortController, setInterval:()=>0,
    state:{missions:[], marker:'local'}, defaultState:{missions:[]},
    remoteHydrationComplete:true, remoteSaveTimer:null, missionAutoImportBusy:false,
    remoteStatus:{connected:true}, STORAGE_KEY:'solo-test',
    cloneData:value=>JSON.parse(JSON.stringify(value)),
    sanitizeState:value=>value, pruneInvalidPlacements:value=>value,
    getStateStorageKey:()=> 'state', render:()=>{}, renderRemoteStatus:()=>{},
    applyRemoteMeta:()=>{}, currentUiLanguage:()=> 'de',
    window:{addEventListener:()=>{}},
    document:{activeElement:null, querySelector:()=>null},
    localStorage:{getItem:key=>storage.get(key), setItem:(key,value)=>storage.set(key,value)},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/scripts/solo-merge.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../web/scripts/solo-sync.js'),'utf8'),c);
  vm.runInContext("soloHydrated=true; soloRevision='r1'; soloBaseState=cloneData(state); showSoloConflict=()=>{globalThis.conflictShown=true;}", c);
  return {c, storage};
}
const response = (status, payload) => ({status,ok:status>=200&&status<300,json:async()=>payload});
(async () => {
  {
    const {c}=fixture();
    c.fetch=async()=>response(200,{state:{marker:'other device'},updatedAt:'r2'});
    await c.fetchRemoteState();
    assert.equal(vm.runInContext('soloRevision',c),'r1','A background read must not acknowledge a revision that has not been applied');
    await c.pollSoloState();
    assert.equal(c.state.marker,'other device');
    assert.equal(vm.runInContext('soloRevision',c),'r2');
  }
  {
    const {c,storage}=fixture();
    c.fetch=async()=>response(409,{state:{marker:'tablet',missions:[]},updatedAt:'r2'});
    assert.equal(await c.saveRemoteState({marker:'PC',missions:[]}),false);
    assert.equal(c.state.marker,'tablet');
    assert.equal(JSON.parse(storage.get('solo-test:conflict-recovery')).marker,'PC');
    assert.equal(c.conflictShown,true);
    assert.equal(vm.runInContext('soloPending',c),null);
  }
  {
    const {c}=fixture();
    const writes=[];
    let release;
    c.fetch=async (url,options)=>{
      writes.push(JSON.parse(options.body));
      if (writes.length===1) await new Promise(resolve=>release=resolve);
      return response(200,{updatedAt:`r${writes.length+1}`});
    };
    const first=c.saveRemoteState({marker:'first'});
    const second=c.saveRemoteState({marker:'second'});
    release(); await Promise.all([first,second]);
    assert.deepEqual(writes.map(x=>x.baseUpdatedAt),['r1','r2']);
    assert.deepEqual(writes.map(x=>x.state.marker),['first','second']);
  }
  {
    const {c}=fixture();
    c.fetch=async()=>{throw new Error('server stopped');};
    assert.equal(await c.saveRemoteState({marker:'offline'}),false);
    assert.equal(vm.runInContext('soloPending.marker',c),'offline');
    let sent;
    c.fetch=async(url,options)=>{sent=JSON.parse(options.body);return response(200,{updatedAt:'r2'});};
    await c.pollSoloState();
    assert.equal(sent.state.marker,'offline');
    assert.equal(sent.baseUpdatedAt,'r1');
  }
  {
    const {c}=fixture();
    c.document.activeElement={matches:()=>true};
    c.fetch=async()=>{throw new Error('Should not poll while typing');};
    await c.pollSoloState();
    assert.equal(c.remoteStatus.connected,true);
  }
  {
    const {c}=fixture();
    let release;
    c.fetch=async()=>{await new Promise(resolve=>release=resolve);return response(200,{state:{marker:'remote'},updatedAt:'r2'});};
    const polling=c.pollSoloState();
    c.document.activeElement={matches:()=>true};
    release(); await polling;
    assert.equal(c.state.marker,'local','Focus acquired during a read must protect the form');
    assert.equal(vm.runInContext('soloRevision',c),'r1');
  }
  {
    const {c}=fixture();
    c.fetch=async(url,options)=>({ok:true,json:()=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('body timeout'))))});
    await assert.rejects(c.soloRequestJson('/slow-body',{},15),/body timeout/);
  }
  {
    const {c}=fixture();
    vm.runInContext('soloHydrated=false;',c);
    let attempts=0;
    c.initializeRemotePersistence=async()=>{attempts++;vm.runInContext('soloHydrated=true;',c);};
    await c.pollSoloState();
    assert.equal(attempts,1,'A failed initial read must be retried');
    assert.equal(vm.runInContext('soloPolling',c),false);
  }
  {
    const {c,storage}=fixture();
    vm.runInContext("soloHydrated=false; soloPending={marker:'cached edit'};",c);
    c.initializeRemotePersistence=async()=>{vm.runInContext('soloHydrated=true;',c);};
    await c.pollSoloState();
    assert.equal(JSON.parse(storage.get('solo-test:conflict-recovery')).marker,'cached edit');
    assert.equal(c.conflictShown,true);
  }
  {
    const {c}=fixture();
    const base={missions:[{id:'a',title:'A'},{id:'b',title:'B'}],currentLocation:'Area18'};
    c.state=structuredClone(base);
    vm.runInContext('soloBaseState=cloneData(state)',c);
    const remote=structuredClone(base);remote.missions.push({id:'ocr',title:'New import'});remote.currentLocation='Lorville';
    const local=structuredClone(base);local.missions[0].title='Tablet edit';local.missions.splice(1,1);
    const writes=[];
    c.fetch=async(url,options)=>{writes.push(JSON.parse(options.body));return writes.length===1
      ?response(409,{state:remote,updatedAt:'r2'}) :response(200,{updatedAt:'r3'});};
    assert.equal(await c.saveRemoteState(local),true);
    assert.equal(writes.length,2);
    assert.equal(writes[1].baseUpdatedAt,'r2');
    assert.equal(writes[1].state.currentLocation,'Lorville');
    assert.deepEqual(writes[1].state.missions,[{id:'a',title:'Tablet edit'},{id:'ocr',title:'New import'}]);
    assert.equal(c.conflictShown,undefined);
  }
  {
    const {c}=fixture();
    c.fetch=async()=>{throw new Error('No-op must not write');};
    assert.equal(await c.saveRemoteState(c.state),true);
    assert.equal(c.remoteStatus.connected,true);
  }
  {
    const {c}=fixture();
    c.fetch=async()=>response(409,{state:{missions:[],marker:'already saved'},updatedAt:'r2'});
    assert.equal(await c.saveRemoteState({missions:[],marker:'already saved'}),true,'A lost success response is idempotent');
    assert.equal(c.conflictShown,undefined);
  }
  {
    const {c}=fixture();
    c.state={missions:[{id:'a',title:'A'},{id:'b',title:'B'}]};
    vm.runInContext('soloBaseState=cloneData(state)',c);
    let release;const writes=[];
    c.fetch=async(url,options)=>{writes.push(JSON.parse(options.body));if(writes.length===1){await new Promise(resolve=>release=resolve);return response(409,{state:{missions:[{id:'a',title:'A'},{id:'b',title:'B'},{id:'c',title:'PC import'}]},updatedAt:'r2'});}return response(200,{updatedAt:'r3'});};
    const saving=c.saveRemoteState({missions:[{id:'a',title:'Tablet edit'},{id:'b',title:'B'}]});
    const next=c.saveRemoteState({missions:[{id:'a',title:'Tablet edit'}]});
    release();await Promise.all([saving,next]);
    assert.deepEqual(writes[1].state.missions,[{id:'a',title:'Tablet edit'},{id:'c',title:'PC import'}]);
  }
  {
    const {c}=fixture();
    c.document.activeElement={matches:()=>true};let renders=0;c.render=()=>renders++;
    assert.equal(c.rebaseSoloState({state:{missions:[],marker:'remote'},updatedAt:'r2'}),true);
    assert.equal(renders,0,'Rebasing must not redraw an open form');
    c.document.activeElement=null;c.fetch=async()=>response(200,{state:c.state,updatedAt:'r2'});
    await c.pollSoloState();assert.equal(renders,1,'The deferred redraw must happen when editing ends');
  }
  console.log('14 Solo synchronization tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
