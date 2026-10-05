/**
 * robots/robotDrag.js
 * Responsible for all drag-and-drop behaviour:
 *   - Making each robot sprite draggable
 *   - Validating drop position against the Roads layer
 *   - Snapping to tile centre on valid drop
 *   - Restoring to previous valid position on invalid drop
 *   - Preventing drag while robot is moving
 *   - Preventing camera pan from triggering during a robot drag
 *
 * The drag behaviour is preserved verbatim from the original main.js.
 * Do NOT alter drag or snapping logic.
 */

/**
 * Set up drag handling for all robots in the fleet.
 *
 * `isDraggingRef` and `wasDraggingRef` are plain objects with a `.value`
 * property so the camera-pan code in main.js can read the live flag by reference.
 *
 * @param {Phaser.Scene} scene
 * @param {Phaser.Tilemaps.Tilemap} map
 * @param {Phaser.Tilemaps.TilemapLayer} roadsLayer
 * @param {Object.<string, object>} robots
 * @param {Object.<string, Phaser.GameObjects.Sprite>} robotSprites
 * @param {{
 *   selectRobot: Function,
 *   updateStatusUI: Function,
 *   recalculateRobotPath: Function
 * }} callbacks
 * @returns {{
 *   isDraggingRef:  { value: boolean },
 *   wasDraggingRef: { value: boolean },
 *   resetDragState: Function
 * }}
 */
export function setupRobotDrag(scene, map, roadsLayer, robots, robotSprites, callbacks) {

  // Mutable flags wrapped in objects so callers can read `ref.value` by reference
  const isDraggingRef  = { value: false };
  const wasDraggingRef = { value: false };

  const resetDragState = () => {
    isDraggingRef.value  = false;
    wasDraggingRef.value = false;
  };

  const registerRobotDrag = (robotId) => {
    const sprite = robotSprites[robotId];
    const r      = robots[robotId];
    if (!sprite || !r) return;

    sprite.setInteractive({ draggable: true, useHandCursor: true });

    sprite.on('pointerdown', () => {
      callbacks.selectRobot(robotId);
      if (r.status === 'moving') return;
      isDraggingRef.value  = true;
      wasDraggingRef.value = true;
    });

    sprite.on('dragstart', () => {
      if (r.status === 'moving') return;
      isDraggingRef.value  = true;
      wasDraggingRef.value = true;
      r.previousValidPosition = { x: sprite.x, y: sprite.y };
    });

    sprite.on('drag', (pointer, dragX, dragY) => {
      if (r.status === 'moving') return;
      sprite.x = dragX;
      sprite.y = dragY;
    });

    sprite.on('dragend', () => {
      if (r.status === 'moving') return;
      isDraggingRef.value = false;

      const tileX    = map.worldToTileX(sprite.x);
      const tileY    = map.worldToTileY(sprite.y);
      const roadTile = roadsLayer.getTileAt(tileX, tileY);

      if (roadTile && roadTile.index > 0) {
        // Valid road tile — snap to logical corridor centerline
        let snapX = map.tileToWorldX(tileX) + 16;
        let snapY = map.tileToWorldY(tileY) + 16;
        let navX = tileX;
        let navY = tileY;

        if (callbacks.physicalToLogical) {
          const logicalNode = callbacks.physicalToLogical(tileX, tileY);
          if (logicalNode) {
            snapX = logicalNode.worldX;
            snapY = logicalNode.worldY;
            navX  = logicalNode.navX;
            navY  = logicalNode.navY;
          }
        }

        sprite.setPosition(snapX, snapY);
        r.previousValidPosition = { x: snapX, y: snapY };
        r.x = snapX;
        r.y = snapY;
        r.start = { x: snapX, y: snapY, tileX, tileY, navX, navY };
        if (r.status === 'completed') r.status = 'idle';
        callbacks.updateStatusUI();
        callbacks.recalculateRobotPath(robotId);
      } else {
        // Invalid tile — restore last valid position
        sprite.setPosition(r.previousValidPosition.x, r.previousValidPosition.y);
      }
    });

    sprite.on('pointerup', () => {
      isDraggingRef.value = false;
    });
  };

  Object.keys(robotSprites).forEach(registerRobotDrag);

  return { isDraggingRef, wasDraggingRef, resetDragState, registerRobotDrag };
}
