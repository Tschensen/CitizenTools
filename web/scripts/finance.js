(function registerFinanceModule() {
  const LEDGER_SCOPE_LABELS = {
    mission: "Aufträge",
    cargo: "Cargo",
    ship: "Schiff",
    service: "Service",
    other: "Sonstiges",
  };

  const LEDGER_FLOW_LABELS = {
    income: "Einnahme",
    expense: "Ausgabe",
  };

  const LEDGER_CATEGORY_OPTIONS = {
    mission: ["Auftragserlös"],
    cargo: ["Warenverkauf", "Warenankauf", "Cargo-Gebühr", "Cargo-Sonstiges"],
    ship: ["Schiffskauf", "Schiffsverkauf", "Upgrade", "Leihgebühr", "Schiff-Sonstiges"],
    service: ["Reparatur", "Betankung", "Treibstoffankauf", "Versicherung", "Claim", "Hangargebühr", "Service-Sonstiges"],
    other: ["Anfangsbestand", "Transfer", "Geschenk", "Rückerstattung", "Steuer / Gebühr", "Sonstiges"],
  };

  const LEDGER_CATEGORY_LABEL_KEYS = {
    "Auftragserlös": "finance.category.missionPayout",
    Warenverkauf: "finance.category.goodsSale",
    Warenankauf: "finance.category.goodsPurchase",
    "Cargo-Gebühr": "finance.category.cargoFee",
    "Cargo-Sonstiges": "finance.category.cargoOther",
    Schiffskauf: "finance.category.shipPurchase",
    Schiffsverkauf: "finance.category.shipSale",
    Upgrade: "finance.category.upgrade",
    Leihgebühr: "finance.category.rental",
    "Schiff-Sonstiges": "finance.category.shipOther",
    Reparatur: "finance.category.repair",
    Betankung: "finance.category.refuel",
    Treibstoffankauf: "finance.category.fuelPurchase",
    Quantum: "finance.category.quantum",
    Versicherung: "finance.category.insurance",
    Claim: "finance.category.claim",
    Hangargebühr: "finance.category.hangarFee",
    "Service-Sonstiges": "finance.category.serviceOther",
    Anfangsbestand: "finance.category.openingBalance",
    Transfer: "finance.category.transfer",
    Geschenk: "finance.category.gift",
    Rückerstattung: "finance.category.refund",
    "Steuer / Gebühr": "finance.category.taxFee",
    Sonstiges: "finance.category.other",
  };

  const FINANCE_VIEW_LABELS = {
    entry: "Neue Buchung erfassen",
    statement: "Kontoauszug",
    pnl: "GuV-Rechnung",
    assets: "Vermögen",
  };

  const PNL_PERIOD_LABELS = {
    day: "Tag",
    week: "Woche",
    month: "Monat",
    year: "Jahr",
  };
  const STATEMENT_PERIODS = new Set(["all", ...Object.keys(PNL_PERIOD_LABELS)]);

  function normalizeFinancePeriod(value, { allowAll = true } = {}) {
    const normalized = String(value || "").trim();
    if (allowAll && STATEMENT_PERIODS.has(normalized)) return normalized;
    if (!allowAll && PNL_PERIOD_LABELS[normalized]) return normalized;
    return allowAll ? "all" : "month";
  }

  function parseFinanceDateInput(value) {
    const normalized = /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim())
      ? String(value).trim()
      : new Date().toISOString().slice(0, 10);
    const [year, month, day] = normalized.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function formatFinanceDateInput(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addFinanceDays(date, amount) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + amount);
    return nextDate;
  }

  function getFinancePeriodRange(period, anchorInput, { allowAll = true } = {}) {
    const type = normalizeFinancePeriod(period, { allowAll });
    if (type === "all") {
      return { type, start: null, end: null, startInput: "", endInput: "" };
    }

    const anchor = parseFinanceDateInput(anchorInput);
    let start = new Date(anchor);
    let end = new Date(anchor);

    if (type === "week") {
      const mondayOffset = (anchor.getDay() + 6) % 7;
      start = addFinanceDays(anchor, -mondayOffset);
      end = addFinanceDays(start, 6);
    } else if (type === "month") {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12, 0, 0, 0);
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12, 0, 0, 0);
    } else if (type === "year") {
      start = new Date(anchor.getFullYear(), 0, 1, 12, 0, 0, 0);
      end = new Date(anchor.getFullYear(), 11, 31, 12, 0, 0, 0);
    }

    return {
      type,
      start,
      end,
      startInput: formatFinanceDateInput(start),
      endInput: formatFinanceDateInput(end),
    };
  }

  const OPENING_BALANCE_CATEGORIES = new Set(["Anfangsbestand", "Opening balance"]);
  const MISSION_PAYOUT_CATEGORIES = new Set(["Auftragserlös", "Mission payout"]);
  const DEFAULT_EXPENSE_CATEGORIES = new Set([
    "Warenankauf",
    "Cargo-Gebühr",
    "Cargo-Sonstiges",
    "Schiffskauf",
    "Upgrade",
    "Leihgebühr",
    "Schiff-Sonstiges",
    "Reparatur",
    "Betankung",
    "Treibstoffankauf",
    "Versicherung",
    "Claim",
    "Hangargebühr",
    "Service-Sonstiges",
    "Steuer / Gebühr",
  ]);
  const SHIP_WORKFLOW_STATUS = {
    sale: "sold",
    upgrade: "melted",
  };

  function getShipWorkflowType(entry) {
    const explicitType = String(entry?.shipWorkflowType || "").trim();
    if (["purchase", "sale", "upgrade"].includes(explicitType)) return explicitType;
    if (entry?.scope !== "ship") return "";
    if (entry.category === "Schiffskauf") return "purchase";
    if (entry.category === "Schiffsverkauf") return "sale";
    if (entry.category === "Upgrade") return "upgrade";
    return "";
  }

  function getShipWorkflowSourceFleetEntryId(entry) {
    return String(entry?.sourceFleetEntryId || (["sale", "upgrade"].includes(getShipWorkflowType(entry)) ? entry?.fleetEntryId : "") || "").trim();
  }

  function getShipWorkflowTargetFleetEntryId(entry) {
    return String(entry?.targetFleetEntryId || (getShipWorkflowType(entry) === "purchase" ? entry?.fleetEntryId : "") || "").trim();
  }

  function isFleetEntryUsedOutsideWorkflow(state, fleetEntryId, ignoredLedgerEntryId = "") {
    const normalizedId = String(fleetEntryId || "").trim();
    if (!normalizedId) return false;
    const usedByMission = (state?.missions || []).some((mission) => String(mission?.assignedFleetEntryId || "").trim() === normalizedId);
    if (usedByMission) return true;
    return (state?.ledgerEntries || []).some((entry) => (
      entry?.id !== ignoredLedgerEntryId
      && [
        entry?.fleetEntryId,
        entry?.sourceFleetEntryId,
        entry?.targetFleetEntryId,
      ].some((candidate) => String(candidate || "").trim() === normalizedId)
    ));
  }

  function reverseShipWorkflow(state, entry, { today = new Date().toISOString().slice(0, 10) } = {}) {
    const workflowType = getShipWorkflowType(entry);
    if (!["sale", "upgrade"].includes(workflowType)) {
      return { restoredSourceId: "", removedTargetId: "", archivedTargetId: "" };
    }

    const sourceId = getShipWorkflowSourceFleetEntryId(entry);
    const source = (state?.fleet || []).find((candidate) => candidate.id === sourceId) || null;
    const expectedStatus = SHIP_WORKFLOW_STATUS[workflowType];
    if (source && source.status === expectedStatus) {
      source.status = String(entry?.sourcePreviousStatus || "active").trim() || "active";
      source.endedOn = source.status === "active" ? "" : String(entry?.sourcePreviousEndedOn || "").trim();
      if (entry?.sourceWasActive && !state.activeFleetEntryId && source.status === "active") {
        state.activeFleetEntryId = source.id;
      }
    }

    let removedTargetId = "";
    let archivedTargetId = "";
    if (workflowType === "upgrade") {
      const targetId = getShipWorkflowTargetFleetEntryId(entry);
      const target = (state?.fleet || []).find((candidate) => candidate.id === targetId) || null;
      if (target) {
        if (isFleetEntryUsedOutsideWorkflow(state, target.id, entry?.id)) {
          target.status = target.status === "active" ? "inactive" : target.status;
          target.endedOn = target.endedOn || today;
          archivedTargetId = target.id;
        } else {
          state.fleet = state.fleet.filter((candidate) => candidate.id !== target.id);
          removedTargetId = target.id;
        }
        if (state.activeFleetEntryId === target.id) {
          state.activeFleetEntryId = source?.status === "active" ? source.id : "";
        }
      }
    }

    return { restoredSourceId: source?.id || "", removedTargetId, archivedTargetId };
  }

  function formatAuec(value, { signed = false, language = "de" } = {}) {
    const numericValue = Math.round(Number(value) || 0);
    const locale = language === "en" ? "en-US" : "de-DE";
    const absoluteLabel = Math.abs(numericValue).toLocaleString(locale);
    if (!signed) {
      return `${absoluteLabel} aUEC`;
    }
    if (numericValue > 0) {
      return `+${absoluteLabel} aUEC`;
    }
    if (numericValue < 0) {
      return `-${absoluteLabel} aUEC`;
    }
    return "0 aUEC";
  }

  function calculateExpenseAmountFromEndingBalance(openingBalance, endingBalance) {
    const before = Math.round(Number(openingBalance));
    const rawEndingBalance = String(endingBalance ?? "").trim();
    const after = rawEndingBalance ? Math.round(Number(rawEndingBalance)) : null;
    if (!Number.isFinite(before) || after === null || !Number.isFinite(after)) {
      return { openingBalance: before, endingBalance: after, amountAuec: 0, valid: false };
    }
    const amountAuec = Math.max(0, before - after);
    return { openingBalance: before, endingBalance: after, amountAuec, valid: amountAuec > 0 };
  }

  function createLedgerEntry({
    id = (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `ledger-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`),
    bookedOn,
    scope = "mission",
    flow = "income",
    category = "",
    amountAuec = 0,
    reference = "",
    shipId = "",
    missionId = "",
    purchaseShipProfileId = "",
    purchaseRegistration = "",
    fleetEntryId = "",
    shipWorkflowType = "",
    sourceFleetEntryId = "",
    targetFleetEntryId = "",
    targetShipProfileId = "",
    targetRegistration = "",
    sourcePreviousStatus = "",
    sourcePreviousEndedOn = "",
    sourceWasActive = false,
    notes = "",
    createdAt = new Date().toISOString(),
  }) {
    const normalizedBookedOn = /^\d{4}-\d{2}-\d{2}$/.test(String(bookedOn || "").trim())
      ? String(bookedOn).trim()
      : new Date().toISOString().slice(0, 10);
    const normalizedFlow = flow === "expense" ? "expense" : "income";
    const normalizedMissionId = String(missionId || "").trim();
    const normalizedCategory = String(category || "").trim();
    const isMissionIncome = normalizedFlow === "income"
      && (normalizedMissionId || MISSION_PAYOUT_CATEGORIES.has(normalizedCategory));
    const explicitWorkflowType = String(shipWorkflowType || "").trim();
    const normalizedWorkflowType = ["purchase", "sale", "upgrade"].includes(explicitWorkflowType)
      ? explicitWorkflowType
      : scope === "ship" && normalizedCategory === "Schiffskauf"
        ? "purchase"
        : "";
    const normalizedFleetEntryId = String(fleetEntryId || "").trim();
    const normalizedPurchaseProfileId = String(purchaseShipProfileId || "").trim();
    const normalizedPurchaseRegistration = String(purchaseRegistration || "").trim();
    return {
      id,
      bookedOn: normalizedBookedOn,
      scope: isMissionIncome ? "mission" : LEDGER_SCOPE_LABELS[scope] ? scope : "other",
      flow: normalizedFlow,
      category: isMissionIncome ? "Auftragserlös" : normalizedCategory,
      amountAuec: Math.max(0, Math.round(Number(amountAuec) || 0)),
      reference: String(reference || "").trim(),
      shipId: String(shipId || "").trim(),
      missionId: normalizedMissionId,
      purchaseShipProfileId: normalizedPurchaseProfileId,
      purchaseRegistration: normalizedPurchaseRegistration,
      fleetEntryId: normalizedFleetEntryId,
      shipWorkflowType: normalizedWorkflowType,
      sourceFleetEntryId: String(sourceFleetEntryId || (["sale", "upgrade"].includes(normalizedWorkflowType) ? normalizedFleetEntryId : "") || "").trim(),
      targetFleetEntryId: String(targetFleetEntryId || (normalizedWorkflowType === "purchase" ? normalizedFleetEntryId : "") || "").trim(),
      targetShipProfileId: String(targetShipProfileId || normalizedPurchaseProfileId || "").trim(),
      targetRegistration: String(targetRegistration || normalizedPurchaseRegistration || "").trim(),
      sourcePreviousStatus: String(sourcePreviousStatus || "").trim(),
      sourcePreviousEndedOn: String(sourcePreviousEndedOn || "").trim(),
      sourceWasActive: Boolean(sourceWasActive),
      notes: String(notes || "").trim(),
      createdAt,
    };
  }

  function calculateOpenReceivables({ missions = [], ledgerEntries = [] } = {}) {
    const incomeMissionIds = new Set(
      (Array.isArray(ledgerEntries) ? ledgerEntries : [])
        .filter((entry) => entry?.flow === "income" && (Number(entry.amountAuec) || 0) > 0 && entry.missionId)
        .map((entry) => String(entry.missionId)),
    );

    const rows = (Array.isArray(missions) ? missions : [])
      .filter((mission) => {
        const status = String(mission?.status || "active").trim().toLowerCase();
        const payout = Math.max(0, Math.round(Number(mission?.payout) || 0));
        const isCompleted = status === "completed" || status === "paid" || Boolean(mission?.completedAt);
        const isPaid = status === "paid" || Boolean(mission?.paidAt) || incomeMissionIds.has(String(mission?.id || ""));
        return payout > 0 && isCompleted && !isPaid && status !== "cancelled";
      })
      .map((mission) => ({
        id: String(mission.id || ""),
        title: String(mission.title || "").trim(),
        customer: String(mission?.serviceDetails?.customer || mission?.customer || "").trim(),
        completedAt: String(mission.completedAt || ""),
        amountAuec: Math.max(0, Math.round(Number(mission.payout) || 0)),
      }))
      .sort((left, right) => {
        const leftTime = new Date(left.completedAt || 0).getTime();
        const rightTime = new Date(right.completedAt || 0).getTime();
        return leftTime - rightTime || left.title.localeCompare(right.title, "de", { numeric: true });
      });

    return {
      count: rows.length,
      totalAuec: rows.reduce((sum, row) => sum + row.amountAuec, 0),
      rows,
    };
  }

  function createFinanceController({
    getState,
    helpers,
  }) {
    const dom = {
      financeSummary: document.querySelector("#financeSummary"),
      financeForm: document.querySelector("#financeForm"),
      financeFormTitle: document.querySelector("#financeFormTitle"),
      financeViewTabs: Array.from(document.querySelectorAll("[data-finance-view-target]")),
      financeViewSections: Array.from(document.querySelectorAll("[data-finance-view]")),
      financeScopeSelect: document.querySelector("#financeScopeSelect"),
      financeCategorySelect: document.querySelector("#financeCategorySelect"),
      financeAmountField: document.querySelector("#financeAmountField"),
      financeAmountInput: document.querySelector("#financeAmountInput"),
      financeEndingBalanceField: document.querySelector("#financeEndingBalanceField"),
      financeEndingBalanceInput: document.querySelector("#financeEndingBalanceInput"),
      financeBalanceCalculation: document.querySelector("#financeBalanceCalculation"),
      financeAmountModeInputs: Array.from(document.querySelectorAll('[name="amountInputMode"]')),
      financeFlowSelect: document.querySelector('#financeForm [name="flow"]'),
      financeShipField: document.querySelector("#financeShipField"),
      financeShipFieldLabel: document.querySelector("#financeShipFieldLabel"),
      financeShipSelect: document.querySelector("#financeShipSelect"),
      financeMissionField: document.querySelector("#financeMissionField"),
      financeMissionSelect: document.querySelector("#financeMissionSelect"),
      financeShipWorkflowFields: document.querySelector("#financeShipWorkflowFields"),
      financeShipWorkflowProfileLabel: document.querySelector("#financeShipWorkflowProfileLabel"),
      financeShipWorkflowProfileSelect: document.querySelector("#financeShipWorkflowProfileSelect"),
      financeShipWorkflowRegistrationLabel: document.querySelector("#financeShipWorkflowRegistrationLabel"),
      financeShipWorkflowRegistrationInput: document.querySelector("#financeShipWorkflowRegistrationInput"),
      financeReferenceInput: document.querySelector("#financeReferenceInput"),
      financeReferenceSuggestions: document.querySelector("#financeReferenceSuggestions"),
      financeHint: document.querySelector("#financeHint"),
      financeSubmitButton: document.querySelector("#financeSubmitButton"),
      financeCancelButton: document.querySelector("#financeCancelButton"),
      financeFlowFilter: document.querySelector("#financeFlowFilter"),
      financeScopeFilter: document.querySelector("#financeScopeFilter"),
      financeSearchInput: document.querySelector("#financeSearchInput"),
      financeStatementPeriodType: document.querySelector("#financeStatementPeriodType"),
      financeStatementPeriodMeta: document.querySelector("#financeStatementPeriodMeta"),
      financeEmpty: document.querySelector("#financeEmpty"),
      financeList: document.querySelector("#financeList"),
      financePnlPeriodType: document.querySelector("#financePnlPeriodType"),
      financePnlAnchorDate: document.querySelector("#financePnlAnchorDate"),
      financePnlTodayButton: document.querySelector("#financePnlTodayButton"),
      financePnlSummary: document.querySelector("#financePnlSummary"),
      financePnlTable: document.querySelector("#financePnlTable"),
      financeAssetsSummary: document.querySelector("#financeAssetsSummary"),
      financeAssetsTable: document.querySelector("#financeAssetsTable"),
      financeQuickExpenseDialog: document.querySelector("#financeQuickExpenseDialog"),
      financeQuickExpenseForm: document.querySelector("#financeQuickExpenseForm"),
      financeQuickExpenseShip: document.querySelector("#financeQuickExpenseShip"),
      financeQuickExpenseDate: document.querySelector("#financeQuickExpenseDate"),
      financeQuickExpenseCategory: document.querySelector("#financeQuickExpenseCategory"),
      financeQuickExpenseAmountField: document.querySelector("#financeQuickExpenseAmountField"),
      financeQuickExpenseAmount: document.querySelector("#financeQuickExpenseAmount"),
      financeQuickExpenseEndingBalanceField: document.querySelector("#financeQuickExpenseEndingBalanceField"),
      financeQuickExpenseEndingBalance: document.querySelector("#financeQuickExpenseEndingBalance"),
      financeQuickExpenseAmountModes: Array.from(document.querySelectorAll('[name="quickExpenseAmountMode"]')),
      financeQuickExpenseReference: document.querySelector("#financeQuickExpenseReference"),
      financeQuickExpenseNotes: document.querySelector("#financeQuickExpenseNotes"),
      financeQuickExpenseBalanceCalculation: document.querySelector("#financeQuickExpenseBalanceCalculation"),
      financeQuickExpenseCancel: document.querySelector("#financeQuickExpenseCancel"),
    };

    let activeFinanceView = "statement";
    let quickExpenseFleetEntryId = "";

    const translate = (key, params = {}) => (typeof helpers.t === "function" ? helpers.t(key, params) : String(key || ""));
    const currentLanguage = () => (typeof helpers.currentUiLanguage === "function" ? helpers.currentUiLanguage() : "de");
    const formatCurrency = (value, options = {}) => formatAuec(value, { ...options, language: currentLanguage() });
    const getScopeLabel = (scope) => translate(`finance.scope.${LEDGER_SCOPE_LABELS[scope] ? scope : "other"}`);
    const getFlowLabel = (flow) => translate(`finance.flow.${flow === "expense" ? "expense" : "income"}`);
    const getPeriodLabel = (period) => translate(`finance.period.${PNL_PERIOD_LABELS[period] ? period : "month"}`);
    const getCategoryLabel = (category) => translate(LEDGER_CATEGORY_LABEL_KEYS[category] || "common.booking");
    const statementPeriodStorageKey = String(helpers.financeStatementPeriodStorageKey || "citizen-tools:finance-statement-period");

    function loadStatementPeriod() {
      try {
        return normalizeFinancePeriod(globalThis.localStorage?.getItem(statementPeriodStorageKey));
      } catch (error) {
        return "all";
      }
    }

    function saveStatementPeriod(value) {
      const period = normalizeFinancePeriod(value);
      try {
        globalThis.localStorage?.setItem(statementPeriodStorageKey, period);
      } catch (error) {
        // The filter remains usable when browser storage is unavailable.
      }
      return period;
    }

    function isOpeningBalanceEntry(entry) {
      return entry?.scope === "other" && OPENING_BALANCE_CATEGORIES.has(String(entry.category || "").trim());
    }

    function getEntryFlowLabel(entry) {
      return isOpeningBalanceEntry(entry) ? translate("finance.flow.openingBalance") : getFlowLabel(entry.flow);
    }

    function setFinanceView(view) {
      activeFinanceView = FINANCE_VIEW_LABELS[view] ? view : "statement";
      syncFinanceViewState();
    }

    function syncFinanceViewState() {
      const isEditing = Boolean(dom.financeForm?.entryId?.value);
      dom.financeViewTabs.forEach((button) => {
        const target = button.dataset.financeViewTarget || "statement";
        const isActive = target === activeFinanceView;
        if (target === "entry") {
          button.textContent = isEditing ? translate("finance.tabs.edit") : translate("finance.tabs.entry");
        } else if (target === "statement") {
          button.textContent = translate("finance.tabs.statement");
        } else if (target === "pnl") {
          button.textContent = translate("finance.tabs.pnl");
        } else if (target === "assets") {
          button.textContent = translate("finance.tabs.assets");
        }
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });
      dom.financeViewSections.forEach((section) => {
        section.hidden = section.dataset.financeView !== activeFinanceView;
      });
      if (dom.financeFormTitle) {
        dom.financeFormTitle.textContent = isEditing ? translate("finance.form.title.edit") : translate("finance.form.title.entry");
      }
    }

    function getLedgerEntries() {
      return [...(getState().ledgerEntries || [])].sort((left, right) => {
        const dateCompare = helpers.compareDateInputs(right.bookedOn, left.bookedOn);
        if (dateCompare !== 0) return dateCompare;
        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      });
    }

    function findMissionById(missionId) {
      return getState().missions.find((entry) => entry.id === missionId) || null;
    }

    function findFleetEntryById(fleetEntryId) {
      return helpers.getFleetEntries().find((entry) => entry.id === fleetEntryId) || null;
    }

    function getFleetEntryLabel(entry, { includeStatus = false } = {}) {
      if (!entry) return "";
      const shipName = `${entry.manufacturer || ""} ${entry.model || ""}`.trim();
      const registration = String(entry.registration || "").trim() || translate("finance.ships.noRegistration");
      const status = includeStatus && entry.status !== "active"
        ? translate(`fleet.status.${entry.status}`)
        : "";
      return [shipName, registration, status].filter(Boolean).join(" · ");
    }

    function getFleetShipOptions(preferred = "") {
      const fleetEntries = helpers.getFleetEntries().filter((entry) => entry.shipId);
      const preferredEntry = fleetEntries.find((entry) => entry.id === preferred)
        || (fleetEntries.filter((entry) => entry.shipId === preferred).length === 1
          ? fleetEntries.find((entry) => entry.shipId === preferred)
          : null);
      return fleetEntries
        .filter((entry) => entry.status === "active" || entry.id === preferredEntry?.id)
        .map((entry) => ({
          id: entry.id,
          shipId: entry.shipId,
          status: entry.status,
          label: getFleetEntryLabel(entry, { includeStatus: true }),
        }))
        .sort((left, right) => {
          const statusCompare = Number(right.status === "active") - Number(left.status === "active");
          if (statusCompare !== 0) return statusCompare;
          return left.label.localeCompare(right.label, "de", { numeric: true });
        });
    }

    function resolveLedgerFleetEntry(entry) {
      const explicitEntry = findFleetEntryById(entry?.fleetEntryId);
      if (explicitEntry) return explicitEntry;

      const mission = findMissionById(entry?.missionId);
      const missionEntry = findFleetEntryById(mission?.assignedFleetEntryId);
      if (missionEntry) return missionEntry;

      const shipId = String(entry?.shipId || "").trim();
      if (!shipId) return null;
      const matchingEntries = helpers.getFleetEntries().filter((candidate) => candidate.shipId === shipId);
      return matchingEntries.length === 1 ? matchingEntries[0] : null;
    }

    function renderCategoryOptions(preferred = dom.financeCategorySelect?.value || "") {
      if (!dom.financeCategorySelect || !dom.financeScopeSelect) return;
      const scope = LEDGER_SCOPE_LABELS[dom.financeScopeSelect.value] ? dom.financeScopeSelect.value : "mission";
      const categories = LEDGER_CATEGORY_OPTIONS[scope] || [];
      const nextValue = categories.includes(preferred) ? preferred : categories[0] || "";
      dom.financeCategorySelect.innerHTML = categories
        .map((category) => `<option value="${helpers.escapeHtml(category)}">${helpers.escapeHtml(getCategoryLabel(category))}</option>`)
        .join("");
      dom.financeCategorySelect.value = nextValue;
    }

    function applyDefaultFlowForCategory() {
      if (!dom.financeForm || dom.financeForm.entryId?.value) return;
      const category = String(dom.financeCategorySelect?.value || "").trim();
      dom.financeForm.flow.value = DEFAULT_EXPENSE_CATEGORIES.has(category) ? "expense" : "income";
    }

    function renderShipOptions(preferred = dom.financeShipSelect?.value || "") {
      if (!dom.financeShipSelect) return;
      const fleetShipOptions = getFleetShipOptions(preferred);
      const preferredOption = fleetShipOptions.find((entry) => entry.id === preferred)
        || (fleetShipOptions.filter((entry) => entry.shipId === preferred).length === 1
          ? fleetShipOptions.find((entry) => entry.shipId === preferred)
          : null);
      dom.financeShipSelect.innerHTML = [
        `<option value="">${helpers.escapeHtml(translate("finance.form.noShip"))}</option>`,
        ...fleetShipOptions.map(
          (entry) => `<option value="${helpers.escapeHtml(entry.id)}">${helpers.escapeHtml(entry.label)}</option>`,
        ),
      ].join("");
      dom.financeShipSelect.value = preferredOption?.id || "";
    }

    function renderWorkflowShipProfileOptions(preferred = dom.financeShipWorkflowProfileSelect?.value || "") {
      if (!dom.financeShipWorkflowProfileSelect) return;
      const shipProfiles = helpers.getShipLibraryEntries();
      dom.financeShipWorkflowProfileSelect.innerHTML = [
        `<option value="">${helpers.escapeHtml(translate("finance.form.chooseProfile"))}</option>`,
        ...shipProfiles.map(
          (entry) => `<option value="${helpers.escapeHtml(entry.id)}">${helpers.escapeHtml(helpers.formatShipEntryFullName(entry))}</option>`,
        ),
      ].join("");
      dom.financeShipWorkflowProfileSelect.value = preferred && shipProfiles.some((entry) => entry.id === preferred) ? preferred : "";
    }

    function renderMissionOptions(preferred = dom.financeMissionSelect?.value || "") {
      if (!dom.financeMissionSelect) return;
      dom.financeMissionSelect.innerHTML = [
        `<option value="">${helpers.escapeHtml(translate("finance.form.noMission"))}</option>`,
        ...getState().missions.map(
          (mission) => `<option value="${helpers.escapeHtml(mission.id)}">${helpers.escapeHtml(mission.title)}</option>`,
        ),
      ].join("");
      dom.financeMissionSelect.value = preferred && findMissionById(preferred) ? preferred : "";
    }

    function renderReferenceSuggestions() {
      if (!dom.financeReferenceSuggestions) return;
      const values = new Set();
      getState().missions.forEach((mission) => {
        if (mission.title) values.add(mission.title);
      });
      helpers.getShipLibraryEntries().forEach((entry) => {
        values.add(helpers.formatShipEntryFullName(entry));
      });
      helpers.getFleetEntries().forEach((entry) => {
        if (entry.registration) values.add(entry.registration);
      });
      getLedgerEntries().forEach((entry) => {
        if (entry.reference) values.add(entry.reference);
      });
      dom.financeReferenceSuggestions.innerHTML = [...values]
        .sort((left, right) => left.localeCompare(right, "de"))
        .map((value) => `<option value="${helpers.escapeHtml(value)}"></option>`)
        .join("");
    }

    function isShipPurchaseDraft(draft) {
      return getShipWorkflowType(draft) === "purchase";
    }

    function getLinkedPurchaseFleetEntry(entry) {
      if (!entry || !isShipPurchaseDraft(entry)) return null;
      return findFleetEntryById(getShipWorkflowTargetFleetEntryId(entry));
    }

    async function chooseLinkedPurchaseFleetDisposition(entry) {
      const fleetEntry = getLinkedPurchaseFleetEntry(entry);
      if (!fleetEntry || fleetEntry.status !== "active") return;
      const shipLabel = getFleetEntryLabel(fleetEntry);
      const shouldArchive = await helpers.showConfirmDialog({
        kicker: translate("finance.dialog.kicker"),
        title: translate("finance.purchaseLink.choiceTitle"),
        message: translate("finance.purchaseLink.choiceMessage", { ship: shipLabel }),
        confirmLabel: translate("finance.purchaseLink.archive"),
        cancelLabel: translate("finance.purchaseLink.keep"),
      });
      if (!shouldArchive) return;

      fleetEntry.status = "inactive";
      fleetEntry.endedOn = fleetEntry.endedOn || helpers.formatDateForInput(new Date());
      if (getState().activeFleetEntryId === fleetEntry.id) {
        getState().activeFleetEntryId = "";
      }
    }

    function getLinkedWorkflowSourceFleetEntry(entry) {
      return findFleetEntryById(getShipWorkflowSourceFleetEntryId(entry));
    }

    function getLinkedWorkflowTargetFleetEntry(entry) {
      return findFleetEntryById(getShipWorkflowTargetFleetEntryId(entry));
    }

    function isSameWorkflowSource(existingEntry, workflowType, sourceFleetEntryId) {
      return String(existingEntry?.shipWorkflowType || "").trim() === workflowType
        && getShipWorkflowSourceFleetEntryId(existingEntry) === String(sourceFleetEntryId || "").trim();
    }

    function didWorkflowIdentityChange(existingEntry, draft) {
      const previousType = getShipWorkflowType(existingEntry);
      if (!previousType) return false;
      if (!["purchase", "sale", "upgrade"].includes(String(existingEntry?.shipWorkflowType || "").trim())) return false;
      const nextType = getShipWorkflowType(draft);
      if (previousType !== nextType) return true;
      if (["sale", "upgrade"].includes(previousType)) {
        return getShipWorkflowSourceFleetEntryId(existingEntry) !== String(draft.fleetEntryId || "").trim();
      }
      return false;
    }

    async function reverseLinkedWorkflow(entry) {
      const workflowType = getShipWorkflowType(entry);
      if (workflowType === "purchase") {
        await chooseLinkedPurchaseFleetDisposition(entry);
        return;
      }
      if (!["sale", "upgrade"].includes(String(entry?.shipWorkflowType || "").trim())) return;
      reverseShipWorkflow(getState(), entry, { today: helpers.formatDateForInput(new Date()) });
    }

    function applySaleWorkflow(draft, existingEntry) {
      const source = findFleetEntryById(draft.fleetEntryId);
      const sameSource = isSameWorkflowSource(existingEntry, "sale", source?.id);
      const sourceWasActive = sameSource ? Boolean(existingEntry.sourceWasActive) : getState().activeFleetEntryId === source.id;
      const sourcePreviousStatus = sameSource ? existingEntry.sourcePreviousStatus : source.status;
      const sourcePreviousEndedOn = sameSource ? existingEntry.sourcePreviousEndedOn : source.endedOn;

      source.status = "sold";
      source.endedOn = draft.bookedOn;
      if (getState().activeFleetEntryId === source.id) {
        getState().activeFleetEntryId = "";
      }

      return {
        shipWorkflowType: "sale",
        sourceFleetEntryId: source.id,
        targetFleetEntryId: "",
        sourcePreviousStatus,
        sourcePreviousEndedOn,
        sourceWasActive,
        fleetEntryId: source.id,
        shipId: source.shipId,
      };
    }

    function applyUpgradeWorkflow(draft, existingEntry, targetProfile) {
      const source = findFleetEntryById(draft.fleetEntryId);
      const sameSource = isSameWorkflowSource(existingEntry, "upgrade", source?.id);
      const sourceWasActive = sameSource ? Boolean(existingEntry.sourceWasActive) : getState().activeFleetEntryId === source.id;
      const sourcePreviousStatus = sameSource ? existingEntry.sourcePreviousStatus : source.status;
      const sourcePreviousEndedOn = sameSource ? existingEntry.sourcePreviousEndedOn : source.endedOn;
      const existingTargetId = sameSource ? getShipWorkflowTargetFleetEntryId(existingEntry) : "";
      const existingTargetIndex = existingTargetId
        ? getState().fleet.findIndex((entry) => entry.id === existingTargetId)
        : -1;
      const existingTarget = existingTargetIndex >= 0 ? getState().fleet[existingTargetIndex] : null;
      const keepsTargetProfile = existingTarget?.shipId === targetProfile.id;
      const target = helpers.createFleetEntry({
        id: existingTarget?.id || existingTargetId || helpers.createRuntimeId(),
        manufacturer: targetProfile.manufacturer,
        model: helpers.getShipEntryDisplayName(targetProfile),
        registration: draft.targetRegistration,
        imageUrl: keepsTargetProfile ? existingTarget?.imageUrl : "",
        refuelContainerSizeScu: keepsTargetProfile ? existingTarget?.refuelContainerSizeScu : null,
        refuelContainerSizesScu: keepsTargetProfile ? existingTarget?.refuelContainerSizesScu : [],
        acquiredOn: draft.bookedOn,
        endedOn: "",
        status: "active",
        ownerName: source.ownerName,
        pilotId: source.pilotId,
        pilotName: source.pilotName,
        pledgePurchased: source.pledgePurchased,
        notes: existingTarget?.notes || "",
        shipId: targetProfile.id,
        createdAt: existingTarget?.createdAt,
      });

      source.status = "melted";
      source.endedOn = draft.bookedOn;
      if (existingTargetIndex >= 0) {
        getState().fleet.splice(existingTargetIndex, 1, target);
      } else {
        getState().fleet.unshift(target);
      }
      if (sourceWasActive || getState().activeFleetEntryId === source.id) {
        getState().activeFleetEntryId = target.id;
      }

      return {
        shipWorkflowType: "upgrade",
        sourceFleetEntryId: source.id,
        targetFleetEntryId: target.id,
        targetShipProfileId: targetProfile.id,
        targetRegistration: draft.targetRegistration,
        sourcePreviousStatus,
        sourcePreviousEndedOn,
        sourceWasActive,
        fleetEntryId: source.id,
        shipId: source.shipId,
      };
    }

    function getAmountInputMode() {
      return dom.financeForm?.elements?.amountInputMode?.value === "endingBalance" ? "endingBalance" : "amount";
    }

    function getLedgerBalanceExcluding(entryId = "") {
      return (getState().ledgerEntries || [])
        .filter((entry) => entry.id !== entryId)
        .reduce((sum, entry) => sum + (entry.flow === "income" ? 1 : -1) * (Number(entry.amountAuec) || 0), 0);
    }

    function getEndingBalanceCalculation(entryId = "", flow = "income") {
      const rawEndingBalance = String(dom.financeEndingBalanceInput?.value || "").trim();
      const openingBalance = getLedgerBalanceExcluding(entryId);
      if (!rawEndingBalance || !Number.isFinite(Number(rawEndingBalance))) {
        return { openingBalance, endingBalance: null, amountAuec: 0, valid: false };
      }

      const endingBalance = Math.round(Number(rawEndingBalance));
      const amountAuec = flow === "expense"
        ? openingBalance - endingBalance
        : endingBalance - openingBalance;
      return {
        openingBalance,
        endingBalance,
        amountAuec: Math.max(0, amountAuec),
        valid: amountAuec > 0,
      };
    }

    function getEffectiveAmountAuec(entryId = "", flow = "income") {
      if (getAmountInputMode() === "endingBalance") {
        return getEndingBalanceCalculation(entryId, flow).amountAuec;
      }
      return Math.max(0, Math.round(Number(dom.financeAmountInput?.value) || 0));
    }

    function syncAmountInputMode() {
      const useEndingBalance = getAmountInputMode() === "endingBalance";
      if (dom.financeAmountField) dom.financeAmountField.hidden = useEndingBalance;
      if (dom.financeAmountInput) {
        dom.financeAmountInput.disabled = useEndingBalance;
        dom.financeAmountInput.required = !useEndingBalance;
      }
      if (dom.financeEndingBalanceField) dom.financeEndingBalanceField.hidden = !useEndingBalance;
      if (dom.financeEndingBalanceInput) {
        dom.financeEndingBalanceInput.disabled = !useEndingBalance;
        dom.financeEndingBalanceInput.required = useEndingBalance;
        dom.financeEndingBalanceInput.setCustomValidity("");
      }
      if (!dom.financeBalanceCalculation) return;

      dom.financeBalanceCalculation.hidden = !useEndingBalance;
      dom.financeBalanceCalculation.className = "finance-balance-calculation";
      if (!useEndingBalance) {
        dom.financeBalanceCalculation.textContent = "";
        return;
      }

      const entryId = String(dom.financeForm?.entryId?.value || "").trim();
      const flow = dom.financeForm?.flow?.value === "expense" ? "expense" : "income";
      const calculation = getEndingBalanceCalculation(entryId, flow);
      if (calculation.endingBalance === null) {
        dom.financeBalanceCalculation.textContent = translate("finance.balance.current", {
          balance: formatCurrency(calculation.openingBalance),
        });
        return;
      }
      if (calculation.valid) {
        dom.financeBalanceCalculation.classList.add("is-valid");
        dom.financeBalanceCalculation.textContent = translate("finance.balance.calculation", {
          before: formatCurrency(calculation.openingBalance),
          after: formatCurrency(calculation.endingBalance),
          amount: formatCurrency(calculation.amountAuec),
        });
        return;
      }

      dom.financeBalanceCalculation.classList.add("is-warning");
      dom.financeBalanceCalculation.textContent = translate(
        flow === "expense" ? "finance.balance.expenseInvalid" : "finance.balance.incomeInvalid",
        { balance: formatCurrency(calculation.openingBalance) },
      );
    }

    function validateEndingBalanceInput() {
      if (getAmountInputMode() !== "endingBalance" || !dom.financeEndingBalanceInput) return true;
      const entryId = String(dom.financeForm?.entryId?.value || "").trim();
      const flow = dom.financeForm?.flow?.value === "expense" ? "expense" : "income";
      const calculation = getEndingBalanceCalculation(entryId, flow);
      const message = calculation.endingBalance === null
        ? translate("finance.alert.endingBalanceRequired")
        : calculation.valid
          ? ""
          : translate(
              flow === "expense" ? "finance.balance.expenseInvalid" : "finance.balance.incomeInvalid",
              { balance: formatCurrency(calculation.openingBalance) },
            );
      dom.financeEndingBalanceInput.setCustomValidity(message);
      if (message) dom.financeEndingBalanceInput.reportValidity();
      return !message;
    }

    function getQuickExpenseAmountMode() {
      return dom.financeQuickExpenseForm?.elements?.quickExpenseAmountMode?.value === "endingBalance"
        ? "endingBalance"
        : "amount";
    }

    function getQuickExpenseCalculation() {
      const openingBalance = getLedgerBalanceExcluding();
      if (getQuickExpenseAmountMode() !== "endingBalance") {
        return {
          openingBalance,
          endingBalance: null,
          amountAuec: Math.max(0, Math.round(Number(dom.financeQuickExpenseAmount?.value) || 0)),
          valid: true,
        };
      }
      return calculateExpenseAmountFromEndingBalance(openingBalance, dom.financeQuickExpenseEndingBalance?.value);
    }

    function syncQuickExpenseAmountMode() {
      const useEndingBalance = getQuickExpenseAmountMode() === "endingBalance";
      if (dom.financeQuickExpenseAmountField) dom.financeQuickExpenseAmountField.hidden = useEndingBalance;
      if (dom.financeQuickExpenseAmount) {
        dom.financeQuickExpenseAmount.disabled = useEndingBalance;
        dom.financeQuickExpenseAmount.required = !useEndingBalance;
      }
      if (dom.financeQuickExpenseEndingBalanceField) dom.financeQuickExpenseEndingBalanceField.hidden = !useEndingBalance;
      if (dom.financeQuickExpenseEndingBalance) {
        dom.financeQuickExpenseEndingBalance.disabled = !useEndingBalance;
        dom.financeQuickExpenseEndingBalance.required = useEndingBalance;
        dom.financeQuickExpenseEndingBalance.setCustomValidity("");
      }
      syncQuickExpenseCalculation();
    }

    function syncQuickExpenseCalculation() {
      if (!dom.financeQuickExpenseBalanceCalculation) return;
      const useEndingBalance = getQuickExpenseAmountMode() === "endingBalance";
      dom.financeQuickExpenseBalanceCalculation.hidden = !useEndingBalance;
      dom.financeQuickExpenseBalanceCalculation.className = "finance-balance-calculation";
      if (!useEndingBalance) {
        dom.financeQuickExpenseBalanceCalculation.textContent = "";
        return;
      }
      const calculation = getQuickExpenseCalculation();
      if (calculation.endingBalance === null || !Number.isFinite(calculation.endingBalance)) {
        dom.financeQuickExpenseBalanceCalculation.textContent = translate("finance.balance.current", {
          balance: formatCurrency(calculation.openingBalance),
        });
        return;
      }
      if (calculation.valid) {
        dom.financeQuickExpenseBalanceCalculation.classList.add("is-valid");
        dom.financeQuickExpenseBalanceCalculation.textContent = translate("finance.balance.calculation", {
          before: formatCurrency(calculation.openingBalance),
          after: formatCurrency(calculation.endingBalance),
          amount: formatCurrency(calculation.amountAuec),
        });
        return;
      }
      dom.financeQuickExpenseBalanceCalculation.classList.add("is-warning");
      dom.financeQuickExpenseBalanceCalculation.textContent = translate("finance.balance.expenseInvalid", {
        balance: formatCurrency(calculation.openingBalance),
      });
    }

    function closeQuickShipExpense() {
      quickExpenseFleetEntryId = "";
      if (dom.financeQuickExpenseDialog) dom.financeQuickExpenseDialog.hidden = true;
    }

    function openQuickShipExpense(fleetEntryId, category = "Betankung") {
      const fleetEntry = findFleetEntryById(fleetEntryId);
      if (!fleetEntry || !dom.financeQuickExpenseDialog || !dom.financeQuickExpenseForm) {
        openShipExpense(fleetEntryId);
        return;
      }
      quickExpenseFleetEntryId = fleetEntry.id;
      dom.financeQuickExpenseForm.reset();
      if (dom.financeQuickExpenseDate) dom.financeQuickExpenseDate.value = helpers.formatDateForInput(new Date());
      if (dom.financeQuickExpenseCategory) dom.financeQuickExpenseCategory.value = LEDGER_CATEGORY_OPTIONS.service.includes(category) ? category : "Betankung";
      if (dom.financeQuickExpenseShip) dom.financeQuickExpenseShip.textContent = getFleetEntryLabel(fleetEntry);
      syncQuickExpenseAmountMode();
      dom.financeQuickExpenseDialog.hidden = false;
      window.requestAnimationFrame(() => dom.financeQuickExpenseAmount?.focus());
    }

    function submitQuickShipExpense(event) {
      event.preventDefault();
      const fleetEntry = findFleetEntryById(quickExpenseFleetEntryId);
      if (!fleetEntry || !dom.financeQuickExpenseForm) {
        closeQuickShipExpense();
        return;
      }
      const calculation = getQuickExpenseCalculation();
      if (getQuickExpenseAmountMode() === "endingBalance" && !calculation.valid) {
        const message = translate("finance.balance.expenseInvalid", { balance: formatCurrency(calculation.openingBalance) });
        dom.financeQuickExpenseEndingBalance?.setCustomValidity(message);
        dom.financeQuickExpenseEndingBalance?.reportValidity();
        return;
      }
      if (!dom.financeQuickExpenseForm.reportValidity()) return;

      const nextEntry = createLedgerEntry({
        bookedOn: dom.financeQuickExpenseDate?.value,
        scope: "service",
        flow: "expense",
        category: dom.financeQuickExpenseCategory?.value,
        amountAuec: calculation.amountAuec,
        reference: dom.financeQuickExpenseReference?.value,
        fleetEntryId: fleetEntry.id,
        shipId: fleetEntry.shipId,
        notes: dom.financeQuickExpenseNotes?.value,
      });
      getState().ledgerEntries.unshift(nextEntry);
      closeQuickShipExpense();
      helpers.persist();
      helpers.render();
    }

    function readDraft() {
      const formData = new FormData(dom.financeForm);
      const id = String(formData.get("entryId") || "").trim();
      const flow = dom.financeFlowSelect?.value === "expense" ? "expense" : "income";
      return {
        id: id || helpers.createRuntimeId(),
        bookedOn: helpers.normalizeDateInput(formData.get("bookedOn")),
        scope: String(formData.get("scope") || "mission"),
        flow,
        category: String(formData.get("category") || "").trim(),
        amountAuec: getEffectiveAmountAuec(id, flow),
        reference: String(formData.get("reference") || "").trim(),
        fleetEntryId: String(formData.get("fleetEntryId") || "").trim(),
        missionId: String(formData.get("missionId") || "").trim(),
        targetShipProfileId: String(formData.get("targetShipProfileId") || "").trim(),
        targetRegistration: String(formData.get("targetRegistration") || "").trim(),
        notes: String(formData.get("notes") || "").trim(),
      };
    }

    function syncShipWorkflowFields() {
      if (!dom.financeShipWorkflowFields) return;
      const draft = readDraft();
      const workflowType = getShipWorkflowType(draft);
      const hasTargetShip = workflowType === "purchase" || workflowType === "upgrade";
      const hasSourceShip = workflowType === "sale" || workflowType === "upgrade";
      const isLifecycleWorkflow = Boolean(workflowType);

      dom.financeShipWorkflowFields.hidden = !hasTargetShip;
      if (dom.financeShipField) dom.financeShipField.hidden = workflowType === "purchase";
      if (dom.financeMissionField) dom.financeMissionField.hidden = isLifecycleWorkflow;
      if (dom.financeShipFieldLabel) {
        dom.financeShipFieldLabel.textContent = translate(hasSourceShip ? "finance.form.sourceShip" : "finance.form.ship");
      }
      if (dom.financeShipWorkflowProfileLabel) {
        dom.financeShipWorkflowProfileLabel.textContent = translate(
          workflowType === "upgrade" ? "finance.form.upgradeProfile" : "finance.form.purchaseProfile",
        );
      }
      if (dom.financeShipWorkflowRegistrationLabel) {
        dom.financeShipWorkflowRegistrationLabel.textContent = translate(
          workflowType === "upgrade" ? "finance.form.newRegistration" : "finance.form.registration",
        );
      }
      if (dom.financeFlowSelect) {
        if (workflowType === "sale") dom.financeFlowSelect.value = "income";
        if (workflowType === "purchase" || workflowType === "upgrade") dom.financeFlowSelect.value = "expense";
        dom.financeFlowSelect.disabled = isLifecycleWorkflow;
      }
      if (hasTargetShip) {
        renderWorkflowShipProfileOptions(draft.targetShipProfileId);
      }
    }

    function syncHint() {
      if (!dom.financeHint || !dom.financeForm) return;
      const draft = readDraft();
      const workflowType = getShipWorkflowType(draft);
      const fleetEntry = findFleetEntryById(draft.fleetEntryId);
      const targetShip = workflowType === "purchase" || workflowType === "upgrade"
        ? helpers.findShipLibraryEntryById(draft.targetShipProfileId)
        : null;
      const mission = findMissionById(draft.missionId);
      const directionLabel = getFlowLabel(draft.flow);
      const scopeLabel = getScopeLabel(draft.scope);
      const targetHint = targetShip
        ? `${helpers.formatShipEntryFullName(targetShip)}${draft.targetRegistration ? ` · ${draft.targetRegistration}` : ""}`
        : "";
      const contextLabel = workflowType === "upgrade" && fleetEntry
        ? translate("finance.workflow.upgradeHint", {
            source: getFleetEntryLabel(fleetEntry),
            target: targetHint || translate("finance.form.chooseProfile"),
          })
        : targetHint
          || (fleetEntry ? getFleetEntryLabel(fleetEntry) : mission ? mission.title : draft.reference || translate("finance.hint.optionalContext"));

      dom.financeHint.className = "form-hint form-hint-neutral";
      dom.financeHint.innerHTML = `
        <strong>${helpers.escapeHtml(draft.category ? getCategoryLabel(draft.category) : translate("finance.hint.prepare"))}</strong>
        <span>${helpers.escapeHtml(directionLabel)} in ${helpers.escapeHtml(scopeLabel)}${draft.amountAuec ? ` · ${helpers.escapeHtml(formatCurrency(draft.amountAuec))}` : ""}</span>
        <small>${helpers.escapeHtml(contextLabel)}</small>
      `;
    }

    function resetForm() {
      if (!dom.financeForm || !dom.financeScopeSelect) return;
      dom.financeForm.reset();
      dom.financeForm.entryId.value = "";
      dom.financeForm.bookedOn.value = helpers.formatDateForInput(new Date());
      dom.financeForm.scope.value = "mission";
      dom.financeForm.flow.value = "income";
      renderCategoryOptions();
      renderShipOptions();
      renderMissionOptions();
      renderWorkflowShipProfileOptions();
      if (dom.financeShipWorkflowRegistrationInput) {
        dom.financeShipWorkflowRegistrationInput.value = "";
      }
      if (dom.financeReferenceInput) dom.financeReferenceInput.value = "";
      if (dom.financeEndingBalanceInput) dom.financeEndingBalanceInput.value = "";
      if (dom.financeSubmitButton) {
        dom.financeSubmitButton.textContent = translate("finance.form.save");
      }
      if (dom.financeCancelButton) {
        dom.financeCancelButton.hidden = true;
      }
      syncAmountInputMode();
      syncShipWorkflowFields();
      syncHint();
      syncFinanceViewState();
    }

    function openShipExpense(fleetEntryId) {
      const fleetEntry = findFleetEntryById(fleetEntryId);
      if (!fleetEntry || !dom.financeForm || !dom.financeScopeSelect) return;
      resetForm();
      dom.financeForm.scope.value = "service";
      renderCategoryOptions("Reparatur");
      dom.financeForm.flow.value = "expense";
      renderShipOptions(fleetEntry.id);
      renderMissionOptions("");
      syncShipWorkflowFields();
      syncHint();
      setFinanceView("entry");
      helpers.setActivePage("finance");
      window.requestAnimationFrame(() => dom.financeForm?.amountAuec?.focus());
    }

    function populateForm(entry) {
      if (!dom.financeForm || !dom.financeScopeSelect) return;
      dom.financeForm.entryId.value = entry.id;
      dom.financeForm.bookedOn.value = entry.bookedOn;
      dom.financeForm.scope.value = entry.scope;
      renderCategoryOptions(entry.category);
      dom.financeForm.flow.value = entry.flow;
      dom.financeForm.amountAuec.value = entry.amountAuec ? String(entry.amountAuec) : "";
      dom.financeAmountModeInputs.forEach((input) => {
        input.checked = input.value === "amount";
      });
      if (dom.financeEndingBalanceInput) dom.financeEndingBalanceInput.value = "";
      if (dom.financeReferenceInput) dom.financeReferenceInput.value = entry.reference || "";
      renderShipOptions(resolveLedgerFleetEntry(entry)?.id || entry.fleetEntryId || entry.shipId);
      renderMissionOptions(entry.missionId);
      renderWorkflowShipProfileOptions(entry.targetShipProfileId || entry.purchaseShipProfileId || (getShipWorkflowType(entry) === "purchase" ? entry.shipId : ""));
      if (dom.financeShipWorkflowRegistrationInput) {
        dom.financeShipWorkflowRegistrationInput.value = entry.targetRegistration || entry.purchaseRegistration || "";
      }
      dom.financeForm.notes.value = entry.notes || "";
      if (dom.financeSubmitButton) {
        dom.financeSubmitButton.textContent = translate("finance.form.saveChanges");
      }
      if (dom.financeCancelButton) {
        dom.financeCancelButton.hidden = false;
      }
      syncAmountInputMode();
      syncShipWorkflowFields();
      syncHint();
      setFinanceView("entry");
    }

    function getFilteredLedgerEntries() {
      const flowFilter = dom.financeFlowFilter?.value || "all";
      const scopeFilter = dom.financeScopeFilter?.value || "all";
      const searchTerm = String(dom.financeSearchInput?.value || "").trim().toLocaleLowerCase("de");
      const period = normalizeFinancePeriod(dom.financeStatementPeriodType?.value);
      const periodRange = getFinancePeriodRange(period, helpers.formatDateForInput(new Date()));

      return getLedgerEntries().filter((entry) => {
        if (periodRange.type !== "all" && (entry.bookedOn < periodRange.startInput || entry.bookedOn > periodRange.endInput)) return false;
        if (flowFilter !== "all" && (isOpeningBalanceEntry(entry) || entry.flow !== flowFilter)) return false;
        if (scopeFilter !== "all" && entry.scope !== scopeFilter) return false;
        if (!searchTerm) return true;

        const fleetEntry = resolveLedgerFleetEntry(entry);
        const workflowTarget = getLinkedWorkflowTargetFleetEntry(entry);
        const mission = findMissionById(entry.missionId);
        const haystack = [
          entry.category,
          entry.reference,
          entry.notes,
          getFleetEntryLabel(fleetEntry, { includeStatus: true }),
          getFleetEntryLabel(workflowTarget, { includeStatus: true }),
          mission?.title || "",
        ]
          .join(" ")
          .toLocaleLowerCase("de");
        return haystack.includes(searchTerm);
      });
    }

    function getSignedAmount(entry) {
      return entry.flow === "income" ? entry.amountAuec : -entry.amountAuec;
    }

    function getRunningBalanceByEntryId() {
      const balances = new Map();
      let balance = 0;
      [...(getState().ledgerEntries || [])]
        .sort((left, right) => {
          const dateCompare = helpers.compareDateInputs(left.bookedOn, right.bookedOn);
          if (dateCompare !== 0) return dateCompare;
          return new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
        })
        .forEach((entry) => {
          balance += getSignedAmount(entry);
          balances.set(entry.id, balance);
        });
      return balances;
    }

    function renderFinanceSummary(entries) {
      if (!dom.financeSummary) return;
      const totalIncome = entries
        .filter((entry) => !isOpeningBalanceEntry(entry))
        .filter((entry) => entry.flow === "income")
        .reduce((sum, entry) => sum + entry.amountAuec, 0);
      const totalExpense = entries
        .filter((entry) => !isOpeningBalanceEntry(entry))
        .filter((entry) => entry.flow === "expense")
        .reduce((sum, entry) => sum + entry.amountAuec, 0);
      const balance = entries.reduce((sum, entry) => sum + getSignedAmount(entry), 0);

      dom.financeSummary.innerHTML = [
        { label: translate("finance.summary.balance"), value: formatCurrency(balance, { signed: true }), className: balance >= 0 ? "is-income" : "is-expense" },
        { label: translate("finance.summary.income"), value: formatCurrency(totalIncome), className: "is-income" },
        { label: translate("finance.summary.expense"), value: formatCurrency(totalExpense), className: "is-expense" },
        { label: translate("finance.summary.entries"), value: entries.length, className: "" },
      ]
        .map(
          (card) => `
            <div class="summary-card summary-card-compact">
              <span>${helpers.escapeHtml(card.label)}</span>
              <strong class="finance-amount ${helpers.escapeHtml(card.className)}">${helpers.escapeHtml(String(card.value))}</strong>
            </div>
          `,
        )
        .join("");
    }

    function renderStatementTable(filteredEntries) {
      if (!dom.financeList || !dom.financeEmpty) return;
      const runningBalances = getRunningBalanceByEntryId();

      dom.financeEmpty.hidden = filteredEntries.length > 0;
      dom.financeList.innerHTML = "";

      if (filteredEntries.length === 0) {
        return;
      }

      dom.financeList.innerHTML = `
        <div class="finance-table-row is-head">
          <span>${helpers.escapeHtml(translate("finance.table.date"))}</span>
          <span>${helpers.escapeHtml(translate("finance.table.type"))}</span>
          <span>${helpers.escapeHtml(translate("finance.table.scope"))}</span>
          <span>${helpers.escapeHtml(translate("finance.table.booking"))}</span>
          <span>${helpers.escapeHtml(translate("finance.table.amount"))}</span>
          <span>${helpers.escapeHtml(translate("finance.table.balance"))}</span>
          <span>${helpers.escapeHtml(translate("finance.table.action"))}</span>
        </div>
        ${filteredEntries
          .map((entry) => {
            const fleetEntry = resolveLedgerFleetEntry(entry);
            const workflowType = getShipWorkflowType(entry);
            const workflowTarget = getLinkedWorkflowTargetFleetEntry(entry);
            const mission = findMissionById(entry.missionId);
            const reference = entry.reference || mission?.title || translate("finance.table.referenceFallback");
            const shipLabel = getFleetEntryLabel(fleetEntry);
            const workflowLabel = workflowType === "upgrade"
              ? [shipLabel, getFleetEntryLabel(workflowTarget)].filter(Boolean).join(" → ")
              : shipLabel;
            const bookingContext = [reference, workflowLabel].filter(Boolean).join(" · ");
            const signedAmount = getSignedAmount(entry);
            const balance = runningBalances.get(entry.id) || 0;
            return `
              <div class="finance-table-row" data-ledger-id="${helpers.escapeHtml(entry.id)}">
                <span>${helpers.escapeHtml(helpers.formatDateDisplay(entry.bookedOn))}</span>
                <span>${helpers.escapeHtml(getEntryFlowLabel(entry))}</span>
                <span>${helpers.escapeHtml(getScopeLabel(entry.scope))}</span>
                <span class="finance-table-main">
                  <strong>${helpers.escapeHtml(entry.category ? getCategoryLabel(entry.category) : translate("common.booking"))}</strong>
                  <small>${helpers.escapeHtml(bookingContext)}</small>
                </span>
                <span class="finance-amount ${entry.flow === "income" ? "is-income" : "is-expense"}">${helpers.escapeHtml(formatCurrency(signedAmount, { signed: true }))}</span>
                <span class="finance-amount ${balance >= 0 ? "is-income" : "is-expense"}">${helpers.escapeHtml(formatCurrency(balance, { signed: true }))}</span>
                <span class="finance-table-actions">
                  <button class="secondary-button finance-edit icon-only-button tooltip-button" type="button" aria-label="${helpers.escapeHtml(translate("finance.tabs.edit"))}" title="${helpers.escapeHtml(translate("finance.tabs.edit"))}" data-tooltip="${helpers.escapeHtml(translate("finance.table.edit"))}">
                    <span class="button-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M19.4 13.5c.04-.5.04-1 .04-1.5s0-1-.04-1.5l2.1-1.6-2-3.46-2.5 1a7.4 7.4 0 0 0-2.6-1.5L14 2h-4l-.4 2.94a7.4 7.4 0 0 0-2.6 1.5l-2.5-1-2 3.46 2.1 1.6A9.4 9.4 0 0 0 4.56 12c0 .5 0 1 .04 1.5L2.5 15.1l2 3.46 2.5-1a7.4 7.4 0 0 0 2.6 1.5L10 22h4l.4-2.94a7.4 7.4 0 0 0 2.6-1.5l2.5 1 2-3.46-2.1-1.6zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
                      </svg>
                    </span>
                  </button>
                  <button class="ghost-button finance-delete icon-only-button tooltip-button" type="button" aria-label="${helpers.escapeHtml(translate("finance.table.delete"))}" title="${helpers.escapeHtml(translate("finance.table.delete"))}" data-tooltip="${helpers.escapeHtml(translate("finance.table.delete"))}">
                    <span class="button-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" focusable="false">
                        <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
                      </svg>
                    </span>
                  </button>
                </span>
              </div>
            `;
          })
          .join("")}
      `;

      dom.financeList.querySelectorAll(".finance-edit").forEach((button) => {
        button.addEventListener("click", () => {
          const entry = getState().ledgerEntries.find((candidate) => candidate.id === button.closest("[data-ledger-id]")?.dataset.ledgerId);
          if (!entry) return;
          populateForm(entry);
          helpers.setActivePage("finance");
        });
      });

      dom.financeList.querySelectorAll(".finance-delete").forEach((button) => {
        button.addEventListener("click", async () => {
          const row = button.closest("[data-ledger-id]");
          const entry = getState().ledgerEntries.find((candidate) => candidate.id === row?.dataset.ledgerId);
          if (!entry) return;
          const deleteName = entry.category ? getCategoryLabel(entry.category) : entry.reference || translate("finance.confirm.deleteFallback");
          const linkedFleetEntry = getLinkedPurchaseFleetEntry(entry);
          const workflowType = getShipWorkflowType(entry);
          const managedWorkflowType = String(entry.shipWorkflowType || "").trim();
          const workflowSource = getLinkedWorkflowSourceFleetEntry(entry);
          const workflowTarget = getLinkedWorkflowTargetFleetEntry(entry);
          const workflowShipLabel = workflowType === "upgrade"
            ? `${getFleetEntryLabel(workflowSource)} → ${getFleetEntryLabel(workflowTarget)}`
            : getFleetEntryLabel(workflowSource || workflowTarget);
          const shouldDelete = await helpers.showConfirmDialog({
            kicker: translate("finance.dialog.kicker"),
            title: translate("finance.dialog.deleteTitle"),
            message: ["sale", "upgrade"].includes(managedWorkflowType)
              ? translate("finance.workflow.deleteMessage", {
                  name: deleteName,
                  ship: workflowShipLabel,
                })
              : linkedFleetEntry?.status === "active"
              ? translate("finance.purchaseLink.deleteMessage", {
                  name: deleteName,
                  ship: getFleetEntryLabel(linkedFleetEntry),
                })
              : translate("finance.confirm.delete", { name: deleteName }),
            confirmLabel: translate("common.delete"),
            tone: "danger",
          });
          if (!shouldDelete) return;
          await reverseLinkedWorkflow(entry);
          getState().ledgerEntries = getState().ledgerEntries.filter((candidate) => candidate.id !== entry.id);
          if (dom.financeForm?.entryId.value === entry.id) {
            resetForm();
          }
          await helpers.syncLayoutToActiveFleetShip?.({ confirmChange: false });
          helpers.persist();
          helpers.render();
        });
      });
    }

    function getPnlPeriodRange() {
      return getFinancePeriodRange(
        dom.financePnlPeriodType?.value,
        dom.financePnlAnchorDate?.value,
        { allowAll: false },
      );
    }

    function formatPeriodLabel(range) {
      if (range.type === "all") {
        return translate("finance.period.all");
      }
      if (range.type === "day") {
        return helpers.formatDateDisplay(range.startInput);
      }
      if (range.type === "month") {
        return range.start.toLocaleDateString(currentLanguage() === "en" ? "en-US" : "de-DE", { month: "long", year: "numeric" });
      }
      if (range.type === "year") {
        return String(range.start.getFullYear());
      }
      return translate("finance.period.range", {
        start: helpers.formatDateDisplay(range.startInput),
        end: helpers.formatDateDisplay(range.endInput),
      });
    }

    function renderStatementPeriodMeta() {
      if (!dom.financeStatementPeriodMeta) return;
      const range = getFinancePeriodRange(
        dom.financeStatementPeriodType?.value,
        helpers.formatDateForInput(new Date()),
      );
      const showMeta = range.type !== "all";
      dom.financeStatementPeriodMeta.textContent = showMeta ? formatPeriodLabel(range) : "";
      dom.financeStatementPeriodMeta.hidden = !showMeta;
    }

    function getEntriesInPnlPeriod(entries, range) {
      return entries.filter((entry) => entry.bookedOn >= range.startInput && entry.bookedOn <= range.endInput);
    }

    function renderPnl(entries) {
      if (!dom.financePnlSummary || !dom.financePnlTable) return;
      if (dom.financePnlAnchorDate && !dom.financePnlAnchorDate.value) {
        dom.financePnlAnchorDate.value = helpers.formatDateForInput(new Date());
      }

      const range = getPnlPeriodRange();
      const periodEntries = getEntriesInPnlPeriod(entries, range).filter((entry) => !isOpeningBalanceEntry(entry));
      const income = periodEntries
        .filter((entry) => entry.flow === "income")
        .reduce((sum, entry) => sum + entry.amountAuec, 0);
      const expense = periodEntries
        .filter((entry) => entry.flow === "expense")
        .reduce((sum, entry) => sum + entry.amountAuec, 0);
      const result = income - expense;

      dom.financePnlSummary.innerHTML = [
        { label: getPeriodLabel(range.type), value: formatPeriodLabel(range), className: "" },
        { label: translate("finance.summary.income"), value: formatCurrency(income), className: "is-income" },
        { label: translate("finance.summary.expense"), value: formatCurrency(expense), className: "is-expense" },
        { label: translate("finance.summary.result"), value: formatCurrency(result, { signed: true }), className: result >= 0 ? "is-income" : "is-expense" },
      ]
        .map(
          (card) => `
            <div class="summary-card summary-card-compact">
              <span>${helpers.escapeHtml(card.label)}</span>
              <strong class="finance-amount ${helpers.escapeHtml(card.className)}">${helpers.escapeHtml(String(card.value))}</strong>
            </div>
          `,
        )
        .join("");

      const rows = createPnlRows(periodEntries);
      if (rows.length === 0) {
        dom.financePnlTable.innerHTML = `<div class="empty-state">${helpers.escapeHtml(translate("finance.pnl.empty"))}</div>`;
        return;
      }

      dom.financePnlTable.innerHTML = `
        <div class="finance-pnl-row is-head">
          <span>${helpers.escapeHtml(translate("finance.pnl.scope"))}</span>
          <span>${helpers.escapeHtml(translate("finance.pnl.category"))}</span>
          <span>${helpers.escapeHtml(translate("finance.summary.income"))}</span>
          <span>${helpers.escapeHtml(translate("finance.summary.expense"))}</span>
          <span>${helpers.escapeHtml(translate("finance.summary.result"))}</span>
        </div>
        ${rows
          .map((row) => `
            <div class="finance-pnl-row">
              <span>${helpers.escapeHtml(row.scopeLabel)}</span>
              <span>${helpers.escapeHtml(row.category)}</span>
              <span class="finance-amount is-income">${helpers.escapeHtml(formatCurrency(row.income))}</span>
              <span class="finance-amount is-expense">${helpers.escapeHtml(formatCurrency(row.expense))}</span>
              <span class="finance-amount ${row.result >= 0 ? "is-income" : "is-expense"}">${helpers.escapeHtml(formatCurrency(row.result, { signed: true }))}</span>
            </div>
          `)
          .join("")}
      `;
    }

    function createPnlRows(entries) {
      const rowsByKey = new Map();
      entries.forEach((entry) => {
        const key = `${entry.scope}|${entry.category || "Buchung"}`;
        if (!rowsByKey.has(key)) {
          rowsByKey.set(key, {
            scope: entry.scope,
            scopeLabel: getScopeLabel(entry.scope),
            category: entry.category ? getCategoryLabel(entry.category) : translate("common.booking"),
            income: 0,
            expense: 0,
          });
        }
        const row = rowsByKey.get(key);
        if (entry.flow === "income") {
          row.income += entry.amountAuec;
        } else {
          row.expense += entry.amountAuec;
        }
      });

      return [...rowsByKey.values()]
        .map((row) => ({
          ...row,
          result: row.income - row.expense,
        }))
        .sort((left, right) => {
          const scopeCompare = left.scopeLabel.localeCompare(right.scopeLabel, "de");
          if (scopeCompare !== 0) return scopeCompare;
          return left.category.localeCompare(right.category, "de");
        });
    }

    function getCashBalance(entries) {
      return entries.reduce((sum, entry) => sum + getSignedAmount(entry), 0);
    }

    function getFleetAssetRows() {
      return helpers.getFleetEntries()
        .filter((entry) => entry.status === "active" && entry.shipId)
        .map((entry) => {
          const ship = helpers.findShipLibraryEntryById(entry.shipId);
          const value = Math.max(0, Math.round(Number(ship?.priceAuec) || 0));
          return {
            id: entry.id,
            label: `${entry.manufacturer} ${entry.model}`.trim(),
            detail: entry.registration || "",
            value,
            hasValue: value > 0,
          };
        })
        .sort((left, right) => left.label.localeCompare(right.label, "de", { numeric: true }));
    }

    function renderAssets(entries) {
      if (!dom.financeAssetsSummary || !dom.financeAssetsTable) return;
      const cashBalance = getCashBalance(entries);
      const receivables = calculateOpenReceivables({
        missions: getState().missions,
        ledgerEntries: getState().ledgerEntries,
      });
      const fleetAssets = getFleetAssetRows();
      const fleetValue = fleetAssets.reduce((sum, row) => sum + row.value, 0);
      const pricedShipCount = fleetAssets.filter((row) => row.hasValue).length;
      const totalAssets = cashBalance + receivables.totalAuec + fleetValue;

      dom.financeAssetsSummary.innerHTML = [
        { label: translate("finance.assets.cash"), value: formatCurrency(cashBalance, { signed: true }), className: cashBalance >= 0 ? "is-income" : "is-expense" },
        { label: translate("finance.assets.receivables"), value: formatCurrency(receivables.totalAuec), className: receivables.totalAuec > 0 ? "is-receivable" : "" },
        { label: translate("finance.assets.fleetValue"), value: formatCurrency(fleetValue), className: "is-income" },
        { label: translate("finance.assets.total"), value: formatCurrency(totalAssets, { signed: true }), className: totalAssets >= 0 ? "is-income" : "is-expense" },
        { label: translate("finance.assets.pricedShips"), value: `${pricedShipCount}/${fleetAssets.length}`, className: "" },
      ]
        .map(
          (card) => `
            <div class="summary-card summary-card-compact">
              <span>${helpers.escapeHtml(card.label)}</span>
              <strong class="finance-amount ${helpers.escapeHtml(card.className)}">${helpers.escapeHtml(String(card.value))}</strong>
            </div>
          `,
        )
        .join("");

      const rows = [
        {
          scope: translate("finance.assets.liquid"),
          asset: translate("finance.assets.cash"),
          detail: "",
          amount: formatCurrency(cashBalance, { signed: true }),
          className: cashBalance >= 0 ? "is-income" : "is-expense",
        },
        ...receivables.rows.map((row) => ({
          scope: translate("finance.assets.receivables"),
          asset: row.title || translate("finance.assets.untitledMission"),
          detail: [
            row.customer,
            row.completedAt
              ? translate("finance.assets.completedOn", { date: helpers.formatDateDisplay(row.completedAt.slice(0, 10)) })
              : "",
          ].filter(Boolean).join(" · "),
          amount: formatCurrency(row.amountAuec),
          className: "is-receivable",
        })),
        ...fleetAssets.map((row) => ({
          scope: translate("finance.assets.ships"),
          asset: row.label,
          detail: row.detail,
          amount: row.hasValue ? formatCurrency(row.value) : translate("finance.assets.valueOpen"),
          className: row.hasValue ? "is-income" : "",
        })),
      ];

      if (rows.length === 1 && fleetAssets.length === 0 && receivables.count === 0 && cashBalance === 0) {
        dom.financeAssetsTable.innerHTML = `<div class="empty-state">${helpers.escapeHtml(translate("finance.assets.empty"))}</div>`;
        return;
      }

      dom.financeAssetsTable.innerHTML = `
        <div class="finance-assets-row is-head">
          <span>${helpers.escapeHtml(translate("finance.assets.assetValue"))}</span>
          <span>${helpers.escapeHtml(translate("finance.assets.details"))}</span>
          <span>${helpers.escapeHtml(translate("finance.assets.value"))}</span>
        </div>
        ${rows
          .map((row) => `
            <div class="finance-assets-row">
              <span class="finance-table-main"><strong>${helpers.escapeHtml(row.scope)}</strong></span>
              <span>
                <strong>${helpers.escapeHtml(row.asset)}</strong>
                ${row.detail ? `<small>${helpers.escapeHtml(row.detail)}</small>` : ""}
              </span>
              <span class="finance-amount ${helpers.escapeHtml(row.className)}">${helpers.escapeHtml(row.amount)}</span>
            </div>
          `)
          .join("")}
      `;
    }

    function renderFinance() {
      const entries = getLedgerEntries();
      renderFinanceSummary(entries);
      renderStatementPeriodMeta();
      renderStatementTable(getFilteredLedgerEntries());
      renderPnl(entries);
      renderAssets(entries);
      syncFinanceViewState();
    }

    async function handleSubmit(event) {
      event.preventDefault();
      if (!validateEndingBalanceInput()) return;
      const draft = readDraft();
      if (!draft.bookedOn || !draft.category || !draft.amountAuec) {
        await helpers.showConfirmDialog({
          title: translate("common.notice"),
          message: translate("finance.alert.missingRequired"),
          confirmLabel: translate("common.ok"),
          showCancel: false,
        });
        return;
      }

      const existingIndex = getState().ledgerEntries.findIndex((entry) => entry.id === draft.id);
      const existingEntry = existingIndex >= 0 ? getState().ledgerEntries[existingIndex] : null;
      const workflowType = getShipWorkflowType(draft);
      const previousWorkflowType = getShipWorkflowType(existingEntry);
      const sourceFleetEntry = ["sale", "upgrade"].includes(workflowType)
        ? findFleetEntryById(draft.fleetEntryId)
        : null;
      const sameWorkflowSource = isSameWorkflowSource(existingEntry, workflowType, draft.fleetEntryId);
      const sourceCanBeProcessed = sourceFleetEntry?.status === "active"
        || (sameWorkflowSource && sourceFleetEntry?.status === SHIP_WORKFLOW_STATUS[workflowType]);
      if (["sale", "upgrade"].includes(workflowType) && !sourceCanBeProcessed) {
        await helpers.showConfirmDialog({
          title: translate("common.notice"),
          message: translate("finance.alert.chooseActiveSourceShip"),
          confirmLabel: translate("common.ok"),
          showCancel: false,
        });
        return;
      }

      const targetShipId = ["purchase", "upgrade"].includes(workflowType)
        ? String(draft.targetShipProfileId || "").trim()
        : "";
      const targetShipProfile = targetShipId ? helpers.findShipLibraryEntryById(targetShipId) : null;
      if (["purchase", "upgrade"].includes(workflowType) && !targetShipId) {
        await helpers.showConfirmDialog({
          title: translate("common.notice"),
          message: translate(workflowType === "upgrade" ? "finance.alert.chooseUpgradeProfile" : "finance.alert.choosePurchaseProfile"),
          confirmLabel: translate("common.ok"),
          showCancel: false,
        });
        return;
      }
      if (targetShipId && !targetShipProfile) {
        await helpers.showConfirmDialog({
          title: translate("common.notice"),
          message: translate("finance.alert.purchaseProfileMissing"),
          confirmLabel: translate("common.ok"),
          showCancel: false,
        });
        return;
      }

      const workflowIdentityChanged = didWorkflowIdentityChange(existingEntry, draft);
      if (workflowIdentityChanged) {
        const linkedSource = getLinkedWorkflowSourceFleetEntry(existingEntry);
        const linkedTarget = getLinkedWorkflowTargetFleetEntry(existingEntry);
        const shouldChange = await helpers.showConfirmDialog({
          kicker: translate("finance.dialog.kicker"),
          title: translate("finance.workflow.changeTitle"),
          message: translate("finance.workflow.changeMessage", {
            ship: getFleetEntryLabel(linkedSource || linkedTarget),
          }),
          confirmLabel: translate("finance.workflow.changeConfirm"),
        });
        if (!shouldChange) return;
        await reverseLinkedWorkflow(existingEntry);
      }

      const linkedMission = findMissionById(draft.missionId);
      let fleetEntryId = draft.fleetEntryId || linkedMission?.assignedFleetEntryId || "";
      let effectiveShipId = findFleetEntryById(fleetEntryId)?.shipId
        || (!existingEntry?.fleetEntryId ? existingEntry?.shipId || "" : "");
      let workflowMetadata = {
        shipWorkflowType: "",
        sourceFleetEntryId: "",
        targetFleetEntryId: "",
        targetShipProfileId: "",
        targetRegistration: "",
        sourcePreviousStatus: "",
        sourcePreviousEndedOn: "",
        sourceWasActive: false,
      };

      if (workflowType === "purchase") {
        const existingTargetId = previousWorkflowType === "purchase" && !workflowIdentityChanged
          ? getShipWorkflowTargetFleetEntryId(existingEntry)
          : "";
        fleetEntryId = existingTargetId;
        const existingFleetIndex = fleetEntryId
          ? getState().fleet.findIndex((entry) => entry.id === fleetEntryId)
          : -1;
        const existingFleetEntry = existingFleetIndex >= 0 ? getState().fleet[existingFleetIndex] : null;
        const nextFleetEntry = helpers.createFleetEntry({
          id: existingFleetEntry?.id || fleetEntryId || helpers.createRuntimeId(),
          manufacturer: targetShipProfile.manufacturer,
          model: helpers.getShipEntryDisplayName(targetShipProfile),
          registration: draft.targetRegistration,
          imageUrl: existingFleetEntry?.shipId === targetShipProfile.id ? existingFleetEntry?.imageUrl : "",
          refuelContainerSizeScu: existingFleetEntry?.shipId === targetShipProfile.id ? existingFleetEntry?.refuelContainerSizeScu : null,
          refuelContainerSizesScu: existingFleetEntry?.shipId === targetShipProfile.id ? existingFleetEntry?.refuelContainerSizesScu : [],
          acquiredOn: draft.bookedOn,
          endedOn: "",
          status: "active",
          ownerName: existingFleetEntry?.ownerName || "",
          pilotId: existingFleetEntry?.pilotId || "",
          pilotName: existingFleetEntry?.pilotName || "",
          pledgePurchased: existingFleetEntry?.pledgePurchased || false,
          notes: existingFleetEntry?.notes || draft.notes,
          shipId: targetShipProfile.id,
          createdAt: existingFleetEntry?.createdAt,
        });

        if (existingFleetIndex >= 0) {
          getState().fleet.splice(existingFleetIndex, 1, nextFleetEntry);
        } else {
          getState().fleet.unshift(nextFleetEntry);
        }

        fleetEntryId = nextFleetEntry.id;
        effectiveShipId = targetShipProfile.id;
        workflowMetadata = {
          ...workflowMetadata,
          shipWorkflowType: "purchase",
          targetFleetEntryId: nextFleetEntry.id,
          targetShipProfileId: targetShipProfile.id,
          targetRegistration: draft.targetRegistration,
        };
      } else if (workflowType === "sale") {
        workflowMetadata = applySaleWorkflow(draft, workflowIdentityChanged ? null : existingEntry);
        fleetEntryId = workflowMetadata.fleetEntryId;
        effectiveShipId = workflowMetadata.shipId;
      } else if (workflowType === "upgrade") {
        workflowMetadata = applyUpgradeWorkflow(draft, workflowIdentityChanged ? null : existingEntry, targetShipProfile);
        fleetEntryId = workflowMetadata.fleetEntryId;
        effectiveShipId = workflowMetadata.shipId;
      }

      const nextEntry = createLedgerEntry({
        ...draft,
        ...workflowMetadata,
        shipId: effectiveShipId,
        purchaseShipProfileId: workflowType === "purchase" ? targetShipId : "",
        purchaseRegistration: workflowType === "purchase" ? draft.targetRegistration : "",
        fleetEntryId,
        createdAt: existingEntry?.createdAt,
      });

      if (existingIndex >= 0) {
        getState().ledgerEntries.splice(existingIndex, 1, nextEntry);
      } else {
        getState().ledgerEntries.unshift(nextEntry);
      }

      resetForm();
      setFinanceView("statement");
      await helpers.syncLayoutToActiveFleetShip?.({ confirmChange: false });
      helpers.persist();
      helpers.render();
      helpers.setActivePage("finance");
    }

    function init() {
      if (!dom.financeForm) return;
      dom.financeForm.addEventListener("submit", handleSubmit);
      dom.financeViewTabs.forEach((button) => {
        button.addEventListener("click", () => {
          setFinanceView(button.dataset.financeViewTarget || "statement");
        });
      });
      dom.financeScopeSelect?.addEventListener("change", () => {
        renderCategoryOptions();
        applyDefaultFlowForCategory();
        syncShipWorkflowFields();
        syncAmountInputMode();
        syncHint();
      });
      dom.financeCategorySelect?.addEventListener("change", () => {
        applyDefaultFlowForCategory();
        syncShipWorkflowFields();
        syncAmountInputMode();
        syncHint();
      });
      dom.financeMissionSelect?.addEventListener("change", () => {
        const mission = findMissionById(dom.financeMissionSelect.value);
        if (mission?.assignedFleetEntryId) {
          renderShipOptions(mission.assignedFleetEntryId);
        }
        syncAmountInputMode();
        syncHint();
      });
      const syncDraftUi = () => {
        syncAmountInputMode();
        syncHint();
      };
      dom.financeForm.addEventListener("input", syncDraftUi);
      dom.financeForm.addEventListener("change", syncDraftUi);
      dom.financeQuickExpenseForm?.addEventListener("submit", submitQuickShipExpense);
      dom.financeQuickExpenseAmountModes.forEach((input) => {
        input.addEventListener("change", syncQuickExpenseAmountMode);
      });
      dom.financeQuickExpenseEndingBalance?.addEventListener("input", syncQuickExpenseCalculation);
      dom.financeQuickExpenseCancel?.addEventListener("click", closeQuickShipExpense);
      dom.financeQuickExpenseDialog?.addEventListener("click", (event) => {
        if (event.target === dom.financeQuickExpenseDialog) closeQuickShipExpense();
      });
      dom.financeCancelButton?.addEventListener("click", () => {
        resetForm();
        setFinanceView("statement");
        renderFinance();
      });
      dom.financeFlowFilter?.addEventListener("change", renderFinance);
      dom.financeScopeFilter?.addEventListener("change", renderFinance);
      dom.financeSearchInput?.addEventListener("input", renderFinance);
      dom.financeStatementPeriodType?.addEventListener("change", () => {
        dom.financeStatementPeriodType.value = saveStatementPeriod(dom.financeStatementPeriodType.value);
        renderFinance();
      });
      dom.financePnlPeriodType?.addEventListener("change", renderFinance);
      dom.financePnlAnchorDate?.addEventListener("change", renderFinance);
      dom.financePnlTodayButton?.addEventListener("click", () => {
        if (dom.financePnlAnchorDate) {
          dom.financePnlAnchorDate.value = helpers.formatDateForInput(new Date());
        }
        renderFinance();
      });
      if (dom.financePnlAnchorDate && !dom.financePnlAnchorDate.value) {
        dom.financePnlAnchorDate.value = helpers.formatDateForInput(new Date());
      }
      if (dom.financeStatementPeriodType) {
        dom.financeStatementPeriodType.value = loadStatementPeriod();
      }
      resetForm();
      setFinanceView("statement");
    }

    function renderAll() {
      renderCategoryOptions();
      renderShipOptions();
      renderMissionOptions();
      renderWorkflowShipProfileOptions();
      renderReferenceSuggestions();
      syncAmountInputMode();
      syncShipWorkflowFields();
      renderFinance();
    }

    return {
      init,
      openQuickShipExpense,
      openShipExpense,
      render: renderAll,
    };
  }

  window.FinanceModule = {
    calculateOpenReceivables,
    createFinanceController,
    createLedgerEntry,
    calculateExpenseAmountFromEndingBalance,
    getShipWorkflowType,
    getFinancePeriodRange,
    normalizeFinancePeriod,
    reverseShipWorkflow,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      calculateOpenReceivables,
      calculateExpenseAmountFromEndingBalance,
      createLedgerEntry,
      getShipWorkflowType,
      getFinancePeriodRange,
      normalizeFinancePeriod,
      reverseShipWorkflow,
    };
  }
})();
