// Shared location suggestions and keyboard/pointer picker.
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

function registerLocationPickerEvents() {
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
}
