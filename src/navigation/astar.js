/**
 * navigation/astar.js
 * A* pathfinding on the logical navigation graph (4-directional, Manhattan heuristic, cost = 1).
 *
 * Rather than navigating on every independent 32px physical road tile (which produces
 * parallel-lane routing in 64px corridors), A* runs on the logical navigation graph derived
 * from the Roads layer. This ensures single-lane centerline routing, preserving full
 * connectivity across corners, T-junctions, and 4-way intersections.
 *
 * Algorithm details:
 *   - 4-direction movement (Up, Down, Left, Right) on logical nodes
 *   - Uniform cost = 1 per step
 *   - Manhattan distance heuristic on logical coordinates (navX, navY)
 *   - Bounds and walkability derived from logical navigation graph
 *   - Returns null when target is unreachable or outside road network
 */

import { createLogicalNavGrid } from './navGrid.js';

/**
 * Factory — captures map and roadsLayer, initializes the logical navigation grid,
 * and returns the pathfinding and coordinate-conversion functions.
 *
 * @param {Phaser.Tilemaps.Tilemap} map
 * @param {Phaser.Tilemaps.TilemapLayer} roadsLayer
 * @returns {object} Pathfinding and coordinate conversion interface
 */
export function createPathfinder(map, roadsLayer) {
  const navGrid = createLogicalNavGrid(map, roadsLayer);

  /**
   * Return true if physical tile (tx, ty) is within map bounds and has a road tile.
   *
   * @param {number} tx
   * @param {number} ty
   * @returns {boolean}
   */
  const isRoadWalkable = (tx, ty) => {
    return navGrid.isPhysicalRoad(tx, ty);
  };

  /**
   * Helper to resolve either physical tile coordinates or logical coordinates
   * to a valid logical navigation node.
   */
  const resolveNode = (x, y) => {
    // If fractional (e.g. tileX = 10.5, tileY = 4.5 representing centerline)
    if (x % 1 !== 0 || y % 1 !== 0) {
      const node = navGrid.getLogicalNode(Math.floor(x), Math.floor(y));
      if (node) return node;
    }
    // Map physical tile coordinates to logical node
    const physicalMapped = navGrid.physicalToLogical(Math.floor(x), Math.floor(y));
    if (physicalMapped) return physicalMapped;

    // Direct logical node lookup fallback
    return navGrid.getLogicalNode(x, y);
  };

  /**
   * Run A* on the logical navigation graph from start to target.
   * Accepts either physical tile coordinates or logical navigation coordinates.
   *
   * @param {number} startTileX
   * @param {number} startTileY
   * @param {number} targetTileX
   * @param {number} targetTileY
   * @returns {{ navX: number, navY: number, tileX: number, tileY: number, worldX: number, worldY: number }[] | null}
   */
  const findPath = (startTileX, startTileY, targetTileX, targetTileY, options = {}) => {
    const blockedNodes = new Set((options.blockedNodes || []).map((n) => `${n.navX ?? n.tileX},${n.navY ?? n.tileY}`));
    const blockedEdges = new Set((options.blockedEdges || []).map((e) => `${e.from.navX ?? e.from.tileX},${e.from.navY ?? e.from.tileY}->${e.to.navX ?? e.to.tileX},${e.to.navY ?? e.to.tileY}`));
    const nodeKey = (x, y) => `${x},${y}`;
    const edgeKey = (a, b) => `${a.navX ?? a.tileX},${a.navY ?? a.tileY}->${b.navX ?? b.tileX},${b.navY ?? b.tileY}`;
    const startNode  = resolveNode(startTileX, startTileY);
    const targetNode = resolveNode(targetTileX, targetTileY);

    if (!startNode || !targetNode) {
      return null;
    }

    // Never block the current start or destination node.
    blockedNodes.delete(nodeKey(startNode.navX, startNode.navY));
    blockedNodes.delete(nodeKey(targetNode.navX, targetNode.navY));

    // Edge case: start and destination in the same logical cell
    if (startNode.navX === targetNode.navX && startNode.navY === targetNode.navY) {
      return [{ ...startNode }];
    }

    const keyOf = (x, y) => `${x},${y}`;
    const heuristic = (x, y) => Math.abs(x - targetNode.navX) + Math.abs(y - targetNode.navY);

    const openSet  = [{ x: startNode.navX, y: startNode.navY, f: heuristic(startNode.navX, startNode.navY) }];
    const cameFrom = new Map();
    const gScore   = new Map();
    gScore.set(keyOf(startNode.navX, startNode.navY), 0);

    while (openSet.length > 0) {
      // Find node with lowest f score
      let lowestIdx = 0;
      for (let i = 1; i < openSet.length; i++) {
        if (openSet[i].f < openSet[lowestIdx].f) lowestIdx = i;
      }

      const current    = openSet.splice(lowestIdx, 1)[0];
      const currentKey = keyOf(current.x, current.y);

      // Goal reached — reconstruct path
      if (current.x === targetNode.navX && current.y === targetNode.navY) {
        const path = [];
        let curr = current;
        while (curr) {
          const node = navGrid.getLogicalNode(curr.x, curr.y);
          path.unshift({ ...node });
          curr = cameFrom.get(keyOf(curr.x, curr.y));
        }
        return path;
      }

      const currentG = gScore.get(currentKey) ?? Infinity;
      const neighbors = navGrid.getLogicalNeighbors(current.x, current.y);

      for (const neighbor of neighbors) {
        const nx = neighbor.navX;
        const ny = neighbor.navY;
        const neighborKey = keyOf(nx, ny);
        if (blockedNodes.has(neighborKey)) continue;
        if (blockedEdges.has(edgeKey({ navX: current.x, navY: current.y }, neighbor))) continue;
        const tentativeG  = currentG + 1;

        if (tentativeG < (gScore.get(neighborKey) ?? Infinity)) {
          cameFrom.set(neighborKey, { x: current.x, y: current.y });
          gScore.set(neighborKey, tentativeG);
          const f = tentativeG + heuristic(nx, ny);
          if (!openSet.some((n) => n.x === nx && n.y === ny)) {
            openSet.push({ x: nx, y: ny, f });
          }
        }
      }
    }

    return null; // Target unreachable
  };

  return {
    findPath,
    isRoadWalkable,
    isLogicalWalkable: navGrid.isLogicalWalkable,
    physicalToLogical: navGrid.physicalToLogical,
    logicalToPhysical: navGrid.logicalToPhysical,
    logicalToWorld:    navGrid.logicalToWorld,
    worldToLogical:    navGrid.worldToLogical,
    getLogicalNode:    navGrid.getLogicalNode
  };
}

