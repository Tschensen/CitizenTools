// One coordinator owns revisions, queued writes, reads and import commits.
// Views supply state operations and notifications through explicit adapters.
(function registerStateSync(root) {
  function create({ store, api, equal, merge, isEditing = () => false, isPaused = () => false,
    enabled = () => true, onMeta = () => {}, onOffline = () => {}, onRender = () => {},
    onConflict = () => {}, onReload = () => {},
    timers = {setTimeout: (...args) => setTimeout(...args), clearTimeout: id => clearTimeout(id)} }) {
    let revision = null, base = null, pending = null;
    let saving = null, reading = null, importing = null, timer = null;
    let hydrated = false, initialized = false, blocked = false, renderPending = false;
    let generation = 0, session = 0;
    const hasUnsaved = () => Boolean(pending || saving || importing || timer !== null);
    const busy = () => Boolean(saving || reading || importing);
    const cancelTimer = () => { if (timer !== null) timers.clearTimeout(timer); timer = null; };
    const checkpoint = () => generation;
    const canApply = ticket => hydrated && !blocked && ticket === generation && !hasUnsaved() && !busy() && !isEditing();
    function redraw() {
      renderPending = isEditing();
      if (!renderPending) onRender();
    }
    function adopt(payload) {
      const remote = store.normalize(payload.state);
      revision = payload.updatedAt;
      base = store.clean(remote);
      generation++;
      store.replace(remote);
      store.cache(remote);
      onMeta(payload);
      redraw();
    }
    function rebase(payload, local) {
      const remote = store.normalize(payload.state);
      const result = base && merge(base, local, remote);
      if (!result?.ok) return false;
      revision = payload.updatedAt;
      base = store.clean(remote);
      generation++;
      store.replace(result.state);
      pending = equal(result.state, remote) ? null : store.clean(result.state);
      store.cache(result.state);
      onMeta(payload);
      redraw();
      return true;
    }
    function conflict(payload, local) {
      store.recover(local);
      pending = null;
      cancelTimer();
      adopt(payload);
      onConflict();
    }
    function blockForUpdate() {
      blocked = true;
      if (hasUnsaved()) store.recover(pending || store.snapshot());
      cancelTimer();
      onOffline();
      onReload();
    }
    function queue(snapshot) {
      pending = store.clean(snapshot);
      generation++;
      store.cache(pending);
      if (blocked) blockForUpdate();
    }
    function schedule(snapshot = store.snapshot()) {
      queue(snapshot);
      cancelTimer();
      if (!blocked && enabled()) {
        timer = timers.setTimeout(() => { timer = null; void flush(); }, 250);
      }
    }
    async function save(snapshot) {
      queue(snapshot);
      return flush();
    }
    async function flush() {
      if (blocked) { blockForUpdate(); return false; }
      if (saving) return saving;
      if (!hydrated || importing || !enabled()) return false;
      cancelTimer();
      const token = session;
      const task = (async () => {
        let retries = 0;
        while (pending) {
          const snapshot = pending;
          pending = null;
          if (base && equal(snapshot, base)) continue;
          try {
            const { response, payload } = await api.saveState(snapshot, revision);
            if (token !== session) return false;
            if (blocked) { pending ||= snapshot; blockForUpdate(); return false; }
            if (response.status === 409) {
              if (rebase(payload, pending || snapshot)) {
                if (++retries >= 3 && pending) return false;
                continue;
              }
              conflict(payload, pending || snapshot);
              return false;
            }
            if (!response.ok) throw new Error(payload.error || 'solo_save_failed');
            revision = payload.updatedAt;
            base = store.clean(snapshot);
            generation++;
            onMeta(payload);
          } catch {
            if (token !== session) return false;
            pending ||= snapshot;
            if (blocked) blockForUpdate();
            onOffline();
            return false;
          }
        }
        return true;
      })();
      saving = task;
      try { return await task; } finally { if (saving === task) saving = null; }
    }
    async function hydrate() {
      if (blocked || busy()) return false;
      if (hydrated) return refresh();
      if (!enabled()) { initialized = true; onOffline(); return false; }
      const token = session;
      const task = (async () => {
        try {
          const payload = await api.fetchState();
          if (token !== session || blocked || isEditing()) return false;
          hydrated = true;
          revision = payload.updatedAt;
          const local = pending;
          pending = null;
          cancelTimer();
          if (payload.state) {
            const different = local && !equal(local, store.normalize(payload.state));
            if (different) store.recover(local);
            adopt(payload);
            if (different) onConflict();
          } else {
            onMeta(payload);
            if (store.hasPersonalState(store.read())) pending = store.snapshot();
            else base = store.snapshot();
          }
          return true;
        } catch { if (token === session) onOffline(); return false; }
        finally { if (token === session) initialized = true; }
      })();
      reading = task;
      let result;
      try { result = await task; } finally { if (reading === task) reading = null; }
      if (result && pending) await flush();
      return result;
    }
    async function refresh() {
      if (!hydrated) return hydrate();
      if (blocked || busy() || hasUnsaved() || isEditing() || !enabled()) return false;
      const ticket = generation, token = session;
      if (renderPending) { renderPending = false; onRender(); }
      const task = (async () => {
        try {
          const payload = await api.fetchState();
          if (token !== session || blocked || ticket !== generation || hasUnsaved() || isEditing()) return false;
          if (payload.updatedAt !== revision) adopt(payload);
          else onMeta(payload);
          return true;
        } catch { if (token === session) onOffline(); return false; }
      })();
      reading = task;
      try { return await task; } finally { if (reading === task) reading = null; }
    }
    async function poll() {
      if (blocked || isPaused() || busy()) return false;
      if (!hydrated) return hydrate();
      if (pending) return flush();
      return refresh();
    }
    async function commitImports(staged, ticket) {
      if (!staged.importIds.length || !canApply(ticket)) return false;
      const token = session;
      const snapshot = store.clean(staged.state);
      const task = (async () => {
        try {
          const { response, payload } = await api.saveState(snapshot, revision, staged.importIds);
          if (token !== session || blocked || response.status === 409) return false;
          if (!response.ok) throw new Error(payload.error || 'solo_import_save_failed');
          const shared = { ...payload, state:snapshot };
          const local = pending || store.snapshot();
          if (!rebase(shared, local)) conflict(shared, local);
          return true;
        } catch { if (token === session) onOffline(); return false; }
      })();
      importing = task;
      try { return await task; } finally { if (importing === task) importing = null; }
    }
    async function reset() {
      if (pending) store.recover(pending);
      session++;
      generation++;
      cancelTimer();
      pending = base = revision = null;
      hydrated = initialized = renderPending = false;
      // Invalidate old responses, then let their transport locks finish.
      await Promise.allSettled([reading, saving, importing].filter(Boolean));
      return hydrate();
    }
    return Object.freeze({
      schedule, save, flush, hydrate, refresh, poll, commitImports, blockForUpdate, reset, checkpoint, canApply,
      get status() {
        return Object.freeze({ revision, hydrated, initialized, blocked, pending:Boolean(pending),
          saving:Boolean(saving), reading:Boolean(reading), importing:Boolean(importing),
          scheduled:timer !== null, hasUnsaved:hasUnsaved(), busy:busy() });
      },
    });
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StateSync = api;
})(globalThis);
