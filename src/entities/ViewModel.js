// First-person view model: your own arms, bow, string and nocked arrow, drawn in a second pass on
// top of the world (depth cleared) so they never clip into trees. Everything is positioned in
// camera space: +x right, +y up, -z forward.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp } from '../core/utils.js';
import { bowGeometry } from './ArcherRenderer.js';
import { arrowGeometry } from '../combat/Projectiles.js';

const BOW_SCALE = 0.74;
const K = CONFIG.knife;
const RELOAD = CONFIG.bow.reloadTime;
const ARROW_SCALE = 0.62;
const ease = (t) => t * t * (3 - 2 * t);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const NEG_Z = new THREE.Vector3(0, 0, -1);
const FWD = new THREE.Vector3(0, 0, 1);
const AIM_POINT = new THREE.Vector3(0, 0, -60);

// Poses: [drawn, relaxed, sprinting]. Drawn: the bow hand sits just left of and below the crosshair,
// canted a little, so the arrow runs from the bottom of the view straight to the crosshair.
const GRIP = [new THREE.Vector3(-0.036, -0.108, -0.6), new THREE.Vector3(-0.27, -0.35, -0.56), new THREE.Vector3(-0.32, -0.5, -0.46)];
const BOW_ROT = [new THREE.Euler(0, 0, 0.26), new THREE.Euler(-0.3, 0.25, 0.55), new THREE.Euler(-0.55, 0.4, 0.95)];
const REST_NOCK = new THREE.Vector3(0.0, -0.092, -0.47);   // string at rest, arrow nocked
const FULL_NOCK = new THREE.Vector3(0.0, -0.092, -0.17);   // anchor under the cheek
const HAND_REST = new THREE.Vector3(0.22, -0.44, -0.44);
const FOLLOW = new THREE.Vector3(0.32, -0.2, -0.2);       // after the loose the hand flies back and out of view
const QUIVER = new THREE.Vector3(0.34, 0.24, 0.06);        // over the right shoulder, out of view
const RETURN = new THREE.Vector3(0.32, 0.17, -0.34);       // coming back into view with the next arrow
const ARROW_FROM_QUIVER = new THREE.Vector3(-0.25, -0.55, -0.8).normalize();

export class ViewModel {
  constructor(game, props = null) {
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
    this.arrow.scale.setScalar(ARROW_SCALE);
    this.root.add(this.arrow);
    this.knife = new THREE.Mesh(props ? props.knife : new THREE.BoxGeometry(0.02, 0.03, 0.25), new THREE.MeshLambertMaterial({ vertexColors: !!props }));
    this.knife.scale.setScalar(1.05);
    this.root.add(this.knife);
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
    const rt = a.releaseTimer;
    const stabbing = a.stabT > 0;
    const su = stabbing ? 1 - a.stabT / K.time : 1;
    const reloading = !a.drawing && a.arrows > 0 && rt < RELOAD && !stabbing;
    // the bow stays up after a shot while the next arrow is fetched, then lowers
    const stance = !stabbing && !a.bandaging && (a.drawing || rt < (a.arrows > 0 ? RELOAD + 0.3 : 0.3));
    this.drawBlend = lerp(this.drawBlend, stance ? 1 : 0, k);
    this.sprintBlend = lerp(this.sprintBlend, a.sprinting && !a.drawing ? 1 : 0, clamp(dt * 6, 0, 1));
    this.stabBlend = lerp(this.stabBlend || 0, stabbing ? 1 : 0, clamp(dt * 16, 0, 1));
    const db = this.drawBlend, sb = this.sprintBlend, kb = this.stabBlend;
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
    // the bow kicks forward a touch on release
    const rec = !a.drawing && rt < 0.25 && db > 0.5 ? Math.sin((rt / 0.25) * Math.PI) : 0;

    // bow rig pose: relaxed → sprint, then → drawn; stabbing drops it out of the way
    const grip = new THREE.Vector3().copy(GRIP[1]).lerp(GRIP[2], sb).lerp(GRIP[0], db).add(off);
    grip.z -= rec * 0.03;
    grip.x -= kb * 0.08; grip.y -= kb * 0.12;
    const r0 = BOW_ROT[1], r2 = BOW_ROT[2], r1 = BOW_ROT[0];
    _e.set(lerp(lerp(r0.x, r2.x, sb), r1.x, db) - rec * 0.04 - kb * 0.3, lerp(lerp(r0.y, r2.y, sb), r1.y, db), lerp(lerp(r0.z, r2.z, sb), r1.z, db) + (a.crouching ? 0.05 : 0) + kb * 0.3);
    // bandaging: the bow arm comes across the body
    if (bb > 0.01) { grip.lerp(new THREE.Vector3(-0.1, -0.36, -0.4), bb); _e.z += bb * 0.6; }
    this.bowRig.position.copy(grip);
    this.bowRig.rotation.copy(_e);
    this.bowRig.updateMatrix();
    this.bow.updateMatrix();

    // string tips in camera space
    const tipT = new THREE.Vector3(0, 0.62, 0.04).applyMatrix4(this.bow.matrix).applyMatrix4(this.bowRig.matrix);
    const tipB = new THREE.Vector3(0, -0.62, 0.04).applyMatrix4(this.bow.matrix).applyMatrix4(this.bowRig.matrix);
    const restMid = new THREE.Vector3().addVectors(tipT, tipB).multiplyScalar(0.5);
    // where the nock sits on the string when drawn: the rest point of the drawn pose, carried by the bow
    const restNock = _b.copy(REST_NOCK).add(off);
    restNock.z -= rec * 0.03;
    const restAt = new THREE.Vector3().copy(restMid).lerp(restNock, db);
    const draw = a.drawing ? ease(a.drawFrac) : 0;
    const nock = restAt.clone().lerp(_d.copy(FULL_NOCK).add(off), draw * db);
    // after the loose the string snaps back and shivers
    const stringMid = a.drawing ? nock : restAt.clone().addScaledVector(NEG_Z, !a.drawing && rt < 0.25 ? Math.sin(rt * 90) * 0.02 * (1 - rt / 0.25) : 0);
    this._segment(this.strTop, tipT, stringMid, 0.004);
    this._segment(this.strBot, stringMid, tipB, 0.004);
    this.strTop.visible = this.strBot.visible = bb < 0.5;

    // left arm holds the bow
    this.leftHand.position.copy(grip);
    this.leftHand.quaternion.copy(this.bowRig.quaternion);
    this.leftHand.scale.set(0.05, 0.095, 0.065);
    const elbowL = new THREE.Vector3(-0.3, -0.36, -0.22).lerp(new THREE.Vector3(-0.22, -0.3, -0.32), db).add(off);
    this._segment(this.leftFore, grip.clone().add(_d.set(-0.01, -0.03, 0.03)), elbowL, 0.052);
    this._segment(this.leftUpper, elbowL, new THREE.Vector3(-0.32, -0.6, 0.1), 0.08);

    // right hand: on the string while drawing; on release it flies back out of view, reaches over the
    // shoulder to the quiver and comes back with the next arrow; otherwise it rests low
    const hand = new THREE.Vector3();
    let arrowDir = null, arrowFrom = null;
    const aimDir = new THREE.Vector3();
    if (a.drawing) {
      hand.copy(nock);
      arrowFrom = nock;
    } else if (rt < 0.14 && db > 0.5 && !stabbing) {
      hand.copy(FULL_NOCK).add(off).lerp(FOLLOW, ease(rt / 0.14));
    } else if (reloading && db > 0.5) {
      const r = (rt - 0.14) / (RELOAD - 0.14);
      if (r < 0.4) hand.copy(FOLLOW).lerp(QUIVER, ease(r / 0.4));
      else if (r < 0.55) hand.copy(QUIVER);
      else {
        const t = ease((r - 0.55) / 0.45);
        hand.copy(RETURN).lerp(restAt, t);
        arrowFrom = hand;
        arrowDir = new THREE.Vector3().copy(ARROW_FROM_QUIVER).lerp(aimDir.subVectors(AIM_POINT, restAt).normalize(), t).normalize();
      }
    } else hand.copy(HAND_REST).add(off).lerp(new THREE.Vector3(0.24, -0.5, -0.36), sb);
    hand.lerp(new THREE.Vector3(0.08, -0.55, -0.42), pk);
    if (bb > 0.01) {
      const w = performance.now() / 1000 * 9;
      hand.lerp(new THREE.Vector3(-0.02 + Math.cos(w) * 0.06, -0.3 + Math.sin(w) * 0.04, -0.36), bb);
    }
    // knife: wind up low at the right, drive it to the centre, draw it back
    if (kb > 0.01 || stabbing) {
      const wind = new THREE.Vector3(0.2, -0.3, -0.34), out = new THREE.Vector3(0.03, -0.09, -0.56);
      const thrust = su < 0.3 ? 0 : su < 0.5 ? ease((su - 0.3) / 0.2) : 1 - ease((su - 0.5) / 0.5);
      const kp = wind.clone().lerp(out, thrust).add(off);
      hand.lerp(kp, kb);
      this.knife.visible = true;
      this.knife.position.copy(hand);
      // blade angled up and across, so it reads on screen rather than pointing straight away
      _d.set(-0.2, 0.75, -0.55).lerp(_b.set(-0.5, 0.42, -0.75), thrust).normalize();
      this.knife.quaternion.setFromUnitVectors(NEG_Z, _d);
    } else this.knife.visible = false;
    this.rightHand.position.copy(hand);
    this.rightHand.quaternion.identity();
    this.rightHand.scale.set(0.045, 0.05, 0.06);
    const elbowR = hand.clone().add(_d.set(0.22, -0.16, 0.2));
    this._segment(this.rightFore, hand, elbowR, 0.05);
    this._segment(this.rightUpper, elbowR, new THREE.Vector3(0.34, -0.55, 0.3), 0.08);
    const handOn = db > 0.05 || sb < 0.5 || bb > 0.05 || pk > 0.05 || kb > 0.05;
    this.rightHand.visible = this.rightFore.visible = this.rightUpper.visible = handOn;

    // the arrow: on the string pointing at the crosshair while drawing; in the hand while reloading
    this.arrow.visible = !!arrowFrom && a.arrows > 0 && bb < 0.5;
    if (this.arrow.visible) {
      const dir = arrowDir || aimDir.subVectors(AIM_POINT, arrowFrom).normalize();
      this.arrow.quaternion.setFromUnitVectors(FWD, dir);
      this.arrow.position.copy(arrowFrom).addScaledVector(dir, CONFIG.arrows.length * ARROW_SCALE);
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
