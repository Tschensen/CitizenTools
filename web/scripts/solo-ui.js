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
    hotkeyRecorder.render();
  }
  if (!isPC) {
    for (const field of form.elements) field.disabled = true;
    document.querySelector("#soloPcSettingsHint").hidden = false;
  }
  function renderStatus(data, fill=false) {
    lastStatus = data;
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
  window.addEventListener('solo-settings-saved', event => { renderStatus(event.detail, true); hotkeyRecorder.saved(); });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (busy || !isPC || hotkeyRecorder.recording) return; busy = true;
    const sound = window.soloSound?.feedbackFor(event);
    const values = Object.fromEntries(new FormData(form));
    values.port = Number(values.port);
    values.captureRetention = Number(values.captureRetention);
    values.captureEnabled = form.elements.captureEnabled.checked;
    values.lanEnabled = form.elements.lanEnabled.checked;
    try { renderStatus(await api("./api/solo/settings", values), true); hotkeyRecorder.saved(); message.textContent = currentUiLanguage() === "en" ? "Settings saved." : "Einstellungen gespeichert."; sound?.('confirm'); }
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
