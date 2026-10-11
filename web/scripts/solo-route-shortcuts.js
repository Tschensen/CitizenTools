// Native dispatch reaches this window even while minimized. No browser polling
// queue: disconnected or busy commands expire instead of running much later.
(() => {
  let busy = false;
  let homeLocation = '';
  const actions = {
    arrive: () => confirmRunArrival(),
    load: () => autoLoadRunPickup(),
    pickup: () => completeRunPickup({allowIncomplete:false}),
    unload: () => autoUnloadRunStop(),
    home: () => returnRunHome(homeLocation),
  };
  function blocked() {
    return !window.soloAppReady || !window.soloSync?.status.hydrated
      || window.soloSync.status.blocked || window.personalTransferBusy || missionAutoImportBusy
      || soloEditing() || document.querySelector('[data-recording="preparing"], [data-recording="listening"]');
  }
  window.soloRouteShortcuts = {
    setHomeLocation(value) { homeLocation = String(value || '').trim(); },
    async run(action) {
      if (busy || !Object.hasOwn(actions, action) || blocked()) return false;
      busy = true;
      const started = Date.now();
      try {
        if (!await flushSoloState() || blocked()) return false;
        if (!await soloSync.refresh() || blocked() || Date.now() - started > 2500) return false;
        const changed = await actions[action]();
        if (!changed) return false;
        return await flushSoloState();
      } catch (error) {
        console.error('Route shortcut failed', error);
        return false;
      } finally {
        busy = false;
      }
    },
  };
})();
