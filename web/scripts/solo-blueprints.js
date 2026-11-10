// Collection across sessions, kept separate from the planner and financial state.
(() => {
  const panel = document.getElementById('soloBlueprintPanel');
  const byId = suffix => document.getElementById('soloBlueprint' + suffix);
  const search = byId('Search'), profile = byId('Profile');
  let latest = null, busy = false, signature = '';
  const words = {
    de:{tab:'Baupläne',intro:'Deine erfassten Baupläne aus allen gespeicherten Sitzungen.',refresh:'Aktualisieren',search:'Bauplan suchen',profile:'Spieler und Spielkanal',all:'Alle',
      hint:'Erfasst werden „Bauplan erhalten“-Meldungen aus der Game.log. Frühere Freischaltungen ohne Log-Meldung fehlen; mehrfach erkannte Meldungen sind keine Stückzahl.',
      empty:'Noch keine Baupläne erfasst. Aktiviere die Game.log-Erkennung unter Einstellungen → Game.log.',noMatch:'Keine passenden Baupläne.',count:'erfasste Baupläne',
      first:'Erstmals erfasst',last:'Zuletzt erfasst',observations:'Meldungen',unknown:'Spieler unbekannt',loading:'Game.log wird eingelesen …',disabled:'Log-Erkennung ausgeschaltet. Gespeicherte Baupläne bleiben verfügbar.',
      error:'Die Baupläne konnten nicht geladen werden. Bitte Verbindung prüfen und erneut versuchen.',truncated:'Die neuesten 1.000 Einträge werden angezeigt.'},
    en:{tab:'Blueprints',intro:'Your recorded blueprints from all saved sessions.',refresh:'Refresh',search:'Search blueprints',profile:'Player and game channel',all:'All',
      hint:'Records “Bauplan erhalten” notifications from the German Game.log. Earlier unlocks without a log notification are missing; repeated observations are not item quantities.',
      empty:'No blueprints recorded yet. Enable Game.log detection in Settings → Game log.',noMatch:'No matching blueprints.',count:'recorded blueprints',
      first:'First recorded',last:'Last recorded',observations:'Notifications',unknown:'Unknown player',loading:'Reading Game.log …',disabled:'Log detection is disabled. Saved blueprints remain available.',
      error:'Blueprints could not be loaded. Please check the connection and try again.',truncated:'Showing the latest 1,000 entries.'}
  };
  const lang = () => currentUiLanguage() === 'en' ? 'en' : 'de';
  const text = key => words[lang()][key];
  const esc = value => escapeHtml(String(value ?? ''));
  const profileKey = entry => JSON.stringify([entry.channel,entry.player]);
  const date = at => new Date(at).toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB', {dateStyle:'short',timeStyle:'short'});
  function render() {
    document.querySelectorAll('[data-blueprint-text]').forEach(node => {node.textContent = text(node.dataset.blueprintText);});
    const items = latest?.blueprints || [], selected = profile.value;
    const profiles = new Map(items.map(entry => [profileKey(entry),`${entry.player || text('unknown')} · ${entry.channel}`]));
    profile.replaceChildren(new Option(text('all'), ''), ...[...profiles].map(([id,label]) => new Option(label,id)));
    profile.value = profiles.has(selected) ? selected : '';
    const query = search.value.trim().toLocaleLowerCase();
    const shown = items.filter(entry => (!profile.value || profileKey(entry) === profile.value) && entry.name.toLocaleLowerCase().includes(query))
      .sort((a,b) => a.name.localeCompare(b.name,lang(),{numeric:true}));
    byId('Status').textContent = [latest?.loading ? text('loading') : '', latest && !latest.enabled ? text('disabled') : '', latest?.truncated ? text('truncated') : ''].filter(Boolean).join(' ');
    byId('Count').textContent = shown.length === 1 ? (lang() === 'de' ? '1 erfasster Bauplan' : '1 recorded blueprint') : `${shown.length} ${text('count')}`;
    byId('List').innerHTML = shown.length ? shown.map(entry => `<article class="journal-trip blueprint-card"><strong>${esc(entry.name)}</strong><small>${esc(entry.player || text('unknown'))} · ${esc(entry.channel)}</small><p>${esc(text('first'))}: ${esc(date(entry.firstAt))}</p>${entry.observations > 1 ? `<p>${esc(text('last'))}: ${esc(date(entry.lastAt))} · ${esc(text('observations'))}: ${entry.observations}</p>` : ''}</article>`).join('')
      : `<p class="journal-empty">${esc(text(items.length ? 'noMatch' : 'empty'))}</p>`;
  }
  async function refresh() {
    if (busy || !panel.getClientRects().length) return;
    busy = true; byId('Refresh').disabled = true;
    try {
      const {response,payload} = await soloRequestJson('./api/solo/blueprints', {cache:'no-store'});
      if (!response.ok || !payload.ok) throw Error('blueprints');
      latest = payload;
      const key = JSON.stringify([lang(),payload]);
      if (key !== signature) {signature = key; render();}
    } catch {signature = ''; byId('Status').textContent = text('error');}
    finally {busy = false; byId('Refresh').disabled = false;}
  }
  search.addEventListener('input', render);
  profile.addEventListener('change', render);
  byId('Refresh').addEventListener('click', () => void refresh());
  document.getElementById('uiLanguageSelect')?.addEventListener('change', render);
  new MutationObserver(() => void refresh()).observe(panel.closest('[data-page]'), {attributes:true,attributeFilter:['class']});
  setInterval(() => {if (!document.hidden && ![search,profile].includes(document.activeElement)) void refresh();}, 10000);
  window.soloBlueprints = {refresh};
  render();
})();
