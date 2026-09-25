(function registerBackupUi(globalScope) {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const REMINDER_DAY_OPTIONS = [0, 3, 7, 14, 30];

  function normalizeBackupReminderDays(value) {
    const numeric = Number(value);
    return REMINDER_DAY_OPTIONS.includes(numeric) ? numeric : 7;
  }

  function calculateBackupFreshness(lastBackupAt, reminderDays, now = new Date()) {
    const days = normalizeBackupReminderDays(reminderDays);
    if (days === 0) {
      return { state: "disabled", due: false, reminderDays: 0, ageDays: null, remainingDays: null };
    }
    const backupTime = Date.parse(String(lastBackupAt || ""));
    if (!Number.isFinite(backupTime)) {
      return { state: "missing", due: true, reminderDays: days, ageDays: null, remainingDays: 0 };
    }
    const ageMs = Math.max(0, now.getTime() - backupTime);
    const ageDays = Math.floor(ageMs / DAY_MS);
    const due = ageMs >= days * DAY_MS;
    return {
      state: due ? "due" : "current",
      due,
      reminderDays: days,
      ageDays,
      remainingDays: due ? 0 : Math.max(1, Math.ceil((days * DAY_MS - ageMs) / DAY_MS)),
    };
  }

  function buildRestorePreviewRows(preview) {
    const backupStates = new Map((preview?.backup?.states || []).map((entry) => [entry.scope, entry]));
    const currentStates = new Map((preview?.current?.states || []).map((entry) => [entry.scope, entry]));
    const rows = [];
    ["solo", "dispatcher"].forEach((scope) => {
      const backup = backupStates.get(scope);
      const current = currentStates.get(scope);
      if (!backup && !current) return;
      rows.push(
        { key: `${scope}.missions`, scope, metric: "missions", current: current?.missions || 0, backup: backup?.missions || 0 },
        { key: `${scope}.fleet`, scope, metric: "fleet", current: current?.fleet || 0, backup: backup?.fleet || 0 },
        { key: `${scope}.ledger`, scope, metric: "ledger", current: current?.ledgerEntries || 0, backup: backup?.ledgerEntries || 0 },
      );
    });
    rows.push({
      key: "locations",
      scope: "system",
      metric: "locations",
      current: Number(preview?.current?.locations) || 0,
      backup: Number(preview?.backup?.locations) || 0,
    });
    rows.push({
      key: "images",
      scope: "system",
      metric: "images",
      current: Number(preview?.current?.shipImages) || 0,
      backup: preview?.imagesMode === "keep" ? null : Number(preview?.shipImages) || 0,
      keepCurrent: preview?.imagesMode === "keep",
    });
    return rows;
  }

  function createBackupController({ helpers, callbacks }) {
    const { escapeHtml, formatDateTimeDisplay, t } = helpers;
    const elements = {
      backupButton: document.querySelector("#backupButton"),
      restoreButton: document.querySelector("#restoreButton"),
      restoreInput: document.querySelector("#restoreInput"),
      reminderSelect: document.querySelector("#backupReminderDaysSelect"),
      reminderStatus: document.querySelector("#backupReminderStatus"),
      reminderStatusText: document.querySelector("#backupReminderStatusText"),
      reminderStatusMeta: document.querySelector("#backupReminderStatusMeta"),
      previewDialog: document.querySelector("#restorePreviewDialog"),
      previewFile: document.querySelector("#restorePreviewFile"),
      previewMeta: document.querySelector("#restorePreviewMeta"),
      previewRows: document.querySelector("#restorePreviewRows"),
      previewImages: document.querySelector("#restorePreviewImages"),
      previewCancel: document.querySelector("#restorePreviewCancel"),
      previewConfirm: document.querySelector("#restorePreviewConfirm"),
    };

    function getFreshness(now = new Date()) {
      return calculateBackupFreshness(
        callbacks.getLastBackupAt(),
        callbacks.getReminderDays(),
        now,
      );
    }

    function renderReminder() {
      const days = normalizeBackupReminderDays(callbacks.getReminderDays());
      if (elements.reminderSelect) elements.reminderSelect.value = String(days);
      const freshness = getFreshness();
      if (!elements.reminderStatus || !elements.reminderStatusText || !elements.reminderStatusMeta) return freshness;
      elements.reminderStatus.dataset.state = freshness.state;
      if (freshness.state === "disabled") {
        elements.reminderStatusText.textContent = t("settings.backupReminder.disabledTitle");
        elements.reminderStatusMeta.textContent = t("settings.backupReminder.disabledMeta");
      } else if (freshness.state === "missing") {
        elements.reminderStatusText.textContent = t("settings.backupReminder.missingTitle");
        elements.reminderStatusMeta.textContent = t("settings.backupReminder.missingMeta", { days });
      } else if (freshness.state === "due") {
        elements.reminderStatusText.textContent = t("settings.backupReminder.dueTitle");
        elements.reminderStatusMeta.textContent = t("settings.backupReminder.dueMeta", { days: freshness.ageDays });
      } else {
        elements.reminderStatusText.textContent = t("settings.backupReminder.currentTitle");
        const currentMetaKey = freshness.remainingDays === 1
          ? "settings.backupReminder.currentMetaDay"
          : "settings.backupReminder.currentMeta";
        elements.reminderStatusMeta.textContent = t(currentMetaKey, {
          value: formatDateTimeDisplay(callbacks.getLastBackupAt()),
          days: freshness.remainingDays,
        });
      }
      elements.backupButton?.classList.toggle("is-reminder-due", freshness.due);
      return freshness;
    }

    function formatBytes(value) {
      const bytes = Math.max(0, Number(value) || 0);
      if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
      return `${(bytes / (1024 * 1024)).toLocaleString(document.documentElement.lang || "de", {
        maximumFractionDigits: 1,
      })} MB`;
    }

    function getRowLabel(row) {
      const scope = row.scope === "solo"
        ? t("settings.restore.scopeSolo")
        : row.scope === "dispatcher"
          ? t("settings.restore.scopeDispatcher")
          : t("settings.restore.scopeSystem");
      return `${scope} · ${t(`settings.restore.metric.${row.metric}`)}`;
    }

    function renderPreview(file, preview) {
      if (elements.previewFile) elements.previewFile.textContent = file.name || t("settings.restore.unknownFile");
      const meta = [
        preview.createdAt ? t("settings.restore.createdAt", { value: formatDateTimeDisplay(preview.createdAt) }) : t("settings.restore.createdAtUnknown"),
        t("settings.restore.databaseSize", { value: formatBytes(preview.databaseBytes) }),
      ];
      if (elements.previewMeta) elements.previewMeta.textContent = meta.join(" · ");
      if (elements.previewRows) {
        elements.previewRows.innerHTML = buildRestorePreviewRows(preview)
          .map((row) => `
            <tr>
              <th scope="row">${escapeHtml(getRowLabel(row))}</th>
              <td>${escapeHtml(String(row.current))}</td>
              <td>${row.keepCurrent ? escapeHtml(t("settings.restore.keepCurrent")) : escapeHtml(String(row.backup))}</td>
            </tr>
          `)
          .join("");
      }
      if (elements.previewImages) {
        elements.previewImages.textContent = preview.imagesMode === "keep"
          ? t("settings.restore.imagesKeep")
          : t("settings.restore.imagesReplace", { count: Number(preview.shipImages) || 0 });
      }
    }

    function showPreviewDialog(file, preview) {
      if (!elements.previewDialog || !elements.previewConfirm) return Promise.resolve(false);
      renderPreview(file, preview);
      elements.previewDialog.hidden = false;
      elements.previewConfirm.focus();
      return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
          if (settled) return;
          settled = true;
          cleanup();
          elements.previewDialog.hidden = true;
          resolve(result);
        };
        const handleCancel = () => finish(false);
        const handleConfirm = () => finish(true);
        const handleBackdrop = (event) => {
          if (event.target === elements.previewDialog) finish(false);
        };
        const handleKeydown = (event) => {
          if (event.key === "Escape") finish(false);
        };
        const cleanup = () => {
          elements.previewCancel?.removeEventListener("click", handleCancel);
          elements.previewConfirm.removeEventListener("click", handleConfirm);
          elements.previewDialog.removeEventListener("click", handleBackdrop);
          document.removeEventListener("keydown", handleKeydown);
        };
        elements.previewCancel?.addEventListener("click", handleCancel);
        elements.previewConfirm.addEventListener("click", handleConfirm);
        elements.previewDialog.addEventListener("click", handleBackdrop);
        document.addEventListener("keydown", handleKeydown);
      });
    }

    async function downloadBackup() {
      if (!callbacks.canUseServer()) {
        await callbacks.showNotice(t("settings.backupServerRequired"));
        return;
      }
      try {
        const response = await fetch("./api/backup");
        if (!response.ok) throw new Error("backup_failed");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `cargo-planner-backup-${new Date().toISOString().slice(0, 10)}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        callbacks.setConnected(true);
        callbacks.onBackupCreated(response.headers.get("X-Backup-At") || new Date().toISOString());
        renderReminder();
      } catch (error) {
        callbacks.setConnected(false);
        await callbacks.showNotice(t("settings.backupFailed"), { tone: "danger" });
      }
    }

    async function previewAndRestore(file) {
      try {
        elements.restoreButton?.toggleAttribute("disabled", true);
        const previewResponse = await fetch("./api/restore/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Backup-Filename": encodeURIComponent(file.name || "cargo-planner-backup.zip"),
          },
          body: file,
        });
        callbacks.setConnected(true);
        if (!previewResponse.ok) {
          await callbacks.showNotice(t("settings.restoreInvalid"), { tone: "danger" });
          return;
        }
        const previewPayload = await previewResponse.json();
        const shouldRestore = await showPreviewDialog(file, previewPayload.preview || {});
        if (!shouldRestore) return;

        const restoreResponse = await fetch("./api/restore", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Backup-Filename": encodeURIComponent(file.name || "cargo-planner-backup.zip"),
          },
          body: file,
        });
        if (!restoreResponse.ok) throw new Error("restore_failed");
        const payload = await restoreResponse.json();
        callbacks.setConnected(true);
        await callbacks.onRestored(payload);
        await callbacks.showNotice(t("settings.restoreSuccess"));
      } catch (error) {
        callbacks.setConnected(false);
        await callbacks.showNotice(t("settings.restoreFailed"), { tone: "danger" });
      } finally {
        elements.restoreButton?.removeAttribute("disabled");
        if (elements.restoreInput) elements.restoreInput.value = "";
      }
    }

    function init() {
      elements.backupButton?.addEventListener("click", () => void downloadBackup());
      elements.restoreButton?.addEventListener("click", () => elements.restoreInput?.click());
      elements.restoreInput?.addEventListener("change", (event) => {
        const file = event.target.files?.[0];
        if (file) void previewAndRestore(file);
      });
      elements.reminderSelect?.addEventListener("change", () => {
        callbacks.setReminderDays(normalizeBackupReminderDays(elements.reminderSelect.value));
        renderReminder();
      });
      renderReminder();
    }

    return { getFreshness, init, render: renderReminder };
  }

  globalScope.BackupUi = {
    buildRestorePreviewRows,
    calculateBackupFreshness,
    createBackupController,
    normalizeBackupReminderDays,
  };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = globalScope.BackupUi;
  }
})(typeof window !== "undefined" ? window : globalThis);
