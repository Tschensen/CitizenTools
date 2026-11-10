(() => {
  const R = BalanceReconciliation, panel = document.getElementById('balanceReconciliationPanel');
  const words = {
    de:{title:'Kontostandsabgleich',proposal:'Buchungsvorschlag',review:'Abweichung prüfen',discard:'Verwerfen',
      balance:'Spielkontostand',ledger:'Buchhaltung',difference:'Offene Abweichung',captured:'Erfasst',
      hint:'Der Screenshot zeigt den Saldo, nicht die Ursache. Ordne die Abweichung selbst zu. Du kannst mehrere Vorgänge nacheinander erfassen.',
      stale:'Für einen neuen Abgleich bitte einen frischen Screenshot aufnehmen. Die Buchhaltung hat sich geändert oder diese Aufnahme wurde noch nicht abgeglichen.',
      dismissed:'Abweichung verworfen. Es wurde nichts gebucht.',resolved:'Kontostand und Buchhaltung stimmen überein.',
      kind:'Zuordnung',booking:'Einnahme / Ausgabe buchen',mission:'Auftrag zuordnen und abschließen',choose:'Bitte auswählen …',
      contract:'Auftrag',amount:'Betrag (aUEC)',category:'Kategorie',reference:'Beschreibung (optional)',fleet:'Schiff (optional)',none:'Ohne Schiffszuordnung',
      cancel:'Abbrechen',confirm:'Buchung bestätigen',confirmMission:'Auftrag abschließen und Zahlung buchen',
      missionHint:'Der gewählte Auftrag wird abgeschlossen und als bezahlt gebucht. Offene Fracht wird als ausgeladen markiert. Prüfe Zuordnung und Betrag; der Kontostand allein bestätigt keinen Auftrag.',
      expected:'Geplant',remainder:'Verbleibende Abweichung danach',income:'Einnahme',expense:'Ausgabe',
      missing:'Keine passenden unbezahlten Aufträge. Fehlgeschlagene oder unvollständige Aufträge zuerst in der Auftragsverwaltung prüfen.',
      error:'Nicht gespeichert. Vorschlag, Auftrag oder Buchhaltung haben sich geändert, oder die Verbindung fehlt. Bitte erneut prüfen.',
      saved:'Buchung gespeichert.',discardTitle:'Abweichung verwerfen?',discardHint:'Es wird keine Buchung angelegt und kein Auftrag geändert. Derselbe unveränderte Abgleich wird nicht erneut vorgeschlagen.'},
    en:{title:'Balance reconciliation',proposal:'Suggested booking',review:'Review difference',discard:'Dismiss',
      balance:'Game balance',ledger:'Ledger',difference:'Remaining difference',captured:'Captured',
      hint:'The screenshot shows a balance, not its cause. Choose the matching transaction yourself. You can record several transactions in succession.',
      stale:'Take a fresh screenshot for a new comparison. The ledger has changed or this observation has not been reconciled yet.',
      dismissed:'Difference dismissed. Nothing was booked.',resolved:'Game balance and ledger match.',
      kind:'Match',booking:'Book income / expense',mission:'Match and complete a contract',choose:'Please choose …',
      contract:'Contract',amount:'Amount (aUEC)',category:'Category',reference:'Description (optional)',fleet:'Ship (optional)',none:'No ship link',
      cancel:'Cancel',confirm:'Confirm booking',confirmMission:'Complete contract and book payment',
      missionHint:'The selected contract will be completed and marked as paid. Open cargo will be marked as unloaded. Check the match and amount; the balance alone does not confirm a contract.',
      expected:'Planned',remainder:'Remaining difference afterwards',income:'Income',expense:'Expense',
      missing:'No eligible unpaid contracts. Review failed or incomplete contracts in Contracts first.',
      error:'Not saved. The suggestion, contract or ledger changed, or the connection is unavailable. Please review again.',
      saved:'Booking saved.',discardTitle:'Dismiss this difference?',discardHint:'No booking will be created and no contract changed. The same unchanged comparison will not be suggested again.'}
  };
  const text = key => words[currentUiLanguage() === 'en' ? 'en' : 'de'][key];
  const esc = value => escapeHtml(String(value ?? ''));
  const money = value => `${Number(value).toLocaleString(cargoLocale())} aUEC`;
  const labels = {'Betankung':'refuel','Wasserstoff':'hydrogen','Quantum':'quantum','Reparatur':'repair','Essen':'food','Trinken':'drink',
    'Kleidung':'clothing','Warenankauf':'goodsPurchase','Warenverkauf':'goodsSale','Anfangsbestand':'openingBalance','Transfer':'transfer','Geschenk':'gift','Rückerstattung':'refund','Sonstiges':'other'};
  const categoryLabel = category => cargoText('finance.category.'+labels[category],category);
  let expected = null, saving = false, notice = '', signature = '', observedKey = '', missionStamps = new Map();
  const backdrop = document.createElement('div');
  backdrop.className = 'app-dialog-backdrop'; backdrop.hidden = true;
  backdrop.innerHTML = `<section class="app-dialog balance-review-dialog" role="dialog" aria-modal="true" aria-labelledby="balanceReviewTitle"><h2 id="balanceReviewTitle"></h2><p data-field="summary"></p><form class="stack">
    <label><span data-label="kind"></span><select name="mode"></select></label>
    <label data-group="mission"><span data-label="contract"></span><select name="missionId"></select></label>
    <p data-field="missionHint" class="form-hint"></p>
    <label><span data-label="amount"></span><input name="amount" type="number" min="1" max="${R.limit}" step="1" required /></label>
    <p data-field="remainder" class="form-hint" aria-live="polite"></p>
    <div data-group="booking" class="stack"><label><span data-label="category"></span><select name="category"></select></label>
      <label><span data-label="reference"></span><input name="reference" maxlength="200" /></label>
      <label><span data-label="fleet"></span><select name="fleetId"></select></label></div>
    <p data-field="error" role="alert"></p><div class="app-dialog-actions"><button type="button" class="secondary-button" data-action="cancel"></button><button type="submit" class="primary-button" data-action="confirm"></button></div>
    </form></section>`;
  document.body.append(backdrop);
  const form = backdrop.querySelector('form'), input = name => form.elements.namedItem(name);
  const field = name => backdrop.querySelector(`[data-field="${name}"]`);
  const dialog = window.createSoloDialog(backdrop, () => {}, () => !saving);
  const candidates = () => state.missions.filter(mission => R.canMatch(state,mission) && !isMissionPaid(mission)
    && !isMissionIncomplete(mission) && !isMissionPayoutSplitRequired(mission) && isOrganizationMissionReadyForCompletion(mission));
  function summary(view) {
    return `<div class="balance-comparison"><div><span>${esc(text('balance'))}</span><strong>${money(view.amount)}</strong></div><div><span>${esc(text('ledger'))}</span><strong>${money(view.ledger)}</strong></div><div><span>${esc(text('difference'))}</span><strong>${view.difference > 0 ? '+' : ''}${money(view.difference)}</strong></div></div>`;
  }
  function render() {
    const view = R.view(state);
    if (observedKey !== view.key) {observedKey = view.key; notice = '';}
    const next = JSON.stringify([currentUiLanguage(),view,notice,saving]);
    if (signature === next) return;
    signature = next; panel.hidden = view.status === 'empty';
    if (panel.hidden) return;
    panel.innerHTML = `<h3>${esc(text(view.status === 'pending' ? 'proposal' : 'title'))}</h3>${view.status === 'pending' ? summary(view) : ''}
      <p>${esc(text(view.status === 'pending' ? 'hint' : view.status))}</p><small>${esc(text('captured'))}: ${esc(formatDateTimeDisplay(view.at))}</small>
      ${view.status === 'pending' ? `<div class="app-dialog-actions"><button type="button" class="secondary-button" data-action="dismiss" ${saving ? 'disabled' : ''}>${esc(text('discard'))}</button><button type="button" class="primary-button" data-action="review" ${saving ? 'disabled' : ''}>${esc(text('review'))}</button></div>` : ''}<p role="status">${esc(notice)}</p>`;
    panel.querySelector('[data-action="review"]')?.addEventListener('click', open);
    panel.querySelector('[data-action="dismiss"]')?.addEventListener('click', async () => {
      const original = R.view(state);
      if (await showMissionConfirmDialog({kicker:text('title'),title:text('discardTitle'),message:text('discardHint'),confirmLabel:text('discard')})) {
        await save(original,{mode:'dismiss'});
      }
    });
  }
  function updateChoice() {
    const missionMode = input('mode').value === 'mission';
    backdrop.querySelector('[data-group="mission"]').hidden = !missionMode;
    backdrop.querySelector('[data-group="booking"]').hidden = missionMode;
    input('missionId').required = missionMode; input('missionId').disabled = !missionMode;
    input('category').required = !missionMode; input('category').disabled = missionMode;
    field('missionHint').textContent = missionMode ? text(candidates().length ? 'missionHint' : 'missing') : '';
    backdrop.querySelector('[data-action="confirm"]').textContent = text(missionMode ? 'confirmMission' : 'confirm');
    const value = Number(input('amount').value);
    const remainder = expected.difference - (expected.difference > 0 ? value : -value);
    field('remainder').textContent = Number.isSafeInteger(value) && value > 0 ? `${text('remainder')}: ${money(remainder)}` : '';
  }
  function open() {
    if (saving) return;
    expected = R.view(state);
    if (expected.status !== 'pending') {render(); return;}
    notice = ''; form.reset();
    backdrop.querySelector('#balanceReviewTitle').textContent = text('review');
    backdrop.querySelectorAll('[data-label]').forEach(node => {node.textContent = text(node.dataset.label);});
    backdrop.querySelector('[data-action="cancel"]').textContent = text('cancel');
    field('summary').textContent = `${text(expected.difference > 0 ? 'income' : 'expense')}: ${money(Math.abs(expected.difference))}`;
    input('mode').replaceChildren(new Option(text('booking'),'booking'));
    if (expected.difference > 0) input('mode').append(new Option(text('mission'),'mission'));
    const missions = candidates().sort((a,b) => Number(Number(b.payout) === expected.difference) - Number(Number(a.payout) === expected.difference));
    missionStamps = new Map(missions.map(mission => [mission.id, R.missionStamp(mission)]));
    input('missionId').replaceChildren(new Option(text('choose'),''), ...missions.map(mission => new Option(`${mission.title} · ${text('expected')}: ${money(mission.payout || 0)} · ${summarizeMissionRoute(mission)}`,mission.id)));
    input('amount').value = Math.abs(expected.difference);
    input('category').replaceChildren(new Option(text('choose'),''), ...R.categories(expected.difference > 0 ? 'income' : 'expense').map(item => new Option(categoryLabel(item.category),item.category)));
    input('fleetId').replaceChildren(new Option(text('none'),''), ...state.fleet.filter(entry => entry.status === 'active').map(entry => new Option(formatFleetEntryDisplayName(entry),entry.id)));
    field('error').textContent = ''; updateChoice(); dialog.open();
  }
  async function save(original, choice) {
    if (saving) return;
    saving = true; render();
    let saved = false;
    try {saved = await window.soloTelemetry.reconcileBalance(original,choice);}
    catch {saved = false;}
    finally {saving = false;}
    notice = saved && choice.mode === 'dismiss' ? '' : text(saved ? 'saved' : 'error');
    render();
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const choice = Object.fromEntries(new FormData(form));
    choice.missionStamp = missionStamps.get(choice.missionId);
    const original = expected; dialog.close(); void save(original,choice);
  });
  input('mode').addEventListener('change', updateChoice);
  input('amount').addEventListener('input', updateChoice);
  input('missionId').addEventListener('change', () => {
    const mission = state.missions.find(entry => entry.id === input('missionId').value);
    if (mission?.payout > 0) input('amount').value = mission.payout;
    updateChoice();
  });
  backdrop.querySelector('[data-action="cancel"]').addEventListener('click', dialog.close);
  backdrop.addEventListener('click', event => {if (event.target === backdrop) dialog.close();});
  window.soloBalanceReconciliation = {render};
  document.getElementById('uiLanguageSelect')?.addEventListener('change', render);
  render();
})();
