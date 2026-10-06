const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const read = name => fs.readFileSync(path.join(__dirname, '../web', name), 'utf8');

function fixture(instant) {
  const NativeDate = Date;
  class Clock extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return new NativeDate(instant).getTime(); }
  }
  const c = vm.createContext({ window: {}, Date: Clock });
  for (const name of ['calendar-date', 'statistics-period', 'finance', 'ledger-automation']) {
    vm.runInContext(read('scripts/' + name + '.js'), c);
  }
  // Use the real form helper as well as the domain modules.
  vm.runInContext(read('app.js').match(/function formatDateForInput\(date\) \{[^}]+\}/)[0], c);
  return c;
}

if (process.argv[2] === '--timezone') {
  const cases = {
    'Europe/Berlin': [
      ['2026-10-06T00:30:00+02:00', '2026-10-06'],
      ['2026-01-01T00:05:00+01:00', '2026-01-01'],
      ['2026-03-29T03:05:00+02:00', '2026-03-29'],
      ['2026-10-25T02:30:00+02:00', '2026-10-25'],
      ['2026-10-25T02:30:00+01:00', '2026-10-25'],
    ],
    'America/Los_Angeles': [['2026-10-05T23:30:00-07:00', '2026-10-05']],
    'UTC': [['2026-10-06T00:30:00Z', '2026-10-06']],
  };
  for (const [instant, expected] of cases[process.env.TZ]) {
    const c = fixture(instant), w = c.window;
    const today = w.StatisticsPeriod.getRange({preset:'today'});
    assert.equal(today.start, expected);
    assert.equal(c.formatDateForInput(instant), expected, 'Form follows the local day');
    assert.equal(w.FinanceModule.createLedgerEntry({amountAuec:10}).bookedOn, expected, 'Default booking uses local day');
    const state = {ledgerEntries:[], fleet:[]};
    const booking = w.LedgerAutomation.createMissionIncomeForCompletedMission({
      state, mission:{id:'mission', title:'Titan', payout:12500}, completedAt:instant,
      helpers:{formatDateForInput:c.formatDateForInput, createLedgerEntry:w.FinanceModule.createLedgerEntry},
    });
    assert.equal(booking.bookedOn, expected, 'Mission payout uses the same day');
    assert.equal(booking.createdAt, instant, 'The original timestamp is retained');
    assert.equal(w.StatisticsPeriod.selectState(state, today).ledgerEntries.length, 1, 'Payout appears in Today');
    assert.equal(c.formatDateForInput('2026-02-01'), '2026-02-01', 'Explicit dates do not shift');
    assert.equal(c.formatDateForInput('2026-02-30'), '', 'Invalid dates are not invented');
    assert.equal(c.formatDateForInput(null), '');
    assert.equal(c.formatDateForInput('not-a-date'), '');
  }
} else {
  for (const zone of ['Europe/Berlin', 'America/Los_Angeles', 'UTC']) {
    test('forms, automatic bookings and Today agree in ' + zone, () => {
      execFileSync(process.execPath, [__filename, '--timezone'], {env:{...process.env, TZ:zone}, stdio:'pipe'});
    });
  }
}
