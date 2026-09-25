// Single shared SQLite state, optimistic concurrency and device refresh.
let soloRevision = null;
let soloPending = null;
let soloSaving = null;
let soloPolling = false;
let soloHydrated = false;
let soloBaseState = null;
let soloRenderPending = false;

// A dropped LAN connection must not hold a polling/save lock indefinitely.
// The timeout also covers reading the response body.
async function soloRequestJson(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json();
    return { response, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function soloEditing() {
  return Boolean(document.activeElement?.matches("input,select,textarea")
    || document.querySelector('.app-dialog-backdrop:not([hidden])'));
}

function soloCleanState(snapshot) {
  const value = cloneData(snapshot);
  delete value.organization;
  delete value.pilotGroups;
  for (const mission of value.missions || []) {
    for (const key of ["organizationLink", "organizationOrigin", "organizationProgress", "participantAllocations", "participants"]) delete mission[key];
  }
  return value;
}

async function fetchRemoteState() {
  const { response, payload } = await soloRequestJson("./api/state?scope=solo", {cache: "no-store"});
  if (!response.ok) throw new Error("solo_state_unavailable");
  return payload;
}

function scheduleRemotePersist() {
  if (!remoteHydrationComplete) return;
  if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
  soloPending = soloCleanState(state);
  remoteSaveTimer = setTimeout(() => { remoteSaveTimer = null; void flushSoloState(); }, 250);
}

async function saveRemoteState(snapshot) {
  soloPending = soloCleanState(snapshot);
  return flushSoloState();
}

function applySoloState(payload) {
  soloRevision = payload.updatedAt;
  state = pruneInvalidPlacements(sanitizeState(payload.state || cloneData(defaultState)));
  soloBaseState = soloCleanState(state);
  localStorage.setItem(getStateStorageKey(), JSON.stringify(state));
  applyRemoteMeta(payload);
  soloRenderPending = false;
  render();
}

// Adopt a committed change without losing edits made while its request was
// in flight. Form values are left in place until the user finishes editing.
function rebaseSoloState(payload, local = soloPending || soloCleanState(state)) {
  const remote = soloCleanState(pruneInvalidPlacements(sanitizeState(payload.state || cloneData(defaultState))));
  const merged = soloBaseState && soloMergeStates(soloBaseState, local, remote);
  if (!merged?.ok) return false;
  soloRevision = payload.updatedAt;
  soloBaseState = remote;
  state = merged.state;
  soloPending = soloEqual(state, remote) ? null : soloCleanState(state);
  localStorage.setItem(getStateStorageKey(), JSON.stringify(state));
  applyRemoteMeta(payload);
  soloRenderPending = true;
  if (!soloEditing()) { soloRenderPending = false; render(); }
  return true;
}

async function flushSoloState() {
  if (soloSaving) return soloSaving;
  if (!soloHydrated || !soloPending || soloPolling) return false;
  soloSaving = (async () => {
    let retries = 0;
    while (soloPending) {
      const snapshot = soloPending;
      soloPending = null;
      if (soloBaseState && soloEqual(snapshot, soloBaseState)) continue;
      try {
        const { response, payload } = await soloRequestJson("./api/state?scope=solo", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({state: snapshot, baseUpdatedAt: soloRevision}),
        });
        if (response.status === 409) {
          if (rebaseSoloState(payload, soloPending || snapshot)) {
            // Another client changed independent data: keep both changes.
            // Leave a pending retry for the next poll under heavy contention.
            if (++retries >= 3 && soloPending) return false;
            continue;
          }
          // Preserve the local edit before adopting the newer shared state.
          localStorage.setItem(`${STORAGE_KEY}:conflict-recovery`, JSON.stringify(soloPending || snapshot));
          soloPending = null;
          if (remoteSaveTimer) { clearTimeout(remoteSaveTimer); remoteSaveTimer = null; }
          applySoloState(payload);
          showSoloConflict();
          return false;
        }
        if (!response.ok) throw new Error(payload.error || "solo_save_failed");
        soloRevision = payload.updatedAt;
        soloBaseState = snapshot;
        applyRemoteMeta({...payload, meta: {lastBackupAt: remoteStatus.lastBackupAt, lastRestoreAt: remoteStatus.lastRestoreAt}});
      } catch (error) {
        soloPending ||= snapshot;
        remoteStatus.connected = false;
        renderRemoteStatus();
        return false;
      }
    }
    return true;
  })();
  try { return await soloSaving; } finally { soloSaving = null; }
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
    const url = URL.createObjectURL(new Blob([localStorage.getItem(`${STORAGE_KEY}:conflict-recovery`) || "{}"], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url; link.download = "CitizenTools-Solo-Wiederherstellung.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  const close = document.createElement("button");
  close.textContent = "OK"; close.className = "secondary-button"; close.onclick = () => bar.remove();
  bar.append(label, download, close); document.body.append(bar);
}

async function pollSoloState() {
  if (window.personalTransferBusy) return;
  if (!remoteHydrationComplete || soloSaving || soloPolling || missionAutoImportBusy) return;
  if (!soloHydrated) {
    if (soloEditing()) return;
    soloPolling = true;
    const unbased = soloPending;
    try {
      // If the first read failed, cached edits have no trustworthy base
      // revision. Keep a recovery copy before adopting the server's state.
      if (unbased) localStorage.setItem(`${STORAGE_KEY}:conflict-recovery`, JSON.stringify(unbased));
      soloPending = null;
      await initializeRemotePersistence(undefined, { preserveEditing: true });
      if (!soloHydrated) soloPending ||= unbased;
      else if (unbased) showSoloConflict();
    } catch {
      if (!soloHydrated) soloPending ||= unbased;
      remoteStatus.connected = false;
      renderRemoteStatus();
    } finally { soloPolling = false; }
    return;
  }
  if (soloPending) { await flushSoloState(); return; }
  // Do not replace an in-progress form or an open dialog on the other device.
  if (soloEditing()) return;
  if (soloRenderPending) { soloRenderPending = false; render(); }
  soloPolling = true;
  try {
    const { response, payload } = await soloRequestJson("./api/state?scope=solo", {cache: "no-store"});
    if (!response.ok) throw new Error("solo_poll_failed");
    if (!soloPending && !soloEditing() && payload.updatedAt !== soloRevision) applySoloState(payload);
    else if (!soloPending) applyRemoteMeta(payload);
  } catch (error) { remoteStatus.connected = false; renderRemoteStatus(); }
  finally { soloPolling = false; }
}

setInterval(() => { void pollSoloState(); }, 2000);
window.addEventListener("beforeunload", event => {
  if (soloPending || soloSaving || remoteSaveTimer) { event.preventDefault(); event.returnValue = ""; }
});
