/**
 * coordination/conflictDetection.js
 * Predictive fleet conflict detection — detects vertex and edge conflicts across
 * all unique robot pairs based on time-parameterized paths.
 *
 * Exported factory receives its dependencies; it DOES NOT import robots globally.
 *
 * Functions preserved verbatim from original main.js:
 *   buildTimeParameterizedPath()
 *   detectVertexConflicts()
 *   detectEdgeConflicts()
 *   detectFleetConflicts()
 *   renderConflicts()   (canvas drawing, depth 95)
 *
 * CONFLICT_TIME_THRESHOLD = 0.75 s (imported from constants).
 * Do NOT change the algorithm.
 */

import { CONFLICT_TIME_THRESHOLD } from '../config/constants.js';

/**
 * Create the conflict detection subsystem.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.Tilemaps.Tilemap} map
 * @param {Object.<string, object>} robots  - live robot state objects (mutated externally)
 * @param {{ updateConflictPanel: Function }} callbacks
 * @returns {{
 *   conflictGraphics: Phaser.GameObjects.Graphics,
 *   detectFleetConflicts: Function,
 *   buildTimeParameterizedPath: Function,
 *   detectVertexConflicts: Function,
 *   detectEdgeConflicts: Function,
 *   getConflicts: Function
 * }}
 */
export function createConflictDetector(scene, map, robots, callbacks) {

  // Dedicated graphics layer — depth 95 renders above paths (85) and
  // destination markers (90) but below robot sprites (100).
  const conflictGraphics = scene.add.graphics();
  conflictGraphics.setDepth(95);

  // Mutable conflict list shared within this closure
  let conflicts = [];

  // ── 1. TIME-PARAMETERIZED PATH ──────────────────────────────────────────────
  // Builds robotState.timePath – an ordered list of { navX, navY, tileX, tileY, worldX, worldY, time }
  // where `time` is cumulative seconds from the robot's current position along the corridor centerline.
  // Does NOT touch robotState.path.
  const buildTimeParameterizedPath = (robotId) => {
    const r = robots[robotId];
    if (!r || !r.path || r.path.length === 0) {
      if (r) r.timePath = null;
      return null;
    }
    const timePath = [];
    let t = 0.0;
    const first = r.path[0];
    const firstWx = first.worldX !== undefined ? first.worldX : (map.tileToWorldX(first.tileX) + 16);
    const firstWy = first.worldY !== undefined ? first.worldY : (map.tileToWorldY(first.tileY) + 16);

    timePath.push({
      navX:   first.navX !== undefined ? first.navX : first.tileX,
      navY:   first.navY !== undefined ? first.navY : first.tileY,
      tileX:  first.tileX,
      tileY:  first.tileY,
      worldX: firstWx,
      worldY: firstWy,
      time:   0.0
    });

    for (let i = 1; i < r.path.length; i++) {
      const prev = r.path[i - 1];
      const curr = r.path[i];
      const px = prev.worldX !== undefined ? prev.worldX : (map.tileToWorldX(prev.tileX) + 16);
      const py = prev.worldY !== undefined ? prev.worldY : (map.tileToWorldY(prev.tileY) + 16);
      const cx = curr.worldX !== undefined ? curr.worldX : (map.tileToWorldX(curr.tileX) + 16);
      const cy = curr.worldY !== undefined ? curr.worldY : (map.tileToWorldY(curr.tileY) + 16);
      const dist = Phaser.Math.Distance.Between(px, py, cx, cy);
      t += dist / (r.speed || 100);

      timePath.push({
        navX:   curr.navX !== undefined ? curr.navX : curr.tileX,
        navY:   curr.navY !== undefined ? curr.navY : curr.tileY,
        tileX:  curr.tileX,
        tileY:  curr.tileY,
        worldX: cx,
        worldY: cy,
        time:   parseFloat(t.toFixed(3))
      });
    }
    r.timePath = timePath;
    return timePath;
  };

  // ── 2. VERTEX CONFLICT DETECTOR ─────────────────────────────────────────────
  // Returns conflicts where robotA and robotB occupy the exact same logical node
  // within CONFLICT_TIME_THRESHOLD seconds of each other.
  const detectVertexConflicts = (idA, idB) => {
    const rA = robots[idA];
    const rB = robots[idB];
    if (!rA?.timePath || !rB?.timePath) return [];
    const found = [];
    for (const nA of rA.timePath) {
      for (const nB of rB.timePath) {
        if (nA.navX === nB.navX && nA.navY === nB.navY) {
          const dt = Math.abs(nA.time - nB.time);
          if (dt <= CONFLICT_TIME_THRESHOLD) {
            found.push({
              type: 'vertex',
              robotA: idA, robotB: idB,
              navX: nA.navX, navY: nA.navY,
              tileX: nA.tileX, tileY: nA.tileY,
              worldX: nA.worldX, worldY: nA.worldY,
              timeA: parseFloat(nA.time.toFixed(2)),
              timeB: parseFloat(nB.time.toFixed(2)),
              timeDiff: parseFloat(dt.toFixed(2))
            });
          }
        }
      }
    }
    return found;
  };

  // ── 3. EDGE CONFLICT DETECTOR ────────────────────────────────────────────────
  // Returns conflicts where robotA traverses logical edge A→B while robotB traverses
  // B→A, and both traversal intervals overlap within the safety threshold.
  const detectEdgeConflicts = (idA, idB) => {
    const rA = robots[idA];
    const rB = robots[idB];
    if (!rA?.timePath || !rB?.timePath) return [];
    if (rA.timePath.length < 2 || rB.timePath.length < 2) return [];
    const found = [];
    for (let i = 1; i < rA.timePath.length; i++) {
      const fromA = rA.timePath[i - 1];
      const toA   = rA.timePath[i];
      for (let j = 1; j < rB.timePath.length; j++) {
        const fromB = rB.timePath[j - 1];
        const toB   = rB.timePath[j];
        // Opposite traversal of the same logical edge?
        if (fromA.navX === toB.navX && fromA.navY === toB.navY &&
            toA.navX === fromB.navX && toA.navY === fromB.navY) {
          // Do the traversal time-intervals overlap (with threshold slack)?
          const overlap =
            fromA.time <= toB.time   + CONFLICT_TIME_THRESHOLD &&
            fromB.time <= toA.time   + CONFLICT_TIME_THRESHOLD;
          if (overlap) {
            found.push({
              type: 'edge',
              robotA: idA, robotB: idB,
              fromA: { navX: fromA.navX, navY: fromA.navY, tileX: fromA.tileX, tileY: fromA.tileY, worldX: fromA.worldX, worldY: fromA.worldY },
              toA:   { navX: toA.navX,   navY: toA.navY,   tileX: toA.tileX,   tileY: toA.tileY,   worldX: toA.worldX,   worldY: toA.worldY },
              fromB: { navX: fromB.navX, navY: fromB.navY, tileX: fromB.tileX, tileY: fromB.tileY, worldX: fromB.worldX, worldY: fromB.worldY },
              toB:   { navX: toB.navX,   navY: toB.navY,   tileX: toB.tileX,   tileY: toB.tileY,   worldX: toB.worldX,   worldY: toB.worldY },
              timeA: parseFloat(((fromA.time + toA.time) / 2).toFixed(2)),
              timeB: parseFloat(((fromB.time + toB.time) / 2).toFixed(2))
            });
          }
        }
      }
    }
    return found;
  };

  // ── 4. CONFLICT VISUALIZER ───────────────────────────────────────────────────
  // Draws warning markers on the Phaser canvas along the corridor centerline. Never modifies map tiles.
  const renderConflicts = () => {
    conflictGraphics.clear();
    if (!conflicts || conflicts.length === 0) return;

    for (const c of conflicts) {
      if (c.type === 'vertex') {
        const wx = c.worldX !== undefined ? c.worldX : (map.tileToWorldX(c.tileX) + 16);
        const wy = c.worldY !== undefined ? c.worldY : (map.tileToWorldY(c.tileY) + 16);
        // Soft outer glow
        conflictGraphics.lineStyle(8, 0xff1144, 0.25);
        conflictGraphics.strokeCircle(wx, wy, 16);
        // Bold ring
        conflictGraphics.lineStyle(2.5, 0xff2244, 0.95);
        conflictGraphics.strokeCircle(wx, wy, 13);
        // Semi-transparent fill
        conflictGraphics.fillStyle(0xff2244, 0.3);
        conflictGraphics.fillCircle(wx, wy, 13);
        // White ×
        conflictGraphics.lineStyle(2, 0xffffff, 0.95);
        conflictGraphics.lineBetween(wx - 5, wy - 5, wx + 5, wy + 5);
        conflictGraphics.lineBetween(wx - 5, wy + 5, wx + 5, wy - 5);
      } else if (c.type === 'edge') {
        const ax = c.fromA.worldX !== undefined ? c.fromA.worldX : (map.tileToWorldX(c.fromA.tileX) + 16);
        const ay = c.fromA.worldY !== undefined ? c.fromA.worldY : (map.tileToWorldY(c.fromA.tileY) + 16);
        const bx = c.toA.worldX   !== undefined ? c.toA.worldX   : (map.tileToWorldX(c.toA.tileX) + 16);
        const by = c.toA.worldY   !== undefined ? c.toA.worldY   : (map.tileToWorldY(c.toA.tileY) + 16);
        // Glow
        conflictGraphics.lineStyle(9, 0xff5500, 0.3);
        conflictGraphics.lineBetween(ax, ay, bx, by);
        // Sharp line
        conflictGraphics.lineStyle(3, 0xff6600, 0.95);
        conflictGraphics.lineBetween(ax, ay, bx, by);
        // Midpoint dot
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        conflictGraphics.fillStyle(0xffffff, 1);
        conflictGraphics.fillCircle(mx, my, 4);
        conflictGraphics.lineStyle(2, 0xff3300, 1);
        conflictGraphics.strokeCircle(mx, my, 6);
      }
    }
  };

  // ── 5. FLEET CONFLICT COORDINATOR ────────────────────────────────────────────
  // Rebuilds all time-parameterized paths, compares every unique robot pair,
  // then renders and reports results. Does NOT change any robot's behaviour.
  const detectFleetConflicts = () => {
    const ids = Object.keys(robots);

    // Rebuild time paths for all robots
    ids.forEach((id) => buildTimeParameterizedPath(id));

    // Collect conflicts from all unique pairs
    const all = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        all.push(...detectVertexConflicts(ids[i], ids[j]));
        all.push(...detectEdgeConflicts(ids[i], ids[j]));
      }
    }
    conflicts = all;

    renderConflicts();
    callbacks.updateConflictPanel(conflicts);
    return all;
  };

  /** Accessor so main.js can sync window.conflicts */
  const getConflicts = () => conflicts;

  return {
    conflictGraphics,
    detectFleetConflicts,
    buildTimeParameterizedPath,
    detectVertexConflicts,
    detectEdgeConflicts,
    getConflicts
  };
}
