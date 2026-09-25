(function initializeRunViewUi(global) {
  const RUN_VIEW_MODES = Object.freeze(["plan", "cockpit"]);

  function normalizeRunViewMode(value) {
    return RUN_VIEW_MODES.includes(value) ? value : "plan";
  }

  function createRunViewController({
    storageKey,
    page,
    toggleButton = null,
    fullscreenButton = null,
    documentRef = document,
    storage = global.localStorage,
    getActivePage = () => "",
    getText = (key) => key,
    onCockpitActivated = () => {},
    onFullscreenToggle = () => {},
    supportsFullscreen = () => false,
    getFullscreenElement = () => null,
    normalizeTooltip = () => {},
  } = {}) {
    let mode = "plan";
    let cockpitActive = false;

    try {
      mode = normalizeRunViewMode(storage?.getItem(storageKey));
    } catch (error) {
      mode = "plan";
    }

    function syncFullscreenButton() {
      if (!fullscreenButton) return;
      const supported = supportsFullscreen();
      const active = Boolean(getFullscreenElement());
      const label = getText(active ? "fullscreen.exit" : "fullscreen.enter");
      fullscreenButton.hidden = !cockpitActive || !supported;
      fullscreenButton.setAttribute("aria-pressed", String(active));
      fullscreenButton.setAttribute("aria-label", label);
      fullscreenButton.dataset.tooltip = label;
      fullscreenButton.querySelector(".fullscreen-enter-icon")?.toggleAttribute("hidden", active);
      fullscreenButton.querySelector(".fullscreen-exit-icon")?.toggleAttribute("hidden", !active);
      normalizeTooltip(fullscreenButton);
    }

    function render() {
      const nextCockpitActive = getActivePage() === "run" && mode === "cockpit";
      page?.classList.toggle("is-cockpit", nextCockpitActive);
      documentRef.body?.classList.toggle("is-run-cockpit", nextCockpitActive);
      const compactViewEnabled = mode === "cockpit";
      toggleButton?.classList.toggle("is-active", compactViewEnabled);
      toggleButton?.setAttribute("aria-pressed", String(compactViewEnabled));
      if (nextCockpitActive && !cockpitActive) {
        onCockpitActivated();
      }
      cockpitActive = nextCockpitActive;
      syncFullscreenButton();
    }

    function setMode(value, { persist = true } = {}) {
      mode = normalizeRunViewMode(value);
      if (persist) {
        try {
          storage?.setItem(storageKey, mode);
        } catch (error) {
          // The view still works when browser storage is unavailable.
        }
      }
      render();
    }

    function init() {
      toggleButton?.addEventListener("click", () => {
        setMode(mode === "cockpit" ? "plan" : "cockpit");
      });
      fullscreenButton?.addEventListener("click", () => {
        void Promise.resolve(onFullscreenToggle()).finally(syncFullscreenButton);
      });
      documentRef.addEventListener?.("fullscreenchange", syncFullscreenButton);
      documentRef.addEventListener?.("webkitfullscreenchange", syncFullscreenButton);
      render();
    }

    return {
      getMode: () => mode,
      init,
      render,
      setMode,
      syncFullscreenButton,
    };
  }

  global.RunViewUi = {
    createRunViewController,
    normalizeRunViewMode,
  };
})(window);
