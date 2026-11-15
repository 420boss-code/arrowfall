// Pooled particle effects, drawn as two point clouds (one draw call each):
//   soft  – round, soft-edged sprites: smoke puffs, dust and glowing motes
//   shard – small square flecks: torn cloth that tumbles, lands and fades
// Used for the death "poof". Every particle lives in fixed typed arrays; nothing is allocated per effect.
import * as THREE from 'three';

const VERT = `
  attribute float size;
  attribute float alpha;
  attribute vec3 tint;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vDist;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDist = -mv.z;
    gl_PointSize = size * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = alpha;
    vTint = tint;
  }`;
const FRAG = `
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying float vAlpha;
  varying vec3 vTint;
  varying float vDist;
  void main() {
    vec4 t = texture2D(map, gl_PointCoord);
    if (t.a * vAlpha < 0.01) discard;
    float fog = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
    gl_FragColor = vec4(mix(vTint * t.rgb, fogColor, fog), t.a * vAlpha);
  }`;

function spriteTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (kind === 'soft') {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  } else {
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(10, 14); g.lineTo(52, 8); g.lineTo(56, 50); g.lineTo(14, 56); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Pool {
  constructor(scene, kind, max, additive) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);   // seconds left
    this.span = new Float32Array(max);   // total lifetime
    this.grow = new Float32Array(max);   // size growth per second
    this.grav = new Float32Array(max);   // gravity multiplier (negative rises)
    this.drag = new Float32Array(max);
    this.a0 = new Float32Array(max);     // starting alpha
    this.ground = new Uint8Array(max);   // 1 = settles on the terrain
    this.next = 0;
    this.live = 0;
    const g = new THREE.BufferGeometry();
    const attr = (name, arr, n) => g.setAttribute(name, new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage));
    attr('position', this.pos, 3); attr('tint', this.tint, 3); attr('size', this.size, 1); attr('alpha', this.alpha, 1);
    this.geo = g;
    this.uniforms = { map: { value: spriteTexture(kind) }, uScale: { value: 500 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, { size, grow = 0, life, grav = 0, drag = 0, alpha = 1, r = 1, gg = 1, b = 1, ground = 0 }) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    const k = i * 3;
    this.pos[k] = x; this.pos[k + 1] = y; this.pos[k + 2] = z;
    this.vel[k] = vx; this.vel[k + 1] = vy; this.vel[k + 2] = vz;
    this.tint[k] = r; this.tint[k + 1] = gg; this.tint[k + 2] = b;
    this.size[i] = size; this.grow[i] = grow; this.life[i] = life; this.span[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.a0[i] = alpha; this.alpha[i] = alpha; this.ground[i] = ground;
    this.live = Math.max(this.live, 1);
  }

  update(dt, terrain) {
    if (!this.live) return;
    let any = 0;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      any++;
      const k = i * 3, d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k] *= d; this.vel[k + 2] *= d;
      this.vel[k + 1] = this.vel[k + 1] * d - 9.8 * this.grav[i] * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.ground[i]) {
        const gy = terrain.height(this.pos[k], this.pos[k + 2]) + 0.02;
        if (this.pos[k + 1] < gy) { this.pos[k + 1] = gy; this.vel[k] *= 0.3; this.vel[k + 1] = 0; this.vel[k + 2] *= 0.3; }
      }
      this.size[i] += this.grow[i] * dt;
      const t = this.life[i] / this.span[i];                 // 1 → 0 over the lifetime
      const fadeIn = Math.min(1, (1 - t) * 8);                // quick fade in
      const fadeOut = this.ground[i] ? Math.min(1, t * 4) : t; // shards hold, then fade at the end
      this.alpha[i] = this.a0[i] * fadeIn * fadeOut;
    }
    this.live = any;
    for (const n of ['position', 'tint', 'size', 'alpha']) this.geo.attributes[n].needsUpdate = true;
  }
}

const TEAM = { blue: new THREE.Color(0x2f6fd6), red: new THREE.Color(0xc8352b) };

export class Particles {
  constructor(game) {
    this.game = game;
    this.soft = new Pool(game.scene, 'soft', 700, false);
    this.glow = new Pool(game.scene, 'soft', 200, true);
    this.shard = new Pool(game.scene, 'shard', 400, false);
    this.pending = [];   // delayed effects: { at, fn }
  }

  // The death poof: smoke billowing from the body, team-coloured scraps, rising motes, then dust on landing.
  death(a, big = false, skipSmoke = false) {
    const g = this.game;
    const x = a.pos.x, y = a.pos.y, z = a.pos.z, h = a.height;
    const rnd = (s) => (Math.random() - 0.5) * s;
    const n = big ? 1.5 : 1;
    if (!skipSmoke) {
      for (let k = 0; k < 20 * n; k++) {
        const v = 0.6 + Math.random() * 0.4;
        this.soft.spawn(x + rnd(0.6), y + 0.2 + Math.random() * h, z + rnd(0.6), rnd(2.2), 0.4 + Math.random() * 0.9, rnd(2.2),
          { size: 0.35 + Math.random() * 0.3, grow: 0.7, life: 1.1 + Math.random() * 0.8, grav: -0.04, drag: 2.2, alpha: 0.75, r: v, gg: v, b: v });
      }
    }
    const team = a.colour !== undefined ? new THREE.Color(a.colour) : TEAM[a.team] || TEAM.blue;
    for (let k = 0; k < 16 * n; k++) {
      const c = Math.random() < 0.75 ? team : new THREE.Color(0x5a3b22);
      const s = 0.7 + Math.random() * 0.5;
      this.shard.spawn(x + rnd(0.4), y + 0.6 + Math.random() * 0.9, z + rnd(0.4), rnd(5), 2 + Math.random() * 3.5, rnd(5),
        { size: 0.07 + Math.random() * 0.06, life: 3 + Math.random() * 1.5, grav: 0.55, drag: 1.6, r: c.r * s, gg: c.g * s, b: c.b * s, ground: 1 });
    }
    for (let k = 0; k < 10 * n; k++) {
      this.glow.spawn(x + rnd(0.5), y + 0.5 + Math.random() * 1.2, z + rnd(0.5), rnd(0.4), 0.6 + Math.random() * 0.8, rnd(0.4),
        { size: 0.09 + Math.random() * 0.07, life: 1.6 + Math.random() * 1.2, grav: -0.02, drag: 0.6, alpha: 0.9, r: 1, gg: 0.82, b: 0.45 });
    }
    // dust where the body hits the ground, as the fall finishes
    const fx = -Math.sin(a.yaw) * -a.deathDir, fz = -Math.cos(a.yaw) * -a.deathDir;
    this.pending.push({ at: g.time + (a.deathStyle === 2 ? 1.0 : 0.6), fn: () => {
      for (let k = 0; k < 12; k++) {
        const t = 0.3 + Math.random() * 1.2;
        const px = x + fx * t + rnd(0.5), pz = z + fz * t + rnd(0.5);
        this.soft.spawn(px, g.terrain.height(px, pz) + 0.1, pz, rnd(1.6), 0.25 + Math.random() * 0.3, rnd(1.6),
          { size: 0.3 + Math.random() * 0.25, grow: 0.5, life: 0.9 + Math.random() * 0.6, drag: 2.5, alpha: 0.45, r: 0.62, gg: 0.56, b: 0.42 });
      }
    } });
  }

  update(dt) {
    const g = this.game;
    for (let k = this.pending.length - 1; k >= 0; k--) {
      if (g.time >= this.pending[k].at) { this.pending[k].fn(); this.pending.splice(k, 1); }
    }
    // keep sprite scale and fog in step with the camera and scene
    const scale = g.renderer.domElement.height / (2 * Math.tan((g.camera.fov * Math.PI) / 360));
    for (const p of [this.soft, this.glow, this.shard]) {
      p.uniforms.uScale.value = scale;
      if (g.scene.fog) { p.uniforms.fogColor.value.copy(g.scene.fog.color); p.uniforms.fogDensity.value = g.scene.fog.density; }
      p.update(dt, g.terrain);
    }
  }

  clear() {
    this.pending.length = 0;
    for (const p of [this.soft, this.glow, this.shard]) { p.life.fill(0); p.alpha.fill(0); p.live = 1; }
  }
}
