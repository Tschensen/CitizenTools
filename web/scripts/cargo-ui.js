// Shared cargo labels and a single event-registration entry point.
function cargoText(key, fallback, params = {}) {
  if (typeof window.t === "function") return window.t(key, params);
  return String(fallback || "").replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function cargoLocale() {
  return typeof currentUiLanguage === "function" && currentUiLanguage() === "en" ? "en-US" : "de-DE";
}

function formatAutoloadResultWithOverload(result, text) {
  if (!result?.overloadCount) return text;
  return `${text} · ${cargoText("autoload.result.overload", "{count} im Überladungsbereich", {
    count: result.overloadCount,
  })}`;
}

let cargoUiEventsRegistered = false;
function registerCargoUiEvents() {
  if (cargoUiEventsRegistered) return;
  cargoUiEventsRegistered = true;
  registerLocationPickerEvents();
  registerMissionFormEvents();
  registerMissionCargoFormEvents();
  registerMissionImportEvents();
  registerCargoOverviewEvents();
  registerRunModeEvents();
  registerCargoLayoutEvents();
  registerAppNavigationEvents();
}
