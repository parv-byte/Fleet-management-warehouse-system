/**
 * map/warehouseLoader.js
 * Responsible for all Tiled map loading:
 *   - Preloading warehousemap.tmj, external TSX files, and tileset PNGs
 *   - Parsing the TMJ + embedded TSX XML at runtime (custom loader)
 *   - Building the Phaser Tilemap and its three layers (Floor, Roads, Buildings)
 *
 * The Roads layer is the single source of truth for walkability throughout
 * the rest of the application.
 */

import { TILESET_KEYS, TSX_KEY_MAP } from '../config/constants.js';

/**
 * Preload all warehouse map assets.
 * Call from WarehouseScene.preload().
 *
 * @param {Phaser.Scene} scene
 */
export function preloadWarehouseAssets(scene) {
  // 1. Load the warehouse map JSON
  scene.load.json('warehouse_tmj', '/map/warehousemap.tmj');

  // 2. Load the TSX files as raw text
  scene.load.text('roads_tsx',     '/map/tilesets/roads.tsx');
  scene.load.text('roads2_tsx',    '/map/tilesets/roads2.tsx');
  scene.load.text('roads3_tsx',    '/map/tilesets/roads3.tsx');
  scene.load.text('walls_tsx',     '/map/tilesets/walls.tsx');
  scene.load.text('wall2_tsx',     '/map/tilesets/wall2.tsx');
  scene.load.text('buildings_tsx', '/map/tilesets/buildings.tsx');
  scene.load.text('areas_tsx',     '/map/tilesets/areas.tsx');
  scene.load.text('object_tsx',    '/map/tilesets/object.tsx');
  scene.load.text('rooms_tsx',     '/map/tilesets/rooms.tsx');
  scene.load.text('rooms2_tsx',    '/map/tilesets/rooms2.tsx');

  // 3. Load the tileset image textures
  scene.load.image('roads',     '/map/images/roads.png');
  scene.load.image('roads2',    '/map/images/roads2.png');
  scene.load.image('roads3',    '/map/images/roads3.png');
  scene.load.image('walls',     '/map/images/walls.png');
  scene.load.image('wall2',     '/map/images/wall2.png');
  scene.load.image('buildings', '/map/images/buildings.png');
  scene.load.image('areas',     '/map/images/area.png');
  scene.load.image('object',    '/map/images/object.png');
  scene.load.image('rooms',     '/map/images/rooms.png');
  scene.load.image('rooms2',    '/map/images/rooms2.png');

  // 4. Load the robot spritesheet
  scene.load.spritesheet('robots', 'map/images/robots.png', {
    frameWidth: 64,
    frameHeight: 64
  });
}

/**
 * Parse the loaded TMJ + TSX data and create the Phaser Tilemap with layers.
 * Call from WarehouseScene.create() after preload completes.
 *
 * @param {Phaser.Scene} scene
 * @returns {{ map: Phaser.Tilemaps.Tilemap, floorLayer: Phaser.Tilemaps.TilemapLayer, roadsLayer: Phaser.Tilemaps.TilemapLayer, buildingsLayer: Phaser.Tilemaps.TilemapLayer }}
 */
export function createWarehouseMap(scene) {
  // Read the loaded TMJ JSON from cache (deep-copy to avoid mutating cached data)
  const tmjData = JSON.parse(JSON.stringify(scene.cache.json.get('warehouse_tmj')));

  // Helper: parse each external TSX file and embed its tileset definition in-memory.
  // This replaces the Tiled 'source' reference with real tileset properties so that
  // Phaser's Tiled parser can build the map without needing file-system access.
  const domParser = new DOMParser();

  tmjData.tilesets.forEach((tilesetDef) => {
    const source = tilesetDef.source;
    const tsxKey = TSX_KEY_MAP[source] || source;
    const tsxContent = scene.cache.text.get(tsxKey);

    if (tsxContent) {
      const xmlDoc = domParser.parseFromString(tsxContent, 'text/xml');
      const tilesetEl = xmlDoc.querySelector('tileset');
      const imageEl   = xmlDoc.querySelector('image');

      if (tilesetEl) {
        tilesetDef.name       = tilesetEl.getAttribute('name');
        tilesetDef.tilewidth  = parseInt(tilesetEl.getAttribute('tilewidth')  || '32', 10);
        tilesetDef.tileheight = parseInt(tilesetEl.getAttribute('tileheight') || '32', 10);
        tilesetDef.tilecount  = parseInt(tilesetEl.getAttribute('tilecount')  || '0',  10);
        tilesetDef.columns    = parseInt(tilesetEl.getAttribute('columns')    || '0',  10);
        tilesetDef.margin     = parseInt(tilesetEl.getAttribute('margin')     || '0',  10);
        tilesetDef.spacing    = parseInt(tilesetEl.getAttribute('spacing')    || '0',  10);
      }

      if (imageEl) {
        tilesetDef.image       = imageEl.getAttribute('source');
        tilesetDef.imagewidth  = parseInt(imageEl.getAttribute('width')  || '0', 10);
        tilesetDef.imageheight = parseInt(imageEl.getAttribute('height') || '0', 10);
      }

      delete tilesetDef.source;
    }
  });

  // Parse map data into Phaser MapData object
  const mapData = Phaser.Tilemaps.Parsers.Tiled.ParseJSONTiled('warehouse_map', tmjData, false);

  // Create Tilemap instance from parsed map data
  const map = new Phaser.Tilemaps.Tilemap(scene, mapData);

  // Attach textures to each tileset by its name
  const tilesets = TILESET_KEYS.map((key) => map.addTilesetImage(key, key)).filter(Boolean);

  // Create layers in order: Floor, Roads, Buildings
  const floorLayer     = map.createLayer('Floor',     tilesets, 0, 0);
  const roadsLayer     = map.createLayer('Roads',     tilesets, 0, 0);
  const buildingsLayer = map.createLayer('Buildings', tilesets, 0, 0);

  return { map, floorLayer, roadsLayer, buildingsLayer };
}
