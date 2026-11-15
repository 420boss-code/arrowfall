// Human player controller: input → archer intentions, aiming and the camera rig.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp, DEG } from '../core/utils.js';
import { Combat } from '../combat/Combat.js';

const CAM = CONFIG.camera;
const B = CONFIG.bow;
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3();
const _e = new THREE.Vector3();

export class Player {
  constructor(game, archer, camera) {
    this.game = game;
    this.archer = archer;
    this.camera = camera;
    this.firstPerson = CONFIG.camera.startFirstPerson;
    this.crouchToggle = false;
    this.shake = 0;          // camera shake from being hit (0..1)
    this.sensitivity = 1;
    this.zoom = 0;
    this.swayT = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.camDist = CAM.thirdPersonOffset.z;
    this.spectating = null;
    this.specYaw = 0;
    this.specPitch = -0.35;
    this.specDistance = 5.5;
    this.exertT = 0;
  }

  update(dt, input) {
    const a = this.archer;
    const g = this.game;
    if (input.wasPressed('KeyV')) this.firstPerson = !this.firstPerson;

    if (this.game.menuOpen) {
      a.moveDir.set(0, 0);
      a.sprinting = false;
      if (a.drawing) { a.drawing = false; a.drawTime = 0; this.game.audio.stopDraw(); }
      return;
    }
    if (a.alive) {
      // mouse look
      const s = 0.0022 * this.sensitivity * (1 - this.zoom * 0.35);
      this.lookYaw -= input.mouseDX * s;
      this.lookPitch = clamp(this.lookPitch - input.mouseDY * s * (this.invertY ? -1 : 1), -1.35, 1.35);
      // sway after holding full draw too long
      const sway = a.swayAmount() * DEG;
      this.swayT += dt;
      const sx = Math.sin(this.swayT * 1.3) * sway + Math.sin(this.swayT * 2.9) * sway * 0.35;
      const sy = Math.cos(this.swayT * 1.1) * sway * 0.7 + Math.sin(this.swayT * 3.7) * sway * 0.25;
      a.yaw = this.lookYaw + sx;
      a.pitch = clamp(this.lookPitch + sy, -1.4, 1.4);

      // movement
      const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
      const str = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
      const sy0 = Math.sin(this.lookYaw), cy0 = Math.cos(this.lookYaw);
      a.moveDir.set(-sy0 * fwd + cy0 * str, -cy0 * fwd - sy0 * str);
      // crouch: C toggles, Ctrl is hold-to-crouch; sprinting or jumping stands you up
      const wantSprint = input.down('ShiftLeft') || input.down('ShiftRight');
      if (this.crouchHold) this.crouchToggle = false;
      else if (input.wasPressed('KeyC')) this.crouchToggle = !this.crouchToggle;
      if ((wantSprint && fwd > 0) || input.wasPressed('Space')) this.crouchToggle = false;
      a.crouching = this.crouchToggle || (this.crouchHold && input.down('KeyC')) || input.down('ControlLeft') || input.down('ControlRight');
      a.sprinting = wantSprint && fwd > 0 && !a.crouching && !a.drawing && a.stamina > (a.sprinting ? 0 : 8);
      this.exertT -= dt;
      if (a.sprinting && this.exertT <= 0) { g.audio.breath(null, 0.45); this.exertT = 3.6; }
      if (input.wasPressed('Space') && a.jump()) g.audio.footstep(g.surfaceAt(a.pos), 1.2, true);

      if (input.wasPressed('KeyE')) g.tryPickup(a);
      if (input.wasPressed('KeyQ')) g.requestBandage();
      if (input.wasPressed('KeyF')) g.requestStab();

      // bow
      if (input.lmb && !a.drawing && a.canDraw()) {
        a.drawing = true;
        a.drawTime = 0;
        g.audio.drawStart(a.pos, true);
      }
      if (a.drawing && !input.lmb) {
        if (Combat.power(a.drawFrac) >= B.minPower) {
          const dir = this.aimDirection(_t);
          g.combat.release(a, dir);
          g.audio.stopDraw();
        } else {
          a.drawing = false; a.drawTime = 0;
          g.audio.stopDraw();
        }
      }
      a.updateDraw(dt);
      const wantZoom = input.rmb && a.drawing ? 1 : 0;
      this.zoom = lerp(this.zoom, wantZoom, clamp(dt * 10, 0, 1));
    } else {
      a.moveDir.set(0, 0);
      a.drawing = false;
      this.zoom = lerp(this.zoom, 0, clamp(dt * 10, 0, 1));
      if (a.deathTime > 1.8) {
        this.specYaw -= input.mouseDX * 0.0035;
        this.specPitch = clamp(this.specPitch - input.mouseDY * 0.0035, -1.1, 0.65);
        if (input.down('KeyA')) this.specYaw += dt * 1.5;
        if (input.down('KeyD')) this.specYaw -= dt * 1.5;
        if (input.down('KeyW')) this.specDistance = Math.max(2, this.specDistance - dt * 5);
        if (input.down('KeyS')) this.specDistance = Math.min(18, this.specDistance + dt * 5);
      }
    }
  }

  // Aim from the camera through the crosshair; arrows fly from the bow toward that point.
  aimDirection(out) {
    const cam = this.camera;
    cam.getWorldDirection(_f);
    const hitPoint = this.game.raycastWorld(cam.position, _f, 250, this.archer);
    const a = this.archer;
    a.bowPos(_p);
    out.subVectors(hitPoint, _p);
    if (out.length() < 3) return out.copy(_f);
    return out.normalize();
  }

  updateCamera(dt) {
    const a = this.archer;
    const cam = this.camera;
    // Minecraft-style: the view narrows as you draw (f² curve, up to 15%); right mouse zooms further
    const f = a.alive && a.drawing ? Math.min(1, a.drawFrac) : 0;
    this.drawZoom = lerp(this.drawZoom || 0, f * f, clamp(dt * 15, 0, 1));
    const baseFov = (this.game.settings && this.game.settings.fov) || CAM.fov;
    const fov = lerp(baseFov * (1 - this.drawZoom * B.drawZoom), B.zoomFov * (baseFov / CAM.fov), this.zoom);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }

    let subject = a;
    let yaw = a.yaw, pitch = a.pitch;
    // first person death: the view drops and rolls to the ground before spectating
    if (!a.alive && this.firstPerson && a.deathTime < 1.8) {
      const e = clamp(a.deathTime / 0.8, 0, 1), ease = 1 - Math.pow(1 - e, 3);
      a.eyePos(_e);
      const gy = this.game.terrain.height(a.pos.x, a.pos.z) + 0.25;
      _e.y = lerp(_e.y, gy, ease);
      const py = lerp(this.lookPitch, a.deathDir > 0 ? 0.9 : -0.3, ease);
      const cp0 = Math.cos(py);
      _f.set(-Math.sin(this.lookYaw) * cp0, Math.sin(py), -Math.cos(this.lookYaw) * cp0);
      cam.position.copy(_e);
      _t.copy(cam.position).add(_f);
      cam.lookAt(_t);
      cam.rotateZ(ease * 0.7 * (a.deathDir > 0 ? 1 : -1));
      return;
    }
    if (!a.alive) {
      // spectate: slowly orbit a living teammate (or our corpse)
      subject = this.spectating && this.spectating.alive ? this.spectating : a;
      yaw = this.specYaw;
      pitch = this.specPitch;
    }
    const fp = this.firstPerson && a.alive;
    subject.eyePos(_e);
    if (a.alive) _e.y = lerp(cam.userData.eyeY ?? _e.y, _e.y, clamp(dt * 9, 0, 1));
    cam.userData.eyeY = _e.y;
    const cp = Math.cos(pitch);
    _f.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    _r.set(Math.cos(yaw), 0, -Math.sin(yaw));
    if (fp) {
      cam.position.copy(_e).addScaledVector(_f, 0.12);
      // gentle head bob while walking (less when crouched or drawing)
      const move = clamp(a.speed / CONFIG.archer.runSpeed, 0, 1) * (a.onGround ? 1 : 0) * (a.drawing ? 0.4 : 1) * (a.crouching ? 0.6 : 1);
      cam.position.y += Math.sin(a.animPhase * 2) * 0.028 * move;
      cam.position.addScaledVector(_r, Math.sin(a.animPhase) * 0.018 * move);
      // landing dip and the duck when picking things up
      if (a.landT > 0) cam.position.y -= (a.landT / 0.28) * 0.12;
      if (a.pickupT > 0) cam.position.y -= Math.sin((1 - a.pickupT / 0.6) * Math.PI) * 0.35;
    } else {
      const off = CAM.thirdPersonOffset;
      const dist = !a.alive ? this.specDistance : lerp(off.z, off.z * 0.7, this.zoom);
      const side = !a.alive ? 0 : off.x;
      _p.copy(_e).addScaledVector(_r, side);
      _p.y += off.y;
      _t.copy(_p).addScaledVector(_f, -dist);
      // keep the camera out of trunks
      const hit = this.game.forest.raycast(_p.x, _p.y, _p.z, _t.x, _t.y, _t.z, false);
      let want = dist;
      if (hit && !hit.obstacle.canopy) want = Math.max(0.4, dist * hit.t - 0.25);
      this.camDist = want < this.camDist ? want : lerp(this.camDist, want, clamp(dt * 5, 0, 1));
      cam.position.copy(_p).addScaledVector(_f, -this.camDist);
      this.game.forest.collideCircle(cam.position, 0.35, cam.position.y - 0.3);
      const gh = this.game.terrain.height(cam.position.x, cam.position.z) + 0.3;
      if (cam.position.y < gh) cam.position.y = gh;
    }
    // shake when hit
    if (this.shake > 0 && a.alive) {
      const k = this.shake * this.shake;
      cam.position.x += (Math.random() - 0.5) * 0.09 * k;
      cam.position.y += (Math.random() - 0.5) * 0.07 * k;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    _t.copy(cam.position).add(_f);
    cam.lookAt(_t);
    if (this.shake > 0 && a.alive) cam.rotateZ((Math.random() - 0.5) * 0.05 * this.shake);
  }
}
