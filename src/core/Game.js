// Game state, main loop, rounds and modes. Owns every subsystem.
//
// Roles:
//   offline – single player, everything simulated locally (the original game)
//   server  – headless and authoritative; runs inside the Node server, one per room
//   client  – online play: renders server snapshots, predicts the local archer, sends inputs
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32, makeNames, clamp, segmentSphere, segmentVerticalCapsule, wrapAngle, escapeHtml } from './utils.js';
import { Input } from './Input.js';
import { Terrain } from '../world/Terrain.js';
import { Forest } from '../world/Forest.js';
import { Archer } from '../entities/Archer.js';
import { ArcherRenderer } from '../entities/ArcherRenderer.js';
import { Player } from '../entities/Player.js';
import { ViewModel } from '../entities/ViewModel.js';
import { Projectiles } from '../combat/Projectiles.js';
import { Combat } from '../combat/Combat.js';
import { Health } from '../combat/Health.js';
import { WorldOverlay } from '../ui/WorldOverlay.js';
import { Particles } from '../world/Particles.js';
import { AIManager } from '../ai/AIManager.js';
import { Audio } from '../audio/Audio.js';
import { HUD } from '../ui/HUD.js';
import { Minimap } from '../ui/Minimap.js';
import { Menus } from '../ui/Menus.js';
import { loadSettings, applySettings } from '../ui/Settings.js';
import { HEADER, STRIDE, FL, ZONE, CLIENT_RATE, vec3 } from '../net/protocol.js';

const R = CONFIG.rules;
const A = CONFIG.archer;
const B = CONFIG.bow;
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const ZONE_NAMES = ['none', 'blue', 'red', 'contested'];

// Absorbs any call or property access: stands in for DOM/WebGL/audio subsystems on the server.
const NOOP = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : NOOP),
  apply: () => NOOP,
  set: () => true,
});

const emptyStats = () => ({ kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0, headshots: 0 });

export class Game {
  constructor(container, { headless = false, treeModels = null } = {}) {
    this.headless = headless;
    this.settings = headless ? {} : loadSettings();
    this.role = headless ? 'server' : 'offline';
    this.net = null;
    this.events = [];
    this.menuOpen = false;
    this.time = 0;
    this.state = 'menu';
    this.mode = 'tdm';
    this.spottedBy = { red: {}, blue: {} };
    this.rand = mulberry32(CONFIG.map.seed + 11);

    this.scene = new THREE.Scene();
    if (!headless) {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.graphics.pixelRatioCap));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.shadowMap.enabled = CONFIG.graphics.shadows;
      this.renderer.shadowMap.type = THREE.PCFShadowMap;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      container.appendChild(this.renderer.domElement);
      this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, window.innerWidth / window.innerHeight, CONFIG.camera.near, CONFIG.camera.far);
      window.addEventListener('resize', () => this.onResize());
    } else {
      this.renderer = NOOP;
      this.camera = new THREE.PerspectiveCamera();
    }

    this.terrain = new Terrain(this.scene, { visual: !headless, models: treeModels });
    this.forest = new Forest(this.scene, this.terrain, { visual: !headless, models: treeModels });
    this.world = { terrain: this.terrain, forest: this.forest };

    this.teams = { red: [], blue: [] };
    const names = makeNames(CONFIG.teams.size * 2, this.rand);
    for (let i = 0; i < CONFIG.teams.size; i++) this.teams.red.push(new Archer('red', names[i]));
    for (let i = 0; i < CONFIG.teams.size; i++) this.teams.blue.push(new Archer('blue', names[CONFIG.teams.size + i], !headless && i === 0));
    this.archers = [...this.teams.blue, ...this.teams.red];
    this.archers.forEach((a, i) => { a.idx = i; });

    this.archerRenderer = new ArcherRenderer(this.scene, this.archers);
    this.projectiles = new Projectiles(this.scene, this.world);
    this.projectiles.archers = this.archers;
    this.projectiles.bodyMatrices = this.archerRenderer.bodyMatrices;
    this.combat = new Combat(this);
    this.projectiles.onHitArcher = (arrow, archer, headshot) => this.combat.onArrowHit(arrow, archer, headshot);
    this.projectiles.onImpact = (kind, pos) => this.audio.impact(kind, pos);
    this.projectiles.onNearMiss = (pos) => this.audio.whoosh(pos, 1.1, 0.35);
    this.ai = new AIManager(this);
    this.health = new Health(this, { visual: !headless });

    if (!headless) {
      this.audio = new Audio();
      this.input = new Input(this.renderer.domElement);
      this.input.onUnlock = () => { if (this.state === 'playing') this.pause(); };
      this.player = new Player(this, this.teams.blue[0], this.camera);
      this.viewModel = new ViewModel(this);
      this.projectiles.listener = this.player.archer;
      this.hud = new HUD(this);
      this.minimap = new Minimap(document.getElementById('minimap'), this);
      this.overlay = new WorldOverlay(this);
      this.particles = new Particles(this);
      this.menus = new Menus(this);
    } else {
      this.audio = this.input = this.hud = this.minimap = this.menus = this.overlay = this.particles = NOOP;
      this.player = null;
    }
    this._buildZone();

    this.roundWins = { red: 0, blue: 0 };
    this.round = 1;
    this.roundTime = 0;
    this.zoneScore = { red: 0, blue: 0 };
    this.applyLayout(null);
    this.placeAtSpawns();
    this.perf = { frames: 0, acc: 0, fps: 0, cpu: 0, cpuAcc: 0, worst: 0, worstAcc: 0 };
    if (!headless) {
      this.last = performance.now();
      applySettings(this, this.settings);
      this.menus.showStart();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
    }
  }

  get me() { return this.player ? this.player.archer : null; }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _buildZone() {
    const geo = new THREE.RingGeometry(R.kotfZoneRadius - 0.35, R.kotfZoneRadius, 64);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.terrain.height(pos.getX(i), pos.getZ(i)) + 0.08);
    this.zoneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false });
    this.zone = new THREE.Mesh(geo, this.zoneMat);
    this.zone.visible = false;
    this.scene.add(this.zone);
  }

  emit(e) { if (this.role === 'server') this.events.push(e); }

  setLocalArcher(a) {
    for (const x of this.archers) x.isPlayer = false;
    a.isPlayer = true;
    this.player.archer = a;
    this.player.lookYaw = a.yaw;
    this.player.lookPitch = 0;
    this.player.spectating = null;
    this.projectiles.listener = a;
  }

  // Settings live in localStorage (see ui/Settings.js); a match start re-applies them and resets the view.
  _applyLocalOptions() {
    this.audio.init();
    applySettings(this, this.settings);
    this.player.firstPerson = this.settings.firstPerson;
  }

  // ------------------------------------------------------------------ layouts
  // { type: 'teams', red, blue, bots } or { type: 'ffa', count, bots }
  static normaliseLayout(l) {
    const n = (v, lo, hi, d) => { if (v === null || v === undefined || v === '') return d; v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const T = CONFIG.teams.size;
    if (l && l.type === 'ffa') return { type: 'ffa', count: n(l.count, 2, T * 2, 10), bots: l.bots !== false };
    return { type: 'teams', red: n(l && l.red, 1, T, T), blue: n(l && l.blue, 1, T, T), bots: !l || l.bots !== false };
  }

  static layoutLabel(l) {
    l = Game.normaliseLayout(l);
    const s = l.type === 'ffa' ? `Free-for-all (${l.count})` : `${l.blue} v ${l.red}`;
    return l.bots ? s : `${s}, no bots`;
  }

  // Free-for-all fills slots alternately from each team so colours and spawns spread evenly.
  _slotOrder() {
    const out = [];
    for (let i = 0; i < CONFIG.teams.size; i++) out.push(this.teams.blue[i], this.teams.red[i]);
    return out;
  }

  applyLayout(layout) {
    const L = (this.layout = Game.normaliseLayout(layout));
    this.ffa = L.type === 'ffa';
    for (const a of this.archers) { a.inLayout = false; a.ffaIdx = -1; }
    if (this.ffa) this._slotOrder().slice(0, L.count).forEach((a, k) => { a.inLayout = true; a.ffaIdx = k; });
    else for (const t of ['blue', 'red']) this.teams[t].forEach((a, i) => { a.inLayout = i < L[t]; });
    this.refreshActive();
    // colours: team colours, or a distinct colour each in a free-for-all
    const col = new THREE.Color(), dark = new THREE.Color();
    for (const a of this.archers) {
      if (this.ffa && a.inLayout) {
        const h = (a.ffaIdx * 0.618034) % 1;
        col.setHSL(h, 0.62, 0.47); dark.setHSL(h, 0.6, 0.24);
      } else {
        col.set(a.team === 'blue' ? CONFIG.colours.blue : CONFIG.colours.red);
        dark.set(a.team === 'blue' ? CONFIG.colours.blueDark : CONFIG.colours.redDark);
      }
      a.colour = col.getHex();
      this.archerRenderer.recolour(a.idx, col, dark);
    }
  }

  // An in-layout slot is active when bots are on, or when a human holds it.
  refreshActive() {
    for (const a of this.archers) {
      const was = a.active;
      a.active = !!a.inLayout && (this.layout.bots || a.remote || a.isPlayer);
      if (!a.active) { a.alive = false; a.hp = 0; a.drawing = false; a.bandaging = false; a.pos.set(0, -500, 0); a.deathTime = 99; }
      else if (was === false && this.role !== 'client') this.respawn(a);
    }
  }

  // Small games get shorter rounds: 4 min up to 10 archers, 6 up to 20, then the configured limit.
  roundLimit() {
    const n = this.activeCount();
    return n <= 10 ? Math.min(240, R.roundTimeLimit) : n <= 20 ? Math.min(360, R.roundTimeLimit) : R.roundTimeLimit;
  }

  isEnemy(a, b) { return a !== b && (this.ffa || a.team !== b.team); }
  enemiesOf(a) { return this.archers.filter((x) => x.active && this.isEnemy(a, x)); }
  alliesOf(a) { return this.ffa ? [] : this.teams[a.team].filter((x) => x.active && x !== a); }
  activeCount(team) { return (team ? this.teams[team] : this.archers).filter((a) => a.active).length; }

  // Enough players to play? (with bots off a round waits for both sides, or two free-for-all players)
  layoutReady() {
    return this.ffa ? this.activeCount() >= 2 : this.activeCount('red') > 0 && this.activeCount('blue') > 0;
  }

  _ffaSpawn(a) {
    const N = this.layout.count, k = a.ffaIdx;
    const ang = (k / N) * Math.PI * 2 + 0.35, r = 82 + (k % 3) * 14;
    _v.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    this.forest.collideCircle(_v, 1.2, this.terrain.height(_v.x, _v.z));
    _v.y = this.terrain.height(_v.x, _v.z);
    return Math.atan2(_v.x, _v.z); // face the middle
  }

  // ------------------------------------------------------------------ match flow
  startMatch(opts) {
    this.opts = opts;
    this.mode = opts.mode;
    this.combat.friendlyFire = !!opts.friendlyFire;
    if (!this.headless) {
      this.role = 'offline';
      if (this.net) { this.net.close(); this.net = null; }
      for (const a of this.archers) { a.name = a.botName; a.human = false; a.remote = false; }
      this.setLocalArcher(this.teams.blue[0]);
      this._applyLocalOptions(opts);
    }
    for (const a of this.archers) a.stats = emptyStats();
    this.applyLayout(opts.layout);
    if (this.ffa) { this.mode = 'tdm'; }
    this.ai.setup(this.teams, opts.difficulty, this.mode);
    this.roundWins = { red: 0, blue: 0 };
    this.round = 1;
    this.zone.visible = this.mode === 'kotf';
    this.emit({ t: 'match', m: this.mode, ff: this.combat.friendlyFire ? 1 : 0, d: opts.difficulty, lay: this.layout });
    this.startRound();
  }

  placeAtSpawns() {
    this._bulk = true;
    for (const team of ['red', 'blue']) this.teams[team].forEach((a, i) => this.respawn(a, i));
    this._bulk = false;
  }

  respawn(a, i = this.teams[a.team].indexOf(a)) {
    this.projectiles.clearBody(a);
    if (a.active === false) {
      // unused slot: kept out of the world
      a.reset(_v.set(0, -500, 0));
      a.alive = false; a.hp = 0; a.deathTime = 99;
      a.epoch++;
      if (!this._bulk) this.emit({ t: 'respawn', i: a.idx, e: a.epoch });
      return;
    }
    let yaw;
    if (this.ffa && a.ffaIdx >= 0) yaw = this._ffaSpawn(a);
    else {
      const sp = this.forest.spawnPoints[a.team][i];
      _v.set(sp.x, this.terrain.height(sp.x, sp.z), sp.z);
      yaw = a.team === 'red' ? -Math.PI / 2 : Math.PI / 2;
    }
    a.homeX = _v.x; a.homeZ = _v.z;
    a.reset(_v);
    a.yaw = yaw;
    a.pitch = 0;
    a.epoch++;
    a.net = null;
    if (a.isPlayer && this.player) { this.player.lookYaw = a.yaw; this.player.lookPitch = 0; this.player.crouchToggle = false; }
    if (a.ai) a.ai.reset();
    if (!this._bulk) this.emit({ t: 'respawn', i: a.idx, e: a.epoch });
  }

  startRound() {
    this.projectiles.clearAll();
    this.placeAtSpawns();
    this.ai.newRound(this.mode);
    this._beginRoundCommon();
    this.emit({ t: 'roundStart', r: this.round, w: { ...this.roundWins }, ep: this.archers.map((a) => a.epoch) });
    this.input.enabled = true;
    this.input.lock();
  }

  _beginRoundCommon() {
    this.health.resetHerbs();
    this.particles.clear();
    this.hud.clearDeathRecap();
    for (const a of this.archers) a.roundStart = { ...a.stats };
    this.roundTime = 0;
    this.roundOver = false;
    this.roundEndTimer = 0;
    this.spottedBy = { red: {}, blue: {} };
    this.zoneScore = { red: 0, blue: 0 };
    this.zoneOwner = null;
    this.zoneContested = false;
    this.hud.clearFeed();
    this.hud.show(true);
    this.menus.hideRound();
    this.state = 'playing';
    this.hud.centre(this.mode === 'kotf' ? 'King of the Field<br><small>Hold the centre of the clearing</small>' : `Round ${this.round}`, 3);
  }

  continueAfterRound() {
    if (this.matchOver) { this.startMatch(this.opts); return; }
    this.round++;
    this.startRound();
  }

  pause() {
    if (this.state !== 'playing') return;
    if (this.role === 'client') {
      // the battle carries on without us: just open the menu over it
      this.menuOpen = true;
      this.menus.showPause(true, true);
      return;
    }
    this.state = 'paused';
    this.menus.showPause(true, false);
    this.audio.suspend();
  }

  resume() {
    this.menus.showPause(false);
    this.menuOpen = false;
    if (this.state === 'paused') this.state = 'playing';
    this.audio.resume();
    this.input.lock();
  }

  quitToMenu(message) {
    if (this.net) { const n = this.net; this.net = null; n.close(); }
    this.role = 'offline';
    this.menuOpen = false;
    this.state = 'menu';
    this.input.enabled = false;
    this.input.unlock();
    this.hud.show(false);
    this.menus.showStart(message);
    this.audio.suspend();
    this.projectiles.clearAll();
    for (const a of this.archers) { a.name = a.botName; a.human = false; }
    this.placeAtSpawns();
  }

  // ------------------------------------------------------------------ events and queries
  onKill(victim, killer, headshot) {
    this.hud.killFeed(killer, victim, headshot);
    // death poof (no smoke over your own first-person view)
    if (CONFIG.graphics.deathParticles && this.settings.deathParticles !== false) this.particles.death(victim, headshot, victim.isPlayer && this.player && this.player.firstPerson);
    if (victim.isPlayer && this.player) {
      this.audio.stopDraw();
      this.hud.deathRecap(victim, killer);
      this.player.spectating = this.spectateTarget(victim);
      this.player.specYaw = victim.yaw;
    }
    if (this.mode === 'kotf') victim.respawnAt = this.time + R.kotfRespawnDelay;
  }

  // Damage numbers, enemy health bars and camera shake for whoever is watching.
  onHitFeedback(victim, shooter, dmg, crit) {
    if (!this.player) return;
    if (shooter && shooter.isPlayer) { if (this.settings.damageNumbers !== false) this.overlay.damageNumber(victim, dmg, crit); victim.lastHitByMe = this.time; }
    if (victim.isPlayer) this.player.shake = Math.min(1, this.player.shake + 0.35 + dmg / 120);
  }

  requestBandage() {
    const me = this.me;
    if (!me || !me.alive) return;
    if (this.role === 'client') this.net.send({ t: 'bandage' });
    else this.health.startBandage(me);
  }

  spectateTarget(me) {
    const pool = this.ffa ? this.archers : this.teams[me.team];
    return pool.find((a) => a.alive && a.active && a !== me) || null;
  }

  aliveCount(team) {
    let n = 0;
    for (const a of team ? this.teams[team] : this.archers) if (a.alive && a.active) n++;
    return n;
  }

  reportSighting(team, enemy) { if (!this.ffa) this.spottedBy[team][enemy.idx] = this.time; }

  isSpotted(a, byTeam) { return this.time - (this.spottedBy[byTeam][a.idx] ?? -99) < 2.5; }

  // Accepts a team name, or an archer (needed in a free-for-all).
  randomAliveEnemy(teamOrArcher) {
    const list = typeof teamOrArcher === 'string'
      ? this.teams[teamOrArcher === 'red' ? 'blue' : 'red'].filter((a) => a.alive && a.active)
      : this.enemiesOf(teamOrArcher).filter((a) => a.alive);
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }

  surfaceAt(pos) { return this.terrain.forestFactor(pos.x, pos.z) > 0.5 ? 'forest' : 'grass'; }

  nearestLootableCorpse(archer, radius) {
    let best = null, bd = radius * radius;
    for (const a of this.archers) {
      if (a.alive || !a.active || a.arrows <= 0 || a === archer) continue;
      const d = a.pos.distanceToSquared(archer.pos);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  tryPickup(archer) {
    if (this.role === 'client') {
      // the server owns arrow counts: ask it, and it replies with a 'collect' event
      if (archer === this.me && archer.alive) { this.net.send({ t: 'pickup' }); this.lastPickupReq = this.time; }
      return 0;
    }
    const space = A.maxArrows - archer.arrows;
    if (space <= 0) return 0;
    let n = this.projectiles.collect(archer, A.pickupRadius, space);
    const corpse = this.nearestLootableCorpse(archer, A.pickupRadius);
    if (corpse && n < space) {
      const take = Math.min(space - n, corpse.arrows);
      corpse.arrows -= take;
      n += take;
    }
    archer.arrows += n;
    if (n > 0 && archer.isPlayer) this.audio.pickup();
    if (n > 0) archer.pickupT = 0.6;
    if (n > 0) this.emit({ t: 'collect', i: archer.idx, p: vec3(archer.pos), n });
    return n;
  }

  // Ray from origin along dir: nearest hit on trees, rocks, archers (except ignore) or ground.
  raycastWorld(origin, dir, maxDist, ignore) {
    const step = 8;
    for (let s = 0; s < maxDist; s += step) {
      const ax = origin.x + dir.x * s, ay = origin.y + dir.y * s, az = origin.z + dir.z * s;
      const e = Math.min(step, maxDist - s);
      const bx = ax + dir.x * e, by = ay + dir.y * e, bz = az + dir.z * e;
      let best = 2;
      const hit = this.forest.raycast(ax, ay, az, bx, by, bz, false);
      if (hit) best = hit.t;
      for (const a of this.archers) {
        if (a === ignore || !a.alive) continue;
        const mx = (ax + bx) / 2 - a.pos.x, mz = (az + bz) / 2 - a.pos.z;
        if (mx * mx + mz * mz > 36) continue;
        let t = segmentSphere(ax, ay, az, bx, by, bz, a.pos.x, a.pos.y + a.height - 0.13, a.pos.z, 0.2);
        if (t >= 0 && t < best) best = t;
        t = segmentVerticalCapsule(ax, ay, az, bx, by, bz, a.pos.x, a.pos.z, a.pos.y, a.pos.y + a.height - 0.3, 0.3);
        if (t >= 0 && t < best) best = t;
      }
      for (let k = 1; k <= 4; k++) {
        const t = k / 4;
        if (t >= best) break;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        if (y < this.terrain.height(x, z)) { best = t - 0.125; break; }
      }
      if (best <= 1) return new THREE.Vector3(ax + (bx - ax) * best, ay + (by - ay) * best, az + (bz - az) * best);
    }
    return new THREE.Vector3().copy(origin).addScaledVector(dir, maxDist);
  }

  zoneColour() {
    return this.zoneOwner === 'blue' ? '#4d8ff0' : this.zoneOwner === 'red' ? '#e0503f' : this.zoneContested ? '#ffd04a' : '#ffffff';
  }

  roundInfoText() {
    const online = this.role === 'client' ? ' · online' : '';
    if (this.waiting) return `Waiting for players – ${Game.layoutLabel(this.layout)}${online}`;
    if (this.ffa) {
      const left = Math.max(0, this.roundLimit() - this.roundTime);
      return `Free-for-all · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}${online}`;
    }
    if (this.mode === 'kotf') {
      return `Zone <span class="blue">${Math.floor(this.zoneScore.blue)}</span> – <span class="red">${Math.floor(this.zoneScore.red)}</span> · first to ${R.kotfScoreToWin}` +
        (this.zoneOwner ? ` · held by ${this.zoneOwner === 'blue' ? 'Blue' : 'Red'}` : this.zoneContested ? ' · contested' : '') + online;
    }
    const left = Math.max(0, this.roundLimit() - this.roundTime);
    const m = Math.floor(left / 60), s = Math.floor(left % 60);
    return `Round ${this.round} · Blue ${this.roundWins.blue} – Red ${this.roundWins.red} · ${m}:${String(s).padStart(2, '0')}${online}`;
  }

  // ------------------------------------------------------------------ rules (offline and server)
  _rules(dt) {
    this.waiting = !this.layoutReady();
    if (this.waiting) return; // not enough players yet: the clock doesn't run
    this.roundTime += dt;
    if (this.ffa) {
      const alive = this.archers.filter((a) => a.active && a.alive);
      if (alive.length <= 1) this._endRound(alive.length ? alive[0].idx : null);
      else if (this.roundTime >= this.roundLimit()) {
        // on time: most kills this round wins
        const best = alive.slice().sort((x, y) => (y.stats.kills - (y.roundStart?.kills || 0)) - (x.stats.kills - (x.roundStart?.kills || 0)))[0];
        this._endRound(best.idx, true);
      }
      return;
    }
    if (this.mode === 'kotf') {
      const r2 = R.kotfZoneRadius * R.kotfZoneRadius;
      const inZone = { red: 0, blue: 0 };
      for (const a of this.archers) if (a.alive && a.pos.x * a.pos.x + a.pos.z * a.pos.z < r2) inZone[a.team]++;
      this.zoneContested = inZone.red > 0 && inZone.blue > 0;
      this.zoneOwner = this.zoneContested ? null : inZone.red > 0 ? 'red' : inZone.blue > 0 ? 'blue' : null;
      if (this.zoneOwner) this.zoneScore[this.zoneOwner] += dt * (1 + Math.min(3, inZone[this.zoneOwner] - 1) * 0.25);
      this.zoneMat.color.set(this.zoneColour());
      for (const a of this.archers) {
        if (!a.alive && a.respawnAt && this.time >= a.respawnAt) { this.respawn(a); if (a.ai) a.ai.setState('advance'); }
      }
      for (const t of ['red', 'blue']) if (this.zoneScore[t] >= R.kotfScoreToWin) this._endRound(t);
      return;
    }
    const red = this.aliveCount('red'), blue = this.aliveCount('blue');
    if (red === 0 || blue === 0) this._endRound(red === 0 && blue === 0 ? null : red === 0 ? 'blue' : 'red');
    else if (this.roundTime >= this.roundLimit()) this._endRound(red === blue ? null : red > blue ? 'red' : 'blue', true);
  }

  _endRound(winner, timeout = false) {
    if (this.roundOver) return;
    this.roundWinner = winner;
    if (winner && !this.ffa) this.roundWins[winner]++;
    this.matchOver = this.ffa || this.mode === 'kotf' || this.roundWins.red >= R.roundsToWin || this.roundWins.blue >= R.roundsToWin;
    this.emit({ t: 'roundEnd', w: winner, to: timeout ? 1 : 0, mo: this.matchOver ? 1 : 0, wins: { ...this.roundWins }, z: { ...this.zoneScore } });
    this._roundEndCommon(timeout);
  }

  _roundEndCommon(timeout) {
    this.roundOver = true;
    this.roundEndTimer = 3;
    if (this.ffa) {
      const w = typeof this.roundWinner === 'number' ? this.archers[this.roundWinner] : null;
      for (const a of this.archers) a.cheer = a === w && a.alive;
      this.hud.centre(w ? `${w.isPlayer ? 'You win' : `${escapeHtml(w.name)} wins`} the free-for-all${timeout ? ' on kills' : ''}` : 'Nobody survived', 3);
      return;
    }
    for (const a of this.archers) a.cheer = !!this.roundWinner && a.alive && a.team === this.roundWinner;
    const name = this.roundWinner === 'blue' ? 'Blue' : this.roundWinner === 'red' ? 'Red' : null;
    this.hud.centre(name ? `${name} ${this.matchOver ? 'wins the match' : 'take the round'}${timeout ? ' on time' : ''}` : 'Round drawn', 3);
  }

  _showRoundScreen() {
    this.state = 'roundEnd';
    this.input.enabled = false;
    this.input.unlock();
    this.audio.stopDraw();
    const rs = (a) => {
      const s0 = a.roundStart || emptyStats();
      const src = this.matchOver ? emptyStats() : s0;
      const k = a.stats.kills - src.kills, sh = a.stats.shots - src.shots, h = a.stats.hits - src.hits;
      const dmg = a.stats.damage - src.damage, hs = a.stats.headshots - src.headshots;
      return { a, k, sh, h, dmg, hs, acc: sh ? Math.round((h / sh) * 100) : 0, score: k * 100 + dmg + hs * 25 };
    };
    const label = (a) => (a.isPlayer ? 'You' : escapeHtml(a.name) + (a.human ? ' ★' : ''));
    const all = this.archers.filter((a) => a.active || a.stats.shots || a.stats.kills).map(rs);
    const mvp = all.slice().sort((x, y) => y.score - x.score)[0];
    const table = (team) => {
      const rows = all.filter((r) => r.a.team === team).sort((x, y) => y.score - x.score).slice(0, 8);
      return `<div><h3 class="${team}" style="color:var(--${team})">${team === 'blue' ? 'Blue' : 'Red'}</h3><table><tr><th>Archer</th><th>Kills</th><th>Acc</th><th>Dmg</th></tr>` +
        rows.map((r) => `<tr class="${r.a.isPlayer ? 'you' : ''}"><td>${label(r.a)}</td><td>${r.k}</td><td>${r.acc}%</td><td>${Math.round(r.dmg)}</td></tr>`).join('') + '</table></div>';
    };
    const me = rs(this.me);
    const scope = this.matchOver ? 'match' : 'round';
    if (this.ffa) {
      const wa = typeof this.roundWinner === 'number' ? this.archers[this.roundWinner] : null;
      const rows = all.sort((x, y) => y.score - x.score).slice(0, 12);
      this.menus.showRound({
        title: wa ? `${wa.isPlayer ? 'You win' : `${escapeHtml(wa.name)} wins`} the free-for-all` : 'Nobody survived',
        subtitle: `Your match: ${me.k} kills, ${me.acc}% accuracy.`,
        mvp: `MVP: <b>${label(mvp.a)}</b> – ${mvp.k} kills, ${mvp.acc}% accuracy, ${Math.round(mvp.dmg)} damage`,
        tables: `<div><h3>Free-for-all</h3><table><tr><th>Archer</th><th>Kills</th><th>Acc</th><th>Dmg</th></tr>` +
          rows.map((r) => `<tr class="${r.a.isPlayer ? 'you' : ''}"><td><span class="swatch" style="background:#${(r.a.colour || 0).toString(16).padStart(6, '0')}"></span> ${label(r.a)}</td><td>${r.k}</td><td>${r.acc}%</td><td>${Math.round(r.dmg)}</td></tr>`).join('') + '</table></div>',
        matchOver: true,
        online: this.role === 'client',
      });
      return;
    }
    const w = this.roundWinner === 'blue' ? 'Blue' : this.roundWinner === 'red' ? 'Red' : null;
    this.menus.showRound({
      title: this.matchOver ? (w ? `${w} win the match` : 'Match drawn') : (w ? `${w} take round ${this.round}` : `Round ${this.round} drawn`),
      subtitle: this.mode === 'kotf'
        ? `Zone points: Blue ${Math.floor(this.zoneScore.blue)} – Red ${Math.floor(this.zoneScore.red)}. Your ${scope}: ${me.k} kills, ${me.acc}% accuracy.`
        : `Rounds: Blue ${this.roundWins.blue} – Red ${this.roundWins.red}. Your ${scope}: ${me.k} kills, ${me.acc}% accuracy.`,
      mvp: `MVP: <b style="color:var(--${mvp.a.team})">${label(mvp.a)}</b> – ${mvp.k} kills, ${mvp.acc}% accuracy, ${Math.round(mvp.dmg)} damage${mvp.hs ? `, ${mvp.hs} critical hit${mvp.hs > 1 ? 's' : ''}` : ''}`,
      tables: table('blue') + table('red'),
      matchOver: this.matchOver,
      online: this.role === 'client',
    });
  }

  // ------------------------------------------------------------------ networking: shared
  onShot(archer, origin, vel, crit) {
    if (this.role === 'server') this.emit({ t: 'fire', s: archer.idx, o: vec3(origin), v: vec3(vel), c: crit ? 1 : 0 });
    else if (this.role === 'client' && archer === this.me) {
      this.net.send({ t: 'fire', o: vec3(origin), v: vec3(vel), c: crit ? 1 : 0 });
      this.lastLocalFire = this.time;
    }
  }

  // ------------------------------------------------------------------ networking: server side
  // A client reports its own archer's movement; the server trusts position but bounds-checks it.
  applyRemoteState(a, m) {
    if (!a.alive || m.e !== a.epoch || this.state !== 'playing') return;
    const p = m.p, v = m.v;
    if (!Array.isArray(p) || !Array.isArray(v) || ![...p, ...v, m.y, m.pi, m.d].every(Number.isFinite)) return;
    const lim = CONFIG.map.size / 2 - CONFIG.map.boundaryMargin;
    const x = clamp(p[0], -lim, lim), z = clamp(p[2], -lim, lim);
    const g = this.terrain.height(x, z);
    a.pos.set(x, clamp(p[1], g - 0.5, g + 4), z);
    a.vel.set(clamp(v[0], -12, 12), clamp(v[1], -30, 12), clamp(v[2], -12, 12));
    a.yaw = wrapAngle(m.y);
    a.pitch = clamp(m.pi, -1.5, 1.5);
    const f = m.f | 0;
    a.crouching = !!(f & FL.CROUCH);
    a.sprinting = !!(f & FL.SPRINT);
    a.onGround = !!(f & FL.GROUND);
    a.drawing = !!(f & FL.DRAW) && a.arrows > 0;
    a.drawTime = a.drawing ? clamp(m.d, 0, 10) : 0;
    a.speed = Math.hypot(a.vel.x, a.vel.z);
    a.noise = a.speed < 0.3 ? 0 : a.crouching ? 0.3 : a.sprinting ? 1.4 : 1;
  }

  // A client looses an arrow: validate it and spawn the authoritative projectile.
  applyRemoteFire(a, m) {
    if (!a.alive || a.arrows <= 0 || this.state !== 'playing') return;
    if (!Array.isArray(m.o) || !Array.isArray(m.v) || ![...m.o, ...m.v].every(Number.isFinite)) return;
    if (a.releaseTimer < B.releaseCooldown * 0.7) return;
    const o = new THREE.Vector3(m.o[0], m.o[1], m.o[2]);
    if (o.distanceTo(_w.set(a.pos.x, a.pos.y + 1.3, a.pos.z)) > 3) return;
    const v = new THREE.Vector3(m.v[0], m.v[1], m.v[2]);
    // strip the shooter's own movement before judging the bow's power
    const own = _v.set(v.x - a.vel.x, a.onGround ? v.y : v.y - a.vel.y, v.z - a.vel.z).length();
    if (own > B.fullSpeed * 1.06 || own < B.fullSpeed * B.minPower * 0.9) return;
    const crit = !!m.c && own >= B.fullSpeed * 0.95;
    a.arrows--;
    a.drawing = false;
    a.drawTime = 0;
    a.releaseTimer = 0;
    a.stats.shots++;
    this.projectiles.fire(a, o, v, 0, crit);
    this.emit({ t: 'fire', s: a.idx, o: m.o, v: m.v, c: crit ? 1 : 0 });
  }

  // ------------------------------------------------------------------ networking: client side
  startOnline(net, w, opts) {
    this.net = net;
    this.role = 'client';
    this.opts = opts;
    this._applyLocalOptions(opts);
    this._applyMatchInfo(w.match);
    this._applyRoster(w.roster);
    this._applyStats(w.stats);
    if (w.herbs) w.herbs.forEach((r, i) => { if (this.health.herbs[i]) this.health.herbs[i].ready = !!r; });
    this.round = w.round;
    this.roundWins = w.wins;
    this.projectiles.clearAll();
    this.placeAtSpawns();
    const me = this.archers[w.you];
    this.setLocalArcher(me);
    this.archers.forEach((a, i) => { a.epoch = w.ep[i]; });
    me.pos.set(w.me.p[0], w.me.p[1], w.me.p[2]);
    me.yaw = w.me.yaw; this.player.lookYaw = me.yaw;
    me.hp = w.me.hp; me.arrows = w.me.arrows; me.alive = !!w.me.alive;
    if (!me.alive) { me.deathTime = 5; me.deathDir = 1; }
    this.lastLocalFire = -99;
    this.sendTimer = 0;
    this._beginRoundCommon();
    for (const a of this.archers) a.roundStart = { ...a.stats };
    this.roundOver = !!w.roundOver;
    this.menus.hideAll();
    const side = this.ffa ? 'In a free-for-all' : `You are ${me.team === 'blue' ? 'Blue' : 'Red'}`;
    this.hud.centre(`Joined <b>${escapeHtml(w.room.name)}</b><br><small>${side}${w.room.isPublic ? '' : ` · party code <b>${escapeHtml(w.room.id)}</b>`}</small>`, 5);
    this.input.enabled = true;
    this.input.lock();
  }

  _applyMatchInfo(m) {
    this.mode = m.m;
    if (m.lay) this.applyLayout(m.lay);
    this.combat.friendlyFire = !!m.ff;
    this.zone.visible = this.mode === 'kotf';
  }

  _applyRoster(list) {
    for (const [i, name, human, active] of list) {
      const a = this.archers[i];
      a.human = !!human;
      a.name = human ? name : a.botName;
      if (active !== undefined && !!active !== a.active) {
        a.active = !!active;
        if (!a.active) { a.alive = false; a.pos.set(0, -500, 0); a.deathTime = 99; }
      }
    }
  }

  _applyStats(rows) {
    rows.forEach((s, i) => {
      const st = this.archers[i].stats;
      [st.kills, st.deaths, st.shots, st.hits, st.damage, st.headshots] = s;
    });
  }

  _applyDeath(a, dir) {
    a.hp = 0;
    a.alive = false;
    a.drawing = false;
    a.drawTime = 0;
    a.deathTime = 0;
    a.deathDir = dir || 1;
  }

  applySnapshot(buf) {
    const f = new Float32Array(buf);
    if (f[0] !== 1 || this.role !== 'client') return;
    this.roundTime = f[2];
    this.zoneScore.blue = f[3]; this.zoneScore.red = f[4];
    const zc = ZONE_NAMES[f[5] | 0];
    this.zoneContested = zc === 'contested';
    this.zoneOwner = zc === 'blue' || zc === 'red' ? zc : null;
    this.zoneMat.color.set(this.zoneColour());
    const me = this.me;
    const now = this.time;
    const n = Math.min(this.archers.length, (f.length - HEADER) / STRIDE);
    for (let i = 0; i < n; i++) {
      const a = this.archers[i];
      const b = HEADER + i * STRIDE;
      const fl = f[b + 9] | 0;
      const alive = !!(fl & FL.ALIVE);
      if (fl & FL.SPOT_BLUE) this.spottedBy.blue[i] = now;
      if (fl & FL.SPOT_RED) this.spottedBy.red[i] = now;
      if ((f[b + 11] | 0) !== a.epoch) continue; // a respawn event is on its way
      a.hp = f[b + 7];
      a.bandages = f[b + 12];
      a.regenerating = !!(fl & FL.REGEN);
      const band = alive && !!(fl & FL.BANDAGE);
      if (band && !a.bandaging) a.bandageT = 0;
      a.bandaging = band;
      if (a === me) {
        if (now - this.lastLocalFire > 0.6 && now - (this.lastPickupReq || -99) > 0.6) a.arrows = f[b + 8];
        if (!alive && a.alive) this._applyDeath(a, fl & FL.DDIR ? 1 : -1);
        continue;
      }
      a.arrows = f[b + 8];
      const net = a.net || (a.net = {});
      net.x = f[b]; net.y = f[b + 1]; net.z = f[b + 2];
      net.yaw = f[b + 3]; net.pitch = f[b + 4];
      net.vx = f[b + 5]; net.vz = f[b + 6];
      net.t = now;
      if (!a._netInit) { a.pos.set(net.x, net.y, net.z); a.yaw = net.yaw; a._netInit = true; }
      a.crouching = !!(fl & FL.CROUCH);
      a.sprinting = !!(fl & FL.SPRINT);
      a.onGround = !!(fl & FL.GROUND);
      const drawing = alive && !!(fl & FL.DRAW);
      if (drawing && !a.drawing) this.audio.drawStart(a.pos, false);
      a.drawing = drawing;
      a.drawTime = drawing ? f[b + 10] : 0;
      if (!alive && a.alive) this._applyDeath(a, fl & FL.DDIR ? 1 : -1);
      else if (alive && !a.alive) { a.alive = true; a.deathTime = 0; this.projectiles.clearBody(a); }
    }
  }

  applyNetMessage(m) {
    if (this.role !== 'client') return;
    switch (m.t) {
      case 'ev': for (const e of m.list) this._netEvent(e); break;
      case 'roster': this._applyRoster(m.list); break;
      case 'stats': this._applyStats(m.s); break;
    }
  }

  _netEvent(e) {
    const me = this.me;
    switch (e.t) {
      case 'fire': {
        const a = this.archers[e.s];
        if (!a || a === me) return;
        const v = new THREE.Vector3(e.v[0], e.v[1], e.v[2]);
        this.projectiles.fire(a, new THREE.Vector3(e.o[0], e.o[1], e.o[2]), v, 0, !!e.c);
        a.releaseTimer = 0;
        a.drawing = false;
        a.drawTime = 0;
        this.audio.release(a.pos, clamp(v.length() / B.fullSpeed, 0, 1), false);
        break;
      }
      case 'hit': {
        const v = this.archers[e.v], s = this.archers[e.s];
        if (!v) return;
        v.hitFlash = 0.15;
        if (e.kb) Combat.hitReaction(v, e.kb[0], e.kb[1]);
        if (s === me) this.hud.hitMarker(!!e.h, !!e.k);
        this.onHitFeedback(v, s || null, e.dm || 0, !!e.h);
        if (v === me) {
          me.lastHurt = this.time;
          me.damageLog.push({ s: e.s, dmg: e.dm || 0, crit: !!e.h, t: this.time });
          if (me.damageLog.length > 8) me.damageLog.shift();
          this.hud.damageIndicator(s ? s.pos : null);
          if (e.kb) Combat.applyKnockback(me, e.kb[0], e.kb[1]); // our own movement is ours to push
        }
        break;
      }
      case 'kill': {
        const v = this.archers[e.v], s = this.archers[e.s] || null;
        if (!v) return;
        if (v.alive) this._applyDeath(v, e.d);
        v.deathStyle = e.st || 0;
        v.bandaging = false;
        this.onKill(v, s, !!e.h);
        break;
      }
      case 'respawn': {
        const a = this.archers[e.i];
        this._bulk = true;
        this.respawn(a);
        this._bulk = false;
        a.epoch = e.e;
        a._netInit = false;
        break;
      }
      case 'collect': {
        const a = this.archers[e.i];
        const n = this.projectiles.collect({ pos: new THREE.Vector3(e.p[0], e.p[1], e.p[2]) }, A.pickupRadius, e.n);
        if (a) a.pickupT = 0.6;
        if (a === me && e.n > 0) { this.audio.pickup(); this.lastPickupReq = -99; a.arrows = Math.min(A.maxArrows, a.arrows + e.n); }
        break;
      }
      case 'herb': {
        const h = this.health.herbs[e.h];
        if (!h) return;
        h.ready = !!e.a;
        const a = this.archers[e.i];
        if (a && !e.a) { a.pickupT = 0.6; if (a === me) this.audio.heal(); }
        break;
      }
      case 'match':
        this._applyMatchInfo(e);
        for (const a of this.archers) a.stats = emptyStats();
        break;
      case 'roundStart':
        this.round = e.r;
        this.roundWins = e.w;
        this.projectiles.clearAll();
        this.placeAtSpawns();
        this.archers.forEach((a, i) => { a.epoch = e.ep[i]; a._netInit = false; });
        this.menuOpen = false;
        this.menus.showPause(false);
        this._beginRoundCommon();
        this.input.enabled = true;
        if (!this.input.locked) this.hud.centre(`Round ${this.round}<br><small>Click to aim</small>`, 4);
        break;
      case 'roundEnd':
        this.roundWinner = e.w;
        this.roundWins = e.wins;
        this.matchOver = !!e.mo;
        if (e.z) this.zoneScore = e.z;
        this._roundEndCommon(!!e.to);
        break;
    }
  }

  _clientTick(dt) {
    const me = this.me;
    // smooth everyone else toward the latest snapshot, extrapolating briefly with their velocity
    const k = 1 - Math.exp(-dt * 14);
    for (const a of this.archers) {
      if (a === me) continue;
      if (a.hitFlash > 0) a.hitFlash -= dt;
      a.tickAnim(dt);
      if (a.bandaging) a.bandageT += dt;
      a.releaseTimer += dt;
      if (!a.alive) a.deathTime += dt;
      const n = a.net;
      if (!n) continue;
      const age = Math.min(0.25, this.time - n.t);
      const tx = n.x + (a.alive ? n.vx * age : 0), tz = n.z + (a.alive ? n.vz * age : 0);
      if (Math.abs(tx - a.pos.x) + Math.abs(tz - a.pos.z) > 8) a.pos.set(tx, n.y, tz);
      else { a.pos.x += (tx - a.pos.x) * k; a.pos.z += (tz - a.pos.z) * k; a.pos.y += (n.y - a.pos.y) * k; }
      a.vel.set(n.vx, 0, n.vz);
      a.speed = a.alive ? Math.hypot(n.vx, n.vz) : 0;
      a.yaw += wrapAngle(n.yaw - a.yaw) * k;
      a.pitch += (n.pitch - a.pitch) * k;
    }
    // send our own state
    this.sendTimer -= dt;
    if (this.sendTimer <= 0 && this.net) {
      this.sendTimer = 1 / CLIENT_RATE;
      let f = 0;
      if (me.crouching) f |= FL.CROUCH;
      if (me.sprinting) f |= FL.SPRINT;
      if (me.onGround) f |= FL.GROUND;
      if (me.drawing) f |= FL.DRAW;
      this.net.send({ t: 's', e: me.epoch, p: vec3(me.pos), v: vec3(me.vel), y: +me.yaw.toFixed(4), pi: +me.pitch.toFixed(4), f, d: +me.drawTime.toFixed(3) });
    }
  }

  // ------------------------------------------------------------------ main loop
  _footsteps() {
    const L = this.me;
    const lp = this.camera.position;
    for (const a of this.archers) {
      if (!a.alive) continue;
      const step = Math.floor(a.animPhase / Math.PI);
      if (step !== a._lastStep) {
        a._lastStep = step;
        if (a.speed < 0.5 || !a.onGround) continue;
        const dx = a.pos.x - lp.x, dz = a.pos.z - lp.z;
        if (a !== L && dx * dx + dz * dz > 28 * 28) continue;
        const vol = (a.crouching ? 0.35 : a.sprinting ? 1.25 : 0.8) * (a === L ? 1 : 1.4);
        this.audio.footstep(this.surfaceAt(a.pos), vol, false, a === L ? null : a.pos);
      }
      if (a === L) {
        if (a.onGround && a._wasAir) this.audio.footstep(this.surfaceAt(a.pos), 1.3, true);
        a._wasAir = !a.onGround;
      }
    }
  }

  // Headless server step: simulation only.
  serverStep(dt) {
    if (this.state !== 'playing') return;
    this.time += dt;
    if (!this.roundOver || this.mode === 'tdm') this.ai.update(dt);
    for (const a of this.archers) {
      if (a.active === false) continue;
      if (a.remote) a.remoteTick(dt, this.world); else a.physics(dt, this.world);
      if (!a.alive) a.deathTime += dt;
    }
    this.archerRenderer.update(dt, this.camera.position, false); // keeps body matrices for stuck arrows
    this.projectiles.update(dt);
    if (!this.roundOver || this.mode === 'kotf') this.health.update(dt);
    this._expireT = (this._expireT || 0) + dt;
    if (this._expireT > 1) { this.projectiles.ageStuck(this._expireT); this.projectiles.expireOld(); this._expireT = 0; }
    if (!this.roundOver) this._rules(dt);
    else {
      this.roundEndTimer -= dt;
      if (this.roundEndTimer <= -(this.matchOver ? R.onlineMatchBreak : R.onlineRoundBreak)) this.continueAfterRound();
    }
  }

  update(dt) {
    const playing = this.state === 'playing';
    const client = this.role === 'client';
    if (playing || (client && this.state === 'roundEnd')) {
      const simDt = this.roundOver && !client ? dt * 0.5 : dt;
      this.time += simDt;
      this.player.update(simDt, this.input);
      if (!client && (!this.roundOver || this.mode === 'tdm')) this.ai.update(simDt);
      if (client) {
        this.me.physics(simDt, this.world);
        if (!this.me.alive) this.me.deathTime += simDt;
        this._clientTick(simDt);
      } else {
        for (const a of this.archers) {
          if (a.active === false) continue;
          a.physics(simDt, this.world);
          if (!a.alive) a.deathTime += simDt;
        }
      }
      this.projectiles.update(simDt);
      if (!client && !this.roundOver) this.health.update(simDt);
      this._expireT = (this._expireT || 0) + simDt;
      if (this._expireT > 1) { this.projectiles.ageStuck(this._expireT); this.projectiles.expireOld(); this._expireT = 0; }
      this._footsteps();
      if (!client && !this.roundOver) this._rules(simDt);
      else if (this.roundOver && this.state === 'playing') {
        this.roundEndTimer -= dt;
        if (this.roundEndTimer <= 0) this._showRoundScreen();
      }
      const me = this.me;
      if (!me.alive && (!this.player.spectating || !this.player.spectating.alive)) {
        this.player.spectating = this.spectateTarget(me);
      }
      this.player.updateCamera(dt);
      this.hud.update(dt);
      this.minimap.update(dt);
    } else if (this.state === 'menu') {
      this.time += dt;
      const t = this.time * 0.05;
      this.camera.position.set(Math.cos(t) * 70, 26, Math.sin(t) * 70);
      this.camera.lookAt(0, 2, 0);
    }
    if (this.state !== 'paused') {
      const cp = this.camera.position;
      this.terrain.updateAtmosphere(cp, dt);
      this.forest.updateLOD(cp);
      // first person hides your own body (also while the death camera falls through where it was)
      const fpHide = this.player.firstPerson && (this.me.alive || this.me.deathTime < 1.8) && this.state === 'playing';
      this.archerRenderer.update(dt, cp, fpHide);
      this.health.animate(dt);
      this.particles.update(dt);
      this.overlay.update(dt);
      this.audio.setListener(cp, this.state === 'playing' && this.me.alive ? this.me.yaw : this.player.specYaw, this.terrain.forestBlend);
      this.audio.update(dt);
      if (this.viewModel) this.viewModel.update(dt, this.camera, this.input);
    }
    this.input.endFrame();
  }

  // Adaptive resolution: drop render scale when fps sags below ~50, recover when there is headroom.
  _adaptResolution(fps) {
    if (!this.adaptive) this.adaptive = { scale: 1, cooldown: 2 };
    const ad = this.adaptive;
    ad.cooldown -= 0.5;
    if (ad.cooldown > 0 || this.state !== 'playing' || (this.settings && this.settings.resolution !== 'auto')) return;
    let next = ad.scale;
    if (fps < 50 && ad.scale > 0.55) next = Math.max(0.55, ad.scale - 0.1);
    else if (fps > 58 && ad.scale < 1) next = Math.min(1, ad.scale + 0.05);
    if (next !== ad.scale) {
      ad.scale = next;
      ad.cooldown = 2;
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.graphics.pixelRatioCap) * ad.scale);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  _loop(now) {
    requestAnimationFrame(this._loop);
    const rawDt = Math.max(0, (now - this.last) / 1000);
    const dt = Math.min(rawDt, 1 / 20);   // simulation step is clamped; fps uses the real frame time
    this.last = now;
    const t0 = performance.now();
    this.update(dt);
    this.renderer.info.autoReset = false; // count both passes (world + first-person view model)
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.viewModel.render(this.renderer, this.camera);
    const cpu = performance.now() - t0;
    const p = this.perf;
    p.frames++; p.acc += rawDt; p.cpuAcc += cpu; p.worstAcc = Math.max(p.worstAcc, cpu);
    if (p.acc >= 0.5) {
      p.fps = p.frames / p.acc; p.cpu = p.cpuAcc / p.frames; p.worst = p.worstAcc;
      p.frames = 0; p.acc = 0; p.cpuAcc = 0; p.worstAcc = 0;
      this._adaptResolution(p.fps);
      const info = this.renderer.info.render;
      const ping = this.net ? `\nping ${this.net.ping.toFixed(0)} ms` : '';
      this.hud.updatePerf(`${p.fps.toFixed(0)} fps\ncpu ${p.cpu.toFixed(2)} ms (worst ${p.worst.toFixed(1)})\ncalls ${info.calls}  tris ${(info.triangles / 1000).toFixed(0)}k\narrows ${this.projectiles.activeCount}  AI thinks/frame ${this.ai.thinksThisFrame}\nres scale ${(this.adaptive ? this.adaptive.scale : 1).toFixed(2)}${ping}`);
    }
  }
}
