const { STORAGE_KEY, DEFAULT_COLOR, PRESET_ORDER, FLEET_STATUS_LABELS, SHIP_MANUFACTURERS, LOCATION_SUGGESTIONS } = window.AppConfig;
const { SHIP_PRESETS } = window.ShipPresets;
const { APP_LANGUAGE_OPTIONS, SHIP_CLASS_OPTIONS, REFUEL_SHIP_CLASSES } = window.AppConfig;
const { createFinanceController, createLedgerEntry } = window.FinanceModule;
const { createStatisticsController } = window.StatisticsModule;
const { MISSION_TYPE_LABELS } = window.AppConfig;
const { createMissionIncomeForCompletedMission } = window.LedgerAutomation;
const Autoload = window.AutoloadModule;
const UnloadGuidance = window.UnloadGuidanceModule;
const RouteOptimizer = window.RouteOptimizerModule;
const REMOTE_STATE_URL = "./api/state";
const APP_MODE_STORAGE_KEY = `${STORAGE_KEY}:active-mode`;
const DISPATCHER_MODE_ENABLED = false;
const APP_MODES = DISPATCHER_MODE_ENABLED ? ["solo", "dispatcher"] : ["solo"];
const OCR_URL = "./api/ocr";
const MISSION_IMPORTS_URL = "./api/imports";
const MISSION_IMPORT_PROGRESS_URL = "./api/imports/progress";
const IMPORT_TOKEN_SETTINGS_URL = "./api/settings/import-token";
const SHIP_BUILDER_BASE_COLOR = DEFAULT_COLOR;
const SHIP_BUILDER_OVERLOAD_COLOR = "#e2b84f";
const FLEET_REGISTRATION_PLACEHOLDER = "XX-0000-XX";
const SOLO_PILOT_ID = "pilot-solo";
const SOLO_PILOT_DEFAULT_NAME = "Solo-Pilot";
const MAX_GRID_ROWS = 30;
const HANGAR_SIZE_LABELS = {
  S: "Klein · S",
  M: "Mittel · M",
  L: "Groß · L",
  XL: "Extra groß · XL",
  XXL: "Extra extra groß · XXL",
};
const STANDARD_CONTAINER_PROFILES = [
  { key: "hand", label: "1/8 SCU", scu: 0.125, width: 0, depth: 0, height: 0, handheld: true },
  { key: "1", label: "1 SCU", scu: 1, width: 1, depth: 1, height: 1 },
  { key: "2", label: "2 SCU", scu: 2, width: 2, depth: 1, height: 1 },
  { key: "4", label: "4 SCU", scu: 4, width: 2, depth: 2, height: 1 },
  { key: "8", label: "8 SCU", scu: 8, width: 2, depth: 2, height: 2 },
  { key: "16", label: "16 SCU", scu: 16, width: 4, depth: 2, height: 2 },
  { key: "24", label: "24 SCU", scu: 24, width: 6, depth: 2, height: 2 },
  { key: "32", label: "32 SCU", scu: 32, width: 8, depth: 2, height: 2 },
];
const MISSION_COLOR_PALETTE = [
  "#35a7ff",
  "#f4b942",
  "#2fc48d",
  "#ef6f6c",
  "#b77cff",
  "#00c2d1",
  "#f07db5",
  "#9bd84b",
  "#ff8c42",
  "#7f9cff",
  "#dfd65c",
  "#49d6b1",
];
const MIN_ACTIVE_MISSION_COLOR_DISTANCE = 105;
const ISO_ZOOM_LEVELS = [1, 1.25, 1.5, 1.75, 2];

function createRuntimeId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function cloneData(value) {
  if (globalThis.structuredClone) {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizePilotName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function getPilotIdentityKey(value) {
  return normalizePilotName(value).toLocaleLowerCase("de-DE");
}

function createPilotProfile({
  id = createRuntimeId(),
  name,
  role = "pilot",
  createdAt = new Date().toISOString(),
}) {
  return {
    id: String(id || createRuntimeId()).trim(),
    name: normalizePilotName(name),
    role: "pilot",
    createdAt: String(createdAt || new Date().toISOString()),
  };
}

function getPilotProfiles() {
  return Array.isArray(state?.pilots) ? state.pilots : [];
}

function findPilotById(pilotId) {
  const normalizedId = String(pilotId || "").trim();
  return normalizedId ? getPilotProfiles().find((pilot) => pilot.id === normalizedId) || null : null;
}

function findPilotByName(name) {
  const identityKey = getPilotIdentityKey(name);
  return identityKey
    ? getPilotProfiles().find((pilot) => getPilotIdentityKey(pilot.name) === identityKey) || null
    : null;
}

function ensurePilotProfileByName(name, { preferredId = "" } = {}) {
  const normalizedName = normalizePilotName(name);
  if (!normalizedName) return null;
  const normalizedPreferredId = String(preferredId || "").trim();
  const existingPilot = findPilotById(normalizedPreferredId) || findPilotByName(normalizedName);
  if (existingPilot) {
    existingPilot.name = normalizedName;
    return existingPilot;
  }
  const pilot = createPilotProfile({ id: normalizedPreferredId || createRuntimeId(), name: normalizedName });
  if (!Array.isArray(state.pilots)) state.pilots = [];
  state.pilots.push(pilot);
  return pilot;
}

function getSoloPilotProfile() {
  return findPilotById(state?.soloPilotId) || getPilotProfiles()[0] || null;
}

function getFleetEntryPilot(entry) {
  return findPilotById(entry?.pilotId) || findPilotByName(entry?.pilotName) || null;
}

function getFleetEntryPilotName(entry, fallback = "") {
  return normalizePilotName(getFleetEntryPilot(entry)?.name || entry?.pilotName || fallback);
}

function getMissionAssignedPilot(mission) {
  const [participant] = getMissionParticipants(mission);
  return findPilotById(participant?.pilotId || mission?.assignedPilotId)
    || findPilotByName(participant?.pilotName || mission?.assignedPilotName)
    || null;
}

function getMissionAssignedPilotName(mission, fallback = "") {
  return normalizePilotName(getMissionAssignedPilot(mission)?.name || mission?.assignedPilotName || fallback);
}

function getMissionParticipants(mission) {
  const rawParticipants = Array.isArray(mission?.participants) ? mission.participants : [];
  const seenPilotIds = new Set();
  const participants = rawParticipants
    .map((participant) => {
      const pilot = findPilotById(participant?.pilotId) || findPilotByName(participant?.pilotName);
      const pilotId = String(pilot?.id || participant?.pilotId || "").trim();
      if (!pilotId || seenPilotIds.has(pilotId)) return null;
      seenPilotIds.add(pilotId);
      return { pilotId, pilotName: normalizePilotName(pilot?.name || participant?.pilotName) };
    })
    .filter(Boolean);
  if (participants.length > 0) return participants;
  const legacyPilot = findPilotById(mission?.assignedPilotId) || findPilotByName(mission?.assignedPilotName);
  return legacyPilot ? [{ pilotId: legacyPilot.id, pilotName: legacyPilot.name }] : [];
}

function getMissionParticipantNames(mission, fallback = "") {
  const names = getMissionParticipants(mission).map((participant) => participant.pilotName).filter(Boolean);
  return names.length > 0 ? names.join(", ") : fallback;
}

function setMissionParticipants(mission, participantIds, { assignedAt = new Date().toISOString() } = {}) {
  if (!mission) return;
  const seenPilotIds = new Set();
  const participants = (Array.isArray(participantIds) ? participantIds : [])
    .map((pilotId) => findPilotById(pilotId))
    .filter((pilot) => pilot && !seenPilotIds.has(pilot.id) && seenPilotIds.add(pilot.id))
    .map((pilot) => ({ pilotId: pilot.id, pilotName: pilot.name }));
  mission.participants = participants;
  mission.assignedPilotId = participants[0]?.pilotId || "";
  mission.assignedPilotName = participants[0]?.pilotName || "";
  mission.assignmentUpdatedAt = String(assignedAt || new Date().toISOString());
}

function getDefaultPilotForFleetEntry(fleetEntryId) {
  const fleetEntry = state.fleet.find((entry) => entry.id === String(fleetEntryId || "").trim()) || null;
  return getFleetEntryPilot(fleetEntry) || (!isDispatcherMode() ? getSoloPilotProfile() : null);
}

function setMissionAssignment(mission, {
  fleetEntryId = mission?.assignedFleetEntryId || "",
  pilotId,
  participantIds,
  assignedAt = new Date().toISOString(),
} = {}) {
  if (!mission) return;
  const normalizedFleetEntryId = String(fleetEntryId || "").trim();
  const hasExplicitPilot = pilotId !== undefined;
  const selectedPilot = hasExplicitPilot
    ? findPilotById(pilotId)
    : getDefaultPilotForFleetEntry(normalizedFleetEntryId);
  mission.assignedFleetEntryId = normalizedFleetEntryId;
  const existingParticipantIds = getMissionParticipants(mission).map((participant) => participant.pilotId);
  const nextParticipantIds = Array.isArray(participantIds)
    ? participantIds
    : hasExplicitPilot
      ? (selectedPilot ? [selectedPilot.id] : [])
      : existingParticipantIds.length > 0
        ? existingParticipantIds
        : (selectedPilot ? [selectedPilot.id] : []);
  setMissionParticipants(mission, nextParticipantIds, { assignedAt });
}

function formatScuAmount(value, { unit = true } = {}) {
  const numericValue = Number(value) || 0;
  const eighths = Math.round(numericValue * 8);
  const locale = typeof currentUiLanguage === "function" && currentUiLanguage() === "en" ? "en-US" : "de-DE";
  let label;

  if (Math.abs(numericValue * 8 - eighths) < 0.000001) {
    const whole = Math.trunc(eighths / 8);
    const remainder = Math.abs(eighths % 8);
    if (remainder === 0) {
      label = String(whole);
    } else {
      const divisor = greatestCommonDivisor(remainder, 8);
      const fraction = `${remainder / divisor}/${8 / divisor}`;
      label = whole > 0 ? `${whole} ${fraction}` : fraction;
    }
  } else {
    label = numericValue.toLocaleString(locale, { maximumFractionDigits: 3 });
  }

  return unit ? `${label} SCU` : label;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

const defaultState = {
  layout: {
    rows: 4,
    cols: 6,
    shipId: "",
    fleetEntryId: "",
    presetId: "custom",
    blockedSlots: [],
    defaultHeight: 3,
    heightOverrides: {},
    overloadMode: false,
    overloadSlotIds: [],
  },
  missions: [],
  fleet: [],
  pilots: [],
  soloPilotId: "",
  activeFleetEntryId: "",
  uiLanguage: "de",
  backupReminderDays: 7,
  autoload: {
    strategy: "compact",
    allowOverload: false,
  },
  ledgerEntries: [],
  shipLibrary: [],
  selectedLoadId: null,
  selectionCleared: false,
  levelFilter: "all",
  selectedStopDropoff: "",
  currentLocation: "",
  selectedRunRoutePointKey: "",
  runPriorityRouteLocation: "",
  runCompletedRoutePoints: [],
  runRouteProgress: {},
  stopHistory: [],
};

let activeAppMode = loadAppMode();
let state = loadState(activeAppMode);
state = pruneInvalidPlacements(state);

const missionForm = document.querySelector("#missionForm");
const missionFormTitle = document.querySelector("#missionFormTitle");
const missionSubmitButton = document.querySelector("#missionSubmitButton");
const missionCancelButton = document.querySelector("#missionCancelButton");
const layoutForm = document.querySelector("#layoutForm");
const cargoNav = document.querySelector("#cargoNav");
const fleetNav = document.querySelector("#fleetNav");
const financeNav = document.querySelector("#financeNav");
const statisticsNav = document.querySelector("#statisticsNav");
const settingsNav = document.querySelector("#settingsNav");
const moduleTabs = Array.from(document.querySelectorAll(".module-tab"));
const missionsList = document.querySelector("#missionsList");
const emptyState = document.querySelector("#emptyState");
const shipGrid = document.querySelector("#shipGrid");
const selectionShipGrid = document.querySelector("#selectionShipGrid");
const summaryCards = document.querySelector("#summaryCards");
const serverStatusCard = document.querySelector("#serverStatusCard");
const serverStatusDot = document.querySelector("#serverStatusDot");
const serverStatusLinkLabel = document.querySelector("#serverStatusLinkLabel");
const serverStatusLabel = document.querySelector("#serverStatusLabel");
const serverStatusMeta = document.querySelector("#serverStatusMeta");
const uiLanguageSelect = document.querySelector("#uiLanguageSelect");
const soloPilotProfileGroup = document.querySelector("#soloPilotProfileGroup");
const soloPilotNameInput = document.querySelector("#soloPilotNameInput");
const pilotSuggestions = document.querySelector("#pilotSuggestions");
const settingsMenu = document.querySelector("[data-settings-menu]");
const settingsMenuButton = document.querySelector("#settingsMenuButton");
const settingsViewButtons = Array.from(document.querySelectorAll("[data-settings-view-target]"));
const settingsViewPanels = Array.from(document.querySelectorAll("[data-settings-view]"));
const settingsNavigationButtons = Array.from(document.querySelectorAll("[data-settings-go]"));
const serverImportTokenStatus = document.querySelector("#serverImportTokenStatus");
const serverImportTokenStatusText = document.querySelector("#serverImportTokenStatusText");
const serverImportTokenInput = document.querySelector("#serverImportTokenInput");
const serverImportTokenVisibility = document.querySelector("#serverImportTokenVisibility");
const generateServerImportTokenButton = document.querySelector("#generateServerImportToken");
const copyServerImportTokenButton = document.querySelector("#copyServerImportToken");
const saveServerImportTokenButton = document.querySelector("#saveServerImportToken");
const removeServerImportTokenButton = document.querySelector("#removeServerImportToken");
const missionTemplate = document.querySelector("#missionTemplate");
const presetSelect = document.querySelector("#presetSelect");
const presetTitle = document.querySelector("#presetTitle");
const presetDescription = document.querySelector("#presetDescription");
const presetStats = document.querySelector("#presetStats");
const layoutMetricsMode = document.querySelector("#layoutMetricsMode");
const layoutRowsValue = document.querySelector("#layoutRowsValue");
const layoutColsValue = document.querySelector("#layoutColsValue");
const layoutHeightValue = document.querySelector("#layoutHeightValue");
const overviewIsoStats = document.querySelector("#isoStats");
const loadIsoStats = document.querySelector("#loadIsoStats");
const isoEmpty = document.querySelector("#isoEmpty");
const overviewIsoView = document.querySelector("#overviewIsoView");
const isoView = document.querySelector("#isoView");
const selectionIsoView = document.querySelector("#selectionIsoView");
const isoDetailTitle = document.querySelector("#isoDetailTitle");
const isoDetailRoute = document.querySelector("#isoDetailRoute");
const isoDetailMeta = document.querySelector("#isoDetailMeta");
const overviewDetailActions = document.querySelector("#overviewDetailActions");
const overviewDeselectButton = document.querySelector("#overviewDeselectButton");
const loadIsoDetailTitle = document.querySelector("#loadIsoDetailTitle");
const loadIsoDetailRoute = document.querySelector("#loadIsoDetailRoute");
const loadIsoDetailMeta = document.querySelector("#loadIsoDetailMeta");
const overviewLayout = document.querySelector(".overview-layout");
const overviewShipPanel = document.querySelector(".panel-overview-ship");
const overviewShipName = document.querySelector("#overviewShipName");
const createShipIndicator = document.querySelector(".mission-ship-indicator");
const createShipName = document.querySelector("#createShipName");
const createShipRegistration = document.querySelector("#createShipRegistration");
const createShipMeta = document.querySelector("#createShipMeta");
const createShipStatus = document.querySelector("#createShipStatus");
const createDraftSummary = document.querySelector("#createDraftSummary");
const missionTypeSelect = document.querySelector("#missionTypeSelect");
const cargoFields = document.querySelector("#cargoFields");
const courierFields = document.querySelector("#courierFields");
const courierPackageList = document.querySelector("#courierPackageList");
const addCourierPackageButton = document.querySelector("#addCourierPackageButton");
const deliveryFields = document.querySelector("#deliveryFields");
const deliveryItemList = document.querySelector("#deliveryItemList");
const addDeliveryItemButton = document.querySelector("#addDeliveryItemButton");
const refuelFields = document.querySelector("#refuelFields");
const investigationFields = document.querySelector("#investigationFields");
const salvageFields = document.querySelector("#salvageFields");
const procurementFields = document.querySelector("#procurementFields");
const procurementItemList = document.querySelector("#procurementItemList");
const addProcurementItemButton = document.querySelector("#addProcurementItemButton");
const miningFields = document.querySelector("#miningFields");
const miscFields = document.querySelector("#miscFields");
const missionValidationHint = document.querySelector("#missionValidationHint");
const missionValidationOverrideWrap = document.querySelector("#missionValidationOverrideWrap");
const missionValidationOverride = document.querySelector("#missionValidationOverride");
const locationSuggestions = document.querySelector("#locationSuggestions");
const exportButton = document.querySelector("#exportButton");
const importInput = document.querySelector("#importInput");
const dimensionHint = document.querySelector("#dimensionHint");
const consignmentList = document.querySelector("#consignmentList");
const addConsignmentButton = document.querySelector("#addConsignmentButton");
const recalculateContainerGroupsButton = document.querySelector("#recalculateContainerGroupsButton");
const consignmentTemplate = document.querySelector("#consignmentTemplate");
const quickCargoTitle = document.querySelector("#quickCargoTitle");
const quickPickup = document.querySelector("#quickPickup");
const quickDestinationList = document.querySelector("#quickDestinationList");
const addQuickDestinationButton = document.querySelector("#addQuickDestinationButton");
const applyQuickMissionButton = document.querySelector("#applyQuickMissionButton");
const quickMissionHint = document.querySelector("#quickMissionHint");
const missionQuickCapture = document.querySelector(".mission-quick-capture");
const consignmentBuilder = document.querySelector(".consignment-builder");
const openMissionImportDialogButton = document.querySelector("#openMissionImportDialog");
const missionImportDialog = document.querySelector("#missionImportDialog");
const missionImportDropzone = document.querySelector("#missionImportDropzone");
const missionImportClipboardButton = document.querySelector("#missionImportClipboardButton");
const missionImportFileInput = document.querySelector("#missionImportFileInput");
const missionImportStatus = document.querySelector("#missionImportStatus");
const missionImportImageWrap = document.querySelector("#missionImportImageWrap");
const missionImportImage = document.querySelector("#missionImportImage");
const missionImportPreview = document.querySelector("#missionImportPreview");
const missionImportPreviewSummary = document.querySelector("#missionImportPreviewSummary");
const missionImportDuplicateWarning = document.querySelector("#missionImportDuplicateWarning");
const missionImportRefresh = document.querySelector("#missionImportRefresh");
const missionImportInboxStatus = document.querySelector("#missionImportInboxStatus");
const missionImportInboxList = document.querySelector("#missionImportInboxList");
const companionImportActivity = document.querySelector("#companionImportActivity");
const companionImportActivityTitle = document.querySelector("#companionImportActivityTitle");
const companionImportActivityMeta = document.querySelector("#companionImportActivityMeta");
const companionImportActivityCount = document.querySelector("#companionImportActivityCount");
const companionImportQueuePanel = document.querySelector("#companionImportQueuePanel");
const companionImportQueueMeta = document.querySelector("#companionImportQueueMeta");
const companionImportQueueList = document.querySelector("#companionImportQueueList");
const companionImportQueueClose = document.querySelector("#companionImportQueueClose");
const companionImportOpenContracts = document.querySelector("#companionImportOpenContracts");
const missionImportConsignmentList = document.querySelector("#missionImportConsignmentList");
const missionImportCancel = document.querySelector("#missionImportCancel");
const missionImportApply = document.querySelector("#missionImportApply");
const pageTabs = Array.from(document.querySelectorAll("[data-page-target]"));
const pageSections = Array.from(document.querySelectorAll(".page-section"));
const quickNavButtons = Array.from(document.querySelectorAll("[data-go-page]"));
const hubSummary = document.querySelector("#hubSummary");
const hubTodayList = document.querySelector("#hubTodayList");
const hubCurrentLocationControl = document.querySelector("#hubCurrentLocationControl");
const hubCurrentLocationSelect = document.querySelector("#hubCurrentLocationSelect");
const runShipButton = document.querySelector("#runShipButton");
const runPageSection = document.querySelector('[data-page="run"]');
const runCompactViewButton = document.querySelector("#runCompactViewButton");
const runCockpitFullscreenButton = document.querySelector("#runCockpitFullscreenButton");
const runShipName = document.querySelector("#runShipName");
const runShipRegistration = document.querySelector("#runShipRegistration");
const runCurrentLocationSelect = document.querySelector("#runCurrentLocationSelect");
const runMissionPanel = document.querySelector("#runMissionPanel");
const runMissionSummary = document.querySelector("#runMissionSummary");
const runMissionList = document.querySelector("#runMissionList");
const runEmptyState = document.querySelector("#runEmptyState");
const runEmptyTitle = document.querySelector("#runEmptyTitle");
const runEmptyText = document.querySelector("#runEmptyText");
const runEmptyAction = document.querySelector("#runEmptyAction");
const runContent = document.querySelector("#runContent");
const runFocusPanel = document.querySelector("#runFocusPanel");
const runFocusSummary = document.querySelector("#runFocusSummary");
const runRoutePanel = document.querySelector("#runRoutePanel");
const runProgressText = document.querySelector("#runProgressText");
const runProgressFill = document.querySelector("#runProgressFill");
const runTargetEyebrow = document.querySelector("#runTargetEyebrow");
const runTargetName = document.querySelector("#runTargetName");
const runTargetMeta = document.querySelector("#runTargetMeta");
const runStopStatus = document.querySelector("#runStopStatus");
const runStopStatusTitle = document.querySelector("#runStopStatusTitle");
const runStopStatusText = document.querySelector("#runStopStatusText");
const runTaskList = document.querySelector("#runTaskList");
const runActionBar = document.querySelector("#runActionBar");
const runArriveButton = document.querySelector("#runArriveButton");
const runOpenLoadButton = document.querySelector("#runOpenLoadButton");
const runAutoLoadButton = document.querySelector("#runAutoLoadButton");
const runAutoloadOptions = document.querySelector("#runAutoloadOptions");
const runCompletePickupButton = document.querySelector("#runCompletePickupButton");
const runCompleteStopButton = document.querySelector("#runCompleteStopButton");
const runRouteSummary = document.querySelector("#runRouteSummary");
const runRouteList = document.querySelector("#runRouteList");
const runManifestPanel = document.querySelector("#runManifestPanel");
const runManifestSummary = document.querySelector("#runManifestSummary");
const runOnBoardList = document.querySelector("#runOnBoardList");
const runWaitingSection = document.querySelector("#runWaitingSection");
const runWaitingList = document.querySelector("#runWaitingList");
const appModeButtons = Array.from(document.querySelectorAll("[data-app-mode-target]"));
const appModeSwitch = document.querySelector(".app-mode-toggle");
const fullscreenToggle = document.querySelector("#fullscreenToggle");
const homeLoadSummary = document.querySelector("#homeLoadSummary");
const homeLoadList = document.querySelector("#homeLoadList");
const autoloadStrategySelects = Array.from(document.querySelectorAll("[data-autoload-strategy]"));
const autoloadOverloadInputs = Array.from(document.querySelectorAll("[data-autoload-overload]"));
const topdownLevelFilter = document.querySelector("#topdownLevelFilter");
const isoLevelFilter = document.querySelector("#isoLevelFilter");
const manifestEmpty = document.querySelector("#manifestEmpty");
const manifestList = document.querySelector("#manifestList");
const unloadPlanPanel = document.querySelector(".panel-unload-plan");
const stopListEmpty = document.querySelector("#stopListEmpty");
const stopList = document.querySelector("#stopList");
const nextStopSelect = document.querySelector("#nextStopSelect");
const suggestUnloadPlanButton = document.querySelector("#suggestUnloadPlanButton");
const unloadPlanResult = document.querySelector("#unloadPlanResult");
const routeProgressBar = document.querySelector("#routeProgressBar");
const currentLocationForm = document.querySelector("#currentLocationForm");
const currentLocationInput = document.querySelector("#currentLocationInput");
const clearCurrentLocationButton = document.querySelector("#clearCurrentLocationButton");
const currentLocationHint = document.querySelector("#currentLocationHint");
const stopHistoryEmpty = document.querySelector("#stopHistoryEmpty");
const stopHistoryList = document.querySelector("#stopHistoryList");
const collapseButtons = Array.from(document.querySelectorAll(".collapse-toggle"));
const fleetForm = document.querySelector("#fleetForm");
const fleetList = document.querySelector("#fleetList");
const fleetEmpty = document.querySelector("#fleetEmpty");
const fleetArchiveList = document.querySelector("#fleetArchiveList");
const fleetArchiveEmpty = document.querySelector("#fleetArchiveEmpty");
const fleetDossier = document.querySelector("#fleetDossier");
const fleetSummary = document.querySelector("#fleetSummary");
const fleetViewTabs = document.querySelectorAll("[data-fleet-view-target]");
const fleetViewSections = document.querySelectorAll("[data-fleet-view]");
const fleetFormTitle = document.querySelector("#fleetFormTitle");
const fleetFormDescription = document.querySelector("#fleetFormDescription");
const fleetDurationHint = document.querySelector("#fleetDurationHint");
const fleetManufacturerSelect = document.querySelector("#fleetManufacturerSelect");
const fleetPresetSelect = document.querySelector("#fleetPresetSelect");
const fleetRefuelContainerFields = document.querySelector("#fleetRefuelContainerFields");
const fleetStatusSelect = document.querySelector("#fleetStatusSelect");
const fleetEndedOn = document.querySelector("#fleetEndedOn");
const fleetPatchVersionWrap = document.querySelector("#fleetPatchVersionWrap");
const fleetPatchVersionInput = document.querySelector("#fleetPatchVersion");
const fleetDispatcherCrewFields = document.querySelector("#fleetDispatcherCrewFields");
const fleetOwnerInput = document.querySelector("#fleetOwnerInput");
const fleetPilotInput = document.querySelector("#fleetPilotInput");
const fleetPledgePurchasedInput = document.querySelector("#fleetPledgePurchased");
const fleetImageFileInput = document.querySelector("#fleetImageFileInput");
const fleetImageRecognizeButton = document.querySelector("#fleetImageRecognizeButton");
const fleetImageRemoveButton = document.querySelector("#fleetImageRemoveButton");
const fleetImageStatus = document.querySelector("#fleetImageStatus");
const fleetImagePreviewWrap = document.querySelector("#fleetImagePreviewWrap");
const fleetImagePreview = document.querySelector("#fleetImagePreview");
const fleetWipeButton = document.querySelector("#fleetWipeButton");
const fleetWipeDialog = document.querySelector("#fleetWipeDialog");
const fleetWipeForm = document.querySelector("#fleetWipeForm");
const fleetWipeDialogMessage = document.querySelector("#fleetWipeDialogMessage");
const fleetWipeModeReset = document.querySelector("#fleetWipeModeReset");
const fleetWipeModeFull = document.querySelector("#fleetWipeModeFull");
const fleetWipeSummary = document.querySelector("#fleetWipeSummary");
const fleetWipePatchVersion = document.querySelector("#fleetWipePatchVersion");
const fleetWipeDate = document.querySelector("#fleetWipeDate");
const fleetWipeReplacementSection = document.querySelector("#fleetWipeReplacementSection");
const fleetWipeReplacementList = document.querySelector("#fleetWipeReplacementList");
const fleetWipeMissionWarning = document.querySelector("#fleetWipeMissionWarning");
const fleetWipeCancel = document.querySelector("#fleetWipeCancel");
const fleetWipeConfirm = document.querySelector("#fleetWipeConfirm");
const fleetReplacementDialog = document.querySelector("#fleetReplacementDialog");
const fleetReplacementDialogKicker = document.querySelector("#fleetReplacementDialogKicker");
const fleetReplacementDialogTitle = document.querySelector("#fleetReplacementDialogTitle");
const fleetReplacementDialogMessage = document.querySelector("#fleetReplacementDialogMessage");
const fleetReplacementRegistration = document.querySelector("#fleetReplacementRegistration");
const fleetReplacementDialogAbort = document.querySelector("#fleetReplacementDialogAbort");
const fleetReplacementDialogCancel = document.querySelector("#fleetReplacementDialogCancel");
const fleetReplacementDialogConfirm = document.querySelector("#fleetReplacementDialogConfirm");
const missionConfirmDialog = document.querySelector("#missionConfirmDialog");
const missionConfirmDialogKicker = document.querySelector("#missionConfirmDialogKicker");
const missionConfirmDialogTitle = document.querySelector("#missionConfirmDialogTitle");
const missionConfirmDialogMessage = document.querySelector("#missionConfirmDialogMessage");
const missionConfirmDialogCancel = document.querySelector("#missionConfirmDialogCancel");
const missionConfirmDialogConfirm = document.querySelector("#missionConfirmDialogConfirm");
const missionPayoutSplitDialog = document.querySelector("#missionPayoutSplitDialog");
const missionPayoutSplitForm = document.querySelector("#missionPayoutSplitForm");
const missionPayoutSplitMessage = document.querySelector("#missionPayoutSplitMessage");
const missionPayoutSplitList = document.querySelector("#missionPayoutSplitList");
const missionPayoutSplitHint = document.querySelector("#missionPayoutSplitHint");
const missionPayoutSplitCancel = document.querySelector("#missionPayoutSplitCancel");
const runQuantityDialog = document.querySelector("#runQuantityDialog");
const runQuantityDialogForm = document.querySelector("#runQuantityDialogForm");
const runQuantityDialogMission = document.querySelector("#runQuantityDialogMission");
const runQuantityDialogInput = document.querySelector("#runQuantityDialogInput");
const runQuantityDialogHint = document.querySelector("#runQuantityDialogHint");
const runQuantityDialogCancel = document.querySelector("#runQuantityDialogCancel");
const fleetSubmitButton = document.querySelector("#fleetSubmitButton");
const fleetCancelButton = document.querySelector("#fleetCancelButton");
document.querySelector("#fleetRefuelContainerFieldsMount")?.closest("label")?.remove();
document.querySelector("[data-stale-hangar-field]")?.remove();
const shipDbHangarSelect = document.querySelector('select[name="hangarSize"]');
if (shipDbHangarSelect) {
  const hangarLabels = {
    "": t("hangar.none"),
    S: t("hangar.S"),
    M: t("hangar.M"),
    L: t("hangar.L"),
    XL: t("hangar.XL"),
    XXL: t("hangar.XXL"),
  };
  shipDbHangarSelect.closest("label")?.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
      node.textContent = `${t("shipdb.form.hangarSize")}\n                      `;
    }
  });
  Array.from(shipDbHangarSelect.options).forEach((option) => {
    option.textContent = hangarLabels[option.value] || option.textContent;
  });
}
const shipDbForm = document.querySelector("#shipDbForm");
const shipDbList = document.querySelector("#shipDbList");
const shipDbEmpty = document.querySelector("#shipDbEmpty");
const shipDbSummary = document.querySelector("#shipDbSummary");
const shipDbPresetSelect = document.querySelector("#shipDbPresetSelect");
const shipDbManufacturerSelect = document.querySelector("#shipDbManufacturerSelect");
const shipDbManufacturerCustomWrap = document.querySelector("#shipDbManufacturerCustomWrap");
const shipDbManufacturerCustom = document.querySelector("#shipDbManufacturerCustom");
const shipDbRefuelContainerWrap = document.querySelector("#shipDbRefuelContainerWrap") || document.querySelector('[name="refuelContainerCount"]')?.closest("label");
const shipDbCargoScuValue = document.querySelector("#shipDbCargoScuValue");
const shipDbCargoOfficialValue = document.querySelector("#shipDbCargoOfficialValue");
const shipDbCargoOverloadValue = document.querySelector("#shipDbCargoOverloadValue");
const shipDbGrid = document.querySelector("#shipDbGrid");
const shipDbGridStats = document.querySelector("#shipDbGridStats");
const shipDbLevelTabs = document.querySelector("#shipDbLevelTabs");
const shipDbGridMode = document.querySelector("#shipDbGridMode");
const shipDbIsoStats = document.querySelector("#shipDbIsoStats");
const shipDbCargoSummaryCard = document.querySelector("#shipDbCargoSummaryCard");
const shipDbViewTabs = Array.from(document.querySelectorAll("[data-shipdb-view-target]"));
const shipDbViewSections = Array.from(document.querySelectorAll("[data-shipdb-view]"));
const shipDbIsoEmpty = document.querySelector("#shipDbIsoEmpty");
const shipDbIsoPreview = document.querySelector("#shipDbIsoPreview");
const shipDbGridRowsInput = document.querySelector("#shipDbGridRows");
const shipDbGridColsInput = document.querySelector("#shipDbGridCols");
const shipDbGridLevelsInput = document.querySelector("#shipDbGridLevels");
const shipDbGridClearLevelButton = document.querySelector("#shipDbGridClearLevel");
const shipDbGridClearAllButton = document.querySelector("#shipDbGridClearAll");
const shipDbSubmitButton = document.querySelector("#shipDbSubmitButton");
const shipDbCancelButton = document.querySelector("#shipDbCancelButton");
const shipDbImagePreviewWrap = document.querySelector("#shipDbImagePreviewWrap");
const shipDbImagePreview = document.querySelector("#shipDbImagePreview");
const shipDbImageFileInput = document.querySelector("#shipDbImageFileInput");
const shipDbImageRemoveButton = document.querySelector("#shipDbImageRemoveButton");
const shipDbImageImportStatus = document.querySelector("#shipDbImageImportStatus");
const shipMissionDialog = document.querySelector("#shipMissionDialog");
const shipMissionDialogMessage = document.querySelector("#shipMissionDialogMessage");
const shipMissionDialogList = document.querySelector("#shipMissionDialogList");
const shipMissionDialogCancel = document.querySelector("#shipMissionDialogCancel");
const shipMissionDialogConfirm = document.querySelector("#shipMissionDialogConfirm");

let activePage = "hub";
let activeSettingsView = "profile";
let activeShipDbView = "database";
let lastCargoPage = "overview";
let runViewController = null;
let remoteHydrationComplete = false;
let remoteSaveTimer = null;
let remoteStatus = createRemoteStatusState();
window.t = t;
const backupController = BackupUi.createBackupController({
  helpers: {
    escapeHtml,
    formatDateTimeDisplay,
    t,
  },
  callbacks: {
    canUseServer: canUseRemotePersistence,
    getLastBackupAt: () => remoteStatus.lastBackupAt,
    getReminderDays: () => state.backupReminderDays,
    onBackupCreated: (backupAt) => {
      remoteStatus.lastBackupAt = backupAt;
      renderRemoteStatus();
    },
    onRestored: async (payload) => {
      remoteStatus.lastRestoreAt = payload.restoredAt || new Date().toISOString();
      remoteHydrationComplete = false;
      await initializeRemotePersistence();
      render();
    },
    setConnected: (connected) => {
      remoteStatus.connected = Boolean(connected);
      renderRemoteStatus();
    },
    setReminderDays: (days) => {
      state.backupReminderDays = BackupUi.normalizeBackupReminderDays(days);
      persist();
      renderRemoteStatus();
    },
    showNotice: showAppNotice,
  },
});
const collapsedMissionIds = new Set();
const collapsedMissionGroupIds = new Set(["paid"]);
let draggedMissionId = "";
let shipBuilderState = createShipBuilderState();
let lastUnloadPlan = null;
let lastAutoLoadResult = null;
let isoZoomLevel = 1;
let missionImportImageUrl = "";
let missionImportBusy = false;
let missionImportRequestId = 0;
let missionImportInboxTimer = null;
let missionImportInboxItems = [];
let selectedMissionImportId = "";
let missionImportDraftMetadata = { payout: null, maxContainerScu: null };
let missionImportOriginalDraft = null;
let missionAutoImportBusy = false;
let missionAutoImportTimer = null;
let missionImportProgressBusy = false;
let missionImportProgressTimer = null;
let missionImportProgressJobs = [];
const missionImportMetadataSyncedModes = new Set();
const financeController = createFinanceController({
  getState: () => state,
  helpers: {
    compareDateInputs,
    createFleetEntry,
    createRuntimeId,
    currentUiLanguage,
    escapeHtml,
    findShipLibraryEntryById,
    financeStatementPeriodStorageKey: `${STORAGE_KEY}:finance-statement-period`,
    formatDateDisplay,
    formatDateForInput,
    formatShipEntryFullName,
    getFleetEntries,
    getShipEntryDisplayName,
    getShipLibraryEntries,
    normalizeDateInput,
    persist,
    render,
    setActivePage,
    showConfirmDialog: showMissionConfirmDialog,
    syncLayoutToActiveFleetShip,
    t,
  },
});
const statisticsController = createStatisticsController({
  getState: () => state,
  helpers: {
    currentUiLanguage,
    escapeHtml,
    formatShipEntryFullName,
    getFleetMediaEntry,
    renderShipCardArt,
    bindShipProfileMedia,
    statisticsFleetGroupStorageKey: `${STORAGE_KEY}:statistics-fleet-group`,
    statisticsSectionsStorageKey: `${STORAGE_KEY}:statistics-sections`,
    statisticsViewStorageKey: `${STORAGE_KEY}:statistics-view`,
    t,
  },
});
const systemDatabaseController = createSystemDatabaseController({
  helpers: {
    escapeHtml,
    renderApp: render,
    renderLocationSuggestions,
    setActivePage,
    t,
  },
});
window.systemDatabaseController = systemDatabaseController;
const locationAliasLearningController = createLocationAliasLearningController({
  systemDatabaseController,
  helpers: {
    escapeHtml,
    normalizeMissionType,
    t,
  },
});
window.locationAliasLearningController = locationAliasLearningController;

renderPresetOptions();
renderFleetPresetOptions();
renderShipDbPresetOptions();
renderShipManufacturerOptions();
renderShipClassOptions();
missionForm.color.value = getNextMissionColor();
ensureConsignmentRows();
ensureQuickMissionRows();
syncMissionTypeFields();
syncLayoutInputs();
updateDimensionHint();
resetFleetForm();
resetShipDbForm();
renderShipGridBuilder();
initializeCollapsiblePanels();
registerCargoUiEvents();
registerFleetEvents();
registerShipDbEvents();
initializeTopbarSettings();
initializeFullscreenToggle();
runViewController = RunViewUi.createRunViewController({
  storageKey: `${STORAGE_KEY}:run-view`,
  page: runPageSection,
  toggleButton: runCompactViewButton,
  fullscreenButton: runCockpitFullscreenButton,
  getActivePage: () => activePage,
  getText: (key) => t(key),
  onCockpitActivated: () => setCollapsibleExpanded("runFocusBody", true),
  onFullscreenToggle: toggleFullscreen,
  supportsFullscreen,
  getFullscreenElement,
  normalizeTooltip: normalizeAppTooltipTitles,
});
runViewController.init();
initializeAppTooltip();
initializeAutoloadControls();
initializeMissionImportProgressPanel();
backupController.init();

exportButton.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `cargo-planner-${activeAppMode}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});

importInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    state = pruneInvalidPlacements(sanitizeState(imported));
    persist();
    render();
  } catch (error) {
    await showAppNotice("Die Importdatei konnte nicht gelesen werden.", { tone: "danger" });
  } finally {
    importInput.value = "";
  }
});

uiLanguageSelect?.addEventListener("change", () => {
  state.uiLanguage = normalizeUiLanguage(uiLanguageSelect.value);
  persist();
  render();
});

soloPilotNameInput?.addEventListener("change", () => {
  const name = normalizePilotName(soloPilotNameInput.value) || SOLO_PILOT_DEFAULT_NAME;
  const currentPilot = getSoloPilotProfile();
  const pilot = ensurePilotProfileByName(name, { preferredId: currentPilot?.id || SOLO_PILOT_ID });
  if (!pilot) return;
  state.soloPilotId = pilot.id;
  state.fleet.forEach((entry) => {
    if (!entry.pilotId || entry.pilotId === currentPilot?.id) {
      entry.pilotId = pilot.id;
      entry.pilotName = pilot.name;
    }
  });
  state.missions.forEach((mission) => {
    if (!mission.assignedPilotId || mission.assignedPilotId === currentPilot?.id) {
      mission.assignedPilotId = pilot.id;
      mission.assignedPilotName = pilot.name;
    }
  });
  persist();
  render();
});

let serverImportTokenConfigured = null;
let serverImportTokenLoading = false;
let serverImportTokenSavedValue = "";

function setServerImportTokenStatus(state, translationKey) {
  if (serverImportTokenStatus) {
    serverImportTokenStatus.dataset.state = state;
  }
  if (serverImportTokenStatusText) {
    serverImportTokenStatusText.textContent = t(translationKey);
  }
}

function setServerImportTokenControlsDisabled(disabled) {
  [
    serverImportTokenInput,
    serverImportTokenVisibility,
    generateServerImportTokenButton,
    copyServerImportTokenButton,
    saveServerImportTokenButton,
    removeServerImportTokenButton,
  ].forEach((control) => {
    if (control) control.disabled = disabled;
  });
}

function syncServerImportTokenActionStates() {
  const hasDraft = Boolean(serverImportTokenInput?.value.trim());
  if (serverImportTokenVisibility) serverImportTokenVisibility.disabled = !hasDraft;
  if (copyServerImportTokenButton) copyServerImportTokenButton.disabled = !hasDraft;
  if (saveServerImportTokenButton) saveServerImportTokenButton.disabled = !hasDraft;
  if (removeServerImportTokenButton) removeServerImportTokenButton.disabled = !serverImportTokenConfigured;
}

function refreshServerImportTokenStatus() {
  const currentValue = serverImportTokenInput?.value.trim() || "";
  if (currentValue && currentValue === serverImportTokenSavedValue && serverImportTokenConfigured) {
    setServerImportTokenStatus("saved", "settings.tokenSaved");
    return;
  }
  if (currentValue) {
    setServerImportTokenStatus("draft", "settings.tokenDraft");
    return;
  }
  setServerImportTokenStatus(
    serverImportTokenConfigured ? "active" : "inactive",
    serverImportTokenConfigured ? "settings.tokenActive" : "settings.tokenInactive",
  );
}

async function loadServerImportTokenSettings() {
  if (serverImportTokenLoading || !serverImportTokenStatus) return;
  serverImportTokenLoading = true;
  setServerImportTokenControlsDisabled(true);
  setServerImportTokenStatus("loading", "settings.tokenLoading");
  try {
    const response = await fetch(IMPORT_TOKEN_SETTINGS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error("token_settings_unavailable");
    const payload = await response.json();
    serverImportTokenConfigured = Boolean(payload.configured);
    refreshServerImportTokenStatus();
    setServerImportTokenControlsDisabled(false);
    syncServerImportTokenActionStates();
  } catch (error) {
    serverImportTokenConfigured = null;
    setServerImportTokenStatus("error", "settings.tokenUnavailable");
    setServerImportTokenControlsDisabled(true);
  } finally {
    serverImportTokenLoading = false;
  }
}

function generateServerImportTokenValue() {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function copyServerImportTokenValue() {
  const token = serverImportTokenInput?.value.trim() || "";
  if (!token) {
    setServerImportTokenStatus("error", "settings.tokenRequired");
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(token);
    } else {
      const helper = document.createElement("textarea");
      helper.value = token;
      helper.style.position = "fixed";
      helper.style.opacity = "0";
      document.body.append(helper);
      helper.select();
      document.execCommand("copy");
      helper.remove();
    }
    setServerImportTokenStatus("saved", "settings.tokenCopied");
  } catch (error) {
    setServerImportTokenStatus("error", "settings.tokenUnavailable");
  }
}

async function updateServerImportToken(token) {
  setServerImportTokenControlsDisabled(true);
  try {
    const response = await fetch(IMPORT_TOKEN_SETTINGS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!response.ok) throw new Error("token_update_failed");
    const payload = await response.json();
    serverImportTokenConfigured = Boolean(payload.configured);
    serverImportTokenSavedValue = token;
    setServerImportTokenStatus(
      serverImportTokenConfigured ? "saved" : "inactive",
      serverImportTokenConfigured ? "settings.tokenSaved" : "settings.tokenInactive",
    );
  } catch (error) {
    setServerImportTokenStatus("error", "settings.tokenUnavailable");
  } finally {
    setServerImportTokenControlsDisabled(false);
    syncServerImportTokenActionStates();
  }
}

serverImportTokenInput?.addEventListener("input", () => {
  refreshServerImportTokenStatus();
  syncServerImportTokenActionStates();
});

serverImportTokenVisibility?.addEventListener("click", () => {
  const showToken = serverImportTokenInput.type === "password";
  serverImportTokenInput.type = showToken ? "text" : "password";
  const translationKey = showToken ? "settings.hideToken" : "settings.showToken";
  serverImportTokenVisibility.dataset.i18n = translationKey;
  serverImportTokenVisibility.textContent = t(translationKey);
});

generateServerImportTokenButton?.addEventListener("click", () => {
  serverImportTokenInput.value = generateServerImportTokenValue();
  serverImportTokenInput.type = "text";
  serverImportTokenVisibility.dataset.i18n = "settings.hideToken";
  serverImportTokenVisibility.textContent = t("settings.hideToken");
  refreshServerImportTokenStatus();
  syncServerImportTokenActionStates();
  serverImportTokenInput.focus();
  serverImportTokenInput.select();
});

copyServerImportTokenButton?.addEventListener("click", () => {
  void copyServerImportTokenValue();
});

saveServerImportTokenButton?.addEventListener("click", () => {
  const token = serverImportTokenInput?.value.trim() || "";
  if (!token) {
    setServerImportTokenStatus("error", "settings.tokenRequired");
    return;
  }
  void updateServerImportToken(token);
});

removeServerImportTokenButton?.addEventListener("click", async () => {
  const shouldRemove = await showMissionConfirmDialog({
    kicker: t("settings.companion"),
    title: t("settings.removeTokenTitle"),
    message: t("settings.removeTokenMessage"),
    confirmLabel: t("settings.removeTokenConfirm"),
    tone: "danger",
  });
  if (!shouldRemove) return;
  if (serverImportTokenInput) serverImportTokenInput.value = "";
  await updateServerImportToken("");
});

settingsMenuButton?.addEventListener("click", () => {
  hideAppTooltip(true);
  setActivePage("settings");
  if (activeSettingsView === "companion") void loadServerImportTokenSettings();
});

settingsViewButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setSettingsView(button.dataset.settingsViewTarget);
  });
});

settingsNavigationButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const target = button.dataset.settingsGo || "hub";
    activeSettingsView = "database";
    if (target === "ships") {
      setShipDbView("database");
    }
    if (target === "systems") {
      systemDatabaseController.setView("database");
    }
    setActivePage(target);
  });
});

appModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    void switchAppMode(button.dataset.appModeTarget);
  });
});

function getFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function initializeTopbarSettings() {
  const moduleActions = document.querySelector(".module-actions");
  if (settingsMenu && moduleActions && settingsMenu.parentElement !== moduleActions) {
    moduleActions.append(settingsMenu);
  }
}

function supportsFullscreen() {
  if (new URLSearchParams(window.location.search).get("desktop") === "1") return false;
  const root = document.documentElement;
  return Boolean(
    (root?.requestFullscreen && document.fullscreenEnabled !== false) ||
    (root?.webkitRequestFullscreen && document.webkitFullscreenEnabled !== false)
  );
}

function syncFullscreenToggle() {
  if (!fullscreenToggle) return;
  const supported = supportsFullscreen();
  const active = Boolean(getFullscreenElement());
  const label = t(active ? "fullscreen.exit" : "fullscreen.enter");
  fullscreenToggle.hidden = !supported;
  fullscreenToggle.setAttribute("aria-pressed", String(active));
  fullscreenToggle.setAttribute("aria-label", label);
  fullscreenToggle.dataset.tooltip = label;
  fullscreenToggle.querySelector(".fullscreen-enter-icon")?.toggleAttribute("hidden", active);
  fullscreenToggle.querySelector(".fullscreen-exit-icon")?.toggleAttribute("hidden", !active);
  fullscreenToggle.classList.remove("is-error");
  normalizeAppTooltipTitles(fullscreenToggle);
  runViewController?.syncFullscreenButton();
}

async function toggleFullscreen() {
  if (!fullscreenToggle || !supportsFullscreen()) return;
  try {
    if (getFullscreenElement()) {
      const exitFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
      await exitFullscreen?.call(document);
    } else {
      const root = document.documentElement;
      const requestFullscreen = root.requestFullscreen || root.webkitRequestFullscreen;
      await requestFullscreen?.call(root);
    }
  } catch (error) {
    fullscreenToggle.classList.add("is-error");
    const label = t("fullscreen.unavailable");
    fullscreenToggle.setAttribute("aria-label", label);
    fullscreenToggle.dataset.tooltip = label;
    normalizeAppTooltipTitles(fullscreenToggle);
  }
}

function initializeFullscreenToggle() {
  if (!fullscreenToggle) return;
  fullscreenToggle.addEventListener("click", () => {
    void toggleFullscreen();
  });
  document.addEventListener("fullscreenchange", syncFullscreenToggle);
  document.addEventListener("webkitfullscreenchange", syncFullscreenToggle);
  syncFullscreenToggle();
}

function getTooltipElement() {
  let tooltip = document.querySelector(".app-floating-tooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.className = "app-floating-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);
  }
  return tooltip;
}

function normalizeAppTooltipTitles(root = document) {
  const candidates = root instanceof Element && root.matches("[data-tooltip]")
    ? [root, ...root.querySelectorAll("[data-tooltip]")]
    : Array.from(root.querySelectorAll?.("[data-tooltip]") || []);

  candidates.forEach((element) => {
    if (!element.hasAttribute("title")) return;
    element.dataset.nativeTitle = element.getAttribute("title") || "";
    element.removeAttribute("title");
  });
}

function positionAppTooltip(target) {
  const tooltip = getTooltipElement();
  if (tooltip.hidden || !target) return;

  const margin = 8;
  const gap = 10;
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const maxLeft = window.innerWidth - tooltipRect.width - margin;
  const left = clamp(targetRect.left + targetRect.width / 2 - tooltipRect.width / 2, margin, Math.max(margin, maxLeft));
  let top = targetRect.bottom + gap;
  let placement = "bottom";

  if (top + tooltipRect.height > window.innerHeight - margin) {
    top = targetRect.top - tooltipRect.height - gap;
    placement = "top";
  }

  tooltip.dataset.placement = placement;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

function showAppTooltip(target) {
  if (!target) return;
  normalizeAppTooltipTitles(target);

  const text = String(target.dataset.tooltip || "").trim();
  const tooltip = getTooltipElement();
  if (!text) {
    hideAppTooltip();
    return;
  }

  tooltip.textContent = text;
  tooltip.hidden = false;
  tooltip.classList.remove("is-visible");
  positionAppTooltip(target);
  requestAnimationFrame(() => {
    positionAppTooltip(target);
    tooltip.classList.add("is-visible");
  });
  window.activeTooltipTarget = target;
}

function hideAppTooltip(immediate = false) {
  const tooltip = document.querySelector(".app-floating-tooltip");
  if (!tooltip) return;
  tooltip.classList.remove("is-visible");
  window.activeTooltipTarget = null;
  if (immediate) {
    tooltip.hidden = true;
    return;
  }
  window.setTimeout(() => {
    if (!tooltip.classList.contains("is-visible")) {
      tooltip.hidden = true;
    }
  }, 160);
}

function findTooltipTarget(eventTarget) {
  return eventTarget instanceof Element ? eventTarget.closest("[data-tooltip]") : null;
}

function initializeAppTooltip() {
  normalizeAppTooltipTitles();

  document.addEventListener("pointerover", (event) => {
    const target = findTooltipTarget(event.target);
    if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
    showAppTooltip(target);
  });

  document.addEventListener("pointerout", (event) => {
    const target = findTooltipTarget(event.target);
    if (!target || (event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) return;
    hideAppTooltip();
  });

  document.addEventListener("focusin", (event) => {
    const target = findTooltipTarget(event.target);
    if (target) showAppTooltip(target);
  });

  document.addEventListener("focusout", (event) => {
    if (findTooltipTarget(event.target)) hideAppTooltip();
  });

  document.addEventListener("scroll", () => positionAppTooltip(window.activeTooltipTarget), true);
  window.addEventListener("resize", () => positionAppTooltip(window.activeTooltipTarget));
}

financeController.init();
statisticsController.init();
systemDatabaseController.init();
locationAliasLearningController.init();

render();
void initializeRemotePersistence();
startMissionAutoImportPolling();
startMissionImportProgressPolling();

function ensureConsignmentRows() {
  if (consignmentList.children.length > 0) {
    Array.from(consignmentList.children).forEach((node) => {
      if (node.querySelectorAll(".route-group-row").length === 0) {
        addRouteGroupRow(node, {
          pickup: node.querySelector('[data-field="pickup"]')?.value || "",
          dropoff: node.querySelector('[data-field="dropoff"]')?.value || "",
          groups: [],
        });
      }
      Array.from(node.querySelectorAll(".route-group-row")).forEach((routeNode) => {
        refreshContainerGroupActions(routeNode);
        refreshRouteGroupTitles(node);
      });
      syncConsignmentHint(node);
    });
    refreshConsignmentTitles();
    updateDimensionHint();
    return;
  }
  addConsignmentRow({
    title: "",
    routes: [
      {
        pickup: "",
        dropoff: "",
        groups: [],
      },
    ],
  });
}

function ensureQuickMissionRows() {
  if (!quickDestinationList) return;
  if (quickDestinationList.children.length === 0) {
    addQuickDestinationRow();
  }
  refreshQuickDestinationActions();
  syncQuickMissionHint();
}

function getCargoContainerProfiles() {
  return STANDARD_CONTAINER_PROFILES;
}

function getCargoContainerProfileByKey(key) {
  return getCargoContainerProfiles().find((profile) => profile.key === String(key || "").trim()) || null;
}

function normalizeMaxStandardContainerKey(value) {
  const key = String(value || "").trim();
  if (key === "none") return key;
  const profile = getCargoContainerProfileByKey(key);
  return profile && !profile.handheld ? profile.key : "";
}

function getCargoContainerProfileByDimensions(width, depth, height) {
  const signature = [width, depth].sort((left, right) => right - left).join("x");
  return getCargoContainerProfiles().filter((profile) => !profile.handheld).find((profile) => {
    const profileSignature = [profile.width, profile.depth].sort((left, right) => right - left).join("x");
    return profileSignature === signature && profile.height === height;
  }) || null;
}

function getSplittableContainerProfiles() {
  return getCargoContainerProfiles()
    .filter((profile) => !profile.handheld && Number.isInteger(profile.scu))
    .sort((left, right) => right.scu - left.scu);
}

function getCurrentShipMaxContainerProfile() {
  const cargoState = getActiveCargoCapacityState();
  if (!cargoState.shipProfile || !cargoState.hasCargo) return null;

  const support = getShipStandardContainerSupport(cargoState.shipProfile);
  if (cargoState.layoutMatchesActive && state.layout.overloadMode) {
    return support.totalProfile || support.officialProfile || null;
  }

  return support.officialProfile || null;
}

function getDefaultCargoContainerSizeKey() {
  const shipMaxProfile = getCurrentShipMaxContainerProfile();
  const missionMaxContainerScu = getMissionFormMaxContainerScu();
  const limits = [shipMaxProfile?.scu, missionMaxContainerScu].filter((value) => value > 0);
  if (limits.length === 0) return "8";
  const effectiveMaxScu = Math.min(...limits);
  return getSplittableContainerProfiles().find((profile) => profile.scu <= effectiveMaxScu)?.key || "1";
}

function isContainerProfileTooLargeForCurrentShip(profile) {
  const maxProfile = getCurrentShipMaxContainerProfile();
  return Boolean(profile && maxProfile && !profile.handheld && profile.scu > maxProfile.scu);
}

function normalizeMissionMaxContainerScu(value) {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 && amount <= 1000 ? amount : null;
}

function getMissionFormMaxContainerScu() {
  return normalizeMissionMaxContainerScu(missionForm?.elements?.maxContainerScu?.value);
}

function isContainerProfileTooLargeForMission(profile) {
  const maxContainerScu = getMissionFormMaxContainerScu();
  return Boolean(profile && maxContainerScu && !profile.handheld && profile.scu > maxContainerScu);
}

function buildContainerGroupsForScu(targetScu, missionMaxContainerScu = null) {
  let remaining = Math.max(0, Math.floor(Number(targetScu) || 0));
  const groups = [];
  const maxProfile = getCurrentShipMaxContainerProfile();
  const limits = [maxProfile?.scu, normalizeMissionMaxContainerScu(missionMaxContainerScu)].filter((value) => value > 0);
  const effectiveMaxScu = limits.length > 0 ? Math.min(...limits) : null;

  getSplittableContainerProfiles().filter((profile) => !effectiveMaxScu || profile.scu <= effectiveMaxScu).forEach((profile) => {
    if (remaining < profile.scu) return;
    const quantity = Math.floor(remaining / profile.scu);
    if (quantity <= 0) return;
    groups.push({
      quantity,
      containerSize: profile.key,
    });
    remaining -= quantity * profile.scu;
  });

  return remaining === 0 ? groups : [];
}



function resetQuickMissionCapture() {
  if (quickCargoTitle) quickCargoTitle.value = "";
  if (quickPickup) quickPickup.value = "";
  if (quickDestinationList) {
    quickDestinationList.innerHTML = "";
  }
  ensureQuickMissionRows();
}

function render() {
  renderLanguageOptions();
  translateStaticText();
  window.soloTheme?.render();
  renderPilotProfileSettings();
  syncFullscreenToggle();
  renderAppModeControls();
  renderShipManufacturerOptions();
  renderShipClassOptions();
  renderShipDbViewState();
  renderFleetPresetOptions();
  renderPresetOptions();
  ensureActiveFleetSelection();
  ensureFleetPlannerSelection();
  ensureSelectedLoad();
  renderLocationSuggestions();
  refreshContainerGroupCompatibility();
  renderPageState();
  syncLayoutInputs();
  syncAutoloadControls();
  updateDimensionHint();
  syncFleetLifecycleFields();
  updateFleetDurationHint();
  renderLevelFilters();
  renderSummary();
  renderRemoteStatus();
  backupController.render();
  renderHub();
  renderRunMode();
  renderShipGrid();
  renderIsometricView();
  syncStaticPreviews();
  renderHomeLoads();
  renderManifest();
  renderStopList();
  renderCurrentLocationControl();
  renderRouteProgress();
  renderStopHistory();
  renderMissions();
  renderFleet();
  financeController.render();
  statisticsController.render();
  renderShipDatabase();
  systemDatabaseController.render();
  renderMissionImportProgress();
  normalizeAppTooltipTitles();
}

function renderShipDbViewState() {
  const activeView = activeShipDbView === "create" ? "create" : "database";
  const isEditingShip = Boolean(shipDbForm?.entryId?.value);
  shipDbViewTabs.forEach((button) => {
    const isActive = button.dataset.shipdbViewTarget === activeView;
    if (button.dataset.shipdbViewTarget === "create") {
      button.textContent = isEditingShip ? t("shipdb.tabs.edit") : t("shipdb.tabs.create");
    } else if (button.dataset.shipdbViewTarget === "database") {
      button.textContent = t("shipdb.tabs.database");
    }
    button.classList.toggle("primary-button", isActive);
    button.classList.toggle("secondary-button", !isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  shipDbViewSections.forEach((section) => {
    section.hidden = section.dataset.shipdbView !== activeView;
  });
}

function setShipDbView(view) {
  activeShipDbView = view === "create" ? "create" : "database";
  renderShipDbViewState();
}

function renderPageState() {
  const loadPageAvailable = canUseLoadPage();
  if (activePage === "operations" && !isDispatcherMode()) {
    activePage = "overview";
  }
  if (activePage === "pilot-organization" && isDispatcherMode()) {
    activePage = "overview";
  }
  if (activePage === "pilot-groups" && isDispatcherMode()) {
    activePage = "overview";
  }
  if (activePage === "run" && isDispatcherMode()) {
    activePage = "overview";
  }
  if (activePage === "load" && !loadPageAvailable) {
    activePage = "overview";
  }
  if (lastCargoPage === "load" && !loadPageAvailable) {
    lastCargoPage = "overview";
  }
  if (lastCargoPage === "run" && isDispatcherMode()) {
    lastCargoPage = "overview";
  }
  const activeModule = getActiveModuleForPage(activePage);
  cargoNav.hidden = activeModule !== "cargo";
  fleetNav.hidden = activeModule !== "fleet";
  financeNav.hidden = activeModule !== "finance";
  statisticsNav.hidden = activeModule !== "statistics";
  settingsNav.hidden = activeModule !== "admin";

  moduleTabs.forEach((tab) => {
    const isActive = tab.dataset.moduleTarget === activeModule;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  pageTabs.forEach((tab) => {
    const isRunTab = tab.dataset.pageTarget === "run";
    const isLoadTab = tab.dataset.pageTarget === "load";
    const isOperationsTab = tab.dataset.pageTarget === "operations";
    const isPilotOrganizationTab = tab.dataset.pageTarget === "pilot-organization";
    const isPilotGroupsTab = tab.dataset.pageTarget === "pilot-groups";
    const isUnavailable = (isRunTab && isDispatcherMode())
      || (isLoadTab && !loadPageAvailable)
      || (isOperationsTab && !isDispatcherMode())
      || (isPilotOrganizationTab && isDispatcherMode())
      || (isPilotGroupsTab && isDispatcherMode());
    tab.hidden = isUnavailable;
    tab.disabled = isUnavailable;
    tab.setAttribute("aria-hidden", String(isUnavailable));
    const isActive = tab.dataset.pageTarget === activePage;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });

  pageSections.forEach((section) => {
    const isActive = section.dataset.page === activePage;
    section.classList.toggle("is-active", isActive);
    section.hidden = !isActive;
  });
  runViewController?.render();

  settingsMenuButton?.classList.toggle("is-active", activeModule === "admin");
  settingsMenuButton?.setAttribute("aria-current", activeModule === "admin" ? "page" : "false");
  renderSettingsPage();
  settingsNavigationButtons.forEach((button) => {
    const isActive = button.dataset.settingsGo === activePage;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

function setActivePage(pageId) {
  if (pageId === "load" && !canUseLoadPage()) {
    pageId = "overview";
  }
  activePage = pageId;
  if (isCargoPage(pageId)) {
    lastCargoPage = pageId;
  }
  renderPageState();
  if (pageId === "pilot-organization") {
  }
}

function normalizeSettingsView(value) {
  return ["profile", "companion", "database", "transfer", "about"].includes(value) ? value : "profile";
}

function renderSettingsPage() {
  const visibleView = ["ships", "systems"].includes(activePage) ? "database" : activeSettingsView;
  settingsViewButtons.forEach((button) => {
    const isActive = button.dataset.settingsViewTarget === visibleView;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  settingsViewPanels.forEach((panel) => {
    const isActive = panel.dataset.settingsView === activeSettingsView;
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
  if (activeSettingsView === "about") window.soloAbout?.render();
}

function setSettingsView(value) {
  activeSettingsView = normalizeSettingsView(value);
  if (activeSettingsView === "companion") {
    void loadServerImportTokenSettings();
  }
  setActivePage("settings");
}

async function switchAppMode(nextMode) {
  const normalizedMode = normalizeAppMode(nextMode);
  if (normalizedMode === activeAppMode) {
    return;
  }

  if (remoteSaveTimer) {
    window.clearTimeout(remoteSaveTimer);
    remoteSaveTimer = null;
  }

  const previousLanguage = currentUiLanguage();
  const hasLocalModeState = hasStoredState(normalizedMode);
  activeAppMode = normalizedMode;
  localStorage.setItem(APP_MODE_STORAGE_KEY, activeAppMode);
  remoteHydrationComplete = false;
  remoteStatus = createRemoteStatusState();
  state = pruneInvalidPlacements(loadState(activeAppMode));
  if (!hasLocalModeState) {
    state.uiLanguage = previousLanguage;
  }

  activePage = "hub";
  lastCargoPage = "overview";
  collapsedMissionIds.clear();
  collapsedMissionGroupIds.clear();
  collapsedMissionGroupIds.add("paid");
  draggedMissionId = "";
  lastUnloadPlan = null;

  resetMissionForm();
  resetFleetForm();
  resetShipDbForm();
  setShipDbView("database");
  syncLayoutInputs();
  render();
  await initializeRemotePersistence(activeAppMode);
}

function renderAppModeControls() {
  document.body.dataset.appMode = activeAppMode;
  if (appModeSwitch) {
    appModeSwitch.hidden = !DISPATCHER_MODE_ENABLED;
  }
  const nextMode = activeAppMode === "solo" ? "dispatcher" : "solo";
  appModeButtons.forEach((button) => {
    button.dataset.appModeTarget = nextMode;
    const activeLabel = t(activeAppMode === "dispatcher" ? "mode.dispatcher.short" : "mode.solo.short");
    const tooltip = t(nextMode === "dispatcher" ? "mode.switchToOrganization" : "mode.switchToSolo");
    button.querySelector(".mode-label").textContent = activeLabel;
    button.setAttribute("aria-label", tooltip);
    button.setAttribute("title", tooltip);
    button.dataset.tooltip = tooltip;
  });
}

function currentAppMode() {
  return activeAppMode;
}

function isDispatcherMode() {
  return activeAppMode === "dispatcher";
}

function isCargoPage(pageId) {
  return ["run", "overview", "operations", "pilot-organization", "pilot-groups", "create", "home", "load"].includes(pageId);
}

function getPilotGroupForMission(missionId) {
  if (isDispatcherMode()) return null;
  return null;
}

function canUseLoadPage() {
  if (isDispatcherMode()) return false;
  return hasShipCargoGrid(currentActiveShipProfile());
}

function getActiveModuleForPage(pageId) {
  if (isCargoPage(pageId)) return "cargo";
  if (pageId === "finance") return "finance";
  if (pageId === "fleet") return "fleet";
  if (pageId === "statistics") return "statistics";
  if (["settings", "ships", "systems"].includes(pageId)) return "admin";
  return "hub";
}

function getCargoFleetEntries() {
  return getFleetEntries().filter((entry) => {
    if (entry.status !== "active" || !entry.shipId) return false;
    const ship = findShipLibraryEntryById(entry.shipId);
    return hasShipCargoGrid(ship);
  });
}

function currentFleetShip() {
  return getCargoFleetEntries().find((entry) => entry.id === state.layout.fleetEntryId) || null;
}

function getActiveCargoCapacityState() {
  const activeEntry = currentActiveFleetEntry();
  const shipProfile = currentActiveShipProfile();
  const hasCargo = hasShipCargoGrid(shipProfile);
  const layoutMatchesActive = Boolean(activeEntry && state.layout.fleetEntryId === activeEntry.id);
  const profileCapacity = hasCargo ? getShipGridSummary(shipProfile).total.totalScu : 0;
  const totalCapacity = hasCargo
    ? layoutMatchesActive ? getTotalCapacity() : profileCapacity
    : 0;
  const usedCapacity = hasCargo && layoutMatchesActive ? getUsedCapacity() : 0;

  return {
    activeEntry,
    shipProfile,
    hasCargo,
    layoutMatchesActive,
    totalCapacity,
    usedCapacity,
    freeCapacity: Math.max(totalCapacity - usedCapacity, 0),
  };
}

function getActiveFleetEntries() {
  return getFleetEntries().filter((entry) => entry.status === "active" && entry.shipId);
}

function currentActiveFleetEntry() {
  if (isDispatcherMode()) return null;
  return getActiveFleetEntries().find((entry) => entry.id === state.activeFleetEntryId) || null;
}

function currentActiveShipProfile() {
  const activeEntry = currentActiveFleetEntry();
  return activeEntry?.shipId ? findShipLibraryEntryById(activeEntry.shipId) : null;
}

function hasShipCargoGrid(shipProfile) {
  if (!shipProfile?.gridRows || !shipProfile?.gridCols) return false;
  return getShipGridSummary(shipProfile).total.totalScu > 0;
}

function formatFleetRegistration(entry) {
  const registration = String(entry?.registration || "").trim();
  return registration || FLEET_REGISTRATION_PLACEHOLDER;
}

function formatFleetEntryDisplayName(entry, fallback = "Kein aktives Schiff") {
  if (!entry) return fallback;
  return `${entry.manufacturer} ${entry.model} · ${formatFleetRegistration(entry)}`;
}

function formatFleetCrewDetail(entry, { includeOwner = true, includePilot = true } = {}) {
  const parts = [];
  const pilotName = getFleetEntryPilotName(entry);
  if (includePilot && pilotName) {
    parts.push(t("fleet.crew.pilotShort", { value: pilotName }));
  }
  if (includeOwner && String(entry?.ownerName || "").trim()) {
    parts.push(t("fleet.crew.ownerShort", { value: String(entry.ownerName).trim() }));
  }
  return parts.join(" · ");
}

function formatFleetAssignmentDisplayName(entry, fallback = "Kein aktives Schiff") {
  if (!entry) return fallback;
  const crewDetail = formatFleetCrewDetail(entry, { includePilot: false });
  return crewDetail ? `${formatFleetEntryDisplayName(entry)} · ${crewDetail}` : formatFleetEntryDisplayName(entry);
}

function ensureActiveFleetSelection() {
  if (isDispatcherMode()) {
    if (state.activeFleetEntryId) {
      state.activeFleetEntryId = "";
      persist();
    }
    return;
  }
  if (!state.activeFleetEntryId) return;
  const hasActiveEntry = getActiveFleetEntries().some((entry) => entry.id === state.activeFleetEntryId);
  if (hasActiveEntry) return;
  state.activeFleetEntryId = "";
  persist();
}

function getSelectedMissionType() {
  return normalizeMissionType(missionTypeSelect?.value || "other");
}

function setSectionControlsDisabled(section, disabled) {
  if (!section) return;
  section.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = disabled;
  });
}

function syncMissionTypeFields() {
  const missionType = getSelectedMissionType();
  const isCargo = missionType === "cargo";
  const isCourier = missionType === "courier";
  const isDelivery = missionType === "delivery";
  const isRefuel = missionType === "refuel";
  const isInvestigation = missionType === "investigation";
  const isSalvage = missionType === "salvage";
  const isProcurement = missionType === "procurement";
  const isMining = missionType === "mining";
  const isOther = missionType === "other";

  if (missionTypeSelect) {
    missionTypeSelect.value = missionType;
  }
  if (missionForm?.title) {
    missionForm.title.placeholder =
      isCargo
        ? t("contracts.form.titlePlaceholderCargo")
        : isCourier
          ? t("contracts.form.titlePlaceholderCourier")
        : isDelivery
          ? t("contracts.form.titlePlaceholderDelivery")
        : isRefuel
          ? t("contracts.form.titlePlaceholderRefuel")
          : isInvestigation
            ? t("contracts.form.titlePlaceholderInvestigation")
            : isSalvage
              ? t("contracts.form.titlePlaceholderSalvage")
            : isProcurement
              ? t("contracts.form.titlePlaceholderProcurement")
            : isMining
              ? t("contracts.form.titlePlaceholderMining")
          : t("contracts.form.titlePlaceholderOther");
  }
  if (missionQuickCapture) {
    missionQuickCapture.hidden = !isCargo;
    setSectionControlsDisabled(missionQuickCapture, !isCargo);
  }
  if (consignmentBuilder) {
    consignmentBuilder.hidden = !isCargo;
    setSectionControlsDisabled(consignmentBuilder, !isCargo);
  }
  if (cargoFields) {
    cargoFields.hidden = !isCargo;
    setSectionControlsDisabled(cargoFields, !isCargo);
  }
  if (courierFields) {
    courierFields.hidden = !isCourier;
    setSectionControlsDisabled(courierFields, !isCourier);
    if (isCourier && courierPackageList && courierPackageList.children.length === 0) {
      resetCourierPackages();
    }
  }
  if (deliveryFields) {
    deliveryFields.hidden = !isDelivery;
    setSectionControlsDisabled(deliveryFields, !isDelivery);
    if (isDelivery && deliveryItemList && deliveryItemList.children.length === 0) {
      resetDeliveryItems();
    }
  }
  if (refuelFields) {
    refuelFields.hidden = !isRefuel;
    setSectionControlsDisabled(refuelFields, !isRefuel);
  }
  if (investigationFields) {
    investigationFields.hidden = !isInvestigation;
    setSectionControlsDisabled(investigationFields, !isInvestigation);
  }
  if (salvageFields) {
    salvageFields.hidden = !isSalvage;
    setSectionControlsDisabled(salvageFields, !isSalvage);
  }
  if (procurementFields) {
    procurementFields.hidden = !isProcurement;
    setSectionControlsDisabled(procurementFields, !isProcurement);
    if (isProcurement && procurementItemList && procurementItemList.children.length === 0) {
      resetProcurementItems();
    }
  }
  if (miningFields) {
    miningFields.hidden = !isMining;
    setSectionControlsDisabled(miningFields, !isMining);
  }
  if (miscFields) {
    miscFields.hidden = !isOther;
    setSectionControlsDisabled(miscFields, !isOther);
  }
  if (!isCargo) {
    if (missionValidationOverride) missionValidationOverride.checked = false;
    if (missionValidationOverrideWrap) missionValidationOverrideWrap.hidden = true;
    if (missionValidationHint) {
      missionValidationHint.innerHTML = "";
      missionValidationHint.hidden = true;
    }
  }
  renderCreateDraftSummary();
}

function initializeCollapsiblePanels() {
  collapseButtons.forEach((button) => {
    syncCollapsiblePanel(button);
    button.addEventListener("click", () => {
      const targetId = button.dataset.collapseTarget;
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      target.hidden = !target.hidden;
      syncCollapsiblePanel(button);
    });
  });
}

function syncCollapsiblePanel(button) {
  const targetId = button.dataset.collapseTarget;
  if (!targetId) return;
  const target = document.getElementById(targetId);
  if (!target) return;
  const expanded = !target.hidden;
  button.setAttribute("aria-expanded", String(expanded));
  if (!button.classList.contains("consignment-builder-toggle")) {
    button.setAttribute("title", expanded ? "Bereich einklappen" : "Bereich ausklappen");
  } else {
    button.removeAttribute("title");
  }
  button.closest(".panel-collapsible")?.classList.toggle("is-collapsed", !expanded);
}

function setCollapsibleExpanded(targetId, expanded) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.hidden = !expanded;
  collapseButtons
    .filter((button) => button.dataset.collapseTarget === targetId)
    .forEach((button) => syncCollapsiblePanel(button));
}

function showMissionConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = t("common.cancel"),
  kicker = "",
  tone = "default",
  showCancel = true,
}) {
  if (!missionConfirmDialog || !missionConfirmDialogTitle || !missionConfirmDialogMessage || !missionConfirmDialogConfirm) {
    return Promise.resolve(false);
  }

  hideAppTooltip(true);
  if (missionConfirmDialogKicker) {
    missionConfirmDialogKicker.textContent = kicker || t("contracts.dialog.kicker");
  }
  missionConfirmDialogTitle.textContent = title;
  missionConfirmDialogMessage.textContent = message;
  missionConfirmDialogConfirm.textContent = confirmLabel;
  if (missionConfirmDialogCancel) {
    missionConfirmDialogCancel.textContent = cancelLabel;
    missionConfirmDialogCancel.hidden = !showCancel;
  }
  missionConfirmDialogConfirm.classList.toggle("primary-button", tone !== "danger");
  missionConfirmDialogConfirm.classList.toggle("secondary-button-danger", tone === "danger");
  missionConfirmDialog.hidden = false;
  missionConfirmDialogConfirm.focus();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      missionConfirmDialog.hidden = true;
      if (missionConfirmDialogCancel) {
        missionConfirmDialogCancel.hidden = false;
        missionConfirmDialogCancel.textContent = t("common.cancel");
      }
      resolve(result);
    };
    const handleCancel = () => finish(false);
    const handleConfirm = () => finish(true);
    const handleBackdrop = (event) => {
      if (event.target === missionConfirmDialog) finish(false);
    };
    const handleKeydown = (event) => {
      if (event.key === "Escape") finish(false);
    };
    const cleanup = () => {
      missionConfirmDialogCancel?.removeEventListener("click", handleCancel);
      missionConfirmDialogConfirm.removeEventListener("click", handleConfirm);
      missionConfirmDialog.removeEventListener("click", handleBackdrop);
      document.removeEventListener("keydown", handleKeydown);
    };

    missionConfirmDialogCancel?.addEventListener("click", handleCancel);
    missionConfirmDialogConfirm.addEventListener("click", handleConfirm);
    missionConfirmDialog.addEventListener("click", handleBackdrop);
    document.addEventListener("keydown", handleKeydown);
  });
}

function showMissionPayoutSplitDialog(mission) {
  const participants = getMissionParticipants(mission);
  const payout = getMissionPayout(mission);
  if (!missionPayoutSplitDialog || !missionPayoutSplitForm || participants.length < 2 || payout <= 0) {
    return Promise.resolve(null);
  }

  hideAppTooltip(true);
  const existingSplit = mission.payoutSplit?.items?.length === participants.length ? mission.payoutSplit : null;
  let mode = existingSplit?.mode === "amount" ? "amount" : "percent";
  const defaultPercent = Math.floor((10000 / participants.length)) / 100;
  const defaultAmount = Math.floor(payout / participants.length);
  const renderInputs = () => {
    missionPayoutSplitForm.querySelectorAll('input[name="missionPayoutSplitMode"]').forEach((input) => {
      input.checked = input.value === mode;
    });
    missionPayoutSplitList.innerHTML = participants.map((participant, index) => {
      const existingItem = existingSplit?.items?.find((item) => item.pilotId === participant.pilotId);
      const value = mode === "amount"
        ? (existingItem?.amountAuec ?? (index === participants.length - 1 ? payout - defaultAmount * index : defaultAmount))
        : (existingItem?.value ?? (index === participants.length - 1 ? 100 - defaultPercent * index : defaultPercent));
      return `<label class="app-dialog-field"><span>${escapeHtml(participant.pilotName)}</span><input type="number" min="0" step="${mode === "amount" ? "1" : "0.01"}" value="${escapeHtml(String(value))}" data-pilot-id="${escapeHtml(participant.pilotId)}" required /> <small>${mode === "amount" ? "aUEC" : "%"}</small></label>`;
    }).join("");
    missionPayoutSplitHint.textContent = mode === "amount"
      ? `Summe muss ${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC ergeben.`
      : "Summe muss 100 % ergeben.";
    missionPayoutSplitHint.classList.remove("form-hint-warning");
  };
  renderInputs();
  missionPayoutSplitMessage.textContent = `${mission.title}: ${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC für ${participants.length} Beteiligte.`;
  missionPayoutSplitDialog.hidden = false;
  missionPayoutSplitList.querySelector("input")?.focus();

  return new Promise((resolve) => {
    const finish = (result) => {
      cleanup();
      missionPayoutSplitDialog.hidden = true;
      resolve(result);
    };
    const handleModeChange = (event) => {
      mode = event.target.value === "amount" ? "amount" : "percent";
      renderInputs();
    };
    const handleCancel = () => finish(null);
    const handleBackdrop = (event) => { if (event.target === missionPayoutSplitDialog) finish(null); };
    const handleKeydown = (event) => { if (event.key === "Escape") finish(null); };
    const handleSubmit = (event) => {
      event.preventDefault();
      const values = Array.from(missionPayoutSplitList.querySelectorAll("input[data-pilot-id]")).map((input) => ({
        pilotId: input.dataset.pilotId,
        value: Number(input.value),
      }));
      const sum = values.reduce((total, item) => total + (Number.isFinite(item.value) ? item.value : 0), 0);
      const valid = mode === "amount" ? Math.round(sum) === payout : Math.abs(sum - 100) < 0.001;
      if (!valid || values.some((item) => !Number.isFinite(item.value) || item.value < 0)) {
        missionPayoutSplitHint.textContent = mode === "amount" ? `Bitte exakt ${payout.toLocaleString("de-DE")} aUEC verteilen.` : "Bitte exakt 100 % verteilen.";
        missionPayoutSplitHint.classList.add("form-hint-warning");
        return;
      }
      finish({
        mode,
        items: values.map((item) => {
          const participant = participants.find((entry) => entry.pilotId === item.pilotId);
          return {
            pilotId: item.pilotId,
            pilotName: participant?.pilotName || "",
            value: mode === "amount" ? Math.round(item.value) : Math.round(item.value * 100) / 100,
            amountAuec: mode === "amount" ? Math.round(item.value) : Math.round((payout * item.value) / 100),
          };
        }),
      });
    };
    const cleanup = () => {
      missionPayoutSplitForm.removeEventListener("submit", handleSubmit);
      missionPayoutSplitForm.querySelectorAll('input[name="missionPayoutSplitMode"]').forEach((input) => input.removeEventListener("change", handleModeChange));
      missionPayoutSplitCancel?.removeEventListener("click", handleCancel);
      missionPayoutSplitDialog.removeEventListener("click", handleBackdrop);
      document.removeEventListener("keydown", handleKeydown);
    };
    missionPayoutSplitForm.addEventListener("submit", handleSubmit);
    missionPayoutSplitForm.querySelectorAll('input[name="missionPayoutSplitMode"]').forEach((input) => input.addEventListener("change", handleModeChange));
    missionPayoutSplitCancel?.addEventListener("click", handleCancel);
    missionPayoutSplitDialog.addEventListener("click", handleBackdrop);
    document.addEventListener("keydown", handleKeydown);
  });
}

function showAppNotice(message, {
  title = t("common.notice"),
  kicker = t("common.notice"),
  tone = "default",
} = {}) {
  return showMissionConfirmDialog({
    title,
    message,
    confirmLabel: t("common.ok"),
    kicker,
    tone,
    showCancel: false,
  });
}

function normalizeUiLanguage(value) {
  const normalized = String(value || "de").trim().toLowerCase();
  return APP_LANGUAGE_OPTIONS.some((option) => option.value === normalized) ? normalized : "de";
}

function currentUiLanguage() {
  return normalizeUiLanguage(state?.uiLanguage);
}

function localizeLabel(option) {
  if (!option) return "";
  if (option.labels && typeof option.labels === "object") {
    return option.labels[currentUiLanguage()] || option.labels.de || option.labels.en || "";
  }
  return option.label || "";
}

function t(key, params = {}) {
  return window.AppI18n?.translate(currentUiLanguage(), key, params) || String(key || "");
}

function translateStaticText(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll("[data-i18n-label]").forEach((element) => {
    setElementLeadingText(element, t(element.dataset.i18nLabel));
  });
  root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll("[data-i18n-title]").forEach((element) => {
    element.setAttribute("title", t(element.dataset.i18nTitle));
  });
  root.querySelectorAll("[data-i18n-tooltip]").forEach((element) => {
    element.dataset.tooltip = t(element.dataset.i18nTooltip);
  });
  root.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  });
}

function setElementLeadingText(element, value) {
  if (!element) return;
  const existingTextNode = Array.from(element.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
  if (existingTextNode) {
    existingTextNode.textContent = `${value}\n                    `;
    return;
  }
  element.insertBefore(document.createTextNode(`${value} `), element.firstChild);
}

function normalizeShipClass(value) {
  const legacyAliases = {
    light_refuel: "refuel",
    heavy_refuel: "refuel",
  };
  const rawValue = String(value || "").trim();
  const normalized = legacyAliases[rawValue] || rawValue;
  return SHIP_CLASS_OPTIONS.some((option) => option.value === normalized) ? normalized : "";
}

function getShipClassLabel(value) {
  const normalized = normalizeShipClass(value);
  return localizeLabel(SHIP_CLASS_OPTIONS.find((option) => option.value === normalized)) || "";
}

function isRefuelShipClass(value) {
  return REFUEL_SHIP_CLASSES.includes(normalizeShipClass(value));
}

function createLoad({
  label,
  width,
  depth,
  height,
  rotated = false,
  placement = null,
  id = createRuntimeId(),
  pickup = "",
  dropoff = "",
  cargoTitle = "",
  segmentId = null,
  loadedByFleetEntryId = "",
  loadedAt = null,
  deliveredByFleetEntryId = "",
  deliveredAt = null,
}) {
  const normalizedWidth = clamp(Number(width) || 1, 1, 8);
  const normalizedDepth = clamp(Number(depth) || 1, 1, 8);
  const normalizedHeight = clamp(Number(height) || 1, 1, 8);
  return {
    id,
    label: String(label),
    width: normalizedWidth,
    depth: normalizedDepth,
    height: normalizedHeight,
    scu: normalizedWidth * normalizedDepth * normalizedHeight,
    rotated: Boolean(rotated),
    placement,
    pickup: String(pickup || ""),
    dropoff: String(dropoff || ""),
    cargoTitle: String(cargoTitle || label || ""),
    segmentId: segmentId ? String(segmentId) : null,
    loadedByFleetEntryId: String(loadedByFleetEntryId || ""),
    loadedAt: loadedAt ? String(loadedAt) : null,
    deliveredByFleetEntryId: String(deliveredByFleetEntryId || ""),
    deliveredAt: deliveredAt ? String(deliveredAt) : null,
  };
}

function createFleetEntry({
  id = createRuntimeId(),
  manufacturer,
  model,
  registration = "",
  imageUrl = "",
  refuelContainerSizeScu = null,
  refuelContainerSizesScu = [],
  acquiredOn,
  endedOn = "",
  status = "active",
  patchVersion = "",
  ownerName = "",
  pilotId = "",
  pilotName = "",
  pledgePurchased = false,
  notes = "",
  shipId = "",
  createdAt = new Date().toISOString(),
}) {
  const normalizedRefuelContainerSizes = normalizeRefuelContainerSizeList(refuelContainerSizesScu);
  const hasSpecificRefuelSizes = normalizedRefuelContainerSizes.some((size) => size > 0);
  const normalizedStatus = FLEET_STATUS_LABELS[status] ? status : "active";
  return {
    id,
    manufacturer: String(manufacturer || "").trim(),
    model: String(model || "").trim(),
    registration: String(registration || "").trim(),
    imageUrl: normalizeShipImageUrl(imageUrl),
    refuelContainerSizeScu: hasSpecificRefuelSizes ? null : normalizePositiveDecimal(refuelContainerSizeScu) || null,
    refuelContainerSizesScu: normalizedRefuelContainerSizes,
    acquiredOn: normalizeDateInput(acquiredOn),
    endedOn: normalizedStatus === "active" ? "" : normalizeDateInput(endedOn),
    status: normalizedStatus,
    patchVersion: ["patch-replaced", "wipe-replaced", "wipe-removed"].includes(normalizedStatus)
      ? String(patchVersion || "").trim()
      : "",
    ownerName: String(ownerName || "").trim(),
    pilotId: String(pilotId || "").trim(),
    pilotName: String(pilotName || "").trim(),
    pledgePurchased: Boolean(pledgePurchased),
    notes: String(notes || "").trim(),
    shipId: String(shipId || "").trim(),
    createdAt,
  };
}

function getGridHeightAt(heights, row, col) {
  return clamp(Number(heights?.[createSlotId(row, col)] || 0), 0, 8);
}

function normalizeGridHeights(value, rows, cols) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([slotId, height]) => [String(slotId || "").trim().toUpperCase(), clamp(Number(height) || 0, 0, 8)])
      .filter(([slotId, height]) => isSlotInside(slotId, rows, cols) && height > 0),
  );
}

function normalizeGridBlockedSlots(value, rows, cols) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map((slotId) => String(slotId || "").trim().toUpperCase())
      .filter((slotId) => isSlotInside(slotId, rows, cols)),
  )];
}

function normalizeGridHeightOverrides(value, rows, cols) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([slotId, height]) => [String(slotId || "").trim().toUpperCase(), clamp(Number(height) || 1, 1, 8)])
      .filter(([slotId]) => isSlotInside(slotId, rows, cols)),
  );
}

function formatBlockedSlotsInput(slotIds) {
  return Array.isArray(slotIds) ? slotIds.join(", ") : "";
}

function formatHeightOverridesInput(overrides) {
  return Object.entries(overrides || {})
    .map(([slotId, height]) => `${slotId}:${height}`)
    .join(", ");
}

function parseBlockedSlotsInput(value, rows, cols) {
  return normalizeGridBlockedSlots(String(value || "").split(","), rows, cols);
}

function parseHeightOverridesInput(value, rows, cols) {
  if (!value) {
    return {};
  }

  const pairs = String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return normalizeGridHeightOverrides(
    Object.fromEntries(
      pairs
        .map((entry) => {
          const [slotId, height] = entry.split(":").map((part) => String(part || "").trim());
          return [slotId, height];
        })
        .filter(([slotId, height]) => slotId && height),
    ),
    rows,
    cols,
  );
}

function deriveGridHeightsFromPresetLike({ rows, cols, defaultHeight, blockedSlots = [], heightOverrides = {} }) {
  const blocked = new Set(normalizeGridBlockedSlots(blockedSlots, rows, cols));
  const overrides = normalizeGridHeightOverrides(heightOverrides, rows, cols);
  const heights = {};

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const slotId = createSlotId(row, col);
      if (blocked.has(slotId)) continue;
      const height = clamp(Number(overrides[slotId] ?? defaultHeight ?? 1) || 1, 1, 8);
      if (height > 0) {
        heights[slotId] = height;
      }
    }
  }

  return heights;
}

function summarizeGridHeights(heights) {
  const values = Object.values(heights || {}).map((value) => clamp(Number(value) || 0, 0, 8));
  return {
    occupiedSlots: values.filter((value) => value > 0).length,
    totalScu: values.reduce((sum, value) => sum + value, 0),
    maxHeight: Math.max(0, ...values, 0),
  };
}

function normalizeOverloadGridHeights(heights, baseHeights, rows, cols) {
  const normalized = normalizeGridHeights(heights, rows, cols);
  const sanitized = {};

  Object.entries(normalized).forEach(([slotId, height]) => {
    const numericHeight = clamp(Number(height) || 0, 0, 8);
    if (numericHeight > 0) {
      sanitized[slotId] = numericHeight;
    }
  });

  return sanitized;
}

function mergeShipGridHeights(baseHeights, overloadHeights) {
  const merged = {};
  const slotIds = new Set([
    ...Object.keys(baseHeights || {}),
    ...Object.keys(overloadHeights || {}),
  ]);

  slotIds.forEach((slotId) => {
    const baseHeight = clamp(Number(baseHeights?.[slotId]) || 0, 0, 8);
    const overloadHeight = clamp(Number(overloadHeights?.[slotId]) || 0, 0, 8);
    const totalHeight = clamp(baseHeight + overloadHeight, 0, 8);
    if (totalHeight > 0) {
      merged[slotId] = totalHeight;
    }
  });

  return merged;
}

function buildSlotMetadataFromHeights(heights, rows, cols) {
  const blockedSlots = [];
  const heightOverrides = {};

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const slotId = createSlotId(row, col);
      const height = clamp(Number(heights?.[slotId]) || 0, 0, 8);
      if (height <= 0) {
        blockedSlots.push(slotId);
        continue;
      }
      if (height !== 1) {
        heightOverrides[slotId] = height;
      }
    }
  }

  return {
    blockedSlots,
    heightOverrides,
  };
}

function getShipGridSummary(entry) {
  const official = summarizeGridHeights(entry?.gridHeights || {});
  const overload = summarizeGridHeights(entry?.overloadGridHeights || {});
  return {
    official,
    overload,
    total: summarizeGridHeights(mergeShipGridHeights(entry?.gridHeights || {}, entry?.overloadGridHeights || {})),
  };
}

function normalizePositiveInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function normalizePositiveDecimal(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric * 100) / 100 : 0;
}

function normalizeRefuelContainerSizeList(value) {
  const rawValues = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
  return rawValues.map((entry) => normalizePositiveDecimal(entry) || null);
}

function getRefuelContainerConfig(shipProfile, fleetEntry = null) {
  const containerCount = normalizePositiveInteger(shipProfile?.refuelContainerCount);
  const legacyContainerSizeScu = normalizePositiveDecimal(fleetEntry?.refuelContainerSizeScu);
  const storedContainerSizes = normalizeRefuelContainerSizeList(fleetEntry?.refuelContainerSizesScu);
  const containerSizes = Array.from({ length: containerCount }, (_, index) => storedContainerSizes[index] || legacyContainerSizeScu || 0);
  const configuredContainerCount = containerSizes.filter((size) => size > 0).length;
  const totalCapacity = Math.round(containerSizes.reduce((sum, size) => sum + size, 0) * 100) / 100;

  return {
    containerCount,
    containerSizes,
    configuredContainerCount,
    totalCapacity,
    hasRefuelContainers: isRefuelShipClass(shipProfile?.shipClass) && containerCount > 0,
    hasConfiguredCapacity: isRefuelShipClass(shipProfile?.shipClass) && containerCount > 0 && totalCapacity > 0,
  };
}

function hasRefuelSupport(entry) {
  return getRefuelContainerConfig(entry).hasRefuelContainers;
}

function formatRefuelSupport(entry) {
  const count = getRefuelContainerConfig(entry).containerCount;
  if (!count) return "";
  return `${count} ${count === 1 ? "Behälter" : "Behälter"}`;
}

function formatFleetRefuelSupport(fleetEntry, shipProfile = findShipLibraryEntryForFleetEntry(fleetEntry)) {
  const config = getRefuelContainerConfig(shipProfile, fleetEntry);
  if (!config.hasRefuelContainers) return t("refuel.noTank");
  if (!config.hasConfiguredCapacity) {
    return t("refuel.sizeOpen", { count: config.containerCount });
  }
  const configuredPart = config.configuredContainerCount === config.containerCount
    ? t("refuel.allSizes")
    : t("refuel.configuredSizes", { configured: config.configuredContainerCount, total: config.containerCount });
  const uniqueSizes = [...new Set(config.containerSizes.filter((size) => size > 0))];
  const sizePart = uniqueSizes.length === 1 && config.configuredContainerCount === config.containerCount
    ? t("refuel.perContainer", { size: formatScuAmount(uniqueSizes[0]) })
    : configuredPart;
  return t("refuel.support", { count: config.containerCount, sizePart, total: formatScuAmount(config.totalCapacity) });
}

function getContainerFootprintVariants(profile) {
  if (!profile || profile.handheld) {
    return [];
  }

  const variants = [[profile.width, profile.depth]];
  if (profile.width !== profile.depth) {
    variants.push([profile.depth, profile.width]);
  }
  return variants;
}

function canStandardContainerFit(heights, rows, cols, profile) {
  if (!profile || profile.handheld) {
    return false;
  }

  const normalizedRows = clamp(Number(rows) || 0, 0, MAX_GRID_ROWS);
  const normalizedCols = clamp(Number(cols) || 0, 0, 12);
  if (!normalizedRows || !normalizedCols) {
    return false;
  }

  const normalizedHeights = normalizeGridHeights(heights || {}, normalizedRows, normalizedCols);
  return getContainerFootprintVariants(profile).some(([width, depth]) => {
    if (width > normalizedCols || depth > normalizedRows) {
      return false;
    }

    for (let row = 0; row <= normalizedRows - depth; row += 1) {
      for (let col = 0; col <= normalizedCols - width; col += 1) {
        const footprint = buildFootprint(row, col, width, depth);
        const fitsHere = footprint.every((cell) => {
          const slotId = createSlotId(cell.row, cell.col);
          const slotHeight = clamp(Number(normalizedHeights[slotId]) || 0, 0, 8);
          return slotHeight >= profile.height;
        });

        if (fitsHere) {
          return true;
        }
      }
    }

    return false;
  });
}

function getLargestSupportedStandardContainer(heights, rows, cols) {
  return STANDARD_CONTAINER_PROFILES
    .filter((profile) => !profile.handheld)
    .reduce(
      (largest, profile) => (canStandardContainerFit(heights, rows, cols, profile) ? profile : largest),
      null,
    );
}

function capStandardContainerProfile(profile, maxContainerSizeKey) {
  const normalizedKey = normalizeMaxStandardContainerKey(maxContainerSizeKey);
  if (!normalizedKey) return profile || null;
  if (normalizedKey === "none") return null;
  if (!profile) return null;
  const maxProfile = getCargoContainerProfileByKey(normalizedKey);
  if (!maxProfile) return profile;
  return profile.scu <= maxProfile.scu ? profile : maxProfile;
}

function getShipStandardContainerSupport(entry) {
  const rows = clamp(Number(entry?.gridRows) || 0, 0, MAX_GRID_ROWS);
  const cols = clamp(Number(entry?.gridCols) || 0, 0, 12);

  if (!rows || !cols) {
    return {
      officialProfile: null,
      totalProfile: null,
    };
  }

  const officialHeights = normalizeGridHeights(entry?.gridHeights || {}, rows, cols);
  const overloadHeights = normalizeOverloadGridHeights(entry?.overloadGridHeights || {}, officialHeights, rows, cols);
  const totalHeights = mergeShipGridHeights(officialHeights, overloadHeights);

  const maxContainerSizeKey = normalizeMaxStandardContainerKey(entry?.maxContainerSizeKey);
  const officialAutoProfile = getLargestSupportedStandardContainer(officialHeights, rows, cols);
  const totalAutoProfile = getLargestSupportedStandardContainer(totalHeights, rows, cols);

  return {
    officialProfile: capStandardContainerProfile(officialAutoProfile, maxContainerSizeKey),
    totalProfile: capStandardContainerProfile(totalAutoProfile, maxContainerSizeKey),
    officialAutoProfile,
    totalAutoProfile,
    maxContainerSizeKey,
  };
}

function encodeFleetPresetValue(fleetEntryId, overloadMode = false) {
  return `${fleetEntryId}::${overloadMode ? "overload" : "normal"}`;
}

function decodeFleetPresetValue(value) {
  const raw = String(value || "");
  if (!raw || raw === "custom") {
    return { fleetEntryId: "", overloadMode: false, isCustom: true };
  }
  const [fleetEntryId, mode] = raw.split("::");
  return {
    fleetEntryId: fleetEntryId || "",
    overloadMode: mode === "overload",
    isCustom: false,
  };
}

function createShipBuilderState({
  rows = 8,
  cols = 6,
  levels = 1,
  activeLevel = 1,
  heights = {},
  overloadHeights = {},
  mode = "base",
} = {}) {
  const normalizedRows = clamp(Number(rows) || 8, 2, MAX_GRID_ROWS);
  const normalizedCols = clamp(Number(cols) || 6, 2, 12);
  const normalizedHeights = normalizeGridHeights(heights, normalizedRows, normalizedCols);
  const normalizedOverloadHeights = normalizeOverloadGridHeights(overloadHeights, normalizedHeights, normalizedRows, normalizedCols);
  const mergedHeights = mergeShipGridHeights(normalizedHeights, normalizedOverloadHeights);
  const maxHeight = Math.max(
    summarizeGridHeights(normalizedHeights).maxHeight,
    summarizeGridHeights(mergedHeights).maxHeight,
  );
  const normalizedLevels = clamp(Number(levels) || maxHeight || 1, 1, 8);

  return {
    rows: normalizedRows,
    cols: normalizedCols,
    levels: Math.max(normalizedLevels, maxHeight || 1),
    activeLevel: clamp(Number(activeLevel) || 1, 1, Math.max(normalizedLevels, maxHeight || 1)),
    heights: normalizedHeights,
    overloadHeights: normalizedOverloadHeights,
    mode: mode === "overload" ? "overload" : "base",
  };
}

function createShipLibraryEntry({
  id = createRuntimeId(),
  manufacturer,
  model,
  variant = "",
  imageUrl = "",
  shipClass = "",
  priceAuec = null,
  hydrogenFuel = null,
  quantumFuel = null,
  refuelContainerCount = null,
  hangarSize = "",
  presetId = "",
  notes = "",
  gridRows = null,
  gridCols = null,
  gridLevels = null,
  gridHeights = undefined,
  overloadGridHeights = undefined,
  gridBlockedSlots = undefined,
  gridHeightOverrides = undefined,
  cargoScu = null,
  maxContainerSizeKey = "",
  createdAt = new Date().toISOString(),
}) {
  const parseOptionalInteger = (value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
  };
  const parseOptionalDecimal = (value, decimals = 2) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      return null;
    }
    const factor = 10 ** decimals;
    return Math.round(numeric * factor) / factor;
  };

  const preset = SHIP_PRESETS[presetId] || null;
  const rows = clamp(Number(gridRows) || preset?.rows || 4, 2, MAX_GRID_ROWS);
  const cols = clamp(Number(gridCols) || preset?.cols || 4, 2, 12);
  const derivedHeights =
    gridHeights && typeof gridHeights === "object" && !Array.isArray(gridHeights)
      ? normalizeGridHeights(gridHeights, rows, cols)
      : deriveGridHeightsFromPresetLike({
          rows,
          cols,
          defaultHeight: preset?.defaultHeight || 1,
          blockedSlots: Array.isArray(gridBlockedSlots) ? gridBlockedSlots : preset?.blockedSlots || [],
          heightOverrides:
            gridHeightOverrides && typeof gridHeightOverrides === "object" && !Array.isArray(gridHeightOverrides)
              ? gridHeightOverrides
              : preset?.heightOverrides || {},
        });
  const derivedOverloadHeights =
    overloadGridHeights && typeof overloadGridHeights === "object" && !Array.isArray(overloadGridHeights)
      ? normalizeOverloadGridHeights(overloadGridHeights, derivedHeights, rows, cols)
      : {};
  const gridSummary = summarizeGridHeights(derivedHeights);
  const overloadSummary = summarizeGridHeights(derivedOverloadHeights);
  const totalSummary = summarizeGridHeights(mergeShipGridHeights(derivedHeights, derivedOverloadHeights));
  const levels = clamp(Number(gridLevels) || totalSummary.maxHeight || 1, 1, 8);
  const { blockedSlots, heightOverrides } = buildSlotMetadataFromHeights(derivedHeights, rows, cols);
  const parsedRefuelContainerCount = parseOptionalInteger(refuelContainerCount);
  const normalizedShipClass = normalizeShipClass(shipClass) || (parsedRefuelContainerCount ? "refuel" : "");

  return {
    id,
    manufacturer: String(manufacturer || "").trim(),
    model: String(model || "").trim(),
    variant: String(variant || "").trim(),
    imageUrl: normalizeShipImageUrl(imageUrl),
    shipClass: normalizedShipClass,
    cargoScu: gridSummary.totalScu || parseOptionalInteger(cargoScu),
    maxContainerSizeKey: normalizeMaxStandardContainerKey(maxContainerSizeKey),
    overloadScu: overloadSummary.totalScu,
    overloadedCargoScu: totalSummary.totalScu,
    priceAuec: parseOptionalInteger(priceAuec),
    hydrogenFuel: parseOptionalDecimal(hydrogenFuel, 2),
    quantumFuel: parseOptionalDecimal(quantumFuel, 2),
    refuelContainerCount: parsedRefuelContainerCount,
    hangarSize: String(hangarSize || "").trim(),
    presetId: SHIP_PRESETS[presetId] ? presetId : "",
    notes: String(notes || "").trim(),
    gridRows: rows,
    gridCols: cols,
    gridLevels: levels,
    gridHeights: derivedHeights,
    overloadGridHeights: derivedOverloadHeights,
    gridDefaultHeight: 1,
    gridBlockedSlots: blockedSlots,
    gridHeightOverrides: heightOverrides,
    createdAt,
  };
}

function normalizeShipImageUrl(value) {
  const normalized = String(value || "").trim().slice(0, 1000);
  if (!normalized || /[\u0000-\u001f]/.test(normalized)) return "";
  if (/^(?:data|javascript|vbscript|file):/i.test(normalized)) return "";
  return normalized;
}

function renderShipProfileMedia(entry, className = "") {
  const imageUrl = normalizeShipImageUrl(entry?.imageUrl);
  const shipName = entry ? formatShipEntryFullName(entry) : t("fleet.image.fallback");
  return `
    <div class="ship-profile-media${className ? ` ${escapeHtml(className)}` : ""}${imageUrl ? " has-image" : ""}">
      <span class="ship-profile-media-fallback" aria-hidden="true">
        <svg viewBox="0 0 64 40" focusable="false">
          <path d="M4 24.5 18 19l8-12h12l8 12 14 5.5-8 5.5H40l-3 5H27l-3-5H12l-8-5.5Zm24-5.5h8l-2-7h-4l-2 7Z" />
        </svg>
      </span>
      ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(shipName)}" loading="lazy" />` : ""}
    </div>
  `;
}

function bindShipProfileMedia(root = document) {
  root?.querySelectorAll?.(".ship-profile-media img").forEach((image) => {
    const media = image.closest(".ship-profile-media");
    const syncState = () => media?.classList.toggle("is-image-error", !image.complete || image.naturalWidth === 0);
    image.addEventListener("load", syncState, { once: true });
    image.addEventListener("error", syncState, { once: true });
    if (image.complete) syncState();
  });
}

function renderShipCardArt(entry) {
  return entry ? `<div class="ship-card-art" aria-hidden="true">${renderShipProfileMedia(entry, "ship-card-media")}</div>` : "";
}

function renderShipManufacturerOptions() {
  if (!shipDbManufacturerSelect) return;
  const selectedValue = shipDbManufacturerSelect.value;

  shipDbManufacturerSelect.innerHTML = `
    <option value="">${escapeHtml(t("shipdb.select.chooseManufacturer"))}</option>
    ${SHIP_MANUFACTURERS.map((manufacturer) => `<option value="${escapeHtml(manufacturer)}">${escapeHtml(manufacturer)}</option>`).join("")}
    <option value="__custom__">${escapeHtml(t("shipdb.select.customManufacturer"))}</option>
  `;
  if ([...shipDbManufacturerSelect.options].some((option) => option.value === selectedValue)) {
    shipDbManufacturerSelect.value = selectedValue;
  }
}

function syncShipManufacturerField() {
  if (!shipDbManufacturerSelect || !shipDbManufacturerCustomWrap || !shipDbManufacturerCustom) return;
  const isCustom = shipDbManufacturerSelect.value === "__custom__";
  shipDbManufacturerCustomWrap.hidden = !isCustom;
  shipDbManufacturerCustom.required = isCustom;
}

function getShipDbManufacturerValue() {
  if (!shipDbManufacturerSelect) return "";
  return shipDbManufacturerSelect.value === "__custom__"
    ? String(shipDbManufacturerCustom?.value || "").trim()
    : String(shipDbManufacturerSelect.value || "").trim();
}

function setShipBuilderState(nextState) {
  shipBuilderState = createShipBuilderState(nextState);
  syncShipBuilderInputs();
  renderShipGridBuilder();
}

function syncShipBuilderInputs() {
  if (shipDbGridRowsInput) shipDbGridRowsInput.value = String(shipBuilderState.rows);
  if (shipDbGridColsInput) shipDbGridColsInput.value = String(shipBuilderState.cols);
  if (shipDbGridLevelsInput) shipDbGridLevelsInput.value = String(shipBuilderState.levels);
}

function renderShipGridBuilder() {
  if (!shipDbGrid || !shipDbLevelTabs || !shipDbGridStats || !shipDbCargoScuValue) return;

  const officialSummary = summarizeGridHeights(shipBuilderState.heights);
  const overloadSummary = summarizeGridHeights(shipBuilderState.overloadHeights);
  const totalSummary = summarizeGridHeights(mergeShipGridHeights(shipBuilderState.heights, shipBuilderState.overloadHeights));
  const activeSummary = shipBuilderState.mode === "overload" ? overloadSummary : officialSummary;
  const maxContainerSizeKey = normalizeMaxStandardContainerKey(shipDbForm?.maxContainerSizeKey?.value);
  const totalContainerAutoProfile = getLargestSupportedStandardContainer(
    mergeShipGridHeights(shipBuilderState.heights, shipBuilderState.overloadHeights),
    shipBuilderState.rows,
    shipBuilderState.cols,
  );
  const totalContainerProfile = capStandardContainerProfile(totalContainerAutoProfile, maxContainerSizeKey);
  const noStandardContainer = t("shipdb.card.noStandardContainerLower");
  const autoContainerLabel = totalContainerAutoProfile?.label || noStandardContainer;
  const containerLimitLabel = totalContainerProfile?.label || noStandardContainer;
  const containerStatsValue = maxContainerSizeKey
    ? t("shipdb.grid.autoContainer", { limit: containerLimitLabel, auto: autoContainerLabel })
    : autoContainerLabel;

  if (shipDbCargoSummaryCard) {
    shipDbCargoSummaryCard.hidden = totalSummary.totalScu <= 0;
  }
  shipDbCargoScuValue.textContent = `${totalSummary.totalScu} SCU`;
  if (shipDbCargoOfficialValue) shipDbCargoOfficialValue.textContent = `${officialSummary.totalScu} SCU`;
  if (shipDbCargoOverloadValue) shipDbCargoOverloadValue.textContent = `${overloadSummary.totalScu} SCU`;

  if (shipDbGridMode) {
    shipDbGridMode.querySelectorAll("[data-shipdb-mode]").forEach((button) => {
      const isActive = button.dataset.shipdbMode === shipBuilderState.mode;
      button.classList.toggle("primary-button", isActive);
      button.classList.toggle("secondary-button", !isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  shipDbGridStats.innerHTML = [
    { label: t("shipdb.grid.mode"), value: shipBuilderState.mode === "overload" ? t("shipdb.grid.overload") : t("shipdb.grid.official") },
    { label: t("shipdb.grid.activeLevel"), value: t("shipdb.grid.level", { number: shipBuilderState.activeLevel }) },
    { label: t("shipdb.grid.activeFields"), value: `${activeSummary.occupiedSlots}` },
    { label: t("shipdb.grid.maxHeight"), value: `${activeSummary.maxHeight} SCU` },
    { label: t("shipdb.grid.official"), value: `${officialSummary.totalScu} SCU` },
    { label: t("shipdb.grid.total"), value: `${totalSummary.totalScu} SCU` },
    { label: t("shipdb.grid.maxContainer"), value: containerStatsValue },
  ]
    .map(
      (card) => `
        <div class="summary-card summary-card-compact">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
        </div>
      `,
    )
    .join("");

  shipDbLevelTabs.innerHTML = Array.from({ length: shipBuilderState.levels }, (_, index) => {
    const level = index + 1;
    const buttonClass = level === shipBuilderState.activeLevel ? "primary-button" : "secondary-button";
    return `<button type="button" class="${buttonClass} shipdb-level-tab" data-shipdb-level="${level}">${escapeHtml(t("shipdb.grid.level", { number: level }))}</button>`;
  }).join("");

  shipDbLevelTabs.querySelectorAll("[data-shipdb-level]").forEach((button) => {
    button.addEventListener("click", () => {
      shipBuilderState.activeLevel = clamp(Number(button.dataset.shipdbLevel) || 1, 1, shipBuilderState.levels);
      renderShipGridBuilder();
    });
  });

  shipDbGrid.style.gridTemplateColumns = `repeat(${shipBuilderState.cols}, 34px)`;
  shipDbGrid.innerHTML = "";

  for (let row = 0; row < shipBuilderState.rows; row += 1) {
    for (let col = 0; col < shipBuilderState.cols; col += 1) {
      const slotId = createSlotId(row, col);
      const baseHeight = getGridHeightAt(shipBuilderState.heights, row, col);
      const overloadHeight = getGridHeightAt(shipBuilderState.overloadHeights, row, col);
      const totalHeight = clamp(baseHeight + overloadHeight, 0, 8);
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "shipdb-grid-cell";
      cell.dataset.slotId = slotId;
      cell.setAttribute("aria-label", `${cell.dataset.slotId}, Ebene ${shipBuilderState.activeLevel}`);

      if (shipBuilderState.mode === "overload") {
        if (shipBuilderState.activeLevel <= baseHeight) {
          cell.classList.add("is-locked-base");
        } else if (shipBuilderState.activeLevel <= totalHeight) {
          cell.classList.add("is-overload-filled");
        } else if (overloadHeight > 0) {
          cell.classList.add("is-overload-supported", "is-empty-on-top");
        } else if (baseHeight > 0) {
          cell.classList.add("is-locked-base");
        }
      } else if (shipBuilderState.activeLevel <= baseHeight) {
        cell.classList.add("is-filled");
      } else if (baseHeight > 0) {
        cell.classList.add("is-supported", "is-empty-on-top");
      }

      cell.textContent = totalHeight > 0 ? String(totalHeight) : "";

      cell.addEventListener("click", () => {
        toggleShipBuilderCell(row, col);
      });
      shipDbGrid.appendChild(cell);
    }
  }

  renderShipBuilderIsoPreview();
}

function renderShipBuilderIsoPreview() {
  if (!shipDbIsoPreview || !shipDbIsoEmpty || !shipDbIsoStats) return;

  const officialSummary = summarizeGridHeights(shipBuilderState.heights);
  const overloadSummary = summarizeGridHeights(shipBuilderState.overloadHeights);
  const mergedHeights = mergeShipGridHeights(shipBuilderState.heights, shipBuilderState.overloadHeights);
  const totalSummary = summarizeGridHeights(mergedHeights);
  shipDbIsoStats.innerHTML = [
    { label: t("shipdb.grid.official"), value: `${officialSummary.totalScu} SCU` },
    { label: t("shipdb.grid.overload"), value: `${overloadSummary.totalScu} SCU` },
    { label: t("shipdb.grid.total"), value: `${totalSummary.totalScu} SCU` },
  ]
    .map(
      (card) => `
        <div class="summary-card summary-card-compact">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(String(card.value))}</strong>
        </div>
      `,
    )
    .join("");

  const occupiedBaseCells = [];
  const occupiedVoxels = new Set();
  Object.entries(mergedHeights).forEach(([slotId, height]) => {
    const position = slotIdToPosition(slotId);
    if (!position || height <= 0) return;
    const baseHeight = getGridHeightAt(shipBuilderState.heights, position.row, position.col);
    const overloadHeight = getGridHeightAt(shipBuilderState.overloadHeights, position.row, position.col);
    occupiedBaseCells.push({
      row: position.row,
      col: position.col,
      height,
      baseHeight,
      overloadHeight,
      kind: baseHeight <= 0 && overloadHeight > 0 ? "overload" : "base",
    });
    for (let z = 0; z < height; z += 1) {
      occupiedVoxels.add(getIsoVoxelKey(position.col, position.row, z));
    }
  });

  if (occupiedBaseCells.length === 0) {
    shipDbIsoPreview.innerHTML = "";
    shipDbIsoPreview.hidden = true;
    shipDbIsoEmpty.hidden = false;
    shipDbIsoEmpty.textContent = t("shipdb.grid.isoEmpty");
    return;
  }

  shipDbIsoEmpty.hidden = true;
  shipDbIsoPreview.hidden = false;

  const sizeScale = clamp(18 / Math.max(shipBuilderState.rows, shipBuilderState.cols, 8), 0.78, 1.18);
  const tileWidth = 52 * sizeScale;
  const tileHeight = 26 * sizeScale;
  const levelHeight = 18 * sizeScale;
  const originX = 0;
  const originY = totalSummary.maxHeight * levelHeight + 28 * sizeScale;

  const allPoints = [];
  occupiedBaseCells.forEach((cell) => {
    allPoints.push(
      projectIso(cell.col, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col + 1, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col + 1, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      projectIso(cell.col + 1, cell.row + 1, cell.height, originX, originY, tileWidth, tileHeight, levelHeight),
    );
  });

  const bugLabelPoint = projectIso(0, -1.6, 0, originX, originY, tileWidth, tileHeight, levelHeight);
  const heckLabelPoint = projectIso(0, shipBuilderState.rows + 1.1, 0, originX, originY, tileWidth, tileHeight, levelHeight);
  allPoints.push(
    { x: bugLabelPoint.x, y: bugLabelPoint.y - 24 * sizeScale },
    { x: heckLabelPoint.x, y: heckLabelPoint.y + 18 * sizeScale },
  );

  const minX = Math.min(...allPoints.map((point) => point.x));
  const maxX = Math.max(...allPoints.map((point) => point.x));
  const minY = Math.min(...allPoints.map((point) => point.y));
  const maxY = Math.max(...allPoints.map((point) => point.y));
  const paddingX = 44 * sizeScale;
  const paddingTop = 40 * sizeScale;
  const paddingBottom = 54 * sizeScale;

  shipDbIsoPreview.setAttribute(
    "viewBox",
    `${minX - paddingX} ${minY - paddingTop} ${maxX - minX + paddingX * 2} ${maxY - minY + paddingTop + paddingBottom}`,
  );
  shipDbIsoPreview.setAttribute("preserveAspectRatio", "xMidYMid meet");
  shipDbIsoPreview.innerHTML = "";

  const svgNamespace = "http://www.w3.org/2000/svg";
  const floorGroup = document.createElementNS(svgNamespace, "g");
  floorGroup.setAttribute("class", "iso-floor-group");
  occupiedBaseCells
    .sort((left, right) => left.row + left.col - (right.row + right.col))
    .forEach((cell) => {
      const corners = [
        projectIso(cell.col, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
        projectIso(cell.col + 1, cell.row, 0, originX, originY, tileWidth, tileHeight, levelHeight),
        projectIso(cell.col + 1, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
        projectIso(cell.col, cell.row + 1, 0, originX, originY, tileWidth, tileHeight, levelHeight),
      ];
      const polygon = document.createElementNS(svgNamespace, "polygon");
      polygon.setAttribute("class", `iso-floor${cell.kind === "overload" ? " is-overload" : ""}`);
      polygon.setAttribute("points", pointsToString(corners));
      floorGroup.appendChild(polygon);
    });
  shipDbIsoPreview.appendChild(floorGroup);

  const cubeGroup = document.createElementNS(svgNamespace, "g");
  cubeGroup.setAttribute("class", "iso-load");
  const faceFragments = [];
  const faceOrder = { left: 0, right: 1, front: 2, top: 3 };

  const appendFace = (type, fill, points, cellX, cellY, cellZ) => {
    const polygon = document.createElementNS(svgNamespace, "polygon");
    polygon.setAttribute("class", `iso-face iso-face-${type}`);
    polygon.setAttribute("fill", fill);
    polygon.setAttribute("points", pointsToString(points));
    faceFragments.push({
      type,
      polygon,
      row: cellY,
      col: cellX,
      z: cellZ,
      depth: cellY + cellX,
    });
  };

  occupiedBaseCells.forEach((cell) => {
    for (let z = 0; z < cell.height; z += 1) {
      const x = cell.col;
      const y = cell.row;
      const color = z >= cell.baseHeight ? SHIP_BUILDER_OVERLOAD_COLOR : SHIP_BUILDER_BASE_COLOR;

      if (!occupiedVoxels.has(getIsoVoxelKey(x, y, z + 1))) {
        appendFace(
          "top",
          shadeColor(color, 14),
          [
            projectIso(x, y, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y + 1, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x, y + 1, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
          ],
          x,
          y,
          z + 1,
        );
      }

      if (!occupiedVoxels.has(getIsoVoxelKey(x - 1, y, z))) {
        appendFace(
          "left",
          shadeColor(color, -18),
          [
            projectIso(x, y, z, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x, y + 1, z, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x, y + 1, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x, y, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
          ],
          x,
          y,
          z,
        );
      }

      if (!occupiedVoxels.has(getIsoVoxelKey(x + 1, y, z))) {
        appendFace(
          "right",
          shadeColor(color, -8),
          [
            projectIso(x + 1, y, z, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y + 1, z, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y + 1, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
          ],
          x,
          y,
          z,
        );
      }

      if (!occupiedVoxels.has(getIsoVoxelKey(x, y + 1, z))) {
        appendFace(
          "front",
          shadeColor(color, -12),
          [
            projectIso(x, y + 1, z, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y + 1, z, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x + 1, y + 1, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
            projectIso(x, y + 1, z + 1, originX, originY, tileWidth, tileHeight, levelHeight),
          ],
          x,
          y,
          z,
        );
      }
    }
  });

  faceFragments
    .sort((left, right) => {
      if (left.depth !== right.depth) return left.depth - right.depth;
      if (left.z !== right.z) return left.z - right.z;
      if (left.row !== right.row) return left.row - right.row;
      if (left.col !== right.col) return left.col - right.col;
      return faceOrder[left.type] - faceOrder[right.type];
    })
    .forEach((fragment) => {
      cubeGroup.appendChild(fragment.polygon);
    });
  shipDbIsoPreview.appendChild(cubeGroup);

  const axisGroup = document.createElementNS(svgNamespace, "g");
  axisGroup.setAttribute("class", "iso-axis-group");
  axisGroup.appendChild(createSvgText(svgNamespace, bugLabelPoint.x, bugLabelPoint.y - 8, "iso-axis-label", t("contracts.load.front")));
  axisGroup.appendChild(createSvgText(svgNamespace, heckLabelPoint.x, heckLabelPoint.y + 10, "iso-axis-label", t("contracts.load.rear")));
  shipDbIsoPreview.appendChild(axisGroup);
}

function toggleShipBuilderCell(row, col) {
  const slotId = createSlotId(row, col);
  if (shipBuilderState.mode === "overload") {
    const baseHeight = getGridHeightAt(shipBuilderState.heights, row, col);
    const currentHeight = getGridHeightAt(shipBuilderState.overloadHeights, row, col);
    const nextOverloadHeights = { ...shipBuilderState.overloadHeights };

    if (shipBuilderState.activeLevel <= baseHeight + currentHeight) {
      const nextHeight = Math.max(0, shipBuilderState.activeLevel - baseHeight - 1);
      if (nextHeight <= 0) {
        delete nextOverloadHeights[slotId];
      } else {
        nextOverloadHeights[slotId] = nextHeight;
      }
    } else {
      nextOverloadHeights[slotId] = Math.max(0, shipBuilderState.activeLevel - baseHeight);
    }
    setShipBuilderState({
      ...shipBuilderState,
      overloadHeights: nextOverloadHeights,
    });
    return;
  }

  const currentHeight = getGridHeightAt(shipBuilderState.heights, row, col);
  const nextHeights = { ...shipBuilderState.heights };
  if (shipBuilderState.activeLevel <= currentHeight) {
    const nextHeight = shipBuilderState.activeLevel - 1;
    if (nextHeight <= 0) {
      delete nextHeights[slotId];
    } else {
      nextHeights[slotId] = nextHeight;
    }
  } else {
    nextHeights[slotId] = shipBuilderState.activeLevel;
  }
  setShipBuilderState({
    ...shipBuilderState,
    heights: nextHeights,
    overloadHeights: normalizeOverloadGridHeights(shipBuilderState.overloadHeights, nextHeights, shipBuilderState.rows, shipBuilderState.cols),
  });
}

function clearShipBuilderLevel(level = shipBuilderState.activeLevel) {
  const key = shipBuilderState.mode === "overload" ? "overloadHeights" : "heights";
  const nextHeights = { ...shipBuilderState[key] };
  Object.entries(nextHeights).forEach(([slotId, height]) => {
    if (shipBuilderState.mode === "overload") {
      const position = slotIdToPosition(slotId);
      if (!position) return;
      const baseHeight = getGridHeightAt(shipBuilderState.heights, position.row, position.col);
      const totalHeight = baseHeight + height;
      if (totalHeight < level) return;
      const nextHeight = Math.max(0, level - 1 - baseHeight);
      if (nextHeight <= 0) {
        delete nextHeights[slotId];
      } else {
        nextHeights[slotId] = nextHeight;
      }
      return;
    }
    if (height < level) return;
    if (level <= 1) {
      delete nextHeights[slotId];
      return;
    }
    nextHeights[slotId] = level - 1;
  });

  setShipBuilderState({
    ...shipBuilderState,
    [key]: nextHeights,
  });
}

function clearShipBuilderAll() {
  setShipBuilderState({
    ...shipBuilderState,
    [shipBuilderState.mode === "overload" ? "overloadHeights" : "heights"]: {},
  });
}

function buildShipBuilderStateFromPreset(presetId) {
  const preset = SHIP_PRESETS[presetId];
  if (!preset) {
    return createShipBuilderState();
  }

  const heights = deriveGridHeightsFromPresetLike({
    rows: preset.rows,
    cols: preset.cols,
    defaultHeight: preset.defaultHeight,
    blockedSlots: preset.blockedSlots,
    heightOverrides: preset.heightOverrides,
  });

  return createShipBuilderState({
    rows: preset.rows,
    cols: preset.cols,
    levels: summarizeGridHeights(heights).maxHeight,
    activeLevel: 1,
    heights,
    overloadHeights: {},
    mode: "base",
  });
}

function renderFleetPresetOptions(preferredShipId = fleetPresetSelect?.value || "", preferredManufacturer = fleetManufacturerSelect?.value || "") {
  const ships = getShipLibraryEntries()
    .sort((left, right) => {
      const leftOrder = PRESET_ORDER[left.manufacturer] ?? 999;
      const rightOrder = PRESET_ORDER[right.manufacturer] ?? 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const manufacturerOrder = left.manufacturer.localeCompare(right.manufacturer, "de");
      if (manufacturerOrder !== 0) return manufacturerOrder;
      return getShipEntryDisplayName(left).localeCompare(getShipEntryDisplayName(right), "de");
    });

  const manufacturers = [...new Set(ships.map((ship) => ship.manufacturer).filter(Boolean))];
  const selectedShip = preferredShipId ? ships.find((ship) => ship.id === preferredShipId) || null : null;
  const activeManufacturer = selectedShip?.manufacturer
    || (manufacturers.includes(preferredManufacturer) ? preferredManufacturer : "");

  if (fleetManufacturerSelect) {
    fleetManufacturerSelect.innerHTML = `
      <option value="">${escapeHtml(manufacturers.length === 0 ? t("shipdb.select.createShipsFirst") : t("shipdb.select.chooseManufacturer"))}</option>
      ${manufacturers.map((manufacturer) => `<option value="${escapeHtml(manufacturer)}">${escapeHtml(manufacturer)}</option>`).join("")}
    `;
    fleetManufacturerSelect.disabled = manufacturers.length === 0;
    if (activeManufacturer) {
      fleetManufacturerSelect.value = activeManufacturer;
    }
  }

  const visibleShips = activeManufacturer
    ? ships.filter((ship) => ship.manufacturer === activeManufacturer)
    : [];

  fleetPresetSelect.innerHTML = `
    <option value="">${escapeHtml(activeManufacturer ? t("shipdb.select.chooseModel") : t("shipdb.select.chooseManufacturerFirst"))}</option>
    ${visibleShips
      .map((ship) => `<option value="${ship.id}">${escapeHtml(getShipEntryDisplayName(ship))}</option>`)
      .join("")}
  `;
  fleetPresetSelect.disabled = visibleShips.length === 0;

  if (selectedShip && visibleShips.some((ship) => ship.id === selectedShip.id)) {
    fleetPresetSelect.value = selectedShip.id;
  }
}

function renderShipDbPresetOptions() {
  if (!shipDbPresetSelect || shipDbPresetSelect.tagName !== "SELECT") return;
  const presets = Object.values(SHIP_PRESETS)
    .filter((preset) => preset.id !== "custom")
    .sort((left, right) => {
      const leftOrder = PRESET_ORDER[left.manufacturer] ?? 999;
      const rightOrder = PRESET_ORDER[right.manufacturer] ?? 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.name.localeCompare(right.name, "de");
    });

  shipDbPresetSelect.innerHTML = `
    <option value="">${escapeHtml(t("shipdb.select.noGridTemplate"))}</option>
    ${presets
      .map((preset) => `<option value="${preset.id}">${escapeHtml(formatPresetDisplayName(preset))}</option>`)
      .join("")}
  `;
}

function getDefaultShipLibraryEntries() {
  return Object.values(SHIP_PRESETS)
    .filter((preset) => preset.id !== "custom")
    .map((preset) =>
      createShipLibraryEntry({
        id: `ship:${preset.id}`,
        manufacturer: preset.manufacturer,
        model: preset.name,
        cargoScu: preset.cargoScu,
        presetId: preset.id,
        notes: preset.description,
        gridRows: preset.rows,
        gridCols: preset.cols,
        gridLevels: preset.defaultHeight,
        gridBlockedSlots: preset.blockedSlots,
        gridHeightOverrides: preset.heightOverrides,
      }),
    );
}

function getFleetEntries() {
  return [...state.fleet].sort((left, right) => {
    if ((left.status === "active") !== (right.status === "active")) {
      return left.status === "active" ? -1 : 1;
    }
    return compareDateInputs(right.acquiredOn, left.acquiredOn);
  });
}

function getFleetStatusLabel(status) {
  if (Object.prototype.hasOwnProperty.call(FLEET_STATUS_LABELS, status)) {
    return t(`fleet.status.${status}`);
  }
  return t("fleet.status.active");
}

function getShipLibraryEntries() {
  return [...state.shipLibrary].sort((left, right) => {
    const leftOrder = PRESET_ORDER[left.manufacturer] ?? 999;
    const rightOrder = PRESET_ORDER[right.manufacturer] ?? 999;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    const manufacturerCompare = left.manufacturer.localeCompare(right.manufacturer, "de");
    if (manufacturerCompare !== 0) return manufacturerCompare;
    const modelCompare = left.model.localeCompare(right.model, "de");
    if (modelCompare !== 0) return modelCompare;
    return left.variant.localeCompare(right.variant, "de");
  });
}

function findShipLibraryEntryById(shipId) {
  return getShipLibraryEntries().find((entry) => entry.id === shipId) || null;
}

function findShipLibraryEntryForFleetEntry(entry) {
  if (!entry) return null;
  if (entry.shipId) {
    const linkedShip = findShipLibraryEntryById(entry.shipId);
    if (linkedShip) return linkedShip;
  }

  return getShipLibraryEntries().find(
    (candidate) =>
      candidate.manufacturer === entry.manufacturer
      && getShipEntryDisplayName(candidate) === entry.model,
  ) || null;
}

function findShipLibraryEntryByPresetId(presetId) {
  return getShipLibraryEntries().find((entry) => entry.presetId === presetId) || null;
}

function getShipEntryDisplayName(entry) {
  return `${entry.model}${entry.variant ? ` ${entry.variant}` : ""}`;
}

function formatShipEntryFullName(entry) {
  const displayName = getShipEntryDisplayName(entry);
  return entry.manufacturer ? `${entry.manufacturer} ${displayName}` : displayName;
}

function formatHangarSize(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return "";
  const key = `hangar.${normalized}`;
  return t(key) !== key ? t(key) : HANGAR_SIZE_LABELS[normalized] || String(value || "").trim();
}

function getShipGridDefinition(entry, overloadMode = false) {
  if (!entry) {
    return {
      ...SHIP_PRESETS.custom,
      officialCargoScu: SHIP_PRESETS.custom.cargoScu || 0,
      overloadCargoScu: 0,
      totalCargoScu: SHIP_PRESETS.custom.cargoScu || 0,
      overloadMode,
      overloadSlotIds: [],
    };
  }

  const officialHeights = normalizeGridHeights(entry.gridHeights || {}, entry.gridRows, entry.gridCols);
  const overloadHeights = normalizeOverloadGridHeights(
    entry.overloadGridHeights || {},
    officialHeights,
    entry.gridRows,
    entry.gridCols,
  );
  const mergedHeights = overloadMode ? mergeShipGridHeights(officialHeights, overloadHeights) : officialHeights;
  const summary = getShipGridSummary(entry);
  const slotMetadata = buildSlotMetadataFromHeights(mergedHeights, entry.gridRows, entry.gridCols);

  return {
    id: entry.id,
    manufacturer: entry.manufacturer,
    name: getShipEntryDisplayName(entry),
    description: entry.notes || t("shipdb.description.empty"),
    cargoScu: summary.official.totalScu,
    officialCargoScu: summary.official.totalScu,
    overloadCargoScu: summary.overload.totalScu,
    totalCargoScu: overloadMode ? summary.total.totalScu : summary.official.totalScu,
    rows: entry.gridRows,
    cols: entry.gridCols,
    defaultHeight: 1,
    blockedSlots: [...slotMetadata.blockedSlots],
    heightOverrides: { ...slotMetadata.heightOverrides },
    overloadMode,
    overloadSlotIds: overloadMode ? Object.keys(overloadHeights) : [],
  };
}

function getShipDatabaseSubline(entry) {
  const { official, overload, total } = getShipGridSummary(entry);
  const parts = [];
  if (official.totalScu) {
    parts.push(
      overload.totalScu > 0
        ? t("shipdb.subline.officialOverload", { official: official.totalScu, total: total.totalScu })
        : `${official.totalScu} SCU`,
    );
  } else {
    parts.push(t("shipdb.card.noCargoGrid"));
  }
  if (entry.hangarSize) parts.push(t("shipdb.subline.hangar", { value: formatHangarSize(entry.hangarSize) }));
  if (official.totalScu || overload.totalScu) {
    parts.push(t("shipdb.subline.grid", { rows: entry.gridRows, cols: entry.gridCols, levels: total.maxHeight }));
  }
  if (entry.priceAuec) parts.push(`${entry.priceAuec.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC`);
  if (overload.totalScu > 0) parts.push(t("shipdb.subline.overload", { value: overload.totalScu }));
  return parts.join(" · ") || t("shipdb.subline.empty");
}

function normalizeDateInput(value) {
  if (!value) return "";
  const text = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parseDateInput(value) {
  const normalized = normalizeDateInput(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function compareDateInputs(left, right) {
  const leftDate = parseDateInput(left);
  const rightDate = parseDateInput(right);
  if (!leftDate && !rightDate) return 0;
  if (!leftDate) return -1;
  if (!rightDate) return 1;
  return leftDate - rightDate;
}

function formatDateDisplay(value) {
  const date = parseDateInput(value);
  if (!date) return t("common.open");
  return date.toLocaleDateString(currentUiLanguage() === "en" ? "en-US" : "de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatDateTimeDisplay(value) {
  if (!value) return t("common.open");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.open");
  return date.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateForInput(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function renderPresetOptions() {
  const grouped = new Map();

  getCargoFleetEntries()
    .sort((left, right) => {
      const leftOrder = PRESET_ORDER[left.manufacturer] ?? 999;
      const rightOrder = PRESET_ORDER[right.manufacturer] ?? 999;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const manufacturerOrder = left.manufacturer.localeCompare(right.manufacturer, "de");
      if (manufacturerOrder !== 0) return manufacturerOrder;
      return left.model.localeCompare(right.model, "de");
    })
    .forEach((entry) => {
      const manufacturer = entry.manufacturer || "Andere";
      const bucket = grouped.get(manufacturer) ?? [];
      bucket.push(entry);
      grouped.set(manufacturer, bucket);
    });

  const customOption = '<option value="custom">Freies Frachtgitter</option>';

  if (grouped.size === 0) {
    presetSelect.innerHTML = customOption;
    return;
  }

  const groupedMarkup = Array.from(grouped.entries())
    .map(
      ([manufacturer, entries]) => `
        <optgroup label="${escapeHtml(manufacturer)}">
          ${entries
            .map(
              (entry) => {
                const shipType = findShipLibraryEntryById(entry.shipId);
                const registration = ` · ${formatFleetRegistration(entry)}`;
                const summary = shipType ? getShipGridSummary(shipType) : null;
                const capacity = summary?.official.totalScu ? ` · ${summary.official.totalScu} SCU` : "";
                const normalOption = `<option value="${encodeFleetPresetValue(entry.id, false)}">${escapeHtml(entry.model)}${escapeHtml(registration)}${capacity}</option>`;
                if (!summary || summary.overload.totalScu <= 0) {
                  return normalOption;
                }
                const overloadLabel = `${entry.model}${registration} · ${summary.total.totalScu} SCU · Überladen`;
                return `${normalOption}<option value="${encodeFleetPresetValue(entry.id, true)}">${escapeHtml(overloadLabel)}</option>`;
              },
            )
            .join("")}
        </optgroup>
      `,
    )
    .join("");

  presetSelect.innerHTML = `${customOption}${groupedMarkup}`;
}

function applyLayoutDefinition(preset, fleetEntryId = state.layout.fleetEntryId, shipId = state.layout.shipId, overloadMode = false) {
  state.layout.shipId = shipId || "";
  state.layout.fleetEntryId = fleetEntryId || "";
  state.layout.presetId = shipId || preset.id;
  state.layout.rows = preset.rows;
  state.layout.cols = preset.cols;
  state.layout.defaultHeight = preset.defaultHeight;
  state.layout.blockedSlots = [...preset.blockedSlots];
  state.layout.heightOverrides = { ...preset.heightOverrides };
  state.layout.overloadMode = Boolean(overloadMode);
  state.layout.overloadSlotIds = [...(preset.overloadSlotIds || [])];
}

function syncLayoutInputs() {
  const availableShips = getCargoFleetEntries();
  const manual = state.layout.presetId === "custom";
  layoutForm.rows.value = state.layout.rows;
  layoutForm.cols.value = state.layout.cols;
  layoutForm.cellHeight.value = state.layout.defaultHeight;
  presetSelect.value = manual
    ? "custom"
    : availableShips.some((entry) => entry.id === state.layout.fleetEntryId)
      ? encodeFleetPresetValue(state.layout.fleetEntryId, state.layout.overloadMode)
      : "custom";

  layoutForm.classList.toggle("is-manual", manual);
  layoutForm.rows.disabled = !manual;
  layoutForm.cols.disabled = !manual;
  layoutForm.cellHeight.disabled = !manual;
  presetSelect.disabled = false;
  const submitButton = layoutForm.querySelector('button[type="submit"]');
  if (submitButton) {
    submitButton.disabled = false;
  }

  if (layoutMetricsMode) {
    layoutMetricsMode.textContent = manual ? "Freies Frachtgitter" : "Presetwerte";
  }
  if (layoutRowsValue) {
    layoutRowsValue.textContent = String(state.layout.rows);
  }
  if (layoutColsValue) {
    layoutColsValue.textContent = String(state.layout.cols);
  }
  if (layoutHeightValue) {
    layoutHeightValue.textContent = String(state.layout.defaultHeight);
  }
}

function currentPreset() {
  const fleetShip = currentFleetShip();
  if (fleetShip?.shipId) {
    return getShipGridDefinition(findShipLibraryEntryById(fleetShip.shipId), state.layout.overloadMode);
  }

  if (state.layout.shipId) {
    const ship = findShipLibraryEntryById(state.layout.shipId);
    if (ship) {
      return getShipGridDefinition(ship, state.layout.overloadMode);
    }
  }

  return SHIP_PRESETS[state.layout.presetId] || SHIP_PRESETS.custom;
}

function formatPresetDisplayName(preset) {
  if (!preset) return "";
  if ("model" in preset) {
    return formatShipEntryFullName(preset);
  }
  return preset.manufacturer ? `${preset.manufacturer} ${preset.name}` : preset.name;
}

function formatPlannerShipName(fleetShip, preset = currentPreset()) {
  if (fleetShip) {
    return `${fleetShip.manufacturer} ${fleetShip.model} · ${formatFleetRegistration(fleetShip)}${state.layout.overloadMode ? " · Überladen" : ""}`;
  }
  return preset.id === "custom"
    ? "Freies Frachtgitter"
    : `${formatPresetDisplayName(preset) || "Kein Flottenschiff ausgewählt"}${preset.overloadMode ? " · Überladen" : ""}`;
}

function renderCreateDraftSummary() {
  if (!createDraftSummary) return;
  renderCreateShipIndicator();
  const activeEntry = currentActiveFleetEntry();
  const activeShipCard = isDispatcherMode()
    ? {
        label: t("contracts.draft.assignment"),
        value: t("contracts.draft.unassigned"),
        detail: t("contracts.draft.assignLater"),
      }
    : activeEntry
      ? {
          label: t("contracts.draft.ship"),
          value: `${activeEntry.manufacturer} ${activeEntry.model}`.trim(),
          detail: formatFleetRegistration(activeEntry),
        }
      : {
          label: t("contracts.draft.ship"),
          value: t("contracts.draft.noActiveShip"),
          detail: t("contracts.form.chooseFleet"),
      };

  if (getSelectedMissionType() === "courier") {
    const formData = new FormData(missionForm);
    const packages = collectCourierPackages();
    const customer = String(formData.get("courierCustomer") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const pickups = new Set(packages.map((entry) => entry.pickup).filter(Boolean));
    const destinations = new Set(packages.map((entry) => entry.destination).filter(Boolean));
    const pickupSummary = pickups.size === 1
      ? [...pickups][0]
      : pickups.size > 1 ? t("contracts.draft.locationCount", { count: pickups.size }) : t("contracts.draft.open");
    const destinationSummary = destinations.size === 1
      ? [...destinations][0]
      : destinations.size > 1 ? t("contracts.draft.locationCount", { count: destinations.size }) : t("contracts.draft.open");
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("courier") },
      activeShipCard,
      { label: t("contracts.form.courierPackages"), value: t("contracts.courier.packageCount", { count: packages.reduce((sum, entry) => sum + entry.quantity, 0) }) },
      { label: t("contracts.form.pickupLocation"), value: pickupSummary },
      { label: t("contracts.form.deliveryLocation"), value: destinationSummary },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];
    createDraftSummary.innerHTML = cards.map((card) => `
      <div class="summary-card summary-card-compact">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
      </div>
    `).join("");
    return;
  }

  if (getSelectedMissionType() === "delivery") {
    const formData = new FormData(missionForm);
    const items = collectDeliveryItems();
    const customer = String(formData.get("deliveryCustomer") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const pickups = new Set(items.map((entry) => entry.pickup).filter(Boolean));
    const destinations = new Set(items.map((entry) => entry.destination).filter(Boolean));
    const pickupSummary = pickups.size === 1
      ? [...pickups][0]
      : pickups.size > 1 ? t("contracts.draft.locationCount", { count: pickups.size }) : t("contracts.draft.open");
    const destinationSummary = destinations.size === 1
      ? [...destinations][0]
      : destinations.size > 1 ? t("contracts.draft.locationCount", { count: destinations.size }) : t("contracts.draft.open");
    const cargoScu = items.reduce((sum, entry) => sum + (Number(entry.containerScu) || 0) * entry.quantity, 0);
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("delivery") },
      activeShipCard,
      { label: t("contracts.form.deliveryItems"), value: t("contracts.delivery.itemCount", { count: items.reduce((sum, entry) => sum + entry.quantity, 0) }) },
      { label: t("contracts.form.pickupLocation"), value: pickupSummary },
      { label: t("contracts.form.deliveryLocation"), value: destinationSummary },
      { label: t("contracts.draft.capacity"), value: cargoScu > 0 ? formatScuAmount(cargoScu) : t("contracts.delivery.handPackage") },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];
    createDraftSummary.innerHTML = cards.map((card) => `
      <div class="summary-card summary-card-compact">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
      </div>
    `).join("");
    return;
  }

  if (getSelectedMissionType() === "refuel") {
    const formData = new FormData(missionForm);
    const serviceType = normalizeRefuelServiceType(formData.get("refuelServiceType"));
    const hydrogenAmount = parseMissionDecimal(formData.get("refuelHydrogenAmount"));
    const quantumAmount = parseMissionDecimal(formData.get("refuelQuantumAmount"));
    const location = String(formData.get("refuelLocation") || "").trim();
    const customer = String(formData.get("refuelCustomer") || "").trim();
    const targetVehicle = String(formData.get("refuelTargetVehicle") || "").trim();
    const hydrogenRate = parseMissionDecimal(formData.get("refuelHydrogenRate"));
    const quantumRate = parseMissionDecimal(formData.get("refuelQuantumRate"));
    const bonus = String(formData.get("refuelBonus") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("refuel") },
      { label: t("contracts.form.service"), value: getRefuelServiceLabel(serviceType) },
      activeShipCard,
      { label: t("contracts.draft.location"), value: location || t("contracts.draft.open") },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      { label: t("contracts.form.targetVehicle"), value: targetVehicle || t("common.notSpecified") },
      { label: "Hydrogen", value: hydrogenAmount === null ? t("common.notSpecified") : formatScuAmount(hydrogenAmount) },
      { label: "Quantum", value: quantumAmount === null ? t("common.notSpecified") : formatScuAmount(quantumAmount) },
      { label: t("contracts.form.hydrogenRate"), value: hydrogenRate === null ? t("common.notSpecified") : `${hydrogenRate.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC/SCU` },
      { label: t("contracts.form.quantumRate"), value: quantumRate === null ? t("common.notSpecified") : `${quantumRate.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC/SCU` },
      ...(bonus ? [{ label: t("contracts.form.additionalCompensation"), value: bonus }] : []),
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];

    createDraftSummary.innerHTML = cards
      .map(
        (card) => `
          <div class="summary-card summary-card-compact">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(String(card.value))}</strong>
            ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
          </div>
        `,
      )
      .join("");
    return;
  }

  if (getSelectedMissionType() === "investigation") {
    const formData = new FormData(missionForm);
    const location = String(formData.get("investigationLocation") || "").trim();
    const customer = String(formData.get("investigationCustomer") || "").trim();
    const subject = String(formData.get("investigationSubject") || "").trim();
    const caseNumber = String(formData.get("investigationCaseNumber") || "").trim();
    const leadInvestigator = String(formData.get("investigationLead") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("investigation") },
      activeShipCard,
      { label: t("contracts.draft.location"), value: location || t("contracts.draft.open") },
      { label: t("contracts.form.subject"), value: subject || t("common.notSpecified") },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      ...(caseNumber ? [{ label: t("contracts.form.caseNumber"), value: caseNumber }] : []),
      ...(leadInvestigator ? [{ label: t("contracts.form.leadInvestigator"), value: leadInvestigator }] : []),
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];

    createDraftSummary.innerHTML = cards
      .map(
        (card) => `
          <div class="summary-card summary-card-compact">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(String(card.value))}</strong>
            ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
          </div>
        `,
      )
      .join("");
    return;
  }

  if (getSelectedMissionType() === "salvage") {
    const formData = new FormData(missionForm);
    const location = String(formData.get("salvageLocation") || "").trim();
    const customer = String(formData.get("salvageCustomer") || "").trim();
    const salvageTarget = String(formData.get("salvageTarget") || "").trim();
    const claimNumber = String(formData.get("salvageClaimNumber") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("salvage") },
      activeShipCard,
      { label: t("contracts.draft.location"), value: location || t("contracts.draft.open") },
      { label: t("contracts.form.salvageTarget"), value: salvageTarget || t("common.notSpecified") },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      ...(claimNumber ? [{ label: t("contracts.form.claimNumber"), value: claimNumber }] : []),
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];

    createDraftSummary.innerHTML = cards
      .map(
        (card) => `
          <div class="summary-card summary-card-compact">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(String(card.value))}</strong>
            ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
          </div>
        `,
      )
      .join("");
    return;
  }

  if (getSelectedMissionType() === "procurement") {
    const formData = new FormData(missionForm);
    const location = String(formData.get("procurementLocation") || "").trim();
    const customer = String(formData.get("procurementCustomer") || "").trim();
    const items = collectProcurementItems(location);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("procurement") },
      activeShipCard,
      { label: t("contracts.form.procurementItems"), value: items.length ? `${items.length} · ${itemCount} gesamt` : t("contracts.draft.open") },
      { label: t("contracts.form.deliveryLocation"), value: location || t("contracts.draft.open") },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : "0 aUEC" },
    ];
    createDraftSummary.innerHTML = cards.map((card) => `
      <div class="summary-card summary-card-compact">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
        ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
      </div>
    `).join("");
    return;
  }

  if (getSelectedMissionType() === "mining") {
    const formData = new FormData(missionForm);
    const method = String(formData.get("miningMethod") || "hand") === "ship" ? "ship" : "hand";
    const searchArea = String(formData.get("miningSearchArea") || "").trim();
    const location = String(formData.get("miningLocation") || "").trim();
    const material = String(formData.get("miningMaterial") || "").trim();
    const customer = String(formData.get("miningCustomer") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("mining") },
      { label: t("contracts.form.miningMethod"), value: t(`contracts.form.miningMethod${method === "ship" ? "Ship" : "Hand"}`) },
      activeShipCard,
      { label: t("contracts.form.searchArea"), value: searchArea || t("contracts.draft.open") },
      { label: t("contracts.form.deliveryLocation"), value: location || t("contracts.draft.open") },
      { label: t("contracts.form.material"), value: material || t("common.notSpecified") },
      { label: t("contracts.draft.customer"), value: customer || t("common.notSpecified") },
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];
    createDraftSummary.innerHTML = cards.map((card) => `
      <div class="summary-card summary-card-compact">
        <span>${escapeHtml(card.label)}</span>
        <strong>${escapeHtml(String(card.value))}</strong>
        ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
      </div>
    `).join("");
    return;
  }

  if (getSelectedMissionType() === "other") {
    const formData = new FormData(missionForm);
    const location = String(formData.get("miscLocation") || "").trim();
    const customer = String(formData.get("miscCustomer") || "").trim();
    const payoutInput = Number(formData.get("payout"));
    const payout = Number.isFinite(payoutInput) && payoutInput > 0 ? Math.round(payoutInput) : 0;
    const cards = [
      { label: t("contracts.draft.type"), value: getMissionTypeLabel("other") },
      activeShipCard,
      { label: t("contracts.draft.location"), value: location || t("contracts.draft.open") },
      { label: t("contracts.draft.customerContact"), value: customer || t("common.notSpecified") },
      { label: t("contracts.draft.payout"), value: payout > 0 ? `${payout.toLocaleString(currentUiLanguage() === "en" ? "en-US" : "de-DE")} aUEC` : t("common.open") },
    ];

    createDraftSummary.innerHTML = cards
      .map(
        (card) => `
          <div class="summary-card summary-card-compact">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(String(card.value))}</strong>
            ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
          </div>
        `,
      )
      .join("");
    return;
  }

  const consignments = collectConsignments();
  const cargoFormData = new FormData(missionForm);
  const cargoCustomer = String(cargoFormData.get("cargoCustomer") || "").trim();
  const totalLoads = consignments.reduce((sum, consignment) => sum + consignment.quantity, 0);
  const totalScu = getPlannedConsignmentScu(consignments);
  const routeCount = new Set(consignments.map((consignment) => `${consignment.cargoIndex}:${consignment.cargoRouteIndex}`)).size;
  const cargoCount = new Set(consignments.map((consignment) => consignment.cargoIndex)).size;
  const targetCount = new Set(consignments.map((consignment) => consignment.dropoff).filter(Boolean)).size;
  const cargoReadiness = getCargoReadiness({ requestedScu: totalScu });
  const remainingAfterDraft = cargoReadiness.freeCapacity - totalScu;
  const maxContainerScu = getMissionFormMaxContainerScu();

  const cards = [
    activeShipCard,
    {
      label: t("contracts.form.contractor"),
      value: cargoCustomer || t("common.notSpecified"),
    },
    {
      label: t("contracts.draft.cargoTypes"),
      value: cargoCount === 0 ? t("contracts.draft.empty") : String(cargoCount),
    },
    {
      label: t("contracts.draft.routes"),
      value: routeCount === 0 ? t("contracts.draft.open") : String(routeCount),
    },
    {
      label: t("common.container"),
      value: totalLoads === 0 ? "0" : String(totalLoads),
    },
    ...(maxContainerScu
      ? [{ label: t("contracts.draft.maxContainer"), value: `${maxContainerScu} SCU` }]
      : []),
    {
      label: t("contracts.draft.totalScu"),
      value: totalScu === 0 ? "0 SCU" : formatScuAmount(totalScu),
    },
    {
      label: t("contracts.draft.after"),
      value:
        totalScu === 0
          ? t("contracts.draft.free", { value: `${cargoReadiness.freeCapacity} SCU` })
          : remainingAfterDraft >= 0
            ? t("contracts.draft.free", { value: formatScuAmount(remainingAfterDraft) })
            : t("contracts.draft.tooMuch", { value: formatScuAmount(Math.abs(remainingAfterDraft)) }),
    },
    {
      label: t("contracts.draft.targets"),
      value: targetCount === 0 ? t("contracts.draft.open") : `${targetCount}`,
    },
  ];

  createDraftSummary.innerHTML = cards
    .map(
      (card) => `
        <div class="summary-card summary-card-compact">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
          ${card.detail ? `<small>${escapeHtml(String(card.detail))}</small>` : ""}
        </div>
      `,
    )
    .join("");
}

function buildRouteDraftValidation(routeDraft) {
  const pickupFilled = Boolean(routeDraft.pickup);
  const dropoffFilled = Boolean(routeDraft.dropoff);
  const targetFilled = routeDraft.targetScu > 0;
  const touched = pickupFilled || dropoffFilled || targetFilled;
  const totalScu = routeDraft.groups.reduce((sum, group) => sum + group.totalScu, 0);
  const errors = [];
  const warnings = [];

  if (touched && !pickupFilled) {
    errors.push("Abholung fehlt");
  }
  if (touched && !dropoffFilled) {
    errors.push("Lieferung fehlt");
  }
  if (touched && !targetFilled) {
    warnings.push(t("contracts.validation.pickupAmountOpen"));
  }

  if (pickupFilled && dropoffFilled && targetFilled) {
    if (totalScu !== routeDraft.targetScu) {
      const delta = totalScu - routeDraft.targetScu;
      warnings.push(
        delta > 0
          ? `${formatScuAmount(delta)} über Zielmenge`
          : `${formatScuAmount(Math.abs(delta))} unter Zielmenge`,
      );
    }
  }

  const handheldCount = routeDraft.groups
    .filter((group) => group.isHandheld || !group.isPlaceable)
    .reduce((sum, group) => sum + group.quantity, 0);
  if (handheldCount > 0) {
    warnings.push(`${handheldCount} Handfracht wird nicht im Raster geplant`);
  }

  const maxProfile = getCurrentShipMaxContainerProfile();
  const oversizedCount = maxProfile
    ? routeDraft.groups
        .filter((group) => group.isPlaceable && group.scuPerLoad > maxProfile.scu)
        .reduce((sum, group) => sum + group.quantity, 0)
    : 0;
  if (oversizedCount > 0) {
    warnings.push(`${oversizedCount} Container größer als ${maxProfile.label} für das aktuelle Schiff`);
  }

  const missionMaxContainerScu = getMissionFormMaxContainerScu();
  const missionOversizedCount = missionMaxContainerScu
    ? routeDraft.groups
        .filter((group) => group.isPlaceable && group.scuPerLoad > missionMaxContainerScu)
        .reduce((sum, group) => sum + group.quantity, 0)
    : 0;
  if (missionOversizedCount > 0) {
    warnings.push(t("contracts.consignments.overMissionLimit", { count: missionOversizedCount, max: `${missionMaxContainerScu} SCU` }));
  }

  return {
    touched,
    totalScu,
    errors,
    warnings,
    severity: errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "success",
  };
}

function buildMissionDraftValidation() {
  const consignmentNodes = Array.from(consignmentList?.children || []);
  const routeIssues = [];
  let errorCount = 0;
  let warningCount = 0;

  consignmentNodes.forEach((node, cargoIndex) => {
    const draft = readConsignmentDraft(node);
    draft.routes.forEach((routeDraft, routeIndex) => {
      const validation = buildRouteDraftValidation(routeDraft);
      if (!validation.touched) return;
      if (validation.errors.length > 0 || validation.warnings.length > 0) {
        routeIssues.push({
          cargoIndex,
          routeIndex,
          pickup: routeDraft.pickup,
          dropoff: routeDraft.dropoff,
          errors: validation.errors,
          warnings: validation.warnings,
        });
      }
      errorCount += validation.errors.length;
      warningCount += validation.warnings.length;
    });
  });

  const consignments = collectConsignments();
  const totalScu = getPlannedConsignmentScu(consignments);
  const cargoReadiness = getCargoReadiness({ requestedScu: totalScu });
  const remainingAfterDraft = cargoReadiness.freeCapacity - totalScu;
  const overallWarnings = [];

  if (totalScu > 0 && !cargoReadiness.ok) {
    overallWarnings.push(cargoReadiness.message);
    warningCount += 1;
  }

  return {
    errorCount,
    warningCount,
    routeIssues,
    overallWarnings,
    isValid: errorCount === 0,
  };
}

function renderMissionValidationHint() {
  if (!missionValidationHint) return;
  const validation = buildMissionDraftValidation();

  let severity = "neutral";
  let title = "Eingabe wirkt plausibel";
  let details = "Sobald du Strecken und Mengen einträgst, prüft die Auftragsverwaltung die Plausibilität automatisch.";
  const hasTouchedInput = validation.routeIssues.length > 0 || collectConsignments().length > 0;

  if (!hasTouchedInput) {
    missionValidationHint.innerHTML = "";
    missionValidationHint.hidden = true;
    missionValidationHint.classList.remove("form-hint-neutral", "form-hint-success", "form-hint-warning", "form-hint-error");
    if (missionValidationOverrideWrap) {
      missionValidationOverrideWrap.hidden = true;
    }
    if (missionValidationOverride) {
      missionValidationOverride.checked = false;
      missionValidationOverride.disabled = true;
    }
    return;
  }

  missionValidationHint.hidden = false;

  if (validation.errorCount > 0) {
    severity = "error";
    title = `${validation.errorCount} Problem${validation.errorCount === 1 ? "" : "e"} in der Auftragseingabe`;
    details = validation.routeIssues
      .flatMap((issue) =>
        issue.errors.map((message) => {
          const label = issue.pickup || issue.dropoff ? `${issue.pickup || "?"} → ${issue.dropoff || "?"}` : `Strecke ${issue.routeIndex + 1}`;
          return `${label}: ${message}`;
        }),
      )
      .slice(0, 4)
      .join(" · ");
  } else if (validation.warningCount > 0) {
    severity = "warning";
    title = `${validation.warningCount} Hinweis${validation.warningCount === 1 ? "" : "e"} zur Auftragseingabe`;
    details = [
      ...validation.routeIssues.flatMap((issue) =>
        issue.warnings.map((message) => {
          const label = issue.pickup || issue.dropoff ? `${issue.pickup || "?"} → ${issue.dropoff || "?"}` : `Strecke ${issue.routeIndex + 1}`;
          return `${label}: ${message}`;
        }),
      ),
      ...validation.overallWarnings,
    ]
      .slice(0, 4)
      .join(" · ");
  }

  missionValidationHint.classList.remove("form-hint-neutral", "form-hint-success", "form-hint-warning", "form-hint-error");
  missionValidationHint.classList.add(`form-hint-${severity}`);
  missionValidationHint.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(details)}</span>
  `;

  if (missionValidationOverrideWrap) {
    missionValidationOverrideWrap.hidden = validation.errorCount === 0;
  }

  if (missionValidationOverride) {
    if (validation.errorCount === 0) {
      missionValidationOverride.checked = false;
    }
    missionValidationOverride.disabled = validation.errorCount === 0;
  }
}

function updateDimensionHint() {
  const consignments = collectConsignments();
  const totalLoads = consignments.reduce((sum, consignment) => sum + consignment.quantity, 0);
  const totalScu = getPlannedConsignmentScu(consignments);
  const targets = new Set(consignments.map((consignment) => consignment.dropoff).filter(Boolean)).size;
  const cargoCount = new Set(consignments.map((consignment) => consignment.cargoIndex)).size;
  const routeCount = new Set(consignments.map((consignment) => `${consignment.cargoIndex}:${consignment.cargoRouteIndex}`)).size;
  const groupCount = consignments.filter((consignment) => !consignment.quantityPending).length;
  const cargoReadiness = getCargoReadiness({ requestedScu: totalScu });
  const remainingAfterDraft = cargoReadiness.freeCapacity - totalScu;
  const remainingText =
    remainingAfterDraft >= 0
      ? `danach noch ${formatScuAmount(remainingAfterDraft)} frei`
      : `${formatScuAmount(Math.abs(remainingAfterDraft))} zu viel`;

  dimensionHint.innerHTML = `
    <strong>${cargoCount === 0 ? "Noch keine Fracht" : cargoCount === 1 ? "1 Frachtart" : `${cargoCount} Frachtarten`}</strong>
    <span>${routeCount} Strecke${routeCount === 1 ? "" : "n"} · ${groupCount} Gruppe${groupCount === 1 ? "" : "n"} · ${totalLoads} Container</span>
    <small>${formatScuAmount(totalScu)} gesamt · ${targets} Ziel${targets === 1 ? "" : "e"} im Auftrag · ${remainingText}</small>
  `;
  if (recalculateContainerGroupsButton) {
    const hasKnownTarget = Array.from(consignmentList?.querySelectorAll(".route-group-row") || [])
      .some((routeNode) => Number.isInteger(readRouteTargetScu(routeNode)) && readRouteTargetScu(routeNode) > 0);
    recalculateContainerGroupsButton.disabled = !hasKnownTarget;
  }
  renderCreateDraftSummary();
  renderMissionValidationHint();
}

function randomColor() {
  return getNextMissionColor();
}

function normalizeMissionColor(value) {
  const color = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{3}$/.test(color)) {
    return `#${color.slice(1).split("").map((part) => `${part}${part}`).join("")}`;
  }
  return "";
}

function missionColorToRgb(value) {
  const color = normalizeMissionColor(value);
  if (!color) return null;
  return {
    red: Number.parseInt(color.slice(1, 3), 16),
    green: Number.parseInt(color.slice(3, 5), 16),
    blue: Number.parseInt(color.slice(5, 7), 16),
  };
}

function getMissionColorDistance(left, right) {
  const leftRgb = missionColorToRgb(left);
  const rightRgb = missionColorToRgb(right);
  if (!leftRgb || !rightRgb) return Number.POSITIVE_INFINITY;
  return Math.sqrt(
    (leftRgb.red - rightRgb.red) ** 2
      + (leftRgb.green - rightRgb.green) ** 2
      + (leftRgb.blue - rightRgb.blue) ** 2,
  );
}

function isMissionColorDistinct(color, usedColors) {
  const normalizedColor = normalizeMissionColor(color);
  return Boolean(
    normalizedColor
      && usedColors.every((usedColor) => getMissionColorDistance(normalizedColor, usedColor) >= MIN_ACTIVE_MISSION_COLOR_DISTANCE),
  );
}

function pickMostDistinctMissionColor(usedColors) {
  if (usedColors.length === 0) return MISSION_COLOR_PALETTE[0];
  return MISSION_COLOR_PALETTE
    .map((color, index) => ({
      color,
      index,
      distance: Math.min(...usedColors.map((usedColor) => getMissionColorDistance(color, usedColor))),
    }))
    .sort((left, right) => right.distance - left.distance || left.index - right.index)[0].color;
}

function chooseDistinctMissionColor(preferredColor, usedColors) {
  const normalizedUsedColors = usedColors.map(normalizeMissionColor).filter(Boolean);
  const normalizedPreferredColor = normalizeMissionColor(preferredColor);
  if (isMissionColorDistinct(normalizedPreferredColor, normalizedUsedColors)) return normalizedPreferredColor;
  return pickMostDistinctMissionColor(normalizedUsedColors);
}

function getNextMissionColor(excludeMissionId = "", reservedColors = []) {
  const usedColors = (Array.isArray(state?.missions) ? state.missions : [])
    .filter((mission) => mission.id !== excludeMissionId && isMissionActive(mission))
    .map((mission) => mission.color)
    .concat(reservedColors);
  return chooseDistinctMissionColor("", usedColors);
}

function getDistinctActiveMissionColor(preferredColor, excludeMissionId = "") {
  const usedColors = (Array.isArray(state?.missions) ? state.missions : [])
    .filter((mission) => mission.id !== excludeMissionId && isMissionActive(mission))
    .map((mission) => mission.color);
  return chooseDistinctMissionColor(preferredColor, usedColors);
}

function ensureDistinctActiveMissionColors(missions) {
  const usedColors = [];
  missions.forEach((mission) => {
    if (!isMissionActive(mission)) return;
    mission.color = chooseDistinctMissionColor(mission.color, usedColors);
    usedColors.push(mission.color);
  });
}

function renderLanguageOptions() {
  if (!uiLanguageSelect) return;
  const language = currentUiLanguage();
  uiLanguageSelect.innerHTML = APP_LANGUAGE_OPTIONS
    .map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
    .join("");
  uiLanguageSelect.value = language;
  document.documentElement.lang = language;
}

function renderPilotProfileSettings() {
  const dispatcherMode = isDispatcherMode();
  if (soloPilotProfileGroup) {
    soloPilotProfileGroup.hidden = dispatcherMode;
  }
  if (soloPilotNameInput) {
    soloPilotNameInput.disabled = dispatcherMode;
    if (!dispatcherMode) {
      soloPilotNameInput.value = getSoloPilotProfile()?.name || SOLO_PILOT_DEFAULT_NAME;
    }
  }
  if (pilotSuggestions) {
    pilotSuggestions.innerHTML = getPilotProfiles()
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, currentUiLanguage()))
      .map((pilot) => `<option value="${escapeHtml(pilot.name)}"></option>`)
      .join("");
  }
}

function renderIsoDetails(entry) {
  const detailTargets = [
    { title: isoDetailTitle, route: isoDetailRoute, meta: isoDetailMeta },
    { title: loadIsoDetailTitle, route: loadIsoDetailRoute, meta: loadIsoDetailMeta },
  ].filter((target) => target.title && target.route && target.meta);

  if (!entry) {
    detailTargets.forEach((target) => {
      target.title.textContent = t("contracts.overview.noLoadSelected");
      target.route.textContent = t("contracts.overview.selectLoad");
      target.meta.textContent = "";
    });
    if (overviewDetailActions) {
      overviewDetailActions.hidden = true;
    }
    return;
  }

  const { mission, load } = entry;
  const dimensions = getLoadDimensions(load, placementRotation(load));
  const zStart = load.placement?.z ?? 0;
  const zEnd = zStart + dimensions.height;
  detailTargets.forEach((target) => {
    target.title.textContent = load.label;
    target.route.textContent = formatLoadRoute(load, mission);
    target.meta.textContent = `${mission.title} · ${dimensions.width}×${dimensions.depth}×${dimensions.height} · ${load.scu} SCU · z ${zStart}–${zEnd}`;
  });
  if (overviewDetailActions) {
    overviewDetailActions.hidden = false;
  }
}

function shadeColor(color, percent) {
  const value = color.replace("#", "");
  const numeric = Number.parseInt(value, 16);
  const amount = Math.round(2.55 * percent);
  const r = clamp((numeric >> 16) + amount, 0, 255);
  const g = clamp(((numeric >> 8) & 0x00ff) + amount, 0, 255);
  const b = clamp((numeric & 0x0000ff) + amount, 0, 255);
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isSlotInside(slotId, rows, cols) {
  if (typeof slotId !== "string" || slotId.length < 2) return false;
  const match = slotId.trim().toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return false;
  const rowIndex = rowLabelToIndex(match[1]);
  const colIndex = Number(match[2]) - 1;
  return rowIndex >= 0 && rowIndex < rows && colIndex >= 0 && colIndex < cols;
}

window.soloAppReady = true;
