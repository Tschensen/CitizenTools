(function initLocationAliasLearning(globalScope) {
  function createLocationAliasLearningController({ systemDatabaseController, helpers }) {
    const dom = {
      dialog: document.querySelector("#locationAliasSuggestionDialog"),
      list: document.querySelector("#locationAliasSuggestionList"),
      status: document.querySelector("#locationAliasSuggestionStatus"),
      cancel: document.querySelector("#locationAliasSuggestionCancel"),
      confirm: document.querySelector("#locationAliasSuggestionConfirm"),
    };
    let pendingSuggestions = [];
    let busy = false;

    function collectLocationFields(mission) {
      const fields = new Map();
      const add = (key, fieldLabel, value) => {
        const normalizedValue = String(value || "").trim();
        if (normalizedValue && !fields.has(key)) fields.set(key, { key, fieldLabel, value: normalizedValue });
      };
      const missionType = helpers.normalizeMissionType(mission?.type);
      const details = mission?.serviceDetails && typeof mission.serviceDetails === "object"
        ? mission.serviceDetails
        : {};

      if (["courier", "delivery"].includes(missionType)) {
        (Array.isArray(details.packages) ? details.packages : []).forEach((entry, index) => {
          const entryKey = String(entry?.id || index);
          add(`package:${entryKey}:pickup`, helpers.t("contracts.alias.field.pickup"), entry?.pickup);
          add(`package:${entryKey}:destination`, helpers.t("contracts.alias.field.destination"), entry?.destination);
        });
        return fields;
      }

      if (missionType === "cargo") {
        (Array.isArray(mission?.segments) ? mission.segments : []).forEach((segment, index) => {
          const routeKey = segment?.cargoIndex !== undefined || segment?.cargoRouteIndex !== undefined
            ? `${segment?.cargoIndex ?? 0}:${segment?.cargoRouteIndex ?? index}`
            : String(segment?.id || index);
          add(`cargo:${routeKey}:pickup`, helpers.t("contracts.alias.field.pickup"), segment?.pickup);
          add(`cargo:${routeKey}:dropoff`, helpers.t("contracts.alias.field.destination"), segment?.dropoff);
        });
        return fields;
      }

      add("service:location", helpers.t("contracts.alias.field.location"), details.location || mission?.dropoff);
      if (missionType === "mining") {
        add("service:searchArea", helpers.t("contracts.alias.field.searchArea"), details.searchArea);
      }
      if (missionType === "procurement") {
        (Array.isArray(details.items) ? details.items : []).forEach((entry, index) => {
          const entryKey = String(entry?.id || index);
          add(`item:${entryKey}:destination`, helpers.t("contracts.alias.field.destination"), entry?.destination);
        });
      }
      return fields;
    }

    function collectCorrections(previousMission, nextMission) {
      const previousFields = collectLocationFields(previousMission);
      const nextFields = collectLocationFields(nextMission);
      return [...previousFields.entries()].flatMap(([key, previous]) => {
        const next = nextFields.get(key);
        if (!next || previous.value === next.value) return [];
        return [{
          original: previous.value,
          corrected: next.value,
          fieldLabel: next.fieldLabel || previous.fieldLabel,
        }];
      });
    }

    function renderDialog() {
      if (!dom.dialog || !dom.list || !dom.status || !dom.confirm) return;
      dom.list.innerHTML = pendingSuggestions.map((suggestion, index) => `
        <label class="location-alias-suggestion-item">
          <input type="checkbox" data-alias-suggestion-index="${index}" checked />
          <span class="location-alias-suggestion-copy">
            <strong>${helpers.escapeHtml(suggestion.canonicalName)}</strong>
            <span>${helpers.escapeHtml(helpers.t("contracts.alias.item", {
              alias: suggestion.alias,
              field: suggestion.fieldLabel || helpers.t("contracts.alias.field.location"),
            }))}</span>
          </span>
        </label>
      `).join("");
      dom.status.hidden = true;
      dom.status.textContent = "";
      dom.confirm.disabled = false;
      dom.dialog.hidden = pendingSuggestions.length === 0;
      if (pendingSuggestions.length > 0) dom.confirm.focus();
    }

    function close() {
      pendingSuggestions = [];
      busy = false;
      if (dom.dialog) dom.dialog.hidden = true;
      if (dom.status) {
        dom.status.hidden = true;
        dom.status.textContent = "";
      }
    }

    async function queueMissionCorrection(previousMission, nextMission, { force = false } = {}) {
      if (!force && !previousMission?.sourceImportId) return;
      const corrections = collectCorrections(previousMission, nextMission);
      if (corrections.length === 0) return;
      const suggestions = await systemDatabaseController.buildAliasSuggestions(corrections);
      if (suggestions.length === 0) return;
      const byKey = new Map(
        [...pendingSuggestions, ...suggestions].map((suggestion) => [
          `${suggestion.locationId}:${suggestion.alias.toLocaleLowerCase("de")}`,
          suggestion,
        ]),
      );
      pendingSuggestions = [...byKey.values()];
      renderDialog();
    }

    async function saveSelected() {
      if (busy || !dom.list || !dom.confirm) return;
      const selected = [...dom.list.querySelectorAll("[data-alias-suggestion-index]:checked")]
        .map((input) => pendingSuggestions[Number(input.dataset.aliasSuggestionIndex)])
        .filter(Boolean);
      if (selected.length === 0) {
        close();
        return;
      }

      busy = true;
      dom.confirm.disabled = true;
      const failures = [];
      for (const suggestion of selected) {
        try {
          await systemDatabaseController.addAlias(suggestion.locationId, suggestion.alias);
        } catch (error) {
          failures.push({ suggestion, error });
        }
      }
      if (failures.length === 0) {
        close();
        return;
      }

      pendingSuggestions = failures.map(({ suggestion }) => suggestion);
      renderDialog();
      dom.status.className = "form-hint form-hint-error";
      dom.status.textContent = failures.some(({ error }) => error?.code === "ALIAS_CONFLICT")
        ? helpers.t("contracts.alias.errorConflict")
        : helpers.t("contracts.alias.errorSave");
      dom.status.hidden = false;
      busy = false;
    }

    function init() {
      dom.cancel?.addEventListener("click", close);
      dom.confirm?.addEventListener("click", () => void saveSelected());
      dom.dialog?.addEventListener("click", (event) => {
        if (event.target === dom.dialog && !busy) close();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dom.dialog && !dom.dialog.hidden && !busy) close();
      });
    }

    return { init, queueMissionCorrection, collectCorrections };
  }

  globalScope.createLocationAliasLearningController = createLocationAliasLearningController;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createLocationAliasLearningController };
  }
}(typeof window !== "undefined" ? window : globalThis));
