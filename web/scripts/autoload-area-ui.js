function renderAutoloadAreaControl(mission, includeTitle = false) {
  const area = Autoload.normalizeCargoArea(mission.autoloadArea);
  return `<label class="autoload-area-field" title="${escapeHtml(t('autoload.area.hint'))}"><span>${escapeHtml(includeTitle ? mission.title : t('autoload.area.label'))}</span><select data-autoload-mission="${escapeHtml(mission.id)}" aria-label="${escapeHtml(t('autoload.area.forMission', { title: mission.title }))}">${['all', 'left', 'right'].map(value => `<option value="${value}" ${area === value ? 'selected' : ''}>${escapeHtml(t(`autoload.area.${value}`))}</option>`).join('')}</select></label>`;
}

function bindAutoloadAreaControls(root) {
  root.querySelectorAll('[data-autoload-mission]').forEach(select => {
    select.onchange = () => {
      const mission = state.missions.find(item => item.id === select.dataset.autoloadMission);
      if (!mission) return;
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
