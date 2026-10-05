/**
 * ui/scenarioManager.js
 * Manages the Scenarios section in the dashboard, Save Scenario modal,
 * and Delete confirmation dialog.
 */

/**
 * Format ISO date string into standard display: "04 Sep 2026"
 * @param {string} isoString
 * @returns {string}
 */
export function formatScenarioDate(isoString) {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const month = d.toLocaleString('en-US', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return '';
  }
}

/**
 * Helper to stop event propagation on interactive UI elements to avoid triggering
 * Phaser scene clicks or canvas drags.
 * @param {HTMLElement} el
 */
function isolateEvent(el) {
  if (!el) return;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('mousedown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => e.stopPropagation());
  el.addEventListener('keydown', (e) => e.stopPropagation());
}

/**
 * Initialize Scenario Manager UI.
 *
 * @param {{
 *   onSaveScenario: (name: string) => Promise<object>,
 *   onLoadScenario: (scenario: object) => void,
 *   onDeleteScenario: (id: string) => Promise<boolean>,
 *   getScenarios: () => Promise<object[]>
 * }} callbacks
 * @returns {{
 *   refreshScenarioList: () => Promise<void>,
 *   openSaveModal: () => void,
 *   closeSaveModal: () => void
 * }}
 */
export function createScenarioManager(callbacks) {
  const saveBtn = document.getElementById('btn-save-scenario');
  const listContainer = document.getElementById('scenarios-list');
  const saveModal = document.getElementById('modal-save-scenario');
  const saveInput = document.getElementById('input-scenario-name');
  const saveError = document.getElementById('scenario-save-error');
  const saveConfirmBtn = document.getElementById('btn-confirm-save-scenario');
  const saveCancelBtn = document.getElementById('btn-cancel-save-scenario');

  const deleteModal = document.getElementById('modal-delete-scenario');
  const deleteNameSpan = document.getElementById('delete-scenario-name');
  const deleteConfirmBtn = document.getElementById('btn-confirm-delete-scenario');
  const deleteCancelBtn = document.getElementById('btn-cancel-delete-scenario');

  const activeBar = document.getElementById('scenario-active-bar');
  const activeNameSpan = document.getElementById('active-scenario-name');
  const saveChangesBtn = document.getElementById('btn-save-scenario-changes');
  const feedbackMsg = document.getElementById('scenario-feedback-msg');

  let pendingDeleteId = null;
  let activeScenarioId = null;
  let activeScenarioName = null;
  let feedbackTimer = null;
  // Tracks whether a simulation run is currently ACTIVE.
  // When true, SAVE CHANGES is blocked to prevent runtime state leaking into the persisted scenario.
  let runIsActive = false;

  // ── Event isolation ────────────────────────────────────────────────────────
  isolateEvent(saveBtn);
  isolateEvent(listContainer);
  isolateEvent(saveModal);
  isolateEvent(deleteModal);
  isolateEvent(activeBar);
  isolateEvent(saveChangesBtn);

  // ── Active Scenario & Feedback UI Helpers ──────────────────────────────────
  const showFeedback = (text, isError = false) => {
    if (!feedbackMsg) return;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackMsg.textContent = text;
    feedbackMsg.style.display = 'block';
    feedbackMsg.style.color = isError ? '#f87171' : '#34d399';
    feedbackMsg.style.borderColor = isError ? 'rgba(239, 68, 68, 0.4)' : 'rgba(16, 185, 129, 0.3)';
    feedbackMsg.style.background = isError ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
    feedbackTimer = setTimeout(() => {
      feedbackMsg.style.display = 'none';
      feedbackMsg.textContent = '';
    }, 2800);
  };

  const updateActiveBarUI = () => {
    if (!activeBar) return;
    if (activeScenarioId && activeScenarioName) {
      if (activeNameSpan) activeNameSpan.textContent = activeScenarioName;
      activeBar.style.display = 'flex';
    } else {
      activeBar.style.display = 'none';
    }
    // Reflect run-active state on the SAVE CHANGES button
    if (saveChangesBtn) {
      if (runIsActive) {
        saveChangesBtn.disabled = true;
        saveChangesBtn.title = 'Simulation run is active — reload the scenario to edit and save';
        saveChangesBtn.style.opacity = '0.45';
        saveChangesBtn.style.cursor = 'not-allowed';
      } else {
        saveChangesBtn.disabled = false;
        saveChangesBtn.title = 'Save current robot configuration to this scenario';
        saveChangesBtn.style.opacity = '';
        saveChangesBtn.style.cursor = '';
      }
    }
  };

  // ── Modals control ─────────────────────────────────────────────────────────
  const openSaveModal = () => {
    if (!saveModal) return;
    if (saveInput) {
      saveInput.value = '';
      saveInput.classList.remove('input-error');
    }
    if (saveError) {
      saveError.style.display = 'none';
      saveError.textContent = '';
    }
    saveModal.classList.add('modal-visible');
    setTimeout(() => {
      if (saveInput) saveInput.focus();
    }, 50);
  };

  const closeSaveModal = () => {
    if (!saveModal) return;
    saveModal.classList.remove('modal-visible');
    if (saveInput) saveInput.blur();
  };

  const openDeleteModal = (id, name) => {
    pendingDeleteId = id;
    if (!deleteModal) return;
    if (deleteNameSpan) {
      deleteNameSpan.textContent = name || 'this scenario';
    }
    deleteModal.classList.add('modal-visible');
  };

  const closeDeleteModal = () => {
    pendingDeleteId = null;
    if (!deleteModal) return;
    deleteModal.classList.remove('modal-visible');
  };

  // ── Scenario Update Handler ────────────────────────────────────────────────
  const handleScenarioUpdate = async (scenario, triggerBtn = null) => {
    if (!scenario || !scenario.id) return;

    const originalTriggerText = triggerBtn ? triggerBtn.textContent : '';
    const originalSaveText = saveChangesBtn ? saveChangesBtn.textContent : '';

    try {
      if (triggerBtn) {
        triggerBtn.textContent = 'SAVING...';
        triggerBtn.disabled = true;
      }
      if (saveChangesBtn) {
        saveChangesBtn.textContent = 'SAVING...';
        saveChangesBtn.disabled = true;
      }

      if (callbacks.onUpdateScenario) {
        await callbacks.onUpdateScenario(scenario.id, scenario.name);
      }

      activeScenarioId = scenario.id;
      activeScenarioName = scenario.name;
      updateActiveBarUI();
      showFeedback(`Saved changes to "${scenario.name}"`);

      if (triggerBtn) {
        triggerBtn.textContent = 'SAVED ✓';
      }
      if (saveChangesBtn) {
        saveChangesBtn.textContent = 'SAVED ✓';
      }

      setTimeout(() => {
        if (triggerBtn) {
          triggerBtn.textContent = originalTriggerText || 'UPDATE';
          triggerBtn.disabled = false;
        }
        if (saveChangesBtn) {
          saveChangesBtn.textContent = originalSaveText || 'SAVE CHANGES';
          saveChangesBtn.disabled = false;
        }
      }, 1500);

      await refreshScenarioList();
    } catch (err) {
      console.warn('[ScenarioManager] Failed to update scenario:', err);
      showFeedback(`Update failed: ${err.message}`, true);
      if (triggerBtn) {
        triggerBtn.textContent = originalTriggerText || 'UPDATE';
        triggerBtn.disabled = false;
      }
      if (saveChangesBtn) {
        saveChangesBtn.textContent = originalSaveText || 'SAVE CHANGES';
        saveChangesBtn.disabled = false;
      }
    }
  };

  // ── Render Scenario Cards ──────────────────────────────────────────────────
  const renderScenarios = (scenarios = []) => {
    if (!listContainer) return;

    if (!scenarios || scenarios.length === 0) {
      listContainer.innerHTML = '<div class="scenario-empty-hint">No saved scenarios</div>';
      return;
    }

    listContainer.innerHTML = scenarios.map((scenario) => {
      const robotCount = scenario.robots ? scenario.robots.length : 0;
      const countLabel = robotCount === 1 ? '1 Robot' : `${robotCount} Robots`;
      const formattedDate = formatScenarioDate(scenario.createdAt);
      const isActive = scenario.id === activeScenarioId;

      return `
        <div class="scenario-card ${isActive ? 'scenario-card-active' : ''}" data-scenario-id="${scenario.id}">
          <div class="scenario-card-header">
            <span class="scenario-card-title">${escapeHtml(scenario.name)}</span>
            ${isActive ? '<span class="scenario-active-badge">EDITING</span>' : ''}
          </div>
          <div class="scenario-card-meta">
            <span class="scenario-meta-count">${countLabel}</span>
            <span class="scenario-meta-date">Saved: ${formattedDate}</span>
          </div>
          <div class="scenario-card-actions">
            <button class="btn-scenario-load" data-load-id="${scenario.id}" type="button" title="Load this initial fleet scenario">LOAD</button>
            <button class="btn-scenario-update" data-update-id="${scenario.id}" type="button" title="${isActive ? 'Save current fleet to this scenario' : 'Load this scenario first to update it'}" ${isActive ? '' : 'disabled'}>UPDATE</button>
            <button class="btn-scenario-delete" data-delete-id="${scenario.id}" type="button" title="Delete scenario">DELETE</button>
          </div>
        </div>
      `;
    }).join('');

    // Wire LOAD buttons
    const loadButtons = listContainer.querySelectorAll('.btn-scenario-load');
    loadButtons.forEach((btn) => {
      isolateEvent(btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-load-id');
        const sc = scenarios.find((s) => s.id === id);
        if (sc) {
          activeScenarioId = sc.id;
          activeScenarioName = sc.name;
          updateActiveBarUI();
          renderScenarios(scenarios);
          if (callbacks.onLoadScenario) {
            callbacks.onLoadScenario(sc);
          }
        }
      });
    });

    // Wire UPDATE buttons
    const updateButtons = listContainer.querySelectorAll('.btn-scenario-update');
    updateButtons.forEach((btn) => {
      isolateEvent(btn);
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-update-id');
        const sc = scenarios.find((s) => s.id === id);
        if (sc) {
          await handleScenarioUpdate(sc, btn);
        }
      });
    });

    // Wire DELETE buttons
    const deleteButtons = listContainer.querySelectorAll('.btn-scenario-delete');
    deleteButtons.forEach((btn) => {
      isolateEvent(btn);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-delete-id');
        const sc = scenarios.find((s) => s.id === id);
        openDeleteModal(id, sc ? sc.name : '');
      });
    });
  };

  // ── Refresh Scenario List ──────────────────────────────────────────────────
  const refreshScenarioList = async () => {
    try {
      if (callbacks.getScenarios) {
        const scenarios = await callbacks.getScenarios();
        // If active scenario no longer exists in scenarios list, clear active state
        if (activeScenarioId && !scenarios.some((s) => s.id === activeScenarioId)) {
          activeScenarioId = null;
          activeScenarioName = null;
          updateActiveBarUI();
        }
        renderScenarios(scenarios);
      }
    } catch (err) {
      console.warn('[ScenarioManager] Failed to fetch scenarios:', err);
    }
  };

  // ── Wire Active Bar Save Changes Button ────────────────────────────────────
  if (saveChangesBtn) {
    saveChangesBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (activeScenarioId && activeScenarioName) {
        await handleScenarioUpdate({ id: activeScenarioId, name: activeScenarioName }, saveChangesBtn);
      }
    });
  }

  // ── Wire Save Button & Modal Form ──────────────────────────────────────────
  if (saveBtn) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSaveModal();
    });
  }

  const handleSaveSubmit = async () => {
    if (!saveInput) return;
    const rawName = saveInput.value || '';
    const trimmed = rawName.trim();

    if (!trimmed) {
      if (saveError) {
        saveError.textContent = 'Scenario name is required';
        saveError.style.display = 'block';
      }
      saveInput.classList.add('input-error');
      saveInput.focus();
      return;
    }

    try {
      let saved = null;
      if (callbacks.onSaveScenario) {
        saved = await callbacks.onSaveScenario(trimmed);
      }
      closeSaveModal();

      if (saved && saved.id) {
        activeScenarioId = saved.id;
        activeScenarioName = saved.name || trimmed;
      } else {
        activeScenarioName = trimmed;
      }
      updateActiveBarUI();
      showFeedback(`Scenario "${trimmed}" saved!`);
      await refreshScenarioList();
    } catch (err) {
      if (saveError) {
        saveError.textContent = err.message || 'Failed to save scenario';
        saveError.style.display = 'block';
      }
      saveInput.classList.add('input-error');
    }
  };

  if (saveConfirmBtn) {
    saveConfirmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSaveSubmit();
    });
  }

  if (saveCancelBtn) {
    saveCancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSaveModal();
    });
  }

  if (saveInput) {
    saveInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSaveSubmit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeSaveModal();
      } else {
        if (saveError) saveError.style.display = 'none';
        saveInput.classList.remove('input-error');
      }
    });
  }

  // ── Wire Delete Confirmation Modal ─────────────────────────────────────────
  if (deleteConfirmBtn) {
    deleteConfirmBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (pendingDeleteId && callbacks.onDeleteScenario) {
        try {
          await callbacks.onDeleteScenario(pendingDeleteId);
          if (activeScenarioId === pendingDeleteId) {
            activeScenarioId = null;
            activeScenarioName = null;
            updateActiveBarUI();
          }
          showFeedback('Scenario deleted');
        } catch (err) {
          console.warn('[ScenarioManager] Failed to delete scenario:', err);
          showFeedback(`Delete failed: ${err.message}`, true);
        }
      }
      closeDeleteModal();
      await refreshScenarioList();
    });
  }

  if (deleteCancelBtn) {
    deleteCancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeDeleteModal();
    });
  }

  // Backdrop clicks for modal dismissal
  if (saveModal) {
    saveModal.addEventListener('click', (e) => {
      if (e.target === saveModal) closeSaveModal();
    });
  }
  if (deleteModal) {
    deleteModal.addEventListener('click', (e) => {
      if (e.target === deleteModal) closeDeleteModal();
    });
  }

  // Escape key global listener for modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (saveModal && saveModal.classList.contains('modal-visible')) {
        closeSaveModal();
      }
      if (deleteModal && deleteModal.classList.contains('modal-visible')) {
        closeDeleteModal();
      }
    }
  });

  // Initial load
  refreshScenarioList();

  return {
    refreshScenarioList,
    openSaveModal,
    closeSaveModal,
    getActiveScenarioId: () => activeScenarioId,
    getActiveScenarioName: () => activeScenarioName,
    setActiveScenario: (id, name) => {
      activeScenarioId = id;
      activeScenarioName = name;
      updateActiveBarUI();
      refreshScenarioList();
    },
    /**
     * Called by main.js to reflect whether a simulation run is currently active.
     * When active: disables SAVE CHANGES to prevent runtime state persisting to Supabase.
     * When inactive: re-enables SAVE CHANGES for pre-run scenario editing.
     *
     * @param {boolean} active
     */
    setRunActive: (active) => {
      runIsActive = !!active;
      updateActiveBarUI();
    },
    isRunActive: () => runIsActive
  };
}

/**
 * Basic HTML escaping for safe text rendering.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
