/* GitHub is queried by the PC; installation is available only through its native bridge. */
(() => {
  const byId = id => document.getElementById(id);
  const panel = byId('soloUpdatesPanel'), banner = byId('soloUpdateBanner'), backdrop = byId('soloUpdateBackdrop');
  const language = () => currentUiLanguage() === 'en' ? 'en' : 'de';
  const native = () => typeof window.pywebview?.api?.install_update === 'function';
  const words = {
    de: {
      title:'Updates', check:'Jetzt nach Updates suchen', review:'Was ist neu?', close:'Später', dismiss:'Hinweis ausblenden',
      automatic:'Automatisch nach Updates suchen', privacy:'Beim Start und alle sechs Stunden bei GitHub prüfen. Download und Installation starten nur auf deinen Klick.',
      installed:'Installiert', available:'Neue Version verfügbar', last:'Letzte erfolgreiche Prüfung', never:'Noch nicht geprüft',
      idle:'Bereit zur Update-Prüfung.', checking:'Neue Version wird gesucht …', current:'Du verwendest die aktuelle Version oder einen neueren Entwicklungsstand.',
      availableState:'Eine neue Version ist verfügbar.', downloading:'Update wird heruntergeladen …', ready:'Download geprüft. Bereit zur Installation.', installing:'Update wird vorbereitet. Citizen Tools startet anschließend neu …',
      download:'Update herunterladen', install:'Installieren und neu starten', cancel:'Download abbrechen',
      localOnly:'Updates bitte direkt in der Windows-App starten.', dev:'Im Quellcode-Start sind Downloads und Installation deaktiviert.',
      portable:'Portable Ausgabe', installer:'Installierte Ausgabe', development:'Entwicklungsstand',
      before:'Vor dem Neustart offene Formulare speichern. Aufträge, Einstellungen und eigene Sounds bleiben erhalten. Eine Sicherung wird vor dem Austausch angelegt.',
      drafts:'Ich habe offene Formulare gespeichert oder möchte diese Eingaben verwerfen.', notesMissing:'Für diese Version wurden keine Änderungen beschrieben. Details findest du im GitHub-Release.',
      release:'Release auf GitHub ansehen', size:'Download', disconnected:'Update-Status momentan nicht erreichbar.',
      update_network:'GitHub ist momentan nicht erreichbar. Du kannst Citizen Tools weiter offline nutzen.',
      update_no_release:'Es ist noch kein öffentliches Release verfügbar.', update_rate_limit:'GitHub begrenzt die Anfragen. Bitte später erneut prüfen.',
      update_invalid_release:'Das Release enthält ungültige Update-Angaben.', update_incomplete_release:'Die Update-Dateien des Releases sind noch nicht vollständig.',
      update_checksum:'Die Datei stimmt nicht mit der veröffentlichten Prüfsumme überein. Bitte erneut herunterladen.',
      update_cancelled:'Download abgebrochen.', update_disk_space:'Für das Update ist zu wenig freier Speicherplatz vorhanden.',
      update_busy:'Ein Update-Vorgang läuft bereits.', update_unavailable:'Dieses Update ist nicht mehr verfügbar. Bitte erneut prüfen.',
      update_helper_failed:'Der Updater konnte nicht gestartet werden. Bitte den Programmordner auf Schreibrechte prüfen oder das Release manuell installieren.',
      update_data_in_program:'Programm- und Datenordner müssen für automatische Updates getrennt sein.',
      update_unsaved:'Änderungen werden noch gespeichert oder ein Import läuft. Bitte kurz warten und erneut versuchen.',
      update_failed:'Das Update konnte nicht abgeschlossen werden. Bitte erneut versuchen.', update_native_only:'Die Installation ist nur in der Windows-App möglich.'
    },
    en: {
      title:'Updates', check:'Check for updates', review:'What’s new?', close:'Later', dismiss:'Dismiss notice',
      automatic:'Automatically check for updates', privacy:'Check GitHub at startup and every six hours. Downloads and installation only start when you click.',
      installed:'Installed', available:'New version available', last:'Last successful check', never:'Not checked yet',
      idle:'Ready to check for updates.', checking:'Checking for a new version …', current:'You are using the current version or a newer development build.',
      availableState:'A new version is available.', downloading:'Downloading update …', ready:'Download verified. Ready to install.', installing:'Preparing update. Citizen Tools will restart …',
      download:'Download update', install:'Install and restart', cancel:'Cancel download',
      localOnly:'Start updates directly in the Windows app.', dev:'Downloads and installation are disabled when running from source.',
      portable:'Portable edition', installer:'Installed edition', development:'Development build',
      before:'Save open forms before restarting. Contracts, settings and personal sounds are preserved. A backup is created before replacing the app.',
      drafts:'I have saved open forms or want to discard these entries.', notesMissing:'No changes were described for this version. See the GitHub release for details.',
      release:'View release on GitHub', size:'Download', disconnected:'Update status is currently unavailable.',
      update_network:'GitHub is currently unreachable. You can continue using Citizen Tools offline.',
      update_no_release:'There is no public release yet.', update_rate_limit:'GitHub is limiting requests. Please check again later.',
      update_invalid_release:'This release contains invalid update information.', update_incomplete_release:'The release’s update files are not complete yet.',
      update_checksum:'The file does not match the published checksum. Please download it again.',
      update_cancelled:'Download cancelled.', update_disk_space:'There is not enough free disk space for the update.',
      update_busy:'An update operation is already running.', update_unavailable:'This update is no longer available. Please check again.',
      update_helper_failed:'The updater could not start. Check write access to the program folder or install the release manually.',
      update_data_in_program:'Automatic updates require separate program and data folders.',
      update_unsaved:'Changes are still being saved or an import is running. Please wait and try again.',
      update_failed:'The update could not be completed. Please try again.', update_native_only:'Installation is only available in the Windows app.'
    }
  };
  let data = null, fetching = false, actionPending = false, installing = false, error = '', dismissed = '', reviewed = '', notesKey = '', disconnected = false;
  const dialog = createSoloDialog(backdrop, () => { reviewed = ''; }, () => !installing);
  function element(tag, text) { const item = document.createElement(tag); item.textContent = text; return item; }
  function text(id, value) { byId(id).textContent = value; }
  function render() {
    const t = words[language()], state = data?.state || 'idle', candidate = data?.candidate;
    const busy = actionPending || installing || ['checking','downloading','installing'].includes(state);
    panel.setAttribute('aria-label', t.title);
    for (const [id, key] of Object.entries({soloUpdatesTitle:'title', soloUpdateCheck:'check', soloUpdateReview:'review', soloUpdateBannerReview:'review', soloUpdateDismiss:'dismiss', soloUpdateAutomaticLabel:'automatic', soloUpdatePrivacy:'privacy', soloUpdateClose:'close', soloUpdateDownload:'download', soloUpdateInstall:'install', soloUpdateCancel:'cancel', soloUpdateBefore:'before', soloUpdateDraftLabel:'drafts', soloUpdateRelease:'release'})) text(id, t[key]);
    text('soloUpdateInstalled', `${t.installed}: v${data?.currentVersion || window.soloClientVersion} · ${t[data?.mode] || t.development}`);
    text('soloUpdateChecked', data?.checkedAt ? `${t.last}: ${new Date(data.checkedAt * 1000).toLocaleString(language())}` : t.never);
    const message = error || data?.error;
    const status = installing ? t.installing : disconnected ? t.disconnected : message ? (t[message] || t.update_failed) : t[state === 'available' ? 'availableState' : state] || t.idle;
    text('soloUpdateStatus', status); text('soloUpdateDialogStatus', status);
    byId('soloUpdateCheck').disabled = !native() || busy || state === 'ready';
    byId('soloUpdateAutomatic').checked = data?.automatic !== false;
    byId('soloUpdateAutomatic').disabled = !native() || actionPending || installing || !data;
    byId('soloUpdateReview').hidden = !candidate;
    byId('soloUpdateReview').disabled = installing;
    text('soloUpdateLocalOnly', !native() ? t.localOnly : data?.mode === 'development' ? t.dev : '');
    banner.hidden = !candidate || dismissed === candidate.version || state === 'installing';
    text('soloUpdateBannerText', candidate ? `${t.available}: v${candidate.version}` : '');
    const canDownload = native() && data?.canInstall && data.mode !== 'development';
    byId('soloUpdateDownload').hidden = !canDownload || state === 'ready' || state === 'installing';
    byId('soloUpdateDownload').disabled = busy || !candidate || reviewed !== candidate.version;
    byId('soloUpdateInstall').hidden = !canDownload || !['ready', 'installing'].includes(state);
    const hasDrafts = Boolean(window.soloConnection?.hasDrafts);
    byId('soloUpdateDrafts').hidden = !hasDrafts || state !== 'ready';
    byId('soloUpdateInstall').disabled = busy || (hasDrafts && !byId('soloUpdateDraftConfirm').checked);
    byId('soloUpdateCancel').hidden = state !== 'downloading';
    byId('soloUpdateCancel').disabled = actionPending;
    byId('soloUpdateClose').disabled = installing;
    byId('soloUpdateProgress').hidden = state !== 'downloading';
    byId('soloUpdateProgress').value = data?.progress?.received || 0;
    byId('soloUpdateProgress').max = data?.progress?.total || 1;
    byId('soloUpdateProgress').setAttribute('aria-label', t.downloading);
    text('soloUpdateProgressText', state === 'downloading' ? `${Math.floor(100 * (data?.progress?.received || 0) / (data?.progress?.total || 1))} %` : '');
    if (candidate) {
      text('soloUpdateDialogTitle', `${t.review} · v${candidate.version}`);
      text('soloUpdateSize', `${t.size}: ${Math.ceil(candidate.bytes / 1024 ** 2)} MB · ${t[data.mode]}`);
      text('soloUpdateDialogLocal', canDownload ? '' : native() ? t.dev : t.localOnly);
      byId('soloUpdateRelease').href = candidate.url;
      const key = `${language()}:${candidate.version}`;
      if (key !== notesKey) {
        notesKey = key;
        const notes = byId('soloUpdateNotes'); notes.replaceChildren();
        if (candidate.notes?.length) {
          for (const release of candidate.notes) {
            const content = release[language()];
            const section = element('section', '');
            section.append(element('h3', `v${release.version} · ${content.title}`));
            const list = element('ul', '');
            content.changes.forEach(change => list.append(element('li', change)));
            section.append(list); notes.append(section);
          }
        } else notes.append(element('p', candidate.body || t.notesMissing));
      }
    }
  }
  async function poll() {
    if (fetching || actionPending || installing) return;
    fetching = true;
    try {
      const result = await soloRequestJson('./api/solo/updates', {cache:'no-store'}, 5000);
      if (!result.response.ok) throw new Error();
      data = result.payload; disconnected = false;
    } catch { disconnected = true; }
    finally { fetching = false; render(); }
  }
  async function action(name, body = {}) {
    if (actionPending || installing) return;
    actionPending = true; error = ''; render();
    try {
      const result = await soloRequestJson(`./api/solo/updates/${name}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      if (!result.response.ok) throw new Error(result.payload.error);
      data = result.payload; disconnected = false;
    } catch (failure) { error = failure.message; }
    finally { actionPending = false; render(); }
  }
  function review() {
    if (!data?.candidate || installing) return;
    if ([...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].some(node => node.getClientRects().length)) return;
    reviewed = data.candidate.version;
    byId('soloUpdateDraftConfirm').checked = false;
    render(); dialog.open();
  }
  byId('soloUpdateReview').addEventListener('click', review);
  byId('soloUpdateBannerReview').addEventListener('click', review);
  byId('soloUpdateDismiss').addEventListener('click', () => { dismissed = data?.candidate?.version || ''; render(); });
  byId('soloUpdateCheck').addEventListener('click', () => void action('check'));
  byId('soloUpdateAutomatic').addEventListener('change', event => void action('preferences', {automatic:event.target.checked}));
  byId('soloUpdateClose').addEventListener('click', dialog.close);
  byId('soloUpdateCancel').addEventListener('click', () => void action('cancel'));
  byId('soloUpdateDraftConfirm').addEventListener('change', render);
  byId('soloUpdateDownload').addEventListener('click', () => { if (reviewed === data?.candidate?.version) void action('download', {version:reviewed}); });
  byId('soloUpdateInstall').addEventListener('click', async () => {
    if (installing || !native() || data?.state !== 'ready' || reviewed !== data?.candidate?.version) return;
    if (window.soloConnection?.hasDrafts && !byId('soloUpdateDraftConfirm').checked) return;
    installing = true; error = ''; render();
    try {
      await flushSoloState();
      const result = await window.pywebview.api.install_update(reviewed);
      if (!result.ok) throw new Error(result.error);
    } catch (failure) { error = failure.message; installing = false; render(); }
  });
  window.soloUpdates = { get canRestart() { return installing && !backdrop.hidden && reviewed === data?.candidate?.version; }, render };
  document.getElementById('uiLanguageSelect')?.addEventListener('change', render);
  window.addEventListener('pywebviewready', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
  render(); void poll(); setInterval(() => { if (!document.hidden) void poll(); }, 2000);
})();
