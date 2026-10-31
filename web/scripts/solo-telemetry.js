(() => {
  const panel = document.getElementById('soloTelemetryPanel');
  const form = document.getElementById('soloTelemetryForm');
  const status = document.getElementById('soloTelemetryStatus');
  const inbox = document.getElementById('soloTelemetryInbox');
  const pickFolder = document.getElementById('soloChooseGameDirectory');
  const pickerMessage = document.getElementById('soloDirectoryPickerMessage');
  const pc = ['127.0.0.1', 'localhost'].includes(location.hostname);
  let latest = null, busy = false, loaded = false, choosing = false, issue = '';
  const say = (de, en) => currentUiLanguage() === 'en' ? en : de;
  const D = window.TelemetryDomain;
  function updateFolderPicker() {
    const available = pc && typeof window.pywebview?.api?.choose_game_directory === 'function';
    pickFolder.disabled = !available || !loaded || choosing;
    document.getElementById('soloDirectoryPickerHint').hidden = available;
  }
  function updateLogPath() {
    const directory = form.elements.namedItem('gameDirectory');
    directory.required = form.elements.namedItem('logEnabled').checked;
    const root = directory.value.trim().replace(/^"|"$/g, '').replace(/[\\/]+$/g, '');
    document.getElementById('soloLogFile').textContent = root
      ? `${root}\\${form.elements.namedItem('gameChannel').value}\\Game.log`
      : say('Bitte Programmordner angeben.', 'Enter the installation folder.');
  }
  function places() {
    const known = window.systemDatabaseController?.getActiveLocations?.() || [];
    return [...known, ...collectLocationSuggestions().filter(name => !known.some(p => p.name === name)).map(name => ({name}))];
  }
  function blocked() {
    return choosing || !window.soloAppReady || !window.soloSync?.status.hydrated || window.soloSync.status.blocked
      || window.personalTransferBusy || missionAutoImportBusy || soloEditing();
  }
  function decision(event) { return D.plan(event, state, latest.settings, places(), latest.live, Date.now(), latest); }
  const reasons = {
    ship:['Schiff eindeutig zuordnen', 'Link the ship'], location:['Ort zuordnen', 'Link the location'],
    mission:['Auftrag mit Spiel-ID verknüpfen', 'Link the contract to its game ID'],
    objective:['Teilziel einer Frachtposition zuordnen', 'Link the objective to a cargo line'],
    offline:['Wartet auf aktive Spielsitzung', 'Waiting for an active game session'],
    disabled:['Automatik ausgeschaltet', 'Automation disabled'],
    grid:['Fracht passt nicht vollständig ins aktive Schiff', 'Cargo does not fully fit the active ship'],
    expired:['Veraltetes Ereignis', 'Expired event'],
  };
  function renderStatus() {
    if (!latest) return;
    status.textContent = issue || (!latest.enabled ? say('Log-Erkennung ausgeschaltet', 'Log reading disabled')
      : latest.error === 'directory_required' ? say('Bitte Star-Citizen-Programmordner angeben.', 'Enter the Star Citizen installation folder.')
      : latest.error ? say('Game.log im gewählten Ordner und Spielkanal nicht lesbar.', 'Cannot read Game.log in the selected folder and channel.')
      : latest.live ? say('Spiel verbunden', 'Game connected') : say('Kein aktuelles Spielsignal – letzte Erkennung:', 'No live game signal — last detection:'));
    const details = document.getElementById('soloTelemetryDetails');
    details.textContent = [latest.player, latest.ship?.name, latest.location,
      latest.at ? new Date(latest.at).toLocaleString() : '', latest.path].filter(Boolean).join(' · ');
    const badge = document.getElementById('runTelemetryStatus');
    badge.hidden = !latest.enabled;
    badge.textContent = latest.live ? say('Game.log verbunden · automatische Erkennung', 'Game.log connected · automatic detection')
      : say('Game.log: keine aktuellen Daten', 'Game.log: no live data');
    const snapshot = D.balance(state.telemetryBalance);
    const ledger = (state.ledgerEntries || []).reduce((sum, entry) => sum + (entry.flow === 'expense' ? -1 : 1) * (Number(entry.amountAuec) || 0), 0);
    const text = snapshot ? `${say('Spielkontostand', 'Game balance')}: ${snapshot.amount.toLocaleString()} aUEC · ${new Date(snapshot.at).toLocaleString()} · ${say('Differenz zur Buchhaltung', 'Difference from ledger')}: ${(snapshot.amount - ledger).toLocaleString()} aUEC`
      : say('Noch kein sicher erkannter Kontostand. Ein frischer mobiGlas-Screenshot muss deinen Handle und den Kontostand zeigen.', 'No verified balance yet. A fresh mobiGlas screenshot must show your handle and balance.');
    document.querySelectorAll('[data-telemetry-balance]').forEach(node => {node.textContent = text;});
    if (soloEditing()) return;
    inbox.replaceChildren();
    const saved = D.links(state.telemetryLinks);
    const selectRow = (label, choices, value, group, bindingKey) => {
      const row = document.createElement('label'); row.className = 'telemetry-link-row';
      const caption = document.createElement('span'); caption.textContent = label;
      const select = document.createElement('select'); select.append(new Option(say('Zuordnung auswählen …', 'Choose a match …'), ''));
      for (const item of choices) select.append(new Option(item.name, item.id));
      select.value = value || '';
      select.addEventListener('change', () => {
        state.telemetryLinks = D.links(state.telemetryLinks);
        if (select.value) state.telemetryLinks[group][bindingKey] = select.value;
        else delete state.telemetryLinks[group][bindingKey];
        persist();
      });
      row.append(caption, select); inbox.append(row);
    };
    const contracts = new Map((latest.contracts || []).map(contract => [contract.id, contract]));
    for (const event of latest.events) if (event.missionId && !contracts.has(event.missionId)) {
      contracts.set(event.missionId, {id:event.missionId, title:say('Auftrag', 'Contract')});
    }
    for (const contract of contracts.values()) {
      const candidates = state.missions.filter(mission => !['paid', 'cancelled'].includes(mission.status)
        && !Object.entries(saved.missions).some(([gameId, id]) => gameId !== contract.id && id === mission.id));
      selectRow(`${contract.title} · ${contract.id.slice(0, 8)}`, candidates.map(mission => ({id:mission.id,
        name:`${mission.title} · ${mission.pickup || mission.segments?.[0]?.pickup || ''} → ${mission.dropoff || mission.segments?.[0]?.dropoff || ''}`})),
      saved.missions[contract.id], 'missions', contract.id);
    }
    for (const event of latest.events.slice(-30)) {
      const plan = decision(event);
      if (plan.action) continue;
      const label = `${say(...(reasons[plan.reason] || ['Zuordnung offen', 'Unmatched']))}: ${event.name || event.value || event.objectiveId || event.missionId || event.kind}`;
      if (plan.reason === 'ship') selectRow(label, getActiveFleetEntries().map(entry => ({id:entry.id, name:formatFleetEntryDisplayName(entry)})), saved.ships[plan.bindingKey], 'ships', plan.bindingKey);
      else if (plan.reason === 'location') selectRow(label, places().map(place => ({id:place.name, name:place.name})), saved.locations[plan.bindingKey], 'locations', plan.bindingKey);
      else if (plan.reason === 'objective') {
        const mission = state.missions.find(item => item.id === plan.missionId);
        const targets = mission?.type === 'courier' ? mission.serviceDetails?.packages || [] : mission?.segments || [];
        selectRow(label, targets.map(item => ({id:item.id, name:`${item.title || item.name || mission.title} · ${item.pickup || ''} → ${item.dropoff || item.destination || ''} (${say('gesamte Position', 'entire line')})`})), saved.objectives[plan.bindingKey], 'objectives', plan.bindingKey);
      } else if (plan.reason !== 'mission') {
        const row = document.createElement('p'); row.textContent = label; inbox.append(row);
      }
    }
  }
  async function refresh() {
    if (busy || choosing) return;
    busy = true;
    try {
      const {response, payload} = await soloRequestJson('./api/solo/telemetry', {cache:'no-store'});
      if (!response.ok) throw new Error('unavailable');
      latest = payload;
      if (!loaded) {
        for (const field of form.elements) {
          if (!Object.hasOwn(payload.settings, field.name)) continue;
          if (field.type === 'checkbox') field.checked = payload.settings[field.name]; else field.value = payload.settings[field.name];
        }
        updateLogPath();
        loaded = true;
        updateFolderPicker();
      }
      issue = '';
      if (!blocked() && payload.events.length && await getSoloSync().refresh() && !blocked()) {
        for (const event of payload.events) {
          const plan = decision(event);
          if (!plan.action) continue;
          // Do not replay intermediate ship/location observations when a more
          // recent observation of the same kind is already queued.
          const superseded = ['ship', 'location'].includes(event.kind) && payload.events.some(other => other.kind === event.kind && other.at > event.at);
          const ticket = getSoloSync().checkpoint();
          const staged = stageTelemetryEvent(event, superseded ? {action:'discard'} : plan, latest.settings);
          if (!staged) { issue = say(...reasons.grid); continue; }
          if (await getSoloSync().commitImports(staged, ticket)) latest.events = latest.events.filter(item => item.id !== event.id);
          break;
        }
      }
      renderStatus();
    } catch { status.textContent = say('Erkennung nicht erreichbar.', 'Detection unavailable.'); }
    finally { busy = false; }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!pc || busy || choosing) return;
    busy = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      for (const field of form.elements) if (field.type === 'checkbox') values[field.name] = field.checked;
      const {response, payload} = await soloRequestJson('./api/solo/settings', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});
      if (!response.ok) throw new Error(payload.error);
      loaded = false;
      updateFolderPicker();
      status.textContent = say('Einstellungen gespeichert.', 'Settings saved.');
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; }
    void refresh();
  });
  pickFolder.addEventListener('click', async () => {
    if (pickFolder.disabled || choosing) return;
    choosing = true; updateFolderPicker();
    pickerMessage.hidden = true;
    try {
      const directory = form.elements.namedItem('gameDirectory');
      const result = await window.pywebview.api.choose_game_directory(directory.value);
      if (!result.ok) throw new Error(result.error);
      if (!result.cancelled && typeof result.directory === 'string') {
        directory.value = result.directory;
        updateLogPath();
        directory.focus();
      }
    } catch (error) {
      const messages = {
        directory_invalid:['Bitte einen lokalen Programmordner oberhalb von LIVE/PTU wählen.', 'Choose a local installation folder containing LIVE/PTU.'],
        directory_busy:['Ein Dialog oder Update ist bereits geöffnet.', 'A dialog or update is already open.'],
        directory_native_only:['Die Ordnerauswahl ist nur in der Windows-App verfügbar.', 'Folder selection is only available in the Windows app.'],
      };
      pickerMessage.textContent = say(...(messages[error.message] || ['Die Ordnerauswahl konnte nicht geöffnet werden.', 'Could not open the folder chooser.']));
      pickerMessage.hidden = false;
    } finally { choosing = false; updateFolderPicker(); }
  });
  form.addEventListener('input', updateLogPath);
  form.addEventListener('change', updateLogPath);
  if (!pc) for (const field of form.elements) field.disabled = true;
  for (const node of panel.querySelectorAll('[data-telemetry-en]')) node.dataset.telemetryDe = node.textContent;
  function translate() {
    panel.querySelectorAll('[data-telemetry-en]').forEach(node => {node.textContent = say(node.dataset.telemetryDe, node.dataset.telemetryEn);});
    updateLogPath();
    updateFolderPicker();
    renderStatus();
  }
  document.getElementById('uiLanguageSelect')?.addEventListener('change', translate);
  window.addEventListener('pywebviewready', updateFolderPicker);
  window.soloTelemetry = {refresh, render:renderStatus};
  translate(); void refresh(); setInterval(refresh, 2000);
})();
