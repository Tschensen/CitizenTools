/* Key recording releases the global shortcut briefly, without stopping OCR. */
window.createSoloHotkeyRecorder = ({form, enabled}) => {
  const field = form.elements.captureHotkey;
  const button = document.getElementById("soloHotkeyRecord");
  const hint = document.getElementById("soloHotkeyHint");
  const texts = {
    de: {record:"Aufnehmen", cancel:"Abbrechen", idle:"Anklicken und Tastenkombination drücken.", preparing:"Aufnahme wird vorbereitet …", listening:"Jetzt Tastenkombination drücken · Esc bricht ab.", saved:"Übernommen · Einstellungen speichern zum Aktivieren.", cancelled:"Abgebrochen · Bisherige Kombination bleibt erhalten.", invalid:"Strg, Alt, Umschalt oder Win + Buchstabe, Zahl, F1–F24, Einfg, Pause oder Druck verwenden.", error:"Aufnahme nicht verfügbar. Bitte erneut versuchen."},
    en: {record:"Record", cancel:"Cancel", idle:"Click and press your key combination.", preparing:"Preparing to record …", listening:"Press your key combination · Esc cancels.", saved:"Recorded · Save settings to activate.", cancelled:"Cancelled · Previous combination kept.", invalid:"Use Ctrl, Alt, Shift or Win + a letter, digit, F1–F24, Insert, Pause or Print Screen.", error:"Recording unavailable. Please try again."},
  };
  let phase = "idle", note = "idle", session = null, renewal = null, validUntil = 0;
  function render() {
    const text = texts[currentUiLanguage() === "en" ? "en" : "de"];
    hint.textContent = text[note];
    button.textContent = text[phase === "idle" ? "record" : "cancel"];
    button.setAttribute("aria-pressed", String(phase !== "idle"));
    field.classList.toggle("is-recording", phase !== "idle");
    field.dataset.recording = phase;
  }
  async function lease(id, active, keepalive=false) {
    const {response} = await soloRequestJson("./api/solo/hotkey-recording", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({session:id, enabled:active}), keepalive,
    }, 4000);
    if (!response.ok) throw new Error("hotkey_recording_unavailable");
  }
  function release(id) { if (id) void lease(id, false, true).catch(() => {}); }
  function finish(reason="cancelled") {
    const previous = session;
    session = null; phase = "idle"; note = reason; validUntil = 0;
    clearInterval(renewal); renewal = null;
    release(previous); render();
  }
  async function begin() {
    if (phase !== "idle" || !enabled()) return;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    session = id; phase = "preparing"; note = "preparing"; render(); field.focus();
    let renewing = false;
    async function renew() {
      if (renewing) return;
      renewing = true;
      const sent = Date.now();
      try {
        await lease(id, true);
        if (session !== id) { release(id); return; }
        // Reject input after a sleeping tab outlives its server-side lease.
        validUntil = sent + 12000;
        if (Date.now() >= validUntil) { finish("error"); return; }
        if (phase === "preparing") { phase = "listening"; note = "listening"; render(); }
      } catch { if (session === id) finish("error"); }
      finally { renewing = false; }
    }
    await renew();
    if (session === id) renewal = setInterval(renew, 5000);
  }
  function keyName(event) {
    const key = event.key || "";
    if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return key;
    if (/^[a-z0-9]$/i.test(key)) return key.toUpperCase();
    // Shift+number produces a symbol in KeyboardEvent.key. Windows registers
    // the underlying digit; keyCode also respects German Y/Z keyboard layouts.
    if (event.keyCode >= 48 && event.keyCode <= 57) return String.fromCharCode(event.keyCode);
    if (/^Digit[0-9]$/.test(event.code || "")) return event.code.slice(-1);
    return {Insert:"Insert", Pause:"Pause", PrintScreen:"PrintScreen"}[key] || null;
  }
  function record(event) {
    if (phase === "idle") {
      if (event.type === "keydown" && ["Enter", " "].includes(event.key)) { event.preventDefault(); void begin(); }
      return;
    }
    if (event.key === "Tab") { finish(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === "Escape") { finish(); return; }
    if (phase !== "listening" || event.repeat || event.isComposing) return;
    if (Date.now() >= validUntil) { finish("error"); return; }
    if (event.type === "keyup" && event.key !== "PrintScreen") return;
    if (["Control", "Shift", "Alt", "Meta", "OS"].includes(event.key)) return;
    const main = keyName(event);
    const modifiers = [["Ctrl",event.ctrlKey],["Alt",event.altKey],["Shift",event.shiftKey],["Win",event.metaKey]].filter(([,down])=>down).map(([name])=>name);
    if (!main || !modifiers.length || event.getModifierState?.("AltGraph")) { note = "invalid"; render(); return; }
    field.value = [...modifiers, main].join("+");
    finish("saved");
    field.dispatchEvent(new Event("input", {bubbles:true}));
    field.dispatchEvent(new Event("change", {bubbles:true}));
  }
  field.addEventListener("click", () => void begin());
  field.addEventListener("keydown", record);
  field.addEventListener("keyup", record);
  button.addEventListener("click", () => phase === "idle" ? void begin() : finish());
  field.parentElement.addEventListener("focusout", event => {
    if (phase !== "idle" && !field.parentElement.contains(event.relatedTarget)) finish();
  });
  window.addEventListener("blur", () => { if (session) finish(); });
  window.addEventListener("pagehide", () => { if (session) finish(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && session) finish(); });
  render();
  return {get recording(){return phase !== "idle";}, render, saved(){note="idle"; render();}};
};
