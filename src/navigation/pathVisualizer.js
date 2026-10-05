/**
 * navigation/pathVisualizer.js
 * Responsible for all path and destination-marker drawing on the Phaser canvas.
 *
 * Each robot retains its own colour (set in ROBOT_CONFIGS).
 * Graphics objects are owned by robotManager; this module only draws into them.
 *
 * Two factory functions are exported so each can be tested/replaced independently:
 *   - createPathVisualizer      → updatePathVisualization(robotId)
 *   - createDestinationMarkerUpdater → updateDestinationMarker(robotId)
 */

/**
 * Factory for path visualization.
 *
 * @param {Phaser.Tilemaps.Tilemap} map
 * @param {Object.<string, object>} robots          - robot state objects
 * @param {Object.<string, Phaser.GameObjects.Graphics>} pathGraphics
 * @returns {{ updatePathVisualization: Function }}
 */
export function createPathVisualizer(map, robots, pathGraphics) {

  /**
   * Clear and redraw the path for a single robot.
   * Draws a wide glow stroke, a sharp line, and waypoint dots.
   *
   * @param {string} robotId
   */
  const updatePathVisualization = (robotId) => {
    const r   = robots[robotId];
    const gfx = pathGraphics[robotId];
    if (!r || !gfx) return;

    gfx.clear();
    const path = r.path;
    if (!path || path.length <= 1) return;

    const color = r.color;
    const getPointX = (pt) => (pt.worldX !== undefined ? pt.worldX : map.tileToWorldX(pt.tileX) + 16);
    const getPointY = (pt) => (pt.worldY !== undefined ? pt.worldY : map.tileToWorldY(pt.tileY) + 16);

    const firstWorldX = getPointX(path[0]);
    const firstWorldY = getPointY(path[0]);

    // Wide glow stroke (semi-transparent)
    gfx.lineStyle(6, color, 0.35);
    gfx.beginPath();
    gfx.moveTo(firstWorldX, firstWorldY);
    for (let i = 1; i < path.length; i++) {
      gfx.lineTo(getPointX(path[i]), getPointY(path[i]));
    }
    gfx.strokePath();

    // Sharp line (opaque)
    gfx.lineStyle(2.5, color, 0.95);
    gfx.beginPath();
    gfx.moveTo(firstWorldX, firstWorldY);
    for (let i = 1; i < path.length; i++) {
      gfx.lineTo(getPointX(path[i]), getPointY(path[i]));
    }
    gfx.strokePath();

    // Intermediate waypoint dots
    gfx.fillStyle(color, 0.9);
    for (let i = 1; i < path.length - 1; i++) {
      gfx.fillCircle(getPointX(path[i]), getPointY(path[i]), 2.5);
    }
  };

  return { updatePathVisualization };
}

/**
 * Factory for destination marker drawing.
 *
 * @param {Object.<string, object>} robots
 * @param {Object.<string, Phaser.GameObjects.Graphics>} destinationMarkers
 * @returns {{ updateDestinationMarker: Function }}
 */
export function createDestinationMarkerUpdater(robots, destinationMarkers) {

  /**
   * Clear and redraw the crosshair destination marker for a robot.
   * Hides the marker when the robot has no destination.
   *
   * @param {string} robotId
   */
  const updateDestinationMarker = (robotId) => {
    const r      = robots[robotId];
    const marker = destinationMarkers[robotId];
    if (!r || !marker) return;

    marker.clear();
    if (!r.destination) {
      marker.setVisible(false);
      return;
    }

    const color = r.color;
    marker.lineStyle(2, color, 0.9);
    marker.strokeCircle(0, 0, 10);
    marker.fillStyle(color, 1);
    marker.fillCircle(0, 0, 3);
    marker.lineStyle(1.5, color, 0.9);
    marker.lineBetween(-14, 0, -5, 0);
    marker.lineBetween(5,   0, 14, 0);
    marker.lineBetween(0, -14, 0, -5);
    marker.lineBetween(0,   5, 0,  14);

    marker.setPosition(r.destination.x, r.destination.y);
    marker.setVisible(true);
  };

  return { updateDestinationMarker };
}
