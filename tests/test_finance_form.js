const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const nodes = new Map();
  const document = { activeElement: null };
  function element(value = '') {
    const handlers = {};
    return {
      value, hidden: false, disabled: false, required: false, checked: false,
      dataset: {}, classList: { add() {}, toggle() {} },
      addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
      async fire(type, extra = {}) {
        const event = { target: this, preventDefault() {}, ...extra };
        for (const fn of handlers[type] || []) await fn(event);
      },
      setCustomValidity(message) { this.validationMessage = message; },
      reportValidity() { return !this.validationMessage && (!this.required || this.value !== ''); },
      focus() { document.activeElement = this; },
      setAttribute() {},
    };
  }
  function add(id, value = '') {
    const node = element(value);
    nodes.set('#' + id, node);
    return node;
  }
  function form(id, fields) {
    const node = add(id);
    node.elements = fields;
    Object.assign(node, fields);
    node.reset = () => Object.values(fields).forEach(field => {
      if (field.radios) field.radios.forEach((radio, index) => { radio.checked = index === 0; });
      else field.value = '';
    });
    node.reportValidity = () => Object.values(fields).every(field => field.disabled || field.reportValidity?.() !== false);
    return node;
  }
  function modes() {
    const radios = [element('amount'), element('endingBalance')];
    return { radios, get value() { return radios.find(input => input.checked)?.value || ''; } };
  }
  const amountMode = modes(), quickMode = modes();
  const main = form('financeForm', {
    entryId: element(), bookedOn: element(), scope: add('financeScopeSelect'),
    category: add('financeCategorySelect'), flow: element(),
    amountAuec: add('financeAmountInput'), endingBalanceAuec: add('financeEndingBalanceInput'),
    notes: element(), reference: add('financeReferenceInput'), amountInputMode: amountMode,
  });
  nodes.set('#financeForm [name="flow"]', main.flow);
  add('financeShipWorkflowFields');
  add('financeCancelButton');
  const quick = form('financeQuickExpenseForm', {
    bookedOn: add('financeQuickExpenseDate'), category: add('financeQuickExpenseCategory'),
    amountAuec: add('financeQuickExpenseAmount'), endingBalanceAuec: add('financeQuickExpenseEndingBalance'),
    fuelType: add('financeQuickExpenseFuel'), reference: add('financeQuickExpenseReference'),
    notes: add('financeQuickExpenseNotes'), quickExpenseAmountMode: quickMode,
  });
  quick.fuelType.disabled = true;
  quick.endingBalanceAuec.min = 0;
  for (const id of ['financeQuickExpenseDialog', 'financeQuickExpenseTitle', 'financeQuickExpenseShip',
    'financeQuickExpenseFuelField', 'financeQuickExpenseAmountField', 'financeQuickExpenseEndingBalanceField',
    'financeQuickExpenseBalanceCalculation', 'financeQuickExpenseCancel']) add(id);
  const buttons = ['food', 'drink', 'refuel'].map(preset => {
    const button = element();
    button.dataset.financeQuickExpense = preset;
    return button;
  });
  const details = [element(), element(), element()];
  document.querySelector = selector => nodes.get(selector) || null;
  document.querySelectorAll = selector => ({
    '[data-finance-quick-expense]': buttons, '[data-finance-quick-details]': details,
    '[name="amountInputMode"]': amountMode.radios, '[name="quickExpenseAmountMode"]': quickMode.radios,
  }[selector] || []);
  const state = {
    missions: [], fleet: [{ id: 'ship-1', shipId: 'profile-1', status: 'active', model: 'Test ship' }],
    activeFleetEntryId: 'ship-1',
    ledgerEntries: [{ id: 'opening', bookedOn: '2026-11-03', scope: 'other', category: 'Anfangsbestand', flow: 'income', amountAuec: 10000 }],
  };
  let persisted = 0, counter = 0;
  const notices = [];
  const context = vm.createContext({
    window: { requestAnimationFrame: fn => fn() }, document,
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.elements[key]?.value ?? null; } },
  });
  for (const script of ['calendar-date', 'finance']) {
    vm.runInContext(fs.readFileSync(require.resolve('../web/scripts/' + script + '.js'), 'utf8'), context);
  }
  const controller = context.window.FinanceModule.createFinanceController({
    getState: () => state,
    helpers: {
      t: key => key, escapeHtml: String, formatDateForInput: () => '2026-11-03', normalizeDateInput: String,
      compareDateInputs: (a, b) => a.localeCompare(b), createRuntimeId: () => 'entry-' + ++counter,
      getFleetEntries: () => state.fleet, getShipLibraryEntries: () => [], findShipLibraryEntryById: () => null,
      render() {}, persist() { persisted++; }, setActivePage() {},
      async showConfirmDialog(options) { notices.push(options); return true; },
    },
  });
  controller.init();
  return { main, quick, controller, state, details, amountMode, quickMode, document, notices,
    node: id => nodes.get('#' + id), persisted: () => persisted,
    async open(preset) {
      const button = buttons.find(button => button.dataset.financeQuickExpense === preset);
      button.focus(); await button.fire('click'); return button;
    },
  };
}

test('a chosen expense survives category, scope, amount, note and background changes', async () => {
  const f = fixture();
  f.main.flow.value = 'expense'; await f.main.flow.fire('change');
  f.main.scope.value = 'other'; await f.main.scope.fire('change');
  f.main.category.value = 'Sonstiges'; await f.main.category.fire('change');
  f.main.amountAuec.value = '50'; f.main.notes.value = 'Food';
  await f.main.fire('input'); await f.main.fire('change'); f.controller.render();
  assert.equal(f.main.flow.value, 'expense');
  await f.main.fire('submit');
  assert.equal(f.state.ledgerEntries[0].flow, 'expense');
  assert.equal(f.state.ledgerEntries[0].amountAuec, 50);
});

test('explicit income and an existing booking retain their direction', async () => {
  const f = fixture();
  f.main.flow.value = 'income'; await f.main.flow.fire('change');
  f.main.scope.value = 'service'; await f.main.scope.fire('change');
  assert.equal(f.main.flow.value, 'income');
  f.main.entryId.value = 'existing'; f.main.flow.value = 'expense';
  f.main.scope.value = 'other'; await f.main.scope.fire('change');
  f.main.category.value = 'Transfer'; await f.main.category.fire('change');
  assert.equal(f.main.flow.value, 'expense');
});

test('manual ledger income cannot bypass a linked contract failure', async () => {
  const f=fixture();
  f.state.missions.push({id:'failed-contract',logFailure:{status:'blocked'}});
  f.main.elements.missionId={value:'failed-contract'};
  f.main.flow.value='income'; await f.main.flow.fire('change');
  f.main.category.value='Auftragserlös'; f.main.amountAuec.value='500';
  const before=JSON.stringify(f.state.ledgerEntries);
  await f.main.fire('submit');
  assert.equal(JSON.stringify(f.state.ledgerEntries),before);
  assert.equal(f.persisted(),0);
  assert.equal(f.notices.at(-1).message,'contracts.failure.blocked');
});

test('new forms still suggest defaults; neutral categories preserve the direction', async () => {
  const f = fixture();
  f.main.scope.value = 'service'; await f.main.scope.fire('change');
  assert.equal(f.main.flow.value, 'expense');
  f.main.category.value = 'Service-Sonstiges'; await f.main.category.fire('change');
  assert.equal(f.main.flow.value, 'expense');
  f.main.scope.value = 'cargo'; await f.main.scope.fire('change');
  assert.equal(f.main.flow.value, 'income');
  f.main.flow.value = 'expense'; await f.main.flow.fire('change');
  await f.node('financeCancelButton').fire('click');
  f.main.scope.value = 'service'; await f.main.scope.fire('change');
  assert.equal(f.main.flow.value, 'expense', 'reset clears the manual direction lock');
});

test('ship purchase and sale retain their required directions', async () => {
  const f = fixture();
  f.main.flow.value = 'income'; await f.main.flow.fire('change');
  f.main.scope.value = 'ship'; await f.main.scope.fire('change');
  assert.equal(f.main.flow.value, 'expense'); assert.equal(f.main.flow.disabled, true);
  f.main.category.value = 'Schiffsverkauf'; await f.main.category.fire('change');
  assert.equal(f.main.flow.value, 'income'); assert.equal(f.main.flow.disabled, true);
  f.main.category.value = 'Leihgebühr'; await f.main.category.fire('change');
  assert.equal(f.main.flow.disabled, false);
});

for (const [preset, category] of [['food', 'Essen'], ['drink', 'Trinken']]) {
  test(preset + ' books the balance difference without requiring a ship', async () => {
    const f = fixture(); f.state.fleet = [];
    const button = await f.open(preset);
    assert.equal(f.quickMode.value, 'endingBalance');
    assert.equal(f.document.activeElement, f.quick.endingBalanceAuec);
    assert.ok(f.details.every(node => node.hidden));
    assert.equal(f.quick.fuelType.disabled, true);
    f.quick.endingBalanceAuec.value = '9950'; await f.quick.fire('submit');
    const entry = f.state.ledgerEntries[0];
    assert.equal(entry.flow, 'expense'); assert.equal(entry.scope, 'other');
    assert.equal(entry.category, category); assert.equal(entry.amountAuec, 50);
    assert.equal(entry.fleetEntryId, ''); assert.equal(entry.bookedOn, '2026-11-03');
    assert.equal(f.persisted(), 1); assert.equal(f.document.activeElement, button);
    await f.quick.fire('submit'); assert.equal(f.persisted(), 1, 'closed dialog cannot book twice');
  });
}

for (const fuel of ['Wasserstoff', 'Quantum']) {
  test('refuel records ' + fuel + ' and the active ship', async () => {
    const f = fixture(); await f.open('refuel');
    f.quick.endingBalanceAuec.value = '9500'; await f.quick.fire('submit');
    assert.equal(f.persisted(), 0, 'fuel selection is required');
    f.quick.fuelType.value = fuel; await f.quick.fire('submit');
    const entry = f.state.ledgerEntries[0];
    assert.equal(entry.flow, 'expense'); assert.equal(entry.scope, 'service');
    assert.equal(entry.category, fuel); assert.equal(entry.amountAuec, 500);
    assert.equal(entry.fleetEntryId, 'ship-1'); assert.equal(entry.shipId, 'profile-1');
  });
}

test('refuel works without a fleet and cancellation leaves the main draft intact', async () => {
  const f = fixture(); f.state.fleet = [];
  f.main.amountAuec.value = '123'; f.main.notes.value = 'Keep draft';
  await f.open('food'); await f.node('financeQuickExpenseCancel').fire('click');
  assert.equal(f.state.ledgerEntries.length, 1); assert.equal(f.main.amountAuec.value, '123');
  await f.open('refuel'); f.quick.fuelType.value = 'Quantum';
  f.quick.endingBalanceAuec.value = '9750'; await f.quick.fire('submit');
  assert.equal(f.state.ledgerEntries[0].fleetEntryId, '');
  assert.equal(f.main.notes.value, 'Keep draft');
});

test('invalid balances can be corrected and zero ending balance is valid', async () => {
  const f = fixture(); await f.open('food');
  for (const value of ['', '10000', '10001', 'invalid']) {
    f.quick.endingBalanceAuec.value = value; await f.quick.fire('submit');
    assert.equal(f.persisted(), 0);
  }
  f.quick.endingBalanceAuec.value = '0'; await f.quick.endingBalanceAuec.fire('input');
  assert.equal(f.quick.endingBalanceAuec.validationMessage, '');
  await f.quick.fire('submit'); assert.equal(f.state.ledgerEntries[0].amountAuec, 10000);
});

test('direct amounts and the existing ship cost dialog still work after a preset', async () => {
  const f = fixture(); await f.open('food');
  f.quickMode.radios.forEach(input => { input.checked = input.value === 'amount'; });
  await f.quickMode.radios[0].fire('change');
  f.quick.amountAuec.value = '25'; await f.quick.fire('submit');
  assert.equal(f.state.ledgerEntries[0].amountAuec, 25);
  f.controller.openQuickShipExpense('ship-1', 'Reparatur');
  assert.ok(f.details.every(node => !node.hidden));
  assert.equal(f.quickMode.value, 'amount'); assert.equal(f.quick.fuelType.disabled, true);
  f.quick.amountAuec.value = '100'; await f.quick.fire('submit');
  assert.equal(f.state.ledgerEntries[0].category, 'Reparatur');
  assert.equal(f.state.ledgerEntries[0].fleetEntryId, 'ship-1');
});
