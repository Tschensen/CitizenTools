function cargoText(key, fallback, params = {}) {
  if (typeof window.t === "function") return window.t(key, params);
  return String(fallback || "").replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function cargoLocale() {
  return typeof currentUiLanguage === "function" && currentUiLanguage() === "en" ? "en-US" : "de-DE";
}

let lastRunAutoLoadResult = null;

function formatAutoloadResultWithOverload(result, text) {
  if (!result?.overloadCount) return text;
  return `${text} · ${cargoText("autoload.result.overload", "{count} im Überladungsbereich", {
    count: result.overloadCount,
  })}`;
}

const MISSION_IMPORT_QUALITY_FIELD_PATHS = Object.freeze({
  title: "title",
  payout: "payout",
  maxContainerScu: "maxContainerScu",
  cargoCustomer: "serviceDetails.customer",
  courierCustomer: "serviceDetails.customer",
  courierMaxPackageScu: "serviceDetails.maxPackageScu",
  courierInstructions: "serviceDetails.instructions",
  refuelCustomer: "serviceDetails.customer",
  refuelLocation: "serviceDetails.location",
  refuelTargetVehicle: "serviceDetails.targetVehicle",
  refuelHydrogenRate: "serviceDetails.hydrogenRate",
  refuelQuantumRate: "serviceDetails.quantumRate",
  refuelBonus: "serviceDetails.bonus",
  investigationCustomer: "serviceDetails.customer",
  investigationLocation: "serviceDetails.location",
  investigationSubject: "serviceDetails.subject",
  investigationCaseNumber: "serviceDetails.caseNumber",
  investigationLead: "serviceDetails.leadInvestigator",
  investigationInstructions: "serviceDetails.instructions",
  investigationDangerNote: "serviceDetails.dangerNote",
  salvageCustomer: "serviceDetails.customer",
  salvageLocation: "serviceDetails.location",
  salvageTarget: "serviceDetails.salvageTarget",
  salvageClaimNumber: "serviceDetails.claimNumber",
  salvageInstructions: "serviceDetails.instructions",
  procurementCustomer: "serviceDetails.customer",
  procurementLocation: "serviceDetails.location",
  procurementInstructions: "serviceDetails.instructions",
  miningCustomer: "serviceDetails.customer",
  miningLocation: "serviceDetails.location",
  miningMethod: "serviceDetails.miningMethod",
  miningSearchArea: "serviceDetails.searchArea",
  miningMaterial: "serviceDetails.material",
  miningTargetAmount: "serviceDetails.targetAmount",
  miningTool: "serviceDetails.tool",
  miningInstructions: "serviceDetails.instructions",
});
let activeMissionImportQuality = {};

function normalizeMissionImportQuality(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([path, status]) => [String(path || "").slice(0, 80), String(status || "").toLowerCase()])
      .filter(([path, status]) => /^[A-Za-z][A-Za-z0-9.]*$/.test(path) && ["verified", "review", "missing"].includes(status)),
  );
}

function missionImportQualityLabel(status) {
  if (status === "verified") return cargoText("contracts.import.qualityVerified", "Sicher");
  if (status === "missing") return cargoText("contracts.import.qualityMissing", "Fehlt");
  return cargoText("contracts.import.qualityReview", "Prüfen");
}

function clearMissionImportQuality() {
  activeMissionImportQuality = {};
  const panel = document.querySelector("#missionImportQuality");
  if (panel) panel.hidden = true;
  document.querySelectorAll("#missionForm label[data-import-quality]").forEach((label) => {
    delete label.dataset.importQuality;
    label.querySelector(":scope > .mission-import-quality-marker")?.remove();
  });
}

function renderMissionImportQuality(value = activeMissionImportQuality) {
  activeMissionImportQuality = normalizeMissionImportQuality(value);
  const panel = document.querySelector("#missionImportQuality");
  const summary = document.querySelector("#missionImportQualitySummary");
  if (!panel || !summary) return;

  document.querySelectorAll("#missionForm label[data-import-quality]").forEach((label) => {
    delete label.dataset.importQuality;
    label.querySelector(":scope > .mission-import-quality-marker")?.remove();
  });

  const entries = Object.entries(activeMissionImportQuality);
  panel.hidden = entries.length === 0;
  if (entries.length === 0) {
    summary.innerHTML = "";
    return;
  }

  const counts = { verified: 0, review: 0, missing: 0 };
  entries.forEach(([, status]) => { counts[status] += 1; });
  summary.innerHTML = ["verified", "review", "missing"]
    .filter((status) => counts[status] > 0)
    .map((status) => `
      <span class="mission-import-quality-count is-${status}">
        <strong>${counts[status]}</strong>
        ${missionImportQualityLabel(status)}
      </span>
    `)
    .join("");

  Object.entries(MISSION_IMPORT_QUALITY_FIELD_PATHS).forEach(([fieldName, path]) => {
    const status = activeMissionImportQuality[path];
    const field = missionForm?.elements?.[fieldName];
    const label = field?.closest("label");
    if (!status || !label || field.disabled) return;
    label.dataset.importQuality = status;
    const marker = document.createElement("span");
    marker.className = `mission-import-quality-marker is-${status}`;
    marker.textContent = missionImportQualityLabel(status);
    label.appendChild(marker);
  });

  document.querySelectorAll("#missionForm [data-import-quality-path]").forEach((field) => {
    const status = activeMissionImportQuality[field.dataset.importQualityPath];
    const label = field.closest("label");
    if (!status || !label || field.disabled || label.dataset.importQuality) return;
    label.dataset.importQuality = status;
    const marker = document.createElement("span");
    marker.className = `mission-import-quality-marker is-${status}`;
    marker.textContent = missionImportQualityLabel(status);
    label.appendChild(marker);
  });
}

function markMissionImportFieldReviewed(field) {
  const path = MISSION_IMPORT_QUALITY_FIELD_PATHS[field?.name] || field?.dataset?.importQualityPath;
  if (!path || !Object.prototype.hasOwnProperty.call(activeMissionImportQuality, path)) return;
  activeMissionImportQuality[path] = String(field.value || "").trim() ? "verified" : "missing";
  renderMissionImportQuality();
}

function createProcurementItemRow(item = {}) {
  if (!procurementItemList) return null;
  const row = document.createElement("div");
  row.className = "procurement-item-row";
  row.innerHTML = `
    <label>
      <span>${escapeHtml(cargoText("contracts.form.quantity", "Anzahl"))}</span>
      <input type="number" name="procurementItemQuantity" min="1" step="1" value="${escapeHtml(String(item.quantity || ""))}" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.item", "Gegenstand"))}</span>
      <input type="text" name="procurementItemName" value="${escapeHtml(String(item.name || ""))}" placeholder="z. B. Vestal Wasser" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.deliveryLocation", "Lieferziel"))}</span>
      <input type="text" name="procurementItemDestination" list="locationSuggestions" value="${escapeHtml(String(item.destination || ""))}" placeholder="z. B. Wikelo Emporium" />
    </label>
    <button class="ghost-button icon-only-button tooltip-button procurement-item-remove" type="button" aria-label="${escapeHtml(cargoText("contracts.form.removeItem", "Position entfernen"))}" data-tooltip="${escapeHtml(cargoText("contracts.form.removeItem", "Position entfernen"))}">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M6 7h12v2H6V7zm2 3h8l-1 10H9L8 10zm2-6h4l1 2H9l1-2z" /></svg>
      </span>
    </button>
  `;
  procurementItemList.appendChild(row);
  syncProcurementItemRows();
  return row;
}

function syncProcurementItemRows() {
  if (!procurementItemList) return;
  const rows = [...procurementItemList.querySelectorAll(".procurement-item-row")];
  rows.forEach((row, index) => {
    row.querySelector('[name="procurementItemQuantity"]')?.setAttribute("data-import-quality-path", `serviceDetails.items.${index}.quantity`);
    row.querySelector('[name="procurementItemName"]')?.setAttribute("data-import-quality-path", `serviceDetails.items.${index}.name`);
    row.querySelector('[name="procurementItemDestination"]')?.setAttribute("data-import-quality-path", `serviceDetails.items.${index}.destination`);
    const removeButton = row.querySelector(".procurement-item-remove");
    if (removeButton) removeButton.disabled = rows.length === 1;
  });
}

function resetProcurementItems(items = []) {
  if (!procurementItemList) return;
  procurementItemList.innerHTML = "";
  const normalizedItems = Array.isArray(items) && items.length ? items : [{}];
  normalizedItems.forEach((item) => createProcurementItemRow(item));
}

function collectProcurementItems(defaultDestination = "") {
  if (!procurementItemList) return [];
  return [...procurementItemList.querySelectorAll(".procurement-item-row")]
    .map((row) => ({
      quantity: Math.max(0, Math.round(Number(row.querySelector('[name="procurementItemQuantity"]')?.value) || 0)),
      name: String(row.querySelector('[name="procurementItemName"]')?.value || "").trim(),
      destination: String(row.querySelector('[name="procurementItemDestination"]')?.value || defaultDestination).trim(),
    }))
    .filter((item) => item.quantity > 0 && item.name);
}

function createCourierPackageRow(item = {}) {
  if (!courierPackageList) return null;
  const row = document.createElement("div");
  row.className = "courier-package-row";
  row.innerHTML = `
    <input type="hidden" name="courierPackageId" value="${escapeHtml(String(item.id || ""))}" />
    <label>
      <span>${escapeHtml(cargoText("contracts.form.quantity", "Anzahl"))}</span>
      <input type="number" name="courierPackageQuantity" min="1" step="1" value="${escapeHtml(String(item.quantity || 1))}" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.package", "Paket / Gegenstand"))}</span>
      <input type="text" name="courierPackageName" value="${escapeHtml(String(item.name || ""))}" placeholder="z. B. Lebensmittelvorräte" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.pickupLocation", "Abholort"))}</span>
      <input type="text" name="courierPackagePickup" list="locationSuggestions" value="${escapeHtml(String(item.pickup || ""))}" placeholder="z. B. Beautiful Glen-Station" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.deliveryLocation", "Lieferziel"))}</span>
      <input type="text" name="courierPackageDestination" list="locationSuggestions" value="${escapeHtml(String(item.destination || ""))}" placeholder="z. B. CRU-L1 Ambitious Dream Station" />
    </label>
    <button class="ghost-button icon-only-button tooltip-button courier-package-remove" type="button" aria-label="${escapeHtml(cargoText("contracts.form.removePackage", "Paket entfernen"))}" data-tooltip="${escapeHtml(cargoText("contracts.form.removePackage", "Paket entfernen"))}">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M6 7h12v2H6V7zm2 3h8l-1 10H9L8 10zm2-6h4l1 2H9l1-2z" /></svg>
      </span>
    </button>
  `;
  courierPackageList.appendChild(row);
  enhanceLocationPickerInputs(row);
  syncCourierPackageRows();
  return row;
}

function syncCourierPackageRows() {
  if (!courierPackageList) return;
  const rows = [...courierPackageList.querySelectorAll(".courier-package-row")];
  rows.forEach((row, index) => {
    row.querySelector('[name="courierPackageQuantity"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.quantity`);
    row.querySelector('[name="courierPackageName"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.name`);
    row.querySelector('[name="courierPackagePickup"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.pickup`);
    row.querySelector('[name="courierPackageDestination"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.destination`);
    const removeButton = row.querySelector(".courier-package-remove");
    if (removeButton) removeButton.disabled = rows.length === 1;
  });
}

function resetCourierPackages(items = []) {
  if (!courierPackageList) return;
  courierPackageList.innerHTML = "";
  const normalizedItems = Array.isArray(items) && items.length ? items : [{}];
  normalizedItems.forEach((item) => createCourierPackageRow(item));
}

function collectCourierPackages(existingMission = null) {
  if (!courierPackageList) return [];
  const existingPackages = new Map(
    getMissionServiceDetails(existingMission).packages.map((item) => [item.id, item]),
  );
  return [...courierPackageList.querySelectorAll(".courier-package-row")]
    .map((row) => {
      const id = String(row.querySelector('[name="courierPackageId"]')?.value || "").trim() || createRuntimeId();
      const existing = existingPackages.get(id);
      return {
        id,
        quantity: Math.max(1, Math.round(Number(row.querySelector('[name="courierPackageQuantity"]')?.value) || 1)),
        name: String(row.querySelector('[name="courierPackageName"]')?.value || "").trim(),
        pickup: String(row.querySelector('[name="courierPackagePickup"]')?.value || "").trim(),
        destination: String(row.querySelector('[name="courierPackageDestination"]')?.value || "").trim(),
        pickedUpAt: String(existing?.pickedUpAt || ""),
        deliveredAt: String(existing?.deliveredAt || ""),
      };
    })
    .filter((item) => item.name || item.pickup || item.destination);
}

function createDeliveryItemRow(item = {}) {
  if (!deliveryItemList) return null;
  const row = document.createElement("div");
  const selectedScu = Number(item.containerScu) > 0 ? String(Number(item.containerScu)) : "";
  const containerOptions = getCargoContainerProfiles()
    .filter((profile) => !profile.handheld)
    .map((profile) => `<option value="${escapeHtml(String(profile.scu))}"${selectedScu === String(profile.scu) ? " selected" : ""}>${escapeHtml(profile.label)}</option>`)
    .join("");
  row.className = "courier-package-row delivery-item-row";
  row.innerHTML = `
    <input type="hidden" name="deliveryItemId" value="${escapeHtml(String(item.id || ""))}" />
    <input type="hidden" name="deliveryCargoSegmentId" value="${escapeHtml(String(item.cargoSegmentId || ""))}" />
    <label>
      <span>${escapeHtml(cargoText("contracts.form.quantity", "Anzahl"))}</span>
      <input type="number" name="deliveryItemQuantity" min="1" step="1" value="${escapeHtml(String(item.quantity || 1))}" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.deliveryItem", "Paket / Gegenstand"))}</span>
      <input type="text" name="deliveryItemName" value="${escapeHtml(String(item.name || ""))}" placeholder="z. B. CryoPod" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.pickupLocation", "Abholort"))}</span>
      <input type="text" name="deliveryItemPickup" list="locationSuggestions" value="${escapeHtml(String(item.pickup || ""))}" placeholder="z. B. Wrackstelle nahe Crusader" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.deliveryLocation", "Lieferziel"))}</span>
      <input type="text" name="deliveryItemDestination" list="locationSuggestions" value="${escapeHtml(String(item.destination || ""))}" placeholder="z. B. Tamdon Plains Aid Shelter" />
    </label>
    <label>
      <span>${escapeHtml(cargoText("contracts.form.deliveryContainer", "Container"))}</span>
      <select name="deliveryItemContainerScu">
        <option value="">${escapeHtml(cargoText("contracts.delivery.handPackage", "Handpaket"))}</option>
        ${containerOptions}
      </select>
    </label>
    <button class="ghost-button icon-only-button tooltip-button delivery-item-remove" type="button" aria-label="${escapeHtml(cargoText("contracts.form.removeDeliveryItem", "Position entfernen"))}" data-tooltip="${escapeHtml(cargoText("contracts.form.removeDeliveryItem", "Position entfernen"))}">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M6 7h12v2H6V7zm2 3h8l-1 10H9L8 10zm2-6h4l1 2H9l1-2z" /></svg>
      </span>
    </button>
  `;
  deliveryItemList.appendChild(row);
  enhanceLocationPickerInputs(row);
  syncDeliveryItemRows();
  return row;
}

function syncDeliveryItemRows() {
  if (!deliveryItemList) return;
  const rows = [...deliveryItemList.querySelectorAll(".delivery-item-row")];
  rows.forEach((row, index) => {
    row.querySelector('[name="deliveryItemQuantity"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.quantity`);
    row.querySelector('[name="deliveryItemName"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.name`);
    row.querySelector('[name="deliveryItemPickup"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.pickup`);
    row.querySelector('[name="deliveryItemDestination"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.destination`);
    row.querySelector('[name="deliveryItemContainerScu"]')?.setAttribute("data-import-quality-path", `serviceDetails.packages.${index}.containerScu`);
    const removeButton = row.querySelector(".delivery-item-remove");
    if (removeButton) removeButton.disabled = rows.length === 1;
  });
}

function resetDeliveryItems(items = []) {
  if (!deliveryItemList) return;
  deliveryItemList.innerHTML = "";
  const normalizedItems = Array.isArray(items) && items.length ? items : [{}];
  normalizedItems.forEach((item) => createDeliveryItemRow(item));
}

function collectDeliveryItems(existingMission = null) {
  if (!deliveryItemList) return [];
  const existingItems = new Map(getMissionServiceDetails(existingMission).packages.map((item) => [item.id, item]));
  return [...deliveryItemList.querySelectorAll(".delivery-item-row")]
    .map((row) => {
      const id = String(row.querySelector('[name="deliveryItemId"]')?.value || "").trim() || createRuntimeId();
      const existing = existingItems.get(id);
      const containerScu = parseMissionDecimal(row.querySelector('[name="deliveryItemContainerScu"]')?.value);
      return {
        id,
        quantity: Math.max(1, Math.round(Number(row.querySelector('[name="deliveryItemQuantity"]')?.value) || 1)),
        name: String(row.querySelector('[name="deliveryItemName"]')?.value || "").trim(),
        pickup: String(row.querySelector('[name="deliveryItemPickup"]')?.value || "").trim(),
        destination: String(row.querySelector('[name="deliveryItemDestination"]')?.value || "").trim(),
        containerScu,
        cargoSegmentId: String(existing?.cargoSegmentId || row.querySelector('[name="deliveryCargoSegmentId"]')?.value || "").trim() || (containerScu ? createRuntimeId() : ""),
        pickedUpAt: containerScu ? "" : String(existing?.pickedUpAt || ""),
        deliveredAt: containerScu ? "" : String(existing?.deliveredAt || ""),
      };
    })
    .filter((item) => item.name || item.pickup || item.destination);
}

function buildDeliverySegments(items) {
  return (Array.isArray(items) ? items : []).flatMap((item, itemIndex) => {
    const profile = getCargoContainerProfiles().find((entry) => !entry.handheld && entry.scu === Number(item.containerScu));
    if (!profile) return [];
    return [{
      id: item.cargoSegmentId || createRuntimeId(),
      title: item.name,
      pickup: item.pickup,
      dropoff: item.destination,
      quantity: item.quantity,
      containerSize: profile.key,
      width: profile.width,
      depth: profile.depth,
      height: profile.height,
      isHandheld: false,
      isPlaceable: true,
      scuPerLoad: profile.scu,
      totalScu: profile.scu * item.quantity,
      routeTargetScu: profile.scu * item.quantity,
      expectedCargoScu: profile.scu * item.quantity,
      quantityPending: false,
      cargoIndex: itemIndex,
      cargoRouteIndex: 0,
      cargoGroupIndex: 0,
      order: itemIndex * 10000,
    }];
  });
}

function resetMissionForm() {
  clearMissionImportQuality();
  missionForm.reset();
  if (missionForm.elements.entryId) {
    missionForm.elements.entryId.value = "";
  }
  if (missionTypeSelect) {
    missionTypeSelect.value = "other";
  }
  if (missionFormTitle) {
    missionFormTitle.textContent = cargoText("contracts.form.title.create", "Neuen Auftrag anlegen");
  }
  if (missionSubmitButton) {
    missionSubmitButton.textContent = cargoText("contracts.form.submit.create", "Auftrag erstellen");
  }
  if (missionCancelButton) {
    missionCancelButton.hidden = true;
  }
  const assignmentFields = document.querySelector("#missionAssignmentEditFields");
  if (assignmentFields) assignmentFields.hidden = true;
  if (missionForm.elements.assignedFleetEntryId) {
    missionForm.elements.assignedFleetEntryId.innerHTML = "";
  }
  missionForm.color.value = typeof getNextMissionColor === "function" ? getNextMissionColor() : DEFAULT_COLOR;
  consignmentList.innerHTML = "";
  ensureConsignmentRows();
  resetCourierPackages();
  resetDeliveryItems();
  resetProcurementItems();
  resetQuickMissionCapture();
  if (missionValidationOverride) {
    missionValidationOverride.checked = false;
  }
  if (missionValidationOverrideWrap) {
    missionValidationOverrideWrap.hidden = true;
  }
  if (missionValidationHint) {
    missionValidationHint.hidden = true;
    missionValidationHint.innerHTML = "";
  }
  setCollapsibleExpanded("quickCaptureBody", false);
  setCollapsibleExpanded("consignmentBuilderBody", true);
  syncMissionTypeFields();
  updateDimensionHint();
}

function renderMissionAssignmentEditor(mission) {
  const assignmentFields = document.querySelector("#missionAssignmentEditFields");
  const assignmentSelect = missionForm.elements.assignedFleetEntryId;
  if (!assignmentFields || !assignmentSelect || !mission?.id) return;

  const fleetEntries = [...(state.fleet || [])]
    .filter((entry) => entry?.id && entry?.shipId)
    .sort((left, right) => {
      const statusCompare = Number(right.status === "active") - Number(left.status === "active");
      if (statusCompare !== 0) return statusCompare;
      return formatFleetEntryDisplayName(left).localeCompare(formatFleetEntryDisplayName(right), cargoLocale(), { numeric: true });
    });
  assignmentSelect.innerHTML = [
    `<option value="">${escapeHtml(cargoText("contracts.form.noAssignedShip", "Kein Schiff zugeordnet"))}</option>`,
    ...fleetEntries.map((entry) => {
      const status = entry.status === "active"
        ? cargoText("common.active", "Aktiv")
        : cargoText(`fleet.status.${entry.status}`, entry.status || "");
      return `<option value="${escapeHtml(entry.id)}">${escapeHtml(`${formatFleetEntryDisplayName(entry)} · ${status}`)}</option>`;
    }),
  ].join("");
  assignmentSelect.value = fleetEntries.some((entry) => entry.id === mission.assignedFleetEntryId)
    ? mission.assignedFleetEntryId
    : "";
  assignmentFields.hidden = false;
}

function recalculateMissionContainerGroups() {
  const missionMaxContainerScu = getMissionFormMaxContainerScu();
  const routeNodes = Array.from(consignmentList?.querySelectorAll(".route-group-row") || []);

  routeNodes.forEach((routeNode) => {
    const targetScu = readRouteTargetScu(routeNode);
    if (!Number.isInteger(targetScu) || targetScu <= 0) return;

    const suggestedGroups = buildContainerGroupsForScu(targetScu, missionMaxContainerScu);
    const groupList = routeNode.querySelector('[data-role="container-group-list"]');
    if (!groupList || suggestedGroups.length === 0) return;

    groupList.innerHTML = "";
    suggestedGroups.forEach((group) => addContainerGroupRow(routeNode, group));
    syncRouteGroupHint(routeNode);
    syncConsignmentHint(routeNode.closest(".consignment-item"));
  });

  refreshConsignmentTitles();
  updateDimensionHint();
}

function getMissionEditId() {
  return String(missionForm.elements.entryId?.value || "").trim();
}

function createLoadsFromConsignments(consignments) {
  return consignments
    .filter((consignment) => consignment.isPlaceable)
    .flatMap((consignment) =>
      Array.from({ length: consignment.quantity }, (_, index) =>
        createLoad({
          label: consignment.quantity > 1 ? `${consignment.title} #${index + 1}` : consignment.title,
          width: consignment.width,
          depth: consignment.depth,
          height: consignment.height,
          pickup: consignment.pickup,
          dropoff: consignment.dropoff,
          segmentId: consignment.id,
          cargoTitle: consignment.title,
        }),
      ),
    );
}

function getCargoRouteIdentity(segment, fallbackIndex = 0) {
  const cargoIndex = Number(segment?.cargoIndex);
  const routeIndex = Number(segment?.cargoRouteIndex);
  if (Number.isInteger(cargoIndex) && Number.isInteger(routeIndex)) {
    return `indexed:${cargoIndex}:${routeIndex}`;
  }

  const normalizePart = (value) => String(value || "").trim().toLocaleLowerCase("de-DE");
  return [
    "legacy",
    normalizePart(segment?.title),
    normalizePart(segment?.pickup),
    normalizePart(segment?.dropoff),
    fallbackIndex,
  ].join(":");
}

function groupCargoSegmentsByRoute(segments) {
  const routes = new Map();
  (Array.isArray(segments) ? segments : []).forEach((segment, index) => {
    const key = getCargoRouteIdentity(segment, index);
    if (!routes.has(key)) {
      routes.set(key, {
        key,
        order: Number.isInteger(segment.order) ? segment.order : index,
        segments: [],
      });
    }
    routes.get(key).segments.push(segment);
  });
  return routes;
}

function getCargoRouteSignature(route) {
  return JSON.stringify(
    [...route.segments]
      .sort((left, right) =>
        (Number(left.cargoGroupIndex) || 0) - (Number(right.cargoGroupIndex) || 0),
      )
      .map((segment) => ({
        title: String(segment.title || "").trim(),
        pickup: String(segment.pickup || "").trim(),
        dropoff: String(segment.dropoff || "").trim(),
        quantity: Number(segment.quantity) || 0,
        containerSize: String(segment.containerSize || ""),
        width: Number(segment.width) || 0,
        depth: Number(segment.depth) || 0,
        height: Number(segment.height) || 0,
        isHandheld: Boolean(segment.isHandheld),
        isPlaceable: Boolean(segment.isPlaceable),
        routeTargetScu: Number(segment.routeTargetScu) || 0,
        quantityPending: Boolean(segment.quantityPending),
      })),
  );
}

function getCargoRouteStructureSignature(route) {
  return JSON.stringify(
    [...route.segments]
      .sort((left, right) =>
        (Number(left.cargoGroupIndex) || 0) - (Number(right.cargoGroupIndex) || 0),
      )
      .map((segment) => ({
        quantity: Number(segment.quantity) || 0,
        containerSize: String(segment.containerSize || ""),
        width: Number(segment.width) || 0,
        depth: Number(segment.depth) || 0,
        height: Number(segment.height) || 0,
        isHandheld: Boolean(segment.isHandheld),
        isPlaceable: Boolean(segment.isPlaceable),
        routeTargetScu: Number(segment.routeTargetScu) || 0,
        quantityPending: Boolean(segment.quantityPending),
      })),
  );
}

function mergeCargoMissionDraft(existingMission, draftSegments, { allowProgressRouteCorrection = false } = {}) {
  const existingSegments = getMissionSegments(existingMission);
  const existingLoads = Array.isArray(existingMission?.loads) ? existingMission.loads : [];
  const existingRoutes = groupCargoSegmentsByRoute(existingSegments);
  const draftRoutes = groupCargoSegmentsByRoute(draftSegments);
  const existingRouteBySegmentId = new Map();
  const handledExistingRouteKeys = new Set();
  const handledLoadIds = new Set();
  const segments = [];
  const loads = [];
  const newLoadIds = [];
  let blockedRouteCount = 0;

  existingRoutes.forEach((route) => {
    route.segments.forEach((segment) => existingRouteBySegmentId.set(String(segment.id), route.key));
  });

  const appendExistingRoute = (route, draftRoute = null, { applyRouteMetadata = false } = {}) => {
    const nextExpectedCargoScu = Number(draftRoute?.segments?.[0]?.expectedCargoScu);
    const draftSegmentsByGroup = new Map((draftRoute?.segments || []).map((segment, index) => {
      const groupIndex = Number(segment.cargoGroupIndex);
      return [Number.isInteger(groupIndex) ? groupIndex : index, segment];
    }));
    const mergedRouteSegments = route.segments.map((segment, index) => {
      const groupIndex = Number(segment.cargoGroupIndex);
      const draftSegment = draftSegmentsByGroup.get(Number.isInteger(groupIndex) ? groupIndex : index) || draftRoute?.segments?.[index] || null;
      return {
        ...segment,
        ...(Number.isFinite(nextExpectedCargoScu) ? { expectedCargoScu: nextExpectedCargoScu } : {}),
        ...(applyRouteMetadata && draftSegment
          ? {
              title: draftSegment.title,
              pickup: draftSegment.pickup,
              dropoff: draftSegment.dropoff,
            }
          : {}),
      };
    });
    segments.push(...mergedRouteSegments);
    const mergedSegmentById = new Map(mergedRouteSegments.map((segment) => [String(segment.id), segment]));
    const segmentIds = new Set(route.segments.map((segment) => String(segment.id)));
    existingLoads.forEach((load) => {
      if (!segmentIds.has(String(load.segmentId)) || handledLoadIds.has(load.id)) return;
      const mergedSegment = mergedSegmentById.get(String(load.segmentId));
      loads.push(applyRouteMetadata && mergedSegment
        ? {
            ...load,
            pickup: mergedSegment.pickup,
            dropoff: mergedSegment.dropoff,
            cargoTitle: mergedSegment.title,
          }
        : load);
      handledLoadIds.add(load.id);
    });
  };

  const appendDraftRoute = (route) => {
    segments.push(...route.segments);
    const routeLoads = createLoadsFromConsignments(route.segments);
    loads.push(...routeLoads);
    newLoadIds.push(...routeLoads.map((load) => load.id));
  };

  const routeHasProgress = (route) => {
    const segmentIds = new Set(route.segments.map((segment) => String(segment.id)));
    return existingLoads.some((load) =>
      segmentIds.has(String(load.segmentId)) && (Boolean(load.placement) || Boolean(load.deliveredAt)),
    );
  };

  draftRoutes.forEach((draftRoute, key) => {
    const existingRoute = existingRoutes.get(key);
    if (!existingRoute) {
      appendDraftRoute(draftRoute);
      return;
    }

    handledExistingRouteKeys.add(key);
    const structureUnchanged = getCargoRouteSignature(existingRoute) === getCargoRouteSignature(draftRoute);
    if (structureUnchanged) {
      appendExistingRoute(existingRoute, draftRoute);
      return;
    }

    if (routeHasProgress(existingRoute)) {
      const structureUnchangedDespiteRouteEdit =
        getCargoRouteStructureSignature(existingRoute) === getCargoRouteStructureSignature(draftRoute);
      appendExistingRoute(existingRoute, draftRoute, { applyRouteMetadata: allowProgressRouteCorrection });
      if (!allowProgressRouteCorrection || !structureUnchangedDespiteRouteEdit) blockedRouteCount += 1;
      return;
    }

    appendDraftRoute(draftRoute);
  });

  existingRoutes.forEach((existingRoute, key) => {
    if (handledExistingRouteKeys.has(key)) return;
    if (!routeHasProgress(existingRoute)) return;
    appendExistingRoute(existingRoute);
    blockedRouteCount += 1;
  });

  // Keep legacy loads that cannot be mapped to a segment. Losing them would be worse
  // than retaining an old, incomplete data link during an edit.
  existingLoads.forEach((load) => {
    if (handledLoadIds.has(load.id) || existingRouteBySegmentId.has(String(load.segmentId))) return;
    loads.push(load);
    handledLoadIds.add(load.id);
  });

  segments.sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0));

  return {
    segments,
    loads,
    newLoadIds,
    blockedRouteCount,
  };
}

function buildConsignmentRowsFromMission(mission) {
  const cargoRows = new Map();
  getMissionSegments(mission).forEach((segment, index) => {
    const cargoIndex = Number.isInteger(segment.cargoIndex) ? segment.cargoIndex : index;
    const routeIndex = Number.isInteger(segment.cargoRouteIndex) ? segment.cargoRouteIndex : 0;
    const cargoKey = String(cargoIndex);
    if (!cargoRows.has(cargoKey)) {
      cargoRows.set(cargoKey, {
        order: cargoIndex,
        title: segment.title || mission.title || "",
        expectedTotalScu: Number(segment.expectedCargoScu) || 0,
        routes: new Map(),
      });
    }

    const cargoRow = cargoRows.get(cargoKey);
    cargoRow.expectedTotalScu = Math.max(cargoRow.expectedTotalScu, Number(segment.expectedCargoScu) || 0);
    const routeKey = `${routeIndex}|${segment.pickup || ""}|${segment.dropoff || ""}`;
    if (!cargoRow.routes.has(routeKey)) {
      cargoRow.routes.set(routeKey, {
        order: routeIndex,
        pickup: segment.pickup || "",
        dropoff: segment.dropoff || "",
        targetScu: segment.routeTargetScu || "",
        groups: [],
      });
    }

    const route = cargoRow.routes.get(routeKey);
    if (!segment.quantityPending) {
      route.groups.push({
        quantity: segment.quantity,
        containerSize: segment.containerSize,
        width: segment.width,
        depth: segment.depth,
        height: segment.height,
      });
    }
  });

  return [...cargoRows.values()]
    .sort((left, right) => left.order - right.order)
    .map((row) => ({
      title: row.title,
      expectedTotalScu: row.expectedTotalScu,
      routes: [...row.routes.values()]
        .sort((left, right) => left.order - right.order)
        .map((route) => ({
          pickup: route.pickup,
          dropoff: route.dropoff,
          targetScu: route.targetScu,
          groups: route.groups,
        })),
    }));
}

function populateMissionForm(mission) {
  resetMissionForm();
  const missionType = normalizeMissionType(mission?.type);
  if (missionForm.elements.entryId) missionForm.elements.entryId.value = mission.id || "";
  if (missionTypeSelect) missionTypeSelect.value = missionType;
  if (missionForm.elements.title) missionForm.elements.title.value = mission.title || "";
  if (missionForm.elements.payout) {
    const importedZeroPayout = mission?.sourceImportQuality?.payout === "verified" && mission.payout == null;
    missionForm.elements.payout.value = importedZeroPayout ? 0 : mission.payout ?? "";
  }
  if (missionForm.elements.maxContainerScu) missionForm.elements.maxContainerScu.value = mission.maxContainerScu ?? "";
  if (missionForm.elements.color) missionForm.elements.color.value = mission.color || DEFAULT_COLOR;
  if (missionForm.elements.notes) missionForm.elements.notes.value = mission.notes || "";
  renderMissionAssignmentEditor(mission);

  if (missionType === "cargo") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.cargoCustomer) missionForm.elements.cargoCustomer.value = details.customer || "";
    consignmentList.innerHTML = "";
    const rows = buildConsignmentRowsFromMission(mission);
    if (rows.length > 0) {
      rows.forEach((row) => addConsignmentRow(row));
    } else {
      ensureConsignmentRows();
    }
  } else if (missionType === "courier") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.courierCustomer) missionForm.elements.courierCustomer.value = details.customer || "";
    if (missionForm.elements.courierMaxPackageScu) missionForm.elements.courierMaxPackageScu.value = details.maxPackageScu ?? "";
    if (missionForm.elements.courierInstructions) missionForm.elements.courierInstructions.value = details.instructions || "";
    resetCourierPackages(details.packages);
  } else if (missionType === "delivery") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.deliveryCustomer) missionForm.elements.deliveryCustomer.value = details.customer || "";
    if (missionForm.elements.deliveryInstructions) missionForm.elements.deliveryInstructions.value = details.instructions || details.dangerNote || "";
    resetDeliveryItems(details.packages);
  } else if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.refuelCustomer) missionForm.elements.refuelCustomer.value = details.customer || "";
    if (missionForm.elements.refuelLocation) missionForm.elements.refuelLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.refuelServiceType) missionForm.elements.refuelServiceType.value = details.serviceType || "both";
    if (missionForm.elements.refuelHydrogenAmount) missionForm.elements.refuelHydrogenAmount.value = details.hydrogenAmount ?? "";
    if (missionForm.elements.refuelQuantumAmount) missionForm.elements.refuelQuantumAmount.value = details.quantumAmount ?? "";
    if (missionForm.elements.refuelTargetVehicle) missionForm.elements.refuelTargetVehicle.value = details.targetVehicle || "";
    if (missionForm.elements.refuelHydrogenRate) missionForm.elements.refuelHydrogenRate.value = details.hydrogenRate ?? "";
    if (missionForm.elements.refuelQuantumRate) missionForm.elements.refuelQuantumRate.value = details.quantumRate ?? "";
    if (missionForm.elements.refuelBonus) missionForm.elements.refuelBonus.value = details.bonus || "";
  } else if (missionType === "investigation") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.investigationCustomer) missionForm.elements.investigationCustomer.value = details.customer || "";
    if (missionForm.elements.investigationLocation) missionForm.elements.investigationLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.investigationSubject) missionForm.elements.investigationSubject.value = details.subject || "";
    if (missionForm.elements.investigationCaseNumber) missionForm.elements.investigationCaseNumber.value = details.caseNumber || "";
    if (missionForm.elements.investigationLead) missionForm.elements.investigationLead.value = details.leadInvestigator || "";
    if (missionForm.elements.investigationInstructions) missionForm.elements.investigationInstructions.value = details.instructions || "";
    if (missionForm.elements.investigationDangerNote) missionForm.elements.investigationDangerNote.value = details.dangerNote || "";
  } else if (missionType === "salvage") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.salvageCustomer) missionForm.elements.salvageCustomer.value = details.customer || "";
    if (missionForm.elements.salvageLocation) missionForm.elements.salvageLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.salvageTarget) missionForm.elements.salvageTarget.value = details.salvageTarget || "";
    if (missionForm.elements.salvageClaimNumber) missionForm.elements.salvageClaimNumber.value = details.claimNumber || "";
    if (missionForm.elements.salvageInstructions) missionForm.elements.salvageInstructions.value = details.instructions || "";
  } else if (missionType === "procurement") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.procurementCustomer) missionForm.elements.procurementCustomer.value = details.customer || "";
    if (missionForm.elements.procurementLocation) missionForm.elements.procurementLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.procurementInstructions) missionForm.elements.procurementInstructions.value = details.instructions || "";
    resetProcurementItems(details.items);
  } else if (missionType === "mining") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.miningCustomer) missionForm.elements.miningCustomer.value = details.customer || "";
    if (missionForm.elements.miningLocation) missionForm.elements.miningLocation.value = details.location || mission.dropoff || "";
    if (missionForm.elements.miningMethod) missionForm.elements.miningMethod.value = details.miningMethod || "hand";
    if (missionForm.elements.miningSearchArea) missionForm.elements.miningSearchArea.value = details.searchArea || "";
    if (missionForm.elements.miningMaterial) missionForm.elements.miningMaterial.value = details.material || "";
    if (missionForm.elements.miningTargetAmount) missionForm.elements.miningTargetAmount.value = details.targetAmount ?? "";
    if (missionForm.elements.miningTool) missionForm.elements.miningTool.value = details.tool || "";
    if (missionForm.elements.miningInstructions) missionForm.elements.miningInstructions.value = details.instructions || "";
  } else if (missionType === "other") {
    const details = getMissionServiceDetails(mission);
    if (missionForm.elements.miscCustomer) missionForm.elements.miscCustomer.value = details.customer || "";
    if (missionForm.elements.miscLocation) missionForm.elements.miscLocation.value = details.location || mission.dropoff || "";
  } else {
    consignmentList.innerHTML = "";
    const rows = buildConsignmentRowsFromMission(mission);
    if (rows.length > 0) {
      rows.forEach((row) => addConsignmentRow(row));
    } else {
      ensureConsignmentRows();
    }
  }

  if (missionFormTitle) {
    missionFormTitle.textContent = cargoText("contracts.form.title.edit", "Auftrag bearbeiten");
  }
  if (missionSubmitButton) {
    missionSubmitButton.textContent = cargoText("common.saveChanges", "Änderungen speichern");
  }
  if (missionCancelButton) {
    missionCancelButton.hidden = false;
  }

  syncMissionTypeFields();
  renderMissionImportQuality(mission.sourceImportQuality);
  updateDimensionHint();
  renderLocationSuggestions();
  setActivePage("create");
}

function saveMissionEntry(nextMission) {
  nextMission.color = getDistinctActiveMissionColor(nextMission.color, nextMission.id);
  const existingIndex = state.missions.findIndex((mission) => mission.id === nextMission.id);
  const existingMission = existingIndex >= 0 ? state.missions[existingIndex] : null;
  if (existingMission && missionForm.elements.assignedFleetEntryId) {
    nextMission.assignedFleetEntryId = String(missionForm.elements.assignedFleetEntryId.value || "").trim();
  }
  const fleetChanged = String(existingMission?.assignedFleetEntryId || "") !== String(nextMission.assignedFleetEntryId || "");
  if (existingMission && !fleetChanged) {
    nextMission.assignedPilotId = String(existingMission.assignedPilotId || "");
    nextMission.assignedPilotName = String(existingMission.assignedPilotName || "");
    nextMission.assignmentUpdatedAt = existingMission.assignmentUpdatedAt || existingMission.createdAt || new Date().toISOString();
  } else {
    setMissionAssignment(nextMission, { fleetEntryId: nextMission.assignedFleetEntryId });
  }
  if (existingMission) {
    const incomeEntry = getMissionIncomeEntry(existingMission);
    if (incomeEntry) {
      const assignedFleetEntry = (state.fleet || []).find((entry) => entry.id === nextMission.assignedFleetEntryId) || null;
      incomeEntry.reference = nextMission.title || incomeEntry.reference;
      if (missionHasPayout(nextMission)) incomeEntry.amountAuec = getMissionPayout(nextMission);
      incomeEntry.fleetEntryId = assignedFleetEntry?.id || "";
      incomeEntry.shipId = assignedFleetEntry?.shipId || "";
    }
  }
  if (existingIndex >= 0) {
    nextMission.sourceImportId ||= existingMission.sourceImportId || "";
    nextMission.sourceImportFile ||= existingMission.sourceImportFile || "";
    nextMission.sourceImportDevice ||= existingMission.sourceImportDevice || "";
    nextMission.sourceImportQuality = existingMission.sourceImportId
      ? normalizeMissionImportQuality(
          Object.keys(activeMissionImportQuality).length > 0
            ? activeMissionImportQuality
            : existingMission.sourceImportQuality,
        )
      : {};
    void window.locationAliasLearningController?.queueMissionCorrection(existingMission, nextMission);
    state.missions.splice(existingIndex, 1, nextMission);
    return true;
  }
  state.missions.unshift(nextMission);
  return false;
}

function renderCreateShipIndicator() {
  if (!createShipIndicator || !createShipName || !createShipMeta) return;

  const missionType = getSelectedMissionType();
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const activeEntry = dispatcherMode ? null : currentActiveFleetEntry();
  const media = activeEntry ? getFleetMediaEntry(activeEntry) : null;
  const imageKey = JSON.stringify([activeEntry?.id, media?.imageUrl, media?.manufacturer, media?.model, media?.variant]);
  if (createShipIndicator.dataset.shipImageKey !== imageKey) {
    createShipIndicator.querySelector(':scope > .ship-card-art')?.remove();
    createShipIndicator.insertAdjacentHTML('beforeend', renderShipCardArt(media));
    createShipIndicator.dataset.shipImageKey = imageKey;
    createShipIndicator.classList.toggle('ship-art-card', Boolean(media));
    bindShipProfileMedia(createShipIndicator);
  }
  const indicatorLabel = createShipIndicator.querySelector(":scope > span");
  if (indicatorLabel) {
    indicatorLabel.textContent = dispatcherMode
      ? cargoText("contracts.form.dispatchAssignment", "Disposition")
      : cargoText("contracts.form.currentShip", "Aktuelles Schiff");
  }

  if (dispatcherMode) {
    createShipName.textContent = cargoText("contracts.form.assignmentLater", "Zuweisung später");
    if (createShipRegistration) {
      createShipRegistration.textContent = cargoText("contracts.form.assignmentLaterDetail", "Auftrag kann später einem oder mehreren Schiffen zugeordnet werden.");
    }
    const deliveryUsesCargo = missionType === "delivery" && collectDeliveryItems().some((item) => Number(item.containerScu) > 0);
    const unrestrictedMission = ["other", "courier", "investigation", "procurement"].includes(missionType)
      || (missionType === "delivery" && !deliveryUsesCargo)
      || (missionType === "mining" && String(missionForm?.elements?.miningMethod?.value || "hand") === "hand");
    createShipMeta.textContent = unrestrictedMission
      ? cargoText("contracts.form.noShipLimit", "Keine Schiffsbeschränkung")
      : cargoText("contracts.form.dispatchCheckLater", "Fachliche Prüfung erfolgt bei der Zuweisung.");
    if (createShipStatus) {
      createShipStatus.hidden = true;
      createShipStatus.textContent = "";
      createShipStatus.title = createShipMeta.textContent;
    }
    createShipIndicator.classList.remove("is-warning", "is-error");
    createShipIndicator.classList.add("is-ready");
    return;
  }

  const shipProfile = currentActiveShipProfile();
  const shipName = activeEntry
    ? `${activeEntry.manufacturer} ${activeEntry.model}`.trim()
    : t("hub.summary.noActiveShip");

  createShipName.textContent = shipName;
  if (createShipRegistration) {
    createShipRegistration.textContent = activeEntry
      ? formatFleetRegistration(activeEntry)
      : cargoText("contracts.form.chooseFleet", "Wähle ein Schiff in der Flotte");
  }

  createShipIndicator.classList.remove("is-ready", "is-warning", "is-error");

  const deliveryUsesCargo = missionType === "delivery" && collectDeliveryItems().some((item) => Number(item.containerScu) > 0);
  if (["other", "courier", "investigation", "procurement"].includes(missionType)
    || (missionType === "delivery" && !deliveryUsesCargo)
    || (missionType === "mining" && String(missionForm?.elements?.miningMethod?.value || "hand") === "hand")) {
    createShipMeta.textContent = cargoText("contracts.form.noShipLimit", "Keine Schiffsbeschränkung");
    if (createShipStatus) {
      createShipStatus.hidden = true;
      createShipStatus.textContent = "";
      createShipStatus.title = cargoText("contracts.form.everyShipAllowed", "Jedes aktive Schiff ist für diesen Auftrag zulässig.");
    }
    createShipIndicator.classList.add("is-ready");
    return;
  }

  if (missionType === "refuel") {
    const formData = new FormData(missionForm);
    const serviceType = normalizeRefuelServiceType(formData.get("refuelServiceType"));
    const hydrogenAmount = parseMissionDecimal(formData.get("refuelHydrogenAmount"));
    const quantumAmount = parseMissionDecimal(formData.get("refuelQuantumAmount"));
    const readiness = getRefuelReadiness(serviceType, { hydrogenAmount, quantumAmount });
    createShipMeta.textContent = activeEntry && shipProfile
      ? formatFleetRefuelSupport(activeEntry, shipProfile)
      : cargoText("contracts.form.noRefuelCapacityChecked", "Keine Refuel-Kapazität geprüft");
    if (createShipStatus) {
      createShipStatus.hidden = readiness.ok;
      createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
      createShipStatus.title = readiness.message;
    }
    createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
    return;
  }
  if (missionType === "salvage") {
    const readiness = getSalvageReadiness();
    createShipMeta.textContent = activeEntry && shipProfile
      ? getShipClassLabel(shipProfile.shipClass) || cargoText("contracts.form.noShipClass", "Keine Schiffsklasse")
      : cargoText("contracts.form.noSalvageCapacityChecked", "Keine Bergungsklasse geprüft");
    if (createShipStatus) {
      createShipStatus.hidden = readiness.ok;
      createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
      createShipStatus.title = readiness.message;
    }
    createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
    return;
  }
  if (missionType === "mining") {
    const readiness = getMiningReadiness(missionForm?.elements?.miningMethod?.value || "hand");
    createShipMeta.textContent = activeEntry && shipProfile
      ? getShipClassLabel(shipProfile.shipClass) || cargoText("contracts.form.noShipClass", "Keine Schiffsklasse")
      : cargoText("contracts.form.noMiningCapacityChecked", "Keine Bergbauklasse geprüft");
    if (createShipStatus) {
      createShipStatus.hidden = readiness.ok;
      createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
      createShipStatus.title = readiness.message;
    }
    createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
    return;
  }

  const consignments = missionType === "delivery"
    ? buildDeliverySegments(collectDeliveryItems())
    : collectConsignments();
  const requestedScu = getPlannedConsignmentScu(consignments);
  const cargoState = getActiveCargoCapacityState();
  const readiness = getCargoReadiness({ requestedScu });
  if (cargoState.totalCapacity > 0) {
    createShipMeta.textContent = cargoState.layoutMatchesActive
      ? cargoText("contracts.form.cargoUsage", "{used} / {total} SCU belegt · {free} SCU frei", {
          used: cargoState.usedCapacity,
          total: cargoState.totalCapacity,
          free: cargoState.freeCapacity,
        })
      : cargoText("contracts.form.cargoSpace", "{value} Frachtraum", { value: formatScuAmount(cargoState.totalCapacity) });
  } else {
    createShipMeta.textContent = activeEntry
      ? cargoText("contracts.form.noCargoGrid", "Kein Cargo-Grid")
      : cargoText("contracts.form.noCargoCapacityChecked", "Keine Frachtkapazität geprüft");
  }
  if (createShipStatus) {
    createShipStatus.hidden = readiness.ok;
    createShipStatus.textContent = readiness.ok ? "" : cargoText("contracts.form.notSuitable", "Nicht geeignet für diesen Auftrag");
    createShipStatus.title = readiness.message;
  }
  createShipIndicator.classList.add(readiness.ok ? "is-ready" : activeEntry ? "is-warning" : "is-error");
}

function renderSummary() {
  const preset = currentPreset();
  const fleetShip = currentFleetShip();
  const activeFleetEntry = currentActiveFleetEntry();
  const activeShipProfile = currentActiveShipProfile();
  const activeShipHasCargo = hasShipCargoGrid(activeShipProfile);
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const loads = getAllLoads();
  const currentShipLoadEntries = activeFleetEntry
    ? loads.filter(({ mission }) => String(mission.assignedFleetEntryId || "").trim() === activeFleetEntry.id)
    : loads;
  const activeMissionCount = state.missions.filter((mission) => isMissionActive(mission)).length;
  const placedLoads = getPlacedLoadEntries({ fleetEntryId: activeFleetEntry?.id || state.layout.fleetEntryId }).length;
  const totalCapacity = getTotalCapacity();
  const usedCapacity = getUsedCapacity();
  const totalPayout = state.missions
    .filter((mission) => isMissionActive(mission))
    .reduce((sum, mission) => sum + (mission.payout || 0), 0);
  const activeShipName = activeFleetEntry
    ? `${activeFleetEntry.manufacturer} ${activeFleetEntry.model}`.trim()
    : t("hub.summary.noActiveShip");
  const activeShipRegistration = activeFleetEntry
    ? formatFleetRegistration(activeFleetEntry)
    : t("hub.summary.chooseFleet");

  const locale = currentUiLanguage() === "en" ? "en-US" : "de-DE";
  const activeOrgShips = getActiveFleetEntries().length;
  const unassignedActiveMissions = state.missions.filter((mission) => isMissionActive(mission) && !String(mission.assignedFleetEntryId || "").trim()).length;
  const cards = dispatcherMode
    ? [
        { label: t("dispatcher.summary.orgShips"), value: t("dispatcher.summary.shipCount", { count: activeOrgShips }), target: "fleet" },
        { label: t("hub.summary.activeMissions"), value: activeMissionCount },
        { label: t("hub.summary.plannedPayout"), value: `${totalPayout.toLocaleString(locale)} aUEC` },
        { label: t("dispatcher.summary.unassignedMissions"), value: t("dispatcher.summary.unassignedCount", { count: unassignedActiveMissions }) },
      ]
    : [
        { label: t("hub.summary.activeShip"), value: activeShipName, detail: activeShipRegistration, target: "fleet", media: activeFleetEntry ? getFleetMediaEntry(activeFleetEntry) : null },
        { label: t("hub.summary.activeMissions"), value: activeMissionCount },
        { label: t("hub.summary.plannedPayout"), value: `${totalPayout.toLocaleString(locale)} aUEC` },
      ];

  if (!dispatcherMode && activeShipHasCargo) {
    cards.push(
      { label: t("hub.summary.loadedScu"), value: `${usedCapacity} / ${totalCapacity}` },
      { label: t("hub.summary.freeCapacity"), value: `${Math.max(totalCapacity - usedCapacity, 0)} SCU` },
      { label: t("hub.summary.placedLoads"), value: `${placedLoads}/${currentShipLoadEntries.length}` },
    );
  }

  if (overviewShipPanel) {
    overviewShipPanel.hidden = dispatcherMode || !activeShipHasCargo;
  }
  if (overviewLayout) {
    overviewLayout.classList.toggle("is-mission-only", dispatcherMode || !activeShipHasCargo);
  }

  summaryCards.innerHTML = cards
    .map(
      (card) => `
        <div class="summary-card${card.media ? " ship-art-card" : ""}${card.target ? " is-clickable" : ""}"${card.target ? ` role="button" tabindex="0" data-summary-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(t("hub.openCard", { label: card.label }))}"` : ""}>
          ${renderShipCardArt(card.media)}
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          ${card.detail ? `<small>${escapeHtml(card.detail)}</small>` : ""}
        </div>
      `,
    )
    .join("");

  bindShipProfileMedia(summaryCards);
  summaryCards.querySelectorAll("[data-summary-target]").forEach((card) => {
    const goToTarget = () => setActivePage(card.dataset.summaryTarget || "overview");
    card.addEventListener("click", goToTarget);
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      goToTarget();
    });
  });

  if (overviewShipName) {
    overviewShipName.textContent = formatPlannerShipName(fleetShip, preset);
  }

  renderCreateShipIndicator();
}

function renderHub() {
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const activeMissionCount = activeMissions.length;
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const activeFleetEntry = currentActiveFleetEntry();
  const activeShipMedia = activeFleetEntry ? getFleetMediaEntry(activeFleetEntry) : null;
  const activeShipName = activeFleetEntry
    ? `${activeFleetEntry.manufacturer} ${activeFleetEntry.model}`.trim()
    : t("hub.summary.noActiveShip");
  const activeShipRegistration = activeFleetEntry ? formatFleetRegistration(activeFleetEntry) : t("hub.summary.chooseFleet");
  const locale = currentUiLanguage() === "en" ? "en-US" : "de-DE";
  const routeState = buildRunRouteState();
  const compatibleActiveMissions = dispatcherMode
    ? activeMissions
    : activeMissions.filter((mission) => canMissionRunWithCurrentActiveShip(mission));
  const currentRouteMissionIds = new Set(routeState.selectedPoint?.missionIds || []);
  const focusMission = compatibleActiveMissions.find((mission) => currentRouteMissionIds.has(mission.id))
    || compatibleActiveMissions[0]
    || null;
  const focusMissionTitle = focusMission?.title || (activeMissionCount > 0 ? t("hub.mission.noCompatible") : t("hub.mission.noActive"));
  const focusMissionText = focusMission
    ? `${getMissionTypeLabel(focusMission)} · ${summarizeMissionRoute(focusMission)}`
    : activeMissionCount > 0
      ? t("hub.mission.incompatibleActive")
      : t("hub.mission.createFirst");
  const focusMissionTarget = focusMission || activeMissionCount > 0 ? "overview" : "create";
  const routeTargets = routeState.openPoints || [];
  const currentRouteTarget = routeState.selectedPoint || routeTargets[0] || null;
  const formatRouteTargetType = (point) => {
    if (!point) return "";
    if (point.hasPickup && !point.hasCargo) return t("hub.route.pickup");
    if (point.hasCargo) return t("hub.route.delivery");
    if (point.hasService) return t("hub.route.service");
    return t("hub.route.target");
  };
  const plannedPayout = activeMissions.reduce((sum, mission) => sum + (Number(mission.payout) || 0), 0);
  const activeOrgShips = getActiveFleetEntries().length;
  const accountBalance = (state.ledgerEntries || []).reduce((sum, entry) => {
    const amount = Number(entry.amountAuec) || 0;
    return entry.flow === "expense" ? sum - amount : sum + amount;
  }, 0);
  const compatibleMissionIds = new Set(compatibleActiveMissions.map((mission) => mission.id));
  const todayLoadEntries = getAllLoads().filter(({ mission, load }) => (
    compatibleMissionIds.has(mission.id) && !isLoadDelivered(load)
  ));
  const todayPlacedLoads = todayLoadEntries.filter(({ mission, load }) => isLoadPlacementInCurrentLayout(load, mission)).length;
  const todayOpenLoads = Math.max(todayLoadEntries.length - todayPlacedLoads, 0);
  const cargoCapacityState = getActiveCargoCapacityState();
  const unpaidMissions = state.missions.filter((mission) => (
    isMissionCompleted(mission) && !isMissionPaid(mission) && missionHasPayout(mission)
  ));
  const unpaidPayout = unpaidMissions.reduce((sum, mission) => sum + getMissionPayout(mission), 0);
  const routeProgressMeta = routeState.points.length > 0
    ? routeState.arrived
      ? t("hub.today.routeReady")
      : t("hub.today.routeProgress", {
          open: routeState.openPoints.length,
          done: routeState.completedCount,
          total: routeState.progressTotal,
        })
    : t("hub.today.routeEmpty");
  const cargoMeta = todayLoadEntries.length > 0
    ? t("hub.today.cargoMeta", {
        open: todayOpenLoads,
        used: cargoCapacityState.usedCapacity,
        capacity: cargoCapacityState.totalCapacity,
      })
    : t("hub.today.cargoClearMeta");
  const paymentMeta = unpaidMissions.length === 0
    ? t("hub.today.paymentsClearMeta")
    : t(unpaidMissions.length === 1 ? "hub.today.paymentsMetaSingle" : "hub.today.paymentsMetaPlural", { count: unpaidMissions.length });
  const bindHubTargets = (root) => {
    root?.querySelectorAll?.("[data-hub-target]").forEach((card) => {
      const goToTarget = () => setActivePage(card.dataset.hubTarget || "hub");
      card.addEventListener("click", goToTarget);
      card.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        goToTarget();
      });
    });
  };

  const previousShipMedia = hubSummary.querySelector('.hub-ship-media');
  hubSummary.innerHTML = [
    dispatcherMode
      ? { key:"ship", label: t("dispatcher.summary.orgShips"), value: t("dispatcher.summary.shipCount", { count: activeOrgShips }), target: "fleet" }
      : { key:"ship", label: t("hub.summary.activeShip"), value: activeShipName, detail: activeShipRegistration, target: "fleet" },
    { key:"mission", label: t("hub.summary.activeMissions"), badge: t("hub.summary.activeCount", { count: activeMissionCount }), value: focusMissionTitle, detail: focusMissionText, target: focusMissionTarget, mission: true },
    { key:"payout", label: t("hub.summary.plannedPayout"), value: `${plannedPayout.toLocaleString(locale)} aUEC` },
    { key:"balance", label: t("hub.summary.balance"), value: `${accountBalance.toLocaleString(locale)} aUEC`, target: "finance" },
  ]
    .map(
      (card) => `
        <div class="summary-card hub-summary-card${card.key === "ship" ? " hub-ship-card" : ""}${card.mission ? " hub-mission-summary" : ""}${card.target ? " is-clickable" : ""}"${card.target ? ` role="button" tabindex="0" data-hub-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(t("hub.openCard", { label: card.label }))}"` : ""}>
          ${card.key === "ship" ? `<div class="hub-ship-art" aria-hidden="true">${renderShipProfileMedia(activeShipMedia, "hub-ship-media")}</div>` : ""}
          <div class="hub-summary-heading"><span>${escapeHtml(card.label)}</span>${card.badge ? `<span class="hub-mission-count" data-flight-stat="mission-count">${escapeHtml(card.badge)}</span>` : ""}</div>
          <strong data-flight-stat="${card.key}" title="${escapeHtml(String(card.value))}">${escapeHtml(String(card.value))}</strong>
          ${card.detail ? `<small title="${escapeHtml(String(card.detail))}">${escapeHtml(String(card.detail))}</small>` : ""}
        </div>
      `,
    )
    .join("");

  bindHubTargets(hubSummary);
  const nextShipMedia = hubSummary.querySelector('.hub-ship-media');
  const previousImage = previousShipMedia?.querySelector('img');
  const nextImage = nextShipMedia?.querySelector('img');
  if (previousShipMedia && nextShipMedia
      && previousImage?.getAttribute('src') === nextImage?.getAttribute('src')
      && previousImage?.getAttribute('alt') === nextImage?.getAttribute('alt')) {
    // Retain the decoded image and its fallback state during routine renders.
    nextShipMedia.replaceWith(previousShipMedia);
  } else {
    bindShipProfileMedia(hubSummary);
  }

  if (hubTodayList) {
    const todayCards = [
      {
        key: "route",
        label: t("hub.today.route"),
        value: currentRouteTarget?.dropoff || (routeState.points.length > 0 ? t("hub.route.completed") : t("hub.route.none")),
        meta: currentRouteTarget ? `${formatRouteTargetType(currentRouteTarget)} · ${routeProgressMeta}` : routeProgressMeta,
        target: "run",
        state: routeState.arrived || (routeState.points.length > 0 && !routeState.openPoints.length) ? "ready" : routeState.openPoints.length > 0 ? "attention" : "idle",
        meter: {value:routeState.completedCount, max:routeState.progressTotal, label:t("hub.today.routeMeter")},
      },
      cargoCapacityState.hasCargo ? {
        key: "cargo",
        label: t("hub.today.cargo"),
        value: todayLoadEntries.length > 0
          ? t("hub.today.cargoValue", { placed: todayPlacedLoads, total: todayLoadEntries.length })
          : t("hub.today.cargoEmpty"),
        meta: cargoMeta,
        target: "load",
        state: todayOpenLoads > 0 ? "attention" : todayLoadEntries.length > 0 ? "ready" : "idle",
        meter: {value:cargoCapacityState.usedCapacity, max:cargoCapacityState.totalCapacity, label:t("hub.today.cargoMeter")},
      } : null,
      {
        key: "payments",
        label: t("hub.today.payments"),
        value: unpaidMissions.length > 0
          ? t("hub.today.paymentsValue", { amount: unpaidPayout.toLocaleString(locale) })
          : t("hub.today.paymentsClear"),
        meta: paymentMeta,
        target: unpaidMissions.length > 0 ? "overview" : "finance",
        state: unpaidMissions.length > 0 ? "attention" : "ready",
      },
    ].filter(Boolean);

    hubTodayList.innerHTML = todayCards.map((card) => {
      const percent = card.meter?.max > 0 ? Math.max(0, Math.min(100, card.meter.value / card.meter.max * 100)) : 0;
      const meterLabel = card.meter ? `${card.meter.label}: ${card.meter.value.toLocaleString(locale)} / ${card.meter.max.toLocaleString(locale)}` : "";
      const paymentLabel = unpaidMissions.length > 0 ? t("hub.today.paymentsPending") : t("hub.today.paymentsClear");
      return `
      <article class="hub-today-card is-${escapeHtml(card.state)}" role="button" tabindex="0" data-hub-target="${escapeHtml(card.target)}" aria-label="${escapeHtml(t("hub.openCard", { label: card.label }))}">
        <span class="hub-today-label">${escapeHtml(card.label)}<i class="hub-status-light" aria-hidden="true"></i></span>
        <strong data-flight-stat="${card.key}">${escapeHtml(String(card.value))}</strong>
        <p>${escapeHtml(String(card.meta))}</p>
        <div class="hub-today-footer">
          <span class="hub-today-action">${escapeHtml(card.key === "route" && card.meter.max > 0 ? t("run.progress.stops", { done: card.meter.value, total: card.meter.max, percent: Math.round(percent) }) : t("hub.today.open"))}</span>
          ${card.meter ? `<span class="hub-meter${card.meter.max > 0 ? "" : " is-empty"}" title="${escapeHtml(meterLabel)}" aria-label="${escapeHtml(meterLabel)}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-valuetext="${escapeHtml(meterLabel)}"><i data-flight-meter="${card.key}" data-value="${percent}" style="transform:scaleX(${percent / 100})"></i></span>`
            : `<span class="hub-payment-signal" title="${escapeHtml(paymentLabel)}" aria-label="${escapeHtml(paymentLabel)}">${unpaidMissions.length > 0 ? "◷" : "✓"}</span>`}
        </div>
      </article>
    `; }).join("");
    bindHubTargets(hubTodayList);
  }
  window.soloEffects?.hub({
    ship:[activeFleetEntry?.id, activeFleetEntry?.manufacturer, activeFleetEntry?.model],
    'mission-count':activeMissionCount,
    mission:[focusMission?.id, focusMission?.title],
    payout:plannedPayout,
    balance:accountBalance,
    route:[currentRouteTarget?.key, routeState.arrived, routeState.completedCount],
    cargo:[todayPlacedLoads, todayLoadEntries.length, cargoCapacityState.usedCapacity, cargoCapacityState.totalCapacity],
    payments:[unpaidMissions.length, unpaidPayout],
  });
}

async function syncLayoutToActiveFleetShip({ confirmChange = false } = {}) {
  const activeEntry = currentActiveFleetEntry();
  const shipProfile = currentActiveShipProfile();

  if (!activeEntry || !shipProfile || !hasShipCargoGrid(shipProfile)) {
    return true;
  }

  const shipDefinition = getShipGridDefinition(shipProfile, state.layout.overloadMode);
  if (doesLayoutMatchDefinition(shipDefinition, activeEntry.id, activeEntry.shipId)) {
    return true;
  }

  const nextLayout = {
    shipId: activeEntry.shipId,
    fleetEntryId: activeEntry.id,
    presetId: activeEntry.shipId,
    rows: shipDefinition.rows,
    cols: shipDefinition.cols,
    defaultHeight: shipDefinition.defaultHeight,
    overloadMode: shipDefinition.overloadMode,
  };

  if (confirmChange && !(await confirmShipLayoutChange(nextLayout))) {
    return false;
  }

  applyLayoutDefinition(shipDefinition, activeEntry.id, activeEntry.shipId, state.layout.overloadMode);
  state = pruneInvalidPlacements(state);
  persist();
  return true;
}

function ensureFleetPlannerSelection() {
  syncLayoutToActiveFleetShip();
}

function collectLocationSuggestions() {
  const suggestions = new Set(
    Array.isArray(LOCATION_SUGGESTIONS)
      ? LOCATION_SUGGESTIONS.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
  );

  window.systemDatabaseController?.getActiveLocationNames().forEach((value) => suggestions.add(value));

  const currentLocation = String(state.currentLocation || "").trim();
  if (currentLocation) suggestions.add(currentLocation);

  state.missions.forEach((mission) => {
    const serviceDetails = getMissionServiceDetails(mission);
    const serviceLocation = serviceDetails.location;
    if (serviceLocation) suggestions.add(serviceLocation);
    serviceDetails.packages.forEach((entry) => {
      if (entry.pickup) suggestions.add(entry.pickup);
      if (entry.destination) suggestions.add(entry.destination);
    });
    getMissionSegments(mission).forEach((segment) => {
      const pickup = String(segment.pickup || "").trim();
      const dropoff = String(segment.dropoff || "").trim();
      if (pickup) suggestions.add(pickup);
      if (dropoff) suggestions.add(dropoff);
    });
  });

  Array.from(consignmentList?.querySelectorAll('[data-field="pickup"], [data-field="dropoff"]') || []).forEach((field) => {
    const value = String(field.value || "").trim();
    if (value) suggestions.add(value);
  });

  Array.from(quickDestinationList?.querySelectorAll('[data-field="quickPickup"], [data-field="quickDropoff"]') || []).forEach((field) => {
    const value = String(field.value || "").trim();
    if (value) suggestions.add(value);
  });

  const quickDefaultPickup = String(quickPickup?.value || "").trim();
  if (quickDefaultPickup) {
    suggestions.add(quickDefaultPickup);
  }

  return [...suggestions].sort((left, right) => left.localeCompare(right, "de", { sensitivity: "base" }));
}

let activeLocationPickerInput = null;
let locationPickerValues = [];

function getLocationPickerMenu() {
  let menu = document.querySelector("#locationPickerMenu");
  if (menu) return menu;

  menu = document.createElement("div");
  menu.id = "locationPickerMenu";
  menu.className = "location-picker-menu";
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  document.body.appendChild(menu);
  return menu;
}

function getLocationPickerInputs(root = document) {
  const selector = 'input[list="locationSuggestions"], input[data-location-picker]';
  const fields = root instanceof Element && root.matches(selector) ? [root] : [];
  return [...fields, ...Array.from(root.querySelectorAll?.(selector) || [])];
}

function enhanceLocationPickerInputs(root = document) {
  getLocationPickerInputs(root).forEach((field) => {
    if (field.dataset.locationPicker === "true") return;

    field.dataset.locationPicker = "true";
    field.removeAttribute("list");
    field.setAttribute("autocomplete", "off");
    field.setAttribute("role", "combobox");
    field.setAttribute("aria-autocomplete", "list");
    field.setAttribute("aria-controls", "locationPickerMenu");
    field.setAttribute("aria-expanded", "false");

    const wrapper = document.createElement("div");
    wrapper.className = "location-picker-field";
    field.parentNode?.insertBefore(wrapper, field);
    wrapper.appendChild(field);

    const toggle = document.createElement("button");
    toggle.className = "location-picker-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", cargoText("contracts.locationPicker.open", "Orte anzeigen"));
    toggle.innerHTML = `
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <path d="M6.8 9h10.4L12 15.2 6.8 9z" />
        </svg>
      </span>
    `;
    wrapper.appendChild(toggle);
  });
}

function normalizeLocationSearchValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getFilteredLocationPickerValues(input, showAll = false) {
  const suggestions = collectLocationSuggestions();
  if (showAll) return suggestions;

  const query = normalizeLocationSearchValue(input?.value);
  if (!query) return suggestions;

  const queryParts = query.split(/\s+/).filter(Boolean);
  const matches = suggestions.filter((value) => {
    const normalized = normalizeLocationSearchValue(value);
    return normalized.includes(query) || queryParts.every((part) => normalized.includes(part));
  });
  return matches.length > 0 ? matches : suggestions;
}

function positionLocationPickerMenu() {
  const input = activeLocationPickerInput;
  const menu = getLocationPickerMenu();
  if (!input || menu.hidden || !document.contains(input)) return;

  const margin = 8;
  const gap = 6;
  const anchor = input.closest(".location-picker-field") || input;
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, 360), window.innerWidth - margin * 2);
  const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - width - margin));
  const roomBelow = window.innerHeight - rect.bottom - gap - margin;
  const roomAbove = rect.top - gap - margin;
  const placeAbove = roomBelow < 180 && roomAbove > roomBelow;
  const availableHeight = Math.max(120, Math.min(320, placeAbove ? roomAbove : roomBelow));

  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${availableHeight}px`;
  menu.style.left = `${left}px`;
  menu.style.top = placeAbove ? "auto" : `${rect.bottom + gap}px`;
  menu.style.bottom = placeAbove ? `${window.innerHeight - rect.top + gap}px` : "auto";
}

function renderLocationPickerMenu(input, { showAll = false } = {}) {
  const menu = getLocationPickerMenu();
  locationPickerValues = getFilteredLocationPickerValues(input, showAll);
  menu.innerHTML = locationPickerValues
    .map((value, index) => `<button type="button" role="option" data-location-index="${index}">${escapeHtml(value)}</button>`)
    .join("");
}

function openLocationPicker(input, { showAll = false } = {}) {
  if (!input?.matches?.("input[data-location-picker]")) return;

  if (activeLocationPickerInput && activeLocationPickerInput !== input) {
    activeLocationPickerInput.setAttribute("aria-expanded", "false");
  }
  activeLocationPickerInput = input;
  renderLocationPickerMenu(input, { showAll });
  const menu = getLocationPickerMenu();
  menu.setAttribute("aria-label", cargoText("contracts.locationPicker.list", "Bekannte Orte"));
  menu.hidden = false;
  input.setAttribute("aria-expanded", "true");
  positionLocationPickerMenu();
}

function closeLocationPicker({ restoreFocus = false } = {}) {
  const input = activeLocationPickerInput;
  const menu = getLocationPickerMenu();
  menu.hidden = true;
  menu.innerHTML = "";
  input?.setAttribute("aria-expanded", "false");
  activeLocationPickerInput = null;
  locationPickerValues = [];
  if (restoreFocus && input && document.contains(input)) input.focus();
}

function chooseLocationPickerValue(index) {
  const input = activeLocationPickerInput;
  const value = locationPickerValues[index];
  if (!input || !value) return;

  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.focus();
  closeLocationPicker();
}

function renderLocationSuggestions() {
  if (!locationSuggestions) return;
  locationSuggestions.innerHTML = collectLocationSuggestions()
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");
  enhanceLocationPickerInputs();
}

async function deleteMissionEntry(mission) {
  const hasLinkedIncome = Boolean(getMissionIncomeEntry(mission));
  const shouldDelete = await showMissionConfirmDialog({
    kicker: cargoText("contracts.dialog.deleteKicker", "Auftragsverwaltung"),
    title: cargoText("contracts.dialog.deleteTitle", "Auftrag löschen?"),
    message: hasLinkedIncome
      ? cargoText("contracts.confirm.deleteWithLedger", "Auftrag \"{name}\" wirklich löschen? Die verknüpfte Finanzbuchung bleibt erhalten; Route, Fracht und Auftraggeber können danach jedoch nicht mehr ausgewertet werden.", { name: mission.title })
      : cargoText("contracts.confirm.delete", "Auftrag \"{name}\" wirklich löschen?", { name: mission.title }),
    confirmLabel: cargoText("common.delete", "Löschen"),
    tone: "danger",
  });
  if (!shouldDelete) return;
  state.missions = state.missions.filter((entry) => entry.id !== mission.id);
  collapsedMissionIds.delete(mission.id);
  if (getMissionEditId() === mission.id) {
    resetMissionForm();
  }
  if (state.selectedLoadId && !findLoadById(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = false;
  }
  persist();
  render();
}


function toggleMissionCard(mission) {
  if (collapsedMissionIds.has(mission.id)) {
    collapsedMissionIds.delete(mission.id);
  } else {
    collapsedMissionIds.add(mission.id);
  }
  render();
}

function moveActiveMissionBefore(sourceMissionId, targetMissionId) {
  if (!sourceMissionId || !targetMissionId || sourceMissionId === targetMissionId) return false;
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const activeMissionIds = activeMissions.map((mission) => mission.id);
  const activeMissionById = new Map(activeMissions.map((mission) => [mission.id, mission]));
  if (!activeMissionIds.includes(sourceMissionId) || !activeMissionIds.includes(targetMissionId)) return false;

  const nextActiveMissionIds = activeMissionIds.filter((missionId) => missionId !== sourceMissionId);
  const targetIndex = nextActiveMissionIds.indexOf(targetMissionId);
  if (targetIndex < 0) return false;
  nextActiveMissionIds.splice(targetIndex, 0, sourceMissionId);

  const activeQueue = [...nextActiveMissionIds];
  state.missions = state.missions.map((mission) => (
    isMissionActive(mission)
      ? activeMissionById.get(activeQueue.shift()) || mission
      : mission
  ));
  state.selectedStopDropoff = "";
  lastUnloadPlan = null;
  persist();
  render();
  return true;
}

function moveActiveMissionToEnd(sourceMissionId) {
  if (!sourceMissionId) return false;
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const activeMissionIds = activeMissions.map((mission) => mission.id);
  const activeMissionById = new Map(activeMissions.map((mission) => [mission.id, mission]));
  if (!activeMissionIds.includes(sourceMissionId) || activeMissionIds[activeMissionIds.length - 1] === sourceMissionId) return false;

  const nextActiveMissionIds = activeMissionIds.filter((missionId) => missionId !== sourceMissionId);
  nextActiveMissionIds.push(sourceMissionId);
  const activeQueue = [...nextActiveMissionIds];
  state.missions = state.missions.map((mission) => (
    isMissionActive(mission)
      ? activeMissionById.get(activeQueue.shift()) || mission
      : mission
  ));
  state.selectedStopDropoff = "";
  lastUnloadPlan = null;
  persist();
  render();
  return true;
}

function formatMissionPaidAt(mission) {
  const incomeEntry = getMissionIncomeEntry(mission);
  const paidAt = mission.paidAt || incomeEntry?.createdAt || mission.completedAt || incomeEntry?.bookedOn || "";
  if (!paidAt) return cargoText("common.open", "offen");
  return String(paidAt).includes("T") ? formatDateTimeDisplay(paidAt) : formatDateDisplay(paidAt);
}

function formatMissionAssignedShip(mission) {
  const fleetEntry = (state.fleet || []).find((entry) => entry.id === mission.assignedFleetEntryId) || null;
  if (!fleetEntry) {
    return typeof isDispatcherMode === "function" && isDispatcherMode()
      ? cargoText("contracts.meta.assignmentOpen", "Disposition: offen")
      : cargoText("contracts.meta.assignedShipMissing", "Schiff: nicht zugeordnet");
  }
  const assignedShipKey = typeof isDispatcherMode === "function" && isDispatcherMode()
    ? "contracts.meta.dispatchAssignedShip"
    : "contracts.meta.assignedShip";
  return cargoText(assignedShipKey, "Schiff: {ship}", {
    ship: `${fleetEntry.manufacturer} ${fleetEntry.model} · ${formatFleetRegistration(fleetEntry)}`,
  });
}

function formatMissionAssignedPilot(mission) {
  const pilotNames = getMissionParticipantNames(mission);
  if (pilotNames) {
    const participantCount = getMissionParticipants(mission).length;
    return participantCount > 1
      ? cargoText("contracts.meta.assignedParticipants", "Piloten: {pilots}", { pilots: pilotNames })
      : cargoText("contracts.meta.assignedPilot", "Pilot: {pilot}", { pilot: pilotNames });
  }
  return typeof isDispatcherMode === "function" && isDispatcherMode()
    ? cargoText("contracts.meta.pilotOpen", "Pilot: offen")
    : "";
}

function formatMissionPayoutSplit(mission) {
  const items = Array.isArray(mission?.payoutSplit?.items) ? mission.payoutSplit.items : [];
  if (items.length < 2) return "";
  const locale = cargoLocale();
  const details = items.map((item) => `${item.pilotName || getPilotProfiles().find((pilot) => pilot.id === item.pilotId)?.name || "?"}: ${(Number(item.amountAuec) || 0).toLocaleString(locale)} aUEC`);
  return cargoText("contracts.meta.payoutSplit", "Erlös geteilt: {details}", { details: details.join(" · ") });
}

function formatMissionTransportSummary(mission) {
  if (!isCargoMission(mission) || !isDispatcherMode()) return "";
  const shippedByFleetEntry = new Map();
  (mission.loads || []).forEach((load) => {
    const fleetEntryId = String(load.deliveredByFleetEntryId || load.loadedByFleetEntryId || load.placement?.fleetEntryId || "").trim();
    if (!fleetEntryId) return;
    shippedByFleetEntry.set(fleetEntryId, (shippedByFleetEntry.get(fleetEntryId) || 0) + (Number(load.scu) || 0));
  });
  if (shippedByFleetEntry.size === 0) return "";
  const details = [...shippedByFleetEntry.entries()].map(([fleetEntryId, scu]) => {
    const fleetEntry = state.fleet.find((entry) => entry.id === fleetEntryId);
    const pilotName = getFleetEntryPilotName(fleetEntry) || formatFleetEntryDisplayName(fleetEntry) || "?";
    return `${pilotName}: ${formatScuAmount(scu)}`;
  });
  return cargoText("contracts.meta.transportSplit", "Transportanteile: {details}", { details: details.join(" · ") });
}

function getDispatcherMissionAssignmentSuitability(entry, mission) {
  if (!entry || entry.status !== "active") {
    return { ok: false, reason: cargoText("fleet.status.inactive", "Nicht aktiv") };
  }
  const shipType = findShipLibraryEntryForFleetEntry(entry);
  if (!shipType) {
    return { ok: false, reason: cargoText("common.unlinked", "Nicht verknüpft") };
  }
  const missionType = normalizeMissionType(mission?.type);
  if (isCargoMission(mission) && !hasShipCargoGrid(shipType)) {
    return { ok: false, reason: cargoText("contracts.assignment.noCargoShip", "kein Frachtschiff") };
  }
  if (missionType === "refuel") {
    const refuelConfig = getRefuelContainerConfig(shipType, entry);
    if (!refuelConfig.hasRefuelContainers) {
      return { ok: false, reason: cargoText("contracts.assignment.noRefuelShip", "kein Tankschiff") };
    }
    if (!refuelConfig.hasConfiguredCapacity) {
      return { ok: false, reason: cargoText("contracts.assignment.refuelOpen", "Refuel-Konfiguration offen") };
    }
  }
  if (missionType === "salvage") {
    if (normalizeShipClass(shipType.shipClass) !== "salvage") {
      return { ok: false, reason: cargoText("contracts.assignment.noSalvageShip", "kein Bergungsschiff") };
    }
  }
  if (missionType === "mining") {
    const details = getMissionServiceDetails(mission);
    if (details.miningMethod === "ship" && normalizeShipClass(shipType.shipClass) !== "mining") {
      return { ok: false, reason: cargoText("contracts.assignment.noMiningShip", "kein Bergbauschiff") };
    }
  }
  return { ok: true, reason: "" };
}

function formatDispatcherAssignmentOption(entry) {
  return typeof formatFleetAssignmentDisplayName === "function"
    ? formatFleetAssignmentDisplayName(entry)
    : `${entry.manufacturer} ${entry.model} · ${formatFleetRegistration(entry)}`;
}

function distributeMissionLoadsToParticipants(mission) {
  const participants = getMissionParticipants(mission);
  const allocations = Object.fromEntries(participants.map((participant) => [participant.pilotId, {
    pilotId: participant.pilotId,
    pilotName: participant.pilotName,
    loadIds: [],
  }]));
  const pilotIds = participants.map((participant) => participant.pilotId);
  if (pilotIds.length === 0) {
    mission.participantAllocations = {};
    return;
  }

  const assignedScu = Object.fromEntries(pilotIds.map((pilotId) => [pilotId, 0]));
  (Array.isArray(mission.loads) ? mission.loads : [])
    .filter((load) => String(load?.id || "").trim())
    .slice()
    .sort((left, right) => (Number(right.scu) || 0) - (Number(left.scu) || 0) || String(left.id).localeCompare(String(right.id)))
    .forEach((load) => {
      const pilotId = pilotIds.slice().sort((left, right) => assignedScu[left] - assignedScu[right] || left.localeCompare(right))[0];
      allocations[pilotId].loadIds.push(load.id);
      assignedScu[pilotId] += Math.max(0, Number(load.scu) || 0);
    });
  mission.participantAllocations = allocations;
  mission.participantProgress = {};
}

function hasMissionParticipantProgress(mission) {
  return Object.values(mission?.participantProgress || {}).some((progress) => (
    (Number(progress?.placedCount) || 0) > 0
    || (Number(progress?.deliveredCount) || 0) > 0
    || (Number(progress?.placedScu) || 0) > 0
    || (Number(progress?.deliveredScu) || 0) > 0
  ));
}

function getMissionParticipantProgressRows(mission) {
  const allocations = mission?.participantAllocations && typeof mission.participantAllocations === "object"
    ? mission.participantAllocations
    : {};
  const progressByPilot = mission?.participantProgress && typeof mission.participantProgress === "object"
    ? mission.participantProgress
    : {};
  return getMissionParticipants(mission).map((participant) => {
    const allocation = allocations[participant.pilotId] || {};
    const progress = progressByPilot[participant.pilotId] || {};
    const loadIds = Array.isArray(allocation.loadIds) ? allocation.loadIds : [];
    const allocatedLoads = (Array.isArray(mission.loads) ? mission.loads : [])
      .filter((load) => loadIds.includes(load.id));
    const allocatedScu = allocatedLoads.reduce((sum, load) => sum + Math.max(0, Number(load.scu) || 0), 0);
    return {
      pilotName: participant.pilotName || cargoText("contracts.assignment.pilotOpen", "Pilot offen"),
      totalCount: Number(progress.totalCount) || allocatedLoads.length,
      placedCount: Number(progress.placedCount) || 0,
      deliveredCount: Number(progress.deliveredCount) || 0,
      totalScu: Number(progress.totalScu) || allocatedScu,
      deliveredScu: Number(progress.deliveredScu) || 0,
    };
  });
}

function renderMissionParticipantProgress(mission) {
  const rows = getMissionParticipantProgressRows(mission);
  if (rows.length === 0 || !isCargoMission(mission)) return "";
  const totalScu = rows.reduce((sum, row) => sum + row.totalScu, 0);
  const deliveredScu = rows.reduce((sum, row) => sum + row.deliveredScu, 0);
  return `
    <section class="mission-participant-progress">
      <strong>${escapeHtml(cargoText("contracts.assignment.progressTitle", "Frachtfortschritt"))}</strong>
      <p>${escapeHtml(cargoText("contracts.assignment.progressTotal", "{delivered} von {total} geliefert", {
        delivered: formatScuAmount(deliveredScu),
        total: formatScuAmount(totalScu),
      }))}</p>
      <ul>
        ${rows.map((row) => `<li><span>${escapeHtml(row.pilotName)}</span><span>${escapeHtml(cargoText("contracts.assignment.progressPilot", "{delivered}/{total} geliefert · {placed} verladen", {
          delivered: row.deliveredCount,
          total: row.totalCount,
          placed: row.placedCount,
        }))}</span></li>`).join("")}
      </ul>
    </section>
  `;
}

function isOrganizationMissionReadyForCompletion(mission) {
  if (!isDispatcherMode() || !mission?.organizationOrigin || !isCargoMission(mission)) return true;
  const rows = getMissionParticipantProgressRows(mission);
  if (rows.length === 0) return false;
  return rows.every((row) => row.totalCount === 0 || row.deliveredCount >= row.totalCount);
}

function renderMissionDispatcherAssignment(target, mission) {
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (!target || !dispatcherMode || !isMissionActive(mission)) {
    if (target) {
      target.hidden = true;
      target.innerHTML = "";
    }
    return;
  }

  const assignedFleetEntryId = String(mission.assignedFleetEntryId || "").trim();
  const participantIds = new Set(getMissionParticipants(mission).map((participant) => participant.pilotId));
  const options = getFleetEntries()
    .filter((entry) => entry.status === "active" || entry.id === assignedFleetEntryId)
    .map((entry) => ({
      entry,
      suitability: getDispatcherMissionAssignmentSuitability(entry, mission),
    }));
  const hasSuitableEntries = options.some((option) => option.suitability.ok);
  const availablePilots = getPilotProfiles()
    .filter((pilot) => String(pilot?.role || "pilot") !== "viewer")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, typeof currentUiLanguage === "function" ? currentUiLanguage() : "de"));

  target.hidden = false;
  target.innerHTML = `
    <div class="mission-dispatch-assignment-fields">
      <label>
        <span>${escapeHtml(cargoText("contracts.assignment.shipLabel", "Einsatzschiff"))}</span>
        <select data-role="dispatcher-assignment">
          <option value="">${escapeHtml(cargoText("contracts.assignment.dispatchOpen", "Disposition offen"))}</option>
          ${options.map(({ entry, suitability }) => `
            <option value="${escapeHtml(entry.id)}" ${!suitability.ok && entry.id !== assignedFleetEntryId ? "disabled" : ""}>
              ${escapeHtml(formatDispatcherAssignmentOption(entry))}${suitability.ok ? "" : ` · ${escapeHtml(suitability.reason)}`}
            </option>
          `).join("")}
        </select>
      </label>
      <fieldset class="mission-dispatch-participants">
        <legend>${escapeHtml(cargoText("contracts.assignment.participantsLabel", "Einsatzbeteiligte"))}</legend>
        <small>${escapeHtml(cargoText("contracts.assignment.participantsHint", "Mehrere Piloten können denselben Auftrag gemeinsam ausführen."))}</small>
        <div class="mission-dispatch-participant-list">
          ${availablePilots.map((pilot) => `
            <label><input type="checkbox" data-role="dispatcher-participant" value="${escapeHtml(pilot.id)}" ${participantIds.has(pilot.id) ? "checked" : ""} /> <span>${escapeHtml(pilot.name)}</span></label>
          `).join("") || `<small>${escapeHtml(cargoText("contracts.assignment.pilotOpen", "Pilot offen"))}</small>`}
        </div>
      </fieldset>
    </div>
    ${renderMissionParticipantProgress(mission)}
    ${!isOrganizationMissionReadyForCompletion(mission) ? `<small>${escapeHtml(cargoText("contracts.organization.progressIncomplete", "Der Auftrag bleibt offen, bis alle zugeteilten Container geliefert wurden."))}</small>` : ""}
    ${hasSuitableEntries ? "" : `<small>${escapeHtml(cargoText("contracts.assignment.noSuitableShips", "Keine passenden aktiven Schiffe verfügbar."))}</small>`}
  `;

  const select = target.querySelector('[data-role="dispatcher-assignment"]');
  if (select) {
    select.value = assignedFleetEntryId;
    select.addEventListener("change", () => {
      const nextFleetEntryId = String(select.value || "").trim();
      if (nextFleetEntryId === assignedFleetEntryId) return;
      getMissionActiveLoads(mission).forEach((load) => {
        load.placement = null;
      });
      const nextFleetEntry = getFleetEntries().find((entry) => entry.id === nextFleetEntryId) || null;
      const participantIdsForShip = getMissionParticipants(mission).map((participant) => participant.pilotId);
      if (participantIdsForShip.length === 0 && nextFleetEntry?.pilotId) participantIdsForShip.push(nextFleetEntry.pilotId);
      setMissionAssignment(mission, { fleetEntryId: nextFleetEntryId, participantIds: participantIdsForShip });
      if (!hasMissionParticipantProgress(mission)) distributeMissionLoadsToParticipants(mission);
      state.selectedLoadId = null;
      state.selectionCleared = true;
      lastUnloadPlan = null;
      persist();
      render();
    });
  }
  target.querySelectorAll('[data-role="dispatcher-participant"]').forEach((participantInput) => {
    participantInput.addEventListener("change", () => {
      const selectedParticipantIds = Array.from(target.querySelectorAll('[data-role="dispatcher-participant"]:checked'))
        .map((input) => String(input.value || "").trim())
        .filter(Boolean);
      const currentParticipantIds = getMissionParticipants(mission).map((participant) => participant.pilotId).sort();
      const changedParticipants = currentParticipantIds.length !== selectedParticipantIds.length
        || currentParticipantIds.some((pilotId) => !selectedParticipantIds.includes(pilotId));
      if (changedParticipants && hasMissionParticipantProgress(mission)) {
        void showAppNotice(cargoText("contracts.assignment.progressLocked", "Die Beteiligten können nicht mehr geändert werden, sobald Teilfracht unterwegs ist."));
        render();
        return;
      }
      setMissionAssignment(mission, {
        fleetEntryId: mission.assignedFleetEntryId,
        participantIds: selectedParticipantIds,
      });
      distributeMissionLoadsToParticipants(mission);
      persist();
      render();
    });
  });
}

function getMissionAssignmentWarning(mission) {
  if (!isMissionActive(mission)) return "";
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  const assignedFleetEntryId = String(mission.assignedFleetEntryId || "").trim();
  if (!assignedFleetEntryId) {
    if (dispatcherMode) return "";
    return cargoText("contracts.assignment.unassigned", "Diesem aktiven Auftrag ist kein Schiff zugeordnet.");
  }

  const assignedEntry = (state.fleet || []).find((entry) => entry.id === assignedFleetEntryId) || null;
  if (!assignedEntry) {
    return cargoText("contracts.assignment.missingShip", "Das zugeordnete Schiff ist nicht mehr in der Flotte vorhanden.");
  }
  if (assignedEntry.status !== "active") {
    return cargoText("contracts.assignment.shipInactive", "{ship} ist aktuell nicht aktiv.", { ship: formatFleetEntryDisplayName(assignedEntry) });
  }
  if (dispatcherMode) {
    return "";
  }
  if (!state.activeFleetEntryId) {
    return cargoText("contracts.assignment.noActiveShip", "Es ist kein aktives Schiff ausgewählt.");
  }
  if (assignedFleetEntryId !== state.activeFleetEntryId) {
    const activeEntry = currentActiveFleetEntry();
    return activeEntry
      ? cargoText("contracts.assignment.otherActive", "Auftrag ist {assigned} zugeordnet, aktiv ist {active}.", {
          assigned: formatFleetEntryDisplayName(assignedEntry),
          active: formatFleetEntryDisplayName(activeEntry),
        })
      : cargoText("contracts.assignment.noActiveButAssigned", "Auftrag ist {assigned} zugeordnet, aber kein aktives Schiff ist ausgewählt.", {
          assigned: formatFleetEntryDisplayName(assignedEntry),
        });
  }
  return "";
}

function getMissionTransferReadiness(mission) {
  const activeEntry = currentActiveFleetEntry();
  if (!isMissionActive(mission)) {
    return { ok: false, message: cargoText("contracts.transfer.onlyActive", "Nur aktive Aufträge können umgeladen werden.") };
  }
  if (!activeEntry) {
    return { ok: false, message: cargoText("contracts.transfer.chooseShip", "Wähle zuerst ein aktives Schiff aus.") };
  }
  if (mission.assignedFleetEntryId === activeEntry.id) {
    return { ok: false, message: cargoText("contracts.transfer.alreadyAssigned", "Dieser Auftrag ist bereits dem aktiven Schiff zugeordnet.") };
  }

  const missionType = normalizeMissionType(mission.type);
  if (isCargoMission(mission)) {
    const requestedScu = getMissionActiveLoads(mission).reduce((sum, load) => sum + (Number(load.scu) || 0), 0);
    return getCargoReadiness({ requestedScu });
  }
  if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    return getRefuelReadiness(details.serviceType, details);
  }
  if (missionType === "salvage") {
    return getSalvageReadiness();
  }
  if (missionType === "mining") {
    return getMiningReadiness(getMissionServiceDetails(mission).miningMethod);
  }

  return {
    ok: true,
    activeEntry,
    message: cargoText("contracts.transfer.canTake", "{ship} kann diesen Auftrag übernehmen.", { ship: formatFleetEntryDisplayName(activeEntry) }),
  };
}

function transferMissionToActiveShip(mission) {
  const readiness = getMissionTransferReadiness(mission);
  if (!readiness.ok) {
    return;
  }
  const activeLoads = getMissionActiveLoads(mission);
  activeLoads.forEach((load) => {
    load.placement = null;
  });
  setMissionAssignment(mission, {
    fleetEntryId: readiness.activeEntry?.id || currentActiveFleetEntry()?.id || "",
  });
  state.selectedLoadId = activeLoads[0]?.id ?? null;
  state.selectionCleared = !state.selectedLoadId;
  lastUnloadPlan = null;
  persist();
  render();
}

async function deleteActiveMissions(missions) {
  if (!missions.length) return;
  const linkedIncomeCount = missions.filter((mission) => Boolean(getMissionIncomeEntry(mission))).length;
  const ledgerNote = linkedIncomeCount > 0
    ? ` ${cargoText("contracts.bulk.deleteActiveLedgerNote", "Verknüpfte Finanzbuchungen bleiben erhalten: {count}.", { count: linkedIncomeCount })}`
    : "";
  const shouldDelete = await showMissionConfirmDialog({
    kicker: cargoText("contracts.bulk.kicker", "Sammelaktion"),
    title: cargoText("contracts.bulk.deleteActiveTitle", "Alle aktiven Aufträge löschen?"),
    message: `${cargoText("contracts.bulk.deleteActiveMessage", "Betroffene aktive Aufträge: {count}. Ihre Routen, Frachtzuordnungen und Fortschritte werden gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.", { count: missions.length })}${ledgerNote}`,
    confirmLabel: cargoText("contracts.bulk.deleteActiveConfirm", "Aktive löschen"),
    tone: "danger",
  });
  if (!shouldDelete) return;

  const missionIds = new Set(missions.map((mission) => mission.id).filter(Boolean));
  state.missions = state.missions.filter((mission) => !missionIds.has(mission.id));
  missionIds.forEach((missionId) => collapsedMissionIds.delete(missionId));
  if (missionIds.has(getMissionEditId())) resetMissionForm();
  if (state.selectedLoadId && !findLoadById(state.selectedLoadId)) {
    state.selectedLoadId = null;
    state.selectionCleared = false;
  }
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

async function completeActiveMissions(missions) {
  const incompleteMissions = missions.filter((mission) => isMissionIncomplete(mission));
  const splitRequiredMissions = missions.filter((mission) => isMissionPayoutSplitRequired(mission));
  const completableMissions = missions.filter((mission) => !isMissionIncomplete(mission) && !isMissionPayoutSplitRequired(mission));
  if (!completableMissions.length) return;
  const noPayoutCount = completableMissions.filter((mission) => !missionHasPayout(mission)).length;
  const incompleteNote = incompleteMissions.length > 0
    ? ` ${cargoText("contracts.bulk.completeActiveIncompleteNote", "Unvollständig und weiterhin aktiv: {count}.", { count: incompleteMissions.length })}`
    : "";
  const noPayoutNote = noPayoutCount > 0
    ? ` ${cargoText("contracts.bulk.completeActiveNoPayoutNote", "Ohne Verdienst und danach direkt unter Bezahlt: {count}.", { count: noPayoutCount })}`
    : "";
  const splitRequiredNote = splitRequiredMissions.length > 0
    ? ` ${cargoText("contracts.bulk.splitRequiredNote", "Mit mehreren Piloten und noch offener Erlösaufteilung: {count}.", { count: splitRequiredMissions.length })}`
    : "";
  const shouldComplete = await showMissionConfirmDialog({
    kicker: cargoText("contracts.bulk.kicker", "Sammelaktion"),
    title: cargoText("contracts.bulk.completeActiveTitle", "Aktive Aufträge abschließen?"),
    message: `${cargoText("contracts.bulk.completeActiveMessage", "Vollständige aktive Aufträge: {count}. Sie werden abgeschlossen und noch verladene Fracht wird als ausgeladen markiert; es werden noch keine Einnahmen gebucht.", { count: completableMissions.length })}${incompleteNote}${noPayoutNote}${splitRequiredNote}`,
    confirmLabel: cargoText("contracts.bulk.completeActiveConfirm", "Aktive abschließen"),
  });
  if (!shouldComplete) return;

  const completedAt = new Date().toISOString();
  completableMissions.forEach((mission) => {
    unloadMissionLoadsForCompletion(mission, completedAt);
    markMissionCompleted(mission, { completedAt });
    collapsedMissionIds.add(mission.id);
  });
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

async function payCompletedMissions(missions) {
  const splitRequiredMissions = missions.filter((mission) => isMissionPayoutSplitRequired(mission));
  const payableMissions = missions.filter((mission) => !isMissionPayoutSplitRequired(mission));
  if (!payableMissions.length) return;
  const payoutMissions = payableMissions.filter((mission) => missionHasPayout(mission));
  const totalPayout = payoutMissions.reduce((sum, mission) => sum + getMissionPayout(mission), 0);
  const shouldPay = await showMissionConfirmDialog({
    kicker: cargoText("contracts.bulk.kicker", "Sammelaktion"),
    title: cargoText("contracts.bulk.payCompletedTitle", "Alle abgeschlossenen Aufträge bezahlen?"),
    message: cargoText("contracts.bulk.payCompletedMessage", "Abgeschlossene Aufträge: {count}. Sie werden als bezahlt markiert. Für {payoutCount} davon werden Einnahmen über insgesamt {total} in Finanzen gebucht.", {
      count: payableMissions.length,
      payoutCount: payoutMissions.length,
      total: `${totalPayout.toLocaleString(cargoLocale())} aUEC`,
    }) + (splitRequiredMissions.length ? ` ${cargoText("contracts.bulk.splitRequiredNote", "Mit mehreren Piloten und noch offener Erlösaufteilung: {count}.", { count: splitRequiredMissions.length })}` : ""),
    confirmLabel: cargoText("contracts.bulk.payCompletedConfirm", "Alle bezahlt buchen"),
  });
  if (!shouldPay) return;

  const paidAt = new Date().toISOString();
  payableMissions.forEach((mission) => {
    unloadMissionLoadsForCompletion(mission, paidAt);
    markMissionPaid(mission, { paidAt });
    collapsedMissionIds.add(mission.id);
  });
  lastAutoLoadResult = null;
  lastUnloadPlan = null;
  persist();
  render();
}

function isMissionPayoutSplitRequired(mission) {
  return Boolean(
    isDispatcherMode()
    && missionHasPayout(mission)
    && getMissionParticipants(mission).length > 1
    && (!Array.isArray(mission.payoutSplit?.items) || mission.payoutSplit.items.length !== getMissionParticipants(mission).length),
  );
}

function createMissionGroupActions(id, missions) {
  if (!missions.length || !["active", "completed"].includes(id)) return null;
  const actions = document.createElement("div");
  actions.className = "mission-group-actions";

  if (id === "active") {
    const completableCount = missions.filter((mission) => !isMissionIncomplete(mission)).length;
    actions.innerHTML = `
      <button class="secondary-button icon-text-button mission-group-complete-all" type="button"${completableCount ? "" : " disabled"} aria-label="${escapeHtml(cargoText("contracts.bulk.completeActive", "Aktive abschließen"))}" data-tooltip="${escapeHtml(cargoText("contracts.bulk.completeActive", "Aktive abschließen"))}">
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M9.2 16.2 4.8 11.8 3.4 13.2 9.2 19 21 7.2 19.6 5.8 9.2 16.2z" /></svg>
        </span>
        <span>${escapeHtml(cargoText("contracts.bulk.completeActive", "Aktive abschließen"))}</span>
      </button>
      <button class="secondary-button secondary-button-danger icon-text-button mission-group-delete-all" type="button" aria-label="${escapeHtml(cargoText("contracts.bulk.deleteActive", "Aktive löschen"))}" data-tooltip="${escapeHtml(cargoText("contracts.bulk.deleteActive", "Aktive löschen"))}">
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" /></svg>
        </span>
        <span>${escapeHtml(cargoText("contracts.bulk.deleteActive", "Aktive löschen"))}</span>
      </button>
    `;
    actions.querySelector(".mission-group-complete-all")?.addEventListener("click", () => {
      void completeActiveMissions(missions);
    });
    actions.querySelector(".mission-group-delete-all")?.addEventListener("click", () => {
      void deleteActiveMissions(missions);
    });
    return actions;
  }

  actions.innerHTML = `
    <button class="primary-button icon-text-button mission-group-pay-all" type="button" aria-label="${escapeHtml(cargoText("contracts.bulk.payCompleted", "Alle bezahlt buchen"))}" data-tooltip="${escapeHtml(cargoText("contracts.bulk.payCompleted", "Alle bezahlt buchen"))}">
      <span class="button-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false"><path d="M15.8 6.2c-1-.8-2.1-1.2-3.5-1.2-2.7 0-4.7 1.5-5.5 4H5v2h1.4a8 8 0 0 0 0 2H5v2h1.8c.8 2.5 2.8 4 5.5 4 1.4 0 2.6-.4 3.6-1.1l-.9-1.8c-.8.5-1.6.8-2.6.8-1.5 0-2.7-.7-3.3-1.9h4.7v-2H8.6a6.2 6.2 0 0 1 0-2h5.2V9H9.1c.6-1.2 1.8-1.9 3.3-1.9 1 0 1.8.3 2.6.9l.8-1.8z" /></svg>
      </span>
      <span>${escapeHtml(cargoText("contracts.bulk.payCompleted", "Alle bezahlt buchen"))}</span>
    </button>
  `;
  actions.querySelector(".mission-group-pay-all")?.addEventListener("click", () => {
    void payCompletedMissions(missions);
  });
  return actions;
}

function createMissionGroupSection({ id, title, description, missions, mode }) {
  const section = document.createElement("section");
  section.className = `mission-group mission-group-${id}`;
  const bodyId = `missionGroup-${id}`;
  const isCollapsed = collapsedMissionGroupIds.has(id);
  section.innerHTML = `
    <button class="mission-group-toggle" type="button" aria-expanded="${String(!isCollapsed)}" aria-controls="${bodyId}">
      <span class="mission-group-title">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </span>
      <span class="mission-group-count">${missions.length}</span>
      <span class="collapse-indicator" aria-hidden="true"></span>
    </button>
    <div id="${bodyId}" class="mission-group-body"${isCollapsed ? " hidden" : ""}></div>
  `;

  const toggleButton = section.querySelector(".mission-group-toggle");
  const body = section.querySelector(".mission-group-body");
  body.dataset.missionGroup = id;
  if (id === "active") {
    body.classList.add("mission-sortable-list");
  }
  toggleButton.addEventListener("click", () => {
    if (collapsedMissionGroupIds.has(id)) {
      collapsedMissionGroupIds.delete(id);
    } else {
      collapsedMissionGroupIds.add(id);
    }
    render();
  });

  const groupActions = createMissionGroupActions(id, missions);
  if (groupActions) body.appendChild(groupActions);

  if (missions.length === 0) {
    body.innerHTML = `<div class="empty-state">${escapeHtml(cargoText("contracts.groups.empty", "In diesem Bereich sind keine Aufträge vorhanden."))}</div>`;
    return section;
  }

  if (mode === "table") {
    body.appendChild(createPaidMissionsTable(missions));
    return section;
  }

  missions.forEach((mission) => {
    body.appendChild(createMissionCard(mission));
  });

  if (id === "active") {
    body.addEventListener("dragover", (event) => {
      if (!draggedMissionId) return;
      event.preventDefault();
      const targetCard = event.target.closest(".mission-card");
      body.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
      if (!targetCard || targetCard.dataset.missionId === draggedMissionId) return;
      const rect = targetCard.getBoundingClientRect();
      const isAfter = event.clientY > rect.top + rect.height / 2;
      targetCard.classList.add(isAfter ? "is-drag-over-after" : "is-drag-over-before");
    });

    body.addEventListener("dragleave", (event) => {
      if (body.contains(event.relatedTarget)) return;
      body.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
    });

    body.addEventListener("drop", (event) => {
      if (!draggedMissionId) return;
      event.preventDefault();
      const targetCard = event.target.closest(".mission-card");
      body.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
      if (!targetCard) {
        moveActiveMissionToEnd(draggedMissionId);
        draggedMissionId = "";
        return;
      }
      if (targetCard.dataset.missionId === draggedMissionId) {
        draggedMissionId = "";
        return;
      }
      const rect = targetCard.getBoundingClientRect();
      const isAfter = event.clientY > rect.top + rect.height / 2;
      if (!isAfter) {
        moveActiveMissionBefore(draggedMissionId, targetCard.dataset.missionId || "");
        draggedMissionId = "";
        return;
      }
      const activeCards = [...body.querySelectorAll(".mission-card")].filter((card) => card.dataset.missionId !== draggedMissionId);
      const targetIndex = activeCards.indexOf(targetCard);
      const nextCard = activeCards[targetIndex + 1] || null;
      if (nextCard) {
        moveActiveMissionBefore(draggedMissionId, nextCard.dataset.missionId || "");
      } else {
        moveActiveMissionToEnd(draggedMissionId);
      }
      draggedMissionId = "";
    });
  }
  return section;
}

function createPaidMissionsTable(missions) {
  const table = document.createElement("div");
  table.className = "paid-mission-table";
  table.innerHTML = `
    <div class="paid-mission-row is-head">
      <span>${escapeHtml(cargoText("contracts.table.contract", "Auftrag"))}</span>
      <span>${escapeHtml(cargoText("contracts.table.type", "Typ"))}</span>
      <span>${escapeHtml(cargoText("contracts.table.paid", "Bezahlt"))}</span>
      <span>${escapeHtml(cargoText("contracts.table.payout", "Verdienst"))}</span>
      <span></span>
    </div>
    ${missions
      .map((mission) => {
        const payout = missionHasPayout(mission)
          ? `${getMissionPayout(mission).toLocaleString(cargoLocale())} aUEC`
          : cargoText("contracts.table.noPayout", "ohne Verdienst");
        return `
          <div class="paid-mission-row" data-mission-id="${escapeHtml(mission.id)}">
            <span class="paid-mission-title">
              <strong>${escapeHtml(mission.title)}</strong>
              <span>${escapeHtml(summarizeMissionRoute(mission))}</span>
            </span>
            <span>${escapeHtml(getMissionTypeLabel(mission))}</span>
            <span>${escapeHtml(formatMissionPaidAt(mission))}</span>
            <span>${escapeHtml(payout)}</span>
            <span class="paid-mission-actions">
              <button class="secondary-button icon-only-button tooltip-button paid-mission-edit" type="button" aria-label="${escapeHtml(cargoText("common.edit", "Bearbeiten"))}" data-tooltip="${escapeHtml(cargoText("common.edit", "Bearbeiten"))}">
                <span class="button-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M19.4 13.5c.04-.5.04-1 .04-1.5s0-1-.04-1.5l2.1-1.6-2-3.46-2.5 1a7.4 7.4 0 0 0-2.6-1.5L14 2h-4l-.4 2.94a7.4 7.4 0 0 0-2.6 1.5l-2.5-1-2 3.46 2.1 1.6A9.4 9.4 0 0 0 4.56 12c0 .5 0 1 .04 1.5L2.5 15.1l2 3.46 2.5-1a7.4 7.4 0 0 0 2.6 1.5L10 22h4l.4-2.94a7.4 7.4 0 0 0 2.6-1.5l2.5 1 2-3.46-2.1-1.6zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
                  </svg>
                </span>
              </button>
              <button class="ghost-button icon-only-button tooltip-button paid-mission-delete" type="button" aria-label="${escapeHtml(cargoText("contracts.actions.delete", "Auftrag löschen"))}" data-tooltip="${escapeHtml(cargoText("common.delete", "Löschen"))}">
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

  table.querySelectorAll(".paid-mission-edit").forEach((button) => {
    button.addEventListener("click", () => {
      const missionId = button.closest(".paid-mission-row")?.dataset.missionId || "";
      const mission = state.missions.find((entry) => entry.id === missionId);
      if (mission) populateMissionForm(mission);
    });
  });

  table.querySelectorAll(".paid-mission-delete").forEach((button) => {
    button.addEventListener("click", () => {
      const missionId = button.closest(".paid-mission-row")?.dataset.missionId || "";
      const mission = state.missions.find((entry) => entry.id === missionId);
      if (mission) void deleteMissionEntry(mission);
    });
  });

  return table;
}

function decorateMissionShipCard(missionNode, mission) {
  const entry = (state.fleet || []).find((candidate) => candidate.id === mission.assignedFleetEntryId);
  const head = missionNode.querySelector('.mission-head');
  if (!entry || !head) return;
  head.classList.add('ship-art-card', 'mission-ship-card');
  head.insertAdjacentHTML('afterbegin', renderShipCardArt(getFleetMediaEntry(entry)));
  bindShipProfileMedia(head);
}

function createMissionCard(mission) {
  const isCargo = isCargoMission(mission);
  const isDelivery = normalizeMissionType(mission?.type) === "delivery";
  const segments = getMissionSegments(mission);
  const missionStats = getMissionLoadStats(mission);
  const activeMissionLoads = missionStats.activeLoads;
  const deliveredCount = missionStats.deliveredCount;
  const isCompleted = isMissionCompleted(mission);
  const isPaid = isMissionPaid(mission);
  const workflowStatus = getMissionWorkflowStatus(mission);
  const isIncomplete = isMissionIncomplete(mission);
  const completedAt = getMissionCompletedAt(mission);
  const missionNode = missionTemplate.content.firstElementChild.cloneNode(true);
  missionNode.dataset.missionId = mission.id || "";
  decorateMissionShipCard(missionNode, mission);
  missionNode.querySelector(".mission-color").style.background = mission.color;
  missionNode.querySelector(".mission-title").textContent = mission.title;
  missionNode.querySelector(".mission-route").textContent = summarizeMissionRoute(mission);
  missionNode.classList.toggle("is-completed-mission", workflowStatus === "completed");
  missionNode.classList.toggle("is-paid-mission", workflowStatus === "paid");
  missionNode.classList.toggle("is-sortable-mission", isMissionActive(mission));
  if (isMissionActive(mission)) {
    missionNode.draggable = true;
    missionNode.setAttribute("aria-grabbed", "false");
    missionNode.addEventListener("dragstart", (event) => {
      draggedMissionId = mission.id || "";
      missionNode.classList.add("is-dragging");
      missionNode.setAttribute("aria-grabbed", "true");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedMissionId);
    });
    missionNode.addEventListener("dragend", () => {
      draggedMissionId = "";
      missionNode.classList.remove("is-dragging");
      missionNode.setAttribute("aria-grabbed", "false");
      document.querySelectorAll(".mission-card").forEach((card) => {
        card.classList.remove("is-drag-over-before", "is-drag-over-after");
      });
    });
  }

  const missionBody = missionNode.querySelector(".mission-body");
  const dispatchAssignment = missionNode.querySelector(".mission-dispatch-assignment");
  const toggleMissionButton = missionNode.querySelector(".toggle-mission");
  const assignmentWarning = missionNode.querySelector(".mission-assignment-warning");
  const duplicateWarning = missionNode.querySelector(".mission-duplicate-warning");
  const statusBadge = missionNode.querySelector(".mission-status-badge");
  const transferMissionButton = missionNode.querySelector(".transfer-mission");
  const shareMissionButton = missionNode.querySelector(".share-mission");
  const editMissionButton = missionNode.querySelector(".edit-mission");
  const completeMissionButton = missionNode.querySelector(".complete-mission");
  const payMissionButton = missionNode.querySelector(".pay-mission");
  const deleteMissionButton = missionNode.querySelector(".delete-mission");
  const isCollapsed = collapsedMissionIds.has(mission.id);
  missionNode.classList.toggle("is-collapsed", isCollapsed);
  missionBody.hidden = isCollapsed;
  toggleMissionButton.setAttribute("aria-expanded", String(!isCollapsed));
  toggleMissionButton.setAttribute(
    "title",
    isCollapsed
      ? cargoText("contracts.actions.expand", "Auftrag ausklappen")
      : cargoText("contracts.actions.collapse", "Auftrag einklappen"),
  );

  if (assignmentWarning) {
    const assignmentWarningText = getMissionAssignmentWarning(mission);
    assignmentWarning.hidden = !assignmentWarningText;
    const warningFallback = cargoText("contracts.actions.checkAssignment", "Schiffszuordnung prüfen");
    assignmentWarning.setAttribute("title", assignmentWarningText || warningFallback);
    assignmentWarning.setAttribute("aria-label", assignmentWarningText || warningFallback);
    assignmentWarning.dataset.tooltip = assignmentWarningText || warningFallback;
  }

  const duplicateInfo = getMissionDuplicateWarning(mission);
  if (duplicateWarning) {
    duplicateWarning.hidden = duplicateInfo.matches.length === 0;
    const duplicateFallback = cargoText("contracts.duplicate.title", "Möglicher Doppelauftrag");
    duplicateWarning.setAttribute("title", duplicateInfo.text || duplicateFallback);
    duplicateWarning.setAttribute("aria-label", duplicateInfo.text || duplicateFallback);
    duplicateWarning.dataset.tooltip = duplicateInfo.text || duplicateFallback;
  }

  if (transferMissionButton) {
    const transferReadiness = getMissionTransferReadiness(mission);
    const canTransfer = Boolean(getMissionAssignmentWarning(mission)) && transferReadiness.ok;
    transferMissionButton.hidden = !canTransfer;
    const transferLabel = transferReadiness.activeEntry
      ? cargoText("contracts.actions.transferTo", "Auf {ship} umladen", { ship: formatFleetEntryDisplayName(transferReadiness.activeEntry) })
      : cargoText("contracts.actions.assignActiveShip", "Auftrag aktivem Schiff zuordnen");
    transferMissionButton.setAttribute("aria-label", transferLabel);
    transferMissionButton.setAttribute("title", transferLabel);
    transferMissionButton.dataset.tooltip = transferLabel;
    transferMissionButton.addEventListener("click", () => {
      transferMissionToActiveShip(mission);
    });
  }

  if (shareMissionButton) shareMissionButton.remove();

  if (statusBadge) {
    statusBadge.hidden = false;
    statusBadge.textContent = isIncomplete ? cargoText("contracts.workflow.incomplete", "Unvollständig") : getMissionWorkflowLabel(mission);
    statusBadge.classList.toggle("is-open", workflowStatus === "active" && !isIncomplete);
    statusBadge.classList.toggle("is-paid", workflowStatus === "paid");
    statusBadge.classList.toggle("is-incomplete", isIncomplete);
    statusBadge.title = isIncomplete
      ? getMissionIncompleteReasons(mission).join(" · ")
      : completedAt
      ? `${getMissionWorkflowLabel(mission)} am ${formatDateTimeDisplay(completedAt)}`
      : getMissionWorkflowLabel(mission);
  }

  const assignedCount = missionStats.placedCount;
  const totalScu = segments.reduce((sum, segment) => sum + (Number(segment.totalScu) || 0), 0);
  const maxContainerScu = normalizeMissionMaxContainerScu(mission.maxContainerScu);
  const pilotGroup = getPilotGroupForMission(mission.id);
  const pilotGroupLabel = pilotGroup
    ? cargoText("contracts.meta.pilotGroup", "Einsatzgruppe: {name}", { name: pilotGroup.name })
    : "";
  const payoutLabel = mission.payout ? ` | ${mission.payout.toLocaleString(cargoLocale())} aUEC` : "";
  const assignedShipLabel = ` | ${formatMissionAssignedShip(mission)}`;
  missionNode.querySelector(".mission-meta").textContent =
    isCargo
      ? [
          isDelivery ? getMissionTypeLabel(mission) : "",
          cargoText(segments.length === 1 ? "contracts.meta.cargoOne" : "contracts.meta.cargoMany", "{count} Teilfrachten", { count: segments.length }),
          cargoText("contracts.meta.active", "{count} aktiv", { count: activeMissionLoads.length }),
          cargoText("contracts.meta.placed", "{count} platziert", { count: assignedCount }),
          isIncomplete ? cargoText("contracts.incomplete.pickupAmountOpen", "Abholmenge offen") : "",
          deliveredCount > 0 ? cargoText("contracts.meta.delivered", "{count} geliefert", { count: deliveredCount }) : "",
          formatScuAmount(totalScu),
          maxContainerScu ? cargoText("contracts.meta.maxContainer", "Max. Container: {value}", { value: `${maxContainerScu} SCU` }) : "",
          formatMissionAssignedShip(mission),
          formatMissionAssignedPilot(mission),
          formatMissionTransportSummary(mission),
          formatMissionPayoutSplit(mission),
          pilotGroupLabel,
          mission.organizationLink?.missionId ? cargoText("contracts.meta.organizationShared", "Organisation geteilt") : "",
          mission.sourceImportId ? cargoText("contracts.meta.gameImport", "Spielimport") : "",
          duplicateInfo.matches.length > 0 ? cargoText("contracts.duplicate.meta", "ähnlicher Auftrag vorhanden") : "",
          isCompleted && completedAt ? cargoText("contracts.meta.completedAt", "abgeschlossen {value}", { value: formatDateTimeDisplay(completedAt) }) : "",
          mission.payout ? `${mission.payout.toLocaleString(cargoLocale())} aUEC` : "",
        ].filter(Boolean).join(" | ")
      : [
          getMissionTypeLabel(mission),
          isCompleted && completedAt ? cargoText("contracts.meta.completedAt", "abgeschlossen {value}", { value: formatDateTimeDisplay(completedAt) }) : cargoText("common.active", "Aktiv").toLowerCase(),
          formatMissionAssignedShip(mission),
          formatMissionAssignedPilot(mission),
          formatMissionTransportSummary(mission),
          formatMissionPayoutSplit(mission),
          pilotGroupLabel,
          mission.organizationLink?.missionId ? cargoText("contracts.meta.organizationShared", "Organisation geteilt") : "",
          mission.sourceImportId ? cargoText("contracts.meta.gameImport", "Spielimport") : "",
          duplicateInfo.matches.length > 0 ? cargoText("contracts.duplicate.meta", "ähnlicher Auftrag vorhanden") : "",
          mission.payout ? `${mission.payout.toLocaleString(cargoLocale())} aUEC` : "",
        ].filter(Boolean).join(" | ");

  renderMissionDispatcherAssignment(dispatchAssignment, mission);

  const segmentList = missionNode.querySelector(".mission-segments");
  segmentList.innerHTML = isDelivery
    ? renderServiceMissionCards(mission)
    : isCargo
    ? segments
      .map(
        (segment) => `
          <article class="mission-segment${segment.quantityPending ? " is-incomplete" : ""}">
            <strong>${escapeHtml(segment.title)}</strong>
            <p>${escapeHtml(segment.pickup)} → ${escapeHtml(segment.dropoff)}</p>
            <p>${escapeHtml(formatMissionSegmentCargo(segment))}</p>
          </article>
        `,
      )
      .join("")
    : renderServiceMissionCards(mission);

  const slotSummary = activeMissionLoads
    .filter((load) => load.placement)
    .map((load) => {
      const dims = getLoadDimensions(load, placementRotation(load));
      return `${load.placement.slotId} (${dims.width}×${dims.depth}×${dims.height})`;
    })
    .sort((left, right) => left.localeCompare(right));
  missionNode.querySelector(".mission-slots").textContent =
    isCargo
      ? slotSummary.length > 0
        ? cargoText("contracts.positions.list", "Positionen: {value}", { value: slotSummary.join(", ") })
        : cargoText("contracts.positions.none", "Positionen: noch keine Zuordnung")
      : "";
  missionNode.querySelector(".mission-notes").textContent = mission.notes;

  const containerList = missionNode.querySelector(".container-list");
  if (!isCargo) {
    containerList.hidden = true;
    containerList.innerHTML = "";
  } else if (activeMissionLoads.length === 0) {
    containerList.hidden = false;
    containerList.innerHTML = `<div class="empty-state mission-complete-note">${escapeHtml(
      isIncomplete
        ? cargoText("contracts.incomplete.noLoads", "Für die offenen Abholmengen wurden noch keine Container erzeugt.")
        : cargoText("contracts.empty.allUnloaded", "Alle Raster-Container dieses Auftrags wurden ausgeladen."),
    )}</div>`;
  } else {
    containerList.hidden = false;
    const canUseCurrentGrid = canMissionUseCurrentCargoGrid(mission);
    const canEditCargo = !isDispatcherMode() && canUseCurrentGrid;
    activeMissionLoads.forEach((load) => {
      const item = document.createElement("div");
      item.className = "container-item";
      if (state.selectedLoadId === load.id) {
        item.classList.add("active");
      }

      const dims = getLoadDimensions(load);
      const location = load.placement
        ? `${load.placement.slotId} | z ${load.placement.z} | ${formatDimensions(load, placementRotation(load))}`
        : cargoText("contracts.location.notPlaced", "Noch nicht platziert");
      item.innerHTML = `
        <div>
          <div class="container-label">${escapeHtml(load.label)}</div>
          <div class="container-meta">${escapeHtml(formatLoadRoute(load, mission))}</div>
          <div class="container-meta">${dims.width}×${dims.depth}×${dims.height} · ${load.scu} SCU · ${escapeHtml(location)}</div>
        </div>
        <div class="container-actions">
          <span class="pill">${escapeHtml(getLoadDropoff(load, mission))}</span>
          <button class="secondary-button rotate-load" type="button"${canEditCargo ? "" : " disabled"}>${escapeHtml(cargoText("common.rotate", "Drehen"))}</button>
          <button class="secondary-button select-container" type="button"${canEditCargo ? "" : " disabled"}>
            ${escapeHtml(state.selectedLoadId === load.id ? cargoText("common.selected", "Ausgewählt") : cargoText("common.select", "Auswählen"))}
          </button>
        </div>
      `;

      if (isDispatcherMode()) {
        item.querySelectorAll(".rotate-load, .select-container").forEach((button) => {
          button.hidden = true;
        });
      }

      item.querySelector(".rotate-load").addEventListener("click", () => {
        if (!canEditCargo) return;
        rotateLoad(load);
      });

      item.querySelector(".select-container").addEventListener("click", () => {
        if (!canEditCargo) return;
        state.selectedLoadId = load.id;
        state.selectionCleared = false;
        persist();
        render();
      });

      containerList.appendChild(item);
    });
  }

  if (completeMissionButton) {
    const completeLabel = isIncomplete
      ? cargoText("contracts.actions.completeDetails", "Angaben vervollständigen")
      : cargoText("contracts.actions.complete", "Abschließen");
    completeMissionButton.setAttribute("aria-label", completeLabel);
    completeMissionButton.setAttribute("title", completeLabel);
    completeMissionButton.dataset.tooltip = completeLabel;
    const canCompleteDirectly = !isCompleted && !isPaid
      && (isDispatcherMode() || !mission.organizationLink?.missionId)
      && isOrganizationMissionReadyForCompletion(mission);
    completeMissionButton.hidden = !canCompleteDirectly;
    completeMissionButton.addEventListener("click", () => {
      if (isIncomplete) {
        populateMissionForm(mission);
      } else {
        completeMission(mission.id);
      }
    });
  }

  if (payMissionButton) {
    const canBookPayment = missionHasPayout(mission) && !isPaid && !isIncomplete
      && (isDispatcherMode() || !mission.organizationLink?.missionId)
      && isOrganizationMissionReadyForCompletion(mission);
    payMissionButton.hidden = !canBookPayment;
    const payLabel = isCompleted
      ? cargoText("contracts.actions.bookPayment", "Zahlung buchen")
      : cargoText("contracts.actions.completeAndPay", "Abschließen und bezahlen");
    payMissionButton.setAttribute("aria-label", payLabel);
    payMissionButton.setAttribute("title", payLabel);
    payMissionButton.dataset.tooltip = payLabel;
    payMissionButton.addEventListener("click", () => {
      if (isCompleted) {
        payMission(mission.id);
      } else {
        completeMission(mission.id, { bookIncome: true });
      }
    });
  }

  if (editMissionButton) {
    const editLabel = cargoText("common.edit", "Bearbeiten");
    editMissionButton.setAttribute("aria-label", editLabel);
    editMissionButton.setAttribute("title", editLabel);
    editMissionButton.dataset.tooltip = editLabel;
    editMissionButton.hidden = false;
    editMissionButton.addEventListener("click", () => {
      populateMissionForm(mission);
    });
  }

  if (deleteMissionButton) {
    const deleteLabel = cargoText("common.delete", "Löschen");
    deleteMissionButton.setAttribute("aria-label", cargoText("contracts.actions.delete", "Auftrag löschen"));
    deleteMissionButton.setAttribute("title", cargoText("contracts.actions.delete", "Auftrag löschen"));
    deleteMissionButton.dataset.tooltip = deleteLabel;
    deleteMissionButton.addEventListener("click", () => {
      void deleteMissionEntry(mission);
    });
  }

  toggleMissionButton.addEventListener("click", () => {
    toggleMissionCard(mission);
  });

  return missionNode;
}

function renderMissions() {
  emptyState.hidden = state.missions.length > 0;
  missionsList.innerHTML = "";

  if (state.missions.length === 0) {
    return;
  }

  const byCompletedDesc = (left, right) => {
    const rightDate = new Date(right.paidAt || getMissionCompletedAt(right) || right.createdAt || 0).getTime();
    const leftDate = new Date(left.paidAt || getMissionCompletedAt(left) || left.createdAt || 0).getTime();
    return rightDate - leftDate;
  };
  const activeMissions = state.missions.filter((mission) => isMissionActive(mission));
  const completedMissions = state.missions
    .filter((mission) => isMissionCompleted(mission) && !isMissionPaid(mission))
    .sort(byCompletedDesc);
  const paidMissions = state.missions
    .filter((mission) => isMissionPaid(mission))
    .sort(byCompletedDesc);

  [
    {
      id: "active",
      title: cargoText("contracts.groups.active.title", "Aktiv"),
      description: cargoText("contracts.groups.active.description", "Offene Aufträge, die noch geflogen, geliefert oder erledigt werden müssen."),
      missions: activeMissions,
      mode: "cards",
    },
    {
      id: "completed",
      title: cargoText("contracts.groups.completed.title", "Abgeschlossen"),
      description: cargoText("contracts.groups.completed.description", "Erledigte Aufträge, die noch nicht als bezahlt gebucht wurden."),
      missions: completedMissions,
      mode: "cards",
    },
    {
      id: "paid",
      title: cargoText("contracts.groups.paid.title", "Bezahlt"),
      description: cargoText("contracts.groups.paid.description", "Erledigte Aufträge mit gebuchter Zahlung oder ohne Verdienst."),
      missions: paidMissions,
      mode: "table",
    },
  ].forEach((group) => {
    missionsList.appendChild(createMissionGroupSection(group));
  });
}

function renderHomeLoads() {
  const entries = getAllLoads().filter(({ mission, load }) =>
    !isLoadDelivered(load) && canMissionUseCurrentCargoGrid(mission),
  );
  const placedCount = getPlacedLoadEntries().length;
  const selectedEntry = findLoadById(state.selectedLoadId);
  const unplacedCount = entries.length - placedCount;
  const loadAutoloadOptions = document.querySelector("#loadAutoloadOptions");
  if (loadAutoloadOptions) loadAutoloadOptions.hidden = entries.length === 0;

  homeLoadSummary.innerHTML = `
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(cargoText("contracts.load.selected", "Ausgewählte Ladung"))}</span>
      <strong>${escapeHtml(selectedEntry?.load?.label || cargoText("common.none", "Keine"))}</strong>
    </div>
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(cargoText("contracts.load.open", "Noch offen"))}</span>
      <strong>${unplacedCount}</strong>
    </div>
    <div class="summary-card summary-card-compact">
      <span>${escapeHtml(cargoText("contracts.load.inShip", "Bereits im Schiff"))}</span>
      <strong>${placedCount}</strong>
    </div>
  `;

  if (entries.length === 0) {
    homeLoadList.innerHTML = `<div class="empty-state">${escapeHtml(cargoText("contracts.empty.loads", "Noch keine Ladungen vorhanden. Erstelle zuerst auf der Seite „Auftrag anlegen“ deinen ersten Frachtauftrag."))}</div>`;
    return;
  }

  homeLoadList.innerHTML = "";

  state.missions.forEach((mission) => {
    if (!canMissionUseCurrentCargoGrid(mission)) {
      return;
    }
    const activeMissionLoads = getMissionActiveLoads(mission);
    if (activeMissionLoads.length === 0) {
      return;
    }
    const missionNode = missionTemplate.content.firstElementChild.cloneNode(true);
    missionNode.classList.add("mission-card-queue");
    decorateMissionShipCard(missionNode, mission);
    if (activeMissionLoads.some((load) => load.id === state.selectedLoadId)) {
      missionNode.classList.add("is-active-load");
    }

    missionNode.querySelector(".mission-color").style.background = mission.color;
    missionNode.querySelector(".mission-title").textContent = mission.title;
    missionNode.querySelector(".mission-route").textContent = summarizeMissionRoute(mission);

    const missionBody = missionNode.querySelector(".mission-body");
    const toggleMissionButton = missionNode.querySelector(".toggle-mission");
    const deleteMissionButton = missionNode.querySelector(".delete-mission");
    const statusBadge = missionNode.querySelector(".mission-status-badge");
    const editMissionButton = missionNode.querySelector(".edit-mission");
    const completeMissionButton = missionNode.querySelector(".complete-mission");
    const payMissionButton = missionNode.querySelector(".pay-mission");
    if (statusBadge) statusBadge.hidden = true;
    if (editMissionButton) editMissionButton.hidden = true;
    if (completeMissionButton) completeMissionButton.hidden = true;
    if (payMissionButton) payMissionButton.hidden = true;
    if (deleteMissionButton) {
      deleteMissionButton.setAttribute("aria-label", cargoText("contracts.actions.delete", "Auftrag löschen"));
      deleteMissionButton.setAttribute("title", cargoText("contracts.actions.delete", "Auftrag löschen"));
      deleteMissionButton.dataset.tooltip = cargoText("common.delete", "Löschen");
    }
    const isCollapsed = collapsedMissionIds.has(mission.id);
    missionNode.classList.toggle("is-collapsed", isCollapsed);
    missionBody.hidden = isCollapsed;
    toggleMissionButton.setAttribute("aria-expanded", String(!isCollapsed));
    toggleMissionButton.setAttribute(
      "title",
      isCollapsed
        ? cargoText("contracts.actions.expand", "Auftrag ausklappen")
        : cargoText("contracts.actions.collapse", "Auftrag einklappen"),
    );

    const assignedCount = activeMissionLoads.filter((load) => load.placement).length;
    const totalScu = getMissionSegments(mission).reduce((sum, segment) => sum + (Number(segment.totalScu) || 0), 0);
    const deliveredCount = (Array.isArray(mission.loads) ? mission.loads : []).filter((load) => isLoadDelivered(load)).length;
    const openCount = activeMissionLoads.length - assignedCount;
    const payoutLabel = mission.payout ? ` | ${mission.payout.toLocaleString(cargoLocale())} aUEC` : "";
    missionNode.querySelector(".mission-meta").textContent =
      [
        cargoText("contracts.meta.active", "{count} aktiv", { count: activeMissionLoads.length }),
        cargoText("contracts.meta.open", "{count} offen", { count: openCount }),
        cargoText("contracts.meta.inShip", "{count} im Schiff", { count: assignedCount }),
        deliveredCount > 0 ? cargoText("contracts.meta.delivered", "{count} geliefert", { count: deliveredCount }) : "",
        formatScuAmount(totalScu),
        mission.payout ? `${mission.payout.toLocaleString(cargoLocale())} aUEC` : "",
      ].filter(Boolean).join(" | ");

    missionNode.querySelector(".mission-segments").hidden = true;
    missionNode.querySelector(".mission-slots").hidden = true;

    const notes = missionNode.querySelector(".mission-notes");
    notes.textContent = mission.notes;
    notes.hidden = !mission.notes;

    const containerList = missionNode.querySelector(".container-list");
    const unplacedMissionLoadCount = activeMissionLoads.filter((load) => !load.placement).length;
    const autoLoadResult = lastAutoLoadResult?.missionId === mission.id ? lastAutoLoadResult : null;
    const autoLoadActions = document.createElement("div");
    autoLoadActions.className = "mission-autoload-actions";
    autoLoadActions.innerHTML = `
      <button
        class="primary-button mission-autoload-button"
        type="button"
        aria-label="${escapeHtml(cargoText("contracts.load.autoloadTooltip", "Auftrag automatisch verladen"))}"
        data-tooltip="${escapeHtml(cargoText("contracts.load.autoloadTooltip", "Auftrag automatisch verladen"))}"
        ${unplacedMissionLoadCount === 0 ? "disabled" : ""}
      >
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm11-4h2v5.2l1.6-1.6L21 17l-4 4-4-4 1.4-1.4 1.6 1.6V12z" />
          </svg>
        </span>
        <span>${escapeHtml(cargoText("contracts.load.autoload", "Autoload"))}</span>
      </button>
      ${autoLoadResult
        ? `<span class="mission-autoload-result${autoLoadResult.skippedCount > 0 || autoLoadResult.overloadCount > 0 ? " is-warning" : ""}">${escapeHtml(
            formatAutoloadResultWithOverload(autoLoadResult, autoLoadResult.placedCount === 0
              ? cargoText("contracts.load.autoloadNone", "Kein passender Platz gefunden")
              : autoLoadResult.skippedCount > 0
                ? cargoText("contracts.load.autoloadPartial", "{placed} verladen · {skipped} ohne passenden Platz", {
                    placed: autoLoadResult.placedCount,
                    skipped: autoLoadResult.skippedCount,
                  })
                : cargoText("contracts.load.autoloadSuccess", "{count} Container verladen", { count: autoLoadResult.placedCount })),
          )}</span>`
        : ""}
    `;
    autoLoadActions.querySelector(".mission-autoload-button")?.addEventListener("click", () => {
      autoLoadMission(mission);
    });
    missionBody.insertBefore(autoLoadActions, containerList);

    const sortedLoads = [...activeMissionLoads].sort((left, right) => {
      if (left.id === state.selectedLoadId) return -1;
      if (right.id === state.selectedLoadId) return 1;
      if (Boolean(left.placement) !== Boolean(right.placement)) {
        return left.placement ? 1 : -1;
      }
      const leftSegment = mission.segments?.find((segment) => segment.id === left.segmentId)?.order ?? 0;
      const rightSegment = mission.segments?.find((segment) => segment.id === right.segmentId)?.order ?? 0;
      if (leftSegment !== rightSegment) return leftSegment - rightSegment;
      return left.label.localeCompare(right.label, "de", { numeric: true });
    });

    sortedLoads.forEach((load) => {
      const dims = getLoadDimensions(load, placementRotation(load));
      const location = load.placement
        ? `${load.placement.slotId} | z ${load.placement.z} | ${formatDimensions(load, placementRotation(load))}`
        : cargoText("contracts.location.notInShip", "Noch nicht im Schiff");
      const item = document.createElement("div");
      item.className = "container-item load-queue-item";
      item.dataset.loadId = load.id;
      if (state.selectedLoadId === load.id) {
        item.classList.add("active", "is-active");
      }
      if (isLoadInSelectedStop(load, mission)) {
        item.classList.add("is-stop-target");
      }

      item.innerHTML = `
        <div>
          <div class="container-label">${escapeHtml(load.label)}</div>
          <div class="container-meta">${escapeHtml(formatLoadRoute(load, mission))}</div>
          <div class="container-meta">${dims.width}×${dims.depth}×${dims.height} · ${load.scu} SCU · ${escapeHtml(location)}</div>
        </div>
        <div class="container-actions load-queue-actions">
          ${load.placement ? `<button class="secondary-button load-queue-unload" type="button">${escapeHtml(cargoText("contracts.load.unload", "Ausladen"))}</button>` : ""}
          <button class="secondary-button load-queue-rotate" type="button">${escapeHtml(cargoText("common.rotate", "Drehen"))}</button>
          <button class="secondary-button load-queue-select" type="button">${escapeHtml(state.selectedLoadId === load.id ? cargoText("common.deselect", "Abwählen") : cargoText("common.select", "Auswählen"))}</button>
        </div>
      `;

      item.querySelector(".load-queue-unload")?.addEventListener("click", () => {
        unloadLoad(load);
      });

      item.querySelector(".load-queue-rotate")?.addEventListener("click", () => {
        rotateLoad(load);
      });

      item.querySelector(".load-queue-select")?.addEventListener("click", () => {
        if (state.selectedLoadId === load.id) {
          state.selectedLoadId = null;
          state.selectionCleared = true;
        } else {
          state.selectedLoadId = load.id;
          state.selectionCleared = false;
        }
        persist();
        render();
      });

      containerList.appendChild(item);
    });

    deleteMissionButton.addEventListener("click", () => {
      void deleteMissionEntry(mission);
    });

    toggleMissionButton.addEventListener("click", () => {
      if (collapsedMissionIds.has(mission.id)) {
        collapsedMissionIds.delete(mission.id);
      } else {
        collapsedMissionIds.add(mission.id);
      }
      render();
    });

    homeLoadList.appendChild(missionNode);
  });
}

function renderManifest() {
  const entries = getPlacedLoadEntries()
    .sort((left, right) => {
      const slotCompare = left.load.placement.slotId.localeCompare(right.load.placement.slotId, "de", { numeric: true });
      if (slotCompare !== 0) return slotCompare;
      return left.load.placement.z - right.load.placement.z;
    });

  manifestEmpty.hidden = entries.length > 0;
  manifestList.innerHTML = "";

  if (entries.length === 0) {
    return;
  }

  manifestList.innerHTML = entries
    .map(({ mission, load }) => {
      const dims = getLoadDimensions(load, placementRotation(load));
      const isStopTarget = isLoadInSelectedStop(load, mission);
      return `
        <article class="manifest-item${isStopTarget ? " is-stop-target" : ""}" data-load-id="${load.id}">
          <div class="manifest-slot">${escapeHtml(load.placement.slotId)}</div>
          <div class="manifest-main">
            <strong>${escapeHtml(load.label)}</strong>
            <p>${escapeHtml(mission.title)} · ${escapeHtml(formatLoadRoute(load, mission))}</p>
          </div>
          <div class="manifest-meta">
            <span>z ${load.placement.z}</span>
            <span>${dims.width}×${dims.depth}×${dims.height}</span>
            <span>${load.scu} SCU</span>
          </div>
          <button class="secondary-button manifest-select" type="button">${escapeHtml(cargoText("common.show", "Anzeigen"))}</button>
        </article>
      `;
    })
    .join("");

  manifestList.querySelectorAll(".manifest-item").forEach((node) => {
    node.querySelector(".manifest-select")?.addEventListener("click", () => {
      state.selectedLoadId = node.dataset.loadId || null;
      state.selectionCleared = false;
      persist();
      render();
    });
  });
}

function renderStopList() {
  if (!stopList || !stopListEmpty) return;
  const hasCargoShip = hasShipCargoGrid(currentActiveShipProfile());
  const placedEntries = getPlacedLoadEntries();
  const stops = buildUnloadStops();
  const displayStops = stops.filter((stop) => stop.placedLoads.length > 0);
  const shouldShow = hasCargoShip && placedEntries.length > 0 && displayStops.length > 0;

  if (unloadPlanPanel) {
    unloadPlanPanel.hidden = !shouldShow;
  }

  if (!shouldShow) {
    lastUnloadPlan = null;
    syncStopControls([]);
    if (unloadPlanResult) {
      unloadPlanResult.hidden = true;
      unloadPlanResult.innerHTML = "";
    }
    stopListEmpty.hidden = false;
    stopList.innerHTML = "";
    return;
  }

  syncStopControls(displayStops);
  renderUnloadPlanResult();

  stopListEmpty.hidden = displayStops.length > 0;
  stopList.innerHTML = "";

  stopList.innerHTML = displayStops
    .map((stop, index) => {
      const isSelectedStop = Boolean(state.selectedStopDropoff) && stop.dropoff === state.selectedStopDropoff;
      const analysis = stop.analysis;
      const slotSummary = stop.placedLoads
        .map(({ load }) => load.placement?.slotId)
        .filter(Boolean)
        .slice(0, 6)
        .join(", ");
      const remainingSlots = Math.max(stop.placedLoads.length - 6, 0);
      const slotText = slotSummary
        ? `${slotSummary}${remainingSlots > 0 ? ` +${remainingSlots}` : ""}`
        : cargoText("contracts.stop.nothingInShip", "Noch nichts im Schiff");
      const blockerText = formatUnloadBlockerSummary(analysis.blockers);
      const selectedWarning = isSelectedStop && blockerText
        ? `
          <div class="stop-warning">
            <strong>${escapeHtml(cargoText("contracts.stop.blockedDetailsTitle", "Diese Container blockieren die Entladung"))}</strong>
            ${renderUnloadBlockerDetails(analysis)}
          </div>
        `
        : "";
      const unloadDisabled = analysis.status !== "ready";
      const unloadTitle = unloadDisabled
        ? getStopActionHint(analysis)
        : cargoText("contracts.stop.completeTitle", "Diesen Stop als abgeschlossen markieren und alle geladenen Container daraus in die Historie verschieben.");
      const cargoGroups = buildStopCargoGroups(stop.dropoff);
      const cargoGroupRows = cargoGroups.map((group) => {
        const deliverDisabled = group.analysis.status !== "ready";
        const deliverLabel = cargoText("contracts.actions.deliverCargo", "Abliefern");
        const deliverTooltip = deliverDisabled
          ? getStopActionHint(group.analysis)
          : cargoText("contracts.stop.deliverCargo", "Nur diese Fracht am Ziel abliefern.");
        return `
          <div class="stop-cargo-row stop-cargo-status-${escapeHtml(group.analysis.status)}">
            <div class="stop-cargo-copy">
              <strong>${escapeHtml(group.label)}</strong>
              <span>${escapeHtml(group.mission.title)}</span>
            </div>
            <div class="stop-cargo-meta">
              <span>${formatScuAmount(group.totalScu)}</span>
              <span>${escapeHtml(cargoText("contracts.stop.inShip", "{placed}/{total} im Schiff", {
                placed: group.placedEntries.length,
                total: group.entries.length,
              }))}</span>
              <span>${escapeHtml(getStopStatusLabel(group.analysis.status))}</span>
            </div>
            <button
              class="secondary-button stop-cargo-deliver tooltip-button"
              type="button"
              data-dropoff="${escapeHtml(stop.dropoff)}"
              data-group-key="${escapeHtml(group.key)}"
              aria-label="${escapeHtml(`${group.label}: ${deliverLabel}`)}"
              data-tooltip="${escapeHtml(deliverTooltip)}"
              ${deliverDisabled ? "disabled" : ""}
            >
              <span class="button-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20 8.5V6.8a2 2 0 0 0-1-1.7l-6-3.4a2 2 0 0 0-2 0l-6 3.4a2 2 0 0 0-1 1.7v6.4a2 2 0 0 0 1 1.7l5 2.9" />
                  <path d="m4.3 5.8 7.7 4.4 7.7-4.4M12 10.2v8.6m4-1.8 2 2 4-4" />
                </svg>
              </span>
              <span>${escapeHtml(deliverLabel)}</span>
            </button>
          </div>
        `;
      }).join("");

      return `
        <article class="stop-item stop-status-${analysis.status}${isSelectedStop ? " is-selected-stop" : ""}">
          <div class="stop-index">${String(index + 1).padStart(2, "0")}</div>
          <div class="stop-main">
            <strong>${escapeHtml(stop.dropoff)}</strong>
            <p>${escapeHtml(stop.pickups.join(" · ") || cargoText("contracts.stop.pickupOpen", "Abholung offen"))}</p>
            <div class="stop-chips">
              <span class="stop-status-badge">${escapeHtml(getStopStatusLabel(analysis.status))}</span>
              <span>${formatScuAmount(stop.totalScu)}</span>
              <span>${escapeHtml(cargoText("contracts.stop.containerCount", "{count} Container", { count: stop.containerCount }))}</span>
              <span>${escapeHtml(cargoText("contracts.stop.inShip", "{placed}/{total} im Schiff", { placed: stop.placedLoads.length, total: stop.placeableCount }))}</span>
            </div>
            <div class="stop-cargo-groups">${cargoGroupRows}</div>
            ${selectedWarning}
          </div>
          <div class="stop-side">
            <div class="stop-slots">${escapeHtml(slotText)}</div>
            <button class="secondary-button stop-select" type="button" data-dropoff="${escapeHtml(stop.dropoff)}">
              ${escapeHtml(isSelectedStop ? cargoText("contracts.stop.active", "Aktiv") : cargoText("contracts.stop.selectNext", "Als nächstes"))}
            </button>
            <button class="secondary-button stop-unload" type="button" data-dropoff="${escapeHtml(stop.dropoff)}" title="${escapeHtml(unloadTitle)}" ${unloadDisabled ? "disabled" : ""}>
              ${escapeHtml(cargoText("contracts.route.completeStop", "Stop abschließen"))}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  stopList.querySelectorAll(".stop-select").forEach((button) => {
    button.addEventListener("click", () => {
      selectStopByDropoff(button.dataset.dropoff || "");
      persist();
      render();
    });
  });

  stopList.querySelectorAll(".stop-unload").forEach((button) => {
    button.addEventListener("click", () => {
      completeStop(button.dataset.dropoff || "");
    });
  });
  stopList.querySelectorAll(".stop-cargo-deliver").forEach((button) => {
    button.addEventListener("click", async () => {
      await deliverStopCargoGroup(button.dataset.dropoff || "", button.dataset.groupKey || "");
    });
  });
  bindUnloadGuidanceEvents(stopList);
  normalizeAppTooltipTitles(stopList);
}

function renderRouteProgress() {
  if (!routeProgressBar) return;
  const routeState = buildFlightRouteState();
  if (routeState.routeStops.length === 0) {
    routeProgressBar.hidden = true;
    routeProgressBar.innerHTML = "";
    return;
  }
  routeProgressBar.hidden = false;
  const unloadStops = buildUnloadStops();
  const currentRouteStop = routeState.currentStop;
  const currentCargoStop = currentRouteStop?.hasCargo
    ? unloadStops.find((stop) => stop.dropoff === currentRouteStop.dropoff) || null
    : null;
  const canCompleteCargo = Boolean(currentCargoStop && currentCargoStop.placeableCount > 0 && currentCargoStop.analysis.status === "ready");
  const canCompleteService = Boolean(currentRouteStop?.activeServiceMissionIds?.length);
  const completeDisabled = !currentRouteStop || (!canCompleteCargo && !canCompleteService);
  const advanceDisabled = !routeState.nextDropoff;
  const routeFinished = routeState.routeStops.length > 0 && routeState.openStops === 0;
  const serviceStopCount = routeState.routeStops.filter((stop) => stop.hasService).length;
  let routeHint = serviceStopCount > 0 || routeState.pickups.length > 0
    ? cargoText("contracts.route.fromMatching", "Route aus den passenden Auftragspunkten des aktiven Schiffs.")
    : cargoText("contracts.route.waiting", "Sobald passende Aufträge für das aktive Schiff vorhanden sind, erscheint hier deine Route.");
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (dispatcherMode) {
    routeHint = serviceStopCount > 0 || routeState.pickups.length > 0
      ? cargoText("contracts.route.dispatchFromActive", "Route aus offenen Dispositionspunkten.")
      : cargoText("contracts.route.dispatchWaiting", "Sobald offene Auftraege vorhanden sind, erscheint hier die Dispatcher-Route.");
  }
  const currentStopParts = [];
  if (currentCargoStop) {
    currentStopParts.push(`${getStopStatusLabel(currentCargoStop.analysis.status)} · ${currentCargoStop.placedLoads.length}/${currentCargoStop.placeableCount} Container im Schiff`);
  }
  if (canCompleteService) {
    currentStopParts.push(cargoText(
      currentRouteStop.activeServiceMissionIds.length === 1 ? "contracts.route.serviceOpen" : "contracts.route.serviceOpenPlural",
      "{count} Service-Aufträge offen",
      { count: currentRouteStop.activeServiceMissionIds.length },
    ));
  } else if (currentRouteStop?.hasService) {
    currentStopParts.push(cargoText("contracts.route.serviceDone", "Service erledigt"));
  }
  const currentStopText = currentStopParts.join(" · ") || (routeFinished
    ? cargoText("contracts.route.allDone", "Alle geplanten Stopps sind erledigt.")
    : cargoText("contracts.route.chooseStop", "Wähle einen Stop aus der Route."));
  const nextStopText = routeState.nextStop
    ? cargoText("contracts.route.after", "Danach: {target} · {types}", {
        target: routeState.nextStop.dropoff,
        types: [
          routeState.nextStop.hasCargo ? cargoText("contracts.route.cargo", "Fracht") : "",
          routeState.nextStop.hasService ? cargoText("contracts.route.serviceType", "Service") : "",
        ].filter(Boolean).join(" + "),
      })
    : routeState.openStops > 0
      ? cargoText("contracts.route.lastOpen", "Das ist der letzte offene Halt dieser Route.")
      : cargoText("contracts.route.allDone", "Alle geplanten Stopps sind erledigt.");
  const routePathMarkup = routeState.routePath.length > 0
    ? routeState.routePath
        .map(
          (stop, index) => `
            ${index > 0 ? '<span class="route-progress-separator" aria-hidden="true">→</span>' : ""}
            <span class="route-progress-chip is-${escapeHtml(stop.status)}">${escapeHtml(stop.dropoff)}</span>
          `,
        )
        .join("")
    : `<span class="route-progress-chip is-empty">${escapeHtml(cargoText("contracts.route.noTargets", "Noch keine Ziele"))}</span>`;

  routeProgressBar.innerHTML = `
    <article class="route-progress-card">
      <span class="route-progress-label">${escapeHtml(cargoText("contracts.route.flightRoute", "Flugroute"))}</span>
      <strong>${escapeHtml(routeState.routeStops.length > 0 ? cargoText("contracts.route.doneCount", "{done}/{total} Stopps erledigt", { done: routeState.completedStops, total: routeState.routeStops.length }) : cargoText("contracts.route.nonePlanned", "Noch keine Route geplant"))}</strong>
      <div class="route-progress-path">${routePathMarkup}</div>
      <p>${escapeHtml(routeHint)}</p>
    </article>
    <article class="route-progress-card">
      <span class="route-progress-label">${escapeHtml(cargoText("contracts.route.currentLeg", "Aktueller Flugabschnitt"))}</span>
      <strong>${escapeHtml(currentRouteStop?.dropoff || (routeFinished ? cargoText("contracts.route.completed", "Route abgeschlossen") : cargoText("contracts.route.noTarget", "Kein Ziel ausgewählt")))}</strong>
      <p>${escapeHtml(currentStopText)}</p>
      <p>${escapeHtml(nextStopText)}</p>
    </article>
    <article class="route-progress-card route-progress-actions">
      <span class="route-progress-label">${escapeHtml(cargoText("contracts.route.progress", "Fortschritt"))}</span>
      <strong>${escapeHtml(cargoText(routeState.completedStops === 1 ? "contracts.route.stopsCompleted" : "contracts.route.stopsCompletedPlural", "{count} Stops abgeschlossen", { count: routeState.completedStops }))}</strong>
      <div class="route-progress-buttons">
        <button id="routeAdvanceButton" class="secondary-button" type="button" ${advanceDisabled ? "disabled" : ""}>${escapeHtml(cargoText("contracts.route.advance", "Nächsten Halt wählen"))}</button>
        <button id="routeCompleteButton" class="primary-button" type="button" ${completeDisabled ? "disabled" : ""}>${escapeHtml(cargoText("contracts.route.completeStop", "Stop abschließen"))}</button>
      </div>
    </article>
  `;

  routeProgressBar.querySelector("#routeAdvanceButton")?.addEventListener("click", () => {
    const targetDropoff = routeState.nextDropoff;
    if (!targetDropoff) return;
    selectStopByDropoff(targetDropoff);
    persist();
    render();
  });

  routeProgressBar.querySelector("#routeCompleteButton")?.addEventListener("click", () => {
    const targetDropoff = state.selectedStopDropoff || routeState.currentDropoff;
    if (!targetDropoff) return;
    completeRouteStop(targetDropoff);
  });
}

function getRunRoutePointKey(point) {
  const types = [
    point?.hasPickup ? "pickup" : "",
    point?.hasCargo ? "cargo" : "",
    point?.hasCourierPickup ? "courier-pickup" : "",
    point?.hasCourierDelivery ? "courier-delivery" : "",
    point?.hasService ? "service" : "",
  ]
    .filter(Boolean)
    .join("+");
  const missionIds = [...(point?.missionIds || [])].sort().join(",");
  return `${Number(point?.firstOrder) || 0}|${types}|${String(point?.dropoff || "").trim().toLocaleLowerCase("de-DE")}|${missionIds}`;
}

function getRunRoutePointTypeLabels(point) {
  return [
    point?.hasPickup ? cargoText("run.types.pickup", "Abholung") : "",
    point?.hasCargo ? cargoText("run.types.delivery", "Lieferung") : "",
    point?.hasCourierPickup ? cargoText("run.types.courierPickup", "Paketabholung") : "",
    point?.hasCourierDelivery ? cargoText("run.types.courierDelivery", "Paketübergabe") : "",
    point?.hasService ? cargoText("run.types.service", "Einsatz") : "",
  ].filter(Boolean);
}

function getRunRouteReasonLabels(point) {
  const labels = {
    current: cargoText("run.route.reason.current", "Bereits am aktuellen Standort"),
    priority: cargoText("run.route.reason.priority", "Manuell priorisiert"),
    "priority-prerequisite": cargoText("run.route.reason.priorityPrerequisite", "Notwendiger Halt vor der Priorität"),
    clearance: cargoText("run.route.reason.clearance", "Gibt eine blockierte Lieferung frei"),
    onboard: cargoText("run.route.reason.onboard", "Geladene Lieferung zuerst"),
    combined: cargoText("run.route.reason.combined", "{count} Aktionen gebündelt", { count: point?.routeTaskCount || 0 }),
    "same-area": cargoText("run.route.reason.sameArea", "Im gleichen Gebiet"),
    "same-system": cargoText("run.route.reason.sameSystem", "Im gleichen Sternensystem"),
    order: cargoText("run.route.reason.order", "Nach Auftragsreihenfolge"),
  };
  return [...new Set((point?.routeReasonCodes || []).map((code) => labels[code]).filter(Boolean))].slice(0, 3);
}

function getRunMissionReadiness(mission) {
  if (!mission || !isMissionActive(mission)) {
    return { status: "ignored", routeEligible: false, message: "" };
  }

  const assignmentWarning = getMissionAssignmentWarning(mission);
  if (assignmentWarning) {
    return { status: "ignored", routeEligible: false, message: assignmentWarning };
  }

  const missionType = normalizeMissionType(mission.type);
  if (missionType === "delivery") {
    const items = getMissionServiceDetails(mission).packages;
    if (items.length === 0 || items.some((entry) => !entry.name || !entry.pickup || !entry.destination)) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.missingDeliveryDetails", "Für diesen Lieferauftrag fehlen Gegenstand, Abholort oder Lieferziel."),
      };
    }
    if (!isCargoMission(mission)) {
      return { status: "ready", routeEligible: true, message: "" };
    }
  }
  if (missionType === "courier") {
    const packages = getMissionServiceDetails(mission).packages;
    if (packages.length === 0 || packages.some((entry) => !entry.name || !entry.pickup || !entry.destination)) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.missingCourierDetails", "Für diesen Kurierauftrag fehlen Paket, Abholort oder Lieferziel."),
      };
    }
    return { status: "ready", routeEligible: true, message: "" };
  }
  if (isCargoMission(mission)) {
    const cargoState = getActiveCargoCapacityState();
    if (!cargoState.hasCargo || cargoState.totalCapacity <= 0) {
      return {
        status: "blocked",
        routeEligible: false,
        message: getCargoReadiness().message,
      };
    }

    const segments = getMissionSegments(mission);
    if (segments.length === 0) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.missingCargoDetails", "Für diesen Auftrag fehlen die Frachtdetails."),
      };
    }

    const activeLoads = getMissionActiveLoads(mission);
    const requestedScu = activeLoads.reduce((sum, load) => sum + (Number(load.scu) || 0), 0);
    if (requestedScu > cargoState.totalCapacity) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.capacity", "{needed} benötigt, aber das aktive Schiff bietet nur {capacity}.", {
          needed: formatScuAmount(requestedScu),
          capacity: formatScuAmount(cargoState.totalCapacity),
        }),
      };
    }

    const maxProfile = getCurrentShipMaxContainerProfile();
    const oversizedLoad = maxProfile
      ? activeLoads.find((load) => Number(load.scu) > maxProfile.scu)
      : null;
    if (oversizedLoad) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.containerTooLarge", "Ein {size}-Container überschreitet die maximale Containergröße des Schiffs von {max}.", {
          size: formatScuAmount(oversizedLoad.scu),
          max: maxProfile.label,
        }),
      };
    }
    const pendingAmount = segments.some((segment) => Boolean(segment.quantityPending));
    if (pendingAmount) {
      return {
        status: "warning",
        routeEligible: true,
        message: cargoText("run.warning.missingAmount", "Abholmenge fehlt und muss am Abholort ergänzt werden."),
      };
    }
    if (requestedScu <= 0) {
      return {
        status: "blocked",
        routeEligible: false,
        message: cargoText("run.warning.noCargo", "Für diesen Auftrag wurde keine verladefähige Fracht erzeugt."),
      };
    }
    return { status: "ready", routeEligible: true, message: "" };
  }

  let readiness = { ok: true, message: "" };
  if (missionType === "refuel") {
    const details = getMissionServiceDetails(mission);
    readiness = getRefuelReadiness(details.serviceType, details);
  } else if (missionType === "salvage") {
    readiness = getSalvageReadiness();
  } else if (missionType === "mining") {
    readiness = getMiningReadiness(getMissionServiceDetails(mission).miningMethod);
  }
  return readiness.ok
    ? { status: "ready", routeEligible: true, message: "" }
    : { status: "blocked", routeEligible: false, message: readiness.message || cargoText("run.warning.wrongShip", "Das aktive Schiff ist für diesen Auftrag nicht geeignet.") };
}

function canMissionParticipateInRun(mission) {
  return getRunMissionReadiness(mission).routeEligible;
}

function normalizeRunRouteLocation(value) {
  return String(value || "").trim().toLocaleLowerCase("de-DE");
}

function consumeRunRoutePriority(location) {
  if (
    state.runPriorityRouteLocation
    && normalizeRunRouteLocation(state.runPriorityRouteLocation) === normalizeRunRouteLocation(location)
  ) {
    state.runPriorityRouteLocation = "";
  }
}

function getRunPickupTaskCompletionKey(mission, segment, segmentIndex = 0) {
  const missionId = String(mission?.id || "mission").trim();
  const segmentId = String(segment?.id || `segment-${segmentIndex}`).trim();
  return `pickup:${missionId}:${segmentId}`;
}

function isLegacyRunPickupCompletionKey(value, missionId, location) {
  const key = String(value || "");
  if (!key || key.startsWith("pickup:")) return false;
  const parts = key.split("|");
  if (parts.length < 4 || !parts[1].split("+").includes("pickup")) return false;
  if (parts[2] !== normalizeRunRouteLocation(location)) return false;
  return parts[3].split(",").includes(String(missionId || "").trim());
}

function mergeRunRouteTask(point, task) {
  point.hasPickup = Boolean(point.hasPickup || task.kind === "pickup");
  point.hasCargo = Boolean(point.hasCargo || task.kind === "delivery");
  point.hasCourierPickup = Boolean(point.hasCourierPickup || task.kind === "courier-pickup");
  point.hasCourierDelivery = Boolean(point.hasCourierDelivery || task.kind === "courier-delivery");
  point.hasService = Boolean(point.hasService || task.kind === "service");
  point.missionIds = [...new Set([...(point.missionIds || []), task.missionId].filter(Boolean))];
  point.missionTitles = [...new Set([...(point.missionTitles || []), task.missionTitle].filter(Boolean))];
  point.pickupTaskKeys = [...new Set([
    ...(point.pickupTaskKeys || []),
    ...(task.kind === "pickup" ? [task.id] : []),
  ])];
  const pointOrder = Number(point.firstOrder);
  point.firstOrder = Number.isFinite(pointOrder) ? Math.min(pointOrder, task.firstOrder) : task.firstOrder;
  return point;
}

function buildOptimizedRunRoutePoints(missionStates, completedPickupKeys) {
  const tasks = [];
  const normalizedCurrentLocation = normalizeRunRouteLocation(state.currentLocation);
  const completedKeys = completedPickupKeys instanceof Set ? completedPickupKeys : new Set(completedPickupKeys || []);

  missionStates.forEach(({ mission, readiness }, missionIndex) => {
    if (!readiness.routeEligible) return;
    const missionId = String(mission.id || `mission-${missionIndex}`).trim();
    const missionTitle = String(mission.title || "").trim();

    if (normalizeMissionType(mission.type) === "delivery") {
      getMissionServiceDetails(mission).packages
        .filter((entry) => !(Number(entry.containerScu) > 0))
        .forEach((entry, packageIndex) => {
          const packageId = String(entry.id || `package-${packageIndex}`).trim();
          const pickupTaskId = `courier-pickup:${missionId}:${packageId}`;
          tasks.push({
            id: pickupTaskId,
            kind: "courier-pickup",
            location: entry.pickup,
            locationKey: normalizeRunRouteLocation(entry.pickup),
            missionId,
            missionTitle,
            packageId,
            firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2,
            dependencies: [],
            completed: isMissionCompleted(mission) || Boolean(entry.pickedUpAt || entry.deliveredAt),
          });
          tasks.push({
            id: `courier-delivery:${missionId}:${packageId}`,
            kind: "courier-delivery",
            location: entry.destination,
            locationKey: normalizeRunRouteLocation(entry.destination),
            missionId,
            missionTitle,
            packageId,
            firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2 + 1,
            dependencies: [pickupTaskId],
            completed: isMissionCompleted(mission) || Boolean(entry.deliveredAt),
            onBoard: Boolean(entry.pickedUpAt && !entry.deliveredAt),
          });
        });
      if (!isCargoMission(mission)) return;
    }

    if (normalizeMissionType(mission.type) === "courier") {
      getMissionServiceDetails(mission).packages.forEach((entry, packageIndex) => {
        const packageId = String(entry.id || `package-${packageIndex}`).trim();
        const pickupTaskId = `courier-pickup:${missionId}:${packageId}`;
        tasks.push({
          id: pickupTaskId,
          kind: "courier-pickup",
          location: entry.pickup,
          locationKey: normalizeRunRouteLocation(entry.pickup),
          missionId,
          missionTitle,
          packageId,
          firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2,
          dependencies: [],
          completed: isMissionCompleted(mission) || Boolean(entry.pickedUpAt || entry.deliveredAt),
        });
        tasks.push({
          id: `courier-delivery:${missionId}:${packageId}`,
          kind: "courier-delivery",
          location: entry.destination,
          locationKey: normalizeRunRouteLocation(entry.destination),
          missionId,
          missionTitle,
          packageId,
          firstOrder: Math.max(missionIndex, 0) * 10000 + packageIndex * 2 + 1,
          dependencies: [pickupTaskId],
          completed: isMissionCompleted(mission) || Boolean(entry.deliveredAt),
          onBoard: Boolean(entry.pickedUpAt && !entry.deliveredAt),
        });
      });
      return;
    }

    if (!isCargoMission(mission)) {
      const details = getMissionServiceDetails(mission);
      const location = String(details.location || mission.dropoff || "Einsatzort offen").trim();
      tasks.push({
        id: `service:${missionId}`,
        kind: "service",
        location,
        locationKey: normalizeRunRouteLocation(location),
        missionId,
        missionTitle,
        firstOrder: Math.max(missionIndex, 0) * 10000,
        dependencies: [],
        completed: isMissionCompleted(mission),
      });
      return;
    }

    getMissionSegments(mission)
      .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0))
      .forEach((segment, segmentIndex) => {
        const pickup = String(segment.pickup || mission.pickup || "").trim();
        const dropoff = String(segment.dropoff || mission.dropoff || "Ziel offen").trim();
        if (!pickup || !dropoff) return;
        const pickupTaskKey = getRunPickupTaskCompletionKey(mission, segment, segmentIndex);
        const segmentLoads = (Array.isArray(mission.loads) ? mission.loads : [])
          .filter((load) => String(load.segmentId || "") === String(segment.id || ""));
        const allDelivered = isMissionCompleted(mission) || (segmentLoads.length > 0 && segmentLoads.every((load) => isLoadDelivered(load)));
        const allPlacedOrDelivered = segmentLoads.length > 0 && segmentLoads.every((load) => (
          isLoadDelivered(load) || isLoadPlacementInCurrentLayout(load, mission)
        ));
        const explicitlyCompleted = completedKeys.has(pickupTaskKey)
          || [...completedKeys].some((key) => isLegacyRunPickupCompletionKey(key, missionId, pickup));
        const pickupCompleted = explicitlyCompleted
          || allDelivered
          || (allPlacedOrDelivered && normalizeRunRouteLocation(pickup) !== normalizedCurrentLocation);
        const placedSegmentEntries = segmentLoads
          .filter((load) => isLoadPlacementInCurrentLayout(load, mission))
          .map((load) => ({ mission, load }));
        const unloadAnalysis = placedSegmentEntries.length > 0
          ? analyzeUnloadEntries(placedSegmentEntries)
          : null;
        const blockerLocationKeys = [...new Set(
          (unloadAnalysis?.blockers || [])
            .map(({ mission: blockerMission, load }) => normalizeRunRouteLocation(getLoadDropoff(load, blockerMission)))
            .filter(Boolean),
        )];
        const segmentOrder = Number(segment.order) || 0;

        tasks.push({
          id: pickupTaskKey,
          kind: "pickup",
          location: pickup,
          locationKey: normalizeRunRouteLocation(pickup),
          missionId,
          missionTitle,
          firstOrder: Math.max(missionIndex, 0) * 10000 + segmentOrder * 2,
          dependencies: [],
          completed: pickupCompleted,
        });
        tasks.push({
          id: `delivery:${missionId}:${String(segment.id || `segment-${segmentIndex}`).trim()}`,
          kind: "delivery",
          location: dropoff,
          locationKey: normalizeRunRouteLocation(dropoff),
          missionId,
          missionTitle,
          firstOrder: Math.max(missionIndex, 0) * 10000 + segmentOrder * 2 + 1,
          dependencies: [pickupTaskKey],
          completed: allDelivered,
          onBoard: placedSegmentEntries.length > 0 && !allDelivered,
          unloadBlocked: Boolean(unloadAnalysis?.blockedEntries?.length),
          blockerLocationKeys,
        });
      });
  });

  const taskPriority = { delivery: 0, "courier-delivery": 0, pickup: 1, "courier-pickup": 1, service: 2 };
  const compareTasks = (left, right) => (
    (taskPriority[left.kind] ?? 9) - (taskPriority[right.kind] ?? 9)
    || left.firstOrder - right.firstOrder
    || left.location.localeCompare(right.location, "de")
  );
  const createPoint = (task, completed) => mergeRunRouteTask({
    dropoff: task.location,
    status: completed ? "completed" : "upcoming",
    completed,
    hasPickup: false,
    hasCargo: false,
    hasCourierPickup: false,
    hasCourierDelivery: false,
    hasService: false,
    missionIds: [],
    missionTitles: [],
    pickupTaskKeys: [],
    firstOrder: task.firstOrder,
  }, task);

  const completedPointMap = new Map();
  tasks.filter((task) => task.completed).sort(compareTasks).forEach((task) => {
    const existing = completedPointMap.get(task.locationKey);
    completedPointMap.set(task.locationKey, existing ? mergeRunRouteTask(existing, task) : createPoint(task, true));
  });
  const optimized = RouteOptimizer.optimizeRouteTasks(tasks, {
    currentLocation: state.currentLocation,
    priorityLocation: state.runPriorityRouteLocation,
    locations: window.systemDatabaseController?.getActiveLocations?.() || [],
  });
  const plannedPoints = optimized.batches.map((batch) => {
    const point = createPoint(batch.tasks[0], false);
    batch.tasks.slice(1).forEach((task) => mergeRunRouteTask(point, task));
    return {
      ...point,
      routeReasonCodes: [...batch.reasonCodes],
      routeTaskCount: batch.tasks.length,
      routeScore: batch.score,
    };
  });

  return {
    completedPoints: [...completedPointMap.values()].sort((left, right) => left.firstOrder - right.firstOrder),
    plannedPoints,
    priorityReachable: optimized.priorityReachable,
  };
}

// Keep the mission cohort of a flight until the next flight starts. Completed
// missions must not disappear from the progress denominator when archived/paid.
function syncRunRouteProgress() {
  const fleetId = currentActiveFleetEntry()?.id;
  if (!fleetId) return;
  const previousIds = new Set(state.runRouteProgress?.[fleetId] || []);
  const previous = state.missions.filter((mission) => (
    previousIds.has(mission.id)
    && mission.assignedFleetEntryId === fleetId
    && (isMissionActive(mission) || isMissionCompleted(mission))
    && normalizeMissionStatus(mission.status) !== "cancelled"
  ));
  const eligible = state.missions.filter((mission) => getRunMissionReadiness(mission).routeEligible);
  const newFlight = !previous.some(isMissionActive) && eligible.some((mission) => !previousIds.has(mission.id));
  const ids = [...new Set([...(newFlight ? [] : previous.map((mission) => mission.id)), ...eligible.map((mission) => mission.id)])];
  state.runRouteProgress ||= {};
  state.runRouteProgress[fleetId] = ids;
}

function renderRunWaypoints(runState) {
  const root = document.getElementById("runWaypoints");
  if (!root) return;
  const openLocations = new Set(runState.openPoints.map((point) => normalizeRunRouteLocation(point.dropoff)));
  const completed = runState.points.filter((point) => point.completed && !openLocations.has(normalizeRunRouteLocation(point.dropoff)));
  const open = runState.openPoints;
  const focus = runState.selectedPoint;
  const upcoming = open.filter((point) => point !== focus);
  const preview = [...completed.slice(-1), ...(focus ? [focus] : []), ...upcoming.slice(0, 2)];
  const remaining = Math.max(0, upcoming.length - 2);
  root.innerHTML = preview.map((point) => {
    const current = point === focus;
    const label = point.completed ? t("run.waypoint.done")
      : current ? t(runState.arrived ? "run.waypoint.arrived" : "run.waypoint.target") : t("run.waypoint.next");
    return `<li class="run-waypoint${point.completed ? " is-done" : current ? " is-current" : ""}"${current ? ' aria-current="step"' : ""}>
      <span class="run-waypoint-marker" aria-hidden="true">${point.completed ? "✓" : "•"}</span>
      <span class="run-waypoint-copy"><small>${escapeHtml(label)}</small><strong title="${escapeHtml(point.dropoff)}">${escapeHtml(point.dropoff)}</strong></span>
    </li>`;
  }).join("") + (remaining ? `<li class="run-waypoint-more">${escapeHtml(t("run.waypoint.more", { count: remaining }))}</li>` : "");
}

function buildRunRouteState() {
  syncRunRouteProgress();
  const flightRoute = buildFlightRouteState();
  const completedPickupKeys = new Set(state.runCompletedRoutePoints || []);
  const stopByLocation = new Map(flightRoute.routeStops.map((stop) => [stop.dropoff, stop]));
  const missionStates = state.missions
    .filter((mission) => isMissionActive(mission))
    .map((mission) => ({ mission, readiness: getRunMissionReadiness(mission) }));
  const eligibleMissionIds = new Set(
    missionStates.filter(({ readiness }) => readiness.routeEligible).map(({ mission }) => mission.id),
  );
  const routeMissionIds = new Set(state.runRouteProgress?.[state.activeFleetEntryId] || []);
  const completedMissionStates = state.missions
    .filter((mission) => routeMissionIds.has(mission.id) && isMissionCompleted(mission))
    .map((mission) => ({ mission, readiness: { routeEligible: true } }));
  const optimizedRoute = buildOptimizedRunRoutePoints([...missionStates, ...completedMissionStates], completedPickupKeys);
  const points = [...optimizedRoute.completedPoints, ...optimizedRoute.plannedPoints].map((point) => {
    const key = getRunRoutePointKey(point);
    return {
      ...point,
      key,
      completed: Boolean(point.completed),
    };
  });
  const openPoints = points.filter((point) => !point.completed);
  // Several actions (or visits) at one location are one progress target.
  // Finishing only one package must not add an extra "completed stop" while
  // the rest of the same pickup is still open.
  const progressLocations = new Map();
  points.forEach((point) => {
    const location = normalizeRunRouteLocation(point.dropoff);
    progressLocations.set(location, (progressLocations.get(location) ?? true) && point.completed);
  });
  const priorityLocation = optimizedRoute.priorityReachable
    ? String(state.runPriorityRouteLocation || "").trim()
    : "";
  const selectedPoint = openPoints.find((point) => point.key === state.selectedRunRoutePointKey) || openPoints[0] || null;
  const selectedIndex = selectedPoint ? openPoints.findIndex((point) => point.key === selectedPoint.key) : -1;
  const routeStop = selectedPoint ? stopByLocation.get(selectedPoint.dropoff) || null : null;
  const cargoGroups = selectedPoint?.hasCargo
    ? buildStopCargoGroups(selectedPoint.dropoff).filter(({ mission }) => (
        eligibleMissionIds.has(mission.id)
        && (selectedPoint.missionIds || []).includes(mission.id)
      ))
    : [];
  const pickupEntries = selectedPoint?.hasPickup
    ? getAllLoads().filter(({ mission, load }) => (
        (selectedPoint.missionIds || []).includes(mission.id)
        && getLoadPickup(load, mission) === selectedPoint.dropoff
      ))
    : [];
  const placedPickupEntries = pickupEntries.filter(({ mission, load }) => isLoadPlacementInCurrentLayout(load, mission));
  const pendingPickupSegments = selectedPoint?.hasPickup
    ? missionStates.flatMap(({ mission, readiness }) => {
        if (!readiness.routeEligible || !(selectedPoint.missionIds || []).includes(mission.id)) return [];
        return getMissionSegments(mission)
          .filter((segment) => Boolean(segment.quantityPending) && String(segment.pickup || mission.pickup || "").trim() === selectedPoint.dropoff)
          .map((segment) => ({ mission, segment }));
      })
    : [];
  const selectedLocationKey = normalizeRunRouteLocation(selectedPoint?.dropoff);
  const courierPickupEntries = selectedPoint?.hasCourierPickup
    ? missionStates.flatMap(({ mission, readiness }) => {
        if (!readiness.routeEligible || !(selectedPoint.missionIds || []).includes(mission.id)) return [];
        return getMissionServiceDetails(mission).packages
          .filter((entry) => !entry.pickedUpAt && !entry.deliveredAt && normalizeRunRouteLocation(entry.pickup) === selectedLocationKey)
          .map((entry) => ({ mission, package: entry }));
      })
    : [];
  const courierDeliveryEntries = selectedPoint?.hasCourierDelivery
    ? missionStates.flatMap(({ mission, readiness }) => {
        if (!readiness.routeEligible || !(selectedPoint.missionIds || []).includes(mission.id)) return [];
        return getMissionServiceDetails(mission).packages
          .filter((entry) => entry.pickedUpAt && !entry.deliveredAt && normalizeRunRouteLocation(entry.destination) === selectedLocationKey)
          .map((entry) => ({ mission, package: entry }));
      })
    : [];
  const currentLocation = String(state.currentLocation || "").trim();
  const arrived = Boolean(
    selectedPoint
      && currentLocation
      && currentLocation.toLocaleLowerCase("de-DE") === selectedPoint.dropoff.toLocaleLowerCase("de-DE"),
  );

  return {
    flightRoute,
    missionStates,
    eligibleMissionIds,
    points,
    openPoints,
    selectedPoint,
    selectedIndex,
    nextPoint: selectedIndex >= 0 ? openPoints[selectedIndex + 1] || null : null,
    priorityLocation,
    routeStop,
    cargoGroups,
    pickupEntries,
    placedPickupEntries,
    pendingPickupSegments,
    courierPickupEntries,
    courierDeliveryEntries,
    currentLocation,
    arrived,
    progressTotal: progressLocations.size,
    completedCount: [...progressLocations.values()].filter(Boolean).length,
  };
}

function renderRunTaskIcon(kind) {
  const paths = {
    pickup: '<path d="M12 3v12m0 0-5-5m5 5 5-5M5 19h14v2H5v-2Z" />',
    delivery: '<path d="M12 21V9m0 0-5 5m5-5 5 5M5 3h14v2H5V3Z" />',
    service: '<path d="M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5l-2.4 2.4-3-3 2.4-2.4Z" />',
  };
  return `<span class="run-task-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false">${paths[kind] || paths.service}</svg></span>`;
}

function renderRunMissionState(runState, activeShip) {
  if (!runMissionPanel || !runMissionList || !runMissionSummary) return;
  const missionStates = runState.missionStates || [];
  runMissionPanel.hidden = !activeShip || missionStates.length === 0;
  if (runMissionPanel.hidden) {
    runMissionList.innerHTML = "";
    return;
  }

  const readyCount = missionStates.filter(({ readiness }) => readiness.routeEligible).length;
  const blockedCount = missionStates.length - readyCount;
  runMissionSummary.textContent = cargoText("run.missions.summary", "{ready} im Flugplan · {blocked} nicht berücksichtigt", {
    ready: readyCount,
    blocked: blockedCount,
  });
  runMissionList.innerHTML = missionStates.map(({ mission, readiness }) => {
    const stateLabel = readiness.status === "ready"
      ? cargoText("run.missions.ready", "Im Flugplan")
      : readiness.status === "warning"
        ? cargoText("run.missions.warning", "Angaben fehlen")
        : readiness.status === "blocked"
          ? cargoText("run.missions.blocked", "Nicht ausführbar")
          : cargoText("run.missions.otherShip", "Anderes Schiff");
    return `
      <article class="run-mission-row is-${escapeHtml(readiness.status)}">
        <span class="run-mission-marker" aria-hidden="true"></span>
        <div class="run-mission-copy">
          <strong>${escapeHtml(mission.title || cargoText("contracts.untitled", "Unbenannter Auftrag"))}</strong>
          <p>${escapeHtml(`${getMissionTypeLabel(mission)} · ${summarizeMissionRoute(mission)}`)}</p>
          ${readiness.message ? `<small>${escapeHtml(readiness.message)}</small>` : ""}
        </div>
        <span class="run-mission-state">${escapeHtml(stateLabel)}</span>
      </article>
    `;
  }).join("");
}

function getRunStopStatus(runState) {
  const point = runState.selectedPoint;
  if (!point) {
    return {
      tone: "complete",
      title: cargoText("run.stop.completeTitle", "Route abgeschlossen"),
      text: cargoText("run.stop.completeText", "Alle vorgesehenen Halte sind erledigt."),
    };
  }
  if (!runState.arrived) {
    return {
      tone: "en-route",
      title: cargoText("run.stop.enRouteTitle", "Anreise"),
      text: cargoText("run.stop.enRouteText", "Bestätige deine Ankunft, sobald du {target} erreicht hast.", { target: point.dropoff }),
    };
  }

  const details = [];
  const pendingAmountCount = runState.pendingPickupSegments.length;
  const unplacedPickupCount = Math.max(runState.pickupEntries.length - runState.placedPickupEntries.length, 0);
  const blockedDeliveryCount = runState.cargoGroups.filter((group) => group.analysis.status !== "ready").length;
  const readyDeliveryCount = runState.cargoGroups.length - blockedDeliveryCount;
  const courierPickupCount = runState.courierPickupEntries.length;
  const courierDeliveryCount = runState.courierDeliveryEntries.length;
  const serviceCount = runState.routeStop?.activeServiceMissionIds?.length || 0;

  if (pendingAmountCount > 0) {
    details.push(cargoText(
      pendingAmountCount === 1 ? "run.stop.amountOpen" : "run.stop.amountsOpen",
      pendingAmountCount === 1 ? "1 Mengenangabe offen" : "{count} Mengenangaben offen",
      { count: pendingAmountCount },
    ));
  }
  if (unplacedPickupCount > 0) {
    details.push(cargoText("run.stop.loadsWaiting", "{count} Container noch verladen", { count: unplacedPickupCount }));
  } else if (point.hasPickup && runState.pickupEntries.length > 0 && pendingAmountCount === 0) {
    details.push(cargoText("run.stop.pickupConfirm", "Abholung bestätigen"));
  }
  if (readyDeliveryCount > 0) {
    details.push(cargoText(
      readyDeliveryCount === 1 ? "run.stop.deliveryReady" : "run.stop.deliveriesReady",
      readyDeliveryCount === 1 ? "1 Lieferung entladebereit" : "{count} Lieferungen entladebereit",
      { count: readyDeliveryCount },
    ));
  }
  if (blockedDeliveryCount > 0) {
    details.push(cargoText(
      blockedDeliveryCount === 1 ? "run.stop.deliveryBlocked" : "run.stop.deliveriesBlocked",
      blockedDeliveryCount === 1 ? "1 Lieferung noch nicht entladebereit" : "{count} Lieferungen noch nicht entladebereit",
      { count: blockedDeliveryCount },
    ));
  }
  if (courierPickupCount > 0) {
    details.push(cargoText(
      courierPickupCount === 1 ? "run.stop.courierPickup" : "run.stop.courierPickups",
      courierPickupCount === 1 ? "1 Paket abholen" : "{count} Pakete abholen",
      { count: courierPickupCount },
    ));
  }
  if (courierDeliveryCount > 0) {
    details.push(cargoText(
      courierDeliveryCount === 1 ? "run.stop.courierDelivery" : "run.stop.courierDeliveries",
      courierDeliveryCount === 1 ? "1 Paket übergeben" : "{count} Pakete übergeben",
      { count: courierDeliveryCount },
    ));
  }
  if (serviceCount > 0) {
    details.push(cargoText(
      serviceCount === 1 ? "run.stop.serviceOpen" : "run.stop.servicesOpen",
      serviceCount === 1 ? "1 Einsatz abschließen" : "{count} Einsätze abschließen",
      { count: serviceCount },
    ));
  }

  const needsAttention = pendingAmountCount > 0 || unplacedPickupCount > 0 || blockedDeliveryCount > 0;
  return {
    tone: needsAttention ? "attention" : "action",
    title: needsAttention
      ? cargoText("run.stop.attentionTitle", "Vor dem Weiterflug offen")
      : cargoText("run.stop.actionTitle", "Aktionen am Halt"),
    text: details.join(" · ") || cargoText("run.stop.noAction", "An diesem Halt ist keine weitere Aktion offen."),
  };
}

function renderRunManifest(runState, activeShip) {
  if (!runManifestPanel || !runOnBoardList || !runWaitingList || !runWaitingSection) return;
  const cargoState = getActiveCargoCapacityState();
  runManifestPanel.hidden = !activeShip || !cargoState.hasCargo;
  if (runManifestPanel.hidden) return;

  const fleetEntryId = activeShip.id || getCurrentCargoGridFleetEntryId();
  const onBoardEntries = getPlacedLoadEntries({ fleetEntryId });
  const onBoardScu = onBoardEntries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0);
  runManifestSummary.textContent = cargoText("run.manifest.summary", "{count} Container · {used} von {capacity} belegt", {
    count: onBoardEntries.length,
    used: formatScuAmount(onBoardScu),
    capacity: formatScuAmount(cargoState.totalCapacity),
  });

  const currentTarget = runState.selectedPoint?.dropoff || "";
  const canUnloadHere = Boolean(runState.arrived && runState.selectedPoint?.hasCargo);
  runOnBoardList.innerHTML = onBoardEntries.length > 0
    ? onBoardEntries.map(({ mission, load }) => {
        const destination = getLoadDropoff(load, mission);
        const unloadHere = canUnloadHere && destination === currentTarget;
        const slot = load.placement?.slotId || "";
        return `
          <article class="run-manifest-row${unloadHere ? " is-unload" : ""}">
            <div class="run-manifest-copy">
              <strong>${escapeHtml(load.label)}</strong>
              <p>${escapeHtml(`${mission.title} · ${formatScuAmount(load.scu)}${slot ? ` · ${slot}` : ""}`)}</p>
            </div>
            <span>${escapeHtml(unloadHere
              ? cargoText("run.manifest.unloadHere", "Hier entladen")
              : cargoText("run.manifest.keepOnBoard", "Bleibt an Bord bis {target}", { target: destination || cargoText("common.notSpecified", "Nicht angegeben") }))}</span>
          </article>
        `;
      }).join("")
    : `<p class="empty-state">${escapeHtml(cargoText("run.manifest.emptyOnBoard", "Der Frachtraum ist leer."))}</p>`;

  const currentLocation = String(runState.currentLocation || "").trim();
  const waitingLoads = currentLocation
    ? getAllLoads().filter(({ mission, load }) => (
        isMissionActive(mission)
        && isMissionAssignedToCurrentActiveShip(mission)
        && !load.placement
        && getLoadPickup(load, mission) === currentLocation
      ))
    : [];
  const pendingHere = (runState.missionStates || []).flatMap(({ mission }) =>
    isMissionAssignedToCurrentActiveShip(mission) ? getMissionSegments(mission)
      .filter((segment) => Boolean(segment.quantityPending) && String(segment.pickup || mission.pickup || "").trim() === currentLocation)
      .map((segment) => ({ mission, segment })) : [],
  );
  runWaitingSection.hidden = waitingLoads.length === 0 && pendingHere.length === 0;
  runWaitingList.innerHTML = [
    ...pendingHere.map(({ mission, segment }) => `
      <article class="run-manifest-row is-warning">
        <div class="run-manifest-copy">
          <strong>${escapeHtml(segment.title || mission.title)}</strong>
          <p>${escapeHtml(mission.title)}</p>
        </div>
        <span>${escapeHtml(cargoText("run.manifest.amountOpen", "Menge offen"))}</span>
      </article>
    `),
    ...waitingLoads.map(({ mission, load }) => `
      <article class="run-manifest-row">
        <div class="run-manifest-copy">
          <strong>${escapeHtml(load.label)}</strong>
          <p>${escapeHtml(`${mission.title} · ${formatScuAmount(load.scu)}`)}</p>
        </div>
        <span>${escapeHtml(cargoText("run.manifest.waiting", "Noch zu verladen"))}</span>
      </article>
    `),
  ].join("");
}

function showRunQuantityDialog(mission, segment) {
  if (!runQuantityDialog || !runQuantityDialogForm || !runQuantityDialogInput || !runQuantityDialogCancel) {
    return Promise.resolve(null);
  }
  hideAppTooltip(true);
  runQuantityDialogMission.textContent = `${mission.title} · ${segment.title || cargoText("run.tasks.pickup", "Fracht abholen")} · ${segment.pickup} → ${segment.dropoff}`;
  const cargoState = getActiveCargoCapacityState();
  const maxProfile = getCurrentShipMaxContainerProfile();
  runQuantityDialogHint.textContent = cargoText("run.quantity.hint", "Freier Frachtraum: {free} · Max. Container: {max}", {
    free: formatScuAmount(cargoState.freeCapacity),
    max: maxProfile?.label || cargoText("common.notSpecified", "Nicht angegeben"),
  });
  runQuantityDialogInput.value = Number(segment.expectedCargoScu) > 0 ? String(Math.round(Number(segment.expectedCargoScu))) : "";
  runQuantityDialog.hidden = false;
  runQuantityDialogInput.focus();
  runQuantityDialogInput.select();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      runQuantityDialog.hidden = true;
      resolve(value);
    };
    const handleSubmit = (event) => {
      event.preventDefault();
      const amount = Number(runQuantityDialogInput.value);
      if (!Number.isInteger(amount) || amount <= 0) {
        runQuantityDialogInput.setCustomValidity(cargoText("run.quantity.invalid", "Bitte trage eine volle SCU-Menge größer als 0 ein."));
        runQuantityDialogInput.reportValidity();
        return;
      }
      runQuantityDialogInput.setCustomValidity("");
      finish(amount);
    };
    const handleCancel = () => finish(null);
    const handleBackdrop = (event) => {
      if (event.target === runQuantityDialog) finish(null);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") finish(null);
    };
    const cleanup = () => {
      runQuantityDialogForm.removeEventListener("submit", handleSubmit);
      runQuantityDialogCancel.removeEventListener("click", handleCancel);
      runQuantityDialog.removeEventListener("click", handleBackdrop);
      document.removeEventListener("keydown", handleKeydown);
    };
    runQuantityDialogForm.addEventListener("submit", handleSubmit);
    runQuantityDialogCancel.addEventListener("click", handleCancel);
    runQuantityDialog.addEventListener("click", handleBackdrop);
    document.addEventListener("keydown", handleKeydown);
  });
}

function applyRunPickupQuantity(mission, segment, targetScu) {
  const groups = buildContainerGroupsForScu(targetScu, mission.maxContainerScu);
  const segmentIndex = Array.isArray(mission.segments)
    ? mission.segments.findIndex((candidate) => candidate.id === segment.id)
    : -1;
  if (groups.length === 0 || segmentIndex < 0) return false;

  const nextSegments = groups.map((group, groupIndex) => {
    const container = parseCargoContainerValue(group.containerSize);
    return {
      ...segment,
      id: createRuntimeId(),
      quantity: group.quantity,
      containerSize: container.key,
      width: container.width,
      depth: container.depth,
      height: container.height,
      isHandheld: container.isHandheld,
      isPlaceable: container.isPlaceable,
      scuPerLoad: container.scu,
      totalScu: container.scu * group.quantity,
      routeTargetScu: targetScu,
      expectedCargoScu: Number(segment.expectedCargoScu) || targetScu,
      quantityPending: false,
      cargoGroupIndex: (Number(segment.cargoGroupIndex) || 0) + groupIndex,
      order: (Number(segment.order) || 0) + groupIndex,
    };
  });
  mission.segments.splice(segmentIndex, 1, ...nextSegments);
  mission.loads = [...(Array.isArray(mission.loads) ? mission.loads : []), ...createLoadsFromConsignments(nextSegments)];
  mission.updatedAt = new Date().toISOString();
  lastRunAutoLoadResult = null;
  persist();
  render();
  return true;
}

function renderRunMode() {
  if (!runContent || !runEmptyState || !runRouteList) return;
  const activeShip = currentActiveFleetEntry();
  const runState = buildRunRouteState();
  const totalPoints = runState.progressTotal;
  const progressPercent = totalPoints > 0 ? Math.round((runState.completedCount / totalPoints) * 100) : 0;

  runShipName.textContent = activeShip
    ? `${activeShip.manufacturer} ${activeShip.model}`.trim()
    : cargoText("run.ship.none", "Kein aktives Schiff");
  runShipRegistration.textContent = activeShip ? formatFleetRegistration(activeShip) : FLEET_REGISTRATION_PLACEHOLDER;

  const noShip = !activeShip;
  const noRoute = !noShip && totalPoints === 0;
  renderRunMissionState(runState, activeShip);
  renderRunManifest(runState, activeShip);
  runEmptyState.hidden = !noShip && !noRoute;
  runContent.hidden = noShip;
  if (runFocusPanel) runFocusPanel.hidden = noRoute;
  if (runRoutePanel) runRoutePanel.hidden = noRoute;
  if (noShip || noRoute) {
    if (runAutoloadOptions) runAutoloadOptions.hidden = true;
    runEmptyTitle.textContent = noShip
      ? cargoText("run.empty.noShipTitle", "Kein aktives Schiff")
      : cargoText("run.empty.noRouteTitle", "Noch kein ausführbarer Einsatz");
    runEmptyText.textContent = noShip
      ? cargoText("run.empty.noShipText", "Wähle zuerst ein aktives Schiff in deiner Flotte.")
      : cargoText("run.empty.noRouteText", "Für das aktive Schiff sind derzeit keine passenden offenen Auftragspunkte vorhanden. Prüfe die Auftragslage.");
    runEmptyAction.textContent = noShip
      ? cargoText("run.empty.openFleet", "Zur Flotte")
      : cargoText("run.empty.openContracts", "Zu den Aufträgen");
    runEmptyAction.dataset.target = noShip ? "fleet" : "overview";
    return;
  }

  runProgressText.textContent = t("run.progress.stops", {
    done: runState.completedCount,
    total: totalPoints,
    percent: progressPercent,
  });
  runProgressFill.style.width = `${progressPercent}%`;
  const progressTrack = runProgressFill.parentElement;
  progressTrack.setAttribute("aria-valuenow", String(progressPercent));
  progressTrack.setAttribute("aria-valuetext", runProgressText.textContent);
  renderRunWaypoints(runState);
  runRouteSummary.textContent = runState.priorityLocation
    ? cargoText("run.route.summaryPriority", "{open} offen · Priorität: {location}", {
        open: runState.openPoints.length,
        location: runState.priorityLocation,
      })
    : cargoText("run.route.summary", "{open} offen · {done} erledigt", {
        open: runState.openPoints.length,
        done: runState.completedCount,
      });

  const point = runState.selectedPoint;
  const routeCompleted = !point;
  runTargetEyebrow.textContent = routeCompleted
    ? cargoText("run.target.completed", "Einsatz abgeschlossen")
    : runState.arrived
      ? cargoText("run.target.current", "Aktueller Halt")
      : cargoText("run.target.next", "Nächstes Ziel");
  runTargetName.textContent = point?.dropoff || cargoText("run.target.completed", "Einsatz abgeschlossen");
  const selectedRouteReason = getRunRouteReasonLabels(point).join(" · ");
  const targetMeta = routeCompleted
    ? cargoText("run.target.completedText", "Alle Punkte dieser Route sind erledigt.")
    : runState.arrived
      ? cargoText("run.target.arrived", "Du bist am Ziel. Die passenden Aktionen sind jetzt verfügbar.")
      : cargoText("run.target.leg", "{start} → {target}", {
          start: runState.currentLocation || cargoText("run.location.open", "Standort offen"),
          target: point.dropoff,
        });
  runTargetMeta.textContent = selectedRouteReason && !routeCompleted
    ? `${targetMeta} · ${selectedRouteReason}`
    : targetMeta;

  const stopStatus = getRunStopStatus(runState);
  if (runFocusSummary) {
    runFocusSummary.textContent = `${point?.dropoff || cargoText("run.target.completed", "Einsatz abgeschlossen")} · ${stopStatus.title}`;
  }
  if (runStopStatus && runStopStatusTitle && runStopStatusText) {
    runStopStatus.className = `run-stop-status is-${stopStatus.tone}`;
    runStopStatusTitle.textContent = stopStatus.title;
    runStopStatusText.textContent = stopStatus.text;
  }

  const tasks = [];
  runState.courierPickupEntries.forEach(({ mission, package: courierPackage }) => {
    tasks.push(`
      <article class="run-task-row">
        ${renderRunTaskIcon("pickup")}
        <div class="run-task-copy">
          <strong>${escapeHtml(`${courierPackage.quantity} × ${courierPackage.name}`)}</strong>
          <p>${escapeHtml(`${mission.title} · ${courierPackage.destination}`)}</p>
        </div>
        <button class="secondary-button run-courier-pickup" type="button" data-mission-id="${escapeHtml(mission.id)}" data-package-id="${escapeHtml(courierPackage.id)}" ${runState.arrived ? "" : "disabled"}>${escapeHtml(cargoText("run.actions.collectPackage", "Paket aufnehmen"))}</button>
      </article>
    `);
  });
  runState.courierDeliveryEntries.forEach(({ mission, package: courierPackage }) => {
    tasks.push(`
      <article class="run-task-row">
        ${renderRunTaskIcon("delivery")}
        <div class="run-task-copy">
          <strong>${escapeHtml(`${courierPackage.quantity} × ${courierPackage.name}`)}</strong>
          <p>${escapeHtml(`${mission.title} · ${courierPackage.pickup}`)}</p>
        </div>
        <button class="secondary-button run-courier-delivery" type="button" data-mission-id="${escapeHtml(mission.id)}" data-package-id="${escapeHtml(courierPackage.id)}" ${runState.arrived ? "" : "disabled"}>${escapeHtml(cargoText("run.actions.deliverPackage", "Paket übergeben"))}</button>
      </article>
    `);
  });
  if (point?.hasPickup) {
    runState.pendingPickupSegments.forEach(({ mission, segment }) => {
      tasks.push(`
        <article class="run-task-row is-warning">
          ${renderRunTaskIcon("pickup")}
          <div class="run-task-copy">
            <strong>${escapeHtml(segment.title || mission.title)}</strong>
            <p>${escapeHtml(cargoText("run.tasks.pickupOpenForMission", "{mission} · Abholmenge offen", { mission: mission.title }))}</p>
          </div>
          <button class="secondary-button run-enter-quantity" type="button" data-mission-id="${escapeHtml(mission.id)}" data-segment-id="${escapeHtml(segment.id)}" ${runState.arrived ? "" : "disabled"}>${escapeHtml(cargoText("run.actions.enterAmount", "Menge eintragen"))}</button>
        </article>
      `);
    });
    if (runState.pickupEntries.length > 0) {
      const totalScu = runState.pickupEntries.reduce((sum, { load }) => sum + (Number(load.scu) || 0), 0);
      tasks.push(`
        <article class="run-task-row">
          ${renderRunTaskIcon("pickup")}
          <div class="run-task-copy">
            <strong>${escapeHtml(cargoText("run.tasks.pickup", "Fracht abholen"))}</strong>
            <p>${escapeHtml(cargoText("run.tasks.pickupDetail", "{placed}/{total} Container · {scu}", {
              placed: runState.placedPickupEntries.length,
              total: runState.pickupEntries.length,
              scu: formatScuAmount(totalScu),
            }))}</p>
          </div>
          <span class="run-task-status${runState.arrived ? " is-ready" : ""}">${escapeHtml(runState.arrived
            ? cargoText("run.tasks.ready", "bereit")
            : cargoText("run.tasks.pendingArrival", "Anreise"))}</span>
        </article>
      `);
    }
  }
  runState.cargoGroups.forEach((group) => {
    const ready = runState.arrived && group.analysis.status === "ready";
    const statusKey = ["ready", "not-loaded", "incomplete", "partial", "blocked"].includes(group.analysis.status)
      ? group.analysis.status
      : "blocked";
    tasks.push(`
      <article class="run-task-row${statusKey === "ready" ? "" : " is-warning"}">
        ${renderRunTaskIcon("delivery")}
        <div class="run-task-copy">
          <strong>${escapeHtml(group.label)}</strong>
          <p>${escapeHtml(cargoText("run.tasks.deliveryDetail", "{placed}/{total} Container · {scu}", {
            placed: group.placedEntries.length,
            total: group.entries.length,
            scu: formatScuAmount(group.totalScu),
          }))}</p>
        </div>
        <button class="secondary-button run-deliver-group" type="button" data-dropoff="${escapeHtml(group.dropoff)}" data-group-key="${escapeHtml(group.key)}" ${ready ? "" : "disabled"}>${escapeHtml(cargoText(`run.delivery.${statusKey}`, statusKey === "ready" ? "Entladen" : "Nicht bereit"))}</button>
      </article>
    `);
  });
  if (point?.hasService) {
    const activeServiceCount = runState.routeStop?.activeServiceMissionIds?.length || 0;
    tasks.push(`
      <article class="run-task-row">
        ${renderRunTaskIcon("service")}
        <div class="run-task-copy">
          <strong>${escapeHtml(cargoText("run.tasks.service", "Einsatz durchführen"))}</strong>
          <p>${escapeHtml((runState.routeStop?.serviceSummaries || []).join(" · ") || (point.missionTitles || []).join(" · "))}</p>
        </div>
        <span class="run-task-status${runState.arrived && activeServiceCount > 0 ? " is-ready" : ""}">${escapeHtml(activeServiceCount > 0
          ? runState.arrived ? cargoText("run.tasks.ready", "bereit") : cargoText("run.tasks.pendingArrival", "Anreise")
          : cargoText("run.tasks.done", "erledigt"))}</span>
      </article>
    `);
  }
  if (point && lastRunAutoLoadResult?.pointKey === point.key) {
    const baseResultText = lastRunAutoLoadResult.placedCount > 0
      ? lastRunAutoLoadResult.skippedCount > 0
        ? cargoText("run.autoload.partial", "{placed} verladen · {skipped} passen nicht mehr in das Schiff", {
            placed: lastRunAutoLoadResult.placedCount,
            skipped: lastRunAutoLoadResult.skippedCount,
          })
        : cargoText("run.autoload.success", "{placed} Container automatisch verladen", {
            placed: lastRunAutoLoadResult.placedCount,
          })
      : cargoText("run.autoload.failed", "Kein Container konnte passend platziert werden.");
    const resultText = formatAutoloadResultWithOverload(lastRunAutoLoadResult, baseResultText);
    tasks.push(`<p class="run-action-result${lastRunAutoLoadResult.skippedCount > 0 || lastRunAutoLoadResult.overloadCount > 0 ? " is-warning" : " is-success"}">${escapeHtml(resultText)}</p>`);
  }
  runTaskList.innerHTML = tasks.join("") || `<p class="empty-state">${escapeHtml(cargoText("run.tasks.none", "Für diesen Halt gibt es keine offene Aktion."))}</p>`;

  runArriveButton.hidden = routeCompleted || runState.arrived;
  runArriveButton.disabled = routeCompleted;
  runArriveButton.dataset.pointKey = point?.key || "";
  const unplacedPickupCount = runState.pickupEntries.length - runState.placedPickupEntries.length;
  runOpenLoadButton.hidden = !point?.hasPickup || runState.pickupEntries.length === 0 || !canUseLoadPage();
  runOpenLoadButton.disabled = !runState.arrived;
  runAutoLoadButton.hidden = !point?.hasPickup || runState.pickupEntries.length === 0 || !canUseLoadPage();
  runAutoLoadButton.disabled = !runState.arrived || unplacedPickupCount <= 0;
  if (runAutoloadOptions) runAutoloadOptions.hidden = runAutoLoadButton.hidden;
  runCompletePickupButton.hidden = !point?.hasPickup;
  runCompletePickupButton.disabled = !runState.arrived || runState.pendingPickupSegments.length > 0;
  if (runState.pendingPickupSegments.length > 0) {
    runCompletePickupButton.dataset.tooltip = cargoText("run.warning.completeNeedsAmount", "Trage zuerst alle offenen Abholmengen ein.");
  } else {
    delete runCompletePickupButton.dataset.tooltip;
  }
  runCompletePickupButton.removeAttribute("title");
  runCompletePickupButton.dataset.pointKey = point?.key || "";
  const pointMissionIds = new Set(point?.missionIds || []);
  const cargoStop = point?.hasCargo
    ? buildUnloadStops({
        missionFilter: (mission) => runState.eligibleMissionIds.has(mission.id) && pointMissionIds.has(mission.id),
      }).find((stop) => stop.dropoff === point.dropoff) || null
    : null;
  const canCompleteCargo = Boolean(cargoStop && cargoStop.placeableCount > 0 && cargoStop.analysis.status === "ready");
  const canCompleteService = Boolean(runState.routeStop?.activeServiceMissionIds?.length);
  runCompleteStopButton.hidden = !point || (!point.hasCargo && !point.hasService);
  runCompleteStopButton.disabled = !runState.arrived || (!canCompleteCargo && !canCompleteService);
  runCompleteStopButton.dataset.dropoff = point?.dropoff || "";
  runCompleteStopButton.textContent = canCompleteCargo
    ? point?.hasService
      ? cargoText("run.actions.unloadCargo", "Fracht entladen")
      : cargoText("run.actions.unloadAll", "Alle Lieferungen entladen")
    : canCompleteService
      ? cargoText("run.actions.completeService", "Einsatz abschließen")
      : cargoText("run.actions.stopBlocked", "Halt noch offen");
  runActionBar.hidden = routeCompleted;

  runRouteList.innerHTML = runState.points.map((routePoint, index) => {
    const isCurrent = routePoint.key === point?.key;
    const status = routePoint.completed ? "completed" : isCurrent ? "current" : "upcoming";
    const typeLabel = getRunRoutePointTypeLabels(routePoint).join(" + ");
    const reasonLabel = getRunRouteReasonLabels(routePoint).join(" · ");
    const isPriority = Boolean(
      runState.priorityLocation
      && normalizeRunRouteLocation(runState.priorityLocation) === normalizeRunRouteLocation(routePoint.dropoff),
    );
    const priorityLabel = isPriority
      ? cargoText("run.route.clearPriority", "Priorität aufheben")
      : cargoText("run.route.prioritize", "Als nächsten Halt priorisieren");
    return `
      <div class="run-route-row is-${status}${isPriority ? " is-priority" : ""}">
        <button class="run-route-select" type="button" data-run-point-key="${escapeHtml(routePoint.key)}" ${routePoint.completed ? "disabled" : ""}>
          <span class="run-route-index">${routePoint.completed ? "✓" : index + 1}</span>
          <span class="run-route-copy">
            <strong>${escapeHtml(routePoint.dropoff)}</strong>
            <small>${escapeHtml(typeLabel)}</small>
            ${reasonLabel && !routePoint.completed ? `<small class="run-route-reason">${escapeHtml(reasonLabel)}</small>` : ""}
          </span>
        </button>
        ${!routePoint.completed ? `
          <button class="run-route-priority icon-only-button tooltip-button${isPriority ? " is-active" : ""}" type="button" data-run-priority-location="${escapeHtml(routePoint.dropoff)}" aria-label="${escapeHtml(priorityLabel)}" data-tooltip="${escapeHtml(priorityLabel)}" aria-pressed="${isPriority}">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 3h10l-1.5 6v3l2.5 4H6l2.5-4V9L7 3Zm5 13v5" /></svg>
          </button>
        ` : routePoint.hasPickup && routePoint.missionIds.some((id) => runState.eligibleMissionIds.has(id)) ? `
          <button class="run-route-reopen icon-only-button tooltip-button" type="button" data-run-reopen-key="${escapeHtml(routePoint.key)}" data-run-reopen-task-keys="${escapeHtml((routePoint.pickupTaskKeys || []).join(","))}" data-run-reopen-location="${escapeHtml(routePoint.dropoff)}" data-run-reopen-mission-ids="${escapeHtml((routePoint.missionIds || []).join(","))}" aria-label="${escapeHtml(cargoText("run.actions.reopenPickup", "Abholung wieder öffnen"))}" data-tooltip="${escapeHtml(cargoText("run.actions.reopenPickup", "Abholung wieder öffnen"))}">
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 5v5h5M5.6 9A7 7 0 1 1 6 16l1.7-1A5 5 0 1 0 7 10.4L10 13H3V6l2.6 3Z" /></svg>
          </button>
        ` : ""}
      </div>
    `;
  }).join("");

  runRouteList.querySelectorAll("[data-run-point-key]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRunRoutePointKey = button.dataset.runPointKey || "";
      const selected = buildRunRouteState().selectedPoint;
      if (selected && (selected.hasCargo || selected.hasService)) selectStopByDropoff(selected.dropoff);
      persist();
      render();
    });
  });
  runRouteList.querySelectorAll("[data-run-priority-location]").forEach((button) => {
    button.addEventListener("click", () => {
      hideAppTooltip(true);
      const location = String(button.dataset.runPriorityLocation || "").trim();
      const alreadyPrioritized = normalizeRunRouteLocation(state.runPriorityRouteLocation) === normalizeRunRouteLocation(location);
      state.runPriorityRouteLocation = alreadyPrioritized ? "" : location;
      state.selectedRunRoutePointKey = "";
      persist();
      render();
    });
  });
  runRouteList.querySelectorAll("[data-run-reopen-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.runReopenKey || "";
      const pickupTaskKeys = new Set(String(button.dataset.runReopenTaskKeys || "").split(",").filter(Boolean));
      const missionIds = String(button.dataset.runReopenMissionIds || "").split(",").filter(Boolean);
      const location = button.dataset.runReopenLocation || "";
      state.runCompletedRoutePoints = (state.runCompletedRoutePoints || []).filter((value) => (
        value !== key
        && !pickupTaskKeys.has(value)
        && !missionIds.some((missionId) => isLegacyRunPickupCompletionKey(value, missionId, location))
      ));
      state.selectedRunRoutePointKey = key;
      persist();
      render();
    });
  });
  runTaskList.querySelectorAll(".run-deliver-group").forEach((button) => {
    button.addEventListener("click", async () => {
      await deliverStopCargoGroup(button.dataset.dropoff || "", button.dataset.groupKey || "");
    });
  });
  runTaskList.querySelectorAll(".run-enter-quantity").forEach((button) => {
    button.addEventListener("click", async () => {
      const mission = state.missions.find((entry) => entry.id === button.dataset.missionId);
      const segment = mission?.segments?.find((entry) => entry.id === button.dataset.segmentId);
      if (!mission || !segment || !segment.quantityPending) return;
      const amount = await showRunQuantityDialog(mission, segment);
      if (amount !== null) applyRunPickupQuantity(mission, segment, amount);
    });
  });
  runTaskList.querySelectorAll(".run-courier-pickup").forEach((button) => {
    button.addEventListener("click", () => {
      const mission = state.missions.find((entry) => entry.id === button.dataset.missionId);
      const courierPackage = mission?.serviceDetails?.packages?.find((entry) => String(entry.id) === button.dataset.packageId);
      if (!mission || !courierPackage || courierPackage.pickedUpAt || courierPackage.deliveredAt) return;
      courierPackage.pickedUpAt = new Date().toISOString();
      mission.updatedAt = courierPackage.pickedUpAt;
      state.selectedRunRoutePointKey = "";
      persist();
      render();
    });
  });
  runTaskList.querySelectorAll(".run-courier-delivery").forEach((button) => {
    button.addEventListener("click", async () => {
      const mission = state.missions.find((entry) => entry.id === button.dataset.missionId);
      const courierPackage = mission?.serviceDetails?.packages?.find((entry) => String(entry.id) === button.dataset.packageId);
      if (!mission || !courierPackage || !courierPackage.pickedUpAt || courierPackage.deliveredAt) return;
      const confirmed = await showMissionConfirmDialog({
        kicker: cargoText("run.dialog.kicker", "Einsatzmodus"),
        title: cargoText("run.dialog.deliverPackageTitle", "Paket übergeben?"),
        message: cargoText("run.dialog.deliverPackageMessage", "{package} am aktuellen Ziel als übergeben markieren?", { package: courierPackage.name }),
        confirmLabel: cargoText("run.actions.deliverPackage", "Paket übergeben"),
      });
      if (!confirmed) return;
      courierPackage.deliveredAt = new Date().toISOString();
      mission.updatedAt = courierPackage.deliveredAt;
      const missionProgressComplete = normalizeMissionType(mission.type) === "delivery"
        ? canAutoCompleteMissionProgress(mission)
        : mission.serviceDetails.packages.every((entry) => entry.deliveredAt);
      if (missionProgressComplete) {
        markMissionCompleted(mission, { completedAt: courierPackage.deliveredAt });
      }
      state.selectedRunRoutePointKey = "";
      persist();
      render();
    });
  });
  normalizeAppTooltipTitles(runRouteList);
}

function renderCurrentLocationControl() {
  const dispatcherMode = typeof isDispatcherMode === "function" && isDispatcherMode();
  if (currentLocationForm) currentLocationForm.hidden = dispatcherMode;
  if (hubCurrentLocationControl) hubCurrentLocationControl.hidden = dispatcherMode;
  if (dispatcherMode) return;

  const location = String(state.currentLocation || "").trim();
  [hubCurrentLocationSelect, runCurrentLocationSelect].filter(Boolean).forEach((select) => {
    const suggestions = collectLocationSuggestions();
    select.innerHTML = [
      `<option value="">${escapeHtml(cargoText("hub.location.select", "Standort auswählen"))}</option>`,
      ...suggestions.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    select.value = location;
  });

  if (currentLocationInput && document.activeElement !== currentLocationInput) {
    currentLocationInput.value = location;
  }
  if (clearCurrentLocationButton) clearCurrentLocationButton.disabled = !location;
  if (currentLocationHint) {
    currentLocationHint.textContent = location
      ? cargoText("contracts.route.locationActive", "Die Route beginnt bei {location}.", { location })
      : cargoText("contracts.route.locationMissing", "Lege den Ausgangspunkt fest, damit die Route dort beginnt.");
  }
}

function renderStopHistory() {
  if (!stopHistoryEmpty || !stopHistoryList) return;
  const entries = [...state.stopHistory].sort((left, right) => new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime());
  stopHistoryEmpty.hidden = entries.length > 0;
  stopHistoryList.innerHTML = "";

  if (entries.length === 0) {
    return;
  }

  stopHistoryList.innerHTML = entries
    .map(
      (entry) => {
        const serviceCount = Number(entry.serviceCount) || 0;
        const isServiceStop = serviceCount > 0;
        return `
          <article class="stop-history-item">
            <div class="stop-history-main">
              <strong>${escapeHtml(entry.dropoff)}</strong>
              <p>${escapeHtml(isServiceStop ? entry.note || cargoText("contracts.history.serviceDone", "Service-Stop abgeschlossen") : entry.pickups.join(" · ") || cargoText("contracts.history.pickupOpen", "Abholung offen"))}</p>
              <div class="stop-history-meta">
                <span>${escapeHtml(isServiceStop
                  ? cargoText(serviceCount === 1 ? "contracts.history.serviceCount" : "contracts.history.serviceCountPlural", "{count} Service-Aufträge", { count: serviceCount })
                  : cargoText("contracts.stop.containerCount", "{count} Container", { count: entry.loadCount }))}</span>
                <span>${formatScuAmount(entry.scu)}</span>
                <span>${escapeHtml(formatDateTimeDisplay(entry.completedAt))}</span>
              </div>
            </div>
            <div class="stop-history-side">
              <span>${escapeHtml(entry.missionTitles.join(" · ") || cargoText("contracts.history.fallbackMission", "Auftrag"))}</span>
            </div>
          </article>
        `;
      },
    )
    .join("");
}

function ensureSelectedLoad() {
  const entries = getAllLoads().filter(({ mission, load }) =>
    !isLoadDelivered(load) && canMissionUseCurrentCargoGrid(mission),
  );
  if (entries.length === 0) {
    if (state.selectedLoadId !== null) {
      state.selectedLoadId = null;
      state.selectionCleared = false;
      persist();
    }
    return null;
  }

  const current = findLoadById(state.selectedLoadId);
  if (current && entries.some(({ load }) => load.id === current.load.id)) {
    return current;
  }

  if (state.selectionCleared) {
    return null;
  }

  const preferredEntry = entries.find(({ load }) => !load.placement);
  if (!preferredEntry) {
    return null;
  }
  state.selectedLoadId = preferredEntry.load.id;
  state.selectionCleared = false;
  persist();
  return preferredEntry;
}

function renderLevelFilters() {
  const targets = [topdownLevelFilter, isoLevelFilter].filter(Boolean);
  if (targets.length === 0) return;

  const activeCells = buildActiveCells();
  const maxHeight = activeCells.reduce((best, cell) => Math.max(best, cell.capacity), 0);
  const options = ["all", ...Array.from({ length: maxHeight }, (_, index) => index)];
  const current = getEffectiveLevelFilter(maxHeight);
  const markup = options
    .map((option) => {
      const activeClass = option === current ? " is-active" : "";
      const label = option === "all"
        ? cargoText("contracts.level.all", "Alle Ebenen")
        : cargoText("contracts.level.level", "Ebene {number}", { number: Number(option) + 1 });
      const value = String(option);
      return `<button type="button" class="level-filter-button${activeClass}" data-level-filter="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    })
    .join("");

  targets.forEach((target) => {
    target.innerHTML = markup;
    target.querySelectorAll("[data-level-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        const value = button.dataset.levelFilter;
        state.levelFilter = value === "all" ? "all" : clamp(Number(value) || 0, 0, 8);
        persist();
        render();
      });
    });
  });
}

function registerCargoUiEvents() {
  document.querySelectorAll("[data-iso-zoom-action]").forEach((button) => {
    button.addEventListener("click", () => changeIsoZoom(button.dataset.isoZoomAction));
  });

  document.addEventListener("pointerdown", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest(".location-picker-toggle, #locationPickerMenu [data-location-index]")) {
      event.preventDefault();
      return;
    }
    if (target.closest("input[data-location-picker], #locationPickerMenu")) return;
    closeLocationPicker();
  });

  document.addEventListener("focusin", (event) => {
    const input = event.target instanceof Element ? event.target.closest("input[data-location-picker]") : null;
    if (input) openLocationPicker(input, { showAll: true });
  });

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const option = target.closest("#locationPickerMenu [data-location-index]");
    if (option) {
      chooseLocationPickerValue(Number(option.dataset.locationIndex));
      return;
    }

    const toggle = target.closest(".location-picker-toggle");
    if (toggle) {
      const input = toggle.closest(".location-picker-field")?.querySelector("input[data-location-picker]");
      if (!input) return;
      input.focus({ preventScroll: true });
      openLocationPicker(input, { showAll: true });
      return;
    }

    const input = target.closest("input[data-location-picker]");
    if (input) openLocationPicker(input, { showAll: true });
  });

  document.addEventListener("input", (event) => {
    const input = event.target instanceof Element ? event.target.closest("input[data-location-picker]") : null;
    if (input) openLocationPicker(input);
  });

  document.addEventListener("keydown", (event) => {
    const input = event.target instanceof Element ? event.target.closest("input[data-location-picker]") : null;
    const option = event.target instanceof Element ? event.target.closest("#locationPickerMenu [data-location-index]") : null;

    if (input && event.key === "ArrowDown") {
      event.preventDefault();
      openLocationPicker(input, { showAll: true });
      getLocationPickerMenu().querySelector("[data-location-index]")?.focus();
      return;
    }

    if (option && ["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const options = Array.from(getLocationPickerMenu().querySelectorAll("[data-location-index]"));
      const currentIndex = options.indexOf(option);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      options[(currentIndex + direction + options.length) % options.length]?.focus();
      return;
    }

    if ((input || option) && event.key === "Escape") {
      event.preventDefault();
      const locationInput = activeLocationPickerInput;
      locationInput?.focus();
      closeLocationPicker();
    }
  });

  document.addEventListener("scroll", positionLocationPickerMenu, true);
  window.addEventListener("resize", positionLocationPickerMenu);

  createShipIndicator?.addEventListener("click", () => {
    setActivePage("fleet");
  });

  createShipIndicator?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setActivePage("fleet");
  });

  overviewDeselectButton?.addEventListener("click", () => {
    state.selectedLoadId = null;
    state.selectionCleared = true;
    persist();
    render();
  });

  nextStopSelect?.addEventListener("change", () => {
    selectStopByDropoff(nextStopSelect.value);
    lastUnloadPlan = null;
    persist();
    render();
  });

  currentLocationForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const location = String(currentLocationInput?.value || "").trim();
    state.currentLocation = location;
    consumeRunRoutePriority(location);
    lastUnloadPlan = null;
    closeLocationPicker();
    persist();
    render();
  });

  hubCurrentLocationSelect?.addEventListener("change", () => {
    state.currentLocation = String(hubCurrentLocationSelect.value || "").trim();
    consumeRunRoutePriority(state.currentLocation);
    lastUnloadPlan = null;
    closeLocationPicker();
    persist();
    render();
  });

  runCurrentLocationSelect?.addEventListener("change", () => {
    state.currentLocation = String(runCurrentLocationSelect.value || "").trim();
    consumeRunRoutePriority(state.currentLocation);
    lastUnloadPlan = null;
    persist();
    render();
  });

  runShipButton?.addEventListener("click", () => setActivePage("fleet"));

  runEmptyAction?.addEventListener("click", () => {
    setActivePage(runEmptyAction.dataset.target || "overview");
  });

  runArriveButton?.addEventListener("click", () => {
    const runState = buildRunRouteState();
    const point = runState.selectedPoint;
    if (!point) return;
    state.selectedRunRoutePointKey = point.key;
    state.currentLocation = point.dropoff;
    consumeRunRoutePriority(point.dropoff);
    if (point.hasCargo || point.hasService) selectStopByDropoff(point.dropoff);
    lastUnloadPlan = null;
    persist();
    render();
  });

  runOpenLoadButton?.addEventListener("click", () => {
    const runState = buildRunRouteState();
    const firstOpenLoad = runState.pickupEntries.find(({ mission, load }) => !isLoadPlacementInCurrentLayout(load, mission));
    if (firstOpenLoad) {
      state.selectedLoadId = firstOpenLoad.load.id;
      state.selectionCleared = false;
      persist();
    }
    setActivePage("load");
  });

  runAutoLoadButton?.addEventListener("click", () => {
    const runState = buildRunRouteState();
    const point = runState.selectedPoint;
    if (!point?.hasPickup || !runState.arrived) return;
    const result = autoLoadEntries(runState.pickupEntries.filter(({ mission, load }) => (
      !load.placement && getLoadPickup(load, mission) === point.dropoff
    )), {
      persistAfter: false,
      renderAfter: false,
      settings: getAutoloadSettings(),
    });
    lastRunAutoLoadResult = { ...result, pointKey: point.key };
    persist();
    render();
  });

  runCompletePickupButton?.addEventListener("click", async () => {
    const runState = buildRunRouteState();
    const point = runState.selectedPoint;
    if (!point?.hasPickup || !runState.arrived || runState.pendingPickupSegments.length > 0) return;
    const incomplete = runState.pickupEntries.length === 0 || runState.placedPickupEntries.length < runState.pickupEntries.length;
    if (incomplete) {
      const confirmed = await showMissionConfirmDialog({
        kicker: cargoText("run.dialog.kicker", "Einsatzmodus"),
        title: cargoText("run.dialog.pickupIncompleteTitle", "Abholung trotzdem abschließen?"),
        message: runState.pickupEntries.length === 0
          ? cargoText("run.dialog.pickupAmountOpen", "Für diese Abholung ist noch keine konkrete Frachtmenge hinterlegt.")
          : cargoText("run.dialog.pickupIncomplete", "Erst {placed} von {total} Containern sind im aktuellen Schiff verladen.", {
              placed: runState.placedPickupEntries.length,
              total: runState.pickupEntries.length,
            }),
        confirmLabel: cargoText("run.actions.completePickup", "Abholung erledigt"),
      });
      if (!confirmed) return;
    }
    const pickupTaskKeys = point.pickupTaskKeys?.length ? point.pickupTaskKeys : [point.key];
    state.runCompletedRoutePoints = [...new Set([...(state.runCompletedRoutePoints || []), ...pickupTaskKeys])];
    state.selectedRunRoutePointKey = "";
    persist();
    render();
  });

  runCompleteStopButton?.addEventListener("click", async () => {
    const dropoff = runCompleteStopButton.dataset.dropoff || "";
    if (!dropoff) return;
    const runState = buildRunRouteState();
    const missionIds = runState.selectedPoint?.dropoff === dropoff
      ? runState.selectedPoint.missionIds || []
      : [];
    await completeRouteStop(dropoff, { missionIds });
  });

  clearCurrentLocationButton?.addEventListener("click", () => {
    state.currentLocation = "";
    if (currentLocationInput) currentLocationInput.value = "";
    lastUnloadPlan = null;
    closeLocationPicker();
    persist();
    render();
  });

  suggestUnloadPlanButton?.addEventListener("click", () => {
    lastUnloadPlan = computeUnloadPlan({ activateFirst: true });
    persist();
    render();
  });

  missionTypeSelect?.addEventListener("change", () => {
    syncMissionTypeFields();
    renderSummary();
    updateDimensionHint();
  });

  addProcurementItemButton?.addEventListener("click", () => {
    createProcurementItemRow();
    renderCreateDraftSummary();
    procurementItemList?.querySelector(".procurement-item-row:last-child [name=procurementItemQuantity]")?.focus();
  });

  procurementItemList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".procurement-item-remove");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest(".procurement-item-row")?.remove();
    syncProcurementItemRows();
    renderMissionImportQuality();
    renderCreateDraftSummary();
  });

  addCourierPackageButton?.addEventListener("click", () => {
    createCourierPackageRow();
    renderCreateDraftSummary();
    courierPackageList?.querySelector(".courier-package-row:last-child [name=courierPackageName]")?.focus();
  });

  courierPackageList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".courier-package-remove");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest(".courier-package-row")?.remove();
    syncCourierPackageRows();
    renderMissionImportQuality();
    renderCreateDraftSummary();
  });

  addDeliveryItemButton?.addEventListener("click", () => {
    createDeliveryItemRow();
    renderMissionImportQuality();
    renderCreateDraftSummary();
    deliveryItemList?.querySelector(".delivery-item-row:last-child [name=deliveryItemName]")?.focus();
  });

  deliveryItemList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".delivery-item-remove");
    if (!removeButton || removeButton.disabled) return;
    removeButton.closest(".delivery-item-row")?.remove();
    syncDeliveryItemRows();
    renderMissionImportQuality();
    renderCreateDraftSummary();
  });

  missionCancelButton?.addEventListener("click", () => {
    resetMissionForm();
  });

  missionForm.addEventListener("input", (event) => {
    markMissionImportFieldReviewed(event.target);
    if (event.target === missionForm.elements.maxContainerScu) {
      refreshContainerGroupCompatibility();
      updateDimensionHint();
      return;
    }
    renderCreateDraftSummary();
  });

  missionForm.addEventListener("change", () => {
    renderCreateDraftSummary();
  });

  recalculateContainerGroupsButton?.addEventListener("click", recalculateMissionContainerGroups);

  missionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(missionForm);
    const payoutInput = Number(formData.get("payout"));
    const missionColor = formData.get("color") || DEFAULT_COLOR;
    const title = String(formData.get("title")).trim();
    const notes = String(formData.get("notes")).trim();
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : null;
    const maxContainerScu = normalizeMissionMaxContainerScu(formData.get("maxContainerScu"));
    const missionType = normalizeMissionType(formData.get("missionType"));
    const editingMissionId = getMissionEditId();
    const existingMission = editingMissionId
      ? state.missions.find((mission) => mission.id === editingMissionId) || null
      : null;
    const missionId = editingMissionId || createRuntimeId();
    const createdAt = existingMission?.createdAt || new Date().toISOString();

    if (missionType === "courier") {
      const packages = collectCourierPackages(existingMission);
      if (packages.length === 0 || packages.some((item) => !item.name || !item.pickup || !item.destination)) {
        await showAppNotice(cargoText("contracts.alert.courierDetailsMissing", "Trage für jedes Paket Gegenstand, Abholort und Lieferziel ein."));
        return;
      }
      const serviceDetails = {
        customer: String(formData.get("courierCustomer") || "").trim(),
        location: packages[0]?.destination || "",
        packages,
        maxPackageScu: parseMissionDecimal(formData.get("courierMaxPackageScu")),
        instructions: String(formData.get("courierInstructions") || "").trim(),
      };

      saveMissionEntry({
        id: missionId,
        type: "courier",
        title,
        pickup: packages[0]?.pickup || "",
        dropoff: packages.length === 1 ? packages[0].destination : `${new Set(packages.map((item) => item.destination)).size} Ziele`,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : currentActiveFleetEntry()?.id || "",
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = packages[0]?.pickup || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "delivery") {
      const items = collectDeliveryItems(existingMission);
      if (items.length === 0 || items.some((item) => !item.name || !item.pickup || !item.destination)) {
        await showAppNotice(cargoText("contracts.alert.deliveryDetailsMissing", "Trage für jede Lieferposition Gegenstand, Abholort und Lieferziel ein."));
        return;
      }
      const draftSegments = buildDeliverySegments(items);
      const requestedScu = draftSegments.reduce((sum, segment) => sum + (Number(segment.totalScu) || 0), 0);
      const cargoReadiness = requestedScu > 0 ? getCargoReadiness({ requestedScu }) : null;
      if (!existingMission && !isDispatcherMode() && cargoReadiness && !cargoReadiness.ok && (!cargoReadiness.fleetEntry || !cargoReadiness.hasCargo)) {
        await showAppNotice(cargoReadiness.message);
        return;
      }
      const cargoMerge = existingMission && isCargoMission(existingMission)
        ? mergeCargoMissionDraft(existingMission, draftSegments, {
            allowProgressRouteCorrection: isMissionCompleted(existingMission),
          })
        : {
            segments: draftSegments,
            loads: createLoadsFromConsignments(draftSegments),
            newLoadIds: [],
            blockedRouteCount: 0,
          };
      if (cargoMerge.blockedRouteCount > 0) {
        const shouldContinue = await showMissionConfirmDialog({
          kicker: cargoText("contracts.dialog.cargoEditKicker", "Frachtfortschritt"),
          title: cargoText("contracts.dialog.cargoEditTitle", "Verladene Fracht schützen?"),
          message: cargoText("contracts.dialog.cargoEditMessage", "Bereits verladene oder gelieferte Positionen bleiben unverändert; nur offene Lieferpositionen werden aktualisiert."),
          confirmLabel: cargoText("contracts.actions.updateOpenRoutes", "Offene Strecken aktualisieren"),
        });
        if (!shouldContinue) return;
      }
      const destinations = [...new Set(items.map((item) => item.destination).filter(Boolean))];
      const serviceDetails = {
        customer: String(formData.get("deliveryCustomer") || "").trim(),
        location: destinations[0] || "",
        packages: items,
        maxPackageScu: null,
        instructions: String(formData.get("deliveryInstructions") || "").trim(),
        dangerNote: "",
      };

      saveMissionEntry({
        id: missionId,
        type: "delivery",
        title,
        pickup: items[0]?.pickup || "",
        dropoff: destinations.length === 1 ? destinations[0] : `${destinations.length} Ziele`,
        notes,
        payout,
        maxContainerScu: draftSegments.length ? Math.max(...draftSegments.map((segment) => Number(segment.scuPerLoad) || 0)) : null,
        color: missionColor,
        assignedFleetEntryId: existingMission
          ? existingMission.assignedFleetEntryId || ""
          : isDispatcherMode()
            ? ""
            : cargoReadiness?.fleetEntry?.id || currentActiveFleetEntry()?.id || "",
        serviceDetails,
        segments: cargoMerge.segments,
        loads: cargoMerge.loads,
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = cargoMerge.loads.find((load) => cargoMerge.newLoadIds.includes(load.id))?.id || null;
      state.selectionCleared = !state.selectedLoadId;
      state.selectedStopDropoff = items[0]?.pickup || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "refuel") {
      const serviceDetails = {
        customer: String(formData.get("refuelCustomer") || "").trim(),
        location: String(formData.get("refuelLocation") || "").trim(),
        serviceType: normalizeRefuelServiceType(formData.get("refuelServiceType")),
        hydrogenAmount: parseMissionDecimal(formData.get("refuelHydrogenAmount")),
        quantumAmount: parseMissionDecimal(formData.get("refuelQuantumAmount")),
        targetVehicle: String(formData.get("refuelTargetVehicle") || "").trim(),
        hydrogenRate: parseMissionDecimal(formData.get("refuelHydrogenRate")),
        quantumRate: parseMissionDecimal(formData.get("refuelQuantumRate")),
        bonus: String(formData.get("refuelBonus") || "").trim(),
      };
      const refuelReadiness = getRefuelReadiness(serviceDetails.serviceType, serviceDetails);
      if (!existingMission && !isDispatcherMode() && !refuelReadiness.ok) {
        await showAppNotice(refuelReadiness.message);
        return;
      }

      saveMissionEntry({
        id: missionId,
        type: "refuel",
        title,
        pickup: "",
        dropoff: serviceDetails.location,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : refuelReadiness.activeEntry.id,
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = serviceDetails.location || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "investigation") {
      const serviceDetails = {
        customer: String(formData.get("investigationCustomer") || "").trim(),
        location: String(formData.get("investigationLocation") || "").trim(),
        subject: String(formData.get("investigationSubject") || "").trim(),
        caseNumber: String(formData.get("investigationCaseNumber") || "").trim(),
        leadInvestigator: String(formData.get("investigationLead") || "").trim(),
        instructions: String(formData.get("investigationInstructions") || "").trim(),
        dangerNote: String(formData.get("investigationDangerNote") || "").trim(),
      };

      saveMissionEntry({
        id: missionId,
        type: "investigation",
        title,
        pickup: "",
        dropoff: serviceDetails.location,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : currentActiveFleetEntry()?.id || "",
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = serviceDetails.location || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "salvage") {
      const serviceDetails = {
        customer: String(formData.get("salvageCustomer") || "").trim(),
        location: String(formData.get("salvageLocation") || "").trim(),
        salvageTarget: String(formData.get("salvageTarget") || "").trim(),
        claimNumber: String(formData.get("salvageClaimNumber") || "").trim(),
        instructions: String(formData.get("salvageInstructions") || "").trim(),
      };
      const readiness = getSalvageReadiness();
      if (!existingMission && !isDispatcherMode() && !readiness.ok) {
        await showAppNotice(readiness.message);
        return;
      }

      saveMissionEntry({
        id: missionId,
        type: "salvage",
        title,
        pickup: "",
        dropoff: serviceDetails.location,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : readiness.activeEntry.id,
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = serviceDetails.location || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "procurement") {
      const location = String(formData.get("procurementLocation") || "").trim();
      const serviceDetails = {
        customer: String(formData.get("procurementCustomer") || "").trim(),
        location,
        items: collectProcurementItems(location),
        instructions: String(formData.get("procurementInstructions") || "").trim(),
      };
      if (serviceDetails.items.length === 0) {
        await showAppNotice(cargoText("contracts.alert.procurementItemMissing", "Trage mindestens einen Gegenstand mit Anzahl ein."));
        return;
      }

      saveMissionEntry({
        id: missionId,
        type: "procurement",
        title,
        pickup: "",
        dropoff: serviceDetails.location,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : currentActiveFleetEntry()?.id || "",
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = serviceDetails.location || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "mining") {
      const serviceDetails = {
        customer: String(formData.get("miningCustomer") || "").trim(),
        location: String(formData.get("miningLocation") || "").trim(),
        miningMethod: String(formData.get("miningMethod") || "hand") === "ship" ? "ship" : "hand",
        searchArea: String(formData.get("miningSearchArea") || "").trim(),
        material: String(formData.get("miningMaterial") || "").trim(),
        targetAmount: parseMissionDecimal(formData.get("miningTargetAmount")),
        tool: String(formData.get("miningTool") || "").trim(),
        instructions: String(formData.get("miningInstructions") || "").trim(),
      };
      const readiness = getMiningReadiness(serviceDetails.miningMethod);
      if (!existingMission && !isDispatcherMode() && !readiness.ok) {
        await showAppNotice(readiness.message);
        return;
      }

      saveMissionEntry({
        id: missionId,
        type: "mining",
        title,
        pickup: "",
        dropoff: serviceDetails.location,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: isDispatcherMode() ? existingMission?.assignedFleetEntryId || "" : readiness.activeEntry?.id || "",
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = serviceDetails.location || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    if (missionType === "other") {
      const serviceDetails = {
        customer: String(formData.get("miscCustomer") || "").trim(),
        location: String(formData.get("miscLocation") || "").trim(),
        serviceType: "both",
        hydrogenAmount: null,
        quantumAmount: null,
        targetVehicle: "",
        hydrogenRate: null,
        quantumRate: null,
        bonus: "",
      };

      saveMissionEntry({
        id: missionId,
        type: "other",
        title,
        pickup: "",
        dropoff: serviceDetails.location,
        notes,
        payout,
        color: missionColor,
        assignedFleetEntryId: currentActiveFleetEntry()?.id || "",
        serviceDetails,
        segments: [],
        loads: [],
        status: existingMission?.status || "active",
        completedAt: existingMission?.completedAt || "",
        paidAt: existingMission?.paidAt || "",
        createdAt,
      });

      state.selectedLoadId = null;
      state.selectionCleared = true;
      state.selectedStopDropoff = serviceDetails.location || "";
      lastUnloadPlan = null;
      lastCargoPage = "overview";
      activePage = "overview";
      resetMissionForm();
      persist();
      render();
      return;
    }

    const consignments = collectConsignments();

    if (consignments.length === 0) {
      await showAppNotice("Lege mindestens eine Fracht mit Abholung, Lieferung und Containergröße an.");
      return;
    }

    const requestedScu = getPlannedConsignmentScu(consignments);
    const cargoReadiness = getCargoReadiness({ requestedScu });
    if (!existingMission && !isDispatcherMode() && !cargoReadiness.ok && (!cargoReadiness.fleetEntry || !cargoReadiness.hasCargo)) {
      await showAppNotice(cargoReadiness.message);
      return;
    }

    const validation = buildMissionDraftValidation();
    if (!validation.isValid && !missionValidationOverride?.checked) {
      renderMissionValidationHint();
      await showAppNotice("Die Auftragseingabe hat noch unvollständige oder unplausible Strecken. Prüfe die Hinweise oder aktiviere die Übersteuerung darunter.");
      return;
    }

    const cargoMerge = existingMission && isCargoMission(existingMission)
      ? mergeCargoMissionDraft(existingMission, consignments, {
          allowProgressRouteCorrection: isMissionCompleted(existingMission),
        })
      : {
          segments: consignments,
          loads: createLoadsFromConsignments(consignments),
          newLoadIds: [],
          blockedRouteCount: 0,
        };

    if (cargoMerge.blockedRouteCount > 0) {
      const shouldContinue = await showMissionConfirmDialog({
        kicker: cargoText("contracts.dialog.cargoEditKicker", "Frachtfortschritt"),
        title: cargoText("contracts.dialog.cargoEditTitle", "Verladene Fracht schützen?"),
        message: cargoText(
          "contracts.dialog.cargoEditMessage",
          "Mindestens eine bereits verladene oder gelieferte Strecke wurde geändert. Deren Fracht bleibt unverändert; nur offene Strecken und die übrigen Auftragsdaten werden aktualisiert.",
        ),
        confirmLabel: cargoText("contracts.actions.updateOpenRoutes", "Offene Strecken aktualisieren"),
      });
      if (!shouldContinue) return;
    }

    const { segments, loads } = cargoMerge;

    saveMissionEntry({
      id: missionId,
      type: normalizeMissionType("cargo"),
      title,
      pickup: consignments[0]?.pickup || "",
      dropoff: consignments.length === 1 ? consignments[0]?.dropoff || "" : `${consignments.length} Ziele`,
      notes,
      payout,
      maxContainerScu,
      color: missionColor,
      assignedFleetEntryId: existingMission
        ? existingMission.assignedFleetEntryId || ""
        : isDispatcherMode()
          ? ""
          : cargoReadiness.fleetEntry.id,
      serviceDetails: {
        ...getMissionServiceDetails(existingMission),
        customer: String(formData.get("cargoCustomer") || "").trim(),
      },
      segments,
      loads,
      status: existingMission?.status || "active",
      completedAt: existingMission?.completedAt || "",
      paidAt: existingMission?.paidAt || "",
      createdAt,
    });

    const selectedLoadSurvives = loads.some((load) => load.id === state.selectedLoadId);
    state.selectedLoadId = selectedLoadSurvives
      ? state.selectedLoadId
      : loads.find((load) => cargoMerge.newLoadIds.includes(load.id))?.id
        || loads.find((load) => !load.deliveredAt && !load.placement)?.id
        || null;
    state.selectionCleared = !state.selectedLoadId;
    state.selectedStopDropoff = "";
    lastUnloadPlan = null;
    lastCargoPage = existingMission && isMissionCompleted(existingMission)
      ? "overview"
      : loads.length > 0 && canUseLoadPage()
        ? "load"
        : "overview";
    activePage = lastCargoPage;
    resetMissionForm();
    persist();
    render();
  });

  consignmentList.addEventListener("input", (event) => {
    const item = event.target.closest(".consignment-item");
    if (!item) return;
    const group = event.target.closest(".container-group-row");
    if (group) {
      renderContainerShortcutButtons(group);
      syncContainerGroupHint(group);
    }
    const route = event.target.closest(".route-group-row");
    syncRouteGroupTitle(route);
    syncRouteGroupHint(route);
    syncConsignmentHint(item);
    refreshConsignmentTitles();
    updateDimensionHint();
    renderLocationSuggestions();
  });

  consignmentList.addEventListener("click", async (event) => {
    const toggleButton = event.target.closest(".consignment-toggle");
    if (toggleButton) {
      const item = toggleButton.closest(".consignment-item");
      if (!item) return;
      item.classList.toggle("is-collapsed");
      const expanded = !item.classList.contains("is-collapsed");
      toggleButton.setAttribute("aria-expanded", String(expanded));
      toggleButton.setAttribute("title", expanded ? "Fracht einklappen" : "Fracht ausklappen");
      return;
    }

    const removeButton = event.target.closest(".consignment-remove");
    if (removeButton) {
      if (consignmentList.children.length <= 1) return;
      removeButton.closest(".consignment-item")?.remove();
      refreshConsignmentTitles();
      updateDimensionHint();
      renderLocationSuggestions();
      return;
    }

    const addRouteButton = event.target.closest(".consignment-route-add");
    if (addRouteButton) {
      const item = addRouteButton.closest(".consignment-item");
      if (!item) return;
      addRouteGroupRow(item, { groups: [] });
      syncConsignmentHint(item);
      refreshConsignmentTitles();
      updateDimensionHint();
      renderLocationSuggestions();
      return;
    }

    const removeRouteButton = event.target.closest(".route-group-remove");
    if (removeRouteButton) {
      const item = removeRouteButton.closest(".consignment-item");
      const routeList = item?.querySelector('[data-role="route-group-list"]');
      if (!item || !routeList || routeList.children.length <= 1) return;
      removeRouteButton.closest(".route-group-row")?.remove();
      refreshRouteGroupTitles(item);
      syncConsignmentHint(item);
      updateDimensionHint();
      renderLocationSuggestions();
      return;
    }

    const addGroupButton = event.target.closest(".consignment-group-add");
    if (addGroupButton) {
      const route = addGroupButton.closest(".route-group-row");
      const item = addGroupButton.closest(".consignment-item");
      if (!route || !item) return;
      const defaultContainerSize = typeof getDefaultCargoContainerSizeKey === "function" ? getDefaultCargoContainerSizeKey() : "8";
      addContainerGroupRow(route, { quantity: 1, containerSize: defaultContainerSize });
      syncConsignmentHint(item);
      updateDimensionHint();
      return;
    }

    const splitRouteButton = event.target.closest(".route-auto-split");
    if (splitRouteButton) {
      const route = splitRouteButton.closest(".route-group-row");
      const item = splitRouteButton.closest(".consignment-item");
      if (!route || !item) return;
      const targetScu = readRouteTargetScu(route);
      if (!Number.isInteger(targetScu) || targetScu <= 0) {
        await showAppNotice("Bitte trage eine volle SCU-Zielmenge ein, z. B. 121.");
        return;
      }
      const suggestedGroups = buildContainerGroupsForScu(targetScu, getMissionFormMaxContainerScu());
      if (suggestedGroups.length === 0) {
        await showAppNotice("Für diese Zielmenge konnte keine Containeraufteilung erstellt werden.");
        return;
      }
      const groupList = route.querySelector('[data-role="container-group-list"]');
      if (!groupList) return;
      groupList.innerHTML = "";
      suggestedGroups.forEach((group) => addContainerGroupRow(route, group));
      syncRouteGroupHint(route);
      syncConsignmentHint(item);
      refreshConsignmentTitles();
      updateDimensionHint();
      return;
    }

    const removeGroupButton = event.target.closest(".container-group-remove");
    if (removeGroupButton) {
      const route = removeGroupButton.closest(".route-group-row");
      const item = removeGroupButton.closest(".consignment-item");
      const groupList = route?.querySelector('[data-role="container-group-list"]');
      if (!route || !item || !groupList || groupList.children.length <= 1) return;
      removeGroupButton.closest(".container-group-row")?.remove();
      refreshContainerGroupActions(route);
      syncRouteGroupHint(route);
      syncConsignmentHint(item);
      updateDimensionHint();
      return;
    }

    const shortcutButton = event.target.closest("[data-container-size-value]");
    if (!shortcutButton) return;
    const item = shortcutButton.closest(".consignment-item");
    const group = shortcutButton.closest(".container-group-row");
    const input = group?.querySelector('[data-field="containerSize"]');
    if (!item || !group || !input) return;
    input.value = shortcutButton.dataset.containerSizeValue || input.value;
    renderContainerShortcutButtons(group);
    syncContainerGroupHint(group);
    syncRouteGroupHint(group.closest(".route-group-row"));
    syncConsignmentHint(item);
    refreshConsignmentTitles();
    updateDimensionHint();
  });

  quickCargoTitle?.addEventListener("input", syncQuickMissionHint);
  quickPickup?.addEventListener("input", () => {
    syncQuickPickupFallbacks();
    syncQuickMissionHint();
    renderLocationSuggestions();
  });

  quickDestinationList?.addEventListener("input", () => {
    syncQuickMissionHint();
    renderLocationSuggestions();
  });

  quickDestinationList?.addEventListener("click", (event) => {
    const removeButton = event.target.closest(".quick-destination-remove");
    if (!removeButton) return;
    if (quickDestinationList.children.length <= 1) return;
    removeButton.closest(".quick-destination-row")?.remove();
    refreshQuickDestinationActions();
    syncQuickMissionHint();
    renderLocationSuggestions();
  });

  addQuickDestinationButton?.addEventListener("click", () => {
    addQuickDestinationRow();
    syncQuickMissionHint();
    renderLocationSuggestions();
  });

  applyQuickMissionButton?.addEventListener("click", () => {
    void applyQuickMissionCapture();
  });

  openMissionImportDialogButton?.addEventListener("click", openMissionImportDialog);
  missionImportCancel?.addEventListener("click", closeMissionImportDialog);
  missionImportApply?.addEventListener("click", () => {
    void applyMissionImportPreview();
  });
  missionImportRefresh?.addEventListener("click", () => {
    void loadMissionImportInbox();
  });
  missionImportInboxList?.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-import-action]");
    const item = actionButton?.closest("[data-import-id]");
    const importId = item?.dataset.importId || "";
    if (!actionButton || !importId) return;
    if (actionButton.dataset.importAction === "preview") {
      previewMissionImportInboxItem(importId);
      return;
    }
    if (actionButton.dataset.importAction === "dismiss") {
      void dismissMissionImportInboxItem(importId);
    }
  });
  missionImportClipboardButton?.addEventListener("click", (event) => {
    void importMissionFromClipboard(event);
  });

  missionImportFileInput?.addEventListener("change", (event) => {
    const file = missionImportFileInput.files?.[0];
    if (!file) return;
    void importMissionScreenshot(file, event);
    missionImportFileInput.value = "";
  });

  missionImportDropzone?.addEventListener("click", (event) => {
    if (event.target.closest("button, label, input")) return;
    missionImportFileInput?.click();
  });

  missionImportDropzone?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    missionImportFileInput?.click();
  });

  missionImportDropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    missionImportDropzone.classList.add("is-dragging");
  });

  missionImportDropzone?.addEventListener("dragleave", (event) => {
    if (event.relatedTarget && missionImportDropzone.contains(event.relatedTarget)) return;
    missionImportDropzone.classList.remove("is-dragging");
  });

  missionImportDropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    missionImportDropzone.classList.remove("is-dragging");
    const file = Array.from(event.dataTransfer?.files || []).find((candidate) => candidate.type.startsWith("image/"));
    if (file) void importMissionScreenshot(file, event);
  });

  missionImportPreview?.addEventListener("input", syncMissionImportPreview);
  missionImportConsignmentList?.addEventListener("click", (event) => {
    const addButton = event.target.closest(".mission-import-route-add");
    if (addButton) {
      const item = addButton.closest(".mission-import-consignment");
      const defaultDropoff = item?.querySelector('[data-field="importDropoff"]')?.value || "";
      addMissionImportRouteRow(item, { dropoff: defaultDropoff });
      syncMissionImportPreview();
      return;
    }
    const removeButton = event.target.closest(".mission-import-route-remove");
    const item = removeButton?.closest(".mission-import-consignment");
    const routeList = item?.querySelector(".mission-import-route-list");
    if (!removeButton || !routeList || routeList.children.length <= 1) return;
    removeButton.closest(".mission-import-route-row")?.remove();
    syncMissionImportPreview();
  });

  missionImportDialog?.addEventListener("click", (event) => {
    if (event.target === missionImportDialog) closeMissionImportDialog();
  });

  document.addEventListener("paste", (event) => {
    if (!missionImportDialog || missionImportDialog.hidden) return;
    const file = Array.from(event.clipboardData?.items || [])
      .find((item) => item.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    event.preventDefault();
    void importMissionScreenshot(file, event);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && missionImportDialog && !missionImportDialog.hidden) {
      closeMissionImportDialog();
    }
  });

  addConsignmentButton.addEventListener("click", () => {
    addConsignmentRow();
    setCollapsibleExpanded("consignmentBuilderBody", true);
    updateDimensionHint();
    renderLocationSuggestions();
  });

  moduleTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.moduleTarget || "hub";
      if (target === "cargo") {
        setActivePage(lastCargoPage);
        return;
      }
      if (target === "fleet") {
        setFleetView("ships");
        setActivePage("fleet");
        return;
      }
      setActivePage(target);
    });
  });

  pageTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      setActivePage(tab.dataset.pageTarget || "home");
    });
  });

  quickNavButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActivePage(button.dataset.goPage || "hub");
    });
  });

  presetSelect.addEventListener("change", async () => {
    const selection = decodeFleetPresetValue(presetSelect.value);
    if (selection.isCustom) {
      const nextLayout = {
        shipId: "",
        fleetEntryId: "",
        presetId: "custom",
        rows: state.layout.rows,
        cols: state.layout.cols,
        defaultHeight: state.layout.defaultHeight,
        overloadMode: false,
      };
      if (!(await confirmShipLayoutChange(nextLayout))) {
        syncLayoutInputs();
        return;
      }
      state.layout.shipId = "";
      state.layout.fleetEntryId = "";
      state.layout.presetId = "custom";
      state.layout.blockedSlots = [];
      state.layout.heightOverrides = {};
      state.layout.overloadMode = false;
      state.layout.overloadSlotIds = [];
      persist();
      render();
      return;
    }

    const selectedShip = getCargoFleetEntries().find((entry) => entry.id === selection.fleetEntryId) || null;
    if (!selectedShip) {
      syncLayoutInputs();
      return;
    }
    const shipDefinition = getShipGridDefinition(findShipLibraryEntryById(selectedShip.shipId), selection.overloadMode);
    const nextLayout = {
      shipId: selectedShip.shipId,
      fleetEntryId: selectedShip.id,
      presetId: selectedShip.shipId,
      rows: shipDefinition.rows,
      cols: shipDefinition.cols,
      defaultHeight: shipDefinition.defaultHeight,
      overloadMode: selection.overloadMode,
    };
    if (!(await confirmShipLayoutChange(nextLayout))) {
      syncLayoutInputs();
      return;
    }
    applyLayoutDefinition(shipDefinition, selectedShip.id, selectedShip.shipId, selection.overloadMode);
    state = pruneInvalidPlacements(state);
    persist();
    render();
  });

  layoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selection = decodeFleetPresetValue(presetSelect.value);
    if (selection.isCustom) {
      const nextLayout = {
        shipId: "",
        fleetEntryId: "",
        presetId: "custom",
        rows: clamp(Number(layoutForm.rows.value) || 4, 2, MAX_GRID_ROWS),
        cols: clamp(Number(layoutForm.cols.value) || 6, 2, 12),
        defaultHeight: clamp(Number(layoutForm.cellHeight.value) || 3, 1, 8),
        overloadMode: false,
      };
      if (!(await confirmShipLayoutChange(nextLayout))) {
        syncLayoutInputs();
        return;
      }
      state.layout.shipId = "";
      state.layout.fleetEntryId = "";
      state.layout.presetId = "custom";
      state.layout.rows = nextLayout.rows;
      state.layout.cols = nextLayout.cols;
      state.layout.defaultHeight = nextLayout.defaultHeight;
      state.layout.blockedSlots = [];
      state.layout.heightOverrides = {};
      state.layout.overloadMode = false;
      state.layout.overloadSlotIds = [];
      state = pruneInvalidPlacements(state);
      persist();
      render();
      return;
    }

    const selectedShip = getCargoFleetEntries().find((entry) => entry.id === selection.fleetEntryId) || null;
    if (!selectedShip) {
      syncLayoutInputs();
      return;
    }
    const shipDefinition = getShipGridDefinition(findShipLibraryEntryById(selectedShip.shipId), selection.overloadMode);
    const nextLayout = {
      shipId: selectedShip.shipId,
      fleetEntryId: selectedShip.id,
      presetId: selectedShip.shipId,
      rows: shipDefinition.rows,
      cols: shipDefinition.cols,
      defaultHeight: shipDefinition.defaultHeight,
      overloadMode: selection.overloadMode,
    };

    if (!(await confirmShipLayoutChange(nextLayout))) {
      syncLayoutInputs();
      return;
    }

    applyLayoutDefinition(shipDefinition, selectedShip.id, selectedShip.shipId, selection.overloadMode);
    state = pruneInvalidPlacements(state);
    persist();
    render();
  });
}
