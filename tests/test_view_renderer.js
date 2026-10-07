const {test} = require('node:test');
const assert = require('node:assert/strict');
const {create} = require('../web/scripts/view-renderer.js');
test('hidden views stay dirty and are built once on first activation',()=>{
  let page='hub';const calls=[];
  const renderer=create({getPage:()=>page,views:[
    {id:'hub',pages:['hub'],render:()=>calls.push('hub')},
    {id:'grid',pages:['overview','load'],render:()=>calls.push('grid')},
    {id:'stats',pages:['statistics'],render:()=>calls.push('stats')},
  ]});
  renderer.render();renderer.render();assert.deepEqual(calls,['hub']);
  renderer.invalidate();renderer.render();assert.deepEqual(calls,['hub','hub']);
  page='overview';renderer.render();page='load';renderer.render();assert.deepEqual(calls,['hub','hub','grid']);
  page='statistics';renderer.render();assert.equal(calls.at(-1),'stats');
});
test('targeted invalidation does not redraw unrelated visible sections',()=>{
  const calls=[];const renderer=create({getPage:()=> 'overview',views:[
    {id:'grid',pages:['overview'],render:()=>calls.push('grid')},
    {id:'missions',pages:['overview'],render:()=>calls.push('missions')},
  ]});
  renderer.render();renderer.invalidate(['missions']);renderer.render();
  assert.deepEqual(calls,['grid','missions','missions']);
});
test('re-entered pages refresh time-dependent content even without state changes',()=>{
  let page='statistics',today='Monday',display;
  const renderer=create({getPage:()=>page,views:[{id:'stats',pages:['statistics'],render:()=>display=today}]});
  renderer.render();page='hub';renderer.render();today='Tuesday';page='statistics';renderer.render();
  assert.equal(display,'Tuesday');
});
test('failed rendering can be retried and does not acknowledge unrendered content',()=>{
  let fail=true,count=0;const renderer=create({getPage:()=> 'hub',views:[{id:'hub',pages:['hub'],render(){
    count++;if(fail)throw new Error('render failed');
  }}]});
  assert.throws(()=>renderer.render(),/render failed/);fail=false;renderer.render();renderer.render();assert.equal(count,2);
});
test('nested render requests do not recurse and invalidation during rendering is retained',()=>{
  let calls=0,renderer;
  renderer=create({getPage:()=> 'hub',views:[{id:'hub',pages:['hub'],render(){
    calls++;if(calls===1){renderer.invalidate();renderer.render();}
  }}]});
  renderer.render();assert.equal(calls,1);renderer.render();assert.equal(calls,2);
});
