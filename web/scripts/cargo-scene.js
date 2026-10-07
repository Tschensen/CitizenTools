// Independent orthographic cargo scenes. No mission, fleet, persistence or app DOM dependencies.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CargoScene = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const namespace = 'http://www.w3.org/2000/svg';
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const presets = {front:[Math.PI,0], rear:[0,0], left:[-Math.PI/2,0], right:[Math.PI/2,0], top:[0,Math.PI/2], reset:[Math.PI/4,Math.PI/6]};
  const createCamera = () => ({yaw:Math.PI/4, elevation:Math.PI/6, center:[0,0,0]});
  function setView(camera, view) {
    if (!presets[view]) return false;
    [camera.yaw, camera.elevation] = presets[view];
    return true;
  }
  function getView(camera) {
    const near = (a,b) => Math.abs(Math.atan2(Math.sin(a-b),Math.cos(a-b))) < 1e-6;
    for (const view of ['top','front','rear','left','right']) {
      const [yaw,elevation] = presets[view];
      if (near(camera.yaw,yaw) && near(camera.elevation,elevation)) return view;
    }
    return 'free';
  }
  function normal(camera) {
    return [Math.sin(camera.yaw)*Math.cos(camera.elevation),Math.cos(camera.yaw)*Math.cos(camera.elevation),Math.sin(camera.elevation)];
  }
  function project(camera, x,y,z, scale=32) {
    x-=camera.center[0]; y-=camera.center[1]; z-=camera.center[2];
    const c=Math.cos(camera.yaw), s=Math.sin(camera.yaw), ce=Math.cos(camera.elevation), se=Math.sin(camera.elevation);
    const depth=x*s+y*c;
    return {x:(x*c-y*s)*scale,y:(depth*se-z*ce)*scale,depth:depth*ce+z*se};
  }
  const topCorners = (x,y,z) => [[x,y,z],[x+1,y,z],[x+1,y+1,z],[x,y+1,z]];
  const faces = [
    {type:'top',normal:[0,0,1],shade:12,corners:(x,y,z)=>topCorners(x,y,z+1)},
    {type:'left',normal:[-1,0,0],shade:-18,corners:(x,y,z)=>[[x,y,z],[x,y+1,z],[x,y+1,z+1],[x,y,z+1]]},
    {type:'right',normal:[1,0,0],shade:-8,corners:(x,y,z)=>[[x+1,y,z],[x+1,y+1,z],[x+1,y+1,z+1],[x+1,y,z+1]]},
    {type:'front',normal:[0,1,0],shade:-12,corners:(x,y,z)=>[[x,y+1,z],[x+1,y+1,z],[x+1,y+1,z+1],[x,y+1,z+1]]},
    {type:'back',normal:[0,-1,0],shade:-12,corners:(x,y,z)=>[[x,y,z],[x+1,y,z],[x+1,y,z+1],[x,y,z+1]]},
  ];
  const key = (x,y,z) => `${x}|${y}|${z}`;
  const touchesLevel = (item,level) => level === 'all' || (item.z <= Number(level) && item.z+item.height > Number(level));
  function occupancy(items) {
    const result = new Set();
    for (const item of items) for(let z=item.z;z<item.z+item.height;z++)
      for(let y=item.y;y<item.y+item.depth;y++) for(let x=item.x;x<item.x+item.width;x++) result.add(key(x,y,z));
    return result;
  }
  function bounds(cells,items) {
    const result={minCol:Infinity,minRow:Infinity,maxCol:-Infinity,maxRow:-Infinity,maxHeight:0};
    const include=(x,y,width,depth,height)=>{
      result.minCol=Math.min(result.minCol,x);result.minRow=Math.min(result.minRow,y);
      result.maxCol=Math.max(result.maxCol,x+width);result.maxRow=Math.max(result.maxRow,y+depth);
      result.maxHeight=Math.max(result.maxHeight,height);
    };
    cells.forEach(cell=>include(cell.col,cell.row,1,1,cell.capacity));
    items.forEach(item=>include(item.x,item.y,item.width,item.depth,item.z+item.height));
    if (!Number.isFinite(result.minCol)) include(0,0,1,1,1);
    return result;
  }
  function create(element, {camera=createCamera(), scale=32} = {}) {
    const document=element.ownerDocument;
    function polygon(points,className='') {
      const projected=points.map(p=>project(camera,...p,scale));
      const polygon=document.createElementNS(namespace,'polygon');
      polygon.setAttribute('class',className);
      polygon.setAttribute('points',projected.map(p=>`${p.x},${p.y}`).join(' '));
      return {polygon,projected,depth:projected.reduce((sum,p)=>sum+p.depth,0)/projected.length};
    }
    // Decorators attach application labels/actions to geometry; their returned nodes
    // are sorted together, so floors and boxes occlude each other consistently.
    function render({cells=[],items=[],level='all'}, {floor,face} = {}) {
      const fragments=[];
      if (camera.elevation>=1e-6) cells.forEach(cell=>{
        const fragment=polygon(topCorners(cell.col,cell.row,0),'iso-floor');
        fragments.push({depth:fragment.depth,node:floor?.(cell,fragment) || fragment.polygon});
      });
      const cameraNormal=normal(camera);
      const visibleFaces=faces.filter(face=>face.normal.reduce((sum,n,i)=>sum+n*cameraNormal[i],0)>1e-8);
      const activeOccupancy=occupancy(items.filter(item=>touchesLevel(item,level)));
      items.forEach(item=>{
        const isContext=!touchesLevel(item,level);
        // Ghost items cannot erase active faces; hide only their own internal faces.
        const occluders=isContext ? occupancy([item]) : activeOccupancy;
        for(let z=item.z;z<item.z+item.height;z++) for(let y=item.y;y<item.y+item.depth;y++)
          for(let x=item.x;x<item.x+item.width;x++) for(const definition of visibleFaces) {
            const [nx,ny,nz]=definition.normal;
            if(occluders.has(key(x+nx,y+ny,z+nz))) continue;
            const fragment=polygon(definition.corners(x,y,z),`iso-face iso-face-${definition.type}`);
            const node=face?.({item,x,y,z,definition,isContext,fragment}) || fragment.polygon;
            fragments.push({depth:fragment.depth,node});
          }
      });
      element.replaceChildren(...fragments.sort((a,b)=>a.depth-b.depth).map(f=>f.node));
    }
    function preview({x,y,z,width,depth,height},className) {
      const x1=x+width,y1=y+depth,z1=z+height;
      const corners=[[x,y,z],[x1,y,z],[x1,y1,z],[x,y1,z],[x,y,z1],[x1,y,z1],[x1,y1,z1],[x,y1,z1]];
      const group=document.createElementNS(namespace,'g');
      group.setAttribute('class',className);group.setAttribute('aria-hidden','true');
      for(const face of [[0,1,2,3],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]) group.appendChild(polygon(face.map(i=>corners[i])).polygon);
      return group;
    }
    function frame(bounds, {axisMargin=3, padding=100} = {}) {
      const {minCol,minRow,maxCol,maxRow,maxHeight}=bounds;
      camera.center=[(minCol+maxCol)/2,(minRow+maxRow)/2,maxHeight/2];
      const span=Math.hypot(maxCol-minCol,maxRow-minRow+axisMargin,maxHeight)*scale+padding;
      element.dataset.cameraSpan=String(span);
      element.setAttribute('preserveAspectRatio','xMidYMid meet');
      return span;
    }
    return {camera,render,polygon,preview,frame,zoom:value=>applyZoom(element,value),project:(x,y,z)=>project(camera,x,y,z,scale)};
  }
  function applyZoom(element, value) {
    const span=Number(element.dataset.cameraSpan)/value;
    if(Number.isFinite(span) && span>0) element.setAttribute('viewBox',`${-span/2} ${-span/2} ${span} ${span}`);
  }
  // All gesture state belongs to this binding; two viewports never share a drag.
  // The caller owns render scheduling, zoom values and business actions.
  function bindCamera(element,camera,{onChange=()=>{},onZoom=()=>{},onReset=()=>{},onHover=()=>{}}={}) {
    const listeners=[];
    const on=(type,handler,options)=>{element.addEventListener(type,handler,options);listeners.push(()=>element.removeEventListener(type,handler,options));};
    let drag=null,suppressClick=false;
    const touches=new Map();
    let gesture=null;
    const previousTouchAction=element.style.touchAction;
    element.style.touchAction='none';
    const touchGeometry=()=>{
      const [a,b]=[...touches.values()];
      return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y))};
    };
    on('pointerdown',event=>{
      if(event.pointerType==='touch') {
        if(!touches.size) suppressClick=false;
        touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(touches.size===2) {
          for(const id of touches.keys()) element.setPointerCapture(id);
          gesture=touchGeometry();suppressClick=true;drag=null;
        }
        return;
      }
      if(event.button!==0 || !event.isPrimary) return;
      suppressClick=event.ctrlKey;
      if(!event.ctrlKey) return;
      event.preventDefault();element.focus({preventScroll:true});
      drag={id:event.pointerId,x:event.clientX,y:event.clientY,yaw:camera.yaw,elevation:camera.elevation,moved:false};
      element.setPointerCapture(event.pointerId);element.classList.add('is-orbiting');
    });
    on('pointermove',event=>{
      if(touches.has(event.pointerId)) {
        touches.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(touches.size===2 && gesture) {
          const next=touchGeometry();
          camera.yaw-=(next.x-gesture.x)*.008;
          camera.elevation=clamp(camera.elevation+(next.y-gesture.y)*.008,0,Math.PI/2);
          const ratio=next.distance/gesture.distance;
          if(ratio>1.12 || ratio<1/1.12) {onZoom(ratio>1?'in':'out');gesture.distance=next.distance;}
          gesture.x=next.x;gesture.y=next.y;onChange();
        }
        return;
      }
      if(!drag) onHover(event);
      if(!drag || event.pointerId!==drag.id || !event.ctrlKey) return;
      const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
      if(!drag.moved && Math.hypot(dx,dy)<3) return;
      drag.moved=true;suppressClick=true;
      camera.yaw=drag.yaw-dx*.008;camera.elevation=clamp(drag.elevation+dy*.008,0,Math.PI/2);onChange();
    });
    const finish=event=>{
      if(touches.delete(event.pointerId)) {
        gesture=null;
        if(element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
        return;
      }
      if(!drag || event.pointerId!==drag.id) return;
      drag=null;
      if(element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      element.classList.remove('is-orbiting');
    };
    for(const name of ['pointerup','pointercancel','lostpointercapture']) on(name,finish);
    on('click',event=>{if(suppressClick || event.ctrlKey){event.preventDefault();event.stopImmediatePropagation();}},true);
    on('wheel',event=>{if(event.ctrlKey && event.deltaY!==0){event.preventDefault();onZoom(event.deltaY<0?'in':'out');}},{passive:false});
    on('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(event.key)) return;
      event.preventDefault();
      if(event.key==='Home'){setView(camera,'reset');onReset();}
      else {
        if(event.key==='ArrowLeft') camera.yaw-=.12;
        if(event.key==='ArrowRight') camera.yaw+=.12;
        if(event.key==='ArrowUp') camera.elevation=clamp(camera.elevation+.08,0,Math.PI/2);
        if(event.key==='ArrowDown') camera.elevation=clamp(camera.elevation-.08,0,Math.PI/2);
      }
      onChange();
    });
    return ()=>{
      listeners.forEach(remove=>remove());
      if(drag && element.hasPointerCapture(drag.id)) element.releasePointerCapture(drag.id);
      drag=null;element.classList.remove('is-orbiting');
      for(const id of touches.keys()) if(element.hasPointerCapture(id)) element.releasePointerCapture(id);
      touches.clear();gesture=null;element.style.touchAction=previousTouchAction;
    };
  }
  return {create,createCamera,setView,getView,normal,project,bounds,bindCamera,applyZoom};
});
