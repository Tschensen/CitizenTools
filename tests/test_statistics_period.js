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

test('today compares with the previous calendar day, including New Year', () => {
  assert.deepEqual(p.getComparisonRange(p.getRange({ preset: 'today' }, new Date(2026, 0, 1, 12))), {
    preset: 'custom', start: '2025-12-31', end: '2025-12-31',
  });
});
test('seven-day comparison contains exactly the preceding seven days', () => {
  const range = p.getRange({ preset: 'week' }, new Date(2026, 0, 3, 12));
  const before = p.getComparisonRange(range);
  assert.deepEqual(before, { preset: 'custom', start: '2025-12-21', end: '2025-12-27' });
  assert.ok(!p.contains(before, range.start));
});
test('month-to-date uses the same part of the previous month and clamps short months', () => {
  for (const [current, start, end] of [
    [new Date(2026, 0, 3), '2025-12-01', '2025-12-03'],
    [new Date(2026, 2, 31), '2026-02-01', '2026-02-28'],
    [new Date(2024, 2, 31), '2024-02-01', '2024-02-29'],
    [new Date(2026, 1, 28), '2026-01-01', '2026-01-28'],
    [new Date(2026, 4, 1), '2026-04-01', '2026-04-01'],
  ]) {
    assert.deepEqual(p.getComparisonRange(p.getRange({ preset: 'month' }, current)), { preset: 'custom', start, end });
  }
});
test('custom ranges preserve inclusive length across leap days and clock changes', () => {
  for (const [start, end, beforeStart, beforeEnd] of [
    ['2026-09-01', '2026-09-03', '2026-08-29', '2026-08-31'],
    ['2024-03-01', '2024-03-02', '2024-02-28', '2024-02-29'],
    ['2026-03-29', '2026-03-30', '2026-03-27', '2026-03-28'],
    ['2026-10-25', '2026-10-26', '2026-10-23', '2026-10-24'],
  ]) {
    assert.deepEqual(p.getComparisonRange(custom(start, end)), { preset: 'custom', start: beforeStart, end: beforeEnd });
  }
});
test('all-time and invalid ranges have no invented comparison period', () => {
  for (const range of [{ preset: 'all' }, null, { preset: 'custom', start: '', end: '2026-09-01' }, { preset: 'custom', start: '2026-09-02', end: '2026-09-01' }, custom('0001-01-01', '0001-01-01')]) {
    assert.equal(p.getComparisonRange(range), null);
  }
});
test('absolute changes and percentages use the actual positive comparison value', () => {
  assert.deepEqual(p.compareValues(300, 200), { current: 300, previous: 200, delta: 100, percentage: 50 });
  assert.equal(p.compareValues(50, 200).percentage, -75);
  assert.equal(p.compareValues(-50, 100).percentage, -150);
  assert.equal(p.compareValues(200, 200).delta, 0);
});
test('zero and negative baselines show absolute changes without misleading percentages', () => {
  for (const previous of [0, -100]) {
    const value = p.compareValues(60, previous);
    assert.equal(value.percentage, null);
    assert.equal(value.delta, 60 - previous);
  }
  assert.equal(p.compareValues(0, 0).delta, 0);
  assert.equal(p.compareValues(-150, -100).delta, -50);
  assert.equal(p.compareValues(NaN, 10), null);
});
test('operating comparisons exclude ship purchases and undated bookings using the same rules as the chart', () => {
  const range = custom('2026-09-02', '2026-09-02');
  const before = p.getComparisonRange(range);
  const state = { ledgerEntries: [booking('2026-09-01', 100), booking('2026-09-01', 40, 'expense'), booking('2026-09-02', 150), booking('2026-09-02', 20, 'expense'), booking('2026-09-02', 999999, 'expense', { category: 'Schiffskauf' }), booking('', 99999)] };
  const oldTotals = p.operatingTotals(p.selectState(state, before).ledgerEntries);
  const currentEntries = p.selectState(state, range).ledgerEntries;
  const newTotals = p.operatingTotals(currentEntries);
  assert.deepEqual(newTotals, p.buildTrend(currentEntries, range).totals);
  assert.equal(p.compareValues(newTotals.income, oldTotals.income).delta, 50);
  assert.equal(p.compareValues(newTotals.expense, oldTotals.expense).percentage, -50);
  assert.equal(p.compareValues(newTotals.result, oldTotals.result).delta, 70);
});
test('empty current period still compares with a populated previous period', () => {
  const range = custom('2026-09-02', '2026-09-02');
  const state = { ledgerEntries: [booking('2026-09-01', 100)] };
  const current = p.operatingTotals(p.selectState(state, range).ledgerEntries);
  const previous = p.operatingTotals(p.selectState(state, p.getComparisonRange(range)).ledgerEntries);
  assert.equal(p.compareValues(current.income, previous.income).percentage, -100);
});
