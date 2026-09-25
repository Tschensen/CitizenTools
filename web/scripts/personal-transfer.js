/* The same file is shipped with the online and Windows editions. */
(() => {
  const panel = document.querySelector('#personalTransferPanel');
  if (!panel) return;
  const online = Boolean(window.OperationsOnlineAdapter?.getState?.().enabled);
  const de = {
    title: 'Datentransfer', intro: 'Persönliche Daten als Datei zwischen Online- und Offline-Suite austauschen.',
    detail: 'Schiffsprofile, Flotte, Aufträge, Buchungen, Kontakte und gespeicherte Schiffsbilder. Orgas, Gruppen und Zugangsdaten sind ausgeschlossen.',
    export: 'Transferdatei speichern', import: 'Datei auswählen', merge: 'Zusammenführen', replace: 'Persönliche Daten ersetzen',
    recovery: 'Stand vor letztem Import speichern', area: 'Bereich', current: 'Aktuell', incoming: 'In Datei', updated: 'Gleiche Kennung',
    apply: 'Importieren', cancel: 'Verwerfen', ready: 'Datei geprüft.', success: 'Daten übernommen. Die Ansicht wird neu geladen.',
    mergeHint: 'Gleiche Kennungen werden aktualisiert, andere Einträge bleiben erhalten. Aktuelle Schiffs- und Routenauswahl bleibt bestehen.',
    replaceHint: 'Ersetzt die persönlichen Daten durch den Dateiinhalt. Der bisherige Stand wird als Wiederherstellungskopie gespeichert.',
    imageHint: 'Enthaltene Bilder: ', confirm: 'Daten jetzt übernehmen?', busy: 'Daten werden verarbeitet …',
    shipLibrary: 'Schiffsprofile', fleet: 'Flotte', missions: 'Aufträge', ledgerEntries: 'Buchungen', contacts: 'Kontakte',
    note: 'Kontakte bleiben offline für den Rücktransfer erhalten. Standortdatenbank, PC-Einstellungen und nur verlinkte Bilder werden nicht mitgepackt.',
    invalid: 'Ungültige oder nicht unterstützte Transferdatei. Bitte erneut aus der Suite exportieren.',
    conflict: 'Der Datenstand hat sich geändert. Bitte die Datei erneut auswählen und die Vorschau prüfen.',
    personal: 'Bitte zuerst in den persönlichen Bereich wechseln und die Gruppenauswahl auf „Alle Aufträge“ setzen.',
    failed: 'Der Transfer konnte nicht abgeschlossen werden. Bitte Verbindung und Daten prüfen.',
    save: 'Es sind noch ungespeicherte Änderungen vorhanden. Bitte kurz warten und erneut versuchen.',
    noRecovery: 'Es wurde noch kein Import durchgeführt.', limit: 'Die Datei oder eine Datensammlung ist zu groß (Datei maximal 32 MB).',
    image: 'Ein gespeichertes Schiffsbild fehlt oder ist ungültig. Bitte das Bild in der Quell-Suite prüfen.',
  };
  const en = {
    title: 'Data transfer', intro: 'Exchange personal data between the online and offline suites using a file.',
    detail: 'Ship profiles, fleet, missions, transactions, contacts and stored ship images. Organizations, groups and credentials are excluded.',
    export: 'Save transfer file', import: 'Choose file', merge: 'Merge', replace: 'Replace personal data',
    recovery: 'Save state before last import', area: 'Area', current: 'Current', incoming: 'In file', updated: 'Matching ID',
    apply: 'Import', cancel: 'Discard', ready: 'File checked.', success: 'Data imported. Reloading the view.',
    mergeHint: 'Matching IDs are updated; other records are kept. The current ship and route selection is preserved.',
    replaceHint: 'Replaces personal data with the file contents. The previous state is saved as a recovery copy.',
    imageHint: 'Included images: ', confirm: 'Import this data now?', busy: 'Processing data …',
    shipLibrary: 'Ship profiles', fleet: 'Fleet', missions: 'Missions', ledgerEntries: 'Transactions', contacts: 'Contacts',
    note: 'Contacts are retained offline for transfer back online. The location database, PC settings and linked-only images are not packaged.',
    invalid: 'Invalid or unsupported transfer file. Please export it from the suite again.',
    conflict: 'The data has changed. Select the file again and review a fresh preview.',
    personal: 'Switch to your personal workspace and select “All missions” in the group selector first.',
    failed: 'Transfer could not be completed. Please check your connection and data.',
    save: 'There are unsaved changes. Please wait briefly and try again.', noRecovery: 'No import has been performed yet.',
    limit: 'The file or a collection is too large (maximum file size: 32 MB).', image: 'A stored ship image is missing or invalid. Check it in the source suite.',
  };
  const words = () => currentUiLanguage() === 'en' ? en : de;
  panel.innerHTML = `<div class="panel-header panel-header-stack"><div><h2 data-transfer-text="title"></h2><p data-transfer-text="intro"></p></div></div>
    <p class="form-hint" data-transfer-text="detail"></p>
    <div class="settings-backup-actions">
      <button class="secondary-button" type="button" id="personalTransferExport" data-transfer-text="export"></button>
      <label class="settings-backup-reminder"><select id="personalTransferMode" aria-label="Import-Modus"><option value="merge" data-transfer-text="merge"></option><option value="replace" data-transfer-text="replace"></option></select></label>
      <button class="secondary-button" type="button" id="personalTransferChoose" data-transfer-text="import"></button>
      <input type="file" id="personalTransferFile" accept=".json,application/json" hidden>
    </div>
    <p class="form-hint" id="personalTransferHint"></p>
    <div id="personalTransferPreview" hidden>
      <p id="personalTransferFilename"></p>
      <div style="overflow-x:auto"><table class="restore-preview-table"><thead><tr><th data-transfer-text="area"></th><th data-transfer-text="current"></th><th data-transfer-text="incoming"></th><th data-transfer-text="updated"></th></tr></thead><tbody id="personalTransferRows"></tbody></table></div>
      <p class="form-hint" id="personalTransferImages"></p>
      <div class="settings-backup-actions"><button class="primary-button" type="button" id="personalTransferApply" data-transfer-text="apply"></button><button class="secondary-button" type="button" id="personalTransferCancel" data-transfer-text="cancel"></button></div>
    </div>
    <p id="personalTransferStatus" class="form-hint" role="status" aria-live="polite"></p>
    <button class="secondary-button" type="button" id="personalTransferRecovery" data-transfer-text="recovery"></button>
    <p class="form-hint" data-transfer-text="note"></p>`;
  const get = id => panel.querySelector(`#personalTransfer${id}`);
  let staged = null;
  let busy = false;
  function translate() {
    document.querySelector('[data-settings-view-target="transfer"]').textContent = words().title;
    panel.querySelectorAll('[data-transfer-text]').forEach(node => { node.textContent = words()[node.dataset.transferText]; });
    get('Hint').textContent = words()[get('Mode').value === 'replace' ? 'replaceHint' : 'mergeHint'];
  }
  translate();
  document.querySelector('#uiLanguageSelect')?.addEventListener('change', translate);
  function reset() { staged = null; get('Preview').hidden = true; get('File').value = ''; }
  async function api(suffix = '', body) {
    const path = `/api/transfer/personal${suffix}`;
    if (online) return window.OperationsOnlineAdapter.api(path, body ? { method: 'POST', body: JSON.stringify(body) } : {});
    const response = await fetch(`.${path}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {cache: 'no-store'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'transfer_failed');
    return result;
  }
  async function settled() {
    if (online) return window.OperationsOnlineAdapter.waitForPersonalTransfer();
    if (!soloHydrated || soloPolling || missionAutoImportBusy) throw new Error('transfer_unsaved');
    if (soloPending || soloSaving) {
      if (!await flushSoloState()) throw new Error('transfer_unsaved');
    }
  }
  function download(payload, recovery = false) {
    const blob = new Blob([JSON.stringify(payload)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CitizenTools-${recovery ? 'Wiederherstellung' : 'Transfer'}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  async function run(action) {
    if (busy) return;
    busy = true;
    window.personalTransferBusy = true;
    panel.querySelectorAll('button,select,input').forEach(node => { node.disabled = true; });
    get('Status').textContent = words().busy;
    try { await action(); }
    catch (error) {
      const reason = String(error.message || '');
      const key = reason === 'transfer_conflict' ? 'conflict' : reason === 'transfer_personal_only' ? 'personal'
        : reason === 'transfer_unsaved' ? 'save' : reason === 'transfer_no_recovery' ? 'noRecovery'
        : /too_large|collection_limit/.test(reason) ? 'limit' : /image/.test(reason) ? 'image'
        : /invalid|unsupported|duplicate|SyntaxError/.test(reason) || error instanceof SyntaxError ? 'invalid' : 'failed';
      get('Status').textContent = words()[key];
      if (reason === 'transfer_conflict') reset();
    } finally {
      panel.querySelectorAll('button,select,input').forEach(node => { node.disabled = false; });
      busy = false;
      window.personalTransferBusy = false;
    }
  }
  get('Export').onclick = () => run(async () => { await settled(); download(await api()); get('Status').textContent = ''; });
  get('Recovery').onclick = () => run(async () => { download(await api('/recovery'), true); get('Status').textContent = ''; });
  get('Choose').onclick = () => get('File').click();
  get('Mode').onchange = () => { reset(); translate(); };
  get('Cancel').onclick = () => { reset(); get('Status').textContent = ''; };
  get('File').onchange = () => {
    const file = get('File').files?.[0];
    reset();
    if (!file) return;
    void run(async () => {
      if (file.size > 32 * 1024 * 1024) throw new Error('transfer_too_large');
      const document = JSON.parse(await file.text());
      await settled();
      const mode = get('Mode').value;
      const preview = await api('/preview', { document, mode });
      staged = { document, mode, baseRevision: preview.revision };
      get('Rows').replaceChildren(...preview.rows.map(row => {
        const tr = window.document.createElement('tr');
        [words()[row.key] || row.key, row.current, row.incoming, row.updated].forEach(value => {
          const td = window.document.createElement('td'); td.textContent = value; tr.append(td);
        });
        return tr;
      }));
      get('Filename').textContent = file.name;
      get('Images').textContent = words().imageHint + preview.images;
      get('Preview').hidden = false;
      get('Status').textContent = words().ready;
    });
  };
  get('Apply').onclick = () => run(async () => {
    if (!staged) return;
    const request = staged;
    const confirmed = await showMissionConfirmDialog({kicker: words().title, title: words().confirm,
      message: words()[request.mode === 'replace' ? 'replaceHint' : 'mergeHint'], confirmLabel: words().apply,
      tone: request.mode === 'replace' ? 'danger' : 'default'});
    if (!confirmed) { get('Status').textContent = ''; return; }
    await settled();
    await api('/import', request);
    get('Status').textContent = words().success;
    reset();
    window.location.reload();
  });
})();
