/* Optional first-run setup; personal data stays on the shared PC, layout stays local. */
(() => {
  const pc = ['localhost', '127.0.0.1'].includes(location.hostname);
  const dismissedKey = 'citizen-tools:setup-dismissed:v1';
  const texts = {
    de:{title:'Willkommen an Bord', intro:'Richte Citizen Tools in vier kurzen Schritten ein.', open:'Einrichtungsassistent', start:'Jetzt einrichten', later:'Später', steps:['Pilot','Schiff','Screenshot','Heimnetz'], pilot:'Pilot / Handle', pilotHint:'Dieser Name wird für deine Aufträge und Importe verwendet.', language:'Sprache', ship:'Dein erstes Schiff', choose:'Später auswählen', registration:'Schiffsname / Kennzeichen (optional)', shipHint:'Das gewählte Schiff wird deiner Flotte hinzugefügt und aktiviert.', fleetReady:'Deine Flotte ist bereits eingerichtet. Hier wird kein weiteres Schiff angelegt.', hotkey:'Screenshot-Tastenkürzel', capture:'Screenshot-Erfassung beim Start aktivieren', mode:'Aufnahmebereich', monitor:'Bildschirm des aktiven Fensters', desktop:'Gesamter Desktop', pcOnly:'Screenshot-Taste und Heimnetz-Freigabe richtest du direkt in der Windows-App ein.', lan:'Im eigenen Netz freigeben', port:'Port', reachable:'Aktuell erreichbar', localOnly:'Diese Adresse gilt nur auf dem PC. Für andere Geräte die Heimnetz-Freigabe aktivieren und Citizen Tools neu starten.', networkHint:'Öffne diese Adresse im Browser deines anderen Geräts, z. B. auf dem Tablet. Der PC und Citizen Tools müssen laufen.', restart:'Änderungen an Port und Freigabe gelten nach einem Neustart.', back:'Zurück', next:'Weiter', finish:'Einrichtung speichern', cancel:'Abbrechen', saving:'Wird gespeichert …', failed:'Speichern nicht abgeschlossen. Bitte erneut versuchen.', offline:'Die Verbindung zum PC ist noch nicht bereit. Bitte kurz warten und erneut öffnen.', done:'Einrichtung gespeichert. Bereit für deinen nächsten Auftrag.', missingShip:'Das gewählte Schiffsprofil ist nicht mehr verfügbar. Bitte neu auswählen.', nameRequired:'Bitte gib deinen Pilotennamen ein.', portInvalid:'Bitte einen freien Port zwischen 1024 und 65535 wählen.'},
    en:{title:'Welcome aboard', intro:'Set up Citizen Tools in four short steps.', open:'Setup assistant', start:'Set up now', later:'Later', steps:['Pilot','Ship','Screenshot','Home network'], pilot:'Pilot / handle', pilotHint:'This name is used for your contracts and imports.', language:'Language', ship:'Your first ship', choose:'Choose later', registration:'Ship name / registration (optional)', shipHint:'The selected ship is added to your fleet and activated.', fleetReady:'Your fleet is already set up. No additional ship will be created here.', hotkey:'Screenshot shortcut', capture:'Enable screenshot capture at startup', mode:'Capture area', monitor:"Active window's monitor", desktop:'Entire desktop', pcOnly:'Configure the screenshot shortcut and home network sharing directly in the Windows app.', lan:'Share on your home network', port:'Port', reachable:'Currently reachable', localOnly:'This address works only on this PC. Enable home network sharing and restart Citizen Tools to connect other devices.', networkHint:'Open this address in the browser on your other device, e.g. a tablet. Keep the PC and Citizen Tools running.', restart:'Port and sharing changes take effect after a restart.', back:'Back', next:'Next', finish:'Save setup', cancel:'Cancel', saving:'Saving …', failed:'Saving is incomplete. Please try again.', offline:'The connection to the PC is not ready yet. Please wait briefly and open this again.', done:'Setup saved. Ready for your next contract.', missingShip:'The selected ship profile is no longer available. Please select another.', nameRequired:'Please enter your pilot name.', portInvalid:'Choose an available port between 1024 and 65535.'},
  };
  const words = () => texts[currentUiLanguage() === 'en' ? 'en' : 'de'];
  const backdrop = document.createElement('div'); backdrop.id = 'soloSetupDialog'; backdrop.className = 'app-dialog-backdrop'; backdrop.hidden = true;
  backdrop.innerHTML = `<section class="app-dialog solo-setup-dialog" role="dialog" aria-modal="true" aria-labelledby="soloSetupTitle">
    <div class="app-dialog-head"><span class="app-dialog-kicker">FLIGHT DECK / SETUP</span><h2 id="soloSetupTitle"></h2></div>
    <ol id="soloSetupProgress" class="solo-setup-progress" aria-label="Einrichtung"></ol>
    <form id="soloSetupForm">
      <div data-setup-step="0" class="solo-setup-fields"><label><span data-setup-text="pilot"></span><input name="pilot" maxlength="80" required autocomplete="nickname" /></label><p class="form-hint" data-setup-text="pilotHint"></p><label><span data-setup-text="language"></span><select name="language"><option value="de">Deutsch</option><option value="en">English</option></select></label></div>
      <div data-setup-step="1" class="solo-setup-fields" hidden><p id="soloSetupFleetReady" class="form-hint" data-setup-text="fleetReady" hidden></p><div id="soloSetupShipFields" class="solo-setup-fields"><label><span data-setup-text="ship"></span><select name="ship"></select></label><label><span data-setup-text="registration"></span><input name="registration" maxlength="80" /></label><p class="form-hint" data-setup-text="shipHint"></p></div></div>
      <div data-setup-step="2" class="solo-setup-fields" hidden><p class="form-hint" data-setup-pc-only hidden></p><fieldset id="soloSetupCaptureFields" class="solo-setup-fields"><div class="solo-hotkey-field"><label for="soloSetupHotkey" data-setup-text="hotkey"></label><div class="solo-hotkey-controls"><input id="soloSetupHotkey" name="captureHotkey" readonly aria-describedby="soloSetupHotkeyHint" /><button id="soloSetupRecord" class="secondary-button" type="button"></button></div><small id="soloSetupHotkeyHint" class="form-hint" role="status"></small></div><label><span data-setup-text="mode"></span><select name="captureMode"><option value="active-monitor" data-setup-text="monitor"></option><option value="virtual-desktop" data-setup-text="desktop"></option></select></label><label class="solo-checkbox"><input name="captureEnabled" type="checkbox" /><span data-setup-text="capture"></span></label></fieldset></div>
      <div data-setup-step="3" class="solo-setup-fields" hidden><p class="form-hint" data-setup-pc-only hidden></p><fieldset id="soloSetupNetworkFields" class="solo-setup-fields"><label class="solo-checkbox"><input name="lanEnabled" type="checkbox" /><span data-setup-text="lan"></span></label><label><span data-setup-text="port"></span><input name="port" type="number" min="1024" max="65535" step="1" required /></label></fieldset><div class="solo-setup-address"><strong data-setup-text="reachable"></strong><div id="soloSetupAddresses" class="solo-addresses"></div><p id="soloSetupNetworkHint" class="form-hint"></p></div><p class="form-hint" data-setup-text="restart"></p></div>
    </form>
    <p id="soloSetupError" class="solo-setup-error" role="alert" hidden></p>
    <div class="app-dialog-actions"><button id="soloSetupCancel" type="button" class="secondary-button"></button><button id="soloSetupBack" type="button" class="secondary-button"></button><button id="soloSetupNext" type="button" class="primary-button"></button></div>
  </section>`;
  document.body.append(backdrop);
  const get = id => document.getElementById(id), form = get('soloSetupForm'), fields = form.elements;
  const banner = get('soloSetupWelcome'), message = get('soloSetupMessage');
  let step = 0, busy = false, initial = null, fleetReady = false, applied = false, finished = false, createdShipId = '', hasLanAddress = false;
  const recorder = window.createSoloHotkeyRecorder({form, enabled:() => pc && !busy && !backdrop.hidden, button:get('soloSetupRecord'), hint:get('soloSetupHotkeyHint')});
  const dialog = window.createSoloDialog(backdrop, () => recorder.cancel(), () => !busy);
  function hideWelcome() { banner.hidden = true; try { localStorage.setItem(dismissedKey, '1'); } catch { /* Session only. */ } }
  function renderStep() {
    const text = words();
    form.inert = busy;
    backdrop.querySelectorAll('[data-setup-step]').forEach(node => node.hidden = Number(node.dataset.setupStep) !== step);
    get('soloSetupProgress').replaceChildren();
    text.steps.forEach((label, index) => { const item = document.createElement('li'); item.textContent = `${index + 1} · ${label}`; if (index === step) item.setAttribute('aria-current','step'); if (index < step) item.className = 'is-done'; get('soloSetupProgress').append(item); });
    get('soloSetupBack').hidden = step === 0; get('soloSetupBack').disabled = busy;
    get('soloSetupNext').textContent = busy ? text.saving : step === 3 ? text.finish : text.next;
    get('soloSetupNext').disabled = busy;
    get('soloSetupCancel').disabled = busy;
  }
  function translate() {
    const text = words();
    document.querySelectorAll('[data-setup-open]').forEach(button => button.textContent = text[button.dataset.setupOpen === 'welcome' ? 'start' : 'open']);
    document.querySelectorAll('[data-setup-text]').forEach(node => node.textContent = text[node.dataset.setupText]);
    backdrop.querySelectorAll('[data-setup-pc-only]').forEach(node => {node.textContent = text.pcOnly; node.hidden = pc;});
    get('soloSetupTitle').textContent = text.title;
    get('soloSetupLater').textContent = text.later;
    get('soloSetupCancel').textContent = text.cancel;
    get('soloSetupBack').textContent = text.back;
    get('soloSetupProgress').setAttribute('aria-label', text.open);
    get('soloSetupNetworkHint').textContent = hasLanAddress ? text.networkHint : text.localOnly;
    recorder.render(); renderStep();
  }
  function showError(text) { get('soloSetupError').textContent = text; get('soloSetupError').hidden = false; }
  async function request(path, body) {
    const {response, payload} = await soloRequestJson(path, body ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {cache:'no-store'}, body ? 35000 : 5000);
    if (!response.ok) throw new Error(payload.error || words().failed);
    return payload;
  }
  async function open() {
    if (busy || !backdrop.hidden) return;
    if (!soloHydrated || !remoteHydrationComplete || soloSaving || soloPending) { await showAppNotice(words().offline); return; }
    busy = true;
    try {
      const data = await request('./api/solo/status'); initial = data.settings; hasLanAddress = data.lanUrls.length > 0;
      fields.pilot.value = getSoloPilotProfile()?.name === SOLO_PILOT_DEFAULT_NAME ? '' : getSoloPilotProfile()?.name || '';
      fields.language.value = currentUiLanguage(); fields.registration.value = '';
      fields.captureHotkey.value = initial.captureHotkey;
      fields.captureMode.value = initial.captureMode;
      fields.captureEnabled.checked = initial.captureEnabled;
      fields.lanEnabled.checked = initial.lanEnabled;
      fields.port.value = initial.port || new URL(data.url).port;
      get('soloSetupCaptureFields').disabled = !pc; get('soloSetupNetworkFields').disabled = !pc;
      fleetReady = state.fleet.length > 0;
      get('soloSetupFleetReady').hidden = !fleetReady; get('soloSetupShipFields').hidden = fleetReady;
      fields.ship.replaceChildren(new Option(words().choose, ''));
      getShipLibraryEntries().forEach(ship => fields.ship.add(new Option(formatShipEntryFullName(ship), ship.id)));
      get('soloSetupAddresses').replaceChildren();
      for (const address of data.lanUrls.length ? data.lanUrls : [pc ? data.url : location.origin]) {
        const link = document.createElement('a'); link.href = address; link.textContent = address; link.target = '_blank'; link.rel = 'noreferrer'; get('soloSetupAddresses').append(link);
      }
      step = 0; applied = false; finished = false; createdShipId = ''; busy = false;
      for (const field of form.querySelectorAll('input,select')) field.disabled = false;
      get('soloSetupError').hidden = true; message.hidden = true; translate(); dialog.open();
    } catch (error) { await showAppNotice(error.message || words().offline); }
    finally { busy = false; }
  }
  function validate() {
    if (!fields.pilot.value.trim()) { step = 0; renderStep(); fields.pilot.focus(); showError(words().nameRequired); return false; }
    if (step === 3 && pc && (!Number.isInteger(Number(fields.port.value)) || Number(fields.port.value) < 1024 || Number(fields.port.value) > 65535)) { fields.port.focus(); showError(words().portInvalid); return false; }
    return true;
  }
  async function save() {
    if (busy || finished || !validate() || recorder.recording) return;
    busy = true; get('soloSetupError').hidden = true; renderStep();
    try {
      if (!applied) {
        const ship = !fleetReady && fields.ship.value ? findShipLibraryEntryById(fields.ship.value) : null;
        if (!fleetReady && fields.ship.value && !ship) throw new Error(words().missingShip);
        // Use the existing profile handler so current pilot assignments stay consistent.
        if (fields.pilot.value.trim() !== getSoloPilotProfile()?.name) {
          soloPilotNameInput.value = fields.pilot.value.trim(); soloPilotNameInput.dispatchEvent(new Event('change', {bubbles:true}));
        }
        if (fields.language.value !== currentUiLanguage()) {
          uiLanguageSelect.value = fields.language.value; uiLanguageSelect.dispatchEvent(new Event('change', {bubbles:true}));
        }
        if (ship && !state.fleet.length) {
          const pilot = getSoloPilotProfile();
          const date = new Date(); const acquiredOn = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
          const entry = createFleetEntry({shipId:ship.id, manufacturer:ship.manufacturer, model:getShipEntryDisplayName(ship), registration:fields.registration.value, acquiredOn, pilotId:pilot?.id, pilotName:pilot?.name});
          state.fleet.unshift(entry); state.activeFleetEntryId = entry.id; createdShipId = entry.id;
          await syncLayoutToActiveFleetShip({confirmChange:false});
        }
        persist(); applied = true; // A retry must never create a second ship.
        for (const name of ['pilot','language','ship','registration']) fields.namedItem(name).disabled = true;
      }
      if ((soloPending || soloSaving) && !await flushSoloState()) throw new Error(words().failed);
      if (getSoloPilotProfile()?.name !== normalizePilotName(fields.pilot.value)
          || (createdShipId && !state.fleet.some(entry => entry.id === createdShipId))) throw new Error(words().failed);
      if (pc) {
        const payload = {setupCompleted:true};
        for (const name of ['captureHotkey','captureMode','captureEnabled','lanEnabled','port']) {
          const field = fields.namedItem(name);
          const value = field.type === 'checkbox' ? field.checked : name === 'port' ? Number(field.value) : field.value;
          if (value !== initial[name]) payload[name] = value;
        }
        if (fields.pilot.value.trim() !== initial.pilotName) payload.pilotName = fields.pilot.value.trim();
        const saved = await request('./api/solo/settings', payload);
        window.dispatchEvent(new CustomEvent('solo-settings-saved', {detail:saved}));
      }
      finished = true; hideWelcome(); render();
      message.textContent = words().done; message.hidden = false;
      busy = false; dialog.close();
    } catch (error) { showError(error.message || words().failed); }
    finally { busy = false; renderStep(); }
  }
  get('soloSetupNext').addEventListener('click', () => {
    if (busy || recorder.recording || !validate()) return;
    if (step === 3) { void save(); return; }
    recorder.cancel(); step += 1; get('soloSetupError').hidden = true; renderStep();
    backdrop.querySelector(`[data-setup-step="${step}"] input:not(:disabled), [data-setup-step="${step}"] select:not(:disabled)`)?.focus();
  });
  get('soloSetupBack').addEventListener('click', () => { if (!busy) { recorder.cancel(); step = Math.max(0, step - 1); get('soloSetupError').hidden = true; renderStep(); } });
  get('soloSetupCancel').addEventListener('click', () => dialog.close());
  get('soloSetupLater').addEventListener('click', hideWelcome);
  form.addEventListener('submit', event => { event.preventDefault(); get('soloSetupNext').click(); });
  document.querySelectorAll('[data-setup-open]').forEach(button => button.addEventListener('click', () => void open()));
  uiLanguageSelect.addEventListener('change', translate);
  translate();
  // Offer setup only after the authoritative PC state has finished loading.
  let offering = false;
  const offer = setInterval(async () => {
    if (offering || !soloHydrated || !remoteHydrationComplete || soloSaving || soloPending) return;
    offering = true;
    try {
      let dismissed = false; try { dismissed = localStorage.getItem(dismissedKey) === '1'; } catch { /* Optional preference. */ }
      if (dismissed || !pc || state.missions.length || state.fleet.length || state.ledgerEntries.length || getSoloPilotProfile()?.name !== SOLO_PILOT_DEFAULT_NAME) { clearInterval(offer); return; }
      const data = await request('./api/solo/status');
      banner.hidden = Boolean(data.settings.setupCompleted); clearInterval(offer);
    } catch { /* Retry after the PC reconnects. */ }
    finally { offering = false; }
  }, 1000);
  window.soloSetup = {open};
})();
