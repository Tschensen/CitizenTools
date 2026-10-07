// App adapters for local cache and explicit user persistence.
function normalizeAppMode(value) {
  const normalized = String(value || "solo").trim().toLowerCase();
  return APP_MODES.includes(normalized) ? normalized : "solo";
}

function loadAppMode() {
  return normalizeAppMode(localStorage.getItem(APP_MODE_STORAGE_KEY));
}

function getStateStorageKey(mode = activeAppMode) {
  const normalizedMode = normalizeAppMode(mode);
  return normalizedMode === "solo" ? STORAGE_KEY : `${STORAGE_KEY}:${normalizedMode}`;
}

function hasStoredState(mode = activeAppMode) {
  return Boolean(getLocalStateStorage(mode).read());
}

function isRemoteScopeCompatible(payload, mode = activeAppMode) {
  const normalizedMode = normalizeAppMode(mode);
  if (normalizedMode === "solo") {
    return !payload?.scope || payload.scope === "solo";
  }
  return payload?.scope === normalizedMode;
}

const stateStorageByMode = new Map();

function getLocalStateStorage(mode = activeAppMode) {
  const key = getStateStorageKey(mode);
  if (!stateStorageByMode.has(key)) {
    stateStorageByMode.set(key, StateStorage.create({ storage: localStorage, key }));
  }
  return stateStorageByMode.get(key);
}

function persist() {
  syncRunRouteProgress();
  getSoloSync().schedule(state);
}

function loadState(mode = activeAppMode) {
  const cached = getLocalStateStorage(mode).read();
  try { return sanitizeState(cached || cloneData(defaultState), { mode }); }
  catch { return sanitizeState(cloneData(defaultState), { mode }); }
}

function canUseRemotePersistence() {
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}
