/* Brief visual feedback, driven by real state changes rather than rerenders. */
(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const previous = new Map();
  const meters = new Map();
  const animations = new Set();
  let manualImport = null;
  let hubReady = false;

  function animate(element, frames, options) {
    if (!element || document.hidden || reducedMotion.matches || !element.getClientRects().length || !element.animate) return;
    const animation = element.animate(frames, options);
    animations.add(animation);
    const release = () => animations.delete(animation);
    animation.onfinish = release;
    animation.oncancel = release;
  }

  function pulse(element, color = window.soloTheme?.color || '#79dfed') {
    if (!element) return;
    animate(element, [
      {color, textShadow:`0 0 14px ${color}88`},
      {color:getComputedStyle(element).color, textShadow:'0 0 0 transparent'},
    ], {duration:1100, easing:'ease-out'});
  }

  window.soloEffects = {
    hub(values) {
      const visible = document.querySelector('[data-page="hub"]')?.classList.contains('is-active');
      const hydrated = typeof soloHydrated !== 'undefined' && soloHydrated;
      for (const [name, value] of Object.entries(values)) {
        const fingerprint = JSON.stringify(value);
        const changed = previous.has(name) && previous.get(name) !== fingerprint;
        previous.set(name, fingerprint);
        if (changed && hydrated && hubReady && visible) {
          document.querySelectorAll(`[data-flight-stat="${name}"]`).forEach(element => pulse(element));
        }
      }
      document.querySelectorAll('[data-flight-meter]').forEach(element => {
        const name = element.dataset.flightMeter;
        const value = Number(element.dataset.value);
        const old = meters.get(name);
        meters.set(name, value);
        if (Number.isFinite(old) && old !== value && hydrated && hubReady && visible) {
          animate(element, [{transform:`scaleX(${old / 100})`}, {transform:`scaleX(${value / 100})`}],
            {duration:650, easing:'cubic-bezier(.2,.7,.2,1)'});
        }
      });
      hubReady = hydrated;
    },
    importPhase(id, phase) {
      if (id.startsWith('manual-')) {
        manualImport = id;
        const dialog = document.querySelector('#missionImportDialog');
        if (dialog) dialog.dataset.importPhase = phase;
      }
      if (phase === 'completed' || phase === 'failed') {
        if (document.hidden) return;
        const requestedAt = performance.now();
        const color = phase === 'completed' ? '#73dba1' : '#f08f8f';
        // The existing renderer updates text immediately after this lifecycle
        // callback. Wait one frame so the new result is visible before pulsing.
        requestAnimationFrame(() => {
          if (performance.now() - requestedAt > 1500) return;
          if (id.startsWith('manual-') && manualImport !== id) return;
          pulse(document.querySelector(id.startsWith('manual-')
            ? '#missionImportStatus strong' : '#companionImportActivityTitle'), color);
        });
      }
    },
    cancelImport(id) {
      if (manualImport !== id) return;
      manualImport = null;
      const dialog = document.querySelector('#missionImportDialog');
      if (dialog) delete dialog.dataset.importPhase;
    },
  };
  const stop = () => { for (const animation of animations) animation.cancel(); animations.clear(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) stop(); });
})();
