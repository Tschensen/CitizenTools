// Dynamic procurement, courier and delivery form rows.
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
