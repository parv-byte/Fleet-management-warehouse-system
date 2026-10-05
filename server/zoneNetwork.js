// Zone-based UDP multicast helpers. Robots publish to their own zone and
// subscribe to the current zone + neighboring zones only.
export const ZONE_SIZE = 20;
export const MULTICAST_BASE = '239.192';
export const MULTICAST_PORT = 41234;

export function zoneOf(tileX = 0, tileY = 0) {
  return { x: Math.floor(tileX / ZONE_SIZE), y: Math.floor(tileY / ZONE_SIZE) };
}

export function groupForZone(zx, zy) {
  const a = Math.max(0, Math.min(254, Number(zx) || 0));
  const b = Math.max(0, Math.min(254, Number(zy) || 0));
  return `${MULTICAST_BASE}.${a}.${b}`;
}

export function nearbyZones(zx, zy) {
  const out = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) out.push({ x: zx + dx, y: zy + dy });
  }
  return out;
}
