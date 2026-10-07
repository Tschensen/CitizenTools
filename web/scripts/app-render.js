// Application adapter: prepare shared controls, then refresh only visible views.
let appViewRenderer = null;
function getAppViewRenderer() {
  appViewRenderer ||= ViewRenderer.create({
    getPage: () => activePage,
    views: [
      {id:'hub', pages:['hub'], render: () => renderHub()},
      {id:'run', pages:['run'], render: () => renderRunMode()},
      {id:'create', pages:['create'], render: () => renderCreateShipIndicator()},
      // The ship-selection preview copies the interactive cargo grid.
      {id:'cargo-grid', pages:['home','load'], render: () => {
        renderLevelFilters(); renderShipGrid(); renderIsometricView(); syncStaticPreviews();
      }},
      {id:'cargo-loads', pages:['load'], render: () => renderHomeLoads()},
      {id:'cargo-overview', pages:['overview'], render: () => {
        renderSummary(); renderStopList(); renderCurrentLocationControl();
        renderRouteProgress(); renderMissions();
      }},
      {id:'fleet', pages:['fleet'], render: () => renderFleet()},
      {id:'finance', pages:['finance'], render: () => financeController.render()},
      {id:'statistics', pages:['statistics'], render: () => statisticsController.render()},
      {id:'ships', pages:['ships'], render: () => renderShipDatabase()},
      {id:'systems', pages:['systems'], render: () => systemDatabaseController.render()},
    ],
  });
  return appViewRenderer;
}

function renderVisiblePage() {
  getAppViewRenderer().render();
  normalizeAppTooltipTitles();
}

function invalidateAppViews() { getAppViewRenderer().invalidate(); }

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
  renderRemoteStatus();
  backupController.render();
  renderMissionImportProgress();
  invalidateAppViews();
  renderVisiblePage();
}
