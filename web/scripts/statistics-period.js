(function registerStatisticsPeriod() {
  const NON_OPERATING = new Set(['Schiffskauf', 'Schiffsverkauf', 'Upgrade']);
  const presets = ['all', 'today', 'week', 'month', 'custom'];
  function dateKey(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = new Date(`${value}T12:00:00`);
      return Number.isFinite(parsed.getTime()) && localKey(parsed) === value ? value : '';
    }
    // Reject loosely parsed legacy strings and numeric IDs, rather than inventing dates.
    if (!(value instanceof Date) && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value))) return '';
    if (typeof value === 'string' && !dateKey(value.slice(0, 10))) return '';
    const parsed = value instanceof Date ? value : new Date(value);
    return Number.isFinite(parsed.getTime()) ? localKey(parsed) : '';
  }
  function localKey(date) {
    return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function shiftDay(key, days) {
    const date = new Date(`${key}T12:00:00`);
    date.setDate(date.getDate() + days);
    return localKey(date);
  }
  function normalizeFilter(value) {
    const preset = presets.includes(value?.preset) ? value.preset : 'all';
    const start = dateKey(value?.start), end = dateKey(value?.end);
    if (preset === 'custom' && (!start || !end || start > end)) return { preset: 'all', start: '', end: '' };
    return { preset, start, end };
  }
  function getRange(filter, now = new Date()) {
    const value = normalizeFilter(filter), today = dateKey(now);
    if (value.preset === 'today') return { ...value, start: today, end: today };
    if (value.preset === 'week') return { ...value, start: shiftDay(today, -6), end: today };
    if (value.preset === 'month') return { ...value, start: `${today.slice(0, 7)}-01`, end: today };
    return value;
  }
  function contains(range, key) {
    return range.preset === 'all' || Boolean(key && key >= range.start && key <= range.end);
  }
  function getComparisonRange(range) {
    if (!range || range.preset === 'all') return null;
    const start = dateKey(range.start), end = dateKey(range.end);
    if (!start || !end || start > end) return null;
    let previousStart, previousEnd;
    if (range.preset === 'month') {
      const lastDay = shiftDay(`${start.slice(0, 7)}-01`, -1);
      previousStart = `${lastDay.slice(0, 7)}-01`;
      previousEnd = `${lastDay.slice(0, 7)}-${String(Math.min(Number(end.slice(8)), Number(lastDay.slice(8)))).padStart(2, '0')}`;
    } else {
      const days = Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1;
      previousStart = shiftDay(start, -days);
      previousEnd = shiftDay(start, -1);
    }
    if (!dateKey(previousStart) || !dateKey(previousEnd) || previousStart.startsWith('0000')) return null;
    return { preset: 'custom', start: previousStart, end: previousEnd };
  }
  function compareValues(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    const delta = current - previous;
    const percentage = previous > 0 ? delta / previous * 100 : null;
    return { current, previous, delta, percentage: Number.isFinite(percentage) ? percentage : null };
  }
  const completed = mission => ['completed', 'paid'].includes(String(mission?.status || '').trim().toLowerCase()) || Boolean(mission?.completedAt || mission?.paidAt);
  const missionDate = mission => (completed(mission) ? dateKey(mission.completedAt) || dateKey(mission.paidAt) : '') || dateKey(mission?.createdAt);
  const bookingDate = entry => dateKey(entry?.bookedOn) || dateKey(entry?.createdAt);
  const operating = entry => !NON_OPERATING.has(String(entry?.category || '').trim());
  const list = value => Array.isArray(value) ? value : [];
  function selectState(state, range) {
    const missions = list(state.missions).filter(m => String(m?.status || '').trim().toLowerCase() !== 'cancelled');
    const ledger = list(state.ledgerEntries), stops = list(state.stopHistory);
    return {
      missions: missions.filter(m => contains(range, missionDate(m))),
      ledgerEntries: ledger.filter(e => contains(range, bookingDate(e))),
      stopHistory: stops.filter(s => contains(range, dateKey(s.completedAt))),
      undated: missions.filter(m => !missionDate(m)).length + ledger.filter(e => !bookingDate(e)).length + stops.filter(s => !dateKey(s.completedAt)).length,
    };
  }
  function operatingBookings(entries) {
    return list(entries).filter(operating).filter(e => ['income', 'expense'].includes(e.flow) && Number.isFinite(Number(e.amountAuec)));
  }
  function operatingTotals(entries) {
    const totals = { income: 0, expense: 0, result: 0 };
    operatingBookings(entries).forEach(e => totals[e.flow] += Number(e.amountAuec));
    totals.result = totals.income - totals.expense;
    return totals;
  }
  function buildTrend(entries, range) {
    const bookings = operatingBookings(entries);
    const totals = operatingTotals(bookings);
    const dated = bookings.filter(e => bookingDate(e));
    const result = { totals, buckets: [], unit: 'day', undated: bookings.length - dated.length };
    if (!dated.length) return result;
    const dates = dated.map(bookingDate).sort();
    const start = range.preset === 'all' ? dates[0] : range.start;
    const end = range.preset === 'all' ? dates.at(-1) : range.end;
    const days = Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${start}T12:00:00Z`)) / 86400000) + 1;
    result.unit = days <= 62 ? 'day' : days <= 366 ? 'week' : days <= 2192 ? 'month' : 'year';
    const yearStep = Math.max(1, Math.ceil((Number(end.slice(0, 4)) - Number(start.slice(0, 4)) + 1) / 80));
    let cursor = start;
    // Calendar increments keep local dates stable across daylight saving changes.
    while (cursor <= end && result.buckets.length < 100) {
      let next;
      if (result.unit === 'day' || result.unit === 'week') next = shiftDay(cursor, result.unit === 'day' ? 1 : 7);
      else {
        const date = new Date(`${cursor}T12:00:00`);
        date.setDate(1);
        if (result.unit === 'month') date.setMonth(date.getMonth() + 1);
        else { date.setMonth(0); date.setFullYear(date.getFullYear() + yearStep); }
        next = localKey(date);
      }
      // Years beyond 9999 no longer sort as four-digit keys.
      const last = next.length !== 10 || next > end ? end : shiftDay(next, -1);
      result.buckets.push({ start: cursor, end: last, income: 0, expense: 0, result: 0 });
      if (last === end) break;
      cursor = next;
    }
    dated.forEach(entry => {
      const key = bookingDate(entry), bucket = result.buckets.find(b => key >= b.start && key <= b.end);
      if (bucket) bucket[entry.flow] += Number(entry.amountAuec);
    });
    result.buckets.forEach(b => b.result = b.income - b.expense);
    return result;
  }
  const api = { dateKey, shiftDay, normalizeFilter, getRange, getComparisonRange, compareValues, contains, missionDate, bookingDate, operating, operatingTotals, selectState, buildTrend };
  if (typeof window !== 'undefined') window.StatisticsPeriod = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
