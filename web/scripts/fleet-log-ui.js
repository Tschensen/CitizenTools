(() => {
  const panel = document.getElementById('fleetLogPanel');
  const entries = document.getElementById('fleetLogEntries');
  const say = (de, en) => currentUiLanguage() === 'en' ? en : de;
  let rendered = '';
  function button(parent, label, action, className = 'secondary-button') {
    const node = document.createElement('button');
    node.type = 'button'; node.className = className; node.textContent = label;
    node.addEventListener('click', action); parent.append(node);
  }
  function render() {
    if (!panel || soloEditing()) return;
    const records = state.fleet.filter(entry => {
      const loss = FleetLog.loss(entry.logLoss);
      return loss?.status === 'pending' || (loss?.status === 'confirmed' && entry.status === 'destroyed');
    });
    const signature = JSON.stringify([currentUiLanguage(), records.map(entry =>
      [entry.id, entry.status, entry.manufacturer, entry.model, entry.registration, entry.imageUrl,
        entry.pledgePurchased, getFleetMediaEntry(entry), entry.logIdentity, entry.logLoss])]);
    if (signature === rendered) return;
    rendered = signature;
    panel.hidden = records.length === 0;
    const title = say('Verlustmeldungen', 'Loss reports');
    panel.querySelector('[data-fleet-log-title]').textContent = title;
    panel.setAttribute('aria-label', title);
    entries.replaceChildren();
    for (const entry of records) {
      const observed = FleetLog.identity(entry.logIdentity), loss = FleetLog.loss(entry.logLoss);
      const row = document.createElement('article'); row.className = 'fleet-card fleet-roster-card fleet-loss-card';
      row.dataset.fleetId = entry.id;
      row.dataset.lossStatus = loss.status;
      const main = document.createElement('div'); main.className = 'fleet-roster-main';
      const open = document.createElement('button'); open.type = 'button'; open.className = 'fleet-roster-open';
      open.setAttribute('aria-label', fleetText('fleet.dossier.open', 'Schiffsakte für {ship} öffnen', {ship:formatFleetEntryDisplayName(entry)}));
      const label = loss.status === 'pending' ? say('Möglicher Schiffsverlust', 'Possible ship loss') : say('Als zerstört geführt', 'Marked as destroyed');
      const date = new Date(loss.at).toLocaleString(currentUiLanguage() === 'en' ? 'en-GB' : 'de-DE', {dateStyle:'medium', timeStyle:'short'});
      open.innerHTML = renderFleetCardIdentity(entry, findShipLibraryEntryById(entry.shipId),
        `<span class="fleet-loss-status">${escapeHtml(label)}</span><span>${escapeHtml(date)}</span>`);
      const actions = document.createElement('div'); actions.className = 'fleet-card-actions';
      const act = decision => window.soloTelemetry?.decideFleetLoss(entry.id, loss.id, decision);
      if (loss.status === 'pending') {
        if (entry.status === 'active' && FleetLog.sameIdentity(observed, loss.identity)) {
          button(actions, say('Als zerstört markieren', 'Mark as destroyed'), () => act('confirm'), 'primary-button');
        }
        button(actions, say('Ignorieren', 'Ignore'), () => act('dismiss'));
      } else if (FleetLog.sameIdentity(observed, loss.identity)) {
        button(actions, say('Wieder aktiv setzen', 'Restore to active'), () => act('restore'), 'primary-button');
      }
      button(actions, say('Bearbeiten', 'Edit'), () => {populateFleetForm(entry); setFleetView('form'); setActivePage('fleet');}, 'ghost-button');
      main.append(open, actions); row.append(main);
      entries.append(row);
    }
    bindFleetListEvents(entries);
    bindShipProfileMedia(entries);
  }
  window.fleetLogUi = {render};
})();
