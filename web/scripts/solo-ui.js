(() => {
  const form = document.querySelector("#soloSettingsForm");
  const status = document.querySelector("#soloStatus");
  const message = document.querySelector("#soloSettingsMessage");
  const toggle = document.querySelector("#soloCaptureToggle");
  const isPC = ["localhost", "127.0.0.1"].includes(location.hostname);
  let loaded = false, running = false, busy = false, refreshing = false, lastStatus = null;
  const english = {
    title:"Companion & home network", address:"Currently reachable", port:"Port",
    hotkey:"Screenshot shortcut", mode:"Capture area", activeMonitor:"Active window's monitor", desktop:"Entire desktop", retention:"Screenshots to keep", pilot:"Pilot / handle for imports",
    autoCapture:"Enable screenshot capture at startup", allowLan:"Share on your home network",
    save:"Save settings", pcOnly:"Change network and screenshot settings directly on the PC.", restart:"Changes take effect after a restart.",
    routeKeys:"Route shortcuts", routeKeysHint:"Work in the background while Citizen Tools is running, even with screenshot capture paused. Record a combination and save. Empty fields disable a shortcut. Auto-unload directly confirms all ready deliveries at the current stop.",
    arriveKey:"Confirm arrival", loadKey:"Auto-load", pickupKey:"Pickup complete", unloadKey:"Auto-unload", homeKey:"Return home", clearKey:"Clear",
    homeLocation:"Home location", homeLocationHint:"An in-game location, e.g. Area18. Return home sets it as the next destination for your active ship. Confirm arrival when you reach it; your contracts remain open.",
    welcomeKicker:"Your command center", welcomeTitle:"Your ship. Your course.", welcomeDescription:"From the first contract to the final jump. You have the command.", newMission:"Create contract", myFleet:"My fleet",
  };
  for (const element of document.querySelectorAll("[data-solo-text]")) element.dataset.soloGerman = element.textContent;
  function translate() {
    const en = currentUiLanguage() === "en";
    document.querySelectorAll("[data-solo-text]").forEach(element => element.textContent = en ? english[element.dataset.soloText] : element.dataset.soloGerman);
    toggle.textContent = en ? (running ? "Pause capture" : "Start capture") : (running ? "Erfassung pausieren" : "Erfassung starten");
    if (lastStatus) document.querySelector("#soloNetworkHint").textContent = lastStatus.lanUrls.length
      ? (en ? "Access the tool on your home network, e.g. from a tablet." : "So erreichst du das Tool im eigenen Netz, z. B. per Tablet.")
      : (en ? "Currently accessible only on this PC." : "Aktuell nur auf diesem PC erreichbar.");
    hotkeyRecorders.forEach(recorder => recorder.render());
    if (lastStatus) {
      const shortcuts = lastStatus.shortcuts;
      document.querySelectorAll('[data-route-hotkey]').forEach(row => {
        const key = row.dataset.routeHotkey;
        const configured = lastStatus.settings[key];
        const info = shortcuts?.keys[key];
        row.querySelector('[data-key-status]').textContent = !configured ? (en ? 'Disabled' : 'Nicht belegt')
          : !shortcuts?.available ? (en ? 'Requires the Windows app.' : 'Benötigt die Windows-App.')
          : info?.active ? (en ? 'Active' : 'Aktiv')
          : info?.error ? (en ? 'Combination unavailable or already in use. Choose another and save.' : info.error)
          : (en ? 'Temporarily unavailable. After recording, release the keys; otherwise save again.' : 'Vorübergehend nicht verfügbar. Nach der Aufnahme Tasten loslassen; sonst erneut speichern.');
      });
    }
  }
  if (!isPC) {
    for (const field of form.elements) field.disabled = true;
    document.querySelector("#soloPcSettingsHint").hidden = false;
  }
  function renderStatus(data, fill=false) {
    lastStatus = data;
    window.soloRouteShortcuts?.setHomeLocation(data.settings.routeHomeLocation || '');
    running = data.captureRunning;
    const addresses = document.querySelector("#soloLanUrls");
    addresses.replaceChildren();
    for (const url of data.lanUrls.length ? data.lanUrls : [isPC ? data.url : location.origin]) {
      const link = document.createElement("a"); link.href = url; link.textContent = url;
      link.target = "_blank"; link.rel = "noreferrer"; addresses.append(link);
    }
    if (fill || !loaded) {
      for (const [key,value] of Object.entries(data.settings)) {
        const field = form.elements.namedItem(key);
        if (!field) continue;
        if (field.type === "checkbox") field.checked = value; else field.value = value;
      }
      loaded = true;
    }
    status.textContent = data.captureError || (data.captureReady ? (currentUiLanguage() === "en" ? "Screenshot capture ready · " : "Screenshot-Erfassung bereit · ") + data.settings.captureHotkey : running ? data.message : currentUiLanguage() === "en" ? "Screenshot capture paused" : "Screenshot-Erfassung pausiert");
    document.querySelector("#soloRestartHint").hidden = !data.restartRequired;
    translate();
  }
  async function api(path, payload) {
    const { response, payload: data } = await soloRequestJson(path, payload ? {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)} : {cache:"no-store"}, payload ? 35000 : 5000);
    if (!response.ok) throw new Error(data.error || "Anfrage fehlgeschlagen");
    return data;
  }
  async function refresh() {
    if (busy || refreshing) return;
    refreshing = true;
    try { renderStatus(await api("./api/solo/status")); }
    catch { status.textContent = currentUiLanguage() === "en" ? "Windows suite unavailable." : "Windows-Suite nicht erreichbar."; }
    finally { refreshing = false; }
  }
  const hotkeyRecorder = window.createSoloHotkeyRecorder({form, enabled:() => isPC && loaded && !busy});
  const hotkeyRecorders = [hotkeyRecorder];
  document.querySelectorAll('[data-route-hotkey]').forEach(row => {
    const field = row.querySelector('input');
    const recorder = window.createSoloHotkeyRecorder({form, field, enabled:() => isPC && loaded && !busy,
      button:row.querySelector('[data-key-record]'), hint:row.querySelector('[data-key-hint]')});
    hotkeyRecorders.push(recorder);
    row.querySelector('[data-key-clear]').addEventListener('click', () => {
      if (!isPC || !loaded || busy || hotkeyRecorders.some(item => item.recording)) return;
      field.value = '';
      field.dispatchEvent(new Event('change', {bubbles:true}));
    });
  });
  window.addEventListener('solo-settings-saved', event => { renderStatus(event.detail, true); hotkeyRecorders.forEach(recorder => recorder.saved()); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !isPC || hotkeyRecorders.some(recorder => recorder.recording)) return; busy = true;
    const sound = window.soloSound?.feedbackFor(event);
    const values = Object.fromEntries(new FormData(form));
    values.port = Number(values.port);
    values.captureRetention = Number(values.captureRetention);
    values.captureEnabled = form.elements.captureEnabled.checked;
    values.lanEnabled = form.elements.lanEnabled.checked;
    try { renderStatus(await api("./api/solo/settings", values), true); hotkeyRecorders.forEach(recorder => recorder.saved()); message.textContent = currentUiLanguage() === "en" ? "Settings saved." : "Einstellungen gespeichert."; sound?.('confirm'); }
    catch (error) { message.textContent = error.message; sound?.('error'); } finally { busy = false; }
  });
  toggle.addEventListener("click", async () => {
    if (busy || !isPC) return; busy = true;
    try { renderStatus(await api("./api/solo/capture", {enabled:!running})); }
    catch (error) { message.textContent = error.message; } finally { busy = false; }
  });
  document.querySelector("#uiLanguageSelect")?.addEventListener("change", translate);
  window.soloConnection.start();
  translate();
  void refresh(); setInterval(refresh, 3000);
})();
