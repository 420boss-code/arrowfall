// First-person view model: your own arms, bow, string and nocked arrow, drawn in a second pass on
// top of the world (depth cleared) so they never clip into trees. Everything is positioned in
// camera space: +x right, +y up, -z forward.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp } from '../core/utils.js';
import { bowGeometry } from './ArcherRenderer.js';
import { arrowGeometry } from '../combat/Projectiles.js';

const BOW_SCALE = 0.82;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const FWD = new THREE.Vector3(0, 0, 1);
const AIM_POINT = new THREE.Vector3(0, 0, -60);

// Poses: [drawn, relaxed, sprinting]
const GRIP = [new THREE.Vector3(-0.17, -0.07, -0.58), new THREE.Vector3(-0.26, -0.3, -0.5), new THREE.Vector3(-0.3, -0.42, -0.42)];
const BOW_ROT = [new THREE.Euler(0, 0.04, -0.22), new THREE.Euler(-0.35, 0.3, 0.85), new THREE.Euler(-0.6, 0.45, 1.15)];
const FULL_NOCK = new THREE.Vector3(-0.1, -0.12, -0.26); // anchor just below the cheek

export class ViewModel {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x7a7650, 1);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2);
    this.scene.add(this.hemi, this.sun);

    const lam = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: c, ...extra });
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.mats = { sleeve: lam(0xffffff), skin: lam(CONFIG.colours.skin), string: lam(0xe8e0c8), leather: lam(CONFIG.colours.leather) };

    this.bowRig = new THREE.Group();
    const bow = new THREE.Mesh(bowGeometry(), lam(0x6b4423));
    bow.scale.setScalar(BOW_SCALE);
    bow.position.set(0, 0, 0.14 * BOW_SCALE);        // put the handle at the rig origin
    this.bow = bow;
    const wrap = new THREE.Mesh(box, this.mats.leather); // leather grip
    wrap.scale.set(0.04, 0.12, 0.04);
    this.bowRig.add(bow, wrap);
    this.root.add(this.bowRig);

    const seg = (mat) => { const m = new THREE.Mesh(box, mat); this.root.add(m); return m; };
    this.leftHand = seg(this.mats.skin);
    this.leftFore = seg(this.mats.sleeve);
    this.leftUpper = seg(this.mats.sleeve);
    this.rightHand = seg(this.mats.skin);
    this.rightFore = seg(this.mats.sleeve);
    this.rightUpper = seg(this.mats.sleeve);
    this.strTop = seg(this.mats.string);
    this.strBot = seg(this.mats.string);
    this.arrow = new THREE.Mesh(arrowGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.arrow.scale.setScalar(0.92);
    this.root.add(this.arrow);
    for (const o of this.root.children) o.frustumCulled = false;
    this.bow.frustumCulled = false;

    this.drawBlend = 0;
    this.sprintBlend = 0;
    this.bob = 0;
    this.lag = new THREE.Vector2();
    this.visible = false;
    this.team = null;
  }

  _segment(mesh, a, b, w) {
    _d.subVectors(b, a);
    const len = _d.length();
    mesh.position.addVectors(a, b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(_y, _d.multiplyScalar(1 / Math.max(len, 1e-5)));
    mesh.scale.set(w, len, w);
  }

  update(dt, camera, input) {
    const g = this.game;
    const a = g.me;
    this.visible = !!(g.player && g.player.firstPerson && a && a.alive && g.state === 'playing');
    if (!this.visible) return;
    const sleeve = a.colour ?? (a.team === 'blue' ? CONFIG.colours.blue : CONFIG.colours.red);
    if (this.team !== sleeve) {
      this.team = sleeve;
      this.mats.sleeve.color.set(sleeve);
    }
    // follow the camera
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    // light to match the world
    this.hemi.intensity = g.terrain.hemi.intensity;
    this.sun.intensity = g.terrain.sun.intensity * 0.85;
    this.sun.position.copy(g.terrain.sunDir);

    const k = clamp(dt * 12, 0, 1);
    const releasing = !a.drawing && a.releaseTimer < 0.3;
    this.drawBlend = lerp(this.drawBlend, a.drawing || releasing ? 1 : 0, k);
    this.sprintBlend = lerp(this.sprintBlend, a.sprinting && !a.drawing ? 1 : 0, clamp(dt * 6, 0, 1));
    const db = this.drawBlend, sb = this.sprintBlend;
    // reload: after a shot the hand leaves frame over the shoulder for the next arrow, then returns
    const reloading = !a.drawing && a.arrows > 0 && a.releaseTimer > 0.12 && a.releaseTimer < 0.75;
    const rl = reloading ? Math.sin(((a.releaseTimer - 0.12) / 0.63) * Math.PI) : 0;
    // bandaging and picking up
    this.bandBlend = lerp(this.bandBlend || 0, a.bandaging ? 1 : 0, clamp(dt * 8, 0, 1));
    const bb = this.bandBlend;
    const pk = a.pickupT > 0 ? Math.sin((1 - a.pickupT / 0.6) * Math.PI) : 0;
    // walking bob and a little lag behind mouse movement
    const moving = clamp(a.speed / CONFIG.archer.runSpeed, 0, 1) * (a.onGround ? 1 : 0.3);
    const ph = a.animPhase;
    const bobX = Math.sin(ph) * 0.014 * moving * (1 + sb), bobY = -Math.abs(Math.cos(ph)) * 0.012 * moving * (1 + sb);
    this.lag.x = lerp(this.lag.x, clamp(-(input ? input.mouseDX : 0) * 0.0006, -0.04, 0.04), clamp(dt * 10, 0, 1));
    this.lag.y = lerp(this.lag.y, clamp((input ? input.mouseDY : 0) * 0.0006, -0.04, 0.04), clamp(dt * 10, 0, 1));
    const crouchDip = a.crouching ? -0.015 : 0;
    const off = _a.set(bobX + this.lag.x, bobY + this.lag.y + crouchDip, 0);
    // recoil after release
    const rec = releasing ? Math.sin((a.releaseTimer / 0.3) * Math.PI) : 0;

    // bow rig pose: blend relaxed → drawn, and relaxed → sprint
    const grip = new THREE.Vector3().copy(GRIP[1]).lerp(GRIP[2], sb).lerp(GRIP[0], db).add(off);
    grip.z -= rec * 0.035; grip.y += rec * 0.012;
    this.bowRig.position.copy(grip);
    const r0 = BOW_ROT[1], r2 = BOW_ROT[2], r1 = BOW_ROT[0];
    _e.set(lerp(lerp(r0.x, r2.x, sb), r1.x, db) - rec * 0.05, lerp(lerp(r0.y, r2.y, sb), r1.y, db), lerp(lerp(r0.z, r2.z, sb), r1.z, db) + (a.crouching ? 0.05 : 0));
    this.bowRig.rotation.copy(_e);
    this.bowRig.updateMatrix();
    this.bow.updateMatrix();

    // string tips in camera space
    const tipT = new THREE.Vector3(0, 0.62, 0.04).applyMatrix4(this.bow.matrix).applyMatrix4(this.bowRig.matrix);
    const tipB = new THREE.Vector3(0, -0.62, 0.04).applyMatrix4(this.bow.matrix).applyMatrix4(this.bowRig.matrix);
    const rest = new THREE.Vector3().addVectors(tipT, tipB).multiplyScalar(0.5);
    const draw = a.drawing ? a.drawFrac : 0;
    const nock = rest.clone().lerp(_b.copy(FULL_NOCK).add(off), draw * db);
    this._segment(this.strTop, tipT, nock, 0.0045);
    this._segment(this.strBot, nock, tipB, 0.0045);

    // left arm holds the bow; while bandaging the forearm comes across the body
    if (bb > 0.01) { grip.lerp(new THREE.Vector3(-0.1, -0.36, -0.4), bb); this.bowRig.position.copy(grip); this.bowRig.rotation.z += bb * 0.6; this.bowRig.updateMatrix(); }
    this.strTop.visible = this.strBot.visible = bb < 0.5;
    this.leftHand.position.copy(grip);
    this.leftHand.quaternion.copy(this.bowRig.quaternion);
    this.leftHand.scale.set(0.055, 0.1, 0.07);
    const elbowL = new THREE.Vector3(-0.3, -0.36, -0.22).lerp(new THREE.Vector3(-0.34, -0.4, -0.34), db).add(off);
    this._segment(this.leftFore, grip.clone().add(_b.set(-0.01, -0.03, 0.03)), elbowL, 0.055);
    this._segment(this.leftUpper, elbowL, new THREE.Vector3(-0.32, -0.6, 0.1), 0.08);

    // right hand: on the string while drawing, flicks back on release, rests low otherwise
    const handRest = new THREE.Vector3(0.2, -0.42, -0.42).add(off);
    const handDraw = nock.clone();
    if (releasing) handDraw.copy(FULL_NOCK).add(off).add(_b.set(0.05 * rec, 0.03 * rec, 0.06 * rec));
    const hand = handRest.clone().lerp(handDraw, db);
    hand.lerp(new THREE.Vector3(0.38, 0.12, -0.12), rl * (1 - db * 0.6));
    hand.lerp(new THREE.Vector3(0.08, -0.55, -0.42), pk);
    if (bb > 0.01) {
      const w = performance.now() / 1000 * 9;
      hand.lerp(new THREE.Vector3(-0.02 + Math.cos(w) * 0.06, -0.3 + Math.sin(w) * 0.04, -0.36), bb);
    }
    this.rightHand.position.copy(hand);
    this.rightHand.quaternion.identity();
    this.rightHand.scale.set(0.045, 0.05, 0.06);
    const elbowR = new THREE.Vector3(0.24, -0.4, -0.2).lerp(new THREE.Vector3(0.46, -0.44, -0.08), db * (0.3 + 0.7 * draw)).add(off);
    this._segment(this.rightFore, hand, elbowR, 0.05);
    this._segment(this.rightUpper, elbowR, new THREE.Vector3(0.34, -0.5, 0.25), 0.08);
    this.rightHand.visible = this.rightFore.visible = this.rightUpper.visible = db > 0.05 || sb < 0.5 || bb > 0.05 || pk > 0.05;

    // nocked arrow points from the string towards the crosshair
    this.arrow.visible = a.drawing && a.arrows > 0;
    if (this.arrow.visible) {
      _d.subVectors(AIM_POINT, nock).normalize();
      this.arrow.quaternion.setFromUnitVectors(FWD, _d);
      this.arrow.position.copy(nock).addScaledVector(_d, CONFIG.arrows.length * 0.92);
    }
  }

  render(renderer, camera) {
    if (!this.visible) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, camera);
    renderer.autoClear = true;
  }
}
