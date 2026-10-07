// Review markers for recognized mission fields.
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
