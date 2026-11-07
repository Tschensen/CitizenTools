// Read-only history: fetching this view never mutates the planner or its event inbox.
(() => {
  const panel = document.getElementById('soloJournalPanel');
  const byId = suffix => document.getElementById('soloJournal' + suffix);
  const select = byId('Session'), status = byId('Status');
  let selected = '', nextBefore = '', cursorLoaded = false, busy = false, latest = null, signature = '';
  let locations = [], placeNames = new Map();
  const sessions = new Map();
  const words = {
    de:{tab:'Sitzungslogbuch',intro:'Deine Reisen und Ereignisse aus der Game.log.',refresh:'Aktualisieren',session:'Sitzung',older:'Ältere Sitzungen',
      journeys:'Reisen',events:'Ereignisse',routes:'Geplante Routen und Kraftstoffbedarf',basis:'Wie werden Zeit und Kraftstoff berechnet?',
      timeHint:'Reisezeit: vom erkannten Verlassen eines Ortsbereichs bis zur bestätigten Ankunft. Sie umfasst auch Umwege und Pausen unterwegs.',
      fuelHint:'Kraftstoffbedarf: Schätzung des Spiels für die geplante Quantum-Route, kein gemessener Verbrauch. Das Log nennt keine Einheit; daher erfolgt keine Umrechnung in Liter oder SCU. Fehlende Werte bleiben offen.',
      empty:'Noch keine Sitzung erfasst. Aktiviere die Game.log-Erkennung unter Einstellungen → Spiel-Log. Die vorhandene Game.log wird ebenfalls ins Logbuch übernommen.',
      noTrips:'Noch keine Reise zwischen erkannten Ortsbereichen.',noRoutes:'Für diese Sitzung liegt keine passende Kraftstoffschätzung vor.',noEvents:'Noch keine Ereignisse.',
      loading:'Game.log wird eingelesen …',disabled:'Log-Erkennung ausgeschaltet. Gespeicherte Sitzungen bleiben verfügbar.',error:'Das Logbuch konnte nicht geladen werden. Bitte die Verbindung prüfen und erneut versuchen.',
      partial:'Der Sitzungsbeginn fehlt in der Log-Datei.',truncated:'Die ersten 2.000 Einträge dieser Sitzung werden angezeigt.',last:'Letzte Meldung',ended:'Beendet',
      time:'Erfasster Zeitraum',travelTime:'Reisezeit gesamt',completed:'Aufträge abgeschlossen',arrived:'Angekommen',open:'Ankunft noch nicht erfasst',interrupted:'Reise nicht vollständig erfasst',
      unknown:'Unbekannter Ort',fuel:'Quantum-Kraftstoffbedarf',units:'Logwert · geschätzt',missingFuel:'Keine passende Schätzung',estimateAt:'Berechnet',
      location:'Ort erkannt',ship:'An Bord',ship_exit:'Schiff verlassen',ship_loss:'Schiffsverlust gemeldet',accepted:'Auftrag angenommen',completedEvent:'Auftrag abgeschlossen',payment:'Auftragszahlung erkannt',contract:'Auftrag',
      durationHint:'Summe vollständig erfasster Reisen',owner:'Besitzer'},
    en:{tab:'Session journal',intro:'Your journeys and events from Game.log.',refresh:'Refresh',session:'Session',older:'Older sessions',
      journeys:'Journeys',events:'Events',routes:'Planned routes and fuel requirements',basis:'How are time and fuel calculated?',
      timeHint:'Travel time runs from the detected departure from a location area to confirmed arrival. It includes detours and pauses along the way.',
      fuelHint:'Fuel requirement is the game’s estimate for the planned quantum route, not measured consumption. The log provides no unit, so values are not converted to litres or SCU. Missing values remain unknown.',
      empty:'No sessions recorded yet. Enable Game.log detection in Settings → Game log. The existing Game.log is also added to the journal.',
      noTrips:'No journey between detected location areas yet.',noRoutes:'No matching fuel estimate is available for this session.',noEvents:'No events yet.',
      loading:'Reading Game.log …',disabled:'Log detection is disabled. Saved sessions remain available.',error:'The journal could not be loaded. Please check the connection and try again.',
      partial:'The start of this session is missing from the log file.',truncated:'Showing the first 2,000 entries in this session.',last:'Last signal',ended:'Ended',
      time:'Recorded period',travelTime:'Total travel time',completed:'Contracts completed',arrived:'Arrived',open:'Arrival not yet recorded',interrupted:'Journey incompletely recorded',
      unknown:'Unknown location',fuel:'Quantum fuel requirement',units:'Log value · estimated',missingFuel:'No matching estimate',estimateAt:'Calculated',
      location:'Location detected',ship:'On board',ship_exit:'Left ship',ship_loss:'Ship loss reported',accepted:'Contract accepted',completedEvent:'Contract completed',payment:'Contract payment detected',contract:'Contract',
      durationHint:'Sum of fully recorded journeys',owner:'Owner'}
  };
  const lang = () => currentUiLanguage() === 'en' ? 'en' : 'de';
  const text = key => words[lang()][key] || key;
  const escape = value => escapeHtml(String(value ?? ''));
  const number = value => Number(value).toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB', {maximumFractionDigits:2});
  const date = (at, full = false) => Number.isFinite(Date.parse(at)) ? new Date(at).toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB',
    full ? {dateStyle:'short',timeStyle:'short'} : {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '—';
  const duration = value => {
    if (!Number.isFinite(value) || value < 0) return '—';
    const seconds = Math.floor(value), hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
    return [hours ? `${hours} h` : '', `${minutes} min`, `${seconds % 60} s`].filter(Boolean).join(' ');
  };
  function place(raw) {
    if (!raw) return text('unknown');
    if (!placeNames.has(raw)) placeNames.set(raw, TelemetryDomain.resolveLocation(raw, locations, TelemetryDomain.links(state.telemetryLinks).locations) || raw);
    return placeNames.get(raw);
  }
  const ship = entry => [entry.ship?.name, entry.ship?.owner ? `${text('owner')}: ${entry.ship.owner}` : ''].filter(Boolean).join(' · ');
  const fuel = entry => Number.isFinite(entry.fuelEstimate) ? `${number(entry.fuelEstimate)} <small>${escape(text('units'))}</small>` : escape(text('missingFuel'));
  function render(payload) {
    const changedSession = latest?.session?.id !== payload.session?.id;
    latest = payload;
    document.querySelectorAll('[data-journal-text]').forEach(node => {node.textContent = text(node.dataset.journalText);});
    locations = window.systemDatabaseController?.getActiveLocations?.() || [];
    const key = JSON.stringify([lang(), payload.session, payload.entries, payload.enabled, payload.loading, payload.truncated,
      state.telemetryLinks?.locations, locations.map(place => [place.name,place.aliases])]);
    if (key === signature) return;
    signature = key;
    placeNames = new Map();
    const entries = payload.entries || [], session = payload.session;
    status.textContent = [payload.loading ? text('loading') : '', !payload.enabled ? text('disabled') : '',
      !session ? text('empty') : session.partial ? text('partial') : '', payload.truncated ? text('truncated') : ''].filter(Boolean).join(' ');
    const trips = entries.filter(entry => entry.kind === 'trip');
    const recorded = session ? (Date.parse(session.endedAt || session.lastAt) - Date.parse(session.startedAt)) / 1000 : null;
    const travelSeconds = trips.filter(entry => entry.status === 'arrived').reduce((sum, entry) => sum + (entry.durationSeconds || 0), 0);
    byId('Summary').innerHTML = session ? `<div><span>${escape(text('time'))}</span><strong>${duration(recorded)}</strong><small>${escape(text(session.endedAt ? 'ended' : 'last'))}: ${date(session.endedAt || session.lastAt, true)}</small></div>
      <div><span>${escape(text('travelTime'))}</span><strong>${duration(travelSeconds)}</strong><small>${escape(text('durationHint'))}</small></div>
      <div><span>${escape(text('completed'))}</span><strong>${entries.filter(entry => entry.kind === 'completed').length}</strong><small>${escape(session.player)} · ${escape(session.channel)}</small></div>` : '';
    byId('Trips').innerHTML = trips.length ? trips.map(entry => `<article class="journal-trip"><div class="journal-trip-heading"><div><strong>${escape(place(entry.from))} → ${entry.to ? escape(place(entry.to)) : '…'}</strong><small>${escape(ship(entry))}</small></div><span class="journal-duration">${entry.status === 'arrived' ? duration(entry.durationSeconds) : escape(text(entry.status))}</span></div><p>${date(entry.at)}${entry.endedAt ? ' – '+date(entry.endedAt) : ''} · ${escape(text(entry.status))}</p><p class="journal-fuel">${escape(text('fuel'))}: ${fuel(entry)}</p></article>`).join('') : `<p class="journal-empty">${escape(text('noTrips'))}</p>`;
    const routes = entries.filter(entry => entry.kind === 'route');
    byId('Estimates').innerHTML = routes.length ? routes.map(entry => `<article class="journal-trip"><strong>${escape(place(entry.from))} → ${escape(place(entry.to))}</strong><p>${escape(ship(entry))} · ${escape(text('estimateAt'))}: ${date(entry.at)}</p><p class="journal-fuel">${escape(text('fuel'))}: ${fuel(entry)}</p></article>`).join('') : `<p class="journal-empty">${escape(text('noRoutes'))}</p>`;
    if (changedSession) byId('Routes').open = !trips.length && routes.length > 0;
    const events = entries.filter(entry => !['trip','route'].includes(entry.kind));
    byId('Events').innerHTML = events.length ? events.map(entry => {
      const label = text(entry.kind === 'completed' ? 'completedEvent' : entry.kind);
      const detail = entry.kind === 'location' ? place(entry.place) : entry.ship ? ship(entry) :
        [entry.title || text('contract'), entry.kind === 'payment' ? `${number(entry.amount)} aUEC` : ''].filter(Boolean).join(' · ');
      return `<li><time datetime="${escape(entry.at)}">${date(entry.at)}</time><div><strong>${escape(label)}</strong><span>${escape(detail)}</span></div></li>`;
    }).join('') : `<li class="journal-empty">${escape(text('noEvents'))}</li>`;
  }
  async function refresh(older = false) {
    if (busy || !panel.getClientRects().length) return;
    busy = true;
    byId('Refresh').disabled = byId('Older').disabled = select.disabled = true;
    try {
      const query = new URLSearchParams();
      if (selected) query.set('session', selected);
      if (older && nextBefore) query.set('before', nextBefore);
      const {response, payload} = await soloRequestJson('./api/solo/journal?' + query, {cache:'no-store'});
      if (!response.ok || !payload.ok) throw new Error('journal');
      for (const session of payload.sessions) sessions.set(session.id, session);
      if (older || !cursorLoaded) {nextBefore = payload.nextBefore; cursorLoaded = true;}
      const selectedId = payload.session?.id || '';
      select.replaceChildren(...Array.from(sessions.values()).sort((a,b) => b.startedAt.localeCompare(a.startedAt)).map(session =>
        new Option(`${date(session.startedAt, true)} · ${session.player || session.channel} · ${session.channel}`,session.id)));
      select.value = selectedId;
      byId('Older').hidden = !nextBefore;
      render(payload);
    } catch {
      signature = '';
      status.textContent = text('error');
    } finally {
      busy = false;
      byId('Refresh').disabled = byId('Older').disabled = select.disabled = false;
    }
  }
  select.addEventListener('change', () => {selected = select.value; void refresh();});
  byId('Refresh').addEventListener('click', () => void refresh());
  byId('Older').addEventListener('click', () => void refresh(true));
  document.getElementById('uiLanguageSelect')?.addEventListener('change', () => {
    document.querySelectorAll('[data-journal-text]').forEach(node => {node.textContent = text(node.dataset.journalText);});
    if (latest) render(latest);
  });
  // Opening Statistics may restore the journal tab without clicking its sub-tab.
  const observer = new MutationObserver(() => void refresh());
  observer.observe(panel.closest('[data-page]'), {attributes:true,attributeFilter:['class']});
  window.soloJournal = {refresh};
  setInterval(() => {if (!document.hidden && document.activeElement !== select) void refresh();}, 10000);
  document.querySelectorAll('[data-journal-text]').forEach(node => {node.textContent = text(node.dataset.journalText);});
  void refresh();
})();
