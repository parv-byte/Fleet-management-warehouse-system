/**
 * main.js
 * Entry point and scene orchestrator for the Warehouse Robot Fleet Simulation.
 *
 * Responsibilities:
 *   - Configure and launch the Phaser game
 *   - Implement the Phaser Scene lifecycle (preload / create)
 *   - Initialise every module and wire their callbacks together
 *   - Set up camera pan / zoom
 *   - Expose window.* debug handles (preserved from original)
 *
 * Implementation details live in the imported modules.
 */

import Phaser from 'phaser';

import { preloadWarehouseAssets, createWarehouseMap } from './map/warehouseLoader.js';
import { createRobots, addRobotToFleet, removeRobotFromFleet, restoreFleet } from './robots/robotManager.js';
import { createPathfinder } from './navigation/astar.js';
import { createPathVisualizer, createDestinationMarkerUpdater } from './navigation/pathVisualizer.js';
import { createConflictDetector } from './coordination/conflictDetection.js';
import { createMovementController } from './robots/robotMovement.js';
import { setupRobotDrag } from './robots/robotDrag.js';
import { createUIController } from './ui/robotControls.js';
import { setupMapControls } from './ui/mapControls.js';
import { CONFLICT_TIME_THRESHOLD, MAX_ROBOTS } from './config/constants.js';
import { scenarioService } from './scenarios/scenarioService.js';
import { scenarioRepository } from './scenarios/scenarioRepository.js';
import { createScenarioManager } from './ui/scenarioManager.js';
import {
  createRunSession,
  startRunSession,
  completeRunSession,
  areAllRobotsFinished,
  isRunActive,
  RUN_MODES,
  isValidRunMode
} from './simulation/runSession.js';
import { finaliseMetrics, compareRunMetrics } from './simulation/runMetrics.js';
import { createComparisonPanel } from './ui/comparisonPanel.js';
import { connectLiveBridge, setLiveBridgeEnabled, registerRobot, sendRobotState, unregisterRobot, onLiveMessage } from './network/liveBridge.js';

// ─────────────────────────────────────────────────────────────────────────────
class WarehouseScene extends Phaser.Scene {
  constructor() {
    super('WarehouseScene');
  }

  // ── Preload ──────────────────────────────────────────────────────────────────
  preload() {
    preloadWarehouseAssets(this);
  }

  // ── Create ───────────────────────────────────────────────────────────────────
  create() {

    // 1. Build the Tiled map (custom TSX loader)
    const { map, roadsLayer, floorLayer, buildingsLayer } = createWarehouseMap(this);

    // 2. Create the robot fleet (starts empty with zero robots)
    const containers = createRobots(this, map, roadsLayer);
    const { robots, robotSprites, destinationMarkers, pathGraphics, activeTweens } = containers;

    // ── Selected-robot shortcut (starts null with 0 robots) ─────────────────────
    let selectedRobotId = null;

    // ── Runtime run session (in-memory only, never written to Supabase) ──────────
    // Holds: scenarioId, sessionId, mode, status (IDLE/RUNNING/COMPLETED), initialSnapshots, metrics
    let activeRunSession = null;

    // ── Step 4: In-memory completed runs store ────────────────────────────────
    // Accumulates completed run records so later steps can compare
    // BASELINE vs OPTIMIZED for the same scenario.
    // This is NOT Supabase persistence — memory only, cleared on page reload.
    const completedRuns = [];

    // ── Step 4: Conflict edge-trigger tracking ────────────────────────────────
    // We count conflict *events* (when a new conflict set appears that did not
    // exist in the previous detection cycle) rather than per-frame samples.
    // prevConflictCount tracks the size of the last known conflict set so we
    // only increment the metrics counter when new conflicts emerge.
    let prevConflictCount = 0;

    // ── Selected run mode (persisted between loads until user changes it) ────────
    // Defaults to BASELINE; reset to BASELINE each time a scenario is loaded.
    let selectedRunMode = RUN_MODES.BASELINE;

    const optimizedMode = () => selectedRunMode === RUN_MODES.OPTIMIZED;

    // ── Run Mode Selector helpers ─────────────────────────────────────────────
    const modeBtnBaseline = document.getElementById('btn-mode-baseline');
    const modeBtnOptimized = document.getElementById('btn-mode-optimized');
    const startAllBtn = document.getElementById('start-all-btn');
    const runStatusDisplay = document.getElementById('run-status-display');
    const runStatusModeEl = document.getElementById('run-status-mode');
    const runStatusValEl = document.getElementById('run-status-val');

    /**
     * Reflect selectedRunMode visually on the segmented toggle.
     */
    const syncModeSelectorUI = () => {
      [modeBtnBaseline, modeBtnOptimized].forEach((btn) => {
        if (!btn) return;
        const isActive = btn.getAttribute('data-mode') === selectedRunMode;
        btn.classList.toggle('run-mode-btn--active', isActive);
      });
    };

    /**
     * Enable or disable both mode buttons (locked while RUNNING).
     * @param {boolean} disabled
     */
    const setModeSelectorDisabled = (disabled) => {
      [modeBtnBaseline, modeBtnOptimized].forEach((btn) => {
        if (btn) btn.disabled = disabled;
      });
    };

    /**
     * Enable or disable START ALL button (disabled while RUNNING).
     * @param {boolean} disabled
     */
    const setStartAllDisabled = (disabled) => {
      if (startAllBtn) {
        startAllBtn.disabled = disabled;
      }
    };

    /**
     * Update the compact status readout in the controls bar.
     * Shows "Mode: X · STATUS" after a scenario has been loaded.
     * @param {string|null} mode   - e.g. 'BASELINE'
     * @param {string|null} status - e.g. 'IDLE' | 'RUNNING' | 'COMPLETED' | null
     */
    const updateRunStatusDisplay = (mode, status) => {
      if (!runStatusDisplay) return;
      if (!mode || !status) {
        runStatusDisplay.style.display = 'none';
        return;
      }
      runStatusDisplay.style.display = 'flex';
      if (runStatusModeEl) runStatusModeEl.textContent = `Mode: ${mode}`;
      if (runStatusValEl) {
        runStatusValEl.textContent = status;
        runStatusValEl.setAttribute('data-status', status);
      }
    };

    // Wire mode button clicks
    [modeBtnBaseline, modeBtnOptimized].forEach((btn) => {
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const newMode = btn.getAttribute('data-mode');
        if (!isValidRunMode(newMode)) return;
        // Do not allow changes while running
        if (activeRunSession && activeRunSession.status === 'RUNNING') return;
        selectedRunMode = newMode;
        if (selectedRunMode === RUN_MODES.OPTIMIZED) {
          setLiveBridgeEnabled(true);
          connectLiveBridge();
          Object.values(robots).forEach((r) => registerRobot(r.id, r));
        } else {
          setLiveBridgeEnabled(false);
        }
        syncModeSelectorUI();
        // If a session is already IDLE/COMPLETED, update its mode retroactively
        // so the START button uses the new selection.
        if (activeRunSession && activeRunSession.status !== 'RUNNING') {
          activeRunSession.mode = selectedRunMode;
          updateRunStatusDisplay(selectedRunMode, activeRunSession.status);
          window.activeRunSession = activeRunSession;
        }
        console.log('[RunMode] Selected:', selectedRunMode);
      });
    });

    // Initial UI sync (BASELINE active by default from HTML, but enforce via JS)
    syncModeSelectorUI();

    // 3. Path visualizer + destination marker drawer
    const { updatePathVisualization } = createPathVisualizer(map, robots, pathGraphics);
    const { updateDestinationMarker } = createDestinationMarkerUpdater(robots, destinationMarkers);

    // 4. A* pathfinder on logical navigation graph
    const {
      findPath,
      physicalToLogical,
      logicalToPhysical,
      logicalToWorld,
      worldToLogical,
      isLogicalWalkable,
      isRoadWalkable
    } = createPathfinder(map, roadsLayer);

    // ── recalculateRobotPath needs conflict detection, declared before it ──────
    //    Forward-reference resolved by JS closure ordering below.

    // 5. Conflict detection — needs updateConflictPanel from UI controller.
    //    We break the ordering loop by wiring updateConflictPanel via a wrapper
    //    that is populated after the UI controller is created.
    let updateConflictPanelFn = () => { };

    const {
      conflictGraphics,
      detectFleetConflicts: _detectFleetConflicts,
      buildTimeParameterizedPath,
      detectVertexConflicts,
      detectEdgeConflicts,
      getConflicts
    } = createConflictDetector(this, map, robots, {
      updateConflictPanel: (conflicts) => updateConflictPanelFn(conflicts)
    });

    // Wrapped conflict detector — counts conflict events edge-triggered
    // while a run session is actively RUNNING
    const detectFleetConflicts = () => {
      const conflicts = _detectFleetConflicts();
      if (activeRunSession && activeRunSession.status === 'RUNNING') {
        const curCount = conflicts.length;
        if (curCount > prevConflictCount) {
          activeRunSession.metrics.conflicts += (curCount - prevConflictCount);
        }
        prevConflictCount = curCount;
      }
      return conflicts;
    };

    // ── recalculateRobotPath: ties pathfinder + visualizer + conflict ──────────
    const recalculateRobotPath = (robotId) => {
      if (!robotId) return;
      const r = robots[robotId];
      const sprite = robotSprites[robotId];
      if (!r || !sprite) return;

      if (!r.destination) {
        r.path = null;
        updatePathVisualization(robotId);
        return;
      }

      const startTileX = map.worldToTileX(sprite.x);
      const startTileY = map.worldToTileY(sprite.y);
      const path = findPath(startTileX, startTileY, r.destination.tileX, r.destination.tileY);
      r.path = path;
      updatePathVisualization(robotId);
      detectFleetConflicts();
    };

    // ── setRobotDestination ───────────────────────────────────────────────────
    const setRobotDestination = (robotId, tileX, tileY) => {
      if (!robotId) return false;
      const r = robots[robotId];
      if (!r || r.status === 'moving') return false;

      const roadTile = roadsLayer.getTileAt(tileX, tileY);
      if (roadTile && roadTile.index > 0) {
        let destX = map.tileToWorldX(tileX) + 16;
        let destY = map.tileToWorldY(tileY) + 16;
        let navX = tileX;
        let navY = tileY;

        const logicalNode = physicalToLogical(tileX, tileY);
        if (logicalNode) {
          destX = logicalNode.worldX;
          destY = logicalNode.worldY;
          navX = logicalNode.navX;
          navY = logicalNode.navY;
        }

        r.destination = { x: destX, y: destY, tileX, tileY, navX, navY };
        if (r.status === 'completed') r.status = 'idle';
        uiController.updateStatusUI();
        updateDestinationMarker(robotId);
        recalculateRobotPath(robotId);
        if (optimizedMode()) sendRobotState(robotId, r);
        return true;
      }
      return false;
    };

    // ── Comparison Panel Controller (Step 5) ─────────────────────────────────
    const comparisonPanel = createComparisonPanel({
      getCompletedRuns: () => completedRuns,
      getCurrentScenarioId: () => (activeRunSession ? activeRunSession.scenarioId : null)
    });
    window.comparisonPanel = comparisonPanel;

    // Deterministic local safety owner used ONLY by OPTIMIZED mode. This is
    // not a central controller: every browser-side robot independently applies
    // the same ordering rule while the edge agents exchange ML/P2P messages.
    const robotWins = (a, b) => {
      const pa = Number(a?.priority ?? 999), pb = Number(b?.priority ?? 999);
      if (pa !== pb) return pa < pb;
      const ba = Number(a?.battery ?? 0), bb = Number(b?.battery ?? 0);
      if (ba !== bb) return ba > bb;
      return String(a?.id || '').localeCompare(String(b?.id || '')) <= 0;
    };

    // 6. Movement controller
    const { startRobotMovement: _startRobotMovement, moveRobotToNextWaypoint, finishRobotMovement } =
      createMovementController(this, map, robots, robotSprites, activeTweens, {
        updateStatusUI: () => {
          uiController.updateStatusUI();
          // Check if all robots have now finished → mark session COMPLETED
          if (activeRunSession && activeRunSession.status === 'RUNNING' && areAllRobotsFinished(robots)) {
            completeRunSession(activeRunSession);

            // ── Step 4: Finalise metrics & archive completed run ──────────────
            finaliseMetrics(activeRunSession.metrics, activeRunSession, robots);
            const completedRecord = {
              scenarioId: activeRunSession.scenarioId,
              sessionId:  activeRunSession.sessionId,
              mode:       activeRunSession.mode,
              metrics:    { ...activeRunSession.metrics }
            };
            completedRuns.push(completedRecord);
            window.completedRuns = completedRuns;

            console.log('[RunSession] All robots finished — session COMPLETED:', activeRunSession.sessionId);
            console.log('[RunMetrics] Final metrics:', activeRunSession.metrics);

            // Re-enable SAVE CHANGES and mode selector now that run is done
            if (scenarioManagerRef) scenarioManagerRef.setRunActive(false);
            setModeSelectorDisabled(false);
            setStartAllDisabled(false);
            updateRunStatusDisplay(activeRunSession.mode, 'COMPLETED');

            // ── Step 5: Refresh comparison panel ──────────────────────────────
            comparisonPanel.update();

            window.activeRunSession = activeRunSession;
          }
        },
        detectFleetConflicts,
        // Optimized mode uses the same deterministic local resource gate as the
        // working ML/P2P backend. Baseline intentionally has no software gate.
        shouldYield: (robotId, waypointIndex, targetTile) => {
          if (!optimizedMode()) return false;
          const r = robots[robotId];
          const sprite = robotSprites[robotId];
          if (!r || !sprite || r.status !== 'moving') return false;
          const key = (n) => n ? `${n.navX ?? n.tileX},${n.navY ?? n.tileY}` : null;
          const currentKey = key(r.path?.[Math.max(0, waypointIndex - 1)]);
          const targetKey = key(targetTile);
          const distanceToTarget = (n, sp) => {
            if (!n || !sp) return Infinity;
            const x = n.worldX ?? (map.tileToWorldX(n.tileX) + 16);
            const y = n.worldY ?? (map.tileToWorldY(n.tileY) + 16);
            return Math.hypot(sp.x - x, sp.y - y);
          };
          for (const [peerId, peer] of Object.entries(robots)) {
            if (peerId === robotId || peer?.status !== 'moving' || !Array.isArray(peer.path)) continue;
            const ps = robotSprites[peerId];
            if (!ps) continue;
            const peerIndex = (() => {
              let best = 0, bestD = Infinity;
              for (let i = 0; i < peer.path.length; i++) {
                const d = distanceToTarget(peer.path[i], ps);
                if (d < bestD) { bestD = d; best = i; }
              }
              return best;
            })();
            const future = peer.path.slice(peerIndex, Math.min(peer.path.length, peerIndex + 10));
            const futureKeys = new Set(future.map(key));
            const peerNext = peer.path[peerIndex + 1];
            const myNext = targetTile;
            const opposite = key(peerNext) === currentKey && key(peer.path[peerIndex]) === key(myNext);
            if ((futureKeys.has(targetKey) || opposite) && !robotWins(r, peer)) return true;
          }
          return false;
        },
        // ── Step 4: Distance accumulation callback ────────────────────────────
        // Called from moveRobotToNextWaypoint with the pixel distance of each
        // tween segment so we accumulate real travel distance per session.
        onSegmentTravelled: (robotId, distancePx) => {
          if (activeRunSession && activeRunSession.status === 'RUNNING' && distancePx > 0) {
            activeRunSession.metrics.totalDistancePx =
              parseFloat((activeRunSession.metrics.totalDistancePx + distancePx).toFixed(2));
          }
        },
        // ── Step 4: Robot completion timestamp callback ────────────────────────
        // Sets a RUNTIME-ONLY completedAt field on the robot object when it
        // reaches its destination. This field is never saved to Supabase.
        onRobotCompleted: (robotId) => {
          const r = robots[robotId];
          if (r && !r.completedAt) {
            r.completedAt = new Date().toISOString();
          }
        }
      });

    /**
     * Start the entire eligible fleet together under ONE RunSession.
     * Eligible robots are those that are idle (not currently moving), have a destination
     * and a valid path with length > 1. Robots without valid destinations/paths are safely skipped.
     */
    const startAllRobots = () => {
      const allRobotList = Object.values(robots);
      const eligibleRobots = allRobotList.filter((r) => {
        return r &&
          r.status !== 'moving' &&
          r.destination &&
          Array.isArray(r.path) &&
          r.path.length > 1;
      });

      if (eligibleRobots.length === 0) {
        console.log('[RunSession] START ALL clicked, but no eligible idle robots with valid paths.');
        return;
      }

      if (activeRunSession && activeRunSession.status !== 'RUNNING') {
        startRunSession(activeRunSession);
        activeRunSession.metrics.totalRobots = Object.keys(robots).length;
        prevConflictCount = 0;
        console.log('[RunSession] Fleet run started — session RUNNING:', activeRunSession.sessionId, '| mode:', activeRunSession.mode);
        if (scenarioManagerRef) scenarioManagerRef.setRunActive(true);
        setModeSelectorDisabled(true);
        setStartAllDisabled(true);
        updateRunStatusDisplay(activeRunSession.mode, 'RUNNING');
      }

      if (optimizedMode()) {
        setLiveBridgeEnabled(true);
        connectLiveBridge();
        eligibleRobots.forEach((r) => registerRobot(r.id, r));
      }
      for (const r of eligibleRobots) {
        _startRobotMovement(r.id);
        if (optimizedMode()) sendRobotState(r.id, r);
      }
    };

    /**
     * Wrapped startRobotMovement — transitions the run session to RUNNING
     * before movement begins. Runtime changes remain in-memory only.
     * @param {string} robotId
     */
    const startRobotMovement = (robotId) => {
      if (activeRunSession && activeRunSession.status !== 'RUNNING') {
        startRunSession(activeRunSession);
        // ── Step 4: Record totalRobots at run start ───────────────────────────
        activeRunSession.metrics.totalRobots = Object.keys(robots).length;
        // Reset conflict edge-trigger counter for the new run
        prevConflictCount = 0;
        console.log('[RunSession] Run started — session RUNNING:', activeRunSession.sessionId, '| mode:', activeRunSession.mode);
        // Disable SAVE CHANGES and mode selector while run is active
        if (scenarioManagerRef) scenarioManagerRef.setRunActive(true);
        setModeSelectorDisabled(true);
        setStartAllDisabled(true);
        updateRunStatusDisplay(activeRunSession.mode, 'RUNNING');
      }
      if (optimizedMode()) {
        setLiveBridgeEnabled(true);
        connectLiveBridge();
        registerRobot(robotId, robots[robotId]);
      }
      _startRobotMovement(robotId);
      if (optimizedMode()) sendRobotState(robotId, robots[robotId]);
    };

    // 7. Drag handling
    const { isDraggingRef, wasDraggingRef, resetDragState, registerRobotDrag } =
      setupRobotDrag(this, map, roadsLayer, robots, robotSprites, {
        selectRobot: (id) => uiController.selectRobot(id),
        updateStatusUI: () => uiController.updateStatusUI(),
        recalculateRobotPath,
        physicalToLogical
      });

    // 8. UI controller
    const uiController = createUIController(robots, robotSprites, {
      startRobotMovement,
      startAllRobots,
      onRobotSelected: (robotId) => {
        selectedRobotId = robotId;
        window.selectedRobotId = robotId;
        window.robotState = robotId ? (robots[robotId] || null) : null;
      },
      onAddRobot: () => {
        const currentCount = Object.keys(robots).length;
        if (currentCount >= MAX_ROBOTS) return;

        const newRobotId = addRobotToFleet(this, map, roadsLayer, containers, { physicalToLogical });
        if (optimizedMode()) registerRobot(newRobotId, robots[newRobotId]);

        // Register drag handling for the newly created sprite
        registerRobotDrag(newRobotId);

        // Re-render selector and fleet count
        uiController.renderRobotSelector();
        uiController.updateFleetCounter();

        // If first robot or no robot currently selected, auto-select new robot
        if (!uiController.getSelectedRobotId()) {
          uiController.selectRobot(newRobotId);
        }

        // Re-evaluate fleet conflicts
        detectFleetConflicts();

        // Update debug window references
        window.robots = robots;
        window.robotSprites = robotSprites;
        window.conflicts = getConflicts();
        const curId = uiController.getSelectedRobotId();
        window.selectedRobotId = curId;
        window.robotState = curId ? (robots[curId] || null) : null;
      },
      onRemoveRobot: (robotId) => {
        if (optimizedMode()) unregisterRobot(robotId);
        removeRobotFromFleet(robotId, containers);

        // Re-evaluate fleet conflicts
        detectFleetConflicts();

        // Update debug window references
        window.robots = robots;
        window.robotSprites = robotSprites;
        window.conflicts = getConflicts();
        const curId = uiController.getSelectedRobotId();
        window.selectedRobotId = curId;
        window.robotState = curId ? (robots[curId] || null) : null;
      },
      onSpeedChanged: (robotId) => {
        // Recalculate time-parameterized prediction and fleet conflicts without altering path geometry
        detectFleetConflicts();
        window.conflicts = getConflicts();
      },
      onPriorityChanged: (robotId) => {
        detectFleetConflicts();
        window.conflicts = getConflicts();
      }
    });

    // Now that uiController exists, wire the conflict panel callback
    updateConflictPanelFn = (conflicts) => uiController.updateConflictPanel(conflicts);

    // ── OPTIMIZED edge decision consumer ─────────────────────────────────────
    // BASELINE never reaches this path because the bridge is disabled there.
    const applyOptimizedDecision = (p) => {
      if (!optimizedMode() || !p || p.type !== 'DECISION') return;
      const targetId = p.target || p.robotId;
      const r = robots[targetId];
      const sprite = robotSprites[targetId];
      if (!r || !sprite) return;

      console.log('[OPTIMIZED][EDGE DECISION]', {
        robot: targetId,
        against: p.against,
        modelDecision: p.modelDecision,
        peerModelDecision: p.peerModelDecision,
        finalDecision: p.decision,
        confidence: p.modelConfidence,
        winner: p.winner,
        conflictTile: p.conflictTile
      });

      if (p.decision === 'WAIT') {
        const tween = activeTweens[targetId];
        if (tween) { try { tween.stop(); } catch {} }
        activeTweens[targetId] = null;
        if (r.status !== 'completed') r.status = 'waiting';
        uiController.updateStatusUI();
        sendRobotState(targetId, r);
        return;
      }

      if (p.decision === 'SLOW') {
        r.aiSpeedFactor = 0.5;
        if (r.status === 'waiting') r.status = 'moving';
        uiController.updateStatusUI();
        if (r.status === 'moving') _startRobotMovement(targetId);
        sendRobotState(targetId, r);
        return;
      }

      if (p.decision === 'MOVE') {
        r.aiSpeedFactor = 1;
        if (r.status === 'waiting') r.status = 'moving';
        uiController.updateStatusUI();
        if (r.status === 'moving') _startRobotMovement(targetId);
        sendRobotState(targetId, r);
        return;
      }

      if (p.decision !== 'REROUTE' || !p.conflictTile || r.status === 'completed' || !r.destination) return;

      const conflictKey = `${p.against}|${p.conflictTile.navX ?? p.conflictTile.tileX},${p.conflictTile.navY ?? p.conflictTile.tileY}|${r.routeVersion || 0}`;
      if (r.lastRerouteKey === conflictKey) return;
      r.lastRerouteKey = conflictKey;

      const tween = activeTweens[targetId];
      if (tween) { try { tween.stop(); } catch {} }
      activeTweens[targetId] = null;

      const currentTileX = map.worldToTileX(sprite.x);
      const currentTileY = map.worldToTileY(sprite.y);
      const oldPath = Array.isArray(r.path) ? r.path.slice() : [];
      const key = (n) => n ? `${n.navX ?? n.tileX},${n.navY ?? n.tileY}` : null;
      const conflictNode = {
        navX: Number(p.conflictTile.navX ?? p.conflictTile.tileX),
        navY: Number(p.conflictTile.navY ?? p.conflictTile.tileY)
      };
      const conflictKeyNode = key(conflictNode);
      const peer = robots[p.against];
      const peerPath = Array.isArray(peer?.path) ? peer.path : [];
      const peerKeys = new Set(peerPath.map(key));

      const options = [
        { blockedNodes: [conflictNode], blockedEdges: [] }
      ];
      // Protect only the peer's immediate corridor. Never block the whole map.
      for (let i = 0; i < peerPath.length - 1; i++) {
        if (key(peerPath[i]) === conflictKeyNode) {
          options.push({
            blockedNodes: [conflictNode],
            blockedEdges: [{ from: peerPath[Math.max(0, i - 1)], to: peerPath[i] }]
          });
          break;
        }
      }

      const candidates = [];
      for (const opt of options) {
        const candidate = findPath(currentTileX, currentTileY, r.destination.tileX, r.destination.tileY, opt);
        if (!candidate || candidate.length < 2) continue;
        const keys = candidate.map(key);
        if (keys.includes(conflictKeyNode)) continue;

        // Require a real deviation before the contested node.
        const oldKeys = oldPath.map(key);
        const limit = Math.min(10, keys.length, oldKeys.length);
        let deviated = false;
        for (let i = 1; i < limit; i++) {
          if (keys[i] !== oldKeys[i]) { deviated = true; break; }
        }
        if (!deviated && oldKeys.length > 1) continue;

        const overlap = keys.slice(1, 12).filter((k) => peerKeys.has(k)).length;
        if (overlap > 0) continue;
        candidates.push({ path: candidate, overlap, edgeCount: opt.blockedEdges.length });
      }

      candidates.sort((a, b) => a.overlap - b.overlap || a.path.length - b.path.length || a.edgeCount - b.edgeCount);
      const chosen = candidates[0];
      if (!chosen) {
        r.status = 'waiting';
        uiController.updateStatusUI();
        sendRobotState(targetId, r);
        console.log('[OPTIMIZED][REROUTE] no valid alternate road; WAIT', { robot: targetId, conflict: conflictKeyNode });
        return;
      }

      r.path = chosen.path;
      r.routeVersion = (r.routeVersion || 0) + 1;
      r.status = 'moving';
      r.aiSpeedFactor = 1;
      updatePathVisualization(targetId);
      detectFleetConflicts();
      uiController.updateStatusUI();
      console.log('[OPTIMIZED][REROUTE SUCCESS]', {
        robot: targetId,
        against: p.against,
        conflict: conflictKeyNode,
        newPathLength: chosen.path.length,
        routeVersion: r.routeVersion,
        newPath: chosen.path.map(key)
      });
      _startRobotMovement(targetId);
      sendRobotState(targetId, r);
    };

    onLiveMessage((msg) => {
      if (msg?.type === 'P2P_PACKET') applyOptimizedDecision(msg.packet);
    });

    // Optimized telemetry: every robot publishes its current state to its own
    // edge agent. BASELINE deliberately does not execute this block.
    const optimizedTelemetryTimer = setInterval(() => {
      if (!optimizedMode()) return;
      for (const [robotId, r] of Object.entries(robots)) {
        const sprite = robotSprites[robotId];
        if (!r || !sprite) continue;
        r.x = sprite.x;
        r.y = sprite.y;
        sendRobotState(robotId, {
          id: r.id,
          x: r.x,
          y: r.y,
          tileX: map.worldToTileX(sprite.x),
          tileY: map.worldToTileY(sprite.y),
          destination: r.destination ? {
            tileX: r.destination.tileX,
            tileY: r.destination.tileY,
            navX: r.destination.navX,
            navY: r.destination.navY
          } : null,
          speed: r.speed,
          priority: r.priority,
          battery: r.battery,
          task: r.task,
          status: r.status,
          path: r.path || [],
          routeVersion: r.routeVersion || 0
        });
      }
    }, 120);

    // ── scenarioManagerRef — forward reference populated after createScenarioManager ─
    let scenarioManagerRef = null;

    // ── Scenario Manager ──────────────────────────────────────────────────────
    const scenarioManager = createScenarioManager({
      getScenarios: () => scenarioService.getScenarios(),
      onSaveScenario: async (name) => {
        const saved = await scenarioService.saveCurrentScenario(name, robots);
        return saved;
      },
      onUpdateScenario: async (id, name) => {
        // Guard: never persist runtime movement state back to Supabase during an active run.
        if (isRunActive(activeRunSession)) {
          console.warn('[RunSession] SAVE CHANGES blocked — run is currently ACTIVE. Load the scenario again to reset.');
          throw new Error('Cannot save scenario changes while a simulation run is active. Stop or reload the scenario first.');
        }
        const updated = await scenarioService.updateScenario(id, name, robots);
        return updated;
      },
      onLoadScenario: (scenario) => {
        if (!scenario || !Array.isArray(scenario.robots)) return;

        // ── Create a FRESH runtime session from the persisted scenario ─────────
        // Deep copies robot snapshots so the saved scenario is never mutated by
        // runtime movement. Loading the same scenario again always resets to
        // the original saved positions.
        // Reset run mode to BASELINE on every fresh scenario load
        selectedRunMode = RUN_MODES.BASELINE;
        setLiveBridgeEnabled(false);
        syncModeSelectorUI();
        setModeSelectorDisabled(false);
        setStartAllDisabled(false);

        // ── Create fresh session — mode defaults to BASELINE on load ──────────
        // The existing deepCopySnapshot / initialSnapshots isolation is fully
        // preserved inside createRunSession; mode is additive metadata only.
        activeRunSession = createRunSession(scenario.id, scenario.robots, selectedRunMode);
        console.log('[RunSession] New session created (IDLE):', {
          scenarioId: activeRunSession.scenarioId,
          sessionId: activeRunSession.sessionId,
          mode: activeRunSession.mode,
          robots: activeRunSession.initialSnapshots.map((s) => s.robotId)
        });

        // Re-enable SAVE CHANGES (run is IDLE after a fresh load)
        if (scenarioManagerRef) scenarioManagerRef.setRunActive(false);
        updateRunStatusDisplay(activeRunSession.mode, 'IDLE');

        // 1. Stop any currently moving robots
        Object.keys(activeTweens).forEach((id) => {
          if (activeTweens[id] && typeof activeTweens[id].stop === 'function') {
            try {
              activeTweens[id].stop();
            } catch (err) {
              console.warn(`Error stopping tween for ${id}:`, err);
            }
          }
          activeTweens[id] = null;
        });

        // 2. Restore the fleet from the PERSISTED snapshot (not runtime state)
        // restoreFleet uses scenario.robots which is the saved/canonical initial config
        const restoredIds = restoreFleet(this, containers, scenario.robots);

        // 3. Re-register drag handling for each restored robot sprite
        restoredIds.forEach((id) => {
          registerRobotDrag(id);
        });

        // 4. Recreate destination markers & recalculate navigation paths
        restoredIds.forEach((id) => {
          updateDestinationMarker(id);
          recalculateRobotPath(id);
        });

        // 5. Refresh conflict detection
        detectFleetConflicts();

        // 6. Refresh dashboard metrics/UI
        uiController.renderRobotSelector();
        uiController.updateFleetCounter();

        // 7. Select the first robot if fleet is non-empty
        const targetSelectId = restoredIds.length > 0 ? restoredIds[0] : null;
        uiController.selectRobot(targetSelectId);

        // 8. Update debug window references
        window.robots = robots;
        window.robotSprites = robotSprites;
        window.conflicts = getConflicts();
        window.selectedRobotId = targetSelectId;
        window.robotState = targetSelectId ? (robots[targetSelectId] || null) : null;
        window.activeRunSession = activeRunSession;

        // ── Step 5: Refresh comparison panel for the newly loaded scenario ──
        comparisonPanel.update();
      },
      onDeleteScenario: async (id) => {
        return await scenarioService.deleteScenario(id);
      }
    });

    // Populate forward reference so movement callbacks can reach scenarioManager
    scenarioManagerRef = scenarioManager;

    // ── Initial pass ──────────────────────────────────────────────────────────
    detectFleetConflicts();

    console.log('Warehouse map loaded successfully:', {
      dimensions: `${map.width}x${map.height} tiles (${map.widthInPixels}x${map.heightInPixels} px)`,
      tilesetsCount: map.tilesets.length,
      layers: { floor: !!floorLayer, roads: !!roadsLayer, buildings: !!buildingsLayer }
    });

    // 9. Camera setup: fit whole map, then enable pan + wheel zoom
    const camera = this.cameras.main;
    const mapWidthPx = map.widthInPixels;
    const mapHeightPx = map.heightInPixels;

    const calculateFitZoom = () => {
      const zoomX = this.scale.width / mapWidthPx;
      const zoomY = this.scale.height / mapHeightPx;
      return Math.min(zoomX, zoomY) * 0.92;
    };

    const fitZoom = calculateFitZoom();
    camera.setZoom(fitZoom);
    camera.centerOn(mapWidthPx / 2, mapHeightPx / 2);

    // Viewport boundaries: prevent camera from panning far outside warehouse map
    const boundMargin = 128; // ~4 tiles buffer
    camera.setBounds(
      -boundMargin,
      -boundMargin,
      mapWidthPx + boundMargin * 2,
      mapHeightPx + boundMargin * 2
    );

    // Dynamic zoom limits relative to current fit zoom
    const getMinZoom = () => calculateFitZoom() * 0.85;
    const getMaxZoom = () => calculateFitZoom() * 4.0;
    const ZOOM_STEP = 1.25;

    const zoomIn = () => {
      const targetZoom = Phaser.Math.Clamp(camera.zoom * ZOOM_STEP, getMinZoom(), getMaxZoom());
      camera.setZoom(targetZoom);
    };

    const zoomOut = () => {
      const targetZoom = Phaser.Math.Clamp(camera.zoom / ZOOM_STEP, getMinZoom(), getMaxZoom());
      camera.setZoom(targetZoom);
    };

    const resetView = () => {
      const currentFitZoom = calculateFitZoom();
      camera.setZoom(currentFitZoom);
      camera.centerOn(mapWidthPx / 2, mapHeightPx / 2);
    };

    // Wire interactive DOM map controls (+, −, Reset)
    setupMapControls({
      onZoomIn: zoomIn,
      onZoomOut: zoomOut,
      onResetView: resetView
    });

    let isDragging = false;
    let pointerDownPos = { x: 0, y: 0 };

    this.input.on('pointerdown', (pointer, currentlyOver) => {
      pointerDownPos.x = pointer.x;
      pointerDownPos.y = pointer.y;
      if (!currentlyOver || currentlyOver.length === 0) {
        isDragging = true;
      }
    });

    this.input.on('pointerup', (pointer, currentlyOver) => {
      const dragDistance = Phaser.Math.Distance.Between(
        pointerDownPos.x, pointerDownPos.y, pointer.x, pointer.y
      );
      const isRobotInteraction =
        wasDraggingRef.value ||
        (currentlyOver && currentlyOver.some((obj) => Object.values(robotSprites).includes(obj)));

      isDragging = false;
      resetDragState();

      // Only process destination selection on clean background click
      if (dragDistance <= 6 && !isRobotInteraction) {
        const currentId = uiController.getSelectedRobotId();
        if (currentId && robots[currentId]) {
          const worldPoint = camera.getWorldPoint(pointer.x, pointer.y);
          setRobotDestination(
            currentId,
            map.worldToTileX(worldPoint.x),
            map.worldToTileY(worldPoint.y)
          );
        }
      }
    });

    this.input.on('pointermove', (pointer) => {
      if (!isDraggingRef.value && (pointer.isDown || isDragging)) {
        camera.scrollX -= (pointer.x - pointer.prevPosition.x) / camera.zoom;
        camera.scrollY -= (pointer.y - pointer.prevPosition.y) / camera.zoom;
      }
    });

    this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
      const zoomFactor = 1.15;
      const minZoom = getMinZoom();
      const maxZoom = getMaxZoom();
      let newZoom = deltaY > 0 ? camera.zoom / zoomFactor : camera.zoom * zoomFactor;
      newZoom = Phaser.Math.Clamp(newZoom, minZoom, maxZoom);

      if (newZoom !== camera.zoom) {
        const worldPointBefore = camera.getWorldPoint(pointer.x, pointer.y);
        camera.setZoom(newZoom);
        const worldPointAfter = camera.getWorldPoint(pointer.x, pointer.y);
        camera.scrollX += worldPointBefore.x - worldPointAfter.x;
        camera.scrollY += worldPointBefore.y - worldPointAfter.y;
      }
    });

    this.scale.on('resize', (gameSize) => {
      camera.setSize(gameSize.width, gameSize.height);
      const newFitZoom = calculateFitZoom();
      camera.setZoom(newFitZoom);
      camera.centerOn(mapWidthPx / 2, mapHeightPx / 2);
      camera.setBounds(
        -boundMargin,
        -boundMargin,
        mapWidthPx + boundMargin * 2,
        mapHeightPx + boundMargin * 2
      );
    });

    // ── window.* debug exports (preserved from original) ─────────────────────
    window.robots = robots;
    window.robotSprites = robotSprites;
    window.robotState = selectedRobotId ? (robots[selectedRobotId] || null) : null;
    window.selectedRobotId = selectedRobotId;
    window.CONFLICT_TIME_THRESHOLD = CONFLICT_TIME_THRESHOLD;
    window.MAX_ROBOTS = MAX_ROBOTS;
    window.conflicts = getConflicts();
    window.buildTimeParameterizedPath = buildTimeParameterizedPath;
    window.detectVertexConflicts = detectVertexConflicts;
    window.detectEdgeConflicts = detectEdgeConflicts;
    window.detectFleetConflicts = detectFleetConflicts;
    window.findPath = findPath;
    window.physicalToLogical = physicalToLogical;
    window.logicalToPhysical = logicalToPhysical;
    window.logicalToWorld = logicalToWorld;
    window.isLogicalWalkable = isLogicalWalkable;
    window.recalculateRobotPath = recalculateRobotPath;
    window.recalculatePath = () => {
      const id = uiController.getSelectedRobotId();
      if (id) recalculateRobotPath(id);
    };
    window.startRobotMovement = startRobotMovement;
    window.startAllRobots = startAllRobots;
    window.setRobotDestination = setRobotDestination;
    window.setDestination = (tileX, tileY) => {
      const id = uiController.getSelectedRobotId();
      if (id) setRobotDestination(id, tileX, tileY);
    };
    window.selectRobot = (id) => uiController.selectRobot(id);
    window.removeRobot = (id) => uiController.removeRobot(id);
    window.zoomIn = zoomIn;
    window.zoomOut = zoomOut;
    window.resetView = resetView;
    window.scenarioService = scenarioService;
    window.scenarioRepository = scenarioRepository;
    window.scenarioManager = scenarioManager;
    window.activeRunSession = activeRunSession;
    window.completedRuns = completedRuns;
    window.compareRunMetrics = compareRunMetrics;
    window.comparisonPanel = comparisonPanel;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
const config = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: window.innerWidth,
  height: window.innerHeight,
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  backgroundColor: '#1e1e24',
  scene: [WarehouseScene]
};

new Phaser.Game(config);
