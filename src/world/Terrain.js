// Terrain heightfield, ground mesh, field grass, sky dome, lighting and atmosphere.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { makeNoise2D, smoothstep, clamp, lerp, mulberry32 } from '../core/utils.js';
import { addWind } from './foliage.js';
import { crossQuadGeometry, grassTexture, flowerTexture, groundTexture } from './pixelArt.js';
const WHITE = new THREE.Color(1, 1, 1);

const M = CONFIG.map;

export class Terrain {
  constructor(scene, { visual = true, models = null } = {}) {
    this.grassModel = models && models.grass && models.grass[0] ? models.grass[0] : null;
    this.scene = scene;
    this.noise = makeNoise2D(M.seed);
    this.noise2 = makeNoise2D(M.seed + 7);
    this.half = M.size / 2;
    this.time = 0;
    this.forestBlend = 1;
    this.grassUniforms = { uTime: { value: 0 } }; // shared wind clock for grass and foliage
    if (!visual) return; // headless server: heights only
    this._buildGround();
    this._buildGrass();
    this._buildSky();
    this._buildLights();
  }

  // 0 in the open field, 1 in the forest
  forestFactor(x, z) {
    const r = Math.hypot(x, z);
    return smoothstep(M.fieldRadius - 1, M.fieldRadius + M.fieldEdgeSoftness, r);
  }

  isField(x, z) { return x * x + z * z < M.fieldRadius * M.fieldRadius; }

  height(x, z) {
    const f = this.forestFactor(x, z);
    const n = this.noise(x / 38, z / 38) + 0.5 * this.noise(x / 14, z / 14);
    const fieldRoll = 0.25 * this.noise2(x / 22, z / 22);
    // gently raise the map edge so the boundary feels enclosed
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const rim = smoothstep(this.half - 25, this.half, edge) * 4;
    return f * M.terrainAmplitude * n + (1 - f) * fieldRoll + rim;
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    const hL = this.height(x - e, z), hR = this.height(x + e, z);
    const hD = this.height(x, z - e), hU = this.height(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  _buildGround() {
    const seg = M.terrainSegments;
    const geo = new THREE.PlaneGeometry(M.size, M.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colours = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(0x6c9a3c), grass2 = new THREE.Color(0x87ad48);
    const floor = new THREE.Color(0x5c5134), floor2 = new THREE.Color(0x4b5a2e);
    const c = new THREE.Color(), c2 = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, this.height(x, z));
      const f = this.forestFactor(x, z);
      const n = this.noise2(x / 6, z / 6) * 0.5 + 0.5;
      c.copy(grass).lerp(grass2, n);
      c2.copy(floor).lerp(floor2, this.noise(x / 9, z / 9) * 0.5 + 0.5);
      c.lerp(c2, f);
      colours[i * 3] = c.r; colours[i * 3 + 1] = c.g; colours[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();
    // blocky look: a 16-pixel tile per metre over the ground colours (brightened to make up for it)
    for (let i = 0; i < colours.length; i++) colours[i] = Math.min(1, colours[i] * 1.18);
    const tex = groundTexture();
    tex.repeat.set(M.size, M.size);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: tex });
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.ground.matrixAutoUpdate = false;
    this.scene.add(this.ground);
  }

  _buildGrass() {
    // Field grass in 20 m tiles: each tile is one instanced draw. Tiles near the camera draw every
    // tuft; distant ones draw only the first fraction (instances are in random order, so the
    // thinning is even). Colour drifts between lush and dry patches by low-frequency noise.
    // The built-in tufts form a dense base layer; a loaded grass model (e.g. from Meshy) adds
    // larger clumps scattered through it.
    const G = CONFIG.graphics;
    this.grassTiles = [];
    // blocky look: pixel-art tufts on crossed quads
    const baseRand = mulberry32(M.seed + 99);
    const grassMat = addWind(new THREE.MeshLambertMaterial({ map: grassTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), { amp: 0.06, gust: 0.08, twoSided: true, uniforms: this.grassUniforms });
    this._grassLayer({
      rand: baseRand,
      total: Math.round(G.grassCount * 0.55),
      looks: [{ geo: crossQuadGeometry(), mat: grassMat }],
      tuftH: 0.55, tuftW: 0.6, tint: null, whiten: 0.1,
    });
    // wildflowers scattered through the field
    const rand = mulberry32(M.seed + 299);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    const fgeo = crossQuadGeometry();
    const fmat = addWind(new THREE.MeshLambertMaterial({ map: flowerTexture(), alphaTest: 0.5, side: THREE.DoubleSide }), { amp: 0.07, gust: 0.08, twoSided: true, uniforms: this.grassUniforms });
    const flowers = new THREE.InstancedMesh(fgeo, fmat, G.flowerCount);
    const palette = [0xf4f1e6, 0xf2d34a, 0xa77ad8, 0xe98fb4, 0xf2f2f2, 0xe8b23a];
    for (let i = 0; i < G.flowerCount; i++) {
      // flowers grow in loose drifts
      const cr = Math.sqrt(rand()) * (M.fieldRadius - 3), ca = rand() * Math.PI * 2;
      const x = Math.cos(ca) * cr, z = Math.sin(ca) * cr;
      p.set(x, this.height(x, z) - 0.02, z);
      q.setFromAxisAngle(up, rand() * 6.28);
      const s = (0.7 + rand() * 0.7) * 0.42;
      sc.set(s, s, s);
      m.compose(p, q, sc);
      flowers.setMatrixAt(i, m);
      const drift = Math.floor((this.noise(x / 12, z / 12) * 0.5 + 0.5) * palette.length * 0.999);
      col.set(palette[rand() < 0.75 ? drift : Math.floor(rand() * palette.length)]);
      flowers.setColorAt(i, col);
    }
    flowers.computeBoundingSphere();
    this.scene.add(flowers);
  }

  _grassLayer({ rand, total, looks, tuftH, tuftW, tint, whiten = 0 }) {
    const TILE = 20, R = M.fieldRadius + 4;
    const tiles = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color(), lush = new THREE.Color(0x5f9a34), dry = new THREE.Color(0xa7a24e), deep = new THREE.Color(0x3f7a2a);
    for (let i = 0; i < total; i++) {
      const r = Math.sqrt(rand()) * R, a = rand() * Math.PI * 2;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // thin out towards the treeline
      if (r > M.fieldRadius - 2 && rand() < (r - M.fieldRadius + 2) / 6) continue;
      const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      if (!tiles.has(key)) tiles.set(key, []);
      tiles.get(key).push([x, z, rand(), rand(), rand(), rand()]);
    }
    for (const list of tiles.values()) for (const { geo, mat } of looks) {
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      let cx = 0, cz = 0;
      list.forEach(([x, z, r1, r2, r3, r4], i) => {
        p.set(x, this.height(x, z) - 0.02, z);
        q.setFromAxisAngle(up, r1 * Math.PI * 2);
        const s = 0.8 + r2 * 0.6;
        sc.set(s * tuftW, s * (0.75 + r3 * 0.6) * tuftH, s * tuftW);
        m.compose(p, q, sc);
        mesh.setMatrixAt(i, m);
        const patch = this.noise2(x / 18 + 40, z / 18) * 0.5 + 0.5;
        col.copy(lush).lerp(deep, this.noise(x / 7, z / 7) * 0.5 + 0.5).lerp(dry, Math.max(0, patch - 0.55) * 1.6);
        col.offsetHSL((r4 - 0.5) * 0.03, 0, (r4 - 0.5) * 0.06);
        // a textured model carries its own greens: tint gently around white, brightened
        if (tint) col.lerp(WHITE, 0.72).multiplyScalar(tint);
        if (whiten) col.lerp(WHITE, whiten);
        mesh.setColorAt(i, col);
        cx += x; cz += z;
      });
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.scene.add(mesh);
      this.grassTiles.push({ mesh, full: list.length, x: cx / list.length, z: cz / list.length });
    }
  }

  // Thin distant grass tiles; called each frame with the camera position.
  _updateGrassLOD(cam) {
    const G = CONFIG.graphics;
    const d2 = G.grassNearDistance * G.grassNearDistance;
    for (const t of this.grassTiles) {
      const dx = t.x - cam.x, dz = t.z - cam.z;
      t.mesh.count = dx * dx + dz * dz < d2 ? t.full : Math.max(1, Math.floor(t.full * G.grassFarFraction));
    }
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(300, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color(0x5d93d6) },
        horizon: { value: new THREE.Color(0xcfe0e8) },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vP;
        void main(){ float h = clamp(vP.y, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.6)), 1.0); }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x7a7650, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sunDir = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();
    if (CONFIG.graphics.shadows) {
      this.sun.castShadow = true;
      const s = CONFIG.graphics.shadowArea / 2;
      const cam = this.sun.shadow.camera;
      cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s;
      cam.near = 1; cam.far = 160;
      this.sun.shadow.mapSize.set(CONFIG.graphics.shadowMapSize, CONFIG.graphics.shadowMapSize);
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.camera.layers.enable(1); // coarse shadow proxies of loaded tree models
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.fog = new THREE.FogExp2(0xa9bfae, 0.014);
    this.forestFog = new THREE.Color(0x8fa592);
    this.fieldFog = new THREE.Color(0xc4d6dc);
  }

  // Blend fog, sky and light between forest gloom and open-field brightness.
  updateAtmosphere(focus, dt) {
    this.time += dt;
    this.grassUniforms.uTime.value = this.time;
    this._updateGrassLOD(focus);
    const target = this.forestFactor(focus.x, focus.z);
    this.forestBlend = lerp(this.forestBlend, target, clamp(dt * 1.5, 0, 1));
    const f = this.forestBlend;
    this.scene.fog.density = lerp(0.0045, 0.017, f);
    this.scene.fog.color.copy(this.fieldFog).lerp(this.forestFog, f);
    this.hemi.intensity = lerp(1.15, 0.95, f);
    this.sun.intensity = lerp(2.6, 2.0, f);
    this.sky.material.uniforms.horizon.value.copy(this.scene.fog.color);
    // shadow camera follows the focus point, snapped to texels to avoid shimmering
    const snap = CONFIG.graphics.shadowArea / CONFIG.graphics.shadowMapSize * 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 80, this.sunDir.y * 80, fz + this.sunDir.z * 80);
    this.sky.position.set(focus.x, 0, focus.z);
  }
}

// Merge non-indexed geometries with identical attributes (avoids the addons import for this tiny case).
export function mergeSimple(geos) {
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const item = geos[0].attributes[n].itemSize;
    let total = 0;
    for (const g of geos) total += g.attributes[n].count * item;
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[n].array, o); o += g.attributes[n].array.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, item));
  }
  return out;
}
