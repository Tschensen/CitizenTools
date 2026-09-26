(function registerStatisticsModule() {
  const NON_OPERATING_SHIP_CATEGORIES = new Set(["Schiffskauf", "Schiffsverkauf", "Upgrade"]);
  const STATISTICS_VIEW_IDS = ["overview", "operations", "ships"];
  const STATISTICS_SECTION_IDS = ["customers", "pickups", "dropoffs", "destinations", "history", "ship-models", "fleet-entries"];
  const DEFAULT_EXPANDED_STATISTICS_SECTIONS = ["customers", "ship-models", "fleet-entries"];

  function normalizeStatisticsView(value) {
    const normalized = String(value || "").trim();
    return STATISTICS_VIEW_IDS.includes(normalized) ? normalized : "overview";
  }

  function normalizeStatisticsSections(value) {
    if (!Array.isArray(value)) return [...DEFAULT_EXPANDED_STATISTICS_SECTIONS];
    return [...new Set(value.map((entry) => String(entry || "").trim()).filter((entry) => STATISTICS_SECTION_IDS.includes(entry)))];
  }

  function parseStatisticsSections(value) {
    if (value === null || value === undefined || value === "") {
      return [...DEFAULT_EXPANDED_STATISTICS_SECTIONS];
    }
    try {
      return normalizeStatisticsSections(JSON.parse(value));
    } catch (error) {
      return [...DEFAULT_EXPANDED_STATISTICS_SECTIONS];
    }
  }

  function normalizeFleetPerformanceGroup(value) {
    if (value === null || value === undefined) return "active";
    const normalized = String(value ?? "").trim();
    return ["", "active", "archived"].includes(normalized) ? normalized : "active";
  }

  function createStatisticsController({ getState, helpers }) {
    const period = window.StatisticsPeriod;
    const periodStorageKey = 'citizen-tools:statistics-period:v1';
    let filter;
    try { filter = period.normalizeFilter(JSON.parse(readStoredValue(periodStorageKey))); }
    catch { filter = period.normalizeFilter(null); }
    let currentRange = period.getRange(filter);
    const chart = window.StatisticsTrend.createStatisticsChart(helpers);
    const dom = {
      periodForm: document.querySelector('#statisticsPeriodForm'),
      periodSelect: document.querySelector('#statisticsPeriod'),
      periodCustom: document.querySelector('#statisticsCustomPeriod'),
      periodStart: document.querySelector('#statisticsStart'),
      periodEnd: document.querySelector('#statisticsEnd'),
      periodError: document.querySelector('#statisticsPeriodError'),
      periodCaption: document.querySelector('#statisticsPeriodCaption'),
      periodUndated: document.querySelector('#statisticsPeriodUndated'),
      viewTabs: Array.from(document.querySelectorAll("[data-statistics-view-target]")),
      viewSections: Array.from(document.querySelectorAll("[data-statistics-view]")),
      sectionPanels: Array.from(document.querySelectorAll("[data-statistics-section]")),
      sectionToggles: Array.from(document.querySelectorAll("[data-statistics-section-toggle]")),
      summary: document.querySelector("#statisticsSummary"),
      highlights: document.querySelector("#statisticsHighlights"),
      customers: document.querySelector("#statisticsCustomers"),
      pickups: document.querySelector("#statisticsPickups"),
      dropoffs: document.querySelector("#statisticsDropoffs"),
      destinations: document.querySelector("#statisticsDestinations"),
      ships: document.querySelector("#statisticsShips"),
      fleetPerformanceSummary: document.querySelector("#statisticsFleetPerformanceSummary"),
      fleetPerformanceGroups: document.querySelector("#statisticsFleetPerformanceGroups"),
    };

    const translate = (key, params = {}) => helpers.t(key, params);
    const escape = (value) => helpers.escapeHtml(String(value ?? ""));
    const locale = () => helpers.currentUiLanguage() === "en" ? "en-US" : "de-DE";
    const list = (value) => Array.isArray(value) ? value : [];
    const viewStorageKey = String(helpers.statisticsViewStorageKey || "citizen-tools:statistics-view");
    const sectionsStorageKey = String(helpers.statisticsSectionsStorageKey || "citizen-tools:statistics-sections");
    const fleetGroupStorageKey = String(helpers.statisticsFleetGroupStorageKey || "citizen-tools:statistics-fleet-group");
    let activeStatisticsView = normalizeStatisticsView(readStoredValue(viewStorageKey));
    let expandedStatisticsSections = new Set(parseStatisticsSections(readStoredValue(sectionsStorageKey)));
    let expandedFleetPerformanceGroup = normalizeFleetPerformanceGroup(readStoredValue(fleetGroupStorageKey));
    let initialized = false;

    function readStoredValue(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch (error) {
        return null;
      }
    }

    function writeStoredValue(key, value) {
      try {
        globalThis.localStorage?.setItem(key, String(value));
      } catch (error) {
        // Statistics remain usable when browser storage is unavailable.
      }
    }

    function saveStatisticsSections() {
      writeStoredValue(sectionsStorageKey, JSON.stringify([...expandedStatisticsSections]));
    }

    function syncStatisticsViewState() {
      dom.viewTabs.forEach((button) => {
        const isActive = button.dataset.statisticsViewTarget === activeStatisticsView;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", String(isActive));
      });
      dom.viewSections.forEach((section) => {
        const isActive = section.dataset.statisticsView === activeStatisticsView;
        section.hidden = !isActive;
      });
    }

    function syncStatisticsSectionState() {
      dom.sectionPanels.forEach((panel) => {
        const sectionId = String(panel.dataset.statisticsSection || "");
        const expanded = expandedStatisticsSections.has(sectionId);
        panel.classList.toggle("is-collapsed", !expanded);
        const toggle = panel.querySelector("[data-statistics-section-toggle]");
        const body = toggle?.getAttribute("aria-controls")
          ? document.getElementById(toggle.getAttribute("aria-controls"))
          : null;
        if (toggle) {
          toggle.setAttribute("aria-expanded", String(expanded));
          const title = toggle.querySelector(".panel-toggle-title")?.textContent?.trim();
          const action = translate(expanded ? "statistics.action.collapse" : "statistics.action.expand");
          toggle.setAttribute("aria-label", title ? `${title}: ${action}` : action);
        }
        if (body) body.hidden = !expanded;
      });
    }

    function normalizeKey(value) {
      return String(value || "")
        .trim()
        .toLocaleLowerCase("de-DE")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    function isCompleted(mission) {
      const status = String(mission?.status || "active").trim().toLowerCase();
      return status === "completed" || status === "paid" || Boolean(mission?.completedAt || mission?.paidAt);
    }

    function isAccepted(mission) {
      return String(mission?.status || "active").trim().toLowerCase() !== "cancelled";
    }

    function missionCustomer(mission) {
      return String(mission?.serviceDetails?.customer || mission?.customer || "").trim();
    }

    function formatCurrency(value, { signed = false } = {}) {
      const amount = Math.round(Number(value) || 0);
      const prefix = signed && amount > 0 ? "+" : "";
      return `${prefix}${amount.toLocaleString(locale())} aUEC`;
    }

    function formatScu(value) {
      return `${(Number(value) || 0).toLocaleString(locale(), { maximumFractionDigits: 2 })} SCU`;
    }

    function addGroupedRow(map, label, mission, additions = {}) {
      const cleanLabel = String(label || "").trim();
      const key = normalizeKey(cleanLabel);
      if (!key) return;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: cleanLabel,
          missionIds: new Set(),
          completedMissionIds: new Set(),
          payout: 0,
          scu: 0,
          units: 0,
          bookingIds: new Set(),
          income: 0,
          expense: 0,
        });
      }
      const row = map.get(key);
      if (mission?.id) row.missionIds.add(String(mission.id));
      if (mission?.id && isCompleted(mission)) row.completedMissionIds.add(String(mission.id));
      row.payout += Number(additions.payout) || 0;
      row.scu += Number(additions.scu) || 0;
      row.units += Number(additions.units) || 0;
    }

    function sortedRows(map, metric = "missions") {
      return [...map.values()]
        .map((row) => ({
          ...row,
          missions: row.missionIds.size,
          completed: row.completedMissionIds.size,
          bookings: row.bookingIds?.size || 0,
          result: (Number(row.income) || 0) - (Number(row.expense) || 0),
        }))
        .sort((left, right) => {
          const leftValue = metric === "scu" ? left.scu || left.units || left.missions : left[metric] || left.missions;
          const rightValue = metric === "scu" ? right.scu || right.units || right.missions : right[metric] || right.missions;
          return rightValue - leftValue || right.completed - left.completed || left.label.localeCompare(right.label, locale());
        });
    }

    function collectStatistics() {
      const state = getState();
      const selection = period.selectState(state, currentRange);
      const missions = selection.missions.filter(isAccepted);
      const completedMissions = missions.filter(isCompleted);
      const customers = new Map();
      const pickups = new Map();
      const dropoffs = new Map();
      const destinations = new Map();
      const ships = new Map();
      const fleetEntries = list(state.fleet);
      const fleetById = new Map(fleetEntries.map((entry) => [String(entry.id || ""), entry]));
      const fleetEntriesByShipId = new Map();
      fleetEntries.forEach((entry) => {
        const shipId = String(entry?.shipId || "").trim();
        if (!shipId) return;
        if (!fleetEntriesByShipId.has(shipId)) fleetEntriesByShipId.set(shipId, []);
        fleetEntriesByShipId.get(shipId).push(entry);
      });
      const fleetPerformanceRows = new Map(
        fleetEntries
          .filter((entry) => entry?.id && entry?.shipId)
          .map((entry) => [String(entry.id), {
            fleetEntry: entry,
            income: 0,
            expense: 0,
            bookingCount: 0,
          }]),
      );
      const profilesById = new Map(list(state.shipLibrary).map((entry) => [String(entry.id || ""), entry]));
      // Attribution must still resolve contracts outside the selected period.
      const missionsById = new Map(list(state.missions).map((mission) => [String(mission.id || ""), mission]));
      const ledgerEntries = selection.ledgerEntries;
      const knownMissionIds = new Set(missions.map((mission) => String(mission.id || "")).filter(Boolean));
      const knownCompletedMissionIds = new Set(completedMissions.map((mission) => String(mission.id || "")).filter(Boolean));
      let transportedScu = 0;

      const ensureShipRow = (shipId, fleetEntry = null) => {
        const normalizedShipId = String(shipId || fleetEntry?.shipId || "").trim();
        if (!normalizedShipId) return null;
        const profile = profilesById.get(normalizedShipId);
        const label = profile
          ? helpers.formatShipEntryFullName(profile)
          : `${fleetEntry?.manufacturer || ""} ${fleetEntry?.model || ""}`.trim();
        if (!ships.has(normalizedShipId)) {
          const mediaEntry = helpers.getFleetMediaEntry(null, profile || fleetEntry);
          if (!mediaEntry.imageUrl) {
            // Model totals can include several registrations. Prefer a stable
            // representative of this exact model when it has no database image.
            const priority = (entry) => entry.id === state.activeFleetEntryId ? 0 : entry.status === "active" ? 1 : 2;
            const candidates = [...(fleetEntriesByShipId.get(normalizedShipId) || [])]
              .sort((left, right) => priority(left) - priority(right)
                || String(left.id).localeCompare(String(right.id)));
            mediaEntry.imageUrl = candidates
              .map((entry) => helpers.getFleetMediaEntry(entry, profile).imageUrl)
              .find(Boolean) || "";
          }
          ships.set(normalizedShipId, {
            key: normalizedShipId,
            label: label || translate("statistics.unknownShip"),
            mediaEntry,
            missionIds: new Set(),
            completedMissionIds: new Set(),
            bookingIds: new Set(),
            payout: 0,
            income: 0,
            expense: 0,
            scu: 0,
            units: 0,
          });
        }
        return ships.get(normalizedShipId);
      };

      missions.forEach((mission) => {
        const customer = missionCustomer(mission);
        if (customer) {
          addGroupedRow(customers, customer, mission, {
            payout: isCompleted(mission) ? Number(mission.payout) || 0 : 0,
          });
        }

        const fleetEntry = fleetById.get(String(mission.assignedFleetEntryId || ""));
        if (fleetEntry) {
          const row = ensureShipRow(fleetEntry.shipId, fleetEntry);
          if (mission.id) row.missionIds.add(String(mission.id));
          if (mission.id && isCompleted(mission)) row.completedMissionIds.add(String(mission.id));
          if (isCompleted(mission)) row.payout += Number(mission.payout) || 0;
        }
      });

      ledgerEntries.forEach((entry, index) => {
        if (NON_OPERATING_SHIP_CATEGORIES.has(String(entry?.category || "").trim())) return;
        const linkedMission = missionsById.get(String(entry?.missionId || ""));
        const explicitFleetEntry = fleetById.get(String(entry?.fleetEntryId || ""))
          || fleetById.get(String(linkedMission?.assignedFleetEntryId || ""))
          || null;
        const legacyShipEntries = fleetEntriesByShipId.get(String(entry?.shipId || "").trim()) || [];
        const fleetEntry = explicitFleetEntry || (legacyShipEntries.length === 1 ? legacyShipEntries[0] : null);
        const amount = Number(entry?.amountAuec) || 0;
        const performanceRow = fleetPerformanceRows.get(String(fleetEntry?.id || ""));
        if (performanceRow) {
          if (entry?.flow === "income") performanceRow.income += amount;
          else performanceRow.expense += amount;
          performanceRow.bookingCount += 1;
        }
        const row = ensureShipRow(fleetEntry?.shipId || entry?.shipId, fleetEntry);
        if (!row) return;
        row.bookingIds.add(String(entry?.id || `booking-${index}`));
        const linkedMissionId = String(entry?.missionId || "").trim();
        if (linkedMissionId && entry?.flow === "income" && !missionsById.has(linkedMissionId)) {
          knownMissionIds.add(linkedMissionId);
          knownCompletedMissionIds.add(linkedMissionId);
          row.missionIds.add(linkedMissionId);
          row.completedMissionIds.add(linkedMissionId);
        }
        if (entry?.flow === "income") row.income += amount;
        else row.expense += amount;
      });

      completedMissions.forEach((mission) => {
        const segmentsById = new Map(list(mission.segments).map((segment) => [String(segment.id || ""), segment]));
        const visited = new Map();
        const rememberVisit = (location) => {
          const label = String(location || "").trim();
          const key = normalizeKey(label);
          if (key && !visited.has(key)) visited.set(key, label);
        };

        list(mission.loads)
          .filter((load) => Boolean(load?.deliveredAt))
          .forEach((load) => {
            const segment = segmentsById.get(String(load.segmentId || ""));
            const pickup = String(load.pickup || segment?.pickup || mission.pickup || "").trim();
            const dropoff = String(load.dropoff || segment?.dropoff || mission.dropoff || "").trim();
            const scu = Number(load.scu) || 0;
            transportedScu += scu;
            addGroupedRow(pickups, pickup, mission, { scu });
            addGroupedRow(dropoffs, dropoff, mission, { scu });
            rememberVisit(pickup);
            rememberVisit(dropoff);
          });

        list(mission.serviceDetails?.packages).forEach((item) => {
          const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
          const isCargoPackage = Number(item?.containerScu) > 0;
          if (!isCargoPackage && (item?.deliveredAt || isCompleted(mission))) {
            addGroupedRow(pickups, item.pickup, mission, { units: quantity });
            addGroupedRow(dropoffs, item.destination, mission, { units: quantity });
          }
          rememberVisit(item?.pickup);
          rememberVisit(item?.destination);
        });

        list(mission.segments).forEach((segment) => {
          rememberVisit(segment?.pickup);
          rememberVisit(segment?.dropoff);
        });

        list(mission.serviceDetails?.items).forEach((item) => rememberVisit(item?.destination));
        rememberVisit(mission.serviceDetails?.location);
        if (list(mission.segments).length === 0 && list(mission.serviceDetails?.packages).length === 0) {
          rememberVisit(mission.pickup);
          rememberVisit(mission.dropoff);
        }

        visited.forEach((label) => addGroupedRow(destinations, label, mission));
      });

      return {
        selection,
        missions,
        completedMissions,
        knownMissionCount: knownMissionIds.size,
        knownCompletedMissionCount: knownCompletedMissionIds.size,
        customers: sortedRows(customers, "missions"),
        pickups: sortedRows(pickups, "scu"),
        dropoffs: sortedRows(dropoffs, "scu"),
        destinations: sortedRows(destinations, "missions"),
        ships: sortedRows(ships, "bookings"),
        fleetPerformance: [...fleetPerformanceRows.values()]
          .map((row) => ({
            ...row,
            result: row.income - row.expense,
          }))
          .sort((left, right) => {
            const resultCompare = right.result - left.result;
            if (resultCompare !== 0) return resultCompare;
            const leftLabel = `${left.fleetEntry.manufacturer || ""} ${left.fleetEntry.model || ""}`.trim();
            const rightLabel = `${right.fleetEntry.manufacturer || ""} ${right.fleetEntry.model || ""}`.trim();
            return leftLabel.localeCompare(rightLabel, locale(), { numeric: true });
          }),
        transportedScu,
      };
    }

    function renderSummary(data) {
      if (!dom.summary) return;
      const cards = [
        [translate("statistics.summary.accepted"), data.knownMissionCount.toLocaleString(locale())],
        [translate("statistics.summary.completed"), data.knownCompletedMissionCount.toLocaleString(locale())],
        [translate("statistics.summary.customers"), data.customers.length.toLocaleString(locale())],
        [translate("statistics.summary.transported"), formatScu(data.transportedScu)],
      ];
      dom.summary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card summary-card-compact">
          <span>${escape(label)}</span>
          <strong>${escape(value)}</strong>
        </div>
      `).join("");
    }

    function formatActivity(row) {
      if (!row) return "";
      return [
        row.scu > 0 ? formatScu(row.scu) : "",
        row.units > 0
          ? translate(row.units === 1 ? "statistics.package" : "statistics.packages", { count: row.units })
          : "",
        translate(row.missions === 1 ? "statistics.mission" : "statistics.missions", { count: row.missions }),
      ].filter(Boolean).join(" · ");
    }

    function renderHighlights(data) {
      if (!dom.highlights) return;
      const rows = [
        {
          label: translate("statistics.highlights.customer"),
          row: data.customers[0],
          detail: data.customers[0]
            ? `${formatActivity(data.customers[0])} · ${formatCurrency(data.customers[0].payout)}`
            : "",
        },
        {
          label: translate("statistics.highlights.pickup"),
          row: data.pickups[0],
          detail: formatActivity(data.pickups[0]),
        },
        {
          label: translate("statistics.highlights.dropoff"),
          row: data.dropoffs[0],
          detail: formatActivity(data.dropoffs[0]),
        },
        {
          label: translate("statistics.highlights.ship"),
          row: data.ships[0],
          mediaEntry: data.ships[0]?.mediaEntry,
          detail: data.ships[0]
            ? `${formatActivity(data.ships[0])} · ${translate("statistics.table.bookings")}: ${data.ships[0].bookings.toLocaleString(locale())}`
            : "",
        },
      ];
      dom.highlights.innerHTML = rows.map((entry) => `
        <div class="summary-card statistics-highlight-card${entry.mediaEntry ? " ship-art-card" : ""}">
          ${helpers.renderShipCardArt(entry.mediaEntry)}
          <span>${escape(entry.label)}</span>
          <strong>${escape(entry.row?.label || translate("statistics.highlights.empty"))}</strong>
          ${entry.detail ? `<small>${escape(entry.detail)}</small>` : ""}
        </div>
      `).join("");
    }

    function renderTable(container, rows, columns, emptyKey) {
      if (!container) return;
      if (rows.length === 0) {
        container.innerHTML = `<div class="empty-state">${escape(translate(emptyKey))}</div>`;
        return;
      }
      container.innerHTML = `
        <div class="statistics-table-row is-head">
          ${columns.map((column) => `<span>${escape(translate(column.label))}</span>`).join("")}
        </div>
        ${rows.slice(0, 12).map((row, index) => `
          <div class="statistics-table-row">
            ${columns.map((column) => column.render(row, index)).join("")}
          </div>
        `).join("")}
      `;
    }

    function renderLocationRanking(container, rows, emptyKey) {
      if (!container) return;
      if (rows.length === 0) {
        container.innerHTML = `<div class="empty-state">${escape(translate(emptyKey))}</div>`;
        return;
      }
      const visibleRows = rows.slice(0, 8);
      const maxScore = Math.max(...visibleRows.map((row) => row.scu || row.units || row.missions), 1);
      container.innerHTML = visibleRows.map((row, index) => {
        const score = row.scu || row.units || row.missions;
        const width = Math.max(5, Math.round((score / maxScore) * 100));
        const quantities = [
          row.scu > 0 ? formatScu(row.scu) : "",
          row.units > 0
            ? translate(row.units === 1 ? "statistics.package" : "statistics.packages", { count: row.units })
            : "",
          translate(row.missions === 1 ? "statistics.mission" : "statistics.missions", { count: row.missions }),
        ].filter(Boolean).join(" · ");
        return `
          <div class="statistics-rank-row">
            <span class="statistics-rank-index">${index + 1}</span>
            <div class="statistics-rank-copy">
              <strong>${escape(row.label)}</strong>
              <small>${escape(quantities)}</small>
              <span class="statistics-rank-track"><i style="width: ${width}%"></i></span>
            </div>
          </div>
        `;
      }).join("");
    }

    function renderFleetPerformanceTable(rows, emptyKey) {
      if (rows.length === 0) {
        return `<div class="empty-state statistics-fleet-empty">${escape(translate(emptyKey))}</div>`;
      }
      return `
        <div class="statistics-fleet-table">
          <div class="statistics-fleet-row is-head">
            <span>${escape(translate("statistics.fleet.ship"))}</span>
            <span>${escape(translate("statistics.fleet.income"))}</span>
            <span>${escape(translate("statistics.fleet.operatingCosts"))}</span>
            <span>${escape(translate("statistics.fleet.result"))}</span>
            <span>${escape(translate("statistics.fleet.bookings"))}</span>
          </div>
          ${rows.map((row) => {
            const registration = String(row.fleetEntry.registration || "").trim() || translate("statistics.fleet.noRegistration");
            const status = translate(`fleet.status.${row.fleetEntry.status || "active"}`);
            return `
              <div class="statistics-fleet-row">
                <div class="finance-table-main ship-art-card ship-art-cell">
                  ${helpers.renderShipCardArt(helpers.getFleetMediaEntry(row.fleetEntry))}
                  <strong>${escape(`${row.fleetEntry.manufacturer || ""} ${row.fleetEntry.model || ""}`.trim())}</strong>
                  <small>${escape(`${registration} · ${status}`)}</small>
                </div>
                <span class="finance-amount is-income">${escape(formatCurrency(row.income))}</span>
                <span class="finance-amount is-expense">${escape(formatCurrency(row.expense))}</span>
                <span class="finance-amount ${row.result >= 0 ? "is-income" : "is-expense"}">${escape(formatCurrency(row.result, { signed: true }))}</span>
                <span>${escape(row.bookingCount.toLocaleString(locale()))}</span>
              </div>
            `;
          }).join("")}
        </div>
      `;
    }

    function renderFleetPerformanceGroup({ id, titleKey, rows, emptyKey, expanded }) {
      const bodyId = `statistics-fleet-${id}-body`;
      const count = translate(rows.length === 1 ? "statistics.fleet.shipCount" : "statistics.fleet.shipCountPlural", { count: rows.length });
      return `
        <section class="fleet-group statistics-fleet-group${expanded ? "" : " is-collapsed"}" data-statistics-fleet-group="${escape(id)}">
          <button class="fleet-group-header fleet-group-toggle statistics-fleet-group-toggle" type="button" data-statistics-fleet-group-toggle="${escape(id)}" aria-expanded="${expanded ? "true" : "false"}" aria-controls="${escape(bodyId)}">
            <span class="fleet-group-copy"><span class="fleet-group-title">${escape(translate(titleKey))}</span></span>
            <span class="statistics-fleet-group-actions">
              <span class="fleet-group-count">${escape(count)}</span>
              <span class="collapse-indicator" aria-hidden="true"></span>
            </span>
          </button>
          <div id="${escape(bodyId)}" class="fleet-group-body" ${expanded ? "" : "hidden"}>
            ${renderFleetPerformanceTable(rows, emptyKey)}
          </div>
        </section>
      `;
    }

    function syncFleetPerformanceAccordion() {
      if (!dom.fleetPerformanceGroups) return;
      dom.fleetPerformanceGroups.querySelectorAll("[data-statistics-fleet-group]").forEach((group) => {
        const expanded = group.dataset.statisticsFleetGroup === expandedFleetPerformanceGroup;
        group.classList.toggle("is-collapsed", !expanded);
        const body = group.querySelector(".fleet-group-body");
        const button = group.querySelector("[data-statistics-fleet-group-toggle]");
        if (body) body.hidden = !expanded;
        if (button) button.setAttribute("aria-expanded", String(expanded));
      });
    }

    function renderFleetPerformance(data) {
      if (!dom.fleetPerformanceSummary || !dom.fleetPerformanceGroups) return;
      const rows = data.fleetPerformance;
      const linkedRows = rows.filter((row) => row.bookingCount > 0);
      const income = linkedRows.reduce((sum, row) => sum + row.income, 0);
      const expense = linkedRows.reduce((sum, row) => sum + row.expense, 0);
      const result = income - expense;
      const activeRows = rows.filter((row) => row.fleetEntry.status === "active");
      const archivedRows = rows.filter((row) => row.fleetEntry.status !== "active");

      if (expandedFleetPerformanceGroup === "active" && activeRows.length === 0 && archivedRows.length > 0) {
        expandedFleetPerformanceGroup = "archived";
      } else if (expandedFleetPerformanceGroup === "archived" && archivedRows.length === 0 && activeRows.length > 0) {
        expandedFleetPerformanceGroup = "active";
      }
      writeStoredValue(fleetGroupStorageKey, expandedFleetPerformanceGroup);

      dom.fleetPerformanceSummary.innerHTML = [
        { label: translate("statistics.fleet.income"), value: formatCurrency(income), className: "is-income" },
        { label: translate("statistics.fleet.operatingCosts"), value: formatCurrency(expense), className: "is-expense" },
        { label: translate("statistics.fleet.result"), value: formatCurrency(result, { signed: true }), className: result >= 0 ? "is-income" : "is-expense" },
        { label: translate("statistics.fleet.evaluated"), value: `${linkedRows.length}/${rows.length}`, className: "" },
      ].map((card) => `
        <div class="summary-card summary-card-compact">
          <span>${escape(card.label)}</span>
          <strong class="finance-amount ${escape(card.className)}">${escape(card.value)}</strong>
        </div>
      `).join("");

      dom.fleetPerformanceGroups.innerHTML = [
        renderFleetPerformanceGroup({
          id: "active",
          titleKey: "statistics.fleet.active",
          rows: activeRows,
          emptyKey: "statistics.fleet.emptyActive",
          expanded: expandedFleetPerformanceGroup === "active",
        }),
        renderFleetPerformanceGroup({
          id: "archived",
          titleKey: "statistics.fleet.archived",
          rows: archivedRows,
          emptyKey: "statistics.fleet.emptyArchived",
          expanded: expandedFleetPerformanceGroup === "archived",
        }),
      ].join("");

      dom.fleetPerformanceGroups.querySelectorAll("[data-statistics-fleet-group-toggle]").forEach((button) => {
        button.addEventListener("click", () => {
          const groupId = button.dataset.statisticsFleetGroupToggle || "";
          expandedFleetPerformanceGroup = button.getAttribute("aria-expanded") === "true" ? "" : groupId;
          writeStoredValue(fleetGroupStorageKey, expandedFleetPerformanceGroup);
          syncFleetPerformanceAccordion();
        });
      });
    }

    function init() {
      if (initialized) return;
      initialized = true;
      if (dom.periodForm) {
        dom.periodSelect.value = filter.preset;
        dom.periodStart.value = filter.start || period.dateKey(new Date());
        dom.periodEnd.value = filter.end || period.dateKey(new Date());
        dom.periodCustom.hidden = filter.preset !== 'custom';
        function applyPeriod() {
          const draft = { preset: dom.periodSelect.value, start: dom.periodStart.value, end: dom.periodEnd.value };
          if (draft.preset === 'custom' && (!period.dateKey(draft.start) || !period.dateKey(draft.end) || draft.start > draft.end)) {
            dom.periodError.hidden = false;
            return;
          }
          dom.periodError.hidden = true;
          filter = period.normalizeFilter(draft);
          writeStoredValue(periodStorageKey, JSON.stringify(filter));
          render();
        }
        dom.periodSelect.addEventListener('change', () => {
          dom.periodCustom.hidden = dom.periodSelect.value !== 'custom';
          dom.periodError.hidden = true;
          if (dom.periodSelect.value !== 'custom') applyPeriod();
        });
        dom.periodForm.addEventListener('submit', event => { event.preventDefault(); applyPeriod(); });
        const refreshDay = () => {
          const range = period.getRange(filter);
          if (range.start !== currentRange.start || range.end !== currentRange.end) render();
        };
        window.addEventListener('focus', refreshDay);
        document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDay(); });
        window.setInterval(() => { if (!document.hidden) refreshDay(); }, 60000);
      }
      dom.viewTabs.forEach((button) => {
        button.addEventListener("click", () => {
          activeStatisticsView = normalizeStatisticsView(button.dataset.statisticsViewTarget);
          writeStoredValue(viewStorageKey, activeStatisticsView);
          syncStatisticsViewState();
        });
      });
      dom.sectionToggles.forEach((button) => {
        button.addEventListener("click", () => {
          const sectionId = String(button.dataset.statisticsSectionToggle || "");
          if (!STATISTICS_SECTION_IDS.includes(sectionId)) return;
          if (expandedStatisticsSections.has(sectionId)) {
            expandedStatisticsSections.delete(sectionId);
          } else {
            expandedStatisticsSections.add(sectionId);
          }
          saveStatisticsSections();
          syncStatisticsSectionState();
        });
      });
      syncStatisticsViewState();
      syncStatisticsSectionState();
    }

    function render() {
      if (!dom.summary) return;
      currentRange = period.getRange(filter);
      const data = collectStatistics();
      if (dom.periodCaption) {
        const dateLabel = key => new Date(`${key}T12:00:00`).toLocaleDateString(locale());
        dom.periodCaption.textContent = currentRange.preset === 'all' ? translate('statistics.scope') : `${dateLabel(currentRange.start)} – ${dateLabel(currentRange.end)}`;
        dom.periodUndated.hidden = currentRange.preset === 'all' || !data.selection.undated;
        dom.periodUndated.textContent = translate('statistics.period.undated', { count: data.selection.undated });
      }
      chart.render(period.buildTrend(data.selection.ledgerEntries, currentRange));
      helpers.renderStopHistory?.(data.selection.stopHistory);
      renderSummary(data);
      renderHighlights(data);
      renderTable(dom.customers, data.customers, [
        { label: "statistics.table.customer", render: (row, index) => `<span class="statistics-primary-cell"><small>${index + 1}</small><strong>${escape(row.label)}</strong></span>` },
        { label: "statistics.table.accepted", render: (row) => `<span>${row.missions.toLocaleString(locale())}</span>` },
        { label: "statistics.table.completed", render: (row) => `<span>${row.completed.toLocaleString(locale())}</span>` },
        { label: "statistics.table.earnings", render: (row) => `<span>${escape(formatCurrency(row.payout))}</span>` },
      ], "statistics.empty.customers");
      renderLocationRanking(dom.pickups, data.pickups, "statistics.empty.pickups");
      renderLocationRanking(dom.dropoffs, data.dropoffs, "statistics.empty.dropoffs");
      renderLocationRanking(dom.destinations, data.destinations, "statistics.empty.destinations");
      renderTable(dom.ships, data.ships, [
        { label: "statistics.table.ship", render: (row, index) => `<div class="statistics-primary-cell ship-art-card ship-art-cell">${helpers.renderShipCardArt(row.mediaEntry)}<small>${index + 1}</small><strong>${escape(row.label)}</strong></div>` },
        { label: "statistics.table.accepted", render: (row) => `<span>${row.missions.toLocaleString(locale())}</span>` },
        { label: "statistics.table.completed", render: (row) => `<span>${row.completed.toLocaleString(locale())}</span>` },
        { label: "statistics.table.bookings", render: (row) => `<span>${row.bookings.toLocaleString(locale())}</span>` },
        { label: "statistics.table.income", render: (row) => `<span>${escape(formatCurrency(row.income))}</span>` },
        { label: "statistics.table.result", render: (row) => `<span class="${row.result >= 0 ? "is-income" : "is-expense"}">${escape(formatCurrency(row.result))}</span>` },
      ], "statistics.empty.ships");
      renderFleetPerformance(data);
      [dom.highlights, dom.ships, dom.fleetPerformanceGroups].forEach(container => helpers.bindShipProfileMedia(container));
      syncStatisticsViewState();
      syncStatisticsSectionState();
    }

    return { init, render };
  }

  window.StatisticsModule = {
    createStatisticsController,
    normalizeFleetPerformanceGroup,
    normalizeStatisticsSections,
    normalizeStatisticsView,
    parseStatisticsSections,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      createStatisticsController,
      normalizeStatisticsSections,
      normalizeStatisticsView,
      normalizeFleetPerformanceGroup,
      parseStatisticsSections,
    };
  }
})();
