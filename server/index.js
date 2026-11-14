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
import { Auth, maskIp } from './auth.js';

const auth = new Auth();

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

// The maths page and its own small bundle are public (the disguise); everything else – the game
// bundle, Three.js, models – is only sent to logged-in visitors.
let publicFiles = null;
function isPublic(urlPath) {
  if (!publicFiles) {
    publicFiles = new Set(['/', '/index.html', '/favicon.ico']);
    try {
      const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
      for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)) publicFiles.add(m[1]);
    } catch { /* no build yet */ }
  }
  return publicFiles.has(urlPath);
}

function serveStatic(req, res, sess) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' });
    return res.end('No build found. Run "npm run build" first, or use "npm run dev" while developing.');
  }
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.normalize(path.join(DIST, urlPath));
  const exists = fs.existsSync(file) && !fs.statSync(file).isDirectory();
  if (exists && !isPublic(urlPath) && !sess) { res.writeHead(401, { 'Content-Type': 'text/plain' }); return res.end('Login required.'); }
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const isSecure = (req) => TRUST_PROXY && String(req.headers['x-forwarded-proto'] || '').startsWith('https');

async function bodyJson(req) {
  try { return JSON.parse(await readBody(req)); } catch { return null; }
}

// Everyone connected, for the admin panel. A key identifies one player in one room.
function onlinePlayers() {
  const out = [];
  for (const r of rooms.values()) {
    for (const [ws, c] of r.clients) out.push({ key: `${r.id}:${c.idx}`, room: r.name, roomId: r.id, name: c.name, faction: c.faction ? c.faction.tag : null, player: ws.player || null, ip: maskIp(ws.ip), ws });
  }
  return out;
}

function findPlayer(key) { return onlinePlayers().find((p) => p.key === key) || null; }

async function api(req, res, p, ip, sess) {
  if (p === '/api/login' && req.method === 'POST') {
    const body = await bodyJson(req);
    const r = auth.login(body && (body.code ?? body.password), ip);
    if (r.error) return json(res, r.status, { error: r.error });
    res.setHeader('Set-Cookie', auth.cookie(r.token, isSecure(req)));
    return json(res, 200, { role: r.role, player: r.player, factions: auth.state.factions });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    auth.logout(req);
    res.setHeader('Set-Cookie', auth.clearCookie());
    return json(res, 200, { ok: true });
  }
  if (p === '/api/health') return json(res, 200, { ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((s, r) => s + r.humans, 0) });
  if (!sess) return json(res, 401, { error: 'Login required.' });

  if (p === '/api/session') return json(res, 200, { role: sess.role, player: sess.player, factions: auth.state.factions });
  if (p === '/api/servers' && req.method === 'GET') {
    const list = [...rooms.values()].filter((r) => r.isPublic).map((r) => r.info()).sort((a, b) => b.humans - a.humans);
    return json(res, 200, list);
  }
  if (p === '/api/servers' && req.method === 'POST') return createFromRequest(req, res);

  // ---- admin only
  if (!p.startsWith('/api/admin/')) return json(res, 404, { error: 'Not found.' });
  if (sess.role !== 'admin') return json(res, 403, { error: 'Admins only.' });
  if (p === '/api/admin/state') {
    return json(res, 200, {
      factions: auth.state.factions,
      bans: auth.state.bans.map((b) => ({ id: b.id, name: b.name, at: b.at, ip: maskIp(b.ip) })),
      players: onlinePlayers().map(({ ws, ...rest }) => rest),
      codes: auth.playerList(),
      nextNumber: auth.suggestNumber(),
    });
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
  const body = (await bodyJson(req)) || {};
  switch (p) {
    case '/api/admin/password': {
      const err = auth.setAdminPassword(body.password);
      if (err) return json(res, 400, { error: err });
      sess.gen = auth.state.adminGen; // keep the admin who made the change logged in
      return json(res, 200, { ok: true, note: 'Other admin sessions have been logged out. It lasts until the server restarts; set ADMIN_PASSWORD on your host to keep it.' });
    }
    case '/api/admin/code': {
      const r = auth.createCode(body.player, body.name);
      return r.error ? json(res, 400, r) : json(res, 201, r);
    }
    case '/api/admin/revoke':
    case '/api/admin/restore': {
      const n = Number(body.player);
      if (!Number.isInteger(n) || n < 1 || n > 999) return json(res, 400, { error: 'Unknown player number.' });
      if (p === '/api/admin/revoke') {
        auth.revoke(n);
        for (const pl of onlinePlayers()) if (pl.player === n) pl.ws.close(4003, 'Revoked');
      } else auth.restore(n);
      return json(res, 200, { ok: true });
    }
    case '/api/admin/faction': {
      const r = auth.addFaction(body);
      return r.error ? json(res, 400, r) : json(res, 201, r);
    }
    case '/api/admin/faction/delete': auth.removeFaction(String(body.id)); return json(res, 200, { ok: true });
    case '/api/admin/kick':
    case '/api/admin/ban': {
      const pl = findPlayer(String(body.key));
      if (!pl) return json(res, 404, { error: 'That player has left.' });
      if (p === '/api/admin/ban') {
        // banning blocks the player's own number, so only that person is affected
        if (!pl.player) return json(res, 400, { error: 'That player is logged in as admin.' });
        auth.revoke(pl.player);
        for (const other of onlinePlayers()) if (other.player === pl.player) other.ws.close(4003, 'Banned');
      } else pl.ws.close(4002, 'Kicked');
      return json(res, 200, { ok: true });
    }
    case '/api/admin/unban': auth.unban(String(body.id)); return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: 'Not found.' });
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  const ip = clientIp(req);
  const sess = auth.session(req, ip);
  if (p.startsWith('/api/')) return void api(req, res, p, ip, sess).catch((e) => { console.error(e); json(res, 500, { error: 'Server error.' }); });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, sess);
});

// ------------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const connsPerIp = new Map();

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  ws.ip = ip;
  const wsSess = auth.session(req, ip);
  if (!wsSess) { ws.close(4001, 'Login required'); return; }
  ws.player = wsSess.player || null;
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
      const faction = m.faction ? auth.faction(String(m.faction)) : null;
      const err = r.join(ws, cleanName(m.name), faction);
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
