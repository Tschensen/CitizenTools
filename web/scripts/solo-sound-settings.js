/* Per-cue file selection and gain controls; the audio engine owns preferences. */
(() => {
  const panel = document.querySelector('#soloSoundPanel'), container = document.querySelector('#soloSoundRows');
  const audio = window.soloSound;
  if (!container || !audio) return;
  const labels = {
    de:{tap:'Taste', navigation:'Navigation', confirm:'Bestätigung', dialog:'Dialog', error:'Hinweis', 'import-read':'Import · Einlesen', 'import-processing':'Import · Verarbeitung', 'import-success':'Import · Erkannt', 'import-failure':'Import · Fehlgeschlagen', standard:'Standard', custom:'Eigene Datei', choose:'Datei wählen', preview:'Probehören', volume:'Lautstärke', source:'Ton', uploading:'Wird gespeichert …', invalid:'Bitte eine gültige, unkomprimierte PCM-WAV-Datei wählen (Mono/Stereo, 8–96 kHz).', size:'Die Datei darf höchstens 2 MB groß sein.', duration:'Der Ton darf höchstens 3 Sekunden lang sein.', failed:'Datei konnte nicht gespeichert werden. Die bisherige Auswahl bleibt erhalten.'},
    en:{tap:'Button', navigation:'Navigation', confirm:'Confirm', dialog:'Dialog', error:'Notice', 'import-read':'Import · Reading', 'import-processing':'Import · Processing', 'import-success':'Import · Recognized', 'import-failure':'Import · Failed', standard:'Default', custom:'Custom file', choose:'Choose file', preview:'Preview', volume:'Volume', source:'Sound', uploading:'Saving …', invalid:'Choose a valid uncompressed PCM WAV file (mono/stereo, 8–96 kHz).', size:'The file must not exceed 2 MB.', duration:'The sound must not exceed 3 seconds.', failed:'Could not save the file. Your previous selection is unchanged.'},
  };
  const words = () => labels[currentUiLanguage() === 'en' ? 'en' : 'de'];
  const rows = new Map();
  for (const name of Object.keys(window.SoloSoundPresets)) {
    const row = document.createElement('div'); row.className = 'solo-cue-row'; row.dataset.sound = name;
    row.innerHTML = `<strong class="solo-cue-title"></strong>
      <div class="solo-cue-file"><select data-cue-source><option value="standard"></option><option value="custom"></option></select><button type="button" class="secondary-button" data-cue-choose></button><input type="file" accept=".wav,audio/wav,audio/x-wav" data-cue-file hidden /></div>
      <label class="solo-sound-volume"><span data-cue-label></span><output>100 %</output><input type="range" min="0" max="100" step="5" value="100" data-cue-volume /></label>
      <button type="button" class="secondary-button" data-cue-preview></button>
      <p class="solo-cue-message" role="status" aria-live="polite" hidden></p>`;
    const get = selector => row.querySelector(selector);
    const elements = {row, title:get('.solo-cue-title'), select:get('[data-cue-source]'), choose:get('[data-cue-choose]'), input:get('[data-cue-file]'), volume:get('[data-cue-volume]'), level:get('output'), label:get('[data-cue-label]'), preview:get('[data-cue-preview]'), message:get('.solo-cue-message'), busy:false, error:''};
    rows.set(name, elements); container.append(row);
    elements.choose.addEventListener('click', () => elements.input.click());
    elements.preview.addEventListener('click', event => audio.preview(name, event));
    elements.select.addEventListener('change', () => { audio.setCue(name, {source:elements.select.value}); elements.error = ''; render(name); });
    elements.volume.addEventListener('input', () => { audio.setCue(name, {volume:Number(elements.volume.value)}); render(name); });
    elements.input.addEventListener('change', async () => {
      const file = elements.input.files?.[0]; elements.input.value = '';
      if (!file || elements.busy) return;
      if (!file.name.toLowerCase().endsWith('.wav')) { elements.error = 'invalid'; render(name); return; }
      if (file.size > 2 * 1024 * 1024) { elements.error = 'size'; render(name); return; }
      elements.busy = true; elements.error = ''; render(name);
      try {
        const encoded = await new Promise((resolve, reject) => {
          const reader = new FileReader(); reader.onerror = reject;
          reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
        });
        const response = await fetch(`./api/solo/sounds/${name}`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({filename:file.name, data:encoded})});
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || 'sound_save_failed');
        audio.uploaded(name, result.sound);
      } catch (error) {
        elements.error = error.message === 'sound_too_large' ? 'size' : error.message === 'sound_too_long' ? 'duration' : error.message === 'sound_invalid_wav' ? 'invalid' : 'failed';
      } finally { elements.busy = false; render(name); }
    });
  }
  function render(name) {
    const item = rows.get(name), cue = audio.cue(name), saved = audio.catalog()[name], text = words();
    item.title.textContent = text[name];
    item.select.options[0].textContent = text.standard;
    item.select.options[1].textContent = saved?.available ? saved.filename : text.custom;
    item.select.options[1].disabled = !saved?.available;
    item.select.value = cue.source;
    item.select.setAttribute('aria-label', `${text[name]} · ${text.source}`);
    item.choose.textContent = item.busy ? text.uploading : text.choose;
    item.choose.setAttribute('aria-label', `${text[name]} · ${text.choose}`);
    item.preview.textContent = text.preview; item.preview.setAttribute('aria-label', `${text[name]} · ${text.preview}`);
    item.volume.value = cue.volume; item.level.textContent = `${cue.volume} %`;
    item.volume.setAttribute('aria-label', `${text[name]} · ${text.volume}`); item.volume.setAttribute('aria-valuetext', `${cue.volume} %`);
    item.label.textContent = text.volume;
    for (const control of [item.select, item.choose, item.volume, item.preview]) control.disabled = item.busy;
    item.message.textContent = item.error ? text[item.error] : ''; item.message.hidden = !item.error;
  }
  function renderAll() { rows.forEach((_, name) => render(name)); }
  panel.addEventListener('soundcatalogchange', renderAll);
  document.querySelector('#uiLanguageSelect')?.addEventListener('change', renderAll);
  renderAll();
})();
