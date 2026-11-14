// Draws every archer with two instanced meshes (body boxes + bows): 2 draw calls for 40 archers.
// Animation is procedural: joints are computed in the archer's local frame each frame
// (walk/run cycles, crouch, two-bone IK for the drawing arms, a fall for death)
// and limbs are drawn as boxes stretched between joints.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp } from '../core/utils.js';

const C = CONFIG.colours;
const PARTS = ['hips', 'torso', 'head', 'hood', 'uArmL', 'fArmL', 'uArmR', 'fArmR', 'thighL', 'shinL', 'thighR', 'shinR',
  'quiver', 'strTop', 'strBot', 'nocked', 'belt'];
const NP = PARTS.length;

const _v = Array.from({ length: 24 }, () => new THREE.Vector3());
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q = new THREE.Quaternion();
const POLE_L = new THREE.Vector3(-1, -0.6, 0.3), POLE_R = new THREE.Vector3(1, 0.1, 0.6);
// dedicated scratch vectors so animating 40 archers allocates nothing per frame
const S_ELL = new THREE.Vector3(), S_ELR = new THREE.Vector3(), S_NOCK = new THREE.Vector3(), S_TIP = new THREE.Vector3();
const FLASH = new THREE.Color(1, 0.55, 0.5);
const FP_HIDDEN = [1, 2, 3, 4, 5, 6, 7, 12, 13, 14, 15, 16]; // torso, head, hood, arms, quiver, string, arrow, belt
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export function bowGeometry() {
  // A recurve-ish arc along local Y, belly toward -Z, tips at ±0.62 Y.
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n * 2 - 1;
    const y = t * 0.62;
    const z = -0.14 * (1 - t * t) + 0.04 * Math.pow(Math.abs(t), 6);
    pts.push(new THREE.Vector3(0, y, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, 12, 0.022, 4, false);
  g.deleteAttribute('uv');
  return g;
}

export class ArcherRenderer {
  constructor(scene, archers) {
    this.archers = archers;
    this.max = archers.length;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.deleteAttribute('uv');
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.boxes = new THREE.InstancedMesh(boxGeo, mat, this.max * NP);
    this.boxes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.boxes.castShadow = true;
    this.boxes.receiveShadow = true;
    this.boxes.frustumCulled = false;
    this.bows = new THREE.InstancedMesh(bowGeometry(), new THREE.MeshLambertMaterial({ color: 0x6b4423 }), this.max);
    this.bows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bows.castShadow = true;
    this.bows.frustumCulled = false;
    scene.add(this.boxes, this.bows);
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

  _box(idx, cx, cy, cz, sx, sy, sz, rotX, world) {
    _m.makeRotationX(rotX);
    _m.scale(_x.set(sx, sy, sz));
    _m.setPosition(cx, cy, cz);
    _m2.multiplyMatrices(world, _m);
    this.boxes.setMatrixAt(idx, _m2);
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
  }

  flash(archer) {
    const i = this.archers.indexOf(archer);
    if (i < 0) return;
    archer.hitFlash = 0.15;
  }

  _animate(a, i, dt, hideHead) {
    const base = i * NP;
    // gait phase
    const spd = a.speed;
    a.animPhase += dt * (spd > 0.2 ? 2.2 + spd * 1.25 : 0);
    const ph = a.animPhase;
    const run = clamp((spd - 3.5) / 2.5, 0, 1);
    const moving = clamp(spd / 2, 0, 1);
    const crouch = a.crouching ? 1 : 0;
    a._crouchBlend = lerp(a._crouchBlend ?? 0, crouch, clamp(dt * 10, 0, 1));
    const cb = a._crouchBlend;
    const drawing = a.drawing ? 1 : a.releaseTimer < 0.35 && a.alive ? 1 : 0;
    a._drawBlend = lerp(a._drawBlend ?? 0, drawing, clamp(dt * 12, 0, 1));
    const db = a._drawBlend;

    // world matrix: position, yaw, then death fall about the feet
    const world = this.bodyMatrices[i];
    world.makeRotationY(a.yaw);
    world.setPosition(a.pos.x, a.pos.y, a.pos.z);
    if (!a.alive) {
      const t = clamp(a.deathTime / 0.7, 0, 1);
      const fall = (1 - Math.pow(1 - t, 3)) * (Math.PI / 2 - 0.08);
      _m3.makeRotationX(fall * a.deathDir);
      world.multiply(_m3);
    }

    // --- legs (local frame: +x right, +y up, -z forward)
    const hipY = 0.95 - cb * 0.42 - run * 0.05 + Math.abs(Math.sin(ph)) * 0.04 * moving;
    const thighL = 0.47, shinL = 0.47;
    const hipL = _v[0].set(-0.11, hipY, 0), hipR = _v[1].set(0.11, hipY, 0);
    const swing = (0.35 + run * 0.35) * moving;
    const legPoints = (hip, phase, kneeOut, footOut) => {
      let th = Math.sin(phase) * swing + cb * 1.0;                // thigh forward angle
      let bend = Math.max(0, -Math.cos(phase)) * swing * 1.6 + cb * 1.9 + 0.05;
      if (!a.onGround && a.alive) { th = 0.6; bend = 1.1; }
      kneeOut.set(hip.x, hip.y - Math.cos(th) * thighL, hip.z - Math.sin(th) * thighL);
      const sh = th - bend;
      footOut.set(hip.x, kneeOut.y - Math.cos(sh) * shinL, kneeOut.z - Math.sin(sh) * shinL);
    };
    const kneeL = _v[2], footL = _v[3], kneeR = _v[4], footR = _v[5];
    legPoints(hipL, ph, kneeL, footL);
    legPoints(hipR, ph + Math.PI, kneeR, footR);
    const fwd = _v[22].set(0, 0, -1);
    this._seg(base + 8, hipL, kneeL, 0.15, 0.16, fwd, world);
    this._seg(base + 9, kneeL, footL, 0.12, 0.14, fwd, world);
    this._seg(base + 10, hipR, kneeR, 0.15, 0.16, fwd, world);
    this._seg(base + 11, kneeR, footR, 0.12, 0.14, fwd, world);

    // --- torso: leans forward when running/crouching, twists slightly when drawing
    const lean = run * 0.25 + cb * 0.35 + (a.alive ? 0 : 0);
    const torsoLen = 0.58;
    const neck = _v[6].set(0, hipY + Math.cos(lean) * torsoLen, -Math.sin(lean) * torsoLen);
    const pelvis = _v[7].set(0, hipY, 0);
    this._seg(base + 0, _v[8].set(0, hipY - 0.08, 0), _v[9].set(0, hipY + 0.1, 0), 0.34, 0.2, fwd, world);
    this._seg(base + 1, pelvis, neck, 0.38, 0.22, fwd, world);
    this._seg(base + 16, _v[8].set(0, hipY + 0.06, 0), _v[9].set(0, hipY + 0.13, 0), 0.4, 0.25, fwd, world);
    // head
    const headC = _v[10].set(0, neck.y + 0.16, neck.z - 0.01);
    if (hideHead) {
      this.boxes.setMatrixAt(base + 2, ZERO);
      this.boxes.setMatrixAt(base + 3, ZERO);
    } else {
      const nod = -a.pitch * 0.5 * db;
      this._box(base + 2, headC.x, headC.y, headC.z, 0.21, 0.24, 0.22, nod, world);
      this._box(base + 3, headC.x, headC.y + 0.07, headC.z + 0.03, 0.25, 0.16, 0.24, nod, world);
    }
    // quiver on the back
    _v[11].set(0.12, neck.y - 0.05, neck.z + 0.17);
    _v[12].set(-0.05, hipY + 0.05, 0.15);
    this._seg(base + 12, _v[12], _v[11], 0.11, 0.11, fwd, world);

    // --- arms
    const shL = _v[13].set(-0.24, neck.y - 0.06, neck.z), shR = _v[14].set(0.24, neck.y - 0.06, neck.z);
    const upper = 0.3, lower = 0.3;
    const elL = _v[15], hdL = _v[16], elR = _v[17], hdR = _v[18];
    // relaxed pose: arms hang and swing
    const aSwing = Math.sin(ph) * swing * 0.8;
    const relax = (sh, side, phase, el, hd) => {
      el.set(sh.x + side * 0.05, sh.y - Math.cos(phase) * upper, sh.z + Math.sin(phase) * upper);
      const fa = phase - 0.3 - run * 0.8;
      hd.set(el.x, el.y - Math.cos(fa) * lower, el.z + Math.sin(fa) * lower);
    };
    relax(shL, -1, -aSwing, elL, hdL);
    relax(shR, 1, aSwing, elR, hdR);
    // drawing pose via IK, blended in
    const pitch = a.alive ? a.pitch : 0;
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const aim = _v[19].set(0, sp, -cp);
    const df = a.drawing ? a.drawFrac : a.releaseTimer < 0.35 ? 1 : 0;
    const gripTarget = _v[23].set(-0.2, shL.y - 0.05, shL.z).addScaledVector(aim, 0.58);
    const pole = POLE_L;
    const elLd = ArcherRenderer.ik(shL, gripTarget, upper, lower, pole, S_ELL);
    // nock point slides back from the bow toward the cheek with draw
    let pull = 0.12 + df * 0.5;
    const follow = !a.drawing && a.releaseTimer < 0.35 ? (1 - a.releaseTimer / 0.35) : 0;
    const nock = S_NOCK.copy(gripTarget).addScaledVector(aim, -pull);
    if (follow > 0) nock.x += 0.12 * follow;
    const elRd = ArcherRenderer.ik(shR, nock, upper, lower, POLE_R, S_ELR);
    if (db > 0.01) {
      elL.lerp(elLd, db); hdL.lerp(gripTarget, db);
      elR.lerp(elRd, db); hdR.lerp(nock, db);
    }
    this._seg(base + 4, shL, elL, 0.11, 0.11, fwd, world);
    this._seg(base + 5, elL, hdL, 0.09, 0.09, fwd, world);
    this._seg(base + 6, shR, elR, 0.11, 0.11, fwd, world);
    this._seg(base + 7, elR, hdR, 0.09, 0.09, fwd, world);

    // --- bow at left hand: vertical while drawing, hanging along the arm when relaxed
    const bowM = _m.identity();
    const ang = lerp(0.2, 0, db);
    // orientation: when drawing aligned with aim pitch, else tilted down along the arm
    const bowPitch = lerp(-0.35, pitch, db);
    _q.setFromAxisAngle(_x.set(1, 0, 0), bowPitch);
    bowM.makeRotationFromQuaternion(_q);
    bowM.multiply(_m3.makeRotationZ(ang + 0.22 * db));
    bowM.setPosition(hdL.x, hdL.y, hdL.z);
    if (!a.alive && a.deathTime > 0.5) bowM.setPosition(hdL.x - 0.2, hdL.y, hdL.z);
    _m2.multiplyMatrices(world, bowM);
    this.bows.setMatrixAt(i, _m2);
    // bowstring tips (bow local: tips at y ±0.62, z +0.04 approx)
    const tipT = _v[11].set(0, 0.62, 0.04).applyMatrix4(bowM);
    const tipB = _v[12].set(0, -0.62, 0.04).applyMatrix4(bowM);
    const stringMid = db > 0.5 ? nock : _v[9].addVectors(tipT, tipB).multiplyScalar(0.5);
    const side = _v[8].set(1, 0, 0);
    this._seg(base + 13, tipT, stringMid, 0.012, 0.012, side, world);
    this._seg(base + 14, stringMid, tipB, 0.012, 0.012, side, world);
    // nocked arrow while drawing
    if (a.drawing && a.alive) {
      const tip = S_TIP.copy(nock).addScaledVector(aim, 0.76);
      this._seg(base + 15, nock, tip, 0.018, 0.018, side, world);
    } else {
      this.boxes.setMatrixAt(base + 15, ZERO);
    }

    if (hideHead) {
      // first person: the view model draws arms and bow; looking down you still see your legs
      for (const k of FP_HIDDEN) this.boxes.setMatrixAt(base + k, ZERO);
      this.bows.setMatrixAt(i, ZERO);
    }

    // hit flash colouring
    const flashing = a.hitFlash > 0;
    if (flashing !== !!a._flashing) {
      a._flashing = flashing;
      const white = FLASH;
      for (let k = 0; k < NP; k++) this.boxes.setColorAt(base + k, flashing ? white : this.baseColours[i][k]);
      this.boxes.instanceColor.needsUpdate = true;
    }
  }
}
