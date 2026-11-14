// One public or private server: a headless, authoritative copy of the game plus its connected players.
import { Game } from '../src/core/Game.js';
import { encodeSnapshot, vec3, SNAP_RATE } from '../src/net/protocol.js';
import { CONFIG } from '../src/config.js';

export class Room {
  constructor({ id, name, mode, difficulty, friendlyFire, isPublic, persistent = false, ownerIp = null }) {
    this.id = id;
    this.name = name;
    this.isPublic = isPublic;
    this.persistent = persistent;
    this.ownerIp = ownerIp;
    this.opts = { mode, difficulty, friendlyFire: !!friendlyFire };
    this.game = new Game(null, { headless: true });
    this.game.startMatch(this.opts);
    this.game.events.length = 0;
    this.clients = new Map(); // ws -> { idx, name }
    this.emptySince = Date.now();
    this.ticks = 0;
    this.snapEvery = Math.max(1, Math.round(CONFIG.server.tickRate / SNAP_RATE));
  }

  get humans() { return this.clients.size; }

  info() {
    return {
      id: this.id, name: this.name, mode: this.opts.mode, difficulty: this.opts.difficulty, ff: this.opts.friendlyFire,
      humans: this.clients.size, max: this.game.archers.length, round: this.game.round, wins: this.game.roundWins,
    };
  }

  _send(ws, obj) { if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }

  _broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.clients.keys()) this._send(ws, s);
  }

  _roster() { return this.game.archers.map((a) => [a.idx, a.name, a.human ? 1 : 0]); }
  _stats() { return this.game.archers.map((a) => { const s = a.stats; return [s.kills, s.deaths, s.shots, s.hits, Math.round(s.damage), s.headshots]; }); }

  join(ws, name) {
    const g = this.game;
    if (this.clients.size >= g.archers.length) return 'This server is full.';
    // the first arrival in a sleeping room gets a fresh match
    if (this.clients.size === 0) { g.startMatch(this.opts); g.events.length = 0; }
    const humansOn = (t) => [...this.clients.values()].filter((c) => g.archers[c.idx].team === t).length;
    const prefer = humansOn('blue') <= humansOn('red') ? 'blue' : 'red';
    const other = prefer === 'blue' ? 'red' : 'blue';
    let free = g.teams[prefer].filter((a) => !a.remote);
    if (!free.length) free = g.teams[other].filter((a) => !a.remote);
    // take over a living bot where possible, so you're straight into the action
    const slot = free.find((a) => a.alive) || free[0];
    slot.remote = true;
    slot.human = true;
    slot.name = name;
    slot.epoch++;
    slot.drawing = false;
    slot.drawTime = 0;
    slot.moveDir.set(0, 0);
    this.clients.set(ws, { idx: slot.idx, name });
    this._send(ws, {
      t: 'welcome',
      you: slot.idx,
      room: { id: this.id, name: this.name, isPublic: this.isPublic },
      match: { m: g.mode, ff: g.combat.friendlyFire ? 1 : 0, d: this.opts.difficulty },
      round: g.round,
      wins: g.roundWins,
      roundOver: g.roundOver,
      me: { p: vec3(slot.pos), yaw: slot.yaw, hp: slot.hp, alive: slot.alive ? 1 : 0, arrows: slot.arrows },
      ep: g.archers.map((a) => a.epoch),
      roster: this._roster(),
      stats: this._stats(),
      herbs: g.health.herbs.map((h) => (h.ready ? 1 : 0)),
    });
    this._broadcast({ t: 'roster', list: this._roster() });
    return null;
  }

  leave(ws) {
    const c = this.clients.get(ws);
    if (!c) return;
    this.clients.delete(ws);
    const a = this.game.archers[c.idx];
    a.remote = false;
    a.human = false;
    a.name = a.botName;
    a.drawing = false;
    if (a.ai) a.ai.reset(); // a bot picks up where the human left off
    if (this.clients.size === 0) this.emptySince = Date.now();
    this._broadcast({ t: 'roster', list: this._roster() });
  }

  message(ws, m) {
    const c = this.clients.get(ws);
    if (!c) return;
    const a = this.game.archers[c.idx];
    switch (m.t) {
      case 's': this.game.applyRemoteState(a, m); break;
      case 'fire': this.game.applyRemoteFire(a, m); break;
      case 'pickup': if (a.alive) this.game.tryPickup(a); break;
      case 'bandage': this.game.health.startBandage(a); break;
    }
  }

  tick(dt) {
    if (this.clients.size === 0) return; // empty rooms sleep
    const g = this.game;
    g.serverStep(dt);
    this.ticks++;
    if (g.events.length) {
      const all = g.events;
      const shared = JSON.stringify({ t: 'ev', list: all });
      for (const [ws, c] of this.clients) {
        // a player already drew their own arrows locally
        const own = all.some((e) => e.t === 'fire' && e.s === c.idx);
        if (!own) { this._send(ws, shared); continue; }
        const list = all.filter((e) => !(e.t === 'fire' && e.s === c.idx));
        if (list.length) this._send(ws, { t: 'ev', list });
      }
      g.events = [];
    }
    if (this.ticks % this.snapEvery === 0) {
      const buf = Buffer.from(encodeSnapshot(g).buffer);
      for (const ws of this.clients.keys()) if (ws.readyState === 1) ws.send(buf);
    }
    if (this.ticks % CONFIG.server.tickRate === 0) this._broadcast({ t: 'stats', s: this._stats() });
  }
}
