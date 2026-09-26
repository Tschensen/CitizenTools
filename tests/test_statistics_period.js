const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../web/scripts/statistics-period.js');
const custom = (start, end) => p.getRange({ preset: 'custom', start, end });
const booking = (bookedOn, amountAuec, flow = 'income', extra = {}) => ({ bookedOn, amountAuec, flow, ...extra });

test('today, seven days and month use local calendar boundaries', () => {
  const now = new Date(2026, 0, 3, 0, 5);
  assert.equal(p.getRange({ preset: 'today' }, now).start, '2026-01-03');
  assert.equal(p.getRange({ preset: 'week' }, now).start, '2025-12-28');
  assert.equal(p.getRange({ preset: 'month' }, now).start, '2026-01-01');
});
test('custom range includes both boundary dates', () => {
  const range = custom('2026-09-01', '2026-09-02');
  assert.ok(p.contains(range, '2026-09-01'));
  assert.ok(p.contains(range, '2026-09-02'));
  assert.ok(!p.contains(range, '2026-09-03'));
  assert.ok(!p.contains(range, ''));
});
test('bad stored ranges fall back to all time', () => {
  for (const value of [null, {}, { preset: 'bad' }, { preset: 'custom', start: '2026-02-30', end: '2026-03-05' }, { preset: 'custom', start: '2026-10-01', end: '2026-09-01' }]) {
    assert.equal(p.normalizeFilter(value).preset, 'all');
  }
});
test('date-only bookings retain their day while timestamps follow local time', () => {
  assert.equal(p.dateKey('2026-01-01'), '2026-01-01');
  const stamp = '2026-01-01T00:30:00Z', local = new Date(stamp);
  assert.equal(p.dateKey(stamp), `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`);
});
test('invalid or missing dates never become today', () => {
  for (const value of ['', null, undefined, 0, 'broken', '09/02/26', '2025-02-29', '2026-13-01', '2026-02-30T12:00:00Z']) assert.equal(p.dateKey(value), '');
  assert.equal(p.dateKey('2024-02-29'), '2024-02-29');
});
test('calendar shifts cross daylight saving and leap days', () => {
  assert.equal(p.shiftDay('2026-03-28', 2), '2026-03-30');
  assert.equal(p.shiftDay('2026-10-24', 2), '2026-10-26');
  assert.equal(p.shiftDay('2024-02-28', 1), '2024-02-29');
});
test('completed contracts use completion, not creation or later payment', () => {
  assert.equal(p.missionDate({ status: 'paid', createdAt: '2026-08-01', completedAt: '2026-09-01', paidAt: '2026-09-02' }), '2026-09-01');
  assert.equal(p.missionDate({ status: 'completed', completedAt: 'broken', paidAt: '2026-09-02' }), '2026-09-02');
  assert.equal(p.missionDate({ status: 'active', createdAt: '2026-08-01' }), '2026-08-01');
});
test('booked date takes precedence over entry creation', () => {
  assert.equal(p.bookingDate({ bookedOn: '2026-09-01', createdAt: '2026-09-04' }), '2026-09-01');
  assert.equal(p.bookingDate({ bookedOn: 'broken', createdAt: '2026-09-04' }), '2026-09-04');
});
test('missions, bookings and stops filter independently and leave state untouched', () => {
  const state = { missions: [{ id: 'new', status: 'completed', createdAt: '2026-08-01', completedAt: '2026-09-01' }, { id: 'old', status: 'completed', completedAt: '2026-08-01' }, { id: 'cancelled', status: 'cancelled', createdAt: '2026-09-01' }], ledgerEntries: [booking('2026-09-01', 50, 'income', { missionId: 'old' })], stopHistory: [{ completedAt: '2026-08-01' }, { completedAt: '2026-09-01' }] };
  const before = JSON.stringify(state), selection = p.selectState(state, custom('2026-09-01', '2026-09-01'));
  assert.deepEqual(selection.missions.map(m => m.id), ['new']);
  assert.equal(selection.ledgerEntries.length, 1);
  assert.equal(selection.stopHistory.length, 1);
  assert.equal(JSON.stringify(state), before);
});
test('undated legacy records remain available in all time only', () => {
  const state = { missions: [{ id: 'legacy' }], ledgerEntries: [booking('', 50)], stopHistory: [{}] };
  assert.equal(p.selectState(state, custom('2026-09-01', '2026-09-01')).undated, 3);
  assert.equal(p.selectState(state, { preset: 'all' }).missions.length, 1);
  assert.equal(p.selectState(state, custom('2026-09-01', '2026-09-01')).ledgerEntries.length, 0);
});
test('operating totals exclude acquisitions, sales and upgrades, including unassigned bookings', () => {
  const trend = p.buildTrend([booking('2026-09-01', 100), booking('2026-09-01', 30, 'expense'), ...['Schiffskauf', 'Schiffsverkauf', 'Upgrade'].map(category => booking('2026-09-01', 999, 'expense', { category }))], { preset: 'all' });
  assert.deepEqual(trend.totals, { income: 100, expense: 30, result: 70 });
  assert.equal(trend.buckets[0].result, 70);
});
test('zero days and negative result survive daily aggregation', () => {
  const trend = p.buildTrend([booking('2026-09-01', 100), booking('2026-09-03', 150, 'expense')], custom('2026-09-01', '2026-09-03'));
  assert.equal(trend.buckets.length, 3);
  assert.equal(trend.buckets[1].result, 0);
  assert.equal(trend.buckets[2].result, -150);
  assert.equal(trend.totals.result, -50);
});
test('chart skips undated records but discloses their contribution to totals', () => {
  const trend = p.buildTrend([booking('', 50), booking('2026-09-01', 70)], { preset: 'all' });
  assert.equal(trend.undated, 1);
  assert.equal(trend.totals.income, 120);
  assert.equal(trend.buckets[0].income, 70);
});
test('empty and zero-valued histories are finite', () => {
  assert.equal(p.buildTrend([], { preset: 'all' }).buckets.length, 0);
  assert.equal(p.buildTrend([booking('2026-09-01', 0)], { preset: 'all' }).buckets[0].result, 0);
});
test('long ranges aggregate without losing totals or end boundaries', () => {
  for (const [start, end, unit] of [['2026-01-01', '2026-06-01', 'week'], ['2024-01-01', '2026-09-01', 'month'], ['1000-01-01', '9999-12-31', 'year']]) {
    const trend = p.buildTrend([booking(start, 100), booking(end, 200)], custom(start, end));
    assert.equal(trend.unit, unit);
    assert.ok(trend.buckets.length <= 80);
    assert.equal(trend.buckets.at(-1).end, end);
    assert.equal(trend.buckets.reduce((sum, b) => sum + b.income, 0), 300);
  }
});
