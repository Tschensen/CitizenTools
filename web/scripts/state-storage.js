// Browser cache and recovery copies. SQLite remains the shared source of truth.
(function registerStateStorage(root) {
  function create({ storage, key, onError = () => {} }) {
    const memory = new Map();
    function read(name) {
      if (memory.has(name)) return JSON.parse(memory.get(name));
      try {
        const raw = storage.getItem(name);
        if (raw != null) return JSON.parse(raw);
      } catch (error) { onError(error); }
      return memory.has(name) ? JSON.parse(memory.get(name)) : null;
    }
    function write(name, value) {
      const raw = JSON.stringify(value);
      memory.set(name, raw);
      try { storage.setItem(name, raw); return true; }
      catch (error) { onError(error); return false; }
    }
    return Object.freeze({
      read: () => read(key),
      write: value => write(key, value),
      readRecovery: () => read(key + ':conflict-recovery'),
      recover: value => write(key + ':conflict-recovery', value),
    });
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StateStorage = api;
})(globalThis);
