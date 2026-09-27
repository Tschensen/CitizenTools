function getMissionCargoProfile(mission) {
  const entry = state.fleet.find(item => item.id === mission?.assignedFleetEntryId);
  return entry ? findShipLibraryEntryById(entry.shipId) : null;
}

function getAutoloadAreaContext() {
  const profile = findShipLibraryEntryById(state.layout.shipId);
  const areas = profile?.cargoAreas || [];
  return { profile, areas, owners: CargoAreas.slotOwners(areas) };
}

function getMissionCargoAreaSelection(mission, profile = getMissionCargoProfile(mission)) {
  const id = String(mission?.autoloadAreaId || '');
  const available = profile && (id === '__remaining__' || profile.cargoAreas?.some(area => area.id === id));
  return { id, unavailable: Boolean(id && (!available || mission.autoloadAreaShipId !== profile?.id)) };
}

function renderAutoloadAreaControl(mission, includeTitle = false) {
  const profile = getMissionCargoProfile(mission);
  const areas = profile?.cargoAreas || [];
  const selection = getMissionCargoAreaSelection(mission, profile);
  const legacy = Autoload.normalizeCargoArea(mission.autoloadArea);
  const value = selection.unavailable ? `missing:${selection.id}` : selection.id ? `region:${selection.id}` : legacy;
  const options = [{ value:'all', label:t('autoload.area.all') }, ...areas.map(area => ({value:`region:${area.id}`,label:cargoAreaName(area)}))];
  const owners = CargoAreas.slotOwners(areas);
  const hasRemaining = Object.keys(mergeShipGridHeights(profile?.gridHeights || {},profile?.overloadGridHeights || {})).some(slot=>!owners.has(slot));
  if ((areas.length && hasRemaining) || selection.id === '__remaining__') options.push({value:'region:__remaining__',label:t('cargoAreas.unassigned')});
  if (selection.unavailable) options.push({value,label:t('cargoAreas.missing'),disabled:true});
  if (!selection.id && legacy !== 'all') options.push({value:legacy,label:t(`cargoAreas.legacy.${legacy}`)});
  return `<label class="autoload-area-field" title="${escapeHtml(t('cargoAreas.autoloadHint'))}"><span>${escapeHtml(includeTitle ? mission.title : t('autoload.area.label'))}</span><select data-autoload-mission="${escapeHtml(mission.id)}" aria-label="${escapeHtml(t('autoload.area.forMission', { title: mission.title }))}">${options.map(option=>`<option value="${escapeHtml(option.value)}" ${option.value === value ? 'selected' : ''} ${option.disabled ? 'disabled' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>${selection.unavailable ? `<small class="cargo-area-warning">${escapeHtml(t('cargoAreas.missingHint'))}</small>` : ''}</label>`;
}

function bindAutoloadAreaControls(root) {
  root.querySelectorAll('[data-autoload-mission]').forEach(select => {
    select.onchange = () => {
      const mission = state.missions.find(item => item.id === select.dataset.autoloadMission);
      if (!mission) return;
      const profile = getMissionCargoProfile(mission);
      mission.autoloadAreaId = select.value.startsWith('region:') ? select.value.slice(7) : '';
      mission.autoloadAreaShipId = mission.autoloadAreaId ? profile?.id || '' : '';
      mission.autoloadArea = Autoload.normalizeCargoArea(select.value);
      lastAutoLoadResult = null;
      lastRunAutoLoadResult = null;
      persist(); render();
    };
  });
}

function renderRunAutoloadAreas(entries) {
  const root = document.getElementById('runAutoloadAreas');
  if (!root) return;
  const missions = [...new Map(entries.filter(({ load }) => !load.placement && !isLoadDelivered(load)).map(({ mission }) => [mission.id, mission])).values()];
  root.innerHTML = missions.map(mission => renderAutoloadAreaControl(mission, true)).join('');
  bindAutoloadAreaControls(root);
}
