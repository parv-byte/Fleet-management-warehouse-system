import dgram from 'node:dgram';
import { zoneOf, groupForZone, nearbyZones, MULTICAST_PORT } from './zoneNetwork.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// ─── Load .env manually (no dotenv dependency needed) ────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
} catch {}

// ─── Gemini Setup ─────────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
let genAI = null;
let geminiModel = null;

if (GEMINI_API_KEY && GEMINI_API_KEY !== 'your_gemini_api_key_here') {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  // gemini-1.5-flash: free tier - 15 RPM, 1500 RPD
  geminiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  console.log('[GEMINI] Initialized with gemini-1.5-flash (free tier safe)');
} else {
  console.warn('[GEMINI] No API key found - running in rule-based fallback mode');
}

// ─── Free Tier Rate Limiter ───────────────────────────────────────────────────
// gemini-1.5-flash free tier: 15 requests per minute — stay safely under
const RATE_LIMIT_RPM = 14;
const callTimestamps = [];

function canCallGemini() {
  const now = Date.now();
  while (callTimestamps.length && now - callTimestamps[0] > 60000) {
    callTimestamps.shift();
  }
  return callTimestamps.length < RATE_LIMIT_RPM;
}

function recordGeminiCall() {
  callTimestamps.push(Date.now());
}

// ─── Decision Cache (avoids duplicate API calls for same scenario) ─────────────
// Key: conflict_type|relative_direction|battery_range|priority  TTL: 30s
const decisionCache = new Map();
const CACHE_TTL_MS = 30000;

function getCacheKey(robotData) {
  const batteryRange = robotData.battery_pct > 50 ? 'high' : robotData.battery_pct > 20 ? 'mid' : 'low';
  const distRange = robotData.distance_to_destination_m < 5 ? 'near' : robotData.distance_to_destination_m < 15 ? 'mid' : 'far';
  return [
    robotData.relative_direction,
    robotData.task_priority,
    batteryRange,
    distRange,
    robotData.deadlock_risk ? 'deadlock' : 'ok',
    robotData.alternative_route_available ? 'alt' : 'noalt',
    robotData.congestion_score > 0.6 ? 'hightraffic' : 'lowtraffic'
  ].join('|');
}

function getCachedDecision(key) {
  const cached = decisionCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.ts > CACHE_TTL_MS) { decisionCache.delete(key); return null; }
  return cached.result;
}

function setCachedDecision(key, result) {
  if (decisionCache.size > 100) {
    const firstKey = decisionCache.keys().next().value;
    decisionCache.delete(firstKey);
  }
  decisionCache.set(key, { result, ts: Date.now() });
}

// ─── Rule-Based Fallback (when Gemini unavailable / rate limited) ─────────────
function ruleBasedDecision(robotData) {
  if (robotData.deadlock_risk && robotData.alternative_route_available) {
    return { success: true, action: 'REROUTE', confidence: 0.85, source: 'rule' };
  }
  if (robotData.relative_direction === 'OPPOSITE') {
    if (robotData.alternative_route_available) {
      return { success: true, action: 'REROUTE', confidence: 0.80, source: 'rule' };
    }
    if (robotData.task_priority === 'CRITICAL') {
      return { success: true, action: 'MOVE', confidence: 0.90, source: 'rule' };
    }
    return { success: true, action: 'WAIT', confidence: 0.75, source: 'rule' };
  }
  if (robotData.battery_pct < 15 && robotData.task_type === 'CHARGE') {
    return { success: true, action: 'MOVE', confidence: 0.95, source: 'rule' };
  }
  if (robotData.distance_to_destination_m < 3) {
    return { success: true, action: 'SLOW', confidence: 0.80, source: 'rule' };
  }
  if (robotData.congestion_score > 0.7 && robotData.alternative_route_available) {
    return { success: true, action: 'REROUTE', confidence: 0.70, source: 'rule' };
  }
  if (robotData.relative_direction === 'SAME') {
    return { success: true, action: 'SLOW', confidence: 0.75, source: 'rule' };
  }
  if (robotData.task_priority === 'CRITICAL') {
    return { success: true, action: 'MOVE', confidence: 0.70, source: 'rule' };
  }
  return { success: true, action: 'WAIT', confidence: 0.65, source: 'rule' };
}

// ─── Gemini Prompt Builder ────────────────────────────────────────────────────
function buildPrompt(robotData) {
  return `You are a warehouse robot traffic controller AI.
A robot conflict is detected. Analyze and respond with EXACTLY one JSON object.

ROBOT STATE:
- Position: (${robotData.current_x}, ${robotData.current_y}) to Destination: (${robotData.destination_x}, ${robotData.destination_y})
- Distance to destination: ${robotData.distance_to_destination_m.toFixed(1)}m
- Speed: ${robotData.speed_mps.toFixed(2)} m/s | Direction: ${robotData.direction}
- Battery: ${robotData.battery_pct}% | Task: ${robotData.task_type} (${robotData.task_priority})
- Nearby robots: ${robotData.nearby_robot_count} | Nearest: ${robotData.nearest_robot_distance_m.toFixed(1)}m
- Relative direction to peer: ${robotData.relative_direction}
- Traffic level: ${robotData.traffic_level} | Congestion score: ${robotData.congestion_score.toFixed(2)}
- Collision risk: ${robotData.collision_risk ? 'YES' : 'NO'}
- Deadlock risk: ${robotData.deadlock_risk ? 'YES' : 'NO'}
- Alternative route available: ${robotData.alternative_route_available ? 'YES' : 'NO'}
- Waiting time: ${robotData.waiting_time_sec}s | Charging required: ${robotData.charging_required ? 'YES' : 'NO'}

VALID ACTIONS: MOVE, WAIT, SLOW, REROUTE
- MOVE: proceed at full speed (use when you have priority or clear path)
- WAIT: stop and let other robot pass (use for low priority or perpendicular conflicts)
- SLOW: reduce speed (use for same-direction following or minor congestion)
- REROUTE: take alternate path (use ONLY when alternative_route_available=YES and conflict is severe)

Respond with ONLY this JSON (no markdown, no explanation):
{"action":"MOVE","confidence":0.85,"reason":"brief reason"}`;
}

// ─── Gemini API Call ──────────────────────────────────────────────────────────
async function askGemini(robotData) {
  if (!geminiModel) return null;

  const cacheKey = getCacheKey(robotData);
  const cached = getCachedDecision(cacheKey);
  if (cached) return { ...cached, source: 'cache' };

  if (!canCallGemini()) {
    console.warn(`[GEMINI][${id}] Rate limit reached, using rule fallback`);
    return null;
  }

  try {
    recordGeminiCall();
    const prompt = buildPrompt(robotData);
    const result = await Promise.race([
      geminiModel.generateContent(prompt),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000))
    ]);

    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const parsed = JSON.parse(jsonMatch[0]);
    const validActions = ['MOVE', 'WAIT', 'SLOW', 'REROUTE'];
    const action = validActions.includes(parsed.action?.toUpperCase())
      ? parsed.action.toUpperCase()
      : 'WAIT';

    const decision = {
      success: true,
      action,
      decision: action,
      confidence: Number(parsed.confidence) || 0.75,
      reason: parsed.reason || '',
      source: 'gemini',
      probabilities: { [action]: Number(parsed.confidence) || 0.75 }
    };

    setCachedDecision(cacheKey, decision);
    return decision;

  } catch (err) {
    console.error(`[GEMINI][${id}] Error: ${err.message}`);
    return null;
  }
}

// ─── Main Decision Function (Gemini + Rule fallback) ─────────────────────────
async function getDecision(robotData) {
  const geminiResult = await askGemini(robotData);
  if (geminiResult?.success) return geminiResult;
  console.log(`[FALLBACK][${id}] Using rule-based decision`);
  return ruleBasedDecision(robotData);
}

// ─── Robot Agent Core ─────────────────────────────────────────────────────────
const id = process.argv[2];
if (!id) process.exit(1);

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const peers = new Map();
const peerML = new Map();
const lastEval = new Map();
const lastDecision = new Map();
let ownState = null;
let joined = new Set();
let seq = 0;
let lastStateLog = 0;

const log = (tag, payload = {}) => console.log(`[P2P][${id}] ${tag}`, JSON.stringify(payload));
const nodeKey = p => p ? `${p.navX ?? p.tileX},${p.navY ?? p.tileY}` : '';

function sendPacket(packet) {
  if (!ownState) return;
  const z = zoneOf(ownState.tileX, ownState.tileY);
  const group = groupForZone(z.x, z.y);
  const data = Buffer.from(JSON.stringify(packet));
  socket.send(data, 0, data.length, MULTICAST_PORT, group);
  if (packet.type !== 'ROBOT_STATE' || Date.now() - lastStateLog >= 2000) {
    if (packet.type === 'ROBOT_STATE') lastStateLog = Date.now();
    log(`TX -> ${packet.type}`, {
      to: `ZONE(${z.x},${z.y})`,
      robotId: packet.robotId,
      against: packet.against,
      decision: packet.decision,
      action: packet.action,
      confidence: packet.confidence,
      conflictTile: packet.conflictTile
    });
  }
}

function updateSubscriptions() {
  if (!ownState) return;
  const z = zoneOf(ownState.tileX, ownState.tileY);
  const wanted = new Set(nearbyZones(z.x, z.y).map(q => groupForZone(q.x, q.y)));
  for (const group of wanted) {
    if (joined.has(group)) continue;
    try { socket.addMembership(group); joined.add(group); } catch {}
  }
  for (const group of [...joined]) {
    if (wanted.has(group)) continue;
    try { socket.dropMembership(group); } catch {}
    joined.delete(group);
  }
}

function nearestPathIndex(state) {
  const path = Array.isArray(state?.path) ? state.path : [];
  if (!path.length) return 0;
  const x = Number(state.x ?? 0), y = Number(state.y ?? 0);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const d = Math.hypot(x - Number(p.worldX ?? 0), y - Number(p.worldY ?? 0));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function remainingPath(state) {
  const path = Array.isArray(state?.path) ? state.path : [];
  return path.slice(nearestPathIndex(state));
}

function findConflicts(a, b) {
  const ap = remainingPath(a), bp = remainingPath(b);
  if (!ap.length || !bp.length) return [];
  const bm = new Map(bp.map((p, i) => [nodeKey(p), { p, i }]));
  const hits = [];
  ap.forEach((p, i) => {
    const h = bm.get(nodeKey(p));
    if (h) hits.push({ p, aIndex: i, bIndex: h.i });
  });
  for (let i = 0; i < ap.length - 1; i++) {
    for (let j = 0; j < bp.length - 1; j++) {
      if (nodeKey(ap[i]) === nodeKey(bp[j + 1]) && nodeKey(ap[i + 1]) === nodeKey(bp[j])) {
        hits.push({ p: ap[i + 1], aIndex: i + 1, bIndex: j + 1, edge: true });
      }
    }
  }
  const seen = new Set();
  return hits.filter(h => { const k = `${nodeKey(h.p)}|${h.aIndex}|${h.bIndex}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function winner(a, b) {
  const pa = Number(a.priority ?? 999), pb = Number(b.priority ?? 999);
  if (pa !== pb) return pa < pb ? a.id : b.id;
  const ba = Number(a.battery ?? 0), bb = Number(b.battery ?? 0);
  if (ba !== bb) return ba > bb ? a.id : b.id;
  return String(a.id).localeCompare(String(b.id)) <= 0 ? a.id : b.id;
}

function directionFor(state) {
  const path = remainingPath(state);
  if (path.length < 2) return 'East';
  const a = path[0], b = path[1];
  const dx = Number(b.navX ?? b.tileX) - Number(a.navX ?? a.tileX);
  const dy = Number(b.navY ?? b.tileY) - Number(a.navY ?? a.tileY);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'East' : 'West';
  return dy >= 0 ? 'South' : 'North';
}

function relativeDirection(a, b) {
  const ap = remainingPath(a), bp = remainingPath(b);
  if (ap.length < 2 || bp.length < 2) return 'NONE';
  const adx = Number(ap[1].navX ?? ap[1].tileX) - Number(ap[0].navX ?? ap[0].tileX);
  const ady = Number(ap[1].navY ?? ap[1].tileY) - Number(ap[0].navY ?? ap[0].tileY);
  const bdx = Number(bp[1].navX ?? bp[1].tileX) - Number(bp[0].navX ?? bp[0].tileX);
  const bdy = Number(bp[1].navY ?? bp[1].tileY) - Number(bp[0].navY ?? bp[0].tileY);
  if (adx === -bdx && ady === -bdy) return 'OPPOSITE';
  if (adx === bdx && ady === bdy) return 'SAME';
  if (adx * bdx + ady * bdy === 0) return 'PERPENDICULAR';
  return 'CROSSING';
}

function taskType(task) {
  const t = String(task || '').toUpperCase();
  if (['PICK', 'CHARGE', 'DELIVER', 'RELOCATE', 'RETURN'].includes(t)) return t;
  return 'DELIVER';
}

function buildRobotData(state, peer, conflict, actionContext) {
  const path = remainingPath(state);
  const conflictIndex = Math.max(0, Number(conflict?.aIndex ?? 0));
  const destination = state.destination || {};
  const destX = Number(destination.tileX ?? state.tileX ?? 0);
  const destY = Number(destination.tileY ?? state.tileY ?? 0);
  const dx = destX - Number(state.tileX ?? 0);
  const dy = destY - Number(state.tileY ?? 0);
  const distanceToDestination = Math.hypot(dx, dy);
  const speedMps = Number(state.speed ?? 100) / 32;
  const distance = peer ? Math.hypot(Number(state.x ?? 0) - Number(peer.x ?? 0), Number(state.y ?? 0) - Number(peer.y ?? 0)) / 32 : 999;
  const routeLength = Math.max(1, path.length * 2);
  return {
    current_x: Number(state.tileX ?? 0),
    current_y: Number(state.tileY ?? 0),
    destination_x: destX,
    destination_y: destY,
    speed_mps: speedMps,
    direction: directionFor(state),
    battery_pct: Number(state.battery ?? 100),
    task_type: taskType(state.task),
    task_priority: Number(state.priority ?? 1) <= 1 ? 'CRITICAL' : Number(state.priority ?? 1) <= 2 ? 'HIGH' : 'MEDIUM',
    traffic_level: peer ? 'HIGH' : 'LOW',
    obstacle_detected: 0,
    path_blocked: actionContext.collisionRisk ? 1 : 0,
    nearby_robot_count: peer ? 1 : 0,
    nearest_robot_distance_m: distance,
    relative_direction: peer ? relativeDirection(state, peer) : 'NONE',
    distance_to_destination_m: distanceToDestination,
    eta_sec: routeLength / Math.max(0.1, speedMps),
    congestion_score: peer ? Math.min(1, 0.4 + Math.max(0, 12 - conflictIndex) / 15) : 0.1,
    collision_risk: actionContext.collisionRisk ? 1 : 0,
    deadlock_risk: actionContext.deadlockRisk ? 1 : 0,
    waiting_time_sec: Number(state.waiting_time_sec ?? 0),
    charging_required: taskType(state.task) === 'CHARGE' ? 1 : 0,
    route_length_m: routeLength,
    alternative_route_available: actionContext.alternativeRouteAvailable ? 1 : 0
  };
}

function conflictKey(peer, conflict) {
  return `${peer.id}|${nodeKey(conflict.p)}|${ownState?.routeVersion ?? 0}|${peer.routeVersion ?? 0}`;
}

function broadcastML(peer, conflict, decision) {
  const packet = {
    type: 'ML_DECISION', robotId: id, against: peer.id,
    action: decision?.action || 'UNAVAILABLE',
    confidence: decision?.confidence ?? null,
    probabilities: decision?.probabilities || {},
    conflictTile: conflict?.p ? { navX: conflict.p.navX, navY: conflict.p.navY, tileX: conflict.p.tileX, tileY: conflict.p.tileY } : null,
    routeVersion: ownState?.routeVersion ?? 0,
    source: decision?.source || 'unknown',
    ts: Date.now()
  };
  sendPacket(packet);
  peerML.set(conflictKey(peer, conflict), { ...packet, receivedAt: Date.now() });
}

function finalAction(ownAction, peerAction, a, b) {
  const w = winner(a, b);
  const iWin = w === id;
  if (!peerAction) return ownAction || 'WAIT';
  if (ownAction === 'REROUTE' && peerAction === 'REROUTE') {
    const sa = Number(a?.speed ?? Infinity);
    const sb = Number(b?.speed ?? Infinity);
    if (sa !== sb) return sa < sb ? 'REROUTE' : 'MOVE';
    const rerouteId = String(a?.id || '').localeCompare(String(b?.id || '')) <= 0 ? a.id : b.id;
    return id === rerouteId ? 'REROUTE' : 'MOVE';
  }
  if (ownAction === 'WAIT' && peerAction === 'WAIT') return iWin ? 'MOVE' : 'WAIT';
  if (ownAction === 'MOVE' && peerAction === 'MOVE') return iWin ? 'MOVE' : 'WAIT';
  if (ownAction === 'SLOW' && peerAction === 'SLOW') return iWin ? 'SLOW' : 'WAIT';
  return ownAction || 'WAIT';
}

function broadcastFinalDecision(peer, conflict, ownDecision, peerMLPacket) {
  const ownAction = ownDecision?.action || 'MOVE';
  const peerAction = peerMLPacket?.action;
  const decision = finalAction(ownAction, peerAction, ownState, peer);
  const bothReroute = ownAction === 'REROUTE' && peerAction === 'REROUTE';
  const corridorOwner = bothReroute
    ? (Number(ownState?.speed ?? Infinity) >= Number(peer?.speed ?? Infinity) ? ownState.id : peer.id)
    : winner(ownState, peer);
  const rerouteRobot = bothReroute
    ? (Number(ownState?.speed ?? Infinity) < Number(peer?.speed ?? Infinity) ? ownState.id : peer.id)
    : (decision === 'REROUTE' ? id : null);
  const packet = {
    type: 'DECISION', robotId: id, target: id, against: peer.id,
    decision, modelDecision: ownAction, peerModelDecision: peerAction || 'UNAVAILABLE',
    modelConfidence: ownDecision?.confidence ?? null,
    conflictTile: conflict.p ? { navX: conflict.p.navX, navY: conflict.p.navY, tileX: conflict.p.tileX, tileY: conflict.p.tileY } : null,
    winner: winner(ownState, peer), corridorOwner, rerouteRobot,
    routeVersion: ownState?.routeVersion ?? 0,
    decisionSource: ownDecision?.source || 'rule',
    ts: Date.now()
  };
  const key = `${peer.id}|${nodeKey(conflict.p)}|${ownState?.routeVersion ?? 0}|${decision}|${peerMLPacket?.action || ''}`;
  if (lastDecision.get(peer.id) === key) return;
  lastDecision.set(peer.id, key);
  log('FINAL DECISION', {
    against: peer.id, decision,
    model: ownDecision?.action, peerModel: peerMLPacket?.action,
    winner: packet.winner, corridorOwner, rerouteRobot,
    source: ownDecision?.source || 'rule'
  });
  sendPacket(packet);
}

async function evaluatePeer(peer) {
  if (!ownState || ownState.status !== 'moving' || !peer || peer.status !== 'moving') return;
  const hits = findConflicts(ownState, peer);
  if (!hits.length) return;
  const hit = hits.reduce((best, h) => Math.min(h.aIndex, h.bIndex) < Math.min(best.aIndex, best.bIndex) ? h : best, hits[0]);
  if (hit.aIndex > 12 && hit.bIndex > 12) return;
  const key = conflictKey(peer, hit);
  const now = Date.now();
  const prev = lastEval.get(peer.id);
  if (prev?.key === key && now - prev.ts < 1500) return;
  lastEval.set(peer.id, { key, ts: now });

  const robotData = buildRobotData(ownState, peer, hit, {
    collisionRisk: true,
    deadlockRisk: false,
    alternativeRouteAvailable: true
  });

  const decision = await getDecision(robotData);
  if (!decision?.success) {
    log('DECISION ERROR', { peer: peer.id });
    return;
  }

  log('DECISION', {
    peer: peer.id,
    action: decision.action,
    confidence: decision.confidence,
    source: decision.source,
    reason: decision.reason || ''
  });

  broadcastML(peer, { ...hit, p: hit.p }, decision);

  setTimeout(() => {
    const peerPacket = peerML.get(key);
    broadcastFinalDecision(peer, { ...hit, p: hit.p }, decision, peerPacket);
  }, 120);
}

socket.on('message', async (buf, rinfo) => {
  let packet;
  try { packet = JSON.parse(buf.toString()); } catch { return; }
  if (!packet || packet.robotId === id) return;
  if (packet.type === 'ROBOT_STATE' && packet.state) {
    peers.set(packet.robotId, packet.state);
    const now = Date.now();
    if (now - (peers.get(`log:${packet.robotId}`)?.ts || 0) > 2000) {
      log('RX <- ROBOT_STATE', { from: packet.robotId, tile: [packet.state.tileX, packet.state.tileY], status: packet.state.status, routeVersion: packet.state.routeVersion });
    }
    await evaluatePeer(packet.state);
    return;
  }
  if (packet.type === 'ML_DECISION') {
    const peer = peers.get(packet.robotId);
    if (!peer) return;
    peerML.set(`${packet.robotId}|${nodeKey(packet.conflictTile)}|${ownState?.routeVersion ?? 0}|${packet.routeVersion ?? 0}`, { ...packet, receivedAt: Date.now() });
    log('RX <- ML_DECISION', { from: packet.robotId, action: packet.action, confidence: packet.confidence, conflictTile: packet.conflictTile });
    return;
  }
  if (packet.type === 'DECISION') {
    log('RX <- DECISION', { from: packet.robotId, target: packet.target, decision: packet.decision, modelDecision: packet.modelDecision, peerModelDecision: packet.peerModelDecision, conflictTile: packet.conflictTile });
  }
});

socket.bind(MULTICAST_PORT, '0.0.0.0', () => {
  socket.setMulticastTTL(1);
  socket.setMulticastLoopback(true);
  console.log(`[P2P][${id}] edge agent online (Gemini AI + rule fallback); multicast port ${MULTICAST_PORT}`);
});

process.on('message', msg => {
  if (!msg) return;
  if (msg.type === 'ROBOT_STATE') {
    ownState = { ...(ownState || {}), ...msg.state };
    updateSubscriptions();
    const now = Date.now();
    if (now - lastStateLog >= 120) {
      sendPacket({ type: 'ROBOT_STATE', robotId: id, state: ownState, seq: ++seq, ts: now });
    }
  }
  if (msg.type === 'STOP') process.exit(0);
});

process.on('SIGTERM', () => process.exit(0));
