/**
 * robots/robotMovement.js
 * Responsible for all robot movement:
 *   - startRobotMovement()        – validates state, sets status, launches tween chain
 *   - moveRobotToNextWaypoint()   – per-waypoint tween using speed-based duration
 *   - finishRobotMovement()       – snaps to destination, updates state, fires callbacks
 *
 * Movement algorithm is preserved verbatim from the original main.js.
 * Do NOT rewrite or alter movement behaviour.
 */

/**
 * Create the movement controller.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.Tilemaps.Tilemap} map
 * @param {Object.<string, object>} robots
 * @param {Object.<string, Phaser.GameObjects.Sprite>} robotSprites
 * @param {Object.<string, Phaser.Tweens.Tween|null>} activeTweens
 * @param {{
 *   updateStatusUI: Function,
 *   detectFleetConflicts: Function,
 *   onSegmentTravelled?: (robotId: string, distancePx: number) => void,
 *   onRobotCompleted?:   (robotId: string) => void
 * }} callbacks
 * @returns {{
 *   startRobotMovement: Function,
 *   moveRobotToNextWaypoint: Function,
 *   finishRobotMovement: Function
 * }}
 */
export function createMovementController(scene, map, robots, robotSprites, activeTweens, callbacks) {

  // ── Finish ────────────────────────────────────────────────────────────────────
  const finishRobotMovement = (robotId) => {
    const r = robots[robotId];
    const sprite = robotSprites[robotId];
    if (!r || !sprite) return;

    activeTweens[robotId] = null;
    if (r.destination) {
      const finalX = r.destination.x;
      const finalY = r.destination.y;
      const finalTileX = r.destination.tileX;
      const finalTileY = r.destination.tileY;

      sprite.setPosition(finalX, finalY);
      r.x = finalX;
      r.y = finalY;
      r.start.x = finalX;
      r.start.y = finalY;
      r.start.tileX = finalTileX;
      r.start.tileY = finalTileY;
      r.previousValidPosition = { x: finalX, y: finalY };
    }

    r.status = 'completed';

    // Step 4: Notify that this robot has completed its journey so main.js
    // can stamp a runtime completedAt timestamp. This is RUNTIME ONLY.
    if (typeof callbacks.onRobotCompleted === 'function') {
      callbacks.onRobotCompleted(robotId);
    }

    callbacks.updateStatusUI();
    // Refresh conflicts now that this robot has finished moving
    callbacks.detectFleetConflicts();
  };

  // ── Per-waypoint tween ────────────────────────────────────────────────────────
  const moveRobotToNextWaypoint = (robotId, waypointIndex) => {
    const r = robots[robotId];
    const sprite = robotSprites[robotId];
    if (!r || !sprite || r.status !== 'moving') return;

    if (!r.path || waypointIndex >= r.path.length) {
      finishRobotMovement(robotId);
      return;
    }

    const targetTile = r.path[waypointIndex];

    // Optional optimized-mode local safety gate. BASELINE does not provide this
    // callback, so baseline movement remains the original straight execution.
    if (typeof callbacks.shouldYield === 'function' && callbacks.shouldYield(robotId, waypointIndex, targetTile)) {
      r.status = 'waiting';
      callbacks.updateStatusUI();
      const retry = () => {
        const current = robots[robotId];
        if (!current || !robotSprites[robotId] || current.status !== 'waiting') return;
        if (callbacks.shouldYield(robotId, waypointIndex, targetTile)) {
          scene.time.delayedCall(60, retry);
          return;
        }
        current.status = 'moving';
        callbacks.updateStatusUI();
        moveRobotToNextWaypoint(robotId, waypointIndex);
      };
      scene.time.delayedCall(60, retry);
      return;
    }

    const targetWorldX = targetTile.worldX !== undefined ? targetTile.worldX : (map.tileToWorldX(targetTile.tileX) + 16);
    const targetWorldY = targetTile.worldY !== undefined ? targetTile.worldY : (map.tileToWorldY(targetTile.tileY) + 16);

    const distance = Phaser.Math.Distance.Between(sprite.x, sprite.y, targetWorldX, targetWorldY);
    const speedFactor = Number(r.aiSpeedFactor ?? 1);
    const speed = Math.max(10, (r.speed || 100) * speedFactor);
    const duration = Math.max(1, (distance / speed) * 1000);

    activeTweens[robotId] = scene.tweens.add({
      targets: sprite,
      x: targetWorldX,
      y: targetWorldY,
      duration: duration,
      ease: 'Linear',
      onUpdate: () => {
        r.x = sprite.x;
        r.y = sprite.y;
      },
      onComplete: () => {
        r.x = targetWorldX;
        r.y = targetWorldY;
        r.start.x = targetWorldX;
        r.start.y = targetWorldY;
        r.start.tileX = targetTile.tileX;
        r.start.tileY = targetTile.tileY;
        if (targetTile.navX !== undefined) {
          r.start.navX = targetTile.navX;
          r.start.navY = targetTile.navY;
        }
        r.previousValidPosition = { x: targetWorldX, y: targetWorldY };

        // Step 4: Report pixel distance of this segment for totalDistancePx metric.
        if (typeof callbacks.onSegmentTravelled === 'function' && distance > 0) {
          callbacks.onSegmentTravelled(robotId, distance);
        }

        moveRobotToNextWaypoint(robotId, waypointIndex + 1);
      }
    });
  };

  // ── Start ─────────────────────────────────────────────────────────────────────
  const startRobotMovement = (robotId) => {
    const r = robots[robotId];
    const sprite = robotSprites[robotId];
    if (!r || !sprite) return;

    if (r.status === 'moving') return;

    if (!r.destination || !r.path || r.path.length === 0) return;

    // If already at or within same logical cell
    if (r.path.length <= 1) {
      finishRobotMovement(robotId);
      return;
    }

    r.status = 'moving';
    callbacks.updateStatusUI();
    // Re-run conflict detection when movement starts
    callbacks.detectFleetConflicts();

    const firstTargetX = r.path[0].worldX !== undefined ? r.path[0].worldX : (map.tileToWorldX(r.path[0].tileX) + 16);
    const firstTargetY = r.path[0].worldY !== undefined ? r.path[0].worldY : (map.tileToWorldY(r.path[0].tileY) + 16);
    const distToFirst = Phaser.Math.Distance.Between(sprite.x, sprite.y, firstTargetX, firstTargetY);

    let startIndex = 1;
    if (distToFirst > 4) {
      startIndex = 0;
    }

    moveRobotToNextWaypoint(robotId, startIndex);
  };

  return { startRobotMovement, moveRobotToNextWaypoint, finishRobotMovement };
}
