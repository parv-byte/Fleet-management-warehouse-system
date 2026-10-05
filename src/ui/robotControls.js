import { MAX_ROBOTS } from '../config/constants.js';

/**
 * ui/robotControls.js
 * Responsible for all existing UI wiring:
 *   - updateStatusUI()        – robot name/status badge/start-button state
 *   - selectRobot()           – switches the active robot
 *   - updateConflictPanel()   – populates the Fleet Conflicts DOM panel
 *   - renderRobotSelector()   – dynamic selector buttons & empty state
 *   - updateFleetCounter()    – dynamic fleet counter and limit indicator
 *   - + ADD ROBOT button click handler
 *   - START button click handler
 *
 * The module is stateful: it tracks selectedRobotId internally and exposes
 * getSelectedRobotId() / setSelectedRobotId() so main.js can stay in sync.
 */

/**
 * Create the UI controller.
 *
 * @param {Object.<string, object>} robots       – robot state objects
 * @param {Object.<string, Phaser.GameObjects.Sprite>} robotSprites
 * @param {{
 *   startRobotMovement: Function,
 *   startAllRobots?: Function,
 *   onRobotSelected: Function,  // (robotId) => void – called after selectRobot()
 *   onAddRobot: Function        // () => void – called when + ADD ROBOT is clicked
 * }} callbacks
 * @returns {{
 *   updateStatusUI: Function,
 *   selectRobot: Function,
 *   updateConflictPanel: Function,
 *   getSelectedRobotId: Function,
 *   setSelectedRobotId: Function,
 *   renderRobotSelector: Function,
 *   updateFleetCounter: Function
 * }}
 */
export function createUIController(robots, robotSprites, callbacks) {

  // Internal selected-robot state (null at startup until first robot is created)
  let selectedRobotId = null;
  let lastKnownConflicts = [];

  // ── Live Fleet Overview ─────────────────────────────────────────────────────
  const updateLiveOverview = (conflicts) => {
    if (conflicts && Array.isArray(conflicts)) {
      lastKnownConflicts = conflicts;
    }

    const robotValues = Object.values(robots);
    const fleetCount  = robotValues.length;
    const activeCount = (selectedRobotId && robots[selectedRobotId]) ? 1 : 0;
    const movingCount = robotValues.filter((r) => r.status === 'moving').length;
    const idleCount   = robotValues.filter((r) => !r.status || r.status === 'idle').length;
    const completedCount = robotValues.filter((r) => r.status === 'completed').length;
    const conflictCount = lastKnownConflicts.length;

    const fleetEl     = document.getElementById('ov-fleet-val');
    const activeEl    = document.getElementById('ov-active-val');
    const movingEl    = document.getElementById('ov-moving-val');
    const idleEl      = document.getElementById('ov-idle-val');
    const completedEl = document.getElementById('ov-completed-val');
    const conflictEl  = document.getElementById('ov-conflicts-val');

    if (fleetEl) {
      fleetEl.innerHTML = `${fleetCount} <span class="ov-unit">${fleetCount === 1 ? 'ROBOT' : 'ROBOTS'}</span>`;
    }
    if (activeEl)    activeEl.textContent    = activeCount;
    if (movingEl)    movingEl.textContent    = movingCount;
    if (idleEl)      idleEl.textContent      = idleCount;
    if (completedEl) completedEl.textContent = completedCount;
    if (conflictEl) {
      conflictEl.textContent = conflictCount;
      if (conflictCount > 0) {
        conflictEl.classList.add('has-conflicts');
      } else {
        conflictEl.classList.remove('has-conflicts');
      }
    }
  };

  // ── Status & Configuration UI ───────────────────────────────────────────────
  const updateStatusUI = () => {
    const activeRobot = selectedRobotId ? robots[selectedRobotId] : null;

    const emptyStateEl = document.getElementById('config-empty-state');
    const formEl       = document.getElementById('config-form');

    if (!activeRobot) {
      if (emptyStateEl) emptyStateEl.style.display = 'block';
      if (formEl) formEl.style.display = 'none';

      const startBtn = document.getElementById('start-btn');
      if (startBtn) {
        startBtn.style.opacity = '0.5';
        startBtn.style.cursor  = 'not-allowed';
      }
    } else {
      if (emptyStateEl) emptyStateEl.style.display = 'none';
      if (formEl) formEl.style.display = 'flex';

      // 1. Robot Name & Color
      const activeNameEl = document.getElementById('active-robot-name');
      if (activeNameEl) {
        activeNameEl.textContent = activeRobot.id;
        activeNameEl.style.color = activeRobot.colorHex;
      }

      // 2. Status Badge
      const statusBadge = document.getElementById('status-badge');
      if (statusBadge) {
        const status = (activeRobot.status || 'idle').toUpperCase();
        statusBadge.textContent = status;
        if (status === 'MOVING') {
          statusBadge.style.color = '#fbbf24';
          statusBadge.style.background = 'rgba(251, 191, 36, 0.12)';
        } else if (status === 'COMPLETED') {
          statusBadge.style.color = '#34d399';
          statusBadge.style.background = 'rgba(52, 211, 153, 0.12)';
        } else {
          statusBadge.style.color = '#38bdf8';
          statusBadge.style.background = 'rgba(56, 189, 248, 0.12)';
        }
      }

      // 3. Speed Input
      const speedInput = document.getElementById('config-speed-input');
      if (speedInput && document.activeElement !== speedInput) {
        speedInput.value = activeRobot.speed || 100;
      }

      // 4. Priority Input
      const priorityInput = document.getElementById('config-priority-input');
      if (priorityInput && document.activeElement !== priorityInput) {
        priorityInput.value = activeRobot.priority || 1;
      }

      // 5. Battery Slider & Val
      const batteryInput = document.getElementById('config-battery-input');
      const batteryVal   = document.getElementById('config-battery-val');
      const bVal         = activeRobot.battery !== undefined ? activeRobot.battery : 100;
      if (batteryInput && document.activeElement !== batteryInput) {
        batteryInput.value = bVal;
      }
      if (batteryVal) {
        batteryVal.textContent = `${bVal}%`;
      }

      // 6. Task Select
      const taskSelect = document.getElementById('config-task-select');
      if (taskSelect && document.activeElement !== taskSelect) {
        taskSelect.value = activeRobot.task || 'General Transport';
      }

      // 7. Start Position (Display-Only)
      const startPosEl = document.getElementById('config-start-pos');
      if (startPosEl) {
        if (activeRobot.start) {
          startPosEl.textContent = `Tile (${activeRobot.start.tileX}, ${activeRobot.start.tileY})`;
        } else {
          startPosEl.textContent = 'Tile (—, —)';
        }
      }

      // 8. Destination Position (Display-Only)
      const destPosEl = document.getElementById('config-dest-pos');
      if (destPosEl) {
        if (activeRobot.destination) {
          destPosEl.textContent = `Tile (${activeRobot.destination.tileX}, ${activeRobot.destination.tileY})`;
          destPosEl.style.color = 'var(--color-text-primary)';
        } else {
          destPosEl.textContent = 'Not set';
          destPosEl.style.color = 'var(--color-text-muted)';
        }
      }

      // 9. Start Button
      const startBtn = document.getElementById('start-btn');
      if (startBtn) {
        if (activeRobot.status === 'moving') {
          startBtn.style.opacity = '0.5';
          startBtn.style.cursor  = 'not-allowed';
        } else {
          startBtn.style.opacity = '1';
          startBtn.style.cursor  = 'pointer';
        }
      }
    }

    // Highlight the active robot's card
    const cards = document.querySelectorAll('.robot-card');
    cards.forEach((card) => {
      const rid = card.getAttribute('data-robot');
      const r   = robots[rid];
      if (activeRobot && rid === selectedRobotId && r) {
        card.classList.add('selected');
        card.style.borderColor = r.colorHex;
        card.style.boxShadow   = `0 0 10px ${r.colorHex}35`;
      } else {
        card.classList.remove('selected');
        card.style.borderColor = 'var(--color-border)';
        card.style.boxShadow   = 'none';
      }
    });

    // Refresh Live Fleet Overview
    updateLiveOverview();
  };

  // ── Fleet Counter & Limit ───────────────────────────────────────────────────
  const updateFleetCounter = () => {
    const count = Object.keys(robots).length;
    const countEl = document.getElementById('fleet-count-val');
    if (countEl) {
      countEl.textContent = count === 1 ? '1 ROBOT' : `${count} ROBOTS`;
    }

    const addBtn = document.getElementById('btn-add-robot');
    const limitNoticeEl = document.getElementById('fleet-limit-notice');

    if (count >= MAX_ROBOTS) {
      if (addBtn) addBtn.disabled = true;
      if (limitNoticeEl) limitNoticeEl.style.display = 'block';
    } else {
      if (addBtn) addBtn.disabled = false;
      if (limitNoticeEl) limitNoticeEl.style.display = 'none';
    }

    // Refresh Live Fleet Overview
    updateLiveOverview();
  };

  // ── Dynamic Robot Selector (Fleet Cards) ────────────────────────────────────
  const renderRobotSelector = () => {
    const selectorEl = document.getElementById('robot-selector');
    if (!selectorEl) return;

    const ids = Object.keys(robots);
    if (ids.length === 0) {
      selectorEl.innerHTML = '<div class="robot-selector-empty">No robots configured</div>';
      return;
    }

    selectorEl.innerHTML = ids.map((id) => {
      const r = robots[id];
      if (!r) return '';
      const isSelected  = id === selectedRobotId;
      const statusText  = (r.status || 'idle').toUpperCase();
      const statusClass = `badge-${(r.status || 'idle').toLowerCase()}`;
      return `
        <div class="robot-card ${isSelected ? 'selected' : ''}" data-robot="${id}" style="${isSelected ? `border-color: ${r.colorHex}; box-shadow: 0 0 10px ${r.colorHex}35;` : ''}">
          <div class="robot-card-top">
            <div class="robot-card-identity">
              <span class="robot-card-dot" style="background: ${r.colorHex};"></span>
              <span class="robot-card-name" style="color: ${r.colorHex};">${id}</span>
            </div>
            <span class="robot-card-badge ${statusClass}">● ${statusText}</span>
          </div>
          <div class="robot-card-bottom">
            <span class="robot-card-priority">Priority: ${r.priority}</span>
            <button class="robot-card-remove-btn" data-remove="${id}" type="button" title="Remove ${id}">REMOVE</button>
          </div>
        </div>
      `;
    }).join('');

    // Wire card selection click & pointerdown
    const cards = selectorEl.querySelectorAll('.robot-card');
    cards.forEach((card) => {
      const id = card.getAttribute('data-robot');
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        selectRobot(id);
      });
      card.addEventListener('pointerdown', (e) => e.stopPropagation());
      card.addEventListener('mousedown', (e) => e.stopPropagation());
    });

    // Wire REMOVE buttons with event isolation
    const removeBtns = selectorEl.querySelectorAll('.robot-card-remove-btn');
    removeBtns.forEach((btn) => {
      const id = btn.getAttribute('data-remove');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeRobot(id);
      });
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('mousedown', (e) => e.stopPropagation());
    });

    updateStatusUI();
  };

  // ── Robot Removal ─────────────────────────────────────────────────────────────
  const removeRobot = (robotId) => {
    if (!robotId || !robots[robotId]) return;

    const isCurrent = selectedRobotId === robotId;

    // Determine fallback selection if current active robot is removed
    let nextSelectedId = null;
    if (isCurrent) {
      const remainingIds = Object.keys(robots).filter((id) => id !== robotId);
      nextSelectedId = remainingIds.length > 0 ? remainingIds[0] : null;
    }

    // Notify caller (main.js) to clean up Phaser objects & delete from shared collections
    if (callbacks.onRemoveRobot) {
      callbacks.onRemoveRobot(robotId);
    }

    // Update internal selection
    if (isCurrent) {
      selectRobot(nextSelectedId);
    }

    renderRobotSelector();
    updateFleetCounter();
    updateStatusUI();
  };

  // ── Robot selection ───────────────────────────────────────────────────────────
  const selectRobot = (robotId) => {
    if (robotId && !robots[robotId]) {
      selectedRobotId = null;
    } else {
      selectedRobotId = robotId;
    }
    updateStatusUI();
    // Notify main.js so it can keep its shortcuts and window.* in sync
    callbacks.onRobotSelected(selectedRobotId);
  };

  // ── Fleet Conflicts panel ────────────────────────────────────────────────────
  const updateConflictPanel = (conflicts) => {
    const listEl  = document.getElementById('conflict-list');
    const badgeEl = document.getElementById('conflict-count-badge');
    if (!listEl) return;

    const n = conflicts ? conflicts.length : 0;
    if (badgeEl) {
      badgeEl.textContent    = n;
      badgeEl.style.background = n > 0 ? '#ef4444' : '#334155';
      badgeEl.style.color      = n > 0 ? '#ffffff' : '#94a3b8';
    }

    if (n === 0) {
      listEl.innerHTML = '<span style="color:#64748b;font-style:italic;font-size:11px;">No predicted conflicts</span>';
      return;
    }

    listEl.innerHTML = conflicts.map((c) => {
      if (c.type === 'vertex') {
        return `<div style="background:rgba(239,68,68,.12);border-left:3px solid #ef4444;padding:5px 8px;border-radius:4px;margin-bottom:3px;">
  <div style="font-weight:700;color:#f87171;font-size:11px;">⚠ ${c.robotA} ↔ ${c.robotB}</div>
  <div style="color:#e2e8f0;font-size:11px;margin-top:1px;">Vertex @ (${c.tileX}, ${c.tileY})</div>
  <div style="color:#94a3b8;font-size:10px;">ETA: ${c.timeA}s / ${c.timeB}s (Δ${c.timeDiff}s)</div>
</div>`;
      } else {
        return `<div style="background:rgba(249,115,22,.12);border-left:3px solid #f97316;padding:5px 8px;border-radius:4px;margin-bottom:3px;">
  <div style="font-weight:700;color:#fb923c;font-size:11px;">⚠ ${c.robotA} ↔ ${c.robotB}</div>
  <div style="color:#e2e8f0;font-size:11px;margin-top:1px;">Edge (${c.fromA.tileX},${c.fromA.tileY})↔(${c.toA.tileX},${c.toA.tileY})</div>
  <div style="color:#94a3b8;font-size:10px;">ETA: ~${c.timeA}s / ~${c.timeB}s</div>
</div>`;
      }
    }).join('');

    // Refresh Live Fleet Overview with updated conflict data
    updateLiveOverview(conflicts);
  };

  // ── Button wiring ─────────────────────────────────────────────────────────────

  // + ADD ROBOT button
  const addBtn = document.getElementById('btn-add-robot');
  if (addBtn) {
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (callbacks.onAddRobot) {
        callbacks.onAddRobot();
      }
    });
    addBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    addBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // START button
  const startBtn = document.getElementById('start-btn');
  if (startBtn) {
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (selectedRobotId && robots[selectedRobotId]) {
        callbacks.startRobotMovement(selectedRobotId);
      }
    });
    startBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    startBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // START ALL button
  const startAllBtn = document.getElementById('start-all-btn');
  if (startAllBtn) {
    startAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof callbacks.startAllRobots === 'function') {
        callbacks.startAllRobots();
      }
    });
    startAllBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    startAllBtn.addEventListener('mousedown', (e) => e.stopPropagation());
  }

  // ── Configuration Inputs Wiring ───────────────────────────────────────────────
  const isolateEvent = (el) => {
    if (!el) return;
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('mousedown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => e.stopPropagation());
    el.addEventListener('keydown', (e) => e.stopPropagation());
  };

  const configForm = document.getElementById('config-form');
  isolateEvent(configForm);

  // Speed input
  const speedInput = document.getElementById('config-speed-input');
  if (speedInput) {
    isolateEvent(speedInput);
    const applySpeed = () => {
      if (!selectedRobotId || !robots[selectedRobotId]) return;
      let val = parseInt(speedInput.value, 10);
      if (isNaN(val) || val < 10) val = 10;
      if (val > 500) val = 500;
      speedInput.value = val;
      robots[selectedRobotId].speed = val;
      if (callbacks.onSpeedChanged) callbacks.onSpeedChanged(selectedRobotId);
    };
    speedInput.addEventListener('change', applySpeed);
    speedInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseInt(speedInput.value, 10);
      if (!isNaN(val) && val >= 10 && val <= 500) {
        if (selectedRobotId && robots[selectedRobotId]) {
          robots[selectedRobotId].speed = val;
          if (callbacks.onSpeedChanged) callbacks.onSpeedChanged(selectedRobotId);
        }
      }
    });
  }

  // Priority input
  const priorityInput = document.getElementById('config-priority-input');
  if (priorityInput) {
    isolateEvent(priorityInput);
    const applyPriority = () => {
      if (!selectedRobotId || !robots[selectedRobotId]) return;
      let val = parseInt(priorityInput.value, 10);
      if (isNaN(val) || val < 1) val = 1;
      if (val > 10) val = 10;
      priorityInput.value = val;
      robots[selectedRobotId].priority = val;
      // Update fleet card priority immediately
      const card = document.querySelector(`.robot-card[data-robot="${selectedRobotId}"]`);
      if (card) {
        const pEl = card.querySelector('.robot-card-priority');
        if (pEl) pEl.textContent = `Priority: ${val}`;
      }
      if (callbacks.onPriorityChanged) callbacks.onPriorityChanged(selectedRobotId);
    };
    priorityInput.addEventListener('change', applyPriority);
    priorityInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const val = parseInt(priorityInput.value, 10);
      if (!isNaN(val) && val >= 1 && val <= 10) {
        if (selectedRobotId && robots[selectedRobotId]) {
          robots[selectedRobotId].priority = val;
          const card = document.querySelector(`.robot-card[data-robot="${selectedRobotId}"]`);
          if (card) {
            const pEl = card.querySelector('.robot-card-priority');
            if (pEl) pEl.textContent = `Priority: ${val}`;
          }
          if (callbacks.onPriorityChanged) callbacks.onPriorityChanged(selectedRobotId);
        }
      }
    });
  }

  // Battery slider
  const batteryInput = document.getElementById('config-battery-input');
  const batteryVal   = document.getElementById('config-battery-val');
  if (batteryInput) {
    isolateEvent(batteryInput);
    batteryInput.addEventListener('input', (e) => {
      e.stopPropagation();
      if (!selectedRobotId || !robots[selectedRobotId]) return;
      let val = parseInt(batteryInput.value, 10);
      if (isNaN(val)) val = 100;
      val = Math.max(0, Math.min(100, val));
      robots[selectedRobotId].battery = val;
      if (batteryVal) batteryVal.textContent = `${val}%`;
    });
  }

  // Task select
  const taskSelect = document.getElementById('config-task-select');
  if (taskSelect) {
    isolateEvent(taskSelect);
    taskSelect.addEventListener('change', (e) => {
      e.stopPropagation();
      if (!selectedRobotId || !robots[selectedRobotId]) return;
      robots[selectedRobotId].task = taskSelect.value;
    });
  }

  // Initial UI render
  renderRobotSelector();
  updateFleetCounter();
  updateStatusUI();

  // ── Accessors ─────────────────────────────────────────────────────────────────
  const getSelectedRobotId = () => selectedRobotId;
  const setSelectedRobotId = (id) => { selectedRobotId = id; };

  return {
    updateStatusUI,
    selectRobot,
    removeRobot,
    updateConflictPanel,
    getSelectedRobotId,
    setSelectedRobotId,
    renderRobotSelector,
    updateFleetCounter,
    updateLiveOverview
  };
}
