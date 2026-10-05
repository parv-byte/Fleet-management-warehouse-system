/**
 * navigation/navGrid.js
 * Logical navigation graph abstraction derived at runtime from the physical Roads layer.
 *
 * Background:
 *   The warehouse map visually contains 64px-wide (2-tile) road corridors.
 *   Treating each 32px tile as an independent walkable cell allows robots to travel
 *   side-by-side in parallel lanes, missing conflicts.
 *
 *   This module extracts 2×2 road blocks as logical navigation/centerline nodes.
 *   Overlapping 2×2 windows collapse the 2 physical tile rows/columns into a single
 *   logical lane/centerline along each corridor while preserving connectivity through
 *   corners, T-junctions, and 4-way intersections.
 *
 * Centerline alignment:
 *   For a 2×2 block with top-left tile (navX, navY), its physical world center is:
 *     worldX = (navX + 1) * TILE_SIZE
 *     worldY = (navY + 1) * TILE_SIZE
 *   This aligns precisely with the center of the 64px road corridor.
 */

import { TILE_SIZE, NAV_CELL_SIZE, NAV_TILE_FACTOR } from '../config/constants.js';

/**
 * Construct the logical navigation grid from the Roads layer.
 *
 * @param {Phaser.Tilemaps.Tilemap} map
 * @param {Phaser.Tilemaps.TilemapLayer} roadsLayer
 * @returns {object} Logical navigation grid interface
 */
export function createLogicalNavGrid(map, roadsLayer) {
  const nodes = new Map(); // key: `${x},${y}` -> node

  const keyOf = (x, y) => `${x},${y}`;

  /**
   * Check if a physical tile (tx, ty) has a valid road tile.
   *
   * @param {number} tx
   * @param {number} ty
   * @returns {boolean}
   */
  const isPhysicalRoad = (tx, ty) => {
    if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) return false;
    const tile = roadsLayer.getTileAt(tx, ty);
    return !!(tile && tile.index > 0);
  };

  /**
   * Check if a 2×2 block with top-left at (x, y) is composed entirely of road tiles.
   *
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  const is2x2Road = (x, y) => {
    return (
      isPhysicalRoad(x, y) &&
      isPhysicalRoad(x + 1, y) &&
      isPhysicalRoad(x, y + 1) &&
      isPhysicalRoad(x + 1, y + 1)
    );
  };

  // 1. Scan map to identify all 2×2 road blocks
  for (let y = 0; y < map.height - 1; y++) {
    for (let x = 0; x < map.width - 1; x++) {
      if (is2x2Road(x, y)) {
        nodes.set(keyOf(x, y), {
          navX: x,
          navY: y,
          // Fractional physical tile representation of centerline:
          tileX: x + 0.5,
          tileY: y + 0.5,
          // World pixel coordinates of corridor centerline:
          worldX: (x + 1) * TILE_SIZE,
          worldY: (y + 1) * TILE_SIZE
        });
      }
    }
  }

  // 4 cardinal directions
  const CARDINAL_DIRS = [
    { dx: 0,  dy: -1 }, // Up
    { dx: 0,  dy:  1 }, // Down
    { dx: -1, dy:  0 }, // Left
    { dx:  1, dy:  0 }  // Right
  ];

  /**
   * Return true if (navX, navY) is a valid logical navigation node.
   *
   * @param {number} navX
   * @param {number} navY
   * @returns {boolean}
   */
  const isLogicalWalkable = (navX, navY) => {
    return nodes.has(keyOf(navX, navY));
  };

  /**
   * Get 4-directional logical neighbors for a given logical node.
   *
   * @param {number} navX
   * @param {number} navY
   * @returns {object[]}
   */
  const getLogicalNeighbors = (navX, navY) => {
    const neighbors = [];
    for (const dir of CARDINAL_DIRS) {
      const nx = navX + dir.dx;
      const ny = navY + dir.dy;
      const neighbor = nodes.get(keyOf(nx, ny));
      if (neighbor) {
        neighbors.push(neighbor);
      }
    }
    return neighbors;
  };

  /**
   * Convert physical tile coordinates (tileX, tileY) to the most appropriate
   * logical navigation node.
   *
   * Deterministic rule:
   * A physical tile (tx, ty) belongs to at most 4 2×2 blocks:
   * (tx, ty), (tx-1, ty), (tx, ty-1), and (tx-1, ty-1).
   * From all valid 2×2 blocks containing this tile, we choose the one with
   * minimum Euclidean distance between the physical tile center (tx + 0.5, ty + 0.5)
   * and the logical node center (candidate.navX + 1, candidate.navY + 1).
   * Tie-breaker: smaller navX, then smaller navY.
   *
   * @param {number} tileX
   * @param {number} tileY
   * @returns {object|null}
   */
  const physicalToLogical = (tileX, tileY) => {
    if (!isPhysicalRoad(tileX, tileY)) return null;

    const candidates = [
      { x: tileX,     y: tileY },
      { x: tileX - 1, y: tileY },
      { x: tileX,     y: tileY - 1 },
      { x: tileX - 1, y: tileY - 1 }
    ].filter((c) => nodes.has(keyOf(c.x, c.y)));

    if (candidates.length === 0) return null;

    const px = tileX + 0.5;
    const py = tileY + 0.5;

    candidates.sort((a, b) => {
      const da = Math.hypot((a.x + 1) - px, (a.y + 1) - py);
      const db = Math.hypot((b.x + 1) - px, (b.y + 1) - py);
      if (Math.abs(da - db) > 1e-5) return da - db;
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

    return nodes.get(keyOf(candidates[0].x, candidates[0].y));
  };

  /**
   * Convert logical navigation coordinates (navX, navY) to physical tile coordinates.
   *
   * @param {number} navX
   * @param {number} navY
   * @returns {{ tileX: number, tileY: number, centerX: number, centerY: number }|null}
   */
  const logicalToPhysical = (navX, navY) => {
    const node = nodes.get(keyOf(navX, navY));
    if (!node) return null;
    return {
      tileX: node.navX,
      tileY: node.navY,
      centerX: node.tileX,
      centerY: node.tileY
    };
  };

  /**
   * Convert logical navigation coordinates to physical world pixel coordinates.
   *
   * @param {number} navX
   * @param {number} navY
   * @returns {{ worldX: number, worldY: number }|null}
   */
  const logicalToWorld = (navX, navY) => {
    const node = nodes.get(keyOf(navX, navY));
    if (!node) return null;
    return { worldX: node.worldX, worldY: node.worldY };
  };

  /**
   * Convert physical world coordinates to the nearest logical navigation node.
   *
   * @param {number} worldX
   * @param {number} worldY
   * @returns {object|null}
   */
  const worldToLogical = (worldX, worldY) => {
    const tx = Math.floor(worldX / TILE_SIZE);
    const ty = Math.floor(worldY / TILE_SIZE);
    return physicalToLogical(tx, ty);
  };

  /**
   * Get a logical node directly by (navX, navY).
   *
   * @param {number} navX
   * @param {number} navY
   * @returns {object|null}
   */
  const getLogicalNode = (navX, navY) => {
    return nodes.get(keyOf(navX, navY)) || null;
  };

  return {
    isPhysicalRoad,
    isLogicalWalkable,
    getLogicalNeighbors,
    physicalToLogical,
    logicalToPhysical,
    logicalToWorld,
    worldToLogical,
    getLogicalNode,
    nodeCount: nodes.size
  };
}
