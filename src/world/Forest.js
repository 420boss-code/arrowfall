// Forest generation: chunked, instanced trees and bushes with two LOD levels,
// field rocks and logs, plus a spatial grid for collision, arrows, line of sight and cover.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32, segmentSphere, segmentVerticalCapsule, clamp } from '../core/utils.js';
import { mergeSimple } from './Terrain.js';
import { pineGeometry, broadleafGeometry, trunkGeometry, bushGeometry, fernGeometry, windMaterial, addWind } from './foliage.js';

const F = CONFIG.forest;
const M = CONFIG.map;
const CELL = 5;

// Obstacle kinds
export const K_TRUNK = 0, K_SPHERE = 1, K_BUSH = 2;

function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  // drop uv so merges are uniform
  g.deleteAttribute('uv');
  return g;
}

function jitter(geo, rand, amt) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * (1 + (rand() - 0.5) * amt), p.getY(i) * (1 + (rand() - 0.5) * amt), p.getZ(i) * (1 + (rand() - 0.5) * amt));
  }
  return geo;
}

export class Forest {
  constructor(scene, terrain, { visual = true, models = null } = {}) {
    this.models = models || {};
    this.scene = scene;
    this.terrain = terrain;
    this.rand = mulberry32(M.seed + 3);
    this.half = M.size / 2;
    this.gridN = Math.ceil(M.size / CELL);
    this.grid = Array.from({ length: this.gridN * this.gridN }, () => []);
    this.obstacles = []; // {kind, x, y, z, r, top}
    this.mark = new Uint32Array(0);
    this.stamp = 1;
    this.trees = [];
    this.bushes = [];
    this.spawnPoints = { red: [], blue: [] };
    this._makeSpawnPoints();
    this._place();
    if (visual) this._buildMeshes();
    this._buildProps();
    this.mark = new Uint32Array(this.obstacles.length);
  }

  _makeSpawnPoints() {
    const T = CONFIG.teams;
    for (const [team, sx] of [['red', -T.spawnX], ['blue', T.spawnX]]) {
      for (let i = 0; i < T.size; i++) {
        const row = i % 5, col = Math.floor(i / 5);
        const z = (row - 2) * (T.spawnSpread / 4) * 1.6 + (this.rand() - 0.5) * 2;
        const x = sx + Math.sign(sx) * (col * 3.2) + (this.rand() - 0.5) * 1.5;
        this.spawnPoints[team].push(new THREE.Vector3(x, 0, z));
      }
    }
  }

  _nearSpawn(x, z, r) {
    for (const t of ['red', 'blue']) {
      for (const p of this.spawnPoints[t]) {
        const dx = p.x - x, dz = p.z - z;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  _place() {
    const rand = this.rand;
    const sp = F.treeSpacing;
    const lim = this.half - 2;
    for (let gx = -lim; gx < lim; gx += sp) {
      for (let gz = -lim; gz < lim; gz += sp) {
        const x = gx + (rand() - 0.5) * sp * 0.9;
        const z = gz + (rand() - 0.5) * sp * 0.9;
        const ff = this.terrain.forestFactor(x, z);
        if (rand() > F.treeDensity * Math.pow(ff, 2)) {
          // occasional bush in the space instead
          if (ff > 0.5 && rand() < F.bushDensity * 0.6) this._addBush(x + 1, z - 1);
          continue;
        }
        if (this._nearSpawn(x, z, 2.2)) continue;
        const y = this.terrain.height(x, z);
        const pine = rand() < 0.55;
        const scale = 0.75 + rand() * 0.6;
        const trunkR = (pine ? 0.22 : 0.3) * scale * (0.8 + rand() * 0.4);
        const trunkH = (pine ? 3.0 : 4.2) * scale;   // bare trunk height below the canopy
        const canopyH = (pine ? 9 : 5.5) * scale;
        const canopyW = (pine ? 4.2 : 6.5) * scale * (0.85 + rand() * 0.3);
        const canopyY = pine ? y + Math.max(2.4, trunkH) : y + Math.max(3.1, trunkH) + canopyH * 0.25;
        const tree = { x, y, z, pine, trunkR, trunkH: (canopyY - y) + canopyH * (pine ? 0.6 : 0.3), canopyY, canopyH, canopyW, rot: rand() * Math.PI * 2 };
        this.trees.push(tree);
        // trunk collider: vertical capsule
        this._addObstacle({ kind: K_TRUNK, x, y, z, r: trunkR + 0.05, top: y + tree.trunkH });
        // canopy collider(s): spheres that block arrows and sight, not movement
        if (pine) {
          this._addObstacle({ kind: K_SPHERE, x, y: canopyY + canopyH * 0.3, z, r: canopyW * 0.32, canopy: true });
          this._addObstacle({ kind: K_SPHERE, x, y: canopyY + canopyH * 0.6, z, r: canopyW * 0.2, canopy: true });
        } else {
          this._addObstacle({ kind: K_SPHERE, x, y: canopyY + canopyH * 0.05, z, r: canopyW * 0.42, canopy: true });
        }
        if (rand() < F.bushDensity) this._addBush(x + (rand() - 0.5) * 3, z + (rand() - 0.5) * 3);
      }
    }
  }

  _addBush(x, z) {
    if (Math.abs(x) > this.half - 3 || Math.abs(z) > this.half - 3) return;
    if (this._nearSpawn(x, z, 2)) return;
    const ff = this.terrain.forestFactor(x, z);
    if (ff < 0.4) return;
    const r = 0.7 + this.rand() * 0.8;
    const y = this.terrain.height(x, z);
    const b = { x, y, z, r, h: r * (0.7 + this.rand() * 0.3), rot: this.rand() * 6.28 };
    this.bushes.push(b);
    this._addObstacle({ kind: K_BUSH, x, y: y + b.h * 0.5, z, r: r * 0.95 });
  }

  _addObstacle(o) {
    const idx = this.obstacles.length;
    this.obstacles.push(o);
    const reach = o.r;
    const x0 = this._cell(o.x - reach), x1 = this._cell(o.x + reach);
    const z0 = this._cell(o.z - reach), z1 = this._cell(o.z + reach);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) this.grid[j * this.gridN + i].push(idx);
    return idx;
  }

  _cell(v) { return clamp(Math.floor((v + this.half) / CELL), 0, this.gridN - 1); }

  _buildMeshes() {
    const vrand = mulberry32(M.seed + 77); // visual-only randomness: never touches layout
    const geos = {
      pineHi: pineGeometry(vrand, 'hi'), pineLo: pineGeometry(vrand, 'lo'),
      broadHi: broadleafGeometry(vrand, 'hi'), broadLo: broadleafGeometry(vrand, 'lo'),
      trunkHi: trunkGeometry(vrand, 'hi'), trunkLo: trunkGeometry(vrand, 'lo'),
      bushHi: bushGeometry(vrand, 'hi'), bushLo: bushGeometry(vrand, 'lo'),
      fern: fernGeometry(vrand),
    };
    const uniforms = this.terrain.grassUniforms;
    const mats = {
      trunk: new THREE.MeshLambertMaterial({ vertexColors: true }),
      pine: windMaterial({ amp: 0.022, uniforms }),
      broad: windMaterial({ amp: 0.03, uniforms }),
      bush: windMaterial({ amp: 0.04, uniforms }),
      fern: windMaterial({ amp: 0.12, twoSided: true, uniforms }),
    };
    const nC = Math.ceil(M.size / F.chunkSize);
    const chunks = Array.from({ length: nC * nC }, () => ({ trunk: [], pine: [], broad: [], bush: [], fern: [], model: new Map() }));
    const models = this.models;
    const pickModel = (kind, x, z) => { const list = models[kind]; return list && list.length ? list[Math.abs(Math.floor(x * 7.31 + z * 3.17)) % list.length] : null; };
    const addModel = (c, model, item) => { if (!c.model.has(model)) c.model.set(model, []); c.model.get(model).push(item); };
    const chunkOf = (x, z) => {
      const i = clamp(Math.floor((x + this.half) / F.chunkSize), 0, nC - 1);
      const j = clamp(Math.floor((z + this.half) / F.chunkSize), 0, nC - 1);
      return chunks[j * nC + i];
    };
    for (const t of this.trees) {
      const c = chunkOf(t.x, t.z);
      const model = pickModel(t.pine ? 'pine' : 'broadleaf', t.x, t.z);
      if (model) { addModel(c, model, t); continue; } // a loaded model replaces trunk and canopy
      c.trunk.push(t);
      (t.pine ? c.pine : c.broad).push(t);
    }
    for (const b of this.bushes) {
      const c = chunkOf(b.x, b.z);
      const model = pickModel('bush', b.x, b.z);
      if (model) addModel(c, model, b); else c.bush.push(b);
    }
    // wind-swayed copies of the loaded models' materials
    for (const list of Object.values(models)) for (const model of list) {
      for (const part of model.parts) if (!part.windy) { addWind(part.material, { amp: model.parts.length && list === models.bush ? 0.04 : 0.012, uniforms }); part.windy = true; }
    }
    // ferns carpet the forest floor (visual only: no collision, no effect on sight)
    for (let k = 0; k < F.fernCount; k++) {
      const x = (vrand() - 0.5) * (M.size - 6), z = (vrand() - 0.5) * (M.size - 6);
      if (this.terrain.forestFactor(x, z) < 0.75 || this._nearSpawn(x, z, 1.5)) continue;
      chunkOf(x, z).fern.push({ x, y: this.terrain.height(x, z), z, s: 0.7 + vrand() * 0.8, rot: vrand() * 6.28 });
    }

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const rand = vrand;
    this.chunks = [];
    const make = (list, hi, lo, mat, fill, shadow) => {
      if (!list.length) return null;
      const meshHi = new THREE.InstancedMesh(hi, mat, list.length);
      const meshLo = lo ? new THREE.InstancedMesh(lo, mat, list.length) : null;
      list.forEach((item, i) => {
        fill(item, col);
        m.compose(p, q, s);
        meshHi.setMatrixAt(i, m); meshHi.setColorAt(i, col);
        if (meshLo) { meshLo.setMatrixAt(i, m); meshLo.setColorAt(i, col); }
      });
      meshHi.castShadow = shadow; meshHi.receiveShadow = true;
      meshHi.computeBoundingSphere();
      meshHi.matrixAutoUpdate = false;
      this.scene.add(meshHi);
      if (meshLo) {
        meshLo.receiveShadow = false;
        meshLo.computeBoundingSphere();
        meshLo.matrixAutoUpdate = false;
        meshLo.visible = false;
        this.scene.add(meshLo);
      }
      return { hi: meshHi, lo: meshLo };
    };
    chunks.forEach((c, idx) => {
      const ci = idx % nC, cj = Math.floor(idx / nC);
      const centre = new THREE.Vector3((ci + 0.5) * F.chunkSize - this.half, 0, (cj + 0.5) * F.chunkSize - this.half);
      const parts = [];
      parts.push(make(c.trunk, geos.trunkHi, geos.trunkLo, mats.trunk, (t, cl) => {
        p.set(t.x, t.y - 0.2, t.z); q.setFromAxisAngle(up, t.rot); s.set(t.trunkR, t.trunkH + 0.2, t.trunkR);
        cl.setHSL(0.07 + rand() * 0.03, 0.3 + rand() * 0.1, 0.2 + rand() * 0.08);
      }, true));
      parts.push(make(c.pine, geos.pineHi, geos.pineLo, mats.pine, (t, cl) => {
        p.set(t.x, t.canopyY, t.z); q.setFromAxisAngle(up, t.rot); s.set(t.canopyW, t.canopyH, t.canopyW);
        cl.setHSL(0.3 + rand() * 0.06, 0.42 + rand() * 0.1, 0.19 + rand() * 0.07);
      }, true));
      parts.push(make(c.broad, geos.broadHi, geos.broadLo, mats.broad, (t, cl) => {
        p.set(t.x, t.canopyY + t.canopyH * 0.05, t.z); q.setFromAxisAngle(up, t.rot); s.set(t.canopyW, t.canopyH * 0.9, t.canopyW);
        // mostly fresh greens with the odd tree turning olive or gold
        const turn = rand() < 0.12;
        cl.setHSL(turn ? 0.13 + rand() * 0.05 : 0.22 + rand() * 0.08, turn ? 0.55 : 0.5, (turn ? 0.3 : 0.25) + rand() * 0.08);
      }, true));
      parts.push(make(c.bush, geos.bushHi, geos.bushLo, mats.bush, (b, cl) => {
        p.set(b.x, b.y + b.h * 0.75, b.z); q.setFromAxisAngle(up, b.rot); s.set(b.r, b.h, b.r);
        cl.setHSL(0.27 + rand() * 0.06, 0.45, 0.22 + rand() * 0.08);
      }, false));
      parts.push(make(c.fern, geos.fern, null, mats.fern, (f, cl) => {
        p.set(f.x, f.y - 0.02, f.z); q.setFromAxisAngle(up, f.rot); s.set(f.s, f.s * (0.8 + rand() * 0.4), f.s);
        cl.setHSL(0.24 + rand() * 0.08, 0.5, 0.26 + rand() * 0.08);
      }, false));
      // loaded tree models: one instanced mesh per material, near and far versions
      for (const [model, items] of c.model) {
        const isBush = models.bush && models.bush.includes(model);
        for (const part of model.parts) {
          const made = make(items, part.hi, part.lo, part.material, (it, cl) => {
            if (isBush) {
              const h = it.h * 1.25, w = it.r * 2.1;
              p.set(it.x, it.y - 0.05, it.z); s.set(w / model.width, h, w / model.width);
            } else {
              // fit the model to the tree's size: total height, and canopy width (within limits)
              const H = (it.canopyY - it.y) + it.canopyH * (it.pine ? 1 : 0.5);
              const sh = Math.min(1.5 * H, Math.max(0.6 * H, it.canopyW / model.width));
              p.set(it.x, it.y - 0.15, it.z); s.set(sh, H, sh);
            }
            q.setFromAxisAngle(up, it.rot);
            const v = 0.88 + rand() * 0.22;
            cl.setRGB(v, v * (0.97 + rand() * 0.06), v);
          }, false);
          if (!made) continue;
          made.modelLod = true;
          if (!isBush) {
            // shadows come from the coarse version, drawn only by the sun's shadow camera (layer 1)
            const proxy = new THREE.InstancedMesh(part.lo, part.material, items.length);
            proxy.instanceMatrix.copy(made.hi.instanceMatrix);
            proxy.castShadow = true;
            proxy.layers.set(1);
            proxy.matrixAutoUpdate = false;
            proxy.computeBoundingSphere();
            this.scene.add(proxy);
            made.shadow = proxy;
          }
          parts.push(made);
        }
      }
      this.chunks.push({ centre, parts: parts.filter(Boolean) });
    });
  }

  _buildProps() {
    // Field rocks and fallen logs for light cover, plus a scattering of forest rocks.
    const rand = this.rand;
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x8a8a84 });
    const logMat = new THREE.MeshLambertMaterial({ color: 0x5b4330 });
    const endMat = new THREE.MeshLambertMaterial({ color: 0xa88a5e });
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x59634b });
    const crateBoardMat = new THREE.MeshLambertMaterial({ color: 0x72775a });
    const crateTrimMat = new THREE.MeshLambertMaterial({ color: 0x343a31 });
    const crateMarkMat = new THREE.MeshLambertMaterial({ color: 0xc58a3c });
    const group = new THREE.Group();
    const rocks = [];
    for (let i = 0; i < F.rocksInField; i++) {
      const a = (i / F.rocksInField) * Math.PI * 2 + rand() * 0.6;
      const r = 13 + rand() * 22;
      rocks.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.9 + rand() * 0.7 });
    }
    for (let i = 0; i < 40; i++) {
      const x = (rand() - 0.5) * (M.size - 20), z = (rand() - 0.5) * (M.size - 20);
      if (this.terrain.forestFactor(x, z) < 1 || this._nearSpawn(x, z, 4)) continue;
      rocks.push({ x, z, s: 0.5 + rand() * 0.9 });
    }
    for (const rk of rocks) {
      const geo = flat(jitter(new THREE.DodecahedronGeometry(1, 0), rand, 0.35));
      const mesh = new THREE.Mesh(geo, rockMat);
      const y = this.terrain.height(rk.x, rk.z);
      mesh.position.set(rk.x, y + rk.s * 0.35, rk.z);
      mesh.scale.set(rk.s * 1.3, rk.s * 0.9, rk.s * 1.1);
      mesh.rotation.y = rand() * 6;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      this._addObstacle({ kind: K_SPHERE, x: rk.x, y: y + rk.s * 0.3, z: rk.z, r: rk.s * 1.05, solid: true });
    }
    this.fieldRocks = rocks.slice(0, F.rocksInField);

    // Tactical field crates: original low-poly cover props with simple stencil markings.
    const crateBody = new THREE.BoxGeometry(1.6, 1.3, 1.4);
    const crateBoard = new THREE.BoxGeometry(1.48, 0.12, 0.035);
    const crateRail = new THREE.BoxGeometry(0.11, 1.34, 0.08);
    const crateMarkH = new THREE.BoxGeometry(0.48, 0.07, 0.025);
    const crateMarkV = new THREE.BoxGeometry(0.07, 0.34, 0.025);
    const crates = [[-27, -19, 0.2], [25, -23, -0.35], [-24, 25, -0.25], [27, 19, 0.4]];
    for (const [x, z, turn] of crates) {
      const y = this.terrain.height(x, z), crate = new THREE.Group();
      const piece = (geo, mat, px, py, pz) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(px, py, pz);
        mesh.castShadow = mesh.receiveShadow = true;
        crate.add(mesh);
      };
      piece(crateBody, crateMat, 0, 0.67, 0);
      piece(crateBoard, crateBoardMat, 0, 0.28, 0.715);
      piece(crateBoard, crateBoardMat, 0, 0.62, 0.715);
      piece(crateBoard, crateBoardMat, 0, 0.96, 0.715);
      piece(crateBoard, crateBoardMat, 0, 0.28, -0.715);
      piece(crateBoard, crateBoardMat, 0, 0.62, -0.715);
      piece(crateBoard, crateBoardMat, 0, 0.96, -0.715);
      for (const px of [-0.75, 0.75]) piece(crateRail, crateTrimMat, px, 0.67, 0.69);
      piece(crateMarkH, crateMarkMat, 0, 0.69, 0.739);
      piece(crateMarkV, crateMarkMat, 0, 0.69, 0.74);
      crate.position.set(x, y, z);
      crate.rotation.y = turn;
      group.add(crate);
      this._addObstacle({ kind: K_TRUNK, x, y: y + 1, z, top: y + 1.35, r: 0.95, solid: true });
    }

    // logs
    this.logs = [];
    for (let i = 0; i < F.logsInField; i++) {
      const a = rand() * Math.PI * 2 + i * Math.PI;
      const r = 16 + rand() * 12;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      const len = 6 + rand() * 2.5, rad = 0.38 + rand() * 0.1;
      const ang = a + Math.PI / 2 + (rand() - 0.5) * 0.6;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      const geo = new THREE.CylinderGeometry(rad, rad * 1.1, len, 9);
      geo.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, [logMat, endMat, endMat]);
      const y = this.terrain.height(cx, cz) + rad * 0.8;
      mesh.position.set(cx, y, cz);
      mesh.rotation.y = -ang;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      const n = Math.ceil(len / (rad * 1.4));
      for (let k = 0; k <= n; k++) {
        const t = (k / n - 0.5) * len;
        const px = cx + dx * t, pz = cz + dz * t;
        this._addObstacle({ kind: K_SPHERE, x: px, y: this.terrain.height(px, pz) + rad * 0.8, z: pz, r: rad * 1.05, solid: true });
      }
      this.logs.push({ x: cx, z: cz, len, ang });
    }
    this.scene.add(group);
  }

  // Swap chunk LODs by distance from the camera.
  updateLOD(camPos) {
    const d2 = F.lodDistance * F.lodDistance;
    const m2 = F.modelLodDistance * F.modelLodDistance;
    for (const c of this.chunks) {
      const dx = c.centre.x - camPos.x, dz = c.centre.z - camPos.z;
      const dd = dx * dx + dz * dz + F.chunkSize * F.chunkSize * 0.5;
      const near = dd < d2 + F.chunkSize * F.chunkSize, nearModel = dd < m2 + F.chunkSize * F.chunkSize;
      for (const p of c.parts) {
        const n = p.modelLod ? nearModel : near;
        p.hi.visible = n;
        if (p.lo) p.lo.visible = !n;
        if (p.shadow) p.shadow.visible = near;
      }
    }
  }

  _query(x0, z0, x1, z1, cb) {
    this.stamp++;
    if (this.stamp > 4e9) { this.mark.fill(0); this.stamp = 1; }
    const i0 = this._cell(Math.min(x0, x1)), i1 = this._cell(Math.max(x0, x1));
    const j0 = this._cell(Math.min(z0, z1)), j1 = this._cell(Math.max(z0, z1));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cell = this.grid[j * this.gridN + i];
        for (let k = 0; k < cell.length; k++) {
          const idx = cell[k];
          if (this.mark[idx] === this.stamp) continue;
          this.mark[idx] = this.stamp;
          if (cb(this.obstacles[idx], idx) === false) return;
        }
      }
    }
  }

  // Push a circle (feet at y) out of trunks, rocks and logs. Mutates pos.
  collideCircle(pos, radius, feetY) {
    this._query(pos.x - radius, pos.z - radius, pos.x + radius, pos.z + radius, (o) => {
      if (o.kind === K_BUSH) return;
      if (o.kind === K_SPHERE) {
        if (o.canopy) return;
        if (feetY > o.y + o.r * 0.6) return; // standing on / jumping over
      }
      const dx = pos.x - o.x, dz = pos.z - o.z;
      let rr = o.r + radius;
      if (o.kind === K_SPHERE) {
        // horizontal radius at foot height
        const dy = clamp(feetY + 0.3 - o.y, -o.r, o.r);
        rr = Math.sqrt(Math.max(0, o.r * o.r - dy * dy)) + radius;
      }
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = o.x + (dx / d) * rr;
        pos.z = o.z + (dz / d) * rr;
      }
    });
  }

  // Test a segment against trunks, canopies, rocks, logs (and bushes if sight=true).
  // Returns {t, obstacle} for the nearest hit or null.
  raycast(ax, ay, az, bx, by, bz, sight = false) {
    let bestT = 2, best = null;
    this._query(ax, az, bx, bz, (o) => {
      let t;
      if (o.kind === K_TRUNK) t = segmentVerticalCapsule(ax, ay, az, bx, by, bz, o.x, o.z, o.y - 1, o.top, o.r);
      else if (o.kind === K_BUSH) { if (!sight) return; t = segmentSphere(ax, ay, az, bx, by, bz, o.x, o.y, o.z, o.r); }
      else t = segmentSphere(ax, ay, az, bx, by, bz, o.x, o.y, o.z, o.r * (o.canopy ? 0.85 : 1));
      if (t >= 0 && t < bestT) { bestT = t; best = o; }
    });
    return best ? { t: bestT, obstacle: best } : null;
  }

  // Line of sight with early-out, walked in short pieces so long rays stay cheap.
  lineOfSight(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / 10));
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const hit = this.raycast(a.x + dx * t0, a.y + dy * t0, a.z + dz * t0, a.x + dx * t1, a.y + dy * t1, a.z + dz * t1, true);
      if (hit) return false;
      // terrain occlusion at segment end (cheap midpoint check)
      const mx = a.x + dx * t1, mz = a.z + dz * t1, my = a.y + dy * t1;
      if (my < this.terrain.height(mx, mz) + 0.2) return false;
    }
    return true;
  }

  // Find a cover spot behind a trunk or rock relative to a threat position.
  findCover(pos, threat, maxDist = 14) {
    let best = null, bestScore = Infinity;
    this._query(pos.x - maxDist, pos.z - maxDist, pos.x + maxDist, pos.z + maxDist, (o) => {
      if (o.kind === K_BUSH || o.canopy) return;
      if (o.kind === K_TRUNK && o.r < 0.18) return;
      const dx = o.x - pos.x, dz = o.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d > maxDist) return;
      const tx = o.x - threat.x, tz = o.z - threat.z;
      const tl = Math.hypot(tx, tz) || 1;
      if (tl < 8) return; // too close to the threat
      const off = o.r + 0.55;
      const cx = o.x + (tx / tl) * off, cz = o.z + (tz / tl) * off;
      const dc = Math.hypot(cx - pos.x, cz - pos.z);
      // prefer close cover that is roughly between us and the threat, and thicker trunks
      const score = dc - o.r * 4;
      if (score < bestScore) { bestScore = score; best = { x: cx, z: cz, obstacle: o }; }
    });
    return best;
  }

  // Count trunks around a position (used by AI to judge exposure)
  coverDensity(x, z, r = 6) {
    let n = 0;
    this._query(x - r, z - r, x + r, z + r, (o) => { if (o.kind === K_TRUNK) n++; });
    return n;
  }
}
