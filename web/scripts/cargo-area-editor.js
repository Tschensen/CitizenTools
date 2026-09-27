let selectedCargoAreaId = '';
let cargoAreaErase = false;

function cargoAreaName(area) {
  return currentUiLanguage() === 'en' && area.nameEn ? area.nameEn : area.name;
}

function renderCargoAreaEditor() {
  const list = document.getElementById('cargoAreaList');
  const grid = document.getElementById('cargoAreaGrid');
  if (!list || !grid) return;
  const heights = mergeShipGridHeights(shipBuilderState.heights, shipBuilderState.overloadHeights);
  shipBuilderState.cargoAreas = CargoAreas.normalize(shipBuilderState.cargoAreas, heights);
  const areas = shipBuilderState.cargoAreas;
  if (!areas.some(area => area.id === selectedCargoAreaId)) selectedCargoAreaId = areas[0]?.id || '';
  list.innerHTML = areas.map((area, index) => `<div class="cargo-area-card${area.id === selectedCargoAreaId ? ' is-selected' : ''}" data-area-id="${escapeHtml(area.id)}">
    <button type="button" class="secondary-button cargo-area-select" aria-pressed="${area.id === selectedCargoAreaId}" aria-label="${escapeHtml(t('cargoAreas.select', {name:cargoAreaName(area)}))}">${index+1}</button>
    <div class="cargo-area-fields"><input class="cargo-area-name" maxlength="48" aria-label="${escapeHtml(t('cargoAreas.name'))}" value="${escapeHtml(cargoAreaName(area))}"><small>${escapeHtml(t('cargoAreas.capacity',{cells:area.slots.length,scu:area.slots.reduce((n,s)=>n+(heights[s]||0),0)}))}</small></div>
    <input type="color" class="cargo-area-color" value="${area.color}" aria-label="${escapeHtml(t('cargoAreas.color'))}">
    <div class="cargo-area-actions"><button type="button" class="secondary-button" data-area-step="-1" aria-label="${escapeHtml(t('cargoAreas.up'))}" ${index===0?'disabled':''}>⌃</button><button type="button" class="secondary-button" data-area-step="1" aria-label="${escapeHtml(t('cargoAreas.down'))}" ${index===areas.length-1?'disabled':''}>⌄</button><button type="button" class="ghost-button cargo-area-delete" aria-label="${escapeHtml(t('cargoAreas.delete',{name:cargoAreaName(area)}))}">×</button></div>
  </div>`).join('');
  list.querySelectorAll('[data-area-id]').forEach(card => {
    const area = areas.find(item => item.id === card.dataset.areaId);
    card.querySelector('.cargo-area-select').onclick = () => { selectedCargoAreaId = area.id; cargoAreaErase = false; renderCargoAreaEditor(); };
    card.querySelector('.cargo-area-name').oninput = event => { area.name = event.target.value; area.nameEn = ''; };
    card.querySelector('.cargo-area-name').onchange = event => {
      area.name = area.name.trim() || t('cargoAreas.new', { number: areas.indexOf(area) + 1 });
      event.target.value = area.name;
      card.querySelector('.cargo-area-select').setAttribute('aria-label', t('cargoAreas.select', { name: area.name }));
      card.querySelector('.cargo-area-delete').setAttribute('aria-label', t('cargoAreas.delete', { name: area.name }));
      paintCargoAreaGrid();
    };
    card.querySelector('.cargo-area-color').oninput = event => { area.color = event.target.value; paintCargoAreaGrid(); };
    card.querySelector('.cargo-area-delete').onclick = () => {
      shipBuilderState.cargoAreas = areas.filter(item => item.id !== area.id);
      renderCargoAreaEditor();
    };
    card.querySelectorAll('[data-area-step]').forEach(button => { button.onclick = () => {
      const from = areas.indexOf(area), to = from + Number(button.dataset.areaStep);
      if (to < 0 || to >= areas.length) return;
      areas.splice(to, 0, areas.splice(from,1)[0]);
      renderCargoAreaEditor();
    }; });
  });
  document.getElementById('cargoAreaAdd').disabled = areas.length >= 40;
  document.getElementById('cargoAreaErase').checked = cargoAreaErase;
  document.getElementById('cargoAreaEmpty').hidden = areas.length > 0;
  grid.style.gridTemplateColumns = `repeat(${shipBuilderState.cols}, minmax(0, 1fr))`;
  grid.style.maxWidth = `${shipBuilderState.cols * 46}px`;
  grid.innerHTML = Array.from({length:shipBuilderState.rows},(_,row) => Array.from({length:shipBuilderState.cols},(_,col) => {
    const slot = createSlotId(row,col);
    return `<button type="button" class="cargo-area-cell" data-area-slot="${slot}" ${heights[slot] ? '' : 'disabled'}>${slot}</button>`;
  }).join('')).join('');
  paintCargoAreaGrid();
}

function paintCargoAreaGrid() {
  const areas = shipBuilderState.cargoAreas;
  const owners = CargoAreas.slotOwners(areas);
  document.querySelectorAll('[data-area-slot]').forEach(cell => {
    const area = areas.find(item => item.id === owners.get(cell.dataset.areaSlot));
    cell.style.setProperty('--area-color', area?.color || '#62788b');
    cell.classList.toggle('is-assigned', Boolean(area));
    cell.classList.toggle('is-selected', Boolean(area && area.id === selectedCargoAreaId));
    cell.setAttribute('aria-pressed', String(Boolean(area && area.id === selectedCargoAreaId)));
    const name = area ? cargoAreaName(area) : t('cargoAreas.unassigned');
    cell.title = `${cell.dataset.areaSlot} · ${name}`;
    cell.setAttribute('aria-label', cell.title);
  });
  const assigned = new Set(owners.keys());
  const heights = mergeShipGridHeights(shipBuilderState.heights,shipBuilderState.overloadHeights);
  document.querySelectorAll('#cargoAreaList [data-area-id]').forEach(card => {
    const area = areas.find(item => item.id === card.dataset.areaId);
    if (area) card.querySelector('small').textContent = t('cargoAreas.capacity', {
      cells: area.slots.length, scu: area.slots.reduce((sum, slot) => sum + (heights[slot] || 0), 0),
    });
  });
  const count = Object.keys(heights).filter(slot=>!assigned.has(slot)).length;
  document.getElementById('cargoAreaRemainder').textContent = t('cargoAreas.remainder',{count});
}

function assignCargoAreaCell(slot) {
  if (!slot || !(shipBuilderState.heights[slot] || shipBuilderState.overloadHeights[slot])) return;
  if (!cargoAreaErase && !shipBuilderState.cargoAreas.some(area => area.id === selectedCargoAreaId)) return;
  shipBuilderState.cargoAreas.forEach(area => {
    area.slots = area.slots.filter(id=>id!==slot);
    if (!cargoAreaErase && area.id === selectedCargoAreaId) area.slots.push(slot);
  });
  paintCargoAreaGrid();
}

function registerCargoAreaEditor() {
  document.getElementById('cargoAreaAdd').onclick = () => {
    const areas = shipBuilderState.cargoAreas;
    if (areas.length >= 40) return;
    const area = {id:createRuntimeId(),name:t('cargoAreas.new',{number:areas.length+1}),nameEn:'',color:CargoAreas.colors[areas.length % CargoAreas.colors.length],slots:[]};
    areas.push(area); selectedCargoAreaId = area.id; cargoAreaErase = false;
    renderCargoAreaEditor();
    const input = document.querySelector(`[data-area-id="${area.id}"] .cargo-area-name`);
    input.focus(); input.select();
  };
  document.getElementById('cargoAreaErase').onchange = event => { cargoAreaErase = event.target.checked; };
  const grid = document.getElementById('cargoAreaGrid');
  let pointer = null, last = '';
  grid.onpointerdown = event => {
    const cell = event.target.closest('[data-area-slot]');
    if (event.button !== 0 || !cell || cell.disabled) return;
    event.preventDefault(); grid.focus({preventScroll:true});
    pointer = event.pointerId; last = cell.dataset.areaSlot;
    grid.classList.add('is-painting'); grid.setPointerCapture(pointer);
    assignCargoAreaCell(last);
  };
  grid.onpointermove = event => {
    if (pointer !== event.pointerId) return;
    const cell = document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-area-slot]');
    if (!cell || !grid.contains(cell) || cell.dataset.areaSlot === last) return;
    last = cell.dataset.areaSlot; assignCargoAreaCell(last);
  };
  const finish = () => { pointer=null; last=''; grid.classList.remove('is-painting'); renderCargoAreaEditor(); };
  grid.onpointerup = event => { if (pointer === event.pointerId) { if (grid.hasPointerCapture(pointer)) grid.releasePointerCapture(pointer); finish(); } };
  grid.onpointercancel = finish;
  grid.onlostpointercapture = () => { if (pointer !== null) finish(); };
  grid.onclick = event => {
    const cell = event.target.closest('[data-area-slot]');
    if (event.detail === 0 && cell && !cell.disabled) { assignCargoAreaCell(cell.dataset.areaSlot); paintCargoAreaGrid(); }
  };
}
