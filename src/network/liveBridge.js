// Runtime bridge used ONLY by OPTIMIZED mode.
// BASELINE never opens this connection and therefore never invokes software/ML prediction.
let ws = null;
let connected = false;
let enabled = false;
const queue = [];
const listeners = new Set();
const endpoint = `ws://${window.location.hostname || '127.0.0.1'}:3001`;

function log(direction, type, data) {
  console.log(`[P2P ${direction}] ${type}`, data || '');
}

export function setLiveBridgeEnabled(value) {
  enabled = !!value;
  if (!enabled) disconnectLiveBridge();
}

export function connectLiveBridge() {
  enabled = true;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try { ws = new WebSocket(endpoint); }
  catch (e) { console.warn('[P2P] WebSocket unavailable', e); return; }

  ws.onopen = () => {
    connected = true;
    console.log('[P2P] connected to edge gateway:', endpoint);
    while (queue.length && enabled) ws.send(JSON.stringify(queue.shift()));
  };
  ws.onclose = () => {
    connected = false;
    if (enabled) setTimeout(connectLiveBridge, 500);
  };
  ws.onerror = e => console.warn('[P2P] gateway error', e);
  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'P2P_PACKET') log('RX ←', msg.packet?.type, msg.packet);
      else log('RX ←', msg.type, msg);
      listeners.forEach(fn => fn(msg));
    } catch (e) {
      console.warn('[P2P] invalid gateway message', e);
    }
  };
}

export function disconnectLiveBridge() {
  enabled = false;
  connected = false;
  queue.length = 0;
  if (ws) {
    try { ws.close(); } catch {}
  }
  ws = null;
}

function send(msg) {
  if (!enabled) return;
  if (connected && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else queue.push(msg);
}

export function registerRobot(robotId, state) {
  if (!enabled) return;
  log('TX →', 'REGISTER_ROBOT', { robotId });
  send({ type: 'REGISTER_ROBOT', robotId, state });
}

export function sendRobotState(robotId, state) {
  if (!enabled) return;
  send({ type: 'ROBOT_STATE', robotId, state });
}

export function unregisterRobot(robotId) {
  if (!enabled) return;
  log('TX →', 'UNREGISTER_ROBOT', { robotId });
  send({ type: 'UNREGISTER_ROBOT', robotId });
}

export function onLiveMessage(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
