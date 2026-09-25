/* Small reachability/time probe, independent of edits and state polling. */
(() => {
  const clock = document.getElementById('flightClock');
  const localClock = document.getElementById('flightLocalClock');
  const banner = document.getElementById('soloConnectionBanner');
  const message = document.getElementById('soloConnectionMessage');
  const retry = document.getElementById('soloConnectionRetry');
  let phase = 'checking';
  let started = false;
  let pending = null;
  let requestStarted = 0;
  let generation = 0;
  let lastSuccess = 0;
  let offset = 0;
  let clockSynced = false;

  function updateClock() {
    const now = new Date(Date.now() + offset);
    clock.dateTime = now.toISOString();
    clock.textContent = now.toISOString().slice(11, 19);
    // One aligned instant, displayed in UTC and the viewing device's zone.
    // Date's local getters also follow daylight-saving and zone changes.
    localClock.dateTime = clock.dateTime;
    localClock.textContent = [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(value => String(value).padStart(2, '0')).join(':');
    const english = document.documentElement.lang === 'en';
    const source = clockSynced
      ? (english ? 'aligned with the Windows suite' : 'mit der Windows-Suite abgeglichen')
      : (english ? 'device time until the suite responds' : 'Gerätezeit bis zum Abgleich mit der Suite');
    clock.title = `UTC · ${source}`;
    localClock.title = `${english ? 'Local time' : 'Ortszeit'} · ${Intl.DateTimeFormat().resolvedOptions().timeZone} · ${source}`;
  }

  function render() {
    if (!started) return;
    const english = document.documentElement.lang === 'en';
    banner.hidden = phase === 'online';
    banner.dataset.state = phase;
    const text = phase === 'offline'
      ? (english ? 'Windows suite unavailable. Reconnecting automatically.' : 'Windows-Suite nicht erreichbar. Verbindung wird automatisch erneut geprüft.')
      : (english ? 'Checking connection to the Windows suite …' : 'Verbindung zur Windows-Suite wird geprüft …');
    if (message.textContent !== text) message.textContent = text;
    retry.textContent = english ? 'Check now' : 'Jetzt prüfen';
    retry.disabled = Boolean(pending);
    updateClock();
  }

  function show(next) {
    phase = next;
    render();
    renderRemoteStatus();
  }

  async function probe() {
    if (!started) return;
    if (pending) return pending;
    const token = ++generation;
    const began = performance.now();
    requestStarted = began;
    pending = (async () => {
      try {
        const { response, payload } = await soloRequestJson('./api/solo/heartbeat', { cache: 'no-store' }, 3500);
        const serverTime = Date.parse(payload?.serverTime);
        if (!response.ok || payload?.ok !== true || payload?.edition !== 'solo' || !Number.isFinite(serverTime)) throw new Error('solo_heartbeat_failed');
        if (token !== generation) return;
        const elapsed = performance.now() - began;
        if (elapsed > 3500) throw new Error('solo_heartbeat_expired');
        offset = serverTime + elapsed / 2 - Date.now();
        clockSynced = true;
        lastSuccess = performance.now();
        const reconnecting = phase !== 'online';
        show('online');
        if (reconnecting || !soloHydrated) void pollSoloState();
      } catch {
        if (token === generation) show('offline');
      } finally {
        if (token === generation) { pending = null; render(); }
      }
    })();
    render();
    return pending;
  }

  function resume() {
    updateClock();
    if (!started || document.hidden) return;
    if (pending && performance.now() - requestStarted > 3500) {
      generation++;
      pending = null;
    }
    // A restored tab must not keep advertising an old successful check.
    if (performance.now() - lastSuccess > 5000) show('checking');
    void probe();
  }

  retry.addEventListener('click', () => { void probe(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resume(); });
  window.addEventListener('pageshow', resume);
  window.addEventListener('focus', resume);
  window.addEventListener('online', resume);
  window.addEventListener('offline', () => { if (started) { generation++; pending = null; show('offline'); } });
  window.soloConnection = {
    get phase() { return started ? phase : 'checking'; },
    render,
    probe,
    start() {
      if (started) return;
      started = true;
      updateClock();
      void probe();
      setInterval(updateClock, 1000);
      setInterval(() => { if (!document.hidden) void probe(); }, 5000);
    },
  };
})();
