// Explicit replacement choices; opening the dialog never changes the fleet.
(() => {
  const byId = id => document.getElementById('fleetLossReplacement' + id);
  const backdrop = byId('Dialog'), form = byId('Form');
  const mode = byId('Mode'), existing = byId('Existing'), registration = byId('Registration'), date = byId('Date');
  let sourceId = '', lossId = '', expectedId = '', saving = false;
  const words = {
    de:{kicker:'Flottenhistorie', title:'Ersatz verwalten', mode:'Ersatzschiff', existing:'Vorhandenes Schiff verknüpfen',
      new:'Neuen Flotteneintrag anlegen', choose:'Vorhandenes Schiff auswählen', placeholder:'Bitte Schiff auswählen …',
      registration:'Neue Registriernummer (optional)', date:'Im Einsatz seit', later:'Später', close:'Schließen', save:'Ersatz speichern', unlink:'Verknüpfung lösen',
      newHint:'Modell und Besitzart werden übernommen. Die Log-ID wird beim Erkennen des Ersatzschiffs zugeordnet. Es wird kein Kauf gebucht.',
      history:'Das zerstörte Schiff bleibt in der Historie. Fracht und Aufträge werden separat behandelt.',
      unavailable:'Kein passendes aktives Schiff vorhanden. Für einen neuen Eintrag muss das Schiffsprofil in der Schiffsdatenbank verfügbar sein.',
      source:'Bestätigter Verlust: ', linked:'Verknüpfter Ersatz: ', failed:'Der Ersatz konnte nicht gespeichert werden. Bitte Auswahl und Verbindung prüfen und erneut versuchen.',
      duplicate:'Diese Registriernummer ist bereits in der Flotte vorhanden. Bitte den vorhandenen Eintrag verknüpfen oder eine andere Nummer eingeben.'},
    en:{kicker:'Fleet history', title:'Manage replacement', mode:'Replacement ship', existing:'Link an existing ship',
      new:'Create a new fleet entry', choose:'Choose an existing ship', placeholder:'Please choose a ship …',
      registration:'New registration (optional)', date:'In service since', later:'Later', close:'Close', save:'Save replacement', unlink:'Remove link',
      newHint:'Model and ownership type are copied. The log ID is linked when the replacement is detected. No purchase is booked.',
      history:'The destroyed ship stays in history. Cargo and contracts are handled separately.',
      unavailable:'No matching active ship is available. Creating an entry requires an available profile in the ship database.',
      source:'Confirmed loss: ', linked:'Linked replacement: ', failed:'The replacement could not be saved. Please review your selection and connection, then try again.',
      duplicate:'This registration already exists in the fleet. Please link the existing entry or enter a different registration.'},
  };
  const text = () => words[currentUiLanguage() === 'en' ? 'en' : 'de'];
  const label = entry => formatFleetEntryDisplayName(entry);
  const dialog = window.createSoloDialog(backdrop, () => {}, () => !saving);
  function renderChoice() {
    const creating = mode.value === 'new', linked = Boolean(expectedId);
    byId('ExistingGroup').hidden = creating || linked;
    byId('NewGroup').hidden = !creating || linked;
    existing.disabled = creating || linked;
    existing.required = !creating && !linked;
    registration.disabled = date.disabled = !creating || linked;
    date.required = creating && !linked;
    byId('Save').disabled = mode.selectedOptions[0]?.disabled || (!creating && !existing.value);
  }
  function open(fleetId, draft = null) {
    if (saving) return false;
    const source = state.fleet.find(entry => entry.id === fleetId);
    if (source?.status !== 'destroyed' || source.logLoss?.status !== 'confirmed') return false;
    sourceId = source.id; lossId = source.logLoss.id;
    const replacement = FleetLog.replacement(state, sourceId);
    expectedId = replacement?.id || '';
    backdrop.querySelectorAll('[data-fleet-replacement-text]').forEach(node => {node.textContent = text()[node.dataset.fleetReplacementText];});
    byId('Source').textContent = text().source + label(source);
    byId('Linked').hidden = !replacement;
    byId('Linked').textContent = replacement ? text().linked + label(replacement) : '';
    byId('Choices').hidden = Boolean(replacement);
    byId('Unlink').hidden = !replacement;
    byId('Save').hidden = Boolean(replacement);
    byId('Cancel').textContent = replacement ? text().close : text().later;
    const candidates = FleetLog.replacementCandidates(state, source);
    existing.replaceChildren(new Option(text().placeholder, ''));
    for (const entry of candidates) existing.append(new Option(label(entry), entry.id));
    const canCreate = state.shipLibrary.some(entry => entry.id === source.shipId && !entry.archived);
    mode.options[0].disabled = candidates.length === 0;
    mode.options[1].disabled = !canCreate;
    mode.value = candidates.length ? 'existing' : 'new';
    if (draft?.mode === 'new' && canCreate) mode.value = 'new';
    existing.value = draft?.fleetId || '';
    registration.value = draft?.registration || '';
    registration.setCustomValidity('');
    date.min = source.endedOn;
    date.value = draft?.acquiredOn || [source.endedOn, formatDateForInput(new Date())].sort().at(-1);
    byId('Unavailable').hidden = canCreate || candidates.length > 0;
    byId('Error').hidden = true;
    renderChoice(); dialog.open();
    return true;
  }
  async function save(choice) {
    if (saving) return;
    const id = sourceId, loss = lossId, expected = expectedId;
    dialog.close();
    saving = true;
    let saved = false;
    try { saved = await window.soloTelemetry.replaceFleetLoss(id, loss, choice, expected); }
    catch { saved = false; }
    finally { saving = false; }
    window.fleetLogUi?.render();
    if (!saved && open(id, choice)) {
      byId('Error').textContent = text().failed;
      byId('Error').hidden = false;
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const duplicate = mode.value === 'new' && registration.value.trim() && state.fleet.some(entry =>
      String(entry.registration || '').trim().toLowerCase() === registration.value.trim().toLowerCase());
    registration.setCustomValidity(duplicate ? text().duplicate : '');
    if (!form.reportValidity()) return;
    void save({mode:mode.value, fleetId:existing.value, registration:registration.value.trim(), acquiredOn:date.value});
  });
  registration.addEventListener('input', () => registration.setCustomValidity(''));
  mode.addEventListener('change', renderChoice); existing.addEventListener('change', renderChoice);
  byId('Cancel').addEventListener('click', dialog.close);
  byId('Unlink').addEventListener('click', () => void save({mode:'unlink'}));
  backdrop.addEventListener('click', event => {if (event.target === backdrop) dialog.close();});
  window.fleetReplacementUi = {open};
})();
