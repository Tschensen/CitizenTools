/* Device-local audio preferences; personal WAV files with a synth fallback. */
(() => {
  const panel = document.querySelector('#soloSoundPanel');
  if (!panel) return;
  const enabledInput = document.querySelector('#soloSoundEnabled');
  const volumeInput = document.querySelector('#soloSoundVolume');
  const level = document.querySelector('#soloSoundLevel');
  const importsInput = document.querySelector('#soloImportSoundsEnabled');
  const status = document.querySelector('#soloSoundStatus');
  const storageKey = 'citizen-tools:interface-sounds:v1';
  const translations = {
    de: {title:'Interface-Sounds', format:'WAV (unkomprimiertes PCM), Mono oder Stereo, 8–96 kHz. Maximal 2 MB und 3 Sekunden pro Datei.', enable:'Interface-Sounds aktivieren', volume:'Gesamtlautstärke', unavailable:'Audio ist hier momentan nicht verfügbar. Bitte erneut Probehören wählen.', storage:'Die Einstellung gilt für diese Sitzung; der Browser konnte sie nicht speichern.', muted:'Dieser Ton ist stummgeschaltet.', imports:'Auftragsimport begleiten (auch im Hintergrund)', reload:'Sounddateien neu laden', reloaded:'Sounddateien neu geladen.', catalogError:'Eigene Sounddateien konnten nicht geladen werden.'},
    en: {title:'Interface sounds', format:'WAV (uncompressed PCM), mono or stereo, 8–96 kHz. Maximum 2 MB and 3 seconds per file.', enable:'Enable interface sounds', volume:'Master volume', unavailable:'Audio is currently unavailable here. Please try the preview again.', storage:'This setting applies to this session; the browser could not save it.', muted:'This sound is muted.', imports:'Play import signals (including in the background)', reload:'Reload sound files', reloaded:'Sound files reloaded.', catalogError:'Custom sound files could not be loaded.'},
  };
  const tones = window.SoloSoundPresets;
  const sourcesConfigured = new Set();
  const percent = (value, fallback) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback;
  let settings = {enabled:false, volume:25, imports:true, cues:Object.fromEntries(Object.keys(tones).map(name => [name, {source:'standard', volume:100}]))};
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved === 'object') {
      settings.enabled = saved.enabled === true;
      settings.imports = saved.imports !== false;
      settings.volume = percent(saved.volume, 25);
      for (const name of Object.keys(tones)) {
        const cue = saved.cues?.[name];
        if (cue && ['standard', 'custom'].includes(cue.source)) {
          sourcesConfigured.add(name);
          settings.cues[name] = {source:cue.source, volume:percent(cue.volume, 100)};
        }
      }
    }
  } catch { /* Private/restricted storage must not prevent startup. */ }

  let context = null, preferenceEpoch = 0, messageKey = '', gesture = null;
  const channels = {ui:{serial:0, lastToneAt:-Infinity, voices:new Set()}, imports:{serial:0, lastToneAt:-Infinity, voices:new Set()}};
  const buffers = new Map();
  let catalog = {}, catalogRequest = 0;
  const effectiveVolume = name => settings.volume / 100 * settings.cues[name].volume / 100;
  const words = () => translations[typeof currentUiLanguage === 'function' && currentUiLanguage() === 'en' ? 'en' : 'de'];
  function translate() {
    panel.querySelectorAll('[data-sound-text]').forEach(node => { node.textContent = words()[node.dataset.soundText]; });
    volumeInput.setAttribute('aria-valuetext', `${settings.volume} %`);
    level.textContent = `${settings.volume} %`;
    status.textContent = messageKey ? words()[messageKey] : '';
    status.hidden = !messageKey;
  }
  function message(key) { messageKey = key; translate(); }
  function stop(channel = channels.ui) {
    channel.serial += 1;
    for (const voice of channel.voices) {
      try { voice.oscillator.stop(); } catch { /* Already ended. */ }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    channel.voices.clear();
  }
  function prepare() {
    // Call during a real gesture so WebView2 and mobile browsers can unlock audio.
    if (!context || context.state === 'closed') {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return Promise.reject(new Error('audio_unavailable'));
      context = new AudioContext();
    }
    return context.state === 'running' ? Promise.resolve() : context.resume();
  }
  const allowed = (preview, importCue = false) => (!document.hidden || importCue) && settings.volume > 0 && (preview || settings.enabled) && (!importCue || settings.imports);
  async function soundBuffer(name) {
    const source = settings.cues[name].source;
    const key = `${name}:${source}:${catalog[name]?.revision || ''}`;
    if (!buffers.has(key)) {
      buffers.set(key, (async () => {
        try {
          const url = source === 'custom' ? `./api/solo/sounds/${name}.wav` : `./assets/sounds/${name}.wav`;
          const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(2000)});
          if (!response.ok) return null;
          const data = await response.arrayBuffer();
          if (data.byteLength > 2 * 1024 * 1024) return null;
          const buffer = await context.decodeAudioData(data);
          return buffer.duration > 0 && buffer.duration <= 3 ? buffer : null;
        } catch { return null; }
      })());
    }
    return buffers.get(key);
  }
  async function play(name, preview = false, importCue = false) {
    if (!allowed(preview, importCue) || !tones[name] || !effectiveVolume(name)) return 0;
    const channel = importCue ? channels.imports : channels.ui;
    const requestedAt = performance.now();
    if (!importCue && !preview && name !== 'error' && requestedAt - channel.lastToneAt < 45) return 0;
    stop(channel);
    const request = channel.serial;
    try {
      await prepare();
      // Never play a queued sound after mute, tab switching or a delayed unlock.
      if (request !== channel.serial || !allowed(preview, importCue) || context.state !== 'running' || performance.now() - requestedAt > 1000) return 0;
      const buffer = await soundBuffer(name);
      if (request !== channel.serial || !allowed(preview, importCue) || performance.now() - requestedAt > 3000) return 0;
      channel.lastToneAt = performance.now();
      const start = context.currentTime + .005;
      if (buffer) {
        const oscillator = context.createBufferSource(), gain = context.createGain();
        const voice = {oscillator, gain};
        oscillator.buffer = buffer;
        gain.gain.setValueAtTime(effectiveVolume(name), start);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); channel.voices.delete(voice); };
        channel.voices.add(voice);
        oscillator.start(start);
        return buffer.duration;
      }
      for (const [offset, frequency, endFrequency, duration, waveform] of tones[name]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const voice = {oscillator, gain};
        channel.voices.add(voice);
        oscillator.type = waveform;
        oscillator.frequency.setValueAtTime(frequency, start + offset);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + offset + duration);
        gain.gain.setValueAtTime(0, start + offset);
        gain.gain.linearRampToValueAtTime(.12 * effectiveVolume(name), start + offset + .006);
        gain.gain.exponentialRampToValueAtTime(.0001, start + offset + duration);
        gain.gain.setValueAtTime(0, start + offset + duration + .004);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); channel.voices.delete(voice); };
        oscillator.start(start + offset);
        oscillator.stop(start + offset + duration + .008);
      }
      return Math.max(...tones[name].map(note => note[0] + note[3])) + .012;
    } catch {
      stop(channel);
      message('unavailable');
      return false;
    }
  }
  function persistSettings() {
    preferenceEpoch += 1;
    stop();
    stop(channels.imports);
    window.soloImportSounds?.clear();
    try { localStorage.setItem(storageKey, JSON.stringify(settings)); message(''); }
    catch { message('storage'); }
  }
  enabledInput.checked = settings.enabled;
  importsInput.checked = settings.imports;
  volumeInput.value = settings.volume;
  enabledInput.addEventListener('change', event => {
    settings.enabled = enabledInput.checked;
    persistSettings();
    if (event.isTrusted && settings.enabled) void play('confirm');
  });
  volumeInput.addEventListener('input', () => {
    settings.volume = Math.max(0, Math.min(100, Number(volumeInput.value) || 0));
    persistSettings();
  });
  importsInput.addEventListener('change', () => { settings.imports = importsInput.checked; persistSettings(); });
  async function refreshCatalog() {
    const request = ++catalogRequest;
    try {
      const response = await fetch('./api/solo/sounds', {cache:'no-store'});
      if (!response.ok) throw new Error('unavailable');
      const payload = await response.json();
      if (request !== catalogRequest) return;
      catalog = payload.sounds || {};
      // Preserve manually replaced files from 0.1.8, but a user's explicit
      // Standard selection always uses the immutable bundled original.
      for (const name of Object.keys(tones)) {
        if (!sourcesConfigured.has(name) && catalog[name]?.available) settings.cues[name].source = 'custom';
      }
      buffers.clear();
      panel.dispatchEvent(new Event('soundcatalogchange'));
    } catch { message('catalogError'); }
  }
  document.querySelector('#soloSoundReload').addEventListener('click', async () => {
    buffers.clear(); stop(); stop(channels.imports); window.soloImportSounds?.clear();
    message('reloaded'); await refreshCatalog();
  });
  document.querySelector('#uiLanguageSelect')?.addEventListener('change', translate);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stop();
      if (!settings.imports && context?.state === 'running') void context.suspend().catch(() => {});
    }
  });

  // Use explicit completion callbacks for asynchronous actions. The callback is
  // tied to that user's gesture, expires and is invalidated by preference changes.
  window.soloSound = {
    cue: name => ({...settings.cues[name]}),
    catalog: () => catalog,
    refreshCatalog,
    setCue(name, update) {
      if (!tones[name]) return;
      const cue = settings.cues[name];
      if (['standard', 'custom'].includes(update.source)) { cue.source = update.source; sourcesConfigured.add(name); }
      if (typeof update.volume === 'number') cue.volume = percent(update.volume, cue.volume);
      persistSettings();
    },
    uploaded(name, item) {
      if (!tones[name]) return;
      catalogRequest += 1;
      catalog[name] = item;
      buffers.clear();
      this.setCue(name, {source:'custom'});
      panel.dispatchEvent(new Event('soundcatalogchange'));
    },
    preview(name, event) {
      if (!event?.isTrusted || !tones[name]) return;
      message(effectiveVolume(name) === 0 ? 'muted' : '');
      void play(name, true);
    },
    canImport: () => allowed(false, true),
    playImport: name => play(name, false, true),
    stopImport: () => stop(channels.imports),
    unlock() { if (settings.enabled && settings.volume > 0) { try { void prepare().catch(() => {}); } catch { /* Optional audio. */ } } },
    feedbackFor(event) {
      if (!event?.isTrusted || !allowed(false)) return () => {};
      const epoch = preferenceEpoch, began = performance.now();
      let completed = false;
      try { void prepare().catch(() => {}); } catch { /* Optional audio. */ }
      return name => {
        if (completed) return;
        completed = true;
        if (epoch === preferenceEpoch && performance.now() - began < 10000) void play(name);
      };
    },
  };
  void refreshCatalog();
  document.addEventListener('pointerdown', event => { if (event.isTrusted) window.soloSound.unlock(); }, true);
  document.addEventListener('keydown', event => { if (event.isTrusted) window.soloSound.unlock(); }, true);
  const navigation = '.module-tab, .nav-tab, .shipdb-view-tab, [data-go-page], [data-settings-go], #settingsMenuButton, .hub-today-card, .summary-card[data-go-page]';
  const visibleDialogs = () => Array.from(document.querySelectorAll('.app-dialog-backdrop:not([hidden])'));
  document.addEventListener('click', event => {
    if (!event.isTrusted || !allowed(false)) return;
    const button = event.target.closest?.('button, summary, [role="button"]');
    if (!button || button.closest('#soloSoundPanel') || button.disabled || button.getAttribute('aria-disabled') === 'true' || !button.getClientRects().length) return;
    const action = gesture = {button, began:performance.now(), invalid:false, dialogs:new Set(visibleDialogs())};
    try { void prepare().catch(() => {}); } catch { /* Optional audio. */ }
    // Run after handlers and native form validation; one cue per interaction.
    setTimeout(() => {
      if (gesture !== action) return;
      const opened = visibleDialogs().find(dialog => !action.dialogs.has(dialog));
      if (action.invalid) { void play('error'); return; }
      if (opened) { void play(opened.querySelector('.secondary-button-danger') ? 'error' : 'dialog'); return; }
      // Companion saving reports its actual result, not a premature success tone.
      if (button.form?.id === 'soloSettingsForm' && button.type === 'submit') return;
      if (button.id === 'missionImportClipboardButton') return;
      void play(button.matches(navigation) ? 'navigation' : button.matches('.primary-button, [type="submit"]') ? 'confirm' : 'tap');
    }, 0);
  }, true);
  document.addEventListener('invalid', event => {
    if (gesture && event.isTrusted && performance.now() - gesture.began < 200 && event.target.form === gesture.button.form) gesture.invalid = true;
  }, true);
  translate();
})();
