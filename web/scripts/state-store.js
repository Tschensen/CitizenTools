// State operations with explicit adapters for the existing mutable views.
// No browser, HTTP, timers or UI dependencies.
(function registerStateStore(root) {
  function create({ read, replace, defaults, normalize, clone, equal, storage }) {
    function clean(snapshot) {
      const value = clone(snapshot);
      delete value.organization;
      delete value.pilotGroups;
      for (const mission of value.missions || []) {
        for (const key of ['organizationLink', 'organizationOrigin', 'organizationProgress', 'participantAllocations', 'participants']) {
          delete mission[key];
        }
      }
      return value;
    }
    function hasPersonalState(candidate) {
      const comparable = value => {
        const result = clean(normalize(clone(value)));
        // Reference data is timestamped independently on each new device.
        for (const name of ['shipLibrary', 'pilots']) {
          for (const entry of result[name] || []) delete entry.createdAt;
        }
        return result;
      };
      return !equal(comparable(candidate), comparable(defaults()));
    }
    return Object.freeze({
      read, replace, clean, hasPersonalState,
      snapshot: () => clean(read()),
      normalize: value => clean(normalize(clone(value ?? defaults()))),
      cache: value => storage.write(value),
      recover: value => storage.recover(value),
    });
  }
  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StateStore = api;
})(globalThis);
