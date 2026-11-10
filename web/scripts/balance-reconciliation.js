// A balance observation is evidence for review, never an instruction to book money.
(function (root) {
  const limit = 999999999999;
  function stamp(value) {
    const text = JSON.stringify(value);
    let a = 2166136261, b = 2246822519;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619);
      b = Math.imul(b ^ text.charCodeAt(i), 3266489917);
    }
    return [a,b].map(n => (n >>> 0).toString(16).padStart(8,'0')).join('');
  }
  const key = snapshot => snapshot ? stamp([snapshot.id || '',snapshot.at,snapshot.amount,snapshot.sourceFile || '']) : '';
  const ledgerStamp = entries => stamp((entries || []).map(entry => [entry.id,entry.flow,entry.amountAuec,entry.missionId || '',entry.bookedOn,entry.createdAt])
    .sort((a,b) => String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0));
  const total = entries => (entries || []).reduce((sum, entry) => sum + (entry.flow === 'expense' ? -1 : 1) * Number(entry.amountAuec || 0), 0);
  function normalize(value) {
    if (!value || !/^[a-f0-9]{16}$/.test(value.key || '') || !/^[a-f0-9]{16}$/.test(value.ledgerStamp || '')
        || !Number.isSafeInteger(value.amount) || value.amount < 0
        || !['pending','resolved','dismissed','stale'].includes(value.status)) return null;
    return {key:value.key, ledgerStamp:value.ledgerStamp, amount:value.amount, status:value.status,
      reviewedAt:Number.isFinite(Date.parse(value.reviewedAt)) ? value.reviewedAt : ''};
  }
  function begin(state, snapshot) {
    const entries = state.ledgerEntries || [], previous = normalize(state.balanceReconciliation);
    const mark = ledgerStamp(entries), difference = snapshot.amount - total(entries);
    const lateBooking = entries.some(entry => Date.parse(entry.createdAt) > Date.parse(snapshot.at));
    const dismissed = previous?.status === 'dismissed' && previous.amount === snapshot.amount && previous.ledgerStamp === mark;
    return {key:key(snapshot), ledgerStamp:mark, amount:snapshot.amount,
      status:!difference ? 'resolved' : lateBooking ? 'stale' : dismissed ? 'dismissed' : 'pending',
      reviewedAt:dismissed ? previous.reviewedAt : ''};
  }
  function view(state) {
    const snapshot = state.telemetryBalance;
    if (!snapshot) return {status:'empty'};
    const ledger = total(state.ledgerEntries), difference = snapshot.amount - ledger;
    const review = normalize(state.balanceReconciliation), mark = ledgerStamp(state.ledgerEntries);
    const valid = review && review.key === key(snapshot) && review.amount === snapshot.amount && review.ledgerStamp === mark;
    const status = !Number.isSafeInteger(difference) ? 'stale' : !difference ? 'resolved'
      : !valid ? 'stale' : review.status;
    return {status, key:key(snapshot), ledgerStamp:mark, amount:snapshot.amount, at:snapshot.at, ledger, difference};
  }
  function canMatch(state, mission) {
    return Boolean(mission && !['paid','cancelled'].includes(mission.status) && !mission.paidAt
      && mission.logFailure?.status !== 'blocked'
      && !(state.ledgerEntries || []).some(entry => entry.missionId === mission.id && entry.flow === 'income' && Number(entry.amountAuec) > 0));
  }
  const expenses = [['service','Betankung'],['service','Wasserstoff'],['service','Quantum'],['service','Reparatur'],
    ['other','Essen'],['other','Trinken'],['other','Kleidung'],['cargo','Warenankauf'],['other','Sonstiges']];
  const incomes = [['other','Anfangsbestand'],['other','Transfer'],['other','Geschenk'],['other','Rückerstattung'],['cargo','Warenverkauf'],['other','Sonstiges']];
  const categories = flow => (flow === 'expense' ? expenses : incomes).map(([scope,category]) => ({scope,category}));
  const api = {key,ledgerStamp,total,normalize,begin,view,canMatch,categories,missionStamp:stamp,limit};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BalanceReconciliation = api;
})(globalThis);
