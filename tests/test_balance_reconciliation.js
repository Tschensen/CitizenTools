const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../web/scripts/balance-reconciliation.js');
const at = '2026-11-10T12:00:00Z';
function observe(state, amount, date = at) {
  const snapshot = {id:'capture:'+date,amount,at:date};
  state.balanceReconciliation = R.begin(state,snapshot);
  state.telemetryBalance = snapshot;
  return R.view(state);
}
const fixture = () => ({ledgerEntries:[{id:'opening',amountAuec:1000,flow:'income',createdAt:'2026-11-01T12:00:00Z'}]});

test('only a real difference creates a proposal, without changing money', () => {
  const state=fixture(), before=structuredClone(state.ledgerEntries);
  assert.equal(R.view(state).status,'empty');
  assert.equal(observe(state,1000).status,'resolved');
  assert.equal(observe(state,975).status,'pending');
  assert.equal(R.view(state).difference,-25);
  assert.deepEqual(state.ledgerEntries,before);
  assert.equal(observe(state,1050).difference,50);
});

test('dismissal survives serialization and repeated screenshots of an unchanged balance', () => {
  let state=fixture(); observe(state,950);
  state.balanceReconciliation.status='dismissed';
  state=JSON.parse(JSON.stringify(state));
  assert.equal(observe(state,950,'2026-11-10T12:01:00Z').status,'dismissed');
  assert.equal(observe(state,940,'2026-11-10T12:02:00Z').status,'pending');
});

test('manual changes, deletion and legacy snapshots require a new observation', () => {
  for (const change of [s=>s.ledgerEntries[0].amountAuec=900,s=>s.ledgerEntries=[],s=>s.balanceReconciliation=null]) {
    const state=fixture(); observe(state,950); change(state);
    assert.equal(R.view(state).status,'stale');
    assert.equal(observe(state,950,'2026-11-10T12:01:00Z').status,'pending');
  }
});

test('a screenshot predating a new booking cannot propose an accidental counterbooking', () => {
  const state=fixture();
  state.ledgerEntries.push({id:'later',flow:'expense',amountAuec:20,createdAt:'2026-11-10T12:00:01Z'});
  assert.equal(observe(state,1000).status,'stale');
  assert.equal(observe(state,980,'2026-11-10T12:01:00Z').status,'resolved');
});

test('reordering entries preserves the comparison while changing their links invalidates it', () => {
  const state=fixture(); state.ledgerEntries.push({id:'food',flow:'expense',amountAuec:20});
  observe(state,950); state.ledgerEntries.reverse();
  assert.equal(R.view(state).status,'pending');
  state.ledgerEntries[0].missionId='m';
  assert.equal(R.view(state).status,'stale');
});

test('failed, cancelled and paid contracts cannot be matched', () => {
  const state=fixture(), mission={id:'m',status:'active'};
  assert.equal(R.canMatch(state,mission),true);
  for (const patch of [{status:'paid'},{status:'cancelled'},{paidAt:at},{logFailure:{status:'blocked'}}]) {
    assert.equal(R.canMatch(state,{...mission,...patch}),false);
  }
  state.ledgerEntries.push({missionId:'m',flow:'income',amountAuec:1});
  assert.equal(R.canMatch(state,mission),false);
});
