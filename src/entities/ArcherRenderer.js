// Draws every archer with two instanced meshes (body boxes + bows): 2 draw calls for 40 archers.
// Animation is procedural: joints are computed in the archer's local frame each frame
// (walk/run cycles, crouch, two-bone IK for the drawing arms, a fall for death)
// and limbs are drawn as boxes stretched between joints.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp, wrapAngle } from '../core/utils.js';
import { arrowGeometry } from '../combat/Projectiles.js';
import { COSMETICS } from '../core/items.js';
import { voxelBowGeometry, clothTexture, faceTexture, skinTexture, hairTexture } from '../world/pixelArt.js';

const C = CONFIG.colours;
const PARTS = ['hips', 'torso', 'head', 'hood', 'uArmL', 'fArmL', 'uArmR', 'fArmR', 'thighL', 'shinL', 'thighR', 'shinR',
  'quiver', 'strTop', 'strBot', 'nocked', 'belt'];
const NP = PARTS.length;

const _v = Array.from({ length: 24 }, () => new THREE.Vector3());
const W = Array.from({ length: 16 }, () => new THREE.Vector3()); // extra scratch for poses
const _eul = new THREE.Euler();
const H = CONFIG.health;
const K = CONFIG.knife;
const RELOAD = CONFIG.bow.reloadTime;
const ARROW_L = CONFIG.arrows.length;
const DRAW_LEN = 0.56;              // grip to anchor at full draw
const BRACE = 0.13;                 // string to grip at rest
const FWD_Z = new THREE.Vector3(0, 0, 1), UPV = new THREE.Vector3(0, 1, 0);
const ease = (t) => t * t * (3 - 2 * t);
const seg01 = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const rotY = (out, x, y, z, th) => out.set(x * Math.cos(th) + z * Math.sin(th), y, -x * Math.sin(th) + z * Math.cos(th));
const POLE_UP = new THREE.Vector3(0.3, 1, 0.6), POLE_OUT_L = new THREE.Vector3(-1, -0.2, 0.2), POLE_OUT_R = new THREE.Vector3(1, -0.2, 0.2), POLE_DOWN = new THREE.Vector3(0.6, -1, 0.3);
// kneeling pose (local space): left foot planted in front, right knee on the ground
const KNEEL = { kL: new THREE.Vector3(-0.11, 0.5, -0.42), fL: new THREE.Vector3(-0.11, 0.03, -0.45), kR: new THREE.Vector3(0.11, 0.07, 0.03), fR: new THREE.Vector3(0.11, 0.05, 0.46) };
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const POLE_L = new THREE.Vector3(-1, -0.6, 0.3), POLE_R = new THREE.Vector3(0.55, 0.3, 1); // draw elbow high and back
// dedicated scratch vectors so animating 40 archers allocates nothing per frame
const S_ELL = new THREE.Vector3(), S_ELR = new THREE.Vector3(), S_NOCK = new THREE.Vector3(), S_TIP = new THREE.Vector3();
const S_ANCHOR = new THREE.Vector3(), S_REST = new THREE.Vector3(), S_ADIR = new THREE.Vector3(), S_QDIR = new THREE.Vector3(), S_QBOT = new THREE.Vector3(), S_A = new THREE.Vector3(), S_B = new THREE.Vector3();
const FLASH = new THREE.Color(1, 0.55, 0.5);
const FP_HIDDEN = [1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16]; // torso, head, hood, arms, quiver, string, arrow, belt
const TEAM_PARTS = new Set(['torso', 'hood', 'uArmL', 'uArmR']), DARK_PARTS = new Set(['hips', 'thighL', 'thighR']);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BOW_WOOD = new THREE.Color(0x6b4423), WHITE = new THREE.Color(1, 1, 1);
const HOOD = PARTS.indexOf('hood'), TORSO = PARTS.indexOf('torso');
const _cc = new THREE.Color();

// Blocky look: a bow built from small cubes (tips at y ±0.62, belly toward -Z), coloured by vertex
// shades that the bow's wood colour tints.
export function bowGeometry() {
  return voxelBowGeometry();
}

const VISUAL = typeof document !== 'undefined';

export class ArcherRenderer {
  constructor(scene, archers, props = null) {
    this.archers = archers;
    this.max = archers.length;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    // blocky look: a speckled pixel cloth over every body box (tinted per part by the instance colour)
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: VISUAL ? clothTexture() : null });
    this.boxes = new THREE.InstancedMesh(boxGeo, mat, this.max * NP);
    this.boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boxes.castShadow = true;
    this.boxes.receiveShadow = true;
    this.boxes.frustumCulled = false;
    this.bows = new THREE.InstancedMesh(bowGeometry(), new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), this.max);
    for (let i = 0; i < this.max; i++) this.bows.setColorAt(i, BOW_WOOD);
    this.bows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bows.castShadow = true;
    this.bows.frustumCulled = false;
    // knife (on the belt, in the hand when stabbing), quiver on the back, and the arrow being nocked or
    // carried from the quiver: one instanced draw each
    const vc = () => new THREE.MeshLambertMaterial({ vertexColors: true });
    const mk = (geo) => { const m = new THREE.InstancedMesh(geo, vc(), this.max); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.frustumCulled = false; return m; };
    this.knives = mk(props ? props.knife : new THREE.BoxGeometry(0.02, 0.03, 0.25).setAttribute('color', new THREE.Float32BufferAttribute(new Array(72).fill(0.6), 3)));
    this.quivers = mk(props ? props.quiver : new THREE.BoxGeometry(0.2, 1, 0.2).translate(0, 0.5, 0).setAttribute('color', new THREE.Float32BufferAttribute(new Array(72).fill(0.4), 3)));
    for (let i = 0; i < this.max; i++) this.knives.setColorAt(i, WHITE);
    this.handArrows = mk(arrowGeometry());
    this.handArrows.castShadow = false;
    // heads: a cube with a pixel face at the front (-Z), hair at the back and top, skin at the sides
    const hm = (t) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: VISUAL ? t : null });
    const skin = hm(VISUAL ? skinTexture() : null), hair = hm(VISUAL ? hairTexture() : null), face = hm(VISUAL ? faceTexture() : null);
    this.heads = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), [skin, skin, hair, skin, hair, face], this.max);
    this.heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.heads.castShadow = true;
    this.heads.frustumCulled = false;
    for (let i = 0; i < this.max; i++) this.heads.setColorAt(i, WHITE);
    scene.add(this.boxes, this.bows, this.knives, this.quivers, this.handArrows, this.heads);
    this.bodyMatrices = archers.map(() => new THREE.Matrix4());
    this.baseColours = [];
    this.frame = 0;
    const col = new THREE.Color();
    archers.forEach((a, i) => {
      const team = a.team === 'blue' ? C.blue : C.red;
      const dark = a.team === 'blue' ? C.blueDark : C.redDark;
      const colours = {
        hips: dark, torso: team, head: C.skin, hood: team, uArmL: team, fArmL: C.skin, uArmR: team, fArmR: C.skin,
        thighL: dark, shinL: C.leather, thighR: dark, shinR: C.leather, quiver: C.leather, strTop: 0xe8e0c8,
        strBot: 0xe8e0c8, nocked: 0xd8c39a, belt: C.leather,
      };
      const list = [];
      PARTS.forEach((p, k) => {
        col.set(colours[p]);
        // slight per-archer variation
        if (p === 'torso' || p === 'hood') col.offsetHSL(0, 0, ((a.id * 37) % 10 - 5) * 0.006);
        this.boxes.setColorAt(i * NP + k, col);
        list.push(col.clone());
      });
      this.baseColours.push(list);
    });
    this.boxes.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  // Repaint an archer's clothes (team colours, or an individual colour in a free-for-all).
  recolour(i, main, dark) {
    const base = this.baseColours[i];
    PARTS.forEach((p, k) => {
      if (TEAM_PARTS.has(p)) base[k].copy(main);
      else if (DARK_PARTS.has(p)) base[k].copy(dark);
      else return;
      this.boxes.setColorAt(i * NP + k, base[k]);
    });
    this.boxes.instanceColor.needsUpdate = true;
    this.archers[i]._cosKey = null;
  }

  // Marketplace cosmetics: bow wood, hood colour and knife tint.
  _applyCos(i, a) {
    const cos = a.cos || {};
    const bow = COSMETICS[cos.bow], hood = COSMETICS[cos.hood], knife = COSMETICS[cos.knife];
    this.bows.setColorAt(i, bow ? _cc.set(bow.colour) : BOW_WOOD);
    this.bows.instanceColor.needsUpdate = true;
    this.knives.setColorAt(i, knife ? _cc.setRGB(...knife.tint) : WHITE);
    this.knives.instanceColor.needsUpdate = true;
    const base = this.baseColours[i];
    base[HOOD].copy(hood ? _cc.set(hood.colour) : base[TORSO]);
    if (!a._flashing) { this.boxes.setColorAt(i * NP + HOOD, base[HOOD]); this.boxes.instanceColor.needsUpdate = true; }
  }

  // Box stretched between local points a and b, with a reference "forward" axis for orientation.
  _seg(idx, a, b, w, d, fwd, world) {
    _y.subVectors(b, a);
    const len = _y.length();
    if (len < 1e-5) { this.boxes.setMatrixAt(idx, ZERO); return; }
    _y.multiplyScalar(1 / len);
    _x.crossVectors(_y, fwd);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); else _x.normalize();
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x.multiplyScalar(w), _y.multiplyScalar(len), _z.multiplyScalar(d));
    _m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    _m2.multiplyMatrices(world, _m);
    this.boxes.setMatrixAt(idx, _m2);
  }

  _box(idx, cx, cy, cz, sx, sy, sz, rotX, world, rotY = 0, rotZ = 0, mesh = this.boxes) {
    _m.makeRotationFromEuler(_eul.set(rotX, rotY, rotZ, 'YXZ'));
    _m.scale(_x.set(sx, sy, sz));
    _m.setPosition(cx, cy, cz);
    _m2.multiplyMatrices(world, _m);
    mesh.setMatrixAt(idx, _m2);
  }

  // Two-bone IK: writes elbow into out, given shoulder s, target t, lengths a, b and pole direction.
  static ik(s, t, a, b, pole, out) {
    const dir = _v[20].subVectors(t, s);
    let d = dir.length();
    d = clamp(d, 0.01, (a + b) * 0.999);
    dir.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const perp = _v[21].copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-6) perp.set(0, -1, 0);
    perp.normalize();
    return out.copy(s).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  }

  update(dt, camPos, hidePlayerHead) {
    this.frame++;
    this.clock = (this.clock || 0) + dt;
    const n = this.archers.length;
    for (let i = 0; i < n; i++) {
      const a = this.archers[i];
      const dx = a.pos.x - camPos.x, dz = a.pos.z - camPos.z;
      const far = dx * dx + dz * dz > 90 * 90;
      // simple animation LOD: distant archers animate at half rate
      if (far && (this.frame + i) % 2 === 0) continue;
      this._animate(a, i, far ? dt * 2 : dt, hidePlayerHead && a.isPlayer);
    }
    this.boxes.instanceMatrix.needsUpdate = true;
    this.bows.instanceMatrix.needsUpdate = true;
    this.knives.instanceMatrix.needsUpdate = true;
    this.quivers.instanceMatrix.needsUpdate = true;
    this.handArrows.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }

  // Place an instanced prop: origin at p, local -Z along dir (blade / arrow), local +Y toward up.
  _orient(mesh, i, p, dir, up, scale, world) {
    _z.copy(dir).negate().normalize();
    _x.crossVectors(up, _z);
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0); else _x.normalize();
    _y.crossVectors(_z, _x);
    _m.makeBasis(_x.multiplyScalar(scale), _y.multiplyScalar(scale), _z.multiplyScalar(scale));
    _m.setPosition(p.x, p.y, p.z);
    _m2.multiplyMatrices(world, _m);
    mesh.setMatrixAt(i, _m2);
  }

  // Arrow mesh has its tip at the origin pointing +Z: place it from nock along dir.
  _arrow(i, nock, dir, world) {
    _q.setFromUnitVectors(FWD_Z, _y.copy(dir).normalize());
    _m.makeRotationFromQuaternion(_q);
    _m.setPosition(nock.x + _y.x * ARROW_L, nock.y + _y.y * ARROW_L, nock.z + _y.z * ARROW_L);
    _m2.multiplyMatrices(world, _m);
    this.handArrows.setMatrixAt(i, _m2);
  }

  flash(archer) {
    const i = this.archers.indexOf(archer);
    if (i < 0) return;
    archer.hitFlash = 0.15;
  }

  _animate(a, i, dt, hideHead) {
    const base = i * NP;
    if (a.active === false) {
      // unused slot in this layout: draw nothing
      if (!a._hidden) {
        for (let k = 0; k < NP; k++) this.boxes.setMatrixAt(base + k, ZERO);
        for (const m of [this.bows, this.knives, this.quivers, this.handArrows, this.heads]) m.setMatrixAt(i, ZERO);
        a._hidden = true;
      }
      this.bodyMatrices[i].makeTranslation(0, -500, 0);
      return;
    }
    a._hidden = false;
    const cosKey = a.cos ? `${a.cos.bow}|${a.cos.hood}|${a.cos.knife}` : '';
    if (a._cosKey !== cosKey) { a._cosKey = cosKey; this._applyCos(i, a); }
    const T = this.clock;
    const alive = a.alive;
    const spd = alive ? a.speed : 0;
    // turning on the spot shuffles the feet
    const yawRate = a._prevYaw === undefined ? 0 : Math.abs(wrapAngle(a.yaw - a._prevYaw)) / Math.max(dt, 1e-3);
    a._prevYaw = a.yaw;
    const shuffle = alive && spd < 0.3 && yawRate > 1.2 && a.onGround ? 1 : 0;
    a.animPhase += dt * (spd > 0.2 ? 2.2 + spd * 1.25 : shuffle ? 6 : 0);
    const ph = a.animPhase;
    const run = clamp((spd - 3.5) / 2.5, 0, 1);
    const moving = Math.max(clamp(spd / 2, 0, 1), shuffle * 0.35);

    // pose blends
    const blend = (key, target, rate) => (a[key] = lerp(a[key] ?? 0, target, clamp(dt * rate, 0, 1)));
    const cb = blend('_cb', a.crouching && alive ? 1 : 0, 10);
    const kb = blend('_kb', a.bandaging && alive ? 1 : 0, 8);                 // kneeling to bandage
    const chb = blend('_chb', a.cheer && alive ? 1 : 0, 5);                  // celebrating
    const pk = alive && a.pickupT > 0 ? Math.sin((1 - a.pickupT / 0.6) * Math.PI) : 0; // reach down
    const rx = a.hitReactT > 0 ? Math.sin((1 - a.hitReactT / 0.35) * Math.PI) : 0;     // flinch
    const land = alive && a.landT > 0 ? a.landT / 0.28 : 0;
    const limp = alive && a.hp < H.limpBelow ? 1 : 0;
    // knife stab: wind up, thrust, recover
    const su = alive && a.stabT > 0 ? 1 - a.stabT / K.time : 1;
    const stabbing = su < 1;
    const thrust = stabbing ? (su < 0.3 ? -0.4 * ease(su / 0.3) : su < 0.5 ? -0.4 + 1.4 * ease((su - 0.3) / 0.2) : 1 - ease((su - 0.5) / 0.5)) : 0;
    // the bow stays up after a shot while the next arrow comes out of the quiver
    const rt = a.releaseTimer;
    const reloading = alive && !a.drawing && a.arrows > 0 && rt < RELOAD;
    const stance = alive && !stabbing && (a.drawing || rt < (a.arrows > 0 ? RELOAD + 0.3 : 0.35)) && kb < 0.5 && chb < 0.5 ? 1 : 0;
    const db = blend('_db', stance, 12);
    const crumple = !alive && a.deathStyle === 2 ? clamp(a.deathTime / 0.45, 0, 1) : 0;
    const kneel = Math.max(kb, crumple);

    // directions in the archer's local frame (+x right, -z forward)
    const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw);
    const hlx = a.hitDirX * cy - a.hitDirZ * sy, hlz = a.hitDirX * sy + a.hitDirZ * cy;
    const lvx = a.vel.x * cy - a.vel.z * sy, lvz = a.vel.x * sy + a.vel.z * cy;
    const lv = Math.hypot(lvx, lvz);
    let mdx = 0, mdz = -1;
    if (lv > 0.3) { mdx = lvx / lv; mdz = lvz / lv; }

    // world matrix: position, yaw, then one of four death falls about the feet
    const world = this.bodyMatrices[i];
    world.makeRotationY(a.yaw);
    world.setPosition(a.pos.x, a.pos.y, a.pos.z);
    if (!alive) {
      const st = a.deathStyle || 0;
      const t = st === 2 ? Math.max(0, a.deathTime - 0.45) : a.deathTime;
      const e = clamp(t / 0.7, 0, 1);
      const fall = (1 - Math.pow(1 - e, 3)) * (Math.PI / 2 - 0.08);
      const dir = a.deathDir > 0 ? 1 : -1;
      if (st === 1) _m3.makeRotationZ(fall * dir);                                   // sideways
      else if (st === 3) { world.multiply(_m3.makeRotationY(e * 1.6 * dir)); _m3.makeRotationZ(-fall * dir); } // spin and drop
      else _m3.makeRotationX(fall * (st === 2 ? -1 : dir));                          // back/forward; crumple pitches forward
      world.multiply(_m3);
    }

    // --- hips
    const breathe = Math.sin(T * 1.7 + i) * 0.008 * (1 - moving);
    let hipY = 0.95 - cb * 0.42 - run * 0.05 + Math.abs(Math.sin(ph)) * 0.04 * moving;
    hipY -= land * 0.18;
    hipY -= limp * Math.max(0, Math.sin(ph)) * 0.06 * moving;
    hipY = lerp(hipY, 0.6, pk * 0.7);
    hipY = lerp(hipY, 0.55, kneel);
    hipY += chb * Math.abs(Math.sin(T * 6 + i)) * 0.07;

    // --- legs: swing along the direction of travel (strafe, backpedal), bend for crouch/landing
    const thighL = 0.47, shinL = 0.47;
    const hipL = _v[0].set(-0.11, hipY, 0), hipR = _v[1].set(0.11, hipY, 0);
    const swing = (0.35 + run * 0.35) * moving;
    const crouchTh = Math.max(cb, pk * 0.8, land * 0.6);
    const legPoints = (hip, phase, kneeOut, footOut, lame) => {
      let s = Math.sin(phase) * swing * (lame ? 0.55 : 1);
      let sb = Math.max(0, -Math.cos(phase)) * swing * 1.6;
      let c = crouchTh * 1.0, cbend = crouchTh * 1.9 + 0.05;
      if (!a.onGround && alive) { s = 0; sb = 0; c = 0.6; cbend = 1.1; }
      let tx = mdx * Math.sin(s), tz = mdz * Math.sin(s) - Math.sin(c), ty = -Math.cos(s) * Math.cos(c);
      let l = Math.hypot(tx, ty, tz);
      kneeOut.set(hip.x + (tx / l) * thighL, hip.y + (ty / l) * thighL, hip.z + (tz / l) * thighL);
      const s2 = s - sb, c2 = c - cbend;
      tx = mdx * Math.sin(s2); tz = mdz * Math.sin(s2) - Math.sin(c2); ty = -Math.cos(s2) * Math.cos(c2);
      l = Math.hypot(tx, ty, tz);
      footOut.set(kneeOut.x + (tx / l) * shinL, kneeOut.y + (ty / l) * shinL, kneeOut.z + (tz / l) * shinL);
    };
    const kneeL = _v[2], footL = _v[3], kneeR = _v[4], footR = _v[5];
    legPoints(hipL, ph, kneeL, footL, false);
    legPoints(hipR, ph + Math.PI, kneeR, footR, limp === 1);
    if (kneel > 0.01) {
      kneeL.lerp(KNEEL.kL, kneel); footL.lerp(KNEEL.fL, kneel);
      kneeR.lerp(KNEEL.kR, kneel); footR.lerp(KNEEL.fR, kneel);
    }
    const fwd = _v[22].set(0, 0, -1);
    this._seg(base + 8, hipL, kneeL, 0.15, 0.15, fwd, world);
    this._seg(base + 9, kneeL, footL, 0.145, 0.145, fwd, world);
    this._seg(base + 10, hipR, kneeR, 0.15, 0.15, fwd, world);
    this._seg(base + 11, kneeR, footR, 0.145, 0.145, fwd, world);

    // --- torso: leans with running, crouching, reaching, kneeling; tips along a hit; sways with a limp
    const lean = run * 0.25 + cb * 0.35 + pk * 0.9 + kb * 0.2 + land * 0.2 - chb * 0.15 + hlz * -0.3 * rx + Math.max(0, thrust) * 0.25;
    // archers turn side-on to shoot (left shoulder to the target) and twist into a stab
    const tw = -0.95 * db + 0.35 * thrust;
    const fwdT = W[7].set(-Math.sin(tw), 0, -Math.cos(tw)), fwdH = W[8].set(-Math.sin(tw * 0.35), 0, -Math.cos(tw * 0.35));
    const sway = hlx * 0.3 * rx + limp * 0.07 * moving * Math.sin(ph);
    const torsoLen = 0.58;
    const neck = _v[6].set(Math.sin(sway) * torsoLen, hipY + Math.cos(lean) * Math.cos(sway) * torsoLen + breathe, -Math.sin(lean) * torsoLen);
    const pelvis = _v[7].set(0, hipY, 0);
    this._seg(base + 0, _v[8].set(0, hipY - 0.08, 0), _v[9].set(0, hipY + 0.1, 0), 0.34, 0.2, fwdH, world);
    this._seg(base + 1, pelvis, neck, 0.42, 0.22, fwdT, world);
    this._seg(base + 16, _v[8].set(0, hipY + 0.06, 0), _v[9].set(0, hipY + 0.13, 0), 0.4, 0.25, fwdH, world);
    // head: aims with the bow, glances around when idle, snaps back when hit
    const headC = _v[10].set(neck.x, neck.y + 0.15, neck.z - 0.01);
    this.boxes.setMatrixAt(base + 2, ZERO); // the head is drawn by this.heads (cube with a face)
    if (hideHead) {
      this.heads.setMatrixAt(i, ZERO);
      this.boxes.setMatrixAt(base + 3, ZERO);
    } else {
      const idle = alive ? (1 - moving) * (1 - db) * (1 - kb) * (1 - chb) : 0;
      const look = Math.sin(T * 0.37 + i * 1.7) * Math.sin(T * 0.13 + i) * 0.9 * idle;
      const nod = -a.pitch * 0.5 * db + hlz * 0.5 * rx + kb * 0.5 + pk * 0.5 - chb * 0.35;
      const tilt = -hlx * 0.4 * rx - sway * 0.5;
      // blocky: a big cube head, the hood as a cap over the top and back
      this._box(i, headC.x, headC.y, headC.z, 0.27, 0.27, 0.27, nod, world, look, tilt, this.heads);
      this._box(base + 3, headC.x, headC.y + 0.115, headC.z + 0.025, 0.305, 0.1, 0.3, nod, world, look, tilt);
    }
    // quiver on the back, from the left hip up over the right shoulder, turning with the torso
    const quiverTop = _v[11].copy(neck).add(rotY(S_A, 0.12, -0.05, 0.17, tw));
    const quiverBot = S_QBOT.set(0, hipY, 0).add(rotY(S_A, -0.06, 0.06, 0.15, tw * 0.6));
    const qdir = S_QDIR.subVectors(quiverTop, quiverBot);
    const qlen = qdir.length() * 1.08;
    qdir.normalize();
    this.boxes.setMatrixAt(base + 12, ZERO);
    _y.copy(qdir); _x.crossVectors(_y, fwdT).normalize(); _z.crossVectors(_x, _y);
    _m.makeBasis(_x.multiplyScalar(qlen), _y.multiplyScalar(qlen), _z.multiplyScalar(qlen));
    _m.setPosition(quiverBot.x, quiverBot.y, quiverBot.z);
    _m2.multiplyMatrices(world, _m);
    this.quivers.setMatrixAt(i, _m2);
    const qMouth = S_A.copy(quiverBot).addScaledVector(qdir, qlen);

    // --- arms
    const shL = _v[13].copy(neck).add(rotY(_v[12], -0.24, -0.06, 0, tw)), shR = _v[14].copy(neck).add(rotY(_v[12], 0.24, -0.06, 0, tw));
    const upper = 0.3, lower = 0.3;
    const elL = _v[15], hdL = _v[16], elR = _v[17], hdR = _v[18];
    // relaxed pose: arms hang and swing
    const aSwing = Math.sin(ph) * swing * 0.8;
    const relax = (sh, sgn, phase, el, hd) => {
      el.set(sh.x + sgn * 0.05, sh.y - Math.cos(phase) * upper, sh.z + Math.sin(phase) * upper);
      const fa = phase - 0.3 - run * 0.8;
      hd.set(el.x, el.y - Math.cos(fa) * lower, el.z + Math.sin(fa) * lower);
    };
    relax(shL, -1, -aSwing, elL, hdL);
    relax(shR, 1, aSwing, elR, hdR);

    // shooting stance: the string comes back to an anchor under the right cheek, and the bow hand sits
    // straight out along the aim from there, so the arrow lies on the line of sight
    const pitch = alive ? a.pitch : 0;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const aim = _v[19].set(0, sp, -cp);
    const anchor = S_ANCHOR.set(neck.x + 0.05, neck.y + 0.06, neck.z - 0.13);
    const gripTarget = _v[23].copy(anchor).addScaledVector(aim, DRAW_LEN);
    const rest = S_REST.copy(gripTarget).addScaledVector(aim, -BRACE);
    const df = a.drawing ? ease(a.drawFrac) : 0;
    const nock = S_NOCK.copy(rest).lerp(anchor, df);
    // where the right hand is in the stance: on the string while drawing; after the loose it flies back
    // past the ear, then fetches the next arrow from the quiver and brings it to the string
    const hand = W[9].copy(nock);
    let arrowShown = false;
    const adir = S_ADIR.copy(aim);
    if (!a.drawing && alive) {
      const follow = W[10].copy(anchor).add(rotY(W[11], 0.09, 0.03, 0.12, tw));
      if (rt < 0.14) hand.copy(anchor).lerp(follow, ease(rt / 0.14));
      else if (reloading) {
        const r = (rt - 0.14) / (RELOAD - 0.14);
        const grab = W[11].copy(qMouth).addScaledVector(qdir, 0.04);
        const lift = W[12].copy(qMouth).addScaledVector(qdir, 0.32);
        if (r < 0.4) hand.copy(follow).lerp(grab, ease(r / 0.4));
        else if (r < 0.55) {
          hand.copy(grab).lerp(lift, ease((r - 0.4) / 0.15));
          adir.copy(qdir).negate(); arrowShown = true;               // drawn out point first... nock in hand, tip down the quiver
        } else {
          const k = ease((r - 0.55) / 0.45);
          hand.copy(lift).lerp(rest, k);
          adir.copy(qdir).negate().lerp(aim, k).normalize(); arrowShown = true;
        }
      } else if (a.arrows > 0) { hand.copy(rest); arrowShown = db > 0.6; }
      else hand.copy(follow);
    } else if (a.drawing) arrowShown = true;

    const elLd = ArcherRenderer.ik(shL, gripTarget, upper, lower, POLE_L, S_ELL);
    const elRd = ArcherRenderer.ik(shR, hand, upper, lower, reloading ? POLE_UP : POLE_R, S_ELR);
    if (db > 0.01) {
      elL.lerp(elLd, db); hdL.lerp(gripTarget, db);
      elR.lerp(elRd, db); hdR.lerp(hand, db);
    }
    // layered actions: move a hand to a target with IK, by weight
    const reach = (sh, el, hd, target, w, pole) => {
      if (w < 0.01) return;
      const e = ArcherRenderer.ik(sh, target, upper, lower, pole, W[15]);
      el.lerp(e, w); hd.lerp(target, w);
    };
    // knife: right hand goes back to the hip, then drives forward at chest height
    if (stabbing) {
      const back = W[13].copy(neck).add(rotY(W[14], 0.24, -0.34, 0.12, tw));
      const out = W[14].copy(neck).add(rotY(W[12], 0.07, -0.14, -0.62, tw));
      const target = thrust < 0 ? back : W[13].copy(back).lerp(out, Math.min(1, thrust));
      reach(shR, elR, hdR, target, su < 0.12 ? su / 0.12 : su > 0.75 ? (1 - su) / 0.25 : 1, POLE_R);
    }
    // pick up arrows: right hand to the ground in front
    reach(shR, elR, hdR, W[1].set(0.14, 0.08, -0.45), pk, POLE_OUT_R);
    // bandaging: left forearm forward, right hand winds the bandage round it
    if (kb > 0.01) {
      const wrist = W[2].set(-0.06, hipY + 0.36, -0.3);
      reach(shL, elL, hdL, wrist, kb, POLE_DOWN);
      const wind = T * 9 + i;
      reach(shR, elR, hdR, W[3].set(wrist.x + 0.03 + Math.cos(wind) * 0.07, wrist.y + 0.02 + Math.sin(wind) * 0.05, wrist.z + 0.02), kb, POLE_OUT_R);
    }
    // cheering: both arms up, waving the bow
    if (chb > 0.01) {
      const wave = Math.sin(T * 8 + i) * 0.06;
      reach(shL, elL, hdL, W[4].set(shL.x - 0.08 + wave, neck.y + 0.5, neck.z - 0.05), chb, POLE_OUT_L);
      reach(shR, elR, hdR, W[5].set(shR.x + 0.08 - wave, neck.y + 0.48, neck.z - 0.05), chb, POLE_OUT_R);
    }
    // flinch: arms jolt with the hit
    if (rx > 0.01) {
      W[6].set(hlx * 0.1, 0.06, hlz * 0.1).multiplyScalar(rx);
      hdL.add(W[6]); hdR.add(W[6]); elL.addScaledVector(W[6], 0.5); elR.addScaledVector(W[6], 0.5);
    }
    this._seg(base + 4, shL, elL, 0.12, 0.12, fwdT, world);
    this._seg(base + 5, elL, hdL, 0.12, 0.12, fwdT, world);
    this._seg(base + 6, shR, elR, 0.12, 0.12, fwdT, world);
    this._seg(base + 7, elR, hdR, 0.12, 0.12, fwdT, world);

    // --- knife: in the hand while stabbing (blade along the forearm), otherwise on the right hip
    if (stabbing && alive) {
      const blade = W[12].subVectors(hdR, elR).normalize();
      this._orient(this.knives, i, hdR, blade, UPV, 1, world);
    } else {
      const hip = W[12].set(0, hipY + 0.02, 0).add(rotY(W[13], 0.22, 0, 0.03, tw * 0.35));
      this._orient(this.knives, i, hip, W[13].set(0.05, -1, 0.1), fwdH, 0.9, world);
    }

    // --- bow at left hand: upright and canted while shooting, hanging along the arm when relaxed
    const bowM = _m.identity();
    const ang = lerp(0.2, 0, db);
    const bowPitch = lerp(-0.35, pitch, db);
    _q.setFromAxisAngle(_x.set(1, 0, 0), bowPitch);
    bowM.makeRotationFromQuaternion(_q);
    bowM.multiply(_m3.makeRotationZ(ang + 0.22 * db));
    bowM.setPosition(hdL.x, hdL.y, hdL.z);
    if (!a.alive && a.deathTime > 0.5) bowM.setPosition(hdL.x - 0.2, hdL.y, hdL.z);
    _m2.multiplyMatrices(world, bowM);
    this.bows.setMatrixAt(i, _m2);
    // bowstring: follows the nock only while drawing; on release it snaps back and shivers
    const tipT = _v[11].set(0, 0.62, 0.04).applyMatrix4(bowM);
    const tipB = _v[12].set(0, -0.62, 0.04).applyMatrix4(bowM);
    const restMid = _v[9].addVectors(tipT, tipB).multiplyScalar(0.5);
    if (!a.drawing && rt < 0.25) restMid.addScaledVector(aim, Math.sin(rt * 90) * 0.035 * (1 - rt / 0.25) * db);
    const stringMid = a.drawing && db > 0.5 ? nock : restMid;
    const side = _v[8].set(1, 0, 0);
    this._seg(base + 13, tipT, stringMid, 0.012, 0.012, side, world);
    this._seg(base + 14, stringMid, tipB, 0.012, 0.012, side, world);
    // the arrow: on the string while drawing, in the hand while reloading
    this.boxes.setMatrixAt(base + 15, ZERO);
    if (arrowShown && alive && db > 0.3) {
      const from = a.drawing ? nock : hdR;
      this._arrow(i, from, adir, world);
    } else this.handArrows.setMatrixAt(i, ZERO);

    if (hideHead) {
      // first person: the view model draws arms and bow; looking down you still see your legs
      for (const k of FP_HIDDEN) this.boxes.setMatrixAt(base + k, ZERO);
      for (const m of [this.bows, this.knives, this.quivers, this.handArrows]) m.setMatrixAt(i, ZERO);
    }

    // hit flash colouring
    const flashing = a.hitFlash > 0;
    if (flashing !== !!a._flashing) {
      a._flashing = flashing;
      const white = FLASH;
      for (let k = 0; k < NP; k++) this.boxes.setColorAt(base + k, flashing ? white : this.baseColours[i][k]);
      this.boxes.instanceColor.needsUpdate = true;
      this.heads.setColorAt(i, flashing ? white : WHITE);
      this.heads.instanceColor.needsUpdate = true;
    }
  }
}
