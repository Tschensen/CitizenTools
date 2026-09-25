(function registerSystemDatabaseModule() {
  const TYPE_OPTIONS = [
    ["system", "systemdb.type.system", "Sternensystem"],
    ["planet", "systemdb.type.planet", "Planet"],
    ["moon", "systemdb.type.moon", "Mond"],
    ["city", "systemdb.type.city", "Stadt / Landezone"],
    ["station", "systemdb.type.station", "Station"],
    ["outpost", "systemdb.type.outpost", "Außenposten"],
    ["lagrange", "systemdb.type.lagrange", "Lagrange-Punkt"],
    ["jump_point", "systemdb.type.jumpPoint", "Sprungpunkt"],
    ["other", "systemdb.type.other", "Sonstiges"],
  ];

  const STATUS_OPTIONS = [
    ["active", "systemdb.status.active", "Aktiv"],
    ["archived", "systemdb.status.archived", "Archiviert"],
  ];

  function createSystemDatabaseController({ helpers }) {
    const dom = {
      form: document.querySelector("#systemDbForm"),
      formTitle: document.querySelector("#systemDbFormTitle"),
      formStatus: document.querySelector("#systemDbFormStatus"),
      submitButton: document.querySelector("#systemDbSubmitButton"),
      cancelButton: document.querySelector("#systemDbCancelButton"),
      typeSelect: document.querySelector("#systemDbTypeSelect"),
      statusSelect: document.querySelector("#systemDbStatusSelect"),
      viewTabs: Array.from(document.querySelectorAll("[data-systemdb-view-target]")),
      viewSections: Array.from(document.querySelectorAll("[data-systemdb-view]")),
      summary: document.querySelector("#systemDbSummary"),
      search: document.querySelector("#systemDbSearch"),
      systemFilter: document.querySelector("#systemDbSystemFilter"),
      typeFilter: document.querySelector("#systemDbTypeFilter"),
      statusFilter: document.querySelector("#systemDbStatusFilter"),
      status: document.querySelector("#systemDbStatus"),
      empty: document.querySelector("#systemDbEmpty"),
      list: document.querySelector("#systemDbList"),
      refresh: document.querySelector("#systemDbRefreshButton"),
      systemSuggestions: document.querySelector("#systemDbSystemSuggestions"),
      deleteDialog: document.querySelector("#systemDbDeleteDialog"),
      deleteDialogTitle: document.querySelector("#systemDbDeleteDialogTitle"),
      deleteDialogMessage: document.querySelector("#systemDbDeleteDialogMessage"),
      deleteDialogCancel: document.querySelector("#systemDbDeleteDialogCancel"),
      deleteDialogConfirm: document.querySelector("#systemDbDeleteDialogConfirm"),
    };

    let locations = [];
    let activeView = "database";
    let loaded = false;
    let busy = false;
    let pendingDelete = null;

    const text = (key, fallback, params = {}) => {
      const translated = helpers.t(key, params);
      return translated === key
        ? String(fallback || "").replace(/\{(\w+)\}/g, (match, name) => (
          Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        ))
        : translated;
    };

    const escape = (value) => helpers.escapeHtml(String(value ?? ""));

    function isRemoteAvailable() {
      return window.location.protocol === "http:" || window.location.protocol === "https:";
    }

    function typeLabel(value) {
      const option = TYPE_OPTIONS.find(([key]) => key === value) || TYPE_OPTIONS.at(-1);
      return text(option[1], option[2]);
    }

    function statusLabel(value) {
      const option = STATUS_OPTIONS.find(([key]) => key === value) || STATUS_OPTIONS[0];
      return text(option[1], option[2]);
    }

    function normalizeSearch(value) {
      return String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("de")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    }

    function resolveAliasSuggestion(correction) {
      const alias = String(correction?.original || "").trim();
      const canonicalName = String(correction?.corrected || "").trim();
      const aliasKey = normalizeSearch(alias);
      const canonicalKey = normalizeSearch(canonicalName);
      if (
        aliasKey.length < 3
        || !canonicalKey
        || aliasKey === canonicalKey
        || /^(?:\d+\s+(?:ziele|starts|targets)|ziel offen|einsatzort offen|location open|target open|ziel|start|ort|station|location|target|pickup|dropoff|offen|open)$/i.test(aliasKey)
      ) return null;

      const target = locations.find((entry) => normalizeSearch(entry.name) === canonicalKey);
      if (!target || target.status !== "active") return null;
      const originalAlreadyKnown = locations.some((entry) => {
        const aliasMatch = (Array.isArray(entry.aliases) ? entry.aliases : [])
          .some((entryAlias) => normalizeSearch(entryAlias) === aliasKey);
        if (aliasMatch) return true;
        const canonicalMatch = normalizeSearch(entry.name) === aliasKey;
        return canonicalMatch && entry.source !== "state";
      });
      if (originalAlreadyKnown) return null;
      return {
        locationId: target.id,
        canonicalName: target.name,
        alias,
        fieldLabel: String(correction?.fieldLabel || "").trim(),
      };
    }

    async function apiRequest(url, options = {}) {
      const response = await fetch(url, {
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) },
        ...options,
      });
      let payload = {};
      try {
        payload = await response.json();
      } catch (_error) {
        payload = {};
      }
      if (!response.ok) {
        const error = new Error(payload.message || `HTTP ${response.status}`);
        error.code = payload.error || "REQUEST_FAILED";
        error.payload = payload;
        throw error;
      }
      return payload;
    }

    async function load() {
      if (!isRemoteAvailable()) {
        loaded = true;
        locations = [];
        render();
        return;
      }
      setStatus(text("systemdb.status.loading", "Systemdatenbank wird geladen ..."), "neutral");
      try {
        const payload = await apiRequest("./api/locations?status=all");
        locations = Array.isArray(payload.locations) ? payload.locations : [];
        loaded = true;
        render();
        helpers.renderLocationSuggestions();
        helpers.renderApp?.();
      } catch (error) {
        loaded = true;
        locations = [];
        render();
        setStatus(text("systemdb.error.load", "Systemdatenbank konnte nicht geladen werden."), "error");
      }
    }

    async function buildAliasSuggestions(corrections) {
      if (!loaded) await load();
      if (!isRemoteAvailable()) return [];
      const suggestions = (Array.isArray(corrections) ? corrections : [])
        .map(resolveAliasSuggestion)
        .filter(Boolean);
      const byKey = new Map();
      suggestions.forEach((suggestion) => {
        const key = `${suggestion.locationId}:${normalizeSearch(suggestion.alias)}`;
        if (!byKey.has(key)) byKey.set(key, suggestion);
      });
      return [...byKey.values()];
    }

    async function addAlias(locationId, alias) {
      const payload = await apiRequest(`./api/locations/${encodeURIComponent(locationId)}/aliases`, {
        method: "POST",
        body: JSON.stringify({ alias }),
      });
      if (payload.location) {
        const index = locations.findIndex((entry) => entry.id === payload.location.id);
        if (index >= 0) locations.splice(index, 1, payload.location);
        else locations.push(payload.location);
        render();
        helpers.renderLocationSuggestions();
      }
      return payload;
    }

    function setStatus(message, kind = "neutral") {
      if (!dom.status) return;
      dom.status.textContent = message;
      dom.status.className = `form-hint form-hint-${kind}`;
      dom.status.hidden = !message;
    }

    function setFormStatus(message, kind = "neutral") {
      if (!dom.formStatus) return;
      dom.formStatus.textContent = message;
      dom.formStatus.className = `form-hint form-hint-${kind}`;
      dom.formStatus.hidden = !message;
    }

    function setView(view) {
      activeView = view === "create" ? "create" : "database";
      renderView();
    }

    function renderView() {
      const editing = Boolean(dom.form?.elements.locationId?.value);
      dom.viewTabs.forEach((button) => {
        const selected = button.dataset.systemdbViewTarget === activeView;
        if (button.dataset.systemdbViewTarget === "create") {
          button.textContent = editing
            ? text("systemdb.tabs.edit", "Ort bearbeiten")
            : text("systemdb.tabs.create", "Neuen Ort anlegen");
        } else {
          button.textContent = text("systemdb.tabs.database", "Datenbank");
        }
        button.classList.toggle("primary-button", selected);
        button.classList.toggle("secondary-button", !selected);
        button.setAttribute("aria-selected", String(selected));
      });
      dom.viewSections.forEach((section) => {
        section.hidden = section.dataset.systemdbView !== activeView;
      });
      if (dom.formTitle) {
        dom.formTitle.textContent = editing
          ? text("systemdb.form.editTitle", "Ort bearbeiten")
          : text("systemdb.form.title", "Ortseintrag");
      }
      if (dom.submitButton) {
        dom.submitButton.textContent = editing
          ? text("common.saveChanges", "Änderungen speichern")
          : text("systemdb.form.save", "Ort speichern");
      }
      if (dom.cancelButton) dom.cancelButton.hidden = !editing;
    }

    function renderOptions() {
      const selectedType = dom.typeSelect?.value || "other";
      const selectedStatus = dom.statusSelect?.value || "active";
      if (dom.typeSelect) {
        dom.typeSelect.innerHTML = TYPE_OPTIONS
          .map(([value, key, fallback]) => `<option value="${value}">${escape(text(key, fallback))}</option>`)
          .join("");
        dom.typeSelect.value = TYPE_OPTIONS.some(([value]) => value === selectedType) ? selectedType : "other";
      }
      if (dom.statusSelect) {
        dom.statusSelect.innerHTML = STATUS_OPTIONS
          .map(([value, key, fallback]) => `<option value="${value}">${escape(text(key, fallback))}</option>`)
          .join("");
        dom.statusSelect.value = STATUS_OPTIONS.some(([value]) => value === selectedStatus) ? selectedStatus : "active";
      }
    }

    function renderFilters() {
      const systems = [...new Set(locations.map((entry) => entry.starSystem).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right, "de", { sensitivity: "base" }));
      if (dom.systemSuggestions) {
        dom.systemSuggestions.innerHTML = systems.map((value) => `<option value="${escape(value)}"></option>`).join("");
      }
      if (dom.systemFilter) {
        const selected = dom.systemFilter.value;
        dom.systemFilter.innerHTML = [
          `<option value="">${escape(text("systemdb.filter.allSystems", "Alle Systeme"))}</option>`,
          ...systems.map((value) => `<option value="${escape(value)}">${escape(value)}</option>`),
        ].join("");
        dom.systemFilter.value = systems.includes(selected) ? selected : "";
      }
      if (dom.typeFilter) {
        const selected = dom.typeFilter.value;
        dom.typeFilter.innerHTML = [
          `<option value="">${escape(text("systemdb.filter.allTypes", "Alle Typen"))}</option>`,
          ...TYPE_OPTIONS.map(([value, key, fallback]) => `<option value="${value}">${escape(text(key, fallback))}</option>`),
        ].join("");
        dom.typeFilter.value = TYPE_OPTIONS.some(([value]) => value === selected) ? selected : "";
      }
      if (dom.statusFilter) {
        const selected = dom.statusFilter.value || "active";
        dom.statusFilter.innerHTML = [
          `<option value="all">${escape(text("systemdb.filter.allStatuses", "Alle Status"))}</option>`,
          ...STATUS_OPTIONS.map(([value, key, fallback]) => `<option value="${value}">${escape(text(key, fallback))}</option>`),
        ].join("");
        dom.statusFilter.value = ["all", "active", "archived"].includes(selected) ? selected : "active";
      }
    }

    function filteredLocations() {
      const query = normalizeSearch(dom.search?.value);
      const system = dom.systemFilter?.value || "";
      const type = dom.typeFilter?.value || "";
      const status = dom.statusFilter?.value || "active";
      return locations.filter((entry) => {
        if (system && entry.starSystem !== system) return false;
        if (type && entry.type !== type) return false;
        if (status !== "all" && entry.status !== status) return false;
        if (!query) return true;
        const haystack = normalizeSearch([
          entry.name,
          entry.starSystem,
          entry.parentLocation,
          ...(Array.isArray(entry.aliases) ? entry.aliases : []),
        ].join(" "));
        return query.split(/\s+/).every((part) => haystack.includes(part));
      });
    }

    function renderSummary() {
      if (!dom.summary) return;
      const active = locations.filter((entry) => entry.status === "active").length;
      const archived = locations.length - active;
      const aliases = locations.reduce((sum, entry) => sum + (Array.isArray(entry.aliases) ? entry.aliases.length : 0), 0);
      const used = locations.filter((entry) => Number(entry.usageCount) > 0).length;
      const cards = [
        [text("systemdb.summary.total", "Orte gesamt"), locations.length],
        [text("systemdb.summary.active", "Aktiv"), active],
        [text("systemdb.summary.archived", "Archiviert"), archived],
        [text("systemdb.summary.aliases", "Aliase"), aliases],
        [text("systemdb.summary.used", "In Verwendung"), used],
      ];
      dom.summary.innerHTML = cards.map(([label, value]) => `
        <div class="summary-card summary-card-compact">
          <span>${escape(label)}</span>
          <strong>${escape(value)}</strong>
        </div>
      `).join("");
    }

    function renderList() {
      if (!dom.list || !dom.empty) return;
      if (!loaded) {
        setStatus(text("systemdb.status.loading", "Systemdatenbank wird geladen ..."), "neutral");
        return;
      }
      if (!isRemoteAvailable()) {
        dom.list.innerHTML = "";
        dom.empty.hidden = true;
        setStatus(text("systemdb.error.serverRequired", "Die Systemdatenbank benötigt den lokalen Server."), "warning");
        return;
      }
      const entries = filteredLocations();
      dom.empty.hidden = entries.length > 0;
      dom.list.innerHTML = entries.length === 0 ? "" : `
        <div class="systemdb-table-head" aria-hidden="true">
          <span>${escape(text("systemdb.table.location", "Ort"))}</span>
          <span>${escape(text("systemdb.table.classification", "Einordnung"))}</span>
          <span>${escape(text("systemdb.table.aliases", "Aliase"))}</span>
          <span>${escape(text("systemdb.table.usage", "Verwendung"))}</span>
          <span>${escape(text("systemdb.table.status", "Status"))}</span>
          <span></span>
        </div>
        ${entries.map((entry) => {
          const aliases = Array.isArray(entry.aliases) ? entry.aliases : [];
          const usageCount = Number(entry.usageCount) || 0;
          const archiveLabel = entry.status === "active"
            ? text("systemdb.action.archive", "Archivieren")
            : text("systemdb.action.activate", "Aktivieren");
          return `
            <article class="systemdb-row${entry.status === "archived" ? " is-archived" : ""}" data-location-id="${escape(entry.id)}">
              <div class="systemdb-location-cell">
                <strong>${escape(entry.name)}</strong>
                ${entry.notes ? `<small>${escape(entry.notes)}</small>` : ""}
              </div>
              <div class="systemdb-classification-cell">
                <strong>${escape(typeLabel(entry.type))}</strong>
                <small>${escape([entry.starSystem, entry.parentLocation].filter(Boolean).join(" · ") || text("common.open", "offen"))}</small>
              </div>
              <div class="systemdb-alias-cell">
                ${aliases.length > 0
                  ? aliases.map((alias) => `<span>${escape(alias)}</span>`).join("")
                  : `<small>${escape(text("systemdb.table.noAliases", "Keine Aliase"))}</small>`}
              </div>
              <div class="systemdb-usage-cell">
                <strong>${usageCount}</strong>
                <small>${escape(text(usageCount === 1 ? "systemdb.table.reference" : "systemdb.table.references", usageCount === 1 ? "Referenz" : "Referenzen"))}</small>
              </div>
              <div><span class="status-badge status-${escape(entry.status)}">${escape(statusLabel(entry.status))}</span></div>
              <div class="systemdb-row-actions">
                <button class="secondary-button icon-only-button tooltip-button systemdb-edit" type="button" aria-label="${escape(text("common.edit", "Bearbeiten"))}" data-tooltip="${escape(text("common.edit", "Bearbeiten"))}">
                  <span class="button-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m4 16.5 10.8-10.8 3.5 3.5L7.5 20H4v-3.5ZM16.2 4.3l1.3-1.3a1.4 1.4 0 0 1 2 0L21 4.5a1.4 1.4 0 0 1 0 2l-1.3 1.3-3.5-3.5Z" /></svg></span>
                </button>
                <button class="secondary-button icon-only-button tooltip-button systemdb-archive" type="button" aria-label="${escape(archiveLabel)}" data-tooltip="${escape(archiveLabel)}">
                  <span class="button-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h16v4H4V4Zm1 6h14v10H5V10Zm5 2v2h4v-2h-4Z" /></svg></span>
                </button>
                <button class="ghost-button icon-only-button tooltip-button systemdb-delete" type="button" aria-label="${escape(text("common.delete", "Löschen"))}" data-tooltip="${escape(text("common.delete", "Löschen"))}">
                  <span class="button-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 5h10l-1 12H8L7 8Z" /></svg></span>
                </button>
              </div>
            </article>
          `;
        }).join("")}
      `;
      if (entries.length > 0) {
        setStatus(text("systemdb.status.visible", "{visible} von {total} Orten sichtbar", {
          visible: entries.length,
          total: locations.length,
        }), "neutral");
      } else {
        setStatus(text("systemdb.status.noMatches", "Keine Orte entsprechen den Filtern."), "neutral");
      }
      bindTooltips();
    }

    function bindTooltips() {
      if (typeof window.normalizeAppTooltipTitles === "function") {
        window.normalizeAppTooltipTitles();
      }
    }

    function render() {
      renderOptions();
      renderView();
      renderFilters();
      renderSummary();
      renderList();
    }

    function resetForm() {
      dom.form?.reset();
      if (dom.form?.elements.locationId) dom.form.elements.locationId.value = "";
      if (dom.form?.elements.type) dom.form.elements.type.value = "other";
      if (dom.form?.elements.status) dom.form.elements.status.value = "active";
      setFormStatus("");
      renderView();
    }

    function editLocation(entry) {
      if (!dom.form) return;
      dom.form.elements.locationId.value = entry.id;
      dom.form.elements.name.value = entry.name || "";
      dom.form.elements.starSystem.value = entry.starSystem || "";
      dom.form.elements.parentLocation.value = entry.parentLocation || "";
      dom.form.elements.type.value = entry.type || "other";
      dom.form.elements.status.value = entry.status || "active";
      dom.form.elements.aliases.value = (entry.aliases || []).join("\n");
      dom.form.elements.notes.value = entry.notes || "";
      setFormStatus("");
      setView("create");
      helpers.setActivePage("systems");
      dom.form.elements.name.focus();
    }

    function readFormPayload() {
      const aliases = String(dom.form?.elements.aliases?.value || "")
        .split(/[\n,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      return {
        name: String(dom.form?.elements.name?.value || "").trim(),
        starSystem: String(dom.form?.elements.starSystem?.value || "").trim(),
        parentLocation: String(dom.form?.elements.parentLocation?.value || "").trim(),
        type: dom.form?.elements.type?.value || "other",
        status: dom.form?.elements.status?.value || "active",
        aliases,
        notes: String(dom.form?.elements.notes?.value || "").trim(),
      };
    }

    async function submitForm(event) {
      event.preventDefault();
      if (busy || !dom.form) return;
      const locationId = String(dom.form.elements.locationId.value || "");
      const payload = readFormPayload();
      if (!payload.name) {
        setFormStatus(text("systemdb.error.nameRequired", "Bitte einen Ortsnamen eintragen."), "error");
        return;
      }
      busy = true;
      dom.submitButton.disabled = true;
      setFormStatus(text("systemdb.status.saving", "Ort wird gespeichert ..."), "neutral");
      try {
        await apiRequest(locationId ? `./api/locations/${encodeURIComponent(locationId)}` : "./api/locations", {
          method: locationId ? "PUT" : "POST",
          body: JSON.stringify(payload),
        });
        await load();
        resetForm();
        setView("database");
        setStatus(text(locationId ? "systemdb.status.updated" : "systemdb.status.created", locationId ? "Ort aktualisiert." : "Ort angelegt."), "success");
      } catch (error) {
        const message = error.code === "LOCATION_EXISTS"
          ? text("systemdb.error.exists", "Ein Ort mit diesem Namen und dieser Einordnung existiert bereits.")
          : text("systemdb.error.save", "Der Ort konnte nicht gespeichert werden.");
        setFormStatus(message, "error");
      } finally {
        busy = false;
        dom.submitButton.disabled = false;
      }
    }

    async function updateStatus(entry) {
      if (busy) return;
      busy = true;
      const nextStatus = entry.status === "active" ? "archived" : "active";
      try {
        await apiRequest(`./api/locations/${encodeURIComponent(entry.id)}`, {
          method: "PUT",
          body: JSON.stringify({ ...entry, status: nextStatus }),
        });
        await load();
        setStatus(text(nextStatus === "active" ? "systemdb.status.activated" : "systemdb.status.archivedDone", nextStatus === "active" ? "Ort aktiviert." : "Ort archiviert."), "success");
      } catch (_error) {
        setStatus(text("systemdb.error.save", "Der Ort konnte nicht gespeichert werden."), "error");
      } finally {
        busy = false;
      }
    }

    function openDeleteDialog(entry) {
      pendingDelete = entry;
      const inUse = Number(entry.usageCount) > 0;
      const alreadyArchived = inUse && entry.status === "archived";
      dom.deleteDialogTitle.textContent = alreadyArchived
        ? text("systemdb.dialog.inUseTitle", "Ort wird verwendet")
        : inUse
        ? text("systemdb.dialog.archiveTitle", "Verwendeten Ort archivieren?")
        : text("systemdb.dialog.deleteTitle", "Ort löschen?");
      dom.deleteDialogMessage.textContent = alreadyArchived
        ? text("systemdb.dialog.inUseArchived", "{name} wird noch {count}-mal verwendet und bleibt deshalb archiviert erhalten.", {
          name: entry.name,
          count: entry.usageCount,
        })
        : inUse
        ? text("systemdb.dialog.inUse", "{name} wird noch {count}-mal verwendet und kann nicht gelöscht werden. Stattdessen archivieren?", {
          name: entry.name,
          count: entry.usageCount,
        })
        : text("systemdb.dialog.deleteMessage", "{name} und alle zugehörigen Aliase endgültig löschen?", { name: entry.name });
      dom.deleteDialogConfirm.textContent = alreadyArchived
        ? text("systemdb.action.close", "Schließen")
        : inUse
        ? text("systemdb.action.archive", "Archivieren")
        : text("common.delete", "Löschen");
      dom.deleteDialogCancel.hidden = alreadyArchived;
      dom.deleteDialog.hidden = false;
      dom.deleteDialogConfirm.focus();
    }

    function closeDeleteDialog() {
      pendingDelete = null;
      if (dom.deleteDialog) dom.deleteDialog.hidden = true;
      if (dom.deleteDialogCancel) dom.deleteDialogCancel.hidden = false;
    }

    async function confirmDelete() {
      const entry = pendingDelete;
      if (!entry || busy) return;
      closeDeleteDialog();
      if (Number(entry.usageCount) > 0) {
        if (entry.status !== "archived") await updateStatus(entry);
        return;
      }
      busy = true;
      try {
        await apiRequest(`./api/locations/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
        await load();
        setStatus(text("systemdb.status.deleted", "Ort gelöscht."), "success");
      } catch (error) {
        if (error.code === "LOCATION_IN_USE") {
          await load();
          const refreshed = locations.find((candidate) => candidate.id === entry.id);
          if (refreshed) openDeleteDialog(refreshed);
        } else {
          setStatus(text("systemdb.error.delete", "Der Ort konnte nicht gelöscht werden."), "error");
        }
      } finally {
        busy = false;
      }
    }

    function handleListClick(event) {
      const row = event.target.closest("[data-location-id]");
      if (!row) return;
      const entry = locations.find((candidate) => candidate.id === row.dataset.locationId);
      if (!entry) return;
      if (event.target.closest(".systemdb-edit")) editLocation(entry);
      if (event.target.closest(".systemdb-archive")) void updateStatus(entry);
      if (event.target.closest(".systemdb-delete")) openDeleteDialog(entry);
    }

    function init() {
      dom.viewTabs.forEach((button) => button.addEventListener("click", () => setView(button.dataset.systemdbViewTarget)));
      dom.form?.addEventListener("submit", submitForm);
      dom.cancelButton?.addEventListener("click", () => {
        resetForm();
        setView("database");
      });
      dom.refresh?.addEventListener("click", () => void load());
      dom.list?.addEventListener("click", handleListClick);
      [dom.search, dom.systemFilter, dom.typeFilter, dom.statusFilter].forEach((control) => {
        control?.addEventListener(control === dom.search ? "input" : "change", renderList);
      });
      dom.deleteDialogCancel?.addEventListener("click", closeDeleteDialog);
      dom.deleteDialogConfirm?.addEventListener("click", () => void confirmDelete());
      dom.deleteDialog?.addEventListener("click", (event) => {
        if (event.target === dom.deleteDialog) closeDeleteDialog();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dom.deleteDialog && !dom.deleteDialog.hidden) closeDeleteDialog();
      });
      resetForm();
      render();
      void load();
    }

    function getActiveLocationNames() {
      return locations
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.name)
        .filter(Boolean);
    }

    function getActiveLocations() {
      return locations
        .filter((entry) => entry.status === "active")
        .map((entry) => ({
          ...entry,
          aliases: [...(Array.isArray(entry.aliases) ? entry.aliases : [])],
        }));
    }

    return {
      init,
      load,
      render,
      setView,
      getActiveLocationNames,
      getActiveLocations,
      buildAliasSuggestions,
      addAlias,
    };
  }

  window.createSystemDatabaseController = createSystemDatabaseController;
})();
