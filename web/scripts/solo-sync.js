// Browser composition: bind the reusable state services to the existing views.
let soloStateApi = null;
let soloStateStore = null;
let soloSyncTimer = null;

function getSoloStateApi() {
  soloStateApi ||= StateApi.create({
    fetch: (...args) => fetch(...args),
    clientVersion: () => window.soloClientVersion,
    onVersionMismatch: () => requireSoloReload(),
  });
  return soloStateApi;
}

function getSoloStateStore() {
  soloStateStore ||= StateStore.create({
    read: () => state,
    replace: value => { state = value; },
    defaults: () => defaultState,
    normalize: value => pruneInvalidPlacements(sanitizeState(value)),
    clone: cloneData,
    equal: soloEqual,
    storage: getLocalStateStorage(),
  });
  return soloStateStore;
}

function getSoloSync() {
  if (!window.soloSync) {
    window.soloSync = StateSync.create({
      store: getSoloStateStore(),
      api: {
        fetchState: () => fetchRemoteState(),
        saveState: (...args) => getSoloStateApi().saveState(...args),
      },
      equal: soloEqual,
      merge: (...args) => soloMergeStates(...args),
      isEditing: soloEditing,
      isPaused: () => Boolean(window.personalTransferBusy || missionAutoImportBusy),
      enabled: canUseRemotePersistence,
      onMeta: applyRemoteMeta,
      onOffline: () => { remoteStatus.connected = false; renderRemoteStatus(); },
      onRender: () => render(),
      onConflict: showSoloConflict,
      onReload: () => { window.soloUpdateRequired = true; window.soloConnection?.requireReload(); },
    });
  }
  return window.soloSync;
}

function requireSoloReload() { getSoloSync().blockForUpdate(); }
function soloCleanState(value) { return getSoloStateStore().clean(value); }
function soloRequestJson(...args) { return getSoloStateApi().requestJson(...args); }
function fetchRemoteState() { return getSoloStateApi().fetchState(); }
function saveRemoteState(snapshot) { return getSoloSync().save(snapshot); }
function flushSoloState() { return getSoloSync().flush(); }
function pollSoloState() { return getSoloSync().poll(); }

function soloEditing() {
  return Boolean(document.activeElement?.matches("input,select,textarea")
    || document.querySelector('.app-dialog-backdrop:not([hidden]), .run-route-row.is-dragging, #cargoAreaEditor:focus-within, #cargoAreaGrid.is-painting'));
}

async function initializeRemotePersistence() {
  const sync = getSoloSync();
  if (soloSyncTimer === null) {
    soloSyncTimer = window.setInterval(() => { void sync.poll(); }, 2000);
  }
  await sync.hydrate();
  if (sync.status.hydrated) await autoImportPendingMissions();
}

window.addEventListener('beforeunload', event => {
  if (window.soloSync?.status.hasUnsaved) { event.preventDefault(); event.returnValue = ''; }
});
