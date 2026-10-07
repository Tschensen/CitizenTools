// Warehouse positions are presentation only: cargo becomes loaded solely through
// the existing placement actions, never by changing the warehouse arrangement.
let warehouseScene = null;
let warehouseZoom = 1;
let warehouseMissionId = '';
function updateWarehouseZoomControls() {
  document.getElementById('warehouseZoomValue').textContent=`${Math.round(warehouseZoom*100)} %`;
  document.querySelector('[data-warehouse-zoom="out"]').disabled=warehouseZoom<=.5;
  document.querySelector('[data-warehouse-zoom="in"]').disabled=warehouseZoom>=4;
}
let cargoAlignmentFrame = 0;
function alignCargoFrames() {
  if(cargoAlignmentFrame) return;
  cargoAlignmentFrame=requestAnimationFrame(()=>{
    cargoAlignmentFrame=0;
    const left=document.querySelector('.warehouse-frame');
    const right=document.querySelector('#loadIsoBody .cargo-camera-frame');
    if(!left || !right || !left.getClientRects().length) return;
    left.style.marginTop='0px';right.style.marginTop='0px';
    const a=left.getBoundingClientRect(),b=right.getBoundingClientRect();
    if(Math.abs(a.left-b.left)<20) return;
    if(a.top<b.top) left.style.marginTop=`${b.top-a.top}px`;
    else right.style.marginTop=`${a.top-b.top}px`;
  });
}
function renderWarehouse() {
  const svg = document.getElementById('warehouseView');
  if (!svg) return;
  if(cargoContextMenu?.dataset.surface==='warehouse') closeCargoContextMenu();
  alignCargoFrames();
  svg.setAttribute('aria-label',t('warehouse.title'));
  if (!warehouseScene) {
    warehouseScene = CargoScene.create(svg);
    const observer=new ResizeObserver(alignCargoFrames);
    document.querySelectorAll('.panel-warehouse > .panel-header, .panel-warehouse > label, .warehouse-camera-controls, .panel-load-iso .panel-header, #isoLevelFilter, #loadIsoBody .cargo-camera-controls, #cargoStopFocusStatus').forEach(node=>observer.observe(node));
    window.addEventListener('resize',alignCargoFrames);
    svg.addEventListener('contextmenu',event=>{
      const node=event.target.closest('[data-load-id]');
      if(!node) return;
      event.preventDefault();openCargoContextMenu(node.dataset.loadId,event.clientX,event.clientY,{warehouse:true});
    });
    svg.addEventListener('keydown',event=>{
      if(event.key!=='ContextMenu' && !(event.shiftKey && event.key==='F10')) return;
      event.preventDefault();
      const box=svg.getBoundingClientRect();
      const id=event.target.closest('[data-load-id]')?.dataset.loadId || state.selectedLoadId;
      openCargoContextMenu(id,box.x+box.width/2,box.y+box.height/2,{warehouse:true});
    });
    const zoom = action => {
      warehouseZoom = action==='reset' ? 1 : clamp(warehouseZoom * (action === 'in' ? 1.2 : 1/1.2), .5, 4);
      warehouseScene.zoom(warehouseZoom);
      updateWarehouseZoomControls();
    };
    CargoScene.bindCamera(svg, warehouseScene.camera, {onChange:renderWarehouse, onZoom:zoom, onReset:()=>{warehouseZoom=1;}});
    document.querySelectorAll('[data-warehouse-view]').forEach(button => button.addEventListener('click',()=>{
      CargoScene.setView(warehouseScene.camera,button.dataset.warehouseView);
      if(button.dataset.warehouseView==='reset') warehouseZoom=1;
      renderWarehouse();
    }));
    document.querySelectorAll('[data-warehouse-zoom]').forEach(button=>button.addEventListener('click',()=>zoom(button.dataset.warehouseZoom)));
    document.getElementById('warehouseMissionFilter').addEventListener('change',event=>{warehouseMissionId=event.target.value;renderWarehouse();});
    document.getElementById('warehouseAutoload').addEventListener('click',()=>autoLoadEntries(getAllLoads().filter(({mission})=>!warehouseMissionId || mission.id===warehouseMissionId)));
    document.getElementById('warehouseRotate').addEventListener('click',()=>{
      const entry=findLoadById(state.selectedLoadId);if(entry && canMissionUseCurrentCargoGrid(entry.mission)) rotateLoad(entry.load);
    });
    setupCargoTransfer();
  }
  const entries=getAllLoads().filter(({mission,load})=>canMissionUseCurrentCargoGrid(mission) && !load.placement);
  const missions=state.missions.filter(mission=>entries.some(entry=>entry.mission.id===mission.id));
  if(!missions.some(mission=>mission.id===warehouseMissionId)) warehouseMissionId='';
  const filter=document.getElementById('warehouseMissionFilter');
  const options=[{id:'',title:t('warehouse.all')},...missions];
  filter.innerHTML=options.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.title)}</option>`).join('');
  filter.value=warehouseMissionId;
  const visible=entries.filter(({mission})=>!warehouseMissionId || mission.id===warehouseMissionId);
  const items=[],cells=[],labels=[];
  let row=0;
  for(const mission of missions.filter(m=>!warehouseMissionId || m.id===warehouseMissionId)) {
    const group=visible.filter(entry=>entry.mission.id===mission.id);
    labels.push({row,title:mission.title});
    row+=2;
    let col=0,rowDepth=0;
    for(const entry of group) {
      const dims=getLoadDimensions(entry.load);
      if(col && col+dims.width>14) {row+=rowDepth+1;col=0;rowDepth=0;}
      items.push({id:entry.load.id,x:col,y:row,z:0,...dims,data:entry});
      col+=dims.width+1;rowDepth=Math.max(rowDepth,dims.depth);
    }
    row+=rowDepth+3;
  }
  // A continuous, visible unloading area remains even when the warehouse is empty.
  for(let y=0;y<Math.max(10,row);y++) for(let x=0;x<14;x++) cells.push({col:x,row:y,capacity:1});
  const bounds=CargoScene.bounds(cells,items);bounds.minRow=Math.min(bounds.minRow,0);
  warehouseScene.frame(bounds);
  warehouseScene.render({cells,items},{floor:(cell,fragment)=>{
    fragment.polygon.dataset.warehouseRow=cell.row;
    fragment.polygon.dataset.warehouseCol=cell.col;
    return fragment.polygon;
  },face:({item,fragment,definition})=>{
    const {mission,load}=item.data;
    fragment.polygon.setAttribute('fill',shadeColor(mission.color,definition.shade));
    const group=document.createElementNS('http://www.w3.org/2000/svg','g');
    group.setAttribute('class',`iso-load warehouse-load${state.selectedLoadId===load.id?' selected':''}`);
    group.dataset.loadId=load.id;
    group.setAttribute('tabindex','0');group.setAttribute('role','button');
    const label=`${mission.title} · ${load.label} · ${load.scu} SCU · ${formatLoadRoute(load,mission)}`;
    group.setAttribute('aria-label',label);
    const title=document.createElementNS('http://www.w3.org/2000/svg','title');title.textContent=label;
    group.append(title,fragment.polygon);
    const select=()=>{state.selectedLoadId=state.selectedLoadId===load.id?null:load.id;state.selectionCleared=!state.selectedLoadId;persist();render();};
    group.addEventListener('click',select);
    group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();select();}});
    group.addEventListener('mouseenter',()=>{document.getElementById('warehouseStatus').textContent=label;});
    return group;
  }});
  labels.forEach(label=>{const p=warehouseScene.project(0,label.row,0);svg.appendChild(createSvgText('http://www.w3.org/2000/svg',p.x,p.y,'warehouse-group-label',label.title));});
  warehouseScene.zoom(warehouseZoom);
  updateWarehouseZoomControls();
  const selected=findLoadById(state.selectedLoadId);
  document.getElementById('warehouseStatus').textContent=selected
    ? `${selected.mission.title} · ${selected.load.label} · ${selected.load.scu} SCU · ${formatLoadRoute(selected.load,selected.mission)}`
    : t(visible.length?'warehouse.count':'warehouse.empty',{count:visible.length});
  setCargoButtonIcon(document.getElementById('warehouseAutoload'),'autoload',t('contracts.load.autoloadTooltip'));
  document.getElementById('warehouseAutoload').disabled=!visible.length;
  setCargoButtonIcon(document.getElementById('warehouseRotate'),'rotate',t('common.rotate'));
  document.getElementById('warehouseRotate').disabled=!selected || !!selected.load.cargoFixed;
  document.querySelectorAll('[data-warehouse-view]').forEach(button=>{
    setCargoButtonIcon(button,button.dataset.warehouseView,t(`contracts.iso.${button.dataset.warehouseView==='reset'?'resetView':'top'}`));
    button.setAttribute('aria-pressed',String(CargoScene.getView(warehouseScene.camera)===button.dataset.warehouseView));
  });
  document.querySelectorAll('[data-warehouse-zoom]').forEach(button=>{
    const label=t(button.dataset.warehouseZoom==='reset'?'contracts.iso.zoomReset':button.dataset.warehouseZoom==='in'?'contracts.iso.zoomIn':'contracts.iso.zoomOut');
    button.setAttribute('aria-label',label);button.dataset.tooltip=label;
  });
}

function setupCargoTransfer() {
  let drag=null,suppressClick=false;
  const surfaces=[document.getElementById('warehouseView'),isoView];
  const restore=()=>{
    if(!drag) return;
    state.selectedLoadId=drag.previousId;state.selectionCleared=drag.previousCleared;
  };
  const clean=()=>{document.getElementById('cargoDragLabel')?.remove();clearCargoPlacementPreview();document.getElementById('warehouseView').classList.remove('is-drop-target');};
  surfaces.forEach(surface=>surface.addEventListener('pointerdown',event=>{
    if(event.pointerType==='touch' && !event.isPrimary) {restore();drag=null;clean();suppressClick=true;render();return;}
    suppressClick=false;
    if(event.ctrlKey || event.button!==0 || !event.isPrimary) return;
    const node=event.target.closest('.iso-load:not(.is-context-level)');
    if(!node) return;
    const entry=findLoadById(node.dataset.loadId);
    if(!entry || entry.load.cargoFixed || !canMissionUseCurrentCargoGrid(entry.mission)) return;
    drag={id:event.pointerId,loadId:entry.load.id,source:surface,x:event.clientX,y:event.clientY,moved:false,
      previousId:state.selectedLoadId,previousCleared:state.selectionCleared};
  }));
  document.addEventListener('pointermove',event=>{
    if(!drag || event.pointerId!==drag.id) return;
    if(event.ctrlKey){restore();drag=null;clean();render();return;}
    if(!drag.moved && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<8) return;
    if(!drag.moved) {
      drag.source.setPointerCapture(event.pointerId);
      drag.moved=true;suppressClick=true;state.selectedLoadId=drag.loadId;state.selectionCleared=false;
      renderIsometricView();renderWarehouse();
      const label=document.createElement('div');label.id='cargoDragLabel';label.textContent=findLoadById(drag.loadId).load.label;document.body.appendChild(label);
    }
    event.preventDefault();
    const label=document.getElementById('cargoDragLabel');
    if(label){label.style.left=`${event.clientX+12}px`;label.style.top=`${event.clientY+12}px`;}
    const target=document.elementFromPoint(event.clientX,event.clientY)?.closest('#isoView [data-cargo-row]');
    document.getElementById('warehouseView').classList.toggle('is-drop-target',drag.source===isoView && !!document.elementFromPoint(event.clientX,event.clientY)?.closest('#warehouseView'));
    if(target) showCargoPlacementPreview(Number(target.dataset.cargoRow),Number(target.dataset.cargoCol));
    else clearCargoPlacementPreview();
    if(event.clientY>innerHeight-45) window.scrollBy(0,18);
    else if(event.clientY<90) window.scrollBy(0,-18);
  },{passive:false});
  const finish=event=>{
    if(!drag || event.pointerId!==drag.id) return;
    const action=drag;
    const hit=document.elementFromPoint(event.clientX,event.clientY);
    const target=hit?.closest('#isoView [data-cargo-row]');
    const entry=findLoadById(action.loadId);
    restore();drag=null;clean();
    if(action.moved && event.type==='pointerup' && entry) {
      if(target && resolvePlacementTarget(entry.load,Number(target.dataset.cargoRow),Number(target.dataset.cargoCol),entry.load.id).valid) {
        state.selectedLoadId=entry.load.id;state.selectionCleared=false;
        handleCellClick(Number(target.dataset.cargoRow),Number(target.dataset.cargoCol));
      } else if(hit?.closest('#warehouseView') && action.source===isoView) unloadLoad(entry.load);
      else render();
    }
    else if(action.moved) render();
  };
  document.addEventListener('pointerup',finish);
  document.addEventListener('pointercancel',finish);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&drag){restore();drag=null;clean();render();}});
  window.addEventListener('blur',()=>{if(drag){restore();drag=null;clean();render();}});
  surfaces.forEach(surface=>surface.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true));
}
