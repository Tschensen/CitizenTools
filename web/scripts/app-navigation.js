// Page, module and settings navigation.
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
  renderVisiblePage();
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


function registerAppNavigationEvents() {
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
}
