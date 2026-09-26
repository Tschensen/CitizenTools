(function registerStatisticsTrend() {
  function createStatisticsChart({ t, escapeHtml, currentUiLanguage }) {
    const root = document.getElementById('statisticsTrend');
    let selected = null, previousKey = '', latestTrend = null, lastWidth = 0;
    if (root && typeof ResizeObserver !== 'undefined') new ResizeObserver(() => {
      if (root.clientWidth && root.clientWidth !== lastWidth && latestTrend) render(latestTrend);
    }).observe(root);
    const esc = value => escapeHtml(String(value));
    const locale = () => currentUiLanguage() === 'en' ? 'en-US' : 'de-DE';
    const money = value => `${Math.round(value).toLocaleString(locale())} aUEC`;
    const date = key => new Date(`${key}T12:00:00`).toLocaleDateString(locale());
    const label = bucket => bucket.start === bucket.end ? date(bucket.start) : `${date(bucket.start)} – ${date(bucket.end)}`;
    function render(trend) {
      if (!root) return;
      latestTrend = trend;
      lastWidth = root.clientWidth;
      const series = ['income', 'expense', 'result'];
      const buckets = trend.buckets;
      const rangeKey = buckets.map(b => b.start).join('|');
      if (rangeKey !== previousKey) selected = buckets.length - 1;
      previousKey = rangeKey;
      root.innerHTML = `<div class="statistics-trend-totals">${series.map(name => `<div class="summary-card summary-card-compact"><span>${esc(t(`statistics.trend.${name}`))}</span><strong data-trend-total="${name}" class="trend-${name}">${esc(money(trend.totals[name]))}</strong></div>`).join('')}</div>
        ${trend.undated ? `<p class="form-hint">${esc(t('statistics.trend.undated', { count: trend.undated }))}</p>` : ''}`;
      if (!buckets.length) {
        root.insertAdjacentHTML('beforeend', `<div class="empty-state">${esc(t('statistics.trend.empty'))}</div>`);
        return;
      }
      const width = Math.max(300, Math.min(800, root.clientWidth || 800)), left = 65, right = width - 18, top = 18, bottom = 194;
      const values = buckets.flatMap(b => series.map(name => b[name]));
      const low = Math.min(0, ...values), high = Math.max(1, ...values);
      const rawStep = (high - low) / 5;
      const magnitude = 10 ** Math.floor(Math.log10(rawStep));
      const step = [1, 2, 5, 10].find(value => value >= rawStep / magnitude) * magnitude;
      const min = Math.floor(low / step) * step, max = Math.ceil(high / step) * step;
      const x = index => buckets.length === 1 ? (left + right) / 2 : left + index * (right - left) / (buckets.length - 1);
      const y = value => bottom - ((value - min) / (max - min)) * (bottom - top);
      const compact = value => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value);
      const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => min + step * i);
      const dateIndexes = [...new Set([0, Math.floor((buckets.length - 1) / 2), buckets.length - 1])];
      const svg = `<svg class="statistics-trend-svg" viewBox="0 0 ${width} 230" role="img" aria-label="${esc(t('statistics.trend.chartLabel'))}">
        <title>${esc(t('statistics.trend.chartLabel'))}</title>
        ${ticks.map(value => `<line class="trend-grid" x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/><text x="${left - 9}" y="${y(value) + 4}" text-anchor="end">${esc(compact(value))}</text>`).join('')}
        <line class="trend-zero" x1="${left}" x2="${right}" y1="${y(0)}" y2="${y(0)}"/>
        ${series.map(name => `<polyline class="trend-line trend-${name}" points="${buckets.map((b, i) => `${x(i)},${y(b[name])}`).join(' ')}"/>`).join('')}
        ${dateIndexes.map(i => `<text x="${x(i)}" y="219" text-anchor="${buckets.length === 1 ? 'middle' : i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}">${esc(date(buckets[i].start))}</text>`).join('')}
        <g id="statisticsTrendMarker"><line class="trend-cursor" y1="${top}" y2="${bottom}"/>${series.map(name => `<circle class="trend-dot trend-${name}" data-series="${name}" r="4"/>`).join('')}</g>
      </svg>`;
      root.insertAdjacentHTML('beforeend', `<div class="statistics-trend-legend">${series.map(name => `<span class="trend-${name}"><i></i>${esc(t(`statistics.trend.${name}`))}</span>`).join('')}<small>${esc(t(`statistics.trend.${trend.unit}`))} · aUEC</small></div>
        <div class="statistics-trend-plot">${svg}</div>
        <label class="statistics-trend-slider"><span>${esc(t('statistics.trend.select'))}</span><input id="statisticsTrendPosition" type="range" min="0" max="${buckets.length - 1}" step="1" value="${selected}" ${buckets.length === 1 ? 'disabled' : ''}/></label>
        <div id="statisticsTrendReadout" class="statistics-trend-readout" aria-live="polite" aria-atomic="true"></div>
        <details class="statistics-trend-details"><summary>${esc(t('statistics.trend.table'))}</summary><div class="statistics-trend-table-wrap"><table><caption>${esc(t('statistics.trend.chartLabel'))}</caption><thead><tr><th scope="col">${esc(t('statistics.period.label'))}</th>${series.map(name => `<th scope="col">${esc(t(`statistics.trend.${name}`))}</th>`).join('')}</tr></thead><tbody>${buckets.map(b => `<tr><th scope="row">${esc(label(b))}</th>${series.map(name => `<td>${esc(money(b[name]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`);
      const slider = root.querySelector('#statisticsTrendPosition');
      function select(index) {
        selected = Math.max(0, Math.min(buckets.length - 1, index));
        const bucket = buckets[selected], cx = x(selected);
        slider.value = selected;
        slider.setAttribute('aria-valuetext', label(bucket));
        const marker = root.querySelector('#statisticsTrendMarker');
        const line = marker.querySelector('line');
        line.setAttribute('x1', cx); line.setAttribute('x2', cx);
        marker.querySelectorAll('circle').forEach(dot => { dot.setAttribute('cx', cx); dot.setAttribute('cy', y(bucket[dot.dataset.series])); });
        root.querySelector('#statisticsTrendReadout').innerHTML = `<strong>${esc(label(bucket))}</strong>${series.map(name => `<span class="trend-${name}">${esc(t(`statistics.trend.${name}`))}: <b>${esc(money(bucket[name]))}</b></span>`).join('')}`;
      }
      slider.addEventListener('input', () => select(Number(slider.value)));
      root.querySelector('svg').addEventListener('pointerdown', event => {
        const box = event.currentTarget.getBoundingClientRect();
        const px = (event.clientX - box.left) / box.width * width;
        select(Math.round((px - left) / (right - left) * (buckets.length - 1)));
      });
      select(selected);
    }
    return { render };
  }
  window.StatisticsTrend = { createStatisticsChart };
})();
