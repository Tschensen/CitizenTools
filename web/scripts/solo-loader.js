/* Load dependencies in order, retry transient connection failures, and show a
   usable recovery action if startup fails instead of leaving inert controls. */
(() => {
  const startup = window.soloStartup = { phase: 'loading', file: '', optionalErrors: [] };
  const panel = document.createElement('aside');
  panel.id = 'soloStartupStatus';
  panel.setAttribute('role', 'status');
  panel.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:100000;padding:18px;color:#e8f3ff;background:#102234;border:1px solid #62b7e6;border-radius:8px;font:16px system-ui;box-shadow:0 8px 40px #0008';
  panel.textContent = 'Citizen Tools wird geladen …';
  document.body.append(panel);

  async function download(source) {
    const controller = new AbortController();
    let timer;
    try {
      // Only time the download. A busy tablet can dispatch a script's load
      // event after the timer even though that script has already executed.
      // Fetching first also lets us retry safely: late responses cannot execute.
      return await Promise.race([
        (async () => {
          const response = await fetch(source, {cache: 'no-store', signal: controller.signal});
          if (!response.ok) throw new Error('Datei konnte nicht geladen werden: ' + source);
          return response.text();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Zeitüberschreitung beim Laden: ' + source));
            controller.abort();
          }, 15000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function load(source, optional = false) {
    let code;
    for (let attempt = 0; ; attempt += 1) {
      try { code = await download(source); break; }
      catch (error) {
        window.soloLoadErrors.push(source);
        if (attempt >= 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    // Classic scripts retain their shared global declarations and execute
    // synchronously, once, in dependency order. No eval or load-event timer.
    const script = document.createElement('script');
    script.textContent = code + '\n//# sourceURL=' + new URL(source, document.baseURI).href;
    const previousErrors = window.soloErrors.length;
    document.head.append(script);
    if (optional && window.soloErrors.length > previousErrors) {
      throw new Error(window.soloErrors.splice(previousErrors).join('\n'));
    }
  }

  async function loadAudio(entries) {
    const soundPanel = document.querySelector('#soloSoundPanel');
    const controls = soundPanel ? Array.from(soundPanel.querySelectorAll('input, button, select')) : [];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
      for (const entry of entries) {
        await load(entry.dataset.soloSrc, true);
      }
      controls.forEach((control, index) => { control.disabled = disabled[index]; });
    } catch (error) {
      startup.optionalErrors.push(String(error.message || error));
      // Audio is optional. Keep navigation, synchronization and telemetry
      // usable and explain the unavailable controls in the sound settings.
      const status = document.querySelector('#soloSoundStatus');
      if (status) {
        status.hidden = false;
        status.textContent = document.documentElement.lang === 'en'
          ? 'Interface sounds could not be loaded. Please reload the page to try again.'
          : 'Interface-Sounds konnten nicht geladen werden. Bitte die Seite zum erneuten Versuchen neu laden.';
      }
    }
  }

  void (async () => {
    try {
      for (const entry of document.querySelectorAll('script[data-solo-src]')) {
        if (entry.dataset.soloOptional === 'audio') continue;
        startup.file = entry.dataset.soloSrc;
        await load(startup.file);
        if (window.soloErrors.length) throw new Error(window.soloErrors.join('\n'));
      }
      if (!window.soloAppReady) throw new Error('Die Oberfläche konnte nicht initialisiert werden.');
      startup.phase = 'ready';
      panel.remove();
      void loadAudio(Array.from(document.querySelectorAll('script[data-solo-optional="audio"]')));
    } catch (error) {
      startup.phase = 'failed';
      window.soloErrors.push(String(error.message || error));
      panel.setAttribute('role', 'alert');
      panel.textContent = 'Die Oberfläche konnte nicht vollständig geladen werden. ';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.textContent = 'Erneut laden';
      retry.addEventListener('click', () => window.location.reload());
      const details = document.createElement('pre');
      details.style.cssText = 'white-space:pre-wrap;font-size:12px;margin:12px 0 0';
      details.textContent = String(error.message || error);
      panel.append(retry, details);
    }
  })();
})();
