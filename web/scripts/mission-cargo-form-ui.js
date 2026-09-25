// Cargo consignment and route form UI.
function parseCargoContainerValue(value, fallback = { width: 2, depth: 2, height: 2 }) {
  const normalized = String(value || "").trim();
  const directProfile = getCargoContainerProfileByKey(normalized);
  if (directProfile) {
    return {
      key: directProfile.key,
      label: directProfile.label,
      width: directProfile.width,
      depth: directProfile.depth,
      height: directProfile.height,
      scu: directProfile.scu,
      isHandheld: Boolean(directProfile.handheld),
      isPlaceable: !directProfile.handheld,
      isStandard: true,
    };
  }

  if (normalized.startsWith("custom:")) {
    const [, rawDims = ""] = normalized.split(":");
    const [width, depth, height] = rawDims.split("x").map((part) => clamp(Number(part) || 1, 1, 8));
    return {
      key: normalized,
      label: `${width * depth * height} SCU`,
      width,
      depth,
      height,
      scu: width * depth * height,
      isHandheld: false,
      isPlaceable: true,
      isStandard: false,
    };
  }

  const width = clamp(Number(fallback.width) || 2, 1, 8);
  const depth = clamp(Number(fallback.depth) || 2, 1, 8);
  const height = clamp(Number(fallback.height) || 2, 1, 8);
  return {
    key: `custom:${width}x${depth}x${height}`,
    label: `${width * depth * height} SCU`,
    width,
    depth,
    height,
    scu: width * depth * height,
    isHandheld: false,
    isPlaceable: true,
    isStandard: false,
  };
}

function renderContainerShortcutButtons(groupNode) {
  const target = groupNode?.querySelector('[data-role="container-shortcuts"]');
  const input = groupNode?.querySelector('[data-field="containerSize"]');
  if (!target || !input) return;

  const maxProfile = getCurrentShipMaxContainerProfile();
  const missionMaxContainerScu = getMissionFormMaxContainerScu();
  target.innerHTML = getCargoContainerProfiles()
    .map(
      (profile) => {
        const isSelected = input.value === profile.key;
        const isTooLargeForMission = isContainerProfileTooLargeForMission(profile);
        const isTooLargeForShip = isContainerProfileTooLargeForCurrentShip(profile);
        const isTooLarge = isTooLargeForMission || isTooLargeForShip;
        const warningText = isTooLargeForMission
          ? t("contracts.consignments.tooLargeForMission", { value: profile.label, max: `${missionMaxContainerScu} SCU` })
          : isTooLargeForShip
            ? t("contracts.consignments.tooLargeForShip", { value: profile.label, max: maxProfile.label })
          : "";
        return `
        <button
          type="button"
          class="ghost-button consignment-size-chip${isSelected ? " is-active" : ""}${profile.handheld ? " is-handheld" : ""}${isTooLarge ? " is-oversize" : ""}"
          data-container-size-value="${escapeHtml(profile.key)}"
          aria-pressed="${isSelected ? "true" : "false"}"
          ${warningText ? `title="${escapeHtml(warningText)}"` : ""}
        >
          ${escapeHtml(profile.label)}
        </button>
      `;
      },
    )
    .join("");
}

function addContainerGroupRow(routeNode, values = {}) {
  const list = routeNode?.querySelector('[data-role="container-group-list"]');
  if (!list) return null;

  const defaultContainerSize = getDefaultCargoContainerSizeKey();
  const groupNode = document.createElement("article");
  groupNode.className = "container-group-row";
  groupNode.innerHTML = `
    <div class="container-group-main">
      <label>
        Anzahl
        <input type="number" data-field="quantity" min="1" max="64" value="1" required />
      </label>
      <div class="consignment-size-picker">
        <span class="consignment-section-label">Größe</span>
        <input type="hidden" data-field="containerSize" value="${escapeHtml(defaultContainerSize)}" />
        <div class="consignment-size-shortcuts" data-role="container-shortcuts"></div>
      </div>
      <button type="button" class="ghost-button container-group-remove icon-only-button" aria-label="Containergruppe entfernen" title="Containergruppe entfernen">
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
          </svg>
        </span>
      </button>
    </div>
    <div class="form-hint container-group-hint" data-role="container-group-hint"></div>
  `;

  const quantityField = groupNode.querySelector('[data-field="quantity"]');
  const sizeField = groupNode.querySelector('[data-field="containerSize"]');
  const hasLegacyDimensions = values.width || values.depth || values.height;
  const matchingProfile = values.containerSize
    ? parseCargoContainerValue(values.containerSize, values)
    : parseCargoContainerValue(
        hasLegacyDimensions
          ? getCargoContainerProfileByDimensions(
              clamp(Number(values.width) || 2, 1, 8),
              clamp(Number(values.depth) || 2, 1, 8),
              clamp(Number(values.height) || 2, 1, 8),
            )?.key || defaultContainerSize
          : defaultContainerSize,
        values,
      );

  quantityField.value = String(clamp(Number(values.quantity) || 1, 1, 64));
  sizeField.value = matchingProfile.key;
  renderContainerShortcutButtons(groupNode);
  list.appendChild(groupNode);
  syncContainerGroupHint(groupNode);
  refreshContainerGroupActions(routeNode);
  syncRouteGroupHint(routeNode);
  return groupNode;
}

function addConsignmentRow(values = {}) {
  const node = consignmentTemplate.content.firstElementChild.cloneNode(true);
  const fields = {
    title: node.querySelector('[data-field="title"]'),
    expectedTotalScu: node.querySelector('[data-field="expectedTotalScu"]'),
  };

  fields.title.value = values.title || "";
  if (fields.expectedTotalScu) fields.expectedTotalScu.value = values.expectedTotalScu > 0 ? String(values.expectedTotalScu) : "";
  translateStaticText(node);

  const routes = Array.isArray(values.routes) && values.routes.length > 0
    ? values.routes
    : [
        {
          pickup: values.pickup,
          dropoff: values.dropoff,
          groups: Array.isArray(values.groups) ? values.groups : [],
        },
      ];

  consignmentList.appendChild(node);
  routes.forEach((route) => addRouteGroupRow(node, route));
  syncConsignmentHint(node);
  refreshConsignmentTitles();
}

function addRouteGroupRow(consignmentNode, values = {}) {
  const list = consignmentNode?.querySelector('[data-role="route-group-list"]');
  if (!list) return null;

  const routeNode = document.createElement("article");
  routeNode.className = "route-group-row";
  routeNode.innerHTML = `
    <div class="route-group-head">
      <strong class="route-group-title" data-i18n="contracts.consignments.route">Strecke</strong>
      <button type="button" class="ghost-button route-group-remove icon-only-button" aria-label="Strecke entfernen" title="Strecke entfernen" data-i18n-aria-label="contracts.consignments.removeRoute" data-i18n-title="contracts.consignments.removeRoute">
        <span class="button-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 8h10l-1 12H8L7 8z" />
          </svg>
        </span>
      </button>
    </div>
    <div class="consignment-route-group">
      <div class="route-input-grid">
        <label data-i18n-label="contracts.consignments.pickup">
          Abholung
          <input type="text" data-field="pickup" list="locationSuggestions" placeholder="Everus Harbor" required />
        </label>

        <label data-i18n-label="contracts.consignments.delivery">
          Lieferung
          <input type="text" data-field="dropoff" list="locationSuggestions" placeholder="Baijini Point" required />
        </label>

        <label data-i18n-label="contracts.consignments.targetAmount">
          Zielmenge
          <input type="number" data-field="targetScu" min="1" step="1" placeholder="121 SCU" />
        </label>

        <button type="button" class="secondary-button route-auto-split" data-i18n="contracts.consignments.split">Aufteilen</button>
      </div>
      <div class="form-hint route-group-hint" data-role="route-group-hint"></div>
    </div>
    <div class="consignment-container-groups">
      <div class="consignment-subhead">
        <span class="consignment-section-label" data-i18n="contracts.consignments.containerGroups">Containergruppen</span>
        <button type="button" class="secondary-button consignment-group-add" data-i18n="contracts.consignments.addGroup">Gruppe hinzufügen</button>
      </div>
      <div class="container-group-list" data-role="container-group-list"></div>
    </div>
  `;

  routeNode.querySelector('[data-field="pickup"]').value = values.pickup || "";
  routeNode.querySelector('[data-field="dropoff"]').value = values.dropoff || "";
  routeNode.querySelector('[data-field="targetScu"]').value = values.targetScu ? String(values.targetScu) : "";
  translateStaticText(routeNode);
  list.appendChild(routeNode);

  const groups = Array.isArray(values.groups)
    ? values.groups
    : [];
  groups.forEach((group) => addContainerGroupRow(routeNode, group));
  syncRouteGroupHint(routeNode);
  refreshRouteGroupTitles(consignmentNode);
  return routeNode;
}

function refreshConsignmentTitles() {
  const count = consignmentList.children.length;
  Array.from(consignmentList.children).forEach((node, index) => {
    const title = node.querySelector('[data-field="title"]')?.value.trim();
    const heading = node.querySelector(".consignment-item-title");
    if (!heading) return;
    if (count <= 1) {
      heading.textContent = title || t("contracts.quick.cargo");
      refreshRouteGroupTitles(node);
      return;
    }
    const partLabel = t("contracts.consignments.part", { number: index + 1 });
    heading.textContent = title ? `${partLabel} · ${title}` : partLabel;
    refreshRouteGroupTitles(node);
  });
}

function refreshRouteGroupTitles(consignmentNode) {
  const routes = Array.from(consignmentNode?.querySelectorAll(".route-group-row") || []);
  routes.forEach((routeNode, index) => {
    const title = routeNode.querySelector(".route-group-title");
    const removeButton = routeNode.querySelector(".route-group-remove");
    const pickup = routeNode.querySelector('[data-field="pickup"]')?.value.trim();
    const dropoff = routeNode.querySelector('[data-field="dropoff"]')?.value.trim();
    const routeBase = t("contracts.consignments.route");
    const routeLabel = routes.length <= 1 ? routeBase : `${routeBase} ${index + 1}`;
    if (title) {
      title.textContent = pickup || dropoff ? `${routeLabel} · ${pickup || "?"} → ${dropoff || "?"}` : routeLabel;
    }
    if (removeButton) {
      removeButton.disabled = routes.length <= 1;
    }
  });
}

function syncRouteGroupTitle(routeNode) {
  const consignmentNode = routeNode?.closest(".consignment-item");
  if (!consignmentNode) return;
  refreshRouteGroupTitles(consignmentNode);
}

function readRouteTargetScu(routeNode) {
  const rawValue = String(routeNode?.querySelector('[data-field="targetScu"]')?.value || "").replace(",", ".").trim();
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function syncRouteGroupHint(routeNode) {
  if (!routeNode) return;
  const hint = routeNode.querySelector('[data-role="route-group-hint"]');
  if (!hint) return;

  const draft = readRouteGroupDraft(routeNode);
  const totalQuantity = draft.groups.reduce((sum, group) => sum + group.quantity, 0);
  const totalScu = draft.groups.reduce((sum, group) => sum + group.totalScu, 0);
  const validation = buildRouteDraftValidation(draft);
  const touched = validation.touched;
  const status = !touched
    ? "Bereit für eine neue Strecke"
    : validation.errors.length > 0
      ? validation.errors.join(" · ")
      : validation.warnings.length > 0
        ? validation.warnings.join(" · ")
        : "Zielmenge erfüllt";

  hint.classList.remove("form-hint-neutral", "form-hint-success", "form-hint-warning", "form-hint-error");
  hint.classList.add(
    !touched
      ? "form-hint-neutral"
      : validation.errors.length > 0
        ? "form-hint-error"
        : validation.warnings.length > 0
          ? "form-hint-warning"
          : "form-hint-success",
  );

  hint.innerHTML = `
    <strong>${draft.groups.length} Gruppe${draft.groups.length === 1 ? "" : "n"} · ${totalQuantity} Container · ${formatScuAmount(totalScu)} geplant</strong>
    <span>${escapeHtml(status)}</span>
  `;
}

function refreshContainerGroupActions(routeNode) {
  const groups = Array.from(routeNode?.querySelectorAll(".container-group-row") || []);
  groups.forEach((groupNode) => {
    const removeButton = groupNode.querySelector(".container-group-remove");
    if (removeButton) {
      removeButton.disabled = groups.length <= 1;
    }
  });
}

function syncContainerGroupHint(groupNode) {
  const draft = readContainerGroupDraft(groupNode);
  const hint = groupNode.querySelector('[data-role="container-group-hint"]');
  if (!hint) return;
  const scu = draft.scuPerLoad;
  const totalScu = draft.quantity * scu;
  const maxProfile = getCurrentShipMaxContainerProfile();
  const missionMaxContainerScu = getMissionFormMaxContainerScu();
  const isTooLargeForMission = Boolean(missionMaxContainerScu && draft.isPlaceable && draft.scuPerLoad > missionMaxContainerScu);
  const isTooLargeForShip = Boolean(maxProfile && draft.isPlaceable && draft.scuPerLoad > maxProfile.scu);
  const isTooLarge = isTooLargeForMission || isTooLargeForShip;
  groupNode.classList.toggle("has-oversize-container", isTooLarge);
  hint.classList.toggle("form-hint-warning", isTooLarge);
  hint.innerHTML = `
    <strong>${draft.quantity} x ${formatScuAmount(scu, { unit: false })} = ${formatScuAmount(totalScu, { unit: false })} Gesamt</strong>
    ${isTooLargeForMission
      ? `<span>${escapeHtml(t("contracts.consignments.tooLargeForMission", { value: draft.containerLabel, max: `${missionMaxContainerScu} SCU` }))}</span>`
      : isTooLargeForShip
        ? `<span>${escapeHtml(t("contracts.consignments.tooLargeForShip", { value: draft.containerLabel, max: maxProfile.label }))}</span>`
        : ""}
  `;
}

function refreshContainerGroupCompatibility() {
  Array.from(consignmentList?.querySelectorAll(".container-group-row") || []).forEach((groupNode) => {
    renderContainerShortcutButtons(groupNode);
    syncContainerGroupHint(groupNode);
  });
}

function syncConsignmentHint(node) {
  const draft = readConsignmentDraft(node);
  const hint = node.querySelector('[data-role="consignment-hint"]');
  if (!hint) return;
  const groups = draft.routes.flatMap((route) => route.groups);
  const groupCount = groups.length;
  const routeCount = draft.routes.length;
  const totalQuantity = groups.reduce((sum, group) => sum + group.quantity, 0);
  const totalScu = groups.reduce((sum, group) => sum + group.totalScu, 0);
  const placeableQuantity = groups
    .filter((group) => group.isPlaceable)
    .reduce((sum, group) => sum + group.quantity, 0);
  const routeValidations = draft.routes.map((route) => buildRouteDraftValidation(route)).filter((validation) => validation.touched);
  const errorCount = routeValidations.reduce((sum, validation) => sum + validation.errors.length, 0);
  const warningCount = routeValidations.reduce((sum, validation) => sum + validation.warnings.length, 0);
  hint.classList.remove("form-hint-neutral", "form-hint-success", "form-hint-warning", "form-hint-error");
  hint.classList.add(
    errorCount > 0
      ? "form-hint-error"
      : warningCount > 0
        ? "form-hint-warning"
        : totalScu > 0
          ? "form-hint-success"
          : "form-hint-neutral",
  );
  hint.innerHTML = `
    <strong>${routeCount} Strecke${routeCount === 1 ? "" : "n"} · ${formatScuAmount(totalScu)} Gesamt</strong>
    <span>${groupCount} Gruppe${groupCount === 1 ? "" : "n"} · ${totalQuantity} Container${placeableQuantity !== totalQuantity ? ` · ${placeableQuantity} verladbar` : ""}${errorCount > 0 ? ` · ${errorCount} Problem${errorCount === 1 ? "" : "e"}` : warningCount > 0 ? ` · ${warningCount} Hinweis${warningCount === 1 ? "" : "e"}` : ""}</span>
  `;
}

function readContainerGroupDraft(groupNode) {
  const container = parseCargoContainerValue(groupNode.querySelector('[data-field="containerSize"]')?.value || "8");
  const quantity = clamp(Number(groupNode.querySelector('[data-field="quantity"]')?.value) || 1, 1, 64);
  return {
    quantity,
    containerSize: container.key,
    containerLabel: container.label,
    width: container.width,
    depth: container.depth,
    height: container.height,
    scuPerLoad: container.scu,
    totalScu: container.scu * quantity,
    isHandheld: container.isHandheld,
    isPlaceable: container.isPlaceable,
  };
}

function readConsignmentDraft(node) {
  const routes = Array.from(node.querySelectorAll(".route-group-row")).map(readRouteGroupDraft);
  return {
    title: String(node.querySelector('[data-field="title"]')?.value || "").trim(),
    expectedTotalScu: Number(String(node.querySelector('[data-field="expectedTotalScu"]')?.value || "").replace(",", ".")) || 0,
    routes,
  };
}

function readRouteGroupDraft(routeNode) {
  return {
    pickup: String(routeNode.querySelector('[data-field="pickup"]')?.value || "").trim(),
    dropoff: String(routeNode.querySelector('[data-field="dropoff"]')?.value || "").trim(),
    targetScu: readRouteTargetScu(routeNode),
    groups: Array.from(routeNode.querySelectorAll(".container-group-row")).map(readContainerGroupDraft),
  };
}

function collectConsignments() {
  return Array.from(consignmentList.children)
    .flatMap((node, index) => {
      const draft = readConsignmentDraft(node);
      const derivedExpectedScu = draft.routes.reduce((sum, route) => sum + (route.targetScu > 0 ? route.targetScu : 0), 0);
      const expectedCargoScu = draft.expectedTotalScu > 0 ? draft.expectedTotalScu : derivedExpectedScu;
      return draft.routes.flatMap((route, routeIndex) => {
        if (!route.pickup || !route.dropoff) return [];
        const title = draft.title || `${route.pickup} → ${route.dropoff}`;
        if (route.targetScu <= 0 || route.groups.length === 0) {
          return [{
            id: createRuntimeId(),
            title,
            pickup: route.pickup,
            dropoff: route.dropoff,
            quantity: 0,
            containerSize: "",
            width: 0,
            depth: 0,
            height: 0,
            isHandheld: false,
            isPlaceable: false,
            scuPerLoad: 0,
            totalScu: 0,
            routeTargetScu: 0,
            expectedCargoScu,
            quantityPending: true,
            cargoIndex: index,
            cargoRouteIndex: routeIndex,
            cargoGroupIndex: 0,
            order: index * 10000 + routeIndex * 100,
          }];
        }
        return route.groups.map((group, groupIndex) => ({
          id: createRuntimeId(),
          title,
          pickup: route.pickup,
          dropoff: route.dropoff,
          quantity: group.quantity,
          containerSize: group.containerSize,
          width: group.width,
          depth: group.depth,
          height: group.height,
          isHandheld: group.isHandheld,
          isPlaceable: group.isPlaceable,
          scuPerLoad: group.scuPerLoad,
          totalScu: group.totalScu,
          routeTargetScu: route.targetScu,
          expectedCargoScu,
          quantityPending: false,
          cargoIndex: index,
          cargoRouteIndex: routeIndex,
          cargoGroupIndex: groupIndex,
          order: index * 10000 + routeIndex * 100 + groupIndex,
        }));
      });
    });
}

function getPlannedConsignmentScu(consignments) {
  const cargoTotals = new Map();
  consignments.forEach((consignment) => {
    const cargoKey = Number.isInteger(consignment.cargoIndex) ? consignment.cargoIndex : consignment.id;
    const current = cargoTotals.get(cargoKey) || { actual: 0, expected: 0 };
    current.actual += Number(consignment.totalScu) || 0;
    current.expected = Math.max(current.expected, Number(consignment.expectedCargoScu) || 0);
    cargoTotals.set(cargoKey, current);
  });
  return [...cargoTotals.values()].reduce((sum, cargo) => sum + Math.max(cargo.actual, cargo.expected), 0);
}

