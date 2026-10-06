// Local calendar dates for bookings, forms and statistics. Timestamps remain UTC.
(function registerCalendarDate() {
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
  const api = { dateKey, localKey };
  if (typeof window !== 'undefined') window.CalendarDate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
