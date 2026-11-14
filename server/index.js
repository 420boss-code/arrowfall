// Arrowfall game server: hosts public and private rooms over WebSocket, lists public rooms over HTTP,
// and serves the built site from dist/ so one process is the whole deployment.
//
//   node server/index.js            (PORT env var overrides the default 8787)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room } from './Room.js';
import { CONFIG } from '../src/config.js';
import { cleanName } from '../src/net/protocol.js';

const SC = CONFIG.server;
const PORT = Number(process.env.PORT) || SC.port;
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // set when running behind a reverse proxy / PaaS
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const MODES = ['tdm', 'kotf'];
const DIFFS = ['easy', 'normal', 'hard'];

const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newId() {
  let id;
  do { id = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); } while (rooms.has(id));
  return id;
}

function createRoom(opts) {
  const room = new Room({ id: newId(), ...opts });
  rooms.set(room.id, room);
  return room;
}

// Always-on public servers
for (const def of [
  { name: 'Greenwood', mode: 'tdm', difficulty: 'normal', friendlyFire: false },
  { name: 'Hollow Oak', mode: 'kotf', difficulty: 'normal', friendlyFire: false },
  { name: 'Blackthorn', mode: 'tdm', difficulty: 'hard', friendlyFire: true },
]) createRoom({ ...def, isPublic: true, persistent: true });

// ------------------------------------------------------------------ HTTP
const clientIp = (req) => (TRUST_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || '?';
const lastCreate = new Map();

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function createFromRequest(req, res) {
  const ip = clientIp(req);
  const now = Date.now();
  if (now - (lastCreate.get(ip) || 0) < 10_000) return json(res, 429, { error: 'Please wait a few seconds before creating another server.' });
  const mine = [...rooms.values()].filter((r) => !r.persistent && r.ownerIp === ip).length;
  if (mine >= SC.maxRoomsPerIp) return json(res, 429, { error: `You can run up to ${SC.maxRoomsPerIp} servers at once.` });
  if (rooms.size >= SC.maxRooms) return json(res, 503, { error: 'All server slots are busy – try joining one instead.' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return json(res, 400, { error: 'Bad request.' }); }
  const room = createRoom({
    name: cleanName(body.name, 28, 'Archery server'),
    mode: MODES.includes(body.mode) ? body.mode : 'tdm',
    difficulty: DIFFS.includes(body.difficulty) ? body.difficulty : 'normal',
    friendlyFire: !!body.friendlyFire,
    isPublic: body.isPublic !== false,
    ownerIp: ip,
  });
  lastCreate.set(ip, now);
  json(res, 201, { id: room.id });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

function serveStatic(req, res) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('No build found. Run "npm run build" first, or use "npm run dev" while developing.');
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/api/servers' && req.method === 'GET') {
    const list = [...rooms.values()].filter((r) => r.isPublic).map((r) => r.info()).sort((a, b) => b.humans - a.humans);
    return json(res, 200, list);
  }
  if (p === '/api/servers' && req.method === 'POST') return void createFromRequest(req, res).catch(() => json(res, 500, { error: 'Server error.' }));
  if (p === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((s, r) => s + r.humans, 0) });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

// ------------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const connsPerIp = new Map();

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const n = (connsPerIp.get(ip) || 0) + 1;
  connsPerIp.set(ip, n);
  if (n > SC.maxConnectionsPerIp) { ws.close(1008, 'Too many connections'); }
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  let room = null;
  let budget = 120, budgetAt = Date.now();

  ws.on('message', (data, isBinary) => {
    // simple flood protection: ~120 messages per second
    const now = Date.now();
    budget = Math.min(120, budget + ((now - budgetAt) / 1000) * 120);
    budgetAt = now;
    if (--budget < -240) return ws.close(1008, 'Slow down');
    if (budget < 0 || isBinary) return;
    let m;
    try { m = JSON.parse(data.toString()); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'ping') { if (ws.readyState === 1) ws.send(JSON.stringify({ t: 'pong', c: m.c })); return; }
    if (m.t === 'join' && !room) {
      const r = rooms.get(String(m.room || '').toUpperCase());
      if (!r) { ws.send(JSON.stringify({ t: 'error', msg: 'That server no longer exists.' })); return; }
      const err = r.join(ws, cleanName(m.name));
      if (err) { ws.send(JSON.stringify({ t: 'error', msg: err })); return; }
      room = r;
      return;
    }
    if (room) room.message(ws, m);
  });

  ws.on('close', () => {
    connsPerIp.set(ip, (connsPerIp.get(ip) || 1) - 1);
    if (connsPerIp.get(ip) <= 0) connsPerIp.delete(ip);
    if (room) room.leave(ws);
  });
});

// heartbeat: drop dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 15_000);

// ------------------------------------------------------------------ simulation loop (fixed step)
const STEP = 1 / SC.tickRate;
let last = performance.now(), acc = 0;
setInterval(() => {
  const now = performance.now();
  acc += Math.min(0.25, (now - last) / 1000);
  last = now;
  let n = 0;
  while (acc >= STEP && n++ < 5) {
    for (const r of rooms.values()) {
      try { r.tick(STEP); } catch (e) { console.error(`room ${r.id} crashed:`, e); }
    }
    acc -= STEP;
  }
}, 1000 / SC.tickRate);

// tidy up empty player-made rooms
setInterval(() => {
  const now = Date.now();
  for (const [id, r] of rooms) {
    if (!r.persistent && r.humans === 0 && now - r.emptySince > SC.emptyRoomTtl * 1000) rooms.delete(id);
  }
  for (const [ip, t] of lastCreate) if (now - t > 60_000) lastCreate.delete(ip);
}, 10_000);

server.listen(PORT, () => {
  console.log(`Arrowfall server on http://localhost:${PORT} – ${rooms.size} public rooms ready`);
});
