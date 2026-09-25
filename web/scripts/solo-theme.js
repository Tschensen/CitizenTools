/* Appearance belongs to this device, just like its interface sound levels. */
(() => {
  const key = 'citizen-tools:accent';
  const standard = '#79dfed';
  const input = document.getElementById('soloAccentColor');
  const output = document.getElementById('soloAccentValue');
  const presets = [...document.querySelectorAll('[data-accent-color]')];
  const reset = document.getElementById('soloAccentReset');
  const status = document.getElementById('soloAccentStatus');
  const properties = ['--accent-rgb', '--accent-strong-rgb', '--accent-mid-rgb', '--accent-dark-rgb', '--flight-rgb', '--flight-cyan'];
  const valid = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
  let selected = standard;
  let storageFailed = false;
  try {
    const stored = localStorage.getItem(key);
    if (valid(stored)) selected = stored.toLowerCase();
  } catch { /* Private/restricted browsers still support a temporary theme. */ }

  const mix = (rgb, target, amount) => rgb.map((value, i) => Math.round(value + (target[i] - value) * amount));
  const luminance = rgb => rgb.map(value => {
    const channel = value / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0);
  const hex = rgb => '#' + rgb.map(value => value.toString(16).padStart(2, '0')).join('');

  function apply(value) {
    selected = valid(value) ? value.toLowerCase() : standard;
    for (const property of properties) document.body.style.removeProperty(property);
    if (selected === standard) {
      delete document.body.dataset.soloAccent;
    } else {
      const rgb = selected.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16));
      // Lift very dark choices for readable labels on the dark interface.
      let readable = rgb;
      for (let step = 1; step <= 20 && (luminance(readable) + .05) / (luminance([16, 33, 47]) + .05) < 4.5; step++) {
        readable = mix(rgb, [255, 255, 255], step / 20);
      }
      const values = [readable, mix(readable, [255, 255, 255], .28), mix(readable, [0, 0, 0], .56), mix(readable, [0, 0, 0], .73), readable];
      properties.slice(0, 5).forEach((property, i) => document.body.style.setProperty(property, values[i].join(', ')));
      document.body.style.setProperty('--flight-cyan', hex(readable));
      document.body.dataset.soloAccent = selected;
    }
    render();
  }

  function render() {
    const english = document.documentElement.lang === 'en';
    input.value = selected;
    output.textContent = selected.toUpperCase();
    presets.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.accentColor === selected));
      button.setAttribute('aria-label', english ? button.dataset.accentEn : button.dataset.accentDe);
      button.title = button.getAttribute('aria-label');
    });
    reset.disabled = selected === standard;
    status.hidden = !storageFailed;
    status.textContent = english ? 'The browser could not save this choice. It applies until the page is closed.' : 'Der Browser konnte die Auswahl nicht speichern. Sie gilt bis zum Schließen der Seite.';
  }

  function choose(value) {
    if (!valid(value)) return;
    storageFailed = false;
    try {
      if (value.toLowerCase() === standard) localStorage.removeItem(key);
      else localStorage.setItem(key, value.toLowerCase());
    } catch { storageFailed = true; }
    apply(value);
  }

  presets.forEach(button => button.addEventListener('click', () => choose(button.dataset.accentColor)));
  input.addEventListener('input', () => choose(input.value));
  reset.addEventListener('click', () => choose(standard));
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(event.newValue); });
  window.soloTheme = { render, get color() { return getComputedStyle(document.body).getPropertyValue('--flight-cyan').trim(); } };
  apply(selected);
})();
