/* Device-local cockpit preferences. Never part of the shared game state. */
(() => {
  const groups = {summary:['ship', 'mission', 'payout', 'balance'], today:['route', 'cargo', 'payments']};
  const key = 'citizen-tools:cockpit:v1';
  const texts = {
    de:{title:'Cockpit anpassen', hint:'Karten und Reihenfolge gelten nur für diese App bzw. diesen Browser.', summary:'Übersicht', today:'Heute wichtig', ship:'Aktuelles Schiff', mission:'Aktive Aufträge', payout:'Geplante Einnahmen', balance:'Kontostand', route:'Route & Fortschritt', cargo:'Fracht & Verladung', payments:'Offene Auszahlungen', up:'Nach oben', down:'Nach unten', reset:'Standardansicht', save:'Übernehmen', cancel:'Abbrechen', empty:'Alle Karten ausgeblendet.', unavailable:'Die Ansicht gilt für diese Sitzung. Der Browser konnte sie nicht dauerhaft speichern.', cargoHint:'Die Frachtkarte erscheint, wenn das aktive Schiff Fracht unterstützt.'},
    en:{title:'Customize cockpit', hint:'Cards and their order apply only to this app or browser.', summary:'Overview', today:'Today', ship:'Current ship', mission:'Active contracts', payout:'Planned income', balance:'Account balance', route:'Route & progress', cargo:'Cargo & loading', payments:'Outstanding payments', up:'Move up', down:'Move down', reset:'Default layout', save:'Apply', cancel:'Cancel', empty:'All cards hidden.', unavailable:'This layout applies to this session. The browser could not save it permanently.', cargoHint:'The cargo card appears when the active ship supports cargo.'},
  };
  const words = () => texts[currentUiLanguage() === 'en' ? 'en' : 'de'];
  function normalize(value) {
    const result = {hidden:[]};
    for (const [group, names] of Object.entries(groups)) {
      const stored = Array.isArray(value?.[group]) ? value[group] : [];
      result[group] = [...new Set([...stored.filter(name => names.includes(name)), ...names])];
    }
    result.hidden = [...new Set((Array.isArray(value?.hidden) ? value.hidden : []).filter(name => Object.values(groups).flat().includes(name)))];
    return result;
  }
  let preferences;
  try { preferences = normalize(JSON.parse(localStorage.getItem(key))); } catch { preferences = normalize(); }
  let draft = null;
  const backdrop = document.createElement('div');
  backdrop.className = 'app-dialog-backdrop'; backdrop.id = 'soloCockpitDialog'; backdrop.hidden = true;
  backdrop.innerHTML = `<section class="app-dialog solo-cockpit-dialog" role="dialog" aria-modal="true" aria-labelledby="soloCockpitTitle"><div class="app-dialog-head"><span class="app-dialog-kicker">FLIGHT DECK</span><h2 id="soloCockpitTitle"></h2></div><p id="soloCockpitHint" class="app-dialog-message"></p><div id="soloCockpitGroups"></div><p id="soloCockpitCargoHint" class="form-hint"></p><div class="app-dialog-actions"><button type="button" id="soloCockpitReset" class="secondary-button"></button><button type="button" id="soloCockpitCancel" class="secondary-button"></button><button type="button" id="soloCockpitSave" class="primary-button"></button></div></section>`;
  document.body.append(backdrop);
  const get = id => document.getElementById(id);
  const dialog = window.createSoloDialog(backdrop, () => { draft = null; });
  const notice = document.createElement('p'); notice.className = 'form-hint'; notice.hidden = true; notice.setAttribute('role', 'status');
  document.querySelector('.flight-welcome').append(notice);
  const empty = document.createElement('p'); empty.className = 'form-hint'; empty.hidden = true; empty.id = 'soloCockpitEmpty';
  document.querySelector('#hubTodayList').after(empty);

  function apply() {
    const visible = [];
    for (const [group, selector] of [['summary', '#hubSummary'], ['today', '#hubTodayList']]) {
      const parent = document.querySelector(selector);
      for (const name of preferences[group]) {
        const card = parent.querySelector(`[data-cockpit-card="${name}"]`);
        if (!card) continue;
        card.hidden = preferences.hidden.includes(name);
        parent.append(card); // Preserve listeners, images and keyboard navigation.
      }
      const count = [...parent.children].filter(card => !card.hidden).length;
      parent.hidden = count === 0;
      parent.dataset.visibleCards = count;
      if (group === 'summary') parent.style.setProperty('--cockpit-columns', [...parent.children].filter(card => !card.hidden).map(card => `minmax(0, ${card.dataset.cockpitCard === 'mission' ? '1.65' : '1'}fr)`).join(' '));
      visible.push(count);
    }
    empty.hidden = visible.some(Boolean);
    empty.textContent = words().empty;
  }
  function renderEditor(focus) {
    const text = words();
    get('soloCockpitGroups').replaceChildren();
    for (const group of Object.keys(groups)) {
      const section = document.createElement('section'); section.className = 'solo-cockpit-group';
      const title = document.createElement('h3'); title.textContent = text[group]; section.append(title);
      draft[group].forEach((name, index) => {
        const row = document.createElement('div'); row.className = 'solo-cockpit-row'; row.dataset.cockpitRow = name;
        const label = document.createElement('label');
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = !draft.hidden.includes(name); input.dataset.cockpitToggle = name;
        input.addEventListener('change', () => { draft.hidden = input.checked ? draft.hidden.filter(value => value !== name) : [...draft.hidden, name]; });
        const caption = document.createElement('span'); caption.textContent = text[name]; label.append(input, caption); row.append(label);
        for (const [action, offset, icon] of [['up', -1, '↑'], ['down', 1, '↓']]) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.textContent = icon; button.dataset.cockpitMove = `${name}-${action}`;
          button.setAttribute('aria-label', `${text[name]}: ${text[action]}`); button.title = text[action];
          button.disabled = index + offset < 0 || index + offset >= draft[group].length;
          button.addEventListener('click', () => { const list = draft[group]; [list[index], list[index + offset]] = [list[index + offset], list[index]]; renderEditor(`${name}-${action}`); });
          row.append(button);
        }
        section.append(row);
      });
      get('soloCockpitGroups').append(section);
    }
    if (focus) {
      const button = backdrop.querySelector(`[data-cockpit-move="${focus}"]`);
      (button?.disabled ? button.closest('.solo-cockpit-row').querySelector('input') : button)?.focus();
    }
  }
  function translate() {
    const text = words();
    document.querySelectorAll('[data-cockpit-open]').forEach(button => button.textContent = text.title);
    for (const [id, name] of [['soloCockpitTitle','title'], ['soloCockpitHint','hint'], ['soloCockpitCargoHint','cargoHint'], ['soloCockpitReset','reset'], ['soloCockpitCancel','cancel'], ['soloCockpitSave','save']]) get(id).textContent = text[name];
    if (draft) renderEditor();
    apply();
  }
  function open() { draft = normalize(preferences); translate(); dialog.open(); }
  document.querySelectorAll('[data-cockpit-open]').forEach(button => button.addEventListener('click', open));
  get('soloCockpitCancel').addEventListener('click', () => dialog.close());
  get('soloCockpitReset').addEventListener('click', () => { draft = normalize(); renderEditor(); });
  get('soloCockpitSave').addEventListener('click', () => {
    preferences = normalize(draft); notice.hidden = true;
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { notice.textContent = words().unavailable; notice.hidden = false; }
    apply(); dialog.close();
  });
  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    try { preferences = normalize(JSON.parse(event.newValue)); apply(); } catch { /* Ignore invalid external values. */ }
  });
  document.querySelector('#uiLanguageSelect').addEventListener('change', translate);
  window.soloCockpit = {apply, open, normalize};
  translate();
})();
