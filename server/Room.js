// One public or private server: a headless, authoritative copy of the game plus its connected players.
import { Game } from '../src/core/Game.js';
import { encodeSnapshot, vec3, SNAP_RATE } from '../src/net/protocol.js';
import { CONFIG } from '../src/config.js';

export class Room {
  constructor({ id, name, mode, difficulty, friendlyFire, isPublic, persistent = false, ownerIp = null, layout = null, party = false }) {
    this.id = id;
    this.name = name;
    this.isPublic = isPublic;
    this.persistent = persistent;
    this.ownerIp = ownerIp;
    this.party = party;
    this.opts = { mode, difficulty, friendlyFire: !!friendlyFire, layout: Game.normaliseLayout(layout) };
    if (this.opts.layout.type === 'ffa') this.opts.mode = 'tdm';
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
    const L = this.opts.layout;
    return {
      layout: Game.layoutLabel(L), ffa: L.type === 'ffa', party: this.party,
      max: L.type === 'ffa' ? L.count : L.red + L.blue,
      id: this.id, name: this.name, mode: this.opts.mode, difficulty: this.opts.difficulty, ff: this.opts.friendlyFire,
      humans: this.clients.size, round: this.game.round, wins: this.game.roundWins,
    };
  }

  _send(ws, obj) { if (ws.readyState === 1) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }

  _broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const ws of this.clients.keys()) this._send(ws, s);
  }

  _roster() { return this.game.archers.map((a) => [a.idx, a.name, a.human ? 1 : 0, a.active ? 1 : 0, a.human ? { ...a.cos, ...(a.perk ? { perk: a.perk } : {}) } : 0, a.human ? a.playerNo || 0 : 0]); }
  _stats() { return this.game.archers.map((a) => { const s = a.stats; return [s.kills, s.deaths, s.shots, s.hits, Math.round(s.damage), s.headshots]; }); }

  join(ws, name, faction = null, kit = null, withPlayer = 0) {
    const g = this.game;
    // the first arrival in a sleeping room gets a fresh match
    if (this.clients.size === 0) { g.startMatch(this.opts); g.events.length = 0; }
    const open = g.archers.filter((a) => a.inLayout && !a.remote);
    if (!open.length) return 'This game is full.';
    const humansOn = (t) => [...this.clients.values()].filter((c) => g.archers[c.idx].team === t).length;
    let prefer = humansOn('blue') <= humansOn('red') ? 'blue' : 'red';
    // factions fight together: join the side most of your faction is already on
    if (faction) {
      const mates = (t) => [...this.clients.values()].filter((c) => c.faction && c.faction.id === faction.id && g.archers[c.idx].team === t).length;
      const b = mates('blue'), r = mates('red');
      if (b !== r) prefer = b > r ? 'blue' : 'red';
    }
    // joining a friend (from an invite or the friends list): go to their side
    if (withPlayer) {
      for (const [w, c] of this.clients) if (w.player === withPlayer) { prefer = g.archers[c.idx].team; break; }
    }
    const other = prefer === 'blue' ? 'red' : 'blue';
    let free = g.ffa ? open : open.filter((a) => a.team === prefer);
    if (!free.length) free = open.filter((a) => a.team === other);
    // take over a living bot where possible, so you're straight into the action
    const slot = free.find((a) => a.active && a.alive) || free[0];
    slot.remote = true;
    if (!slot.active) g.refreshActive(); // bots off: this slot comes to life for you
    slot.human = true;
    slot.name = faction ? `[${faction.tag}] ${name}` : name;
    slot.epoch++;
    slot.drawing = false;
    slot.drawTime = 0;
    slot.moveDir.set(0, 0);
    slot.setLoadout(kit);          // marketplace kit: cosmetics everyone sees, and one perk
    slot.playerNo = ws.player || 0; // lets friends recognise each other in the game
    this.clients.set(ws, { idx: slot.idx, name, faction, player: ws.player || 0 });
    this._send(ws, {
      t: 'welcome',
      you: slot.idx,
      room: { id: this.id, name: this.name, isPublic: this.isPublic },
      match: { m: g.mode, ff: g.combat.friendlyFire ? 1 : 0, d: this.opts.difficulty, lay: g.layout },
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
    a.setLoadout(null);
    a.playerNo = 0;
    if (a.ai) a.ai.reset(); // a bot picks up where the human left off (or, with bots off, the slot empties)
    if (!this.game.layout.bots) this.game.refreshActive();
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
      case 'stab': if (this.game.state === 'playing') this.game.combat.stab(a); break;
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
        const own = all.some((e) => (e.t === 'fire' && e.s === c.idx) || (e.t === 'stab' && e.i === c.idx));
        if (!own) { this._send(ws, shared); continue; }
        const list = all.filter((e) => !(e.t === 'fire' && e.s === c.idx) && !(e.t === 'stab' && e.i === c.idx));
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
