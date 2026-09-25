/* Load dependencies in order, retry transient connection failures, and show a
   usable recovery action if startup fails instead of leaving inert controls. */
(() => {
  const startup = window.soloStartup = { phase: 'loading', file: '' };
  const panel = document.createElement('aside');
  panel.id = 'soloStartupStatus';
  panel.setAttribute('role', 'status');
  panel.style.cssText = 'position:fixed;inset:12px 12px auto;z-index:100000;padding:18px;color:#e8f3ff;background:#102234;border:1px solid #62b7e6;border-radius:8px;font:16px system-ui;box-shadow:0 8px 40px #0008';
  panel.textContent = 'Citizen Tools Solo wird geladen …';
  document.body.append(panel);

  function loadOnce(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.async = false;
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      script.onload = () => finish();
      script.onerror = () => finish(new Error('Datei konnte nicht geladen werden: ' + source));
      // A timed-out request could still execute later. Do not retry it and
      // risk running the same global declarations twice; offer a full reload.
      timer = setTimeout(() => finish(Object.assign(new Error('Zeitüberschreitung beim Laden: ' + source), { timeout: true })), 15000);
      document.head.append(script);
    });
  }

  async function load(source) {
    for (let attempt = 0; ; attempt += 1) {
      try { await loadOnce(source); return; }
      catch (error) {
        if (attempt >= 2 || error.timeout) throw error;
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  void (async () => {
    try {
      for (const entry of document.querySelectorAll('script[data-solo-src]')) {
        startup.file = entry.dataset.soloSrc;
        await load(startup.file);
        if (window.soloErrors.length) throw new Error(window.soloErrors.join('\n'));
      }
      if (!window.soloAppReady) throw new Error('Die Oberfläche konnte nicht initialisiert werden.');
      startup.phase = 'ready';
      panel.remove();
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
