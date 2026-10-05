import http from 'node:http';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { MULTICAST_PORT } from './zoneNetwork.js';
import dgram from 'node:dgram';

const PORT = Number(process.env.PORT || 3001);
const clients = new Set();
const agents = new Map();
const observer = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const lastStateLog = new Map();

function log(dir, type, payload = {}) {
  console.log(`[P2P-GATEWAY] ${dir} ${type}`, JSON.stringify(payload));
}

function wsSend(client, payload) {
  if (!client.socket || client.socket.destroyed) return;
  const data = Buffer.from(JSON.stringify(payload));
  const len = data.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x81; header[1]=126; header.writeUInt16BE(len,2); }
  else { header = Buffer.alloc(10); header[0]=0x81; header[1]=127; header.writeBigUInt64BE(BigInt(len),2); }
  client.socket.write(Buffer.concat([header, data]));
}

function broadcast(payload) {
  for (const c of clients) wsSend(c, payload);
}

function ensureAgent(robotId) {
  if (agents.has(robotId)) return agents.get(robotId);
  const child = fork(new URL('./robotAgent.js', import.meta.url), [robotId, String(PORT)], { stdio: ['ignore','pipe','pipe','ipc'] });
  child.stdout.on('data', d => process.stdout.write(String(d)));
  child.stderr.on('data', d => process.stderr.write(String(d)));
  child.on('exit', () => agents.delete(robotId));
  agents.set(robotId, child);
  console.log(`[EDGE] started local agent for ${robotId}`);
  return child;
}

function handleClientMessage(client, msg) {
  if (!msg?.type) return;
  if (msg.type === 'REGISTER_ROBOT') {
    const agent = ensureAgent(msg.robotId);
    agent.send({ type: 'ROBOT_STATE', state: msg.state || {} });
    log('UI → AGENT', 'REGISTER_ROBOT', { robotId: msg.robotId });
    return;
  }
  if (msg.type === 'ROBOT_STATE' && msg.robotId) {
    const agent = ensureAgent(msg.robotId);
    agent.send({ type: 'ROBOT_STATE', state: msg.state || {} });
    return;
  }
  if (msg.type === 'UNREGISTER_ROBOT' && msg.robotId) {
    const agent = agents.get(msg.robotId);
    if (agent) { try { agent.send({ type: 'STOP' }); } catch {} }
    agents.delete(msg.robotId);
    log('UI → AGENT', 'UNREGISTER_ROBOT', { robotId: msg.robotId });
  }
}

function parseFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const b1 = client.buffer[0], b2 = client.buffer[1];
    const opcode = b1 & 0x0f;
    let len = b2 & 0x7f, offset = 2;
    if (len === 126) { if (client.buffer.length < 4) return; len = client.buffer.readUInt16BE(2); offset=4; }
    else if (len === 127) { if (client.buffer.length < 10) return; len = Number(client.buffer.readBigUInt64BE(2)); offset=10; }
    const masked = !!(b2 & 0x80);
    if (masked) { if (client.buffer.length < offset+4) return; offset += 4; }
    if (client.buffer.length < offset + len) return;
    let payload = client.buffer.subarray(offset, offset+len);
    if (masked) {
      const key = client.buffer.subarray(offset-4, offset);
      payload = Buffer.from(payload);
      for (let i=0;i<payload.length;i++) payload[i] ^= key[i%4];
    }
    client.buffer = client.buffer.subarray(offset+len);
    if (opcode === 0x8) { client.socket.end(); return; }
    if (opcode === 0x9) continue;
    if (opcode === 0x1) {
      try { handleClientMessage(client, JSON.parse(payload.toString())); } catch (e) { console.error('[WS] bad message', e.message); }
    }
  }
}

const server = http.createServer((req,res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'application/json'}); res.end(JSON.stringify({ok:true, agents:agents.size})); return; }
  res.writeHead(404); res.end('Not found');
});

server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const client = { socket, buffer: Buffer.alloc(0) };
  clients.add(client);
  socket.on('data', chunk => parseFrames(client, chunk));
  socket.on('close', () => clients.delete(client));
  socket.on('error', () => clients.delete(client));
  wsSend(client, { type:'BACKEND_READY', port:PORT, multicastPort:MULTICAST_PORT });
});

observer.on('message', (buf, rinfo) => {
  let packet; try { packet = JSON.parse(buf.toString()); } catch { return; }
  if (packet.type !== 'ROBOT_STATE') {
    log('MULTICAST ←', packet.type, { from: packet.robotId, source: rinfo.address, packet });
  } else {
    const key = packet.robotId || 'unknown';
    const now = Date.now();
    const prev = lastStateLog.get(key) || 0;
    if (now - prev >= 2000) {
      lastStateLog.set(key, now);
      log('MULTICAST ←', packet.type, { from: packet.robotId, source: rinfo.address, tile: [packet.state?.tileX, packet.state?.tileY], status: packet.state?.status, routeVersion: packet.state?.routeVersion });
    }
  }
  broadcast({ type:'P2P_PACKET', packet });
});
observer.bind(MULTICAST_PORT, '0.0.0.0', () => {
  observer.setMulticastLoopback(true);
  console.log(`[P2P-GATEWAY] observing multicast on ${MULTICAST_PORT}`);
});

server.listen(PORT, '127.0.0.1', () => console.log(`[EDGE] dashboard gateway listening on ws://127.0.0.1:${PORT}`));
process.on('SIGINT', () => { for (const a of agents.values()) try { a.kill(); } catch {} process.exit(0); });
