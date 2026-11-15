// Pooled arrow projectiles in a single InstancedMesh. Real ballistic flight (gravity, travel time),
// sticking into trees, rocks, ground and bodies, and pick-up of spent arrows.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { COSMETICS } from '../core/items.js';
import { segmentSphere, segmentVerticalCapsule } from '../core/utils.js';
import { mergeSimple } from '../world/Terrain.js';

const AR = CONFIG.arrows;
const FREE = 0, FLYING = 1, STUCK = 2, BODY = 3;

export function arrowGeometry() {
  const parts = [];
  const col = (g, c) => {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.deleteAttribute('uv');
    return g.index ? g.toNonIndexed() : g;
  };
  const L = AR.length;
  const shaft = new THREE.BoxGeometry(0.018, 0.018, L - 0.06);
  shaft.translate(0, 0, -(L - 0.06) / 2 - 0.06);
  parts.push(col(shaft, [0.78, 0.66, 0.46]));
  const head = new THREE.ConeGeometry(0.022, 0.08, 4);
  head.rotateX(Math.PI / 2);
  head.translate(0, 0, -0.04);
  parts.push(col(head, [0.35, 0.36, 0.38]));
  for (let k = 0; k < 2; k++) {
    const f = new THREE.BoxGeometry(k ? 0.002 : 0.07, k ? 0.07 : 0.002, 0.11);
    f.translate(0, 0, -L + 0.08);
    parts.push(col(f, [0.92, 0.92, 0.88]));
  }
  for (const p of parts) if (!p.attributes.normal) p.computeVertexNormals();
  return mergeSimple(parts);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const FWD = new THREE.Vector3(0, 0, 1);
const ONE = new THREE.Vector3(1, 1, 1);
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

export class Projectiles {
  constructor(scene, world) {
    this.world = world;
    const n = AR.poolSize;
    this.mesh = new THREE.InstancedMesh(arrowGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this.arrows = [];
    this.free = [];
    for (let i = n - 1; i >= 0; i--) {
      this.arrows.push(null);
      this.free.push(i);
    }
    for (let i = 0; i < n; i++) {
      this.arrows[i] = {
        idx: i, state: FREE, pos: new THREE.Vector3(), vel: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
        owner: null, damage: 0, age: 0, pickup: false, body: null, local: new THREE.Matrix4(), whooshed: false,
      };
      this.mesh.setMatrixAt(i, ZERO_M);
    }
    this.flying = [];       // indices of flying arrows
    this.stuckBody = [];    // indices of arrows stuck in bodies
    this.dirty = true;
    this.onHitArcher = null;
    this.onImpact = null;
    this.onNearMiss = null;
    this.listener = null;   // archer whose position triggers near-miss whooshes
    this.trail = new CritTrail(scene);
    this.bodyMatrices = null;
    this.archers = [];
  }

  get activeCount() { return AR.poolSize - this.free.length; }

  _alloc() {
    if (this.free.length) return this.arrows[this.free.pop()];
    // recycle the oldest stuck arrow
    let best = null;
    for (const a of this.arrows) if ((a.state === STUCK) && (!best || a.age > best.age)) best = a;
    if (!best) for (const a of this.arrows) if (a.state === BODY && (!best || a.age > best.age)) best = a;
    if (!best) return null;
    this._release(best);
    return this.arrows[this.free.pop()];
  }

  _release(a) {
    if (a.state === FLYING) this._remove(this.flying, a.idx);
    if (a.state === BODY) this._remove(this.stuckBody, a.idx);
    a.state = FREE;
    a.body = null;
    a.owner = null;
    this.mesh.setMatrixAt(a.idx, ZERO_M);
    this.free.push(a.idx);
    this.dirty = true;
  }

  _remove(list, idx) {
    const k = list.indexOf(idx);
    if (k >= 0) { list[k] = list[list.length - 1]; list.pop(); }
  }

  fire(owner, origin, velocity, damage, crit = false) {
    const a = this._alloc();
    if (!a) return null;
    a.state = FLYING;
    a.pos.copy(origin);
    a.vel.copy(velocity);
    a.owner = owner;
    a.damage = damage;
    a.age = 0;
    a.pickup = false;
    a.whooshed = false;
    a.crit = crit;
    this.flying.push(a.idx);
    this._writeMatrix(a);
    return a;
  }

  _writeMatrix(a) {
    if (a.state === FLYING) a.dir.copy(a.vel).normalize();
    _q.setFromUnitVectors(FWD, a.dir);
    _m.compose(a.pos, _q, ONE);
    this.mesh.setMatrixAt(a.idx, _m);
    this.dirty = true;
  }

  update(dt) {
    const g = AR.gravity;
    const drag = Math.pow(AR.drag, dt * 20); // Minecraft applies ×0.99 per 1/20 s tick
    const terrain = this.world.terrain, forest = this.world.forest;
    for (let k = this.flying.length - 1; k >= 0; k--) {
      const a = this.arrows[this.flying[k]];
      a.age += dt;
      _a.copy(a.pos);
      a.vel.multiplyScalar(drag);
      a.vel.y -= g * dt;
      _b.copy(a.pos).addScaledVector(a.vel, dt);
      if (this.trail) {
        // critical arrows sparkle; a marketplace trail colours every arrow its owner shoots
        const tc = a.owner && a.owner.cos && a.owner.cos.trail ? COSMETICS[a.owner.cos.trail] : null;
        if (a.crit || tc) this.trail.emit(a.pos, dt, tc ? tc.rgb : null);
      }
      let bestT = 2, kind = null, target = null, headshot = false;

      // archers
      for (const ar of this.archers) {
        if (ar === a.owner || !ar.alive) continue;
        const mx = (_a.x + _b.x) * 0.5 - ar.pos.x, mz = (_a.z + _b.z) * 0.5 - ar.pos.z;
        if (mx * mx + mz * mz > 4) continue;
        const h = ar.height;
        const hy = ar.pos.y + h - 0.13;
        let t = segmentSphere(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, ar.pos.x, hy, ar.pos.z, CONFIG.archer.headRadius + 0.03);
        if (t >= 0 && t < bestT) { bestT = t; kind = 'archer'; target = ar; headshot = true; }
        t = segmentVerticalCapsule(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, ar.pos.x, ar.pos.z, ar.pos.y + 0.05, ar.pos.y + h - 0.3, 0.27);
        if (t >= 0 && t < bestT - 1e-4) { bestT = t; kind = 'archer'; target = ar; headshot = false; }
      }
      // trees, rocks, logs
      const hit = forest.raycast(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, false);
      if (hit && hit.t < bestT) { bestT = hit.t; kind = hit.obstacle.canopy ? 'canopy' : hit.obstacle.kind === 0 ? 'wood' : 'rock'; target = hit.obstacle; }
      // ground
      const gh = terrain.height(_b.x, _b.z);
      if (_b.y <= gh) {
        const ga = _a.y - terrain.height(_a.x, _a.z);
        const gb = _b.y - gh;
        const t = ga <= 0 ? 0 : ga / (ga - gb);
        if (t < bestT) { bestT = t; kind = 'ground'; target = null; }
      }

      // near-miss whoosh for the listener
      if (this.listener && !a.whooshed && a.owner !== this.listener && this.onNearMiss) {
        const L = this.listener;
        const dx = _b.x - L.pos.x, dy = _b.y - (L.pos.y + 1.5), dz = _b.z - L.pos.z;
        if (dx * dx + dy * dy + dz * dz < 9) { a.whooshed = true; this.onNearMiss(_b); }
      }

      if (kind) {
        const t = Math.min(bestT, 1);
        a.pos.lerpVectors(_a, _b, t);
        a.dir.copy(a.vel).normalize();
        this._remove(this.flying, a.idx);
        if (kind === 'archer') {
          a.pos.addScaledVector(a.dir, 0.12); // embed
          const res = this.onHitArcher ? this.onHitArcher(a, target, headshot) : true;
          if (res === 'deflect') {
            // target still invulnerable from a recent hit: the arrow bounces off and drops
            a.pos.addScaledVector(a.dir, -0.35);
            a.vel.multiplyScalar(-0.1);
            a.crit = false;
            this.flying.push(a.idx);
            this._writeMatrix(a);
            continue;
          }
          if (res === false) {
            // passed through (e.g. friendly fire off): keep flying
            a.pos.copy(_b);
            this.flying.push(a.idx);
            this._writeMatrix(a);
            continue;
          }
          this._attachToBody(a, target);
        } else {
          a.state = STUCK;
          a.age = 0;
          const pen = kind === 'ground' ? 0.22 : kind === 'wood' ? 0.1 : 0.04;
          a.pos.addScaledVector(a.dir, pen);
          a.pickup = kind === 'ground' || (kind === 'wood' && a.pos.y - terrain.height(a.pos.x, a.pos.z) < 2.4) || kind === 'rock';
          if (kind === 'rock') {
            // glance off rocks: drop to the ground nearby
            a.pos.y = terrain.height(a.pos.x, a.pos.z) + 0.03;
            a.dir.set(a.dir.x, 0.05, a.dir.z).normalize();
          }
          this._writeMatrix(a);
          if (this.onImpact) this.onImpact(kind, a.pos, a.owner);
        }
        continue;
      }

      a.pos.copy(_b);
      const lim = CONFIG.map.size / 2 + 20;
      if (a.age > AR.maxFlightTime || Math.abs(a.pos.x) > lim || Math.abs(a.pos.z) > lim || a.pos.y < -20) {
        this._release(a);
        continue;
      }
      this._writeMatrix(a);
    }

    // arrows stuck in bodies follow the (animated) body
    for (let k = this.stuckBody.length - 1; k >= 0; k--) {
      const a = this.arrows[this.stuckBody[k]];
      a.age += dt;
      const bi = this.archers.indexOf(a.body);
      if (bi < 0 || (!a.body.alive && a.body.deathTime > 30) ) { this._release(a); continue; }
      _m.multiplyMatrices(this.bodyMatrices[bi], a.local);
      this.mesh.setMatrixAt(a.idx, _m);
      this.dirty = true;
    }

    if (this.trail) this.trail.update(dt);
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }

  _attachToBody(a, archer) {
    const bi = this.archers.indexOf(archer);
    if (bi < 0 || !this.bodyMatrices) { this._release(a); return; }
    a.state = BODY;
    a.body = archer;
    a.age = 0;
    _q.setFromUnitVectors(FWD, a.dir);
    _m.compose(a.pos, _q, ONE);
    _inv.copy(this.bodyMatrices[bi]).invert();
    a.local.multiplyMatrices(_inv, _m);
    this.stuckBody.push(a.idx);
  }

  // Clear arrows stuck in a respawning archer
  clearBody(archer) {
    for (let k = this.stuckBody.length - 1; k >= 0; k--) {
      const a = this.arrows[this.stuckBody[k]];
      if (a.body === archer) this._release(a);
    }
  }

  // Pick up stuck arrows near an archer; returns how many were collected.
  collect(archer, radius, maxCount) {
    let n = 0;
    const r2 = radius * radius;
    for (const a of this.arrows) {
      if (n >= maxCount) break;
      if (a.state !== STUCK || !a.pickup) continue;
      const dx = a.pos.x - archer.pos.x, dz = a.pos.z - archer.pos.z;
      if (dx * dx + dz * dz > r2) continue;
      if (a.pos.y < archer.pos.y - 1 || a.pos.y > archer.pos.y + 2.6) continue;
      this._release(a);
      n++;
    }
    return n;
  }

  // Nearest pick-up-able arrow (for AI scavenging and the HUD prompt)
  nearestPickup(pos, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const a of this.arrows) {
      if (a.state !== STUCK || !a.pickup) continue;
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  countPickupsNear(pos, radius) {
    let n = 0;
    const r2 = radius * radius;
    for (const a of this.arrows) {
      if (a.state !== STUCK || !a.pickup) continue;
      const dx = a.pos.x - pos.x, dz = a.pos.z - pos.z;
      if (dx * dx + dz * dz < r2 && Math.abs(a.pos.y - pos.y) < 2.6) n++;
    }
    return n;
  }

  // Remove all arrows (new round)
  clearAll() {
    for (const a of this.arrows) if (a.state !== FREE) this._release(a);
    this.flying.length = 0;
    this.stuckBody.length = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  expireOld() {
    for (const a of this.arrows) if (a.state === STUCK && a.age > AR.stuckLifetime) this._release(a);
  }

  ageStuck(dt) {
    // ages only stuck arrows; flying ones are aged in update()
    for (const a of this.arrows) if (a.state === STUCK) a.age += dt;
  }
}

// Sparkle trail behind critical (full-power) arrows, like Minecraft's crit particles.
class CritTrail {
  constructor(scene, max = 700) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    this.next = 0;
    this.acc = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -999;
    scene.add(this.points);
  }

  emit(p, dt, rgb = null) {
    for (let k = 0; k < 2; k++) {
      const i = this.next;
      this.base[i * 3] = rgb ? rgb[0] : 0.75; this.base[i * 3 + 1] = rgb ? rgb[1] : 0.9; this.base[i * 3 + 2] = rgb ? rgb[2] : 1.0;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * 0.12;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.12;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.12;
      this.life[i] = 0.45;
    }
    this.active = true;
  }

  update(dt) {
    if (!this.active) return;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / 0.45);
      if (t <= 0) this.pos[i * 3 + 1] = -999;
      this.pos[i * 3 + 1] -= dt * 0.3;
      // pale cyan-white sparkle (or the owner's trail colour) fading out
      this.col[i * 3] = this.base[i * 3] * t; this.col[i * 3 + 1] = this.base[i * 3 + 1] * t; this.col[i * 3 + 2] = this.base[i * 3 + 2] * t;
      any = true;
    }
    this.active = any;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
