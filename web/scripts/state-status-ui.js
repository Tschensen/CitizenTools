// Connection status and conflict recovery presentation.
function createRemoteStatusState() {
  return {
    connected: false,
    stateUpdatedAt: null,
    lastBackupAt: null,
    lastRestoreAt: null,
  };
}

function applyRemoteMeta(payload) {
  remoteStatus.connected = true;
  remoteStatus.stateUpdatedAt = payload?.updatedAt || null;
  if (payload?.meta) {
    remoteStatus.lastBackupAt = payload.meta.lastBackupAt || null;
    remoteStatus.lastRestoreAt = payload.meta.lastRestoreAt || null;
  }
  renderRemoteStatus();
}

function renderRemoteStatus() {
  window.soloConnection?.render();
  if (!serverStatusCard || !serverStatusLabel || !serverStatusMeta) {
    return;
  }

  const usesHttp = canUseRemotePersistence();
  const connection = window.soloConnection?.phase;
  const mode = !usesHttp ? "local-only"
    : connection === "offline" || connection === "checking" ? connection
    : remoteStatus.connected ? "connected" : "http-no-sync";
  const backupFreshness = BackupUi.calculateBackupFreshness(
    remoteStatus.lastBackupAt,
    state.backupReminderDays,
  );

  serverStatusCard.classList.toggle("is-connected", mode === "connected");
  serverStatusCard.classList.toggle("is-warning", ["http-no-sync", "offline", "checking"].includes(mode));
  serverStatusCard.classList.toggle("is-offline", mode === "offline");
  serverStatusCard.classList.toggle("is-local", mode === "local-only");
  serverStatusCard.classList.toggle("is-backup-due", mode === "connected" && backupFreshness.due);
  if (serverStatusDot) {
    serverStatusDot.setAttribute("aria-hidden", "true");
  }

  if (mode === "local-only") {
    if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t("server.link.local");
    serverStatusLabel.textContent = t("server.local.title");
    serverStatusMeta.textContent = t("server.local.meta");
    serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
    return;
  }

  if (mode === "offline" || mode === "checking") {
    if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t(mode === "offline" ? "server.link.warning" : "server.link.checking");
    serverStatusLabel.textContent = t(`server.${mode}.title`);
    serverStatusMeta.textContent = t(`server.${mode}.meta`);
    serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
    return;
  }

  if (mode === "http-no-sync") {
    if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t("server.link.syncPending");
    serverStatusLabel.textContent = t("server.warning.title");
    serverStatusMeta.textContent = t("server.warning.meta");
    serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
    return;
  }

  if (serverStatusLinkLabel) serverStatusLinkLabel.textContent = t("server.link.connected");
  serverStatusLabel.textContent = t("server.connected.title");
  const parts = [];
  if (remoteStatus.stateUpdatedAt) {
    parts.push(t("server.connected.synced", { value: formatDateTimeDisplay(remoteStatus.stateUpdatedAt) }));
  }
  if (remoteStatus.lastBackupAt) {
    parts.push(t("server.connected.backup", { value: formatDateTimeDisplay(remoteStatus.lastBackupAt) }));
  }
  if (remoteStatus.lastRestoreAt) {
    parts.push(t("server.connected.restore", { value: formatDateTimeDisplay(remoteStatus.lastRestoreAt) }));
  }
  if (backupFreshness.due) {
    parts.push(backupFreshness.state === "missing"
      ? t("server.connected.backupMissing")
      : t("server.connected.backupDue", { days: backupFreshness.ageDays }));
  }
  serverStatusMeta.textContent = parts.join(" · ") || t("server.connected.meta");
  serverStatusCard.setAttribute("aria-label", `${serverStatusLabel.textContent}. ${serverStatusMeta.textContent}`);
}

function showSoloConflict() {
  if (document.querySelector(".solo-conflict")) return;
  const bar = document.createElement("div");
  bar.className = "solo-conflict";
  bar.setAttribute("role", "alert");
  const english = currentUiLanguage() === "en";
  const label = document.createElement("span");
  label.textContent = english
    ? "The same data was changed on two devices. The shared version has been loaded; your unsaved change is available as a recovery copy."
    : "Dieselben Daten wurden auf zwei Geräten geändert. Der gemeinsame Stand wurde geladen; deine nicht gespeicherte Änderung liegt als Wiederherstellungskopie bereit.";
  const download = document.createElement("button");
  download.className = "secondary-button";
  download.textContent = english ? "Save recovery copy" : "Änderungskopie speichern";
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(getLocalStateStorage().readRecovery() || {})], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url; link.download = "CitizenTools-Solo-Wiederherstellung.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  const close = document.createElement("button");
  close.textContent = "OK"; close.className = "secondary-button"; close.onclick = () => bar.remove();
  bar.append(label, download, close); document.body.append(bar);
}
