(() => {
  const panel = document.getElementById('soloTelemetryPanel');
  const form = document.getElementById('soloTelemetryForm');
  const status = document.getElementById('soloTelemetryStatus');
  const inbox = document.getElementById('soloTelemetryInbox');
  const pickFolder = document.getElementById('soloChooseGameDirectory');
  const pickerMessage = document.getElementById('soloDirectoryPickerMessage');
  const pc = ['127.0.0.1', 'localhost'].includes(location.hostname);
  let latest = null, busy = false, loaded = false, choosing = false, issue = '';
  let renderedShip = '';
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
    payment_completion:['Zahlung wartet auf den Auftragsabschluss', 'Payment is waiting for contract completion'],
    payment_failed:['Zahlung konnte nicht verbucht werden – bitte prüfen', 'Payment could not be booked — please review'],
    ship_owner:['Fremdes Schiff oder Besitzer nicht bestätigt', 'Other owner or ownership not confirmed'],
    ship_instance:['Schiffsinstanz zuordnen – vorhandenes oder zusätzliches Schiff', 'Link this instance — existing or additional ship'],
    ship_new:['Eigenes Schiff erkannt – Aufnahme in die Flotte prüfen', 'Own ship detected — review adding it to the fleet'],
    ship_profile:['Kein eindeutiges Modell in der Schiffsdatenbank', 'No unique model in the ship database'],
    ship_identity:['Wartet auf eine lokale Meldung mit Schiffs-ID', 'Waiting for local evidence with a ship ID'],
    ship_loss_link:['Verlustmeldung einem eigenen Schiff zuordnen', 'Link the loss report to an own ship'],
  };
  async function fleetAction(build) {
    if (busy || blocked()) return false;
    busy = true;
    try {
      if (!await getSoloSync().refresh() || blocked()) return false;
      const ticket = getSoloSync().checkpoint(), staged = build();
      if (!staged) throw new Error(say('Die Zuordnung hat sich geändert. Bitte erneut prüfen.', 'The match has changed. Please review again.'));
      const committed = staged.telemetryIds?.length
        ? await getSoloSync().commitImports(staged, ticket) : await getSoloSync().commitChange(staged.state, ticket);
      if (!committed) throw new Error(say('Änderung nicht gespeichert. Bitte erneut prüfen.', 'Change not saved. Please review again.'));
      if (latest) latest.events = latest.events.filter(event => !(staged.telemetryIds || []).includes(event.id));
      issue = '';
      return true;
    } catch (error) { issue = error.message; return false; }
    finally { busy = false; renderStatus(); }
  }
  function chooseShip(eventId, fleetId) {
    return fleetAction(() => {
      const event = latest.events.find(item => item.id === eventId);
      if (!event || !['ship_instance','ship_new','ship_loss_link'].includes(decision(event).reason)) return null;
      let plan;
      if (fleetId) {
        if (!FleetLog.candidates(event, state).some(entry => entry.id === fleetId)) return null;
        if (state.fleet.some(entry => FleetLog.sameIdentity(entry.logIdentity, event) && entry.id !== fleetId)) return null;
        plan = {action:event.kind === 'ship_loss' ? 'ship_loss' : 'ship', fleetId};
      } else {
        const profiles = FleetLog.profiles(event, state);
        if (event.kind !== 'ship' || profiles.length !== 1) return null;
        plan = {action:'ship_create', shipId:profiles[0].id};
      }
      const staged = stageTelemetryEvent(event, plan, latest.settings);
      if (staged && fleetId) {
        staged.state.telemetryLinks = D.links(staged.state.telemetryLinks);
        for (const [key, value] of Object.entries(staged.state.telemetryLinks.ships)) {
          if (value === fleetId) delete staged.state.telemetryLinks.ships[key];
        }
        staged.state.telemetryLinks.ships[FleetLog.bindingKey(event)] = fleetId;
      }
      return staged;
    });
  }
  async function decideFleetLoss(fleetId, lossId, choice) {
    const saved = await fleetAction(() => {
      const copy = cloneData(state), entry = copy.fleet.find(item => item.id === fleetId);
      const date = entry?.logLoss ? formatDateForInput(new Date(entry.logLoss.at)) : '';
      return FleetLog.decideLoss(copy, fleetId, lossId, choice, date) ? {state:soloCleanState(copy), telemetryIds:[]} : null;
    });
    if (saved && choice === 'confirm') window.fleetReplacementUi?.open(fleetId);
    return saved;
  }
  function shipRow(event, label) {
    const row = document.createElement('div'); row.className = 'fleet-log-entry';
    const caption = document.createElement('p'); caption.textContent = label; row.append(caption);
    const available = FleetLog.candidates(event, state);
    if (available.length) {
      const select = document.createElement('select'); select.setAttribute('aria-label', say('Eigenes Flottenschiff', 'Own fleet ship'));
      select.append(new Option(say('Vorhandenes Schiff auswählen …', 'Choose existing ship …'), ''));
      for (const entry of available) select.append(new Option(formatFleetEntryDisplayName(entry), entry.id));
      row.append(select);
      const bind = document.createElement('button'); bind.type = 'button'; bind.className = 'secondary-button'; bind.disabled = true;
      bind.textContent = say('Diese Instanz zuordnen', 'Link this instance');
      select.addEventListener('change', () => {bind.disabled = !select.value;});
      bind.addEventListener('click', () => chooseShip(event.id, select.value)); row.append(bind);
    }
    if (event.kind === 'ship' && FleetLog.identity(event) && FleetLog.profiles(event, state).length === 1
        && !state.fleet.some(entry => FleetLog.sameIdentity(entry.logIdentity, event))) {
      const add = document.createElement('button'); add.type = 'button'; add.className = 'secondary-button';
      add.textContent = say('Als zusätzliches Schiff aufnehmen', 'Add as an additional ship');
      add.addEventListener('click', () => chooseShip(event.id, '')); row.append(add);
    }
    const ignore = document.createElement('button'); ignore.type = 'button'; ignore.className = 'secondary-button';
    ignore.textContent = say('Meldung ignorieren', 'Ignore report');
    ignore.addEventListener('click', () => fleetAction(() => stageTelemetryEvent(event, {action:'discard'}, latest.settings)));
    row.append(ignore); inbox.append(row);
  }
  function renderStatus() {
    if (!latest) return;
    const shipSignature = JSON.stringify([latest.enabled, latest.live, latest.player, latest.ship, latest.shipPresence,
      latest.location, latest.lastLocation, latest.locationContext, latest.settings.logAutoLocation, latest.settings.gameChannel]);
    if (shipSignature !== renderedShip && !soloEditing()) {
      renderedShip = shipSignature;
      getAppViewRenderer().invalidate(['hub','run','cargo-overview']);
      getAppViewRenderer().render();
    }
    window.fleetLogUi?.render();
    const fleetMessage = document.getElementById('fleetLogMessage');
    fleetMessage.textContent = issue; fleetMessage.hidden = !issue;
    status.textContent = issue || (!latest.enabled ? say('Log-Erkennung ausgeschaltet', 'Log reading disabled')
      : latest.error === 'directory_required' ? say('Bitte Star-Citizen-Programmordner angeben.', 'Enter the Star Citizen installation folder.')
      : latest.error ? say('Game.log im gewählten Ordner und Spielkanal nicht lesbar.', 'Cannot read Game.log in the selected folder and channel.')
      : latest.live ? say('Spiel verbunden', 'Game connected') : say('Kein aktuelles Spielsignal – letzte Erkennung:', 'No live game signal — last detection:'));
    const details = document.getElementById('soloTelemetryDetails');
    const location = D.resolveLocation(latest.location, places(), D.links(state.telemetryLinks).locations);
    const position = D.locationContext(latest.locationContext);
    const locationDetail = location || latest.location || (latest.live && position.kind === 'space'
      ? [say('Im All', 'In space'), position.near || position.system].filter(Boolean).join(' · ')
      : latest.live && position.kind === 'travel' ? say('Unterwegs', 'En route') : '');
    details.textContent = [latest.player, latest.ship ? `${latest.ship.name} · ${latest.ship.owner}` : '', locationDetail,
      latest.at ? new Date(latest.at).toLocaleString() : '', latest.path].filter(Boolean).join(' · ');
    const badge = document.getElementById('runTelemetryStatus');
    badge.hidden = !latest.enabled;
    badge.textContent = latest.live ? say('Game.log verbunden · automatische Erkennung', 'Game.log connected · automatic detection')
      : say('Game.log: keine aktuellen Daten', 'Game.log: no live data');
    const pendingLosses = state.fleet.filter(entry => entry.logLoss?.status === 'pending').length;
    if (pendingLosses) {
      badge.hidden = false;
      badge.textContent += ` · ${pendingLosses} ${say('Verlustmeldung(en) in der Flotte prüfen', 'loss report(s) to review in Fleet')}`;
    }
    if (latest.events.some(event => event.kind === 'ship_loss' && decision(event).reason === 'ship_loss_link')) {
      badge.hidden = false; badge.textContent += say(' · Verlustmeldung unter Spiel-Log zuordnen', ' · Link a loss report in Game log settings');
    }
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
      const description = event.kind === 'payment'
        ? `${Number(event.amount).toLocaleString()} aUEC · ${state.missions.find(item => item.id === plan.missionId)?.title || event.missionId}`
        : event.name || event.value || event.objectiveId || event.missionId || event.kind;
      const label = `${say(...(reasons[plan.reason] || ['Zuordnung offen', 'Unmatched']))}: ${description}`;
      if (['ship_instance','ship_new','ship_loss_link'].includes(plan.reason)) shipRow(event, `${label} · ${event.owner} · ${event.entityId || ''}`);
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
          if (!staged) { issue = say(...reasons[plan.action === 'payment' ? 'payment_failed' : 'grid']); continue; }
          const committed = staged.telemetryIds.length ? await getSoloSync().commitImports(staged, ticket)
            : await getSoloSync().commitChange(staged.state, ticket);
          if (committed) latest.events = latest.events.filter(item => !staged.telemetryIds.includes(item.id));
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
  window.soloTelemetry = {refresh, render:renderStatus, decideFleetLoss,
    replaceFleetLoss:(fleetId, lossId, choice, expectedId) => fleetAction(() => stageFleetLossReplacement(fleetId, lossId, choice, expectedId)),
    currentShip:() => FleetLog.hubShip(latest || {}, state, currentActiveFleetEntry(), getSoloPilotProfile()?.name),
    locationStatus:() => D.locationStatus(state, latest || {}, places())};
  translate(); void refresh(); setInterval(refresh, 2000);
})();
