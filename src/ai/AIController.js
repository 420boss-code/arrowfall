// One bot's brain: a state machine (patrol → advance → cover → engage → retreat, plus scavenge)
// split into a cheap per-frame act() and a time-sliced think() that does perception and decisions.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp, wrapAngle, approachAngle, DEG } from '../core/utils.js';
import { Combat } from '../combat/Combat.js';

const AIC = CONFIG.ai;
const G = CONFIG.arrows.gravity;
const DRAG = CONFIG.arrows.drag;

// Height reached at horizontal distance x when launched at angle th with speed v, simulated in
// 20 Hz ticks like the game (drag then gravity). Returns { y, tof } or null if it never gets there.
function flight(th, v, x) {
  let px = 0, py = 0, vx = Math.cos(th) * v, vy = Math.sin(th) * v, t = 0;
  const dt = 0.05;
  while (t < 6) {
    const nx = px + vx * dt, ny = py + vy * dt;
    if (nx >= x) { const f = (x - px) / (nx - px); return { y: py + (ny - py) * f, tof: t + dt * f }; }
    px = nx; py = ny;
    vx *= DRAG; vy = vy * DRAG - G * dt;
    t += dt;
    if (vx < 0.5) return null;
  }
  return null;
}

// Lowest launch angle that lands at (x, y); falls back to the longest-range angle.
function solveLaunch(x, y, v) {
  if (x < 0.5) return { angle: Math.atan2(y, Math.max(x, 0.01)), tof: 0.02 };
  let lo = -0.9, hi = 0.75;
  const top = flight(hi, v, x);
  if (!top || top.y < y) return { angle: hi, tof: top ? top.tof : x / v };
  let best = top;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    const r = flight(mid, v, x);
    if (r && r.y >= y) { hi = mid; best = r; } else lo = mid;
  }
  return { angle: hi, tof: best.tof };
}

export const S = {
  PATROL: 'patrol', ADVANCE: 'advance', COVER: 'cover', ENGAGE: 'engage', RETREAT: 'retreat', SCAVENGE: 'scavenge', HOLD: 'hold',
};

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _e = new THREE.Vector3(), _t = new THREE.Vector3();

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 1.41;
}

export class AIController {
  constructor(game, archer, squad, diff) {
    this.game = game;
    this.archer = archer;
    this.squad = squad;
    this.diff = diff;
    archer.ai = this;
    this.offset = new THREE.Vector2((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
    this.reset();
  }

  reset() {
    this.state = S.PATROL;
    this.stateTime = 0;
    this.target = null;
    this.targetVisible = false;
    this.lastSeen = -99;
    this.lastKnown = new THREE.Vector3();
    this.hasLastKnown = false;
    this.reaction = 0;
    this.moveTarget = new THREE.Vector3().copy(this.archer.pos);
    this.wantSprint = false;
    this.cover = null;
    this.phase = 'hide';
    this.phaseTime = 0;
    this.peekSide = Math.random() < 0.5 ? -1 : 1;
    this.desiredDraw = 0.8;
    this.aimErrYaw = 0;
    this.aimErrPitch = 0;
    this.aimYaw = this.archer.yaw;
    this.aimPitch = 0;
    this.blockedTime = 0;
    this.nextThink = Math.random() * 0.5;
    this.stuckTimer = 0;
    this.stuckCheckPos = new THREE.Vector3().copy(this.archer.pos);
    this.sidestep = 0;
    this.sidestepDir = 1;
    this.strafe = 0;
    this.strafeTimer = 0;
    this.patrolTime = 3 + Math.random() * 6 + (1 - this.diff.aggression) * 10;
    this.holdCrouch = false;
  }

  get side() { return this.archer.team === 'red' ? -1 : 1; }

  onDamaged(attacker) {
    if (!attacker || !this.archer.alive || this.archer.remote) return;
    // being shot reveals the attacker's rough position and shortens reaction
    this.lastKnown.copy(attacker.pos);
    this.hasLastKnown = true;
    this.squad.report(attacker, this.game.time);
    if (!this.target || !this.targetVisible) {
      this.target = attacker;
      this.reaction = Math.min(this.reaction, this.diff.reaction * 0.5);
    }
    if (this.state !== S.RETREAT && this.state !== S.ENGAGE) this._enterCoverOrEngage();
    this.nextThink = 0;
  }

  setState(s) {
    if (this.state === s) return;
    this.state = s;
    this.stateTime = 0;
    this.phase = 'hide';
    this.phaseTime = 0;
  }

  // ---------------------------------------------------------------- perception
  _canSee(enemy) {
    const a = this.archer;
    const dx = enemy.pos.x - a.pos.x, dz = enemy.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const inField = this.game.terrain.isField(enemy.pos.x, enemy.pos.z) && this.game.terrain.forestFactor(a.pos.x, a.pos.z) < 0.98;
    let range = inField || this.game.terrain.isField(a.pos.x, a.pos.z) ? AIC.visionRangeField : AIC.visionRangeForest;
    if (enemy.crouching) range *= 0.7;
    if (d > range) return false;
    if (d > 5) {
      const fwdYaw = a.yaw;
      const toYaw = Math.atan2(-dx, -dz);
      if (Math.abs(wrapAngle(toYaw - fwdYaw)) > (AIC.fov * DEG) / 2) return false;
    }
    a.eyePos(_e);
    enemy.eyePos(_t);
    _t.y -= 0.35;
    if (this.game.forest.lineOfSight(_e, _t)) return true;
    // try the head (peeking over a bush or log)
    enemy.eyePos(_t);
    return this.game.forest.lineOfSight(_e, _t);
  }

  _canHear(enemy) {
    if (enemy.noise <= 0) return false;
    const r = enemy.crouching ? AIC.hearingRangeCrouch : AIC.hearingRange * enemy.noise;
    return enemy.pos.distanceToSquared(this.archer.pos) < r * r;
  }

  _perceive() {
    const a = this.archer;
    const enemies = this.game.teams[a.team === 'red' ? 'blue' : 'red'];
    let best = null, bestD = Infinity, checks = 0;
    // keep current target if still visible (cheap, stable)
    if (this.target && this.target.alive && this._canSee(this.target)) {
      best = this.target; bestD = this.target.pos.distanceTo(a.pos);
    } else {
      // sort a few nearest candidates by distance, LOS-test at most 3
      const cands = [];
      for (const e of enemies) {
        if (!e.alive) continue;
        const d = e.pos.distanceToSquared(a.pos);
        if (d < AIC.visionRangeField * AIC.visionRangeField) cands.push([d, e]);
      }
      cands.sort((x, y) => x[0] - y[0]);
      for (const [d, e] of cands) {
        if (checks++ >= 3) break;
        if (this._canSee(e)) { best = e; bestD = Math.sqrt(d); break; }
        if (this._canHear(e)) {
          this.lastKnown.copy(e.pos); this.hasLastKnown = true;
          this.squad.report(e, this.game.time);
        }
      }
    }
    const now = this.game.time;
    if (best) {
      if (best !== this.target || !this.targetVisible) {
        if (now - this.lastSeen > 2 || best !== this.target) this.reaction = this.diff.reaction * (0.7 + Math.random() * 0.6);
      }
      this.target = best;
      this.targetVisible = true;
      this.lastSeen = now;
      this.lastKnown.copy(best.pos);
      this.hasLastKnown = true;
      this.squad.report(best, now);
      this.game.reportSighting(a.team, best);
    } else {
      this.targetVisible = false;
      if (this.target && !this.target.alive) this.target = null;
    }
    return best;
  }

  // ---------------------------------------------------------------- decisions (time-sliced)
  think() {
    const a = this.archer;
    if (!a.alive) return;
    const now = this.game.time;
    const seen = this._perceive();
    const lowHp = a.hp <= AIC.retreatHp;

    // out of arrows → scavenge or retreat
    if (a.arrows <= 0 && this.state !== S.SCAVENGE) {
      const p = this.game.projectiles.nearestPickup(a.pos, 30);
      const corpse = this.game.nearestLootableCorpse(a, 35);
      if (p || corpse) { this.setState(S.SCAVENGE); }
      else if (this.state !== S.RETREAT) this.setState(S.RETREAT);
    }

    // King of the Field: don't sit at the treeline while the enemy holds the zone
    if (this.game.mode === 'kotf' && a.arrows > 0 && !lowHp) {
      const zr = CONFIG.rules.kotfZoneRadius - 1.5;
      const inZone = a.pos.x * a.pos.x + a.pos.z * a.pos.z < zr * zr;
      const patience = lerp(9, 3, this.diff.aggression);
      if (!inZone && this.game.zoneOwner !== a.team && (this.state === S.ENGAGE || this.state === S.COVER || this.state === S.HOLD) && this.stateTime > patience) {
        this.cover = null;
        this.setState(S.ADVANCE);
      }
    }

    switch (this.state) {
      case S.PATROL: {
        if (seen) { this._enterCoverOrEngage(); break; }
        if (this.squad.alertUntil > now && this.squad.lastKnown) { this.setState(S.ADVANCE); break; }
        if (this.stateTime > this.patrolTime || this.game.mode === 'kotf') this.setState(S.ADVANCE);
        this._followSquad(false);
        break;
      }
      case S.ADVANCE: {
        if (this.game.mode === 'kotf') {
          // push for the zone, shooting on the move; only stop to fight once inside or at close range
          const zr = CONFIG.rules.kotfZoneRadius - 2;
          const inZone = a.pos.x * a.pos.x + a.pos.z * a.pos.z < zr * zr;
          if (seen && (inZone || a.pos.distanceTo(seen.pos) < 12)) { this._enterCoverOrEngage(); break; }
          if (lowHp) { this.setState(S.RETREAT); break; }
          this.moveTarget.set(this.offset.x * 0.8, 0, this.offset.y * 0.8);
          this.wantSprint = !seen && a.stamina > 15;
          a.crouching = false;
          break;
        }
        if (seen) { this._enterCoverOrEngage(); break; }
        if (lowHp) { this.setState(S.RETREAT); break; }
        // investigate shared sightings when no route-specific target
        const sk = this.squad.lastKnown;
        if (sk && now - this.squad.lastKnownTime < 6 && sk.distanceTo(a.pos) < 50) {
          this.moveTarget.copy(sk);
          this.wantSprint = false;
          a.crouching = a.pos.distanceTo(sk) < 20 && this.diff.aggression < 0.6;
        } else if (this.hasLastKnown && now - this.lastSeen < 8) {
          this.moveTarget.copy(this.lastKnown);
          this.wantSprint = false;
        } else {
          this._followSquad(true);
        }
        break;
      }
      case S.COVER: {
        if (lowHp) { this.setState(S.RETREAT); break; }
        if (!this.cover || this.stateTime > 6) { this.setState(S.ENGAGE); break; }
        this.moveTarget.set(this.cover.x, 0, this.cover.z);
        this.wantSprint = true;
        if (Math.hypot(a.pos.x - this.cover.x, a.pos.z - this.cover.z) < 0.9) this.setState(S.ENGAGE);
        break;
      }
      case S.ENGAGE: {
        if (lowHp && (!seen || a.pos.distanceTo(seen.pos) > 15)) { this.setState(S.RETREAT); break; }
        if (!this.target || !this.target.alive) { this.target = null; this.setState(S.ADVANCE); break; }
        if (!seen && now - this.lastSeen > 3.5) {
          // lost contact: hunt the last known position or hold if cautious
          this.setState(Math.random() < this.diff.aggression ? S.ADVANCE : S.HOLD);
          break;
        }
        this._engagePositioning(seen);
        break;
      }
      case S.HOLD: {
        if (seen) { this._enterCoverOrEngage(); break; }
        a.crouching = true;
        this.moveTarget.copy(a.pos);
        if (this.stateTime > 4 + (1 - this.diff.aggression) * 6) { a.crouching = false; this.setState(S.ADVANCE); }
        break;
      }
      case S.RETREAT: {
        const threat = this.hasLastKnown ? this.lastKnown : null;
        if (seen && a.arrows > 0 && (a.pos.distanceTo(seen.pos) < 18 || this.stateTime > 10)) {
          // cornered or settled: fight from cover
          this._enterCoverOrEngage(true);
          break;
        }
        const home = _v.set(this.side * 110, 0, a.pos.z * 0.8);
        if (threat) {
          const away = _w.subVectors(a.pos, threat).setY(0).normalize();
          home.addScaledVector(away, 25);
        }
        this.moveTarget.copy(home);
        this.wantSprint = a.stamina > 20;
        if (this.stateTime > 14 && a.arrows > 0) this.setState(seen ? S.ENGAGE : S.HOLD);
        break;
      }
      case S.SCAVENGE: {
        if (a.arrows > 0 && (seen || a.arrows >= 8 || this.stateTime > 15)) { this.setState(seen ? S.ENGAGE : S.ADVANCE); break; }
        const p = this.game.projectiles.nearestPickup(a.pos, 35);
        const corpse = this.game.nearestLootableCorpse(a, 40);
        const tgt = corpse && (!p || corpse.pos.distanceTo(a.pos) < p.pos.distanceTo(a.pos)) ? corpse.pos : p ? p.pos : null;
        if (!tgt) { this.setState(a.arrows > 0 ? S.ADVANCE : S.RETREAT); break; }
        this.moveTarget.set(tgt.x, 0, tgt.z);
        this.wantSprint = true;
        if (Math.hypot(a.pos.x - tgt.x, a.pos.z - tgt.z) < 1.8) this.game.tryPickup(a);
        break;
      }
    }
  }

  _enterCoverOrEngage(forceCover = false) {
    const a = this.archer;
    const threat = this.target ? this.target.pos : this.lastKnown;
    const inForest = this.game.terrain.forestFactor(a.pos.x, a.pos.z) > 0.6;
    const caution = 1 - this.diff.aggression * 0.6;
    if (inForest || forceCover || Math.random() < caution) {
      let c = this.game.forest.findCover(a.pos, threat, inForest ? 10 : 16);
      if (c && this.game.mode === 'kotf') {
        const zr = CONFIG.rules.kotfZoneRadius;
        const meIn = a.pos.x * a.pos.x + a.pos.z * a.pos.z < zr * zr;
        if (meIn && c.x * c.x + c.z * c.z > zr * zr) c = null;
      }
      if (c) {
        this.cover = c;
        this.setState(S.COVER);
        return;
      }
    }
    this.cover = null;
    this.setState(S.ENGAGE);
  }

  _engagePositioning(seen) {
    const a = this.archer;
    const tgt = this.target;
    const d = a.pos.distanceTo(tgt.pos);
    this.wantSprint = false;
    // pick desired draw: farther targets need fuller draws
    this.desiredDraw = d < 9 ? 0.55 : d < 18 ? lerp(0.75, 1, this.diff.drawTarget) : (this.diff.drawTarget >= 0.75 ? 1 : 0.85);
    if (this.cover) {
      // peek cycle: hide behind the trunk while drawing, step out to shoot
      const toT = _v.set(tgt.pos.x - this.cover.obstacle.x, 0, tgt.pos.z - this.cover.obstacle.z).normalize();
      const lat = _w.set(-toT.z, 0, toT.x).multiplyScalar(this.peekSide);
      if (this.phase === 'hide') {
        this.moveTarget.set(this.cover.x, 0, this.cover.z);
        a.crouching = this.diff.aggression < 0.7;
        const wait = lerp(1.6, 0.35, this.diff.aggression);
        if (this.phaseTime > wait && a.drawFrac >= this.desiredDraw * 0.9) { this.phase = 'peek'; this.phaseTime = 0; }
      } else {
        const r = this.cover.obstacle.r + 0.7;
        this.moveTarget.set(this.cover.obstacle.x + lat.x * r + toT.x * 0.2, 0, this.cover.obstacle.z + lat.z * r + toT.z * 0.2);
        a.crouching = false;
        if (this.phaseTime > 3.2) { this.phase = 'hide'; this.phaseTime = 0; this.peekSide *= -1; }
      }
      // the threat may have flanked our cover: re-evaluate
      const behind = _v.set(this.cover.x - this.cover.obstacle.x, 0, this.cover.z - this.cover.obstacle.z);
      const toThreat = _w.set(tgt.pos.x - this.cover.obstacle.x, 0, tgt.pos.z - this.cover.obstacle.z);
      if (behind.dot(toThreat) > 0 || d < 7) {
        const c = this.game.forest.findCover(a.pos, tgt.pos, 10);
        if (c && Math.random() < 0.6) { this.cover = c; this.setState(S.COVER); }
        else this.cover = null;
      }
    } else {
      // open ground: crouch and shoot if cautious, strafe if aggressive, close distance if far
      if (this.game.mode === 'kotf' && a.pos.lengthSq() < CONFIG.rules.kotfZoneRadius ** 2) {
        this.moveTarget.set(this.offset.x * 0.8, 0, this.offset.y * 0.8);
        a.crouching = true;
      } else if (d > 50) {
        this.moveTarget.copy(tgt.pos);
        a.crouching = false;
      } else if (this.diff.aggression > 0.5 && Math.random() < 0.5) {
        this.strafeTimer -= 0.3;
        if (this.strafeTimer <= 0) { this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeTimer = 1 + Math.random() * 2; }
        const toT = _v.set(tgt.pos.x - a.pos.x, 0, tgt.pos.z - a.pos.z).normalize();
        this.moveTarget.set(a.pos.x - toT.z * this.strafe * 3, 0, a.pos.z + toT.x * this.strafe * 3);
        a.crouching = false;
      } else {
        this.moveTarget.copy(a.pos);
        a.crouching = true;
      }
      // seek cover occasionally when exposed in the forest
      if (this.game.terrain.forestFactor(a.pos.x, a.pos.z) > 0.6 && this.stateTime > 2 && Math.random() < 0.15) {
        const c = this.game.forest.findCover(a.pos, tgt.pos, 8);
        if (c) { this.cover = c; this.setState(S.COVER); }
      }
    }
  }

  _followSquad(advancing) {
    const a = this.archer;
    const sq = this.squad;
    const wp = sq.currentWaypoint();
    if (!wp) { this.moveTarget.copy(a.pos); return; }
    this.moveTarget.set(wp.x + this.offset.x, 0, wp.z + this.offset.y);
    const crossing = wp.cross;
    this.wantSprint = advancing && (crossing || sq.hurry) && a.stamina > 25;
    a.crouching = false;
    // waiting to regroup before crossing open ground
    if (sq.regrouping && sq.leader() !== a) this.wantSprint = true;
    if (sq.regrouping && sq.leader() === a) this.moveTarget.copy(a.pos);
  }

  // ---------------------------------------------------------------- per-frame actions
  act(dt) {
    const a = this.archer;
    if (!a.alive) return;
    this.stateTime += dt;
    this.phaseTime += dt;
    if (this.reaction > 0) this.reaction -= dt;
    const engaging = (this.state === S.ENGAGE || this.state === S.COVER || this.state === S.RETREAT ||
      (this.state === S.ADVANCE && this.game.mode === 'kotf' && this.targetVisible)) && this.target && this.target.alive;

    // --- movement steering
    const dx = this.moveTarget.x - a.pos.x, dz = this.moveTarget.z - a.pos.z;
    const dist = Math.hypot(dx, dz);
    let mx = 0, mz = 0;
    if (dist > 0.6) { mx = dx / dist; mz = dz / dist; }
    // separation from nearby teammates
    for (const m of this.squad.members) {
      if (m === a || !m.alive) continue;
      const ox = a.pos.x - m.pos.x, oz = a.pos.z - m.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 2.5 && d2 > 1e-4) { mx += ox / d2 * 0.6; mz += oz / d2 * 0.6; }
    }
    // stuck handling: sidestep around obstacles
    this.stuckTimer += dt;
    if (this.stuckTimer > 1.2) {
      const moved = Math.hypot(a.pos.x - this.stuckCheckPos.x, a.pos.z - this.stuckCheckPos.z);
      if (dist > 2 && moved < 0.4) { this.sidestep = 0.8; this.sidestepDir = Math.random() < 0.5 ? -1 : 1; }
      this.stuckCheckPos.copy(a.pos);
      this.stuckTimer = 0;
    }
    if (this.sidestep > 0) {
      this.sidestep -= dt;
      const tx = -mz * this.sidestepDir, tz = mx * this.sidestepDir;
      mx = mx * 0.2 + tx; mz = mz * 0.2 + tz;
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const slow = dist < 2 ? dist / 2 : 1;
    a.moveDir.set(mx * slow, mz * slow);
    a.sprinting = this.wantSprint && !a.drawing && !a.crouching && a.stamina > 5 && dist > 4;

    // --- facing and aiming
    const turnRate = lerp(3.5, 7, this.diff.aggression) * dt;
    if (engaging && (this.targetVisible || this.game.time - this.lastSeen < 1.5)) {
      this._aim(dt);
      a.yaw = approachAngle(a.yaw, this.aimYaw, turnRate * 1.4);
      a.pitch = lerp(a.pitch, this.aimPitch, clamp(dt * 8, 0, 1));
      this._bowLogic(dt);
    } else {
      if (a.drawing && this.state !== S.ENGAGE) { a.drawing = false; a.drawTime = 0; }
      if (a.speed > 0.4) a.yaw = approachAngle(a.yaw, Math.atan2(-a.vel.x, -a.vel.z), turnRate);
      else if (this.hasLastKnown) a.yaw = approachAngle(a.yaw, Math.atan2(-(this.lastKnown.x - a.pos.x), -(this.lastKnown.z - a.pos.z)), turnRate * 0.5);
      a.pitch = lerp(a.pitch, 0, clamp(dt * 3, 0, 1));
    }
  }

  // Ballistic aim with target leading and difficulty-scaled error. Flight follows the Minecraft
  // model (drag + strong gravity), so the launch angle and time of flight are found numerically.
  _aim() {
    const a = this.archer, t = this.target;
    a.bowPos(_e);
    const speed = Combat.speedFor(Math.max(a.drawFrac, this.desiredDraw * 0.9));
    _t.set(t.pos.x, t.pos.y + t.height * 0.62, t.pos.z);
    let tof = _t.distanceTo(_e) / speed;
    const lead = this.diff.leadSkill;
    let sol = null;
    for (let k = 0; k < 2; k++) {
      _v.set(t.pos.x + t.vel.x * tof * lead, t.pos.y + t.height * 0.62, t.pos.z + t.vel.z * tof * lead);
      sol = solveLaunch(Math.hypot(_v.x - _e.x, _v.z - _e.z), _v.y - _e.y, speed);
      tof = sol.tof;
    }
    this.aimYaw = Math.atan2(-(_v.x - _e.x), -(_v.z - _e.z)) + this.aimErrYaw;
    this.aimPitch = sol.angle + this.aimErrPitch;
  }

  _bowLogic(dt) {
    const a = this.archer;
    if (a.arrows <= 0) { a.drawing = false; return; }
    if (this.reaction > 0) return;
    if (!a.drawing) {
      if (a.canDraw()) {
        a.drawing = true;
        a.drawTime = 0;
        // fresh aim error for this shot; worse when the bot has been hit recently or the target moves
        const moveErr = clamp(this.target.speed / 6, 0, 1) * 0.6;
        const err = this.diff.aimError * (1 + moveErr) * DEG;
        this.aimErrYaw = gauss() * err;
        this.aimErrPitch = gauss() * err * 0.8;
        this.game.audio.drawStart(a.pos, false);
      }
      return;
    }
    a.updateDraw(dt);
    const ready = a.drawFrac >= this.desiredDraw || a.drawTime > 2.6;
    if (!ready) return;
    if (this.cover && this.phase === 'hide') return; // wait until peeking
    const aimed = Math.abs(wrapAngle(a.yaw - this.aimYaw)) < 2.5 * DEG;
    if (!aimed) return;
    // confirm a clear line before loosing
    a.eyePos(_e);
    this.target.eyePos(_t); _t.y -= 0.4;
    const clear = this.game.forest.lineOfSight(_e, _t) && this._friendlyClear();
    if (!clear) {
      this.blockedTime += dt;
      if (this.blockedTime > 1.4) {
        this.blockedTime = 0;
        if (this.cover) { this.peekSide *= -1; this.phaseTime = 0; }
        else this.moveTarget.set(a.pos.x + (Math.random() - 0.5) * 6, 0, a.pos.z + (Math.random() - 0.5) * 6);
      }
      if (a.drawTime > 3) { a.drawing = false; a.drawTime = 0; }
      return;
    }
    this.blockedTime = 0;
    this.game.combat.release(a, a.aimDir(_v));
    if (this.cover) { this.phase = 'hide'; this.phaseTime = 0; if (Math.random() < 0.4) this.peekSide *= -1; }
  }

  _friendlyClear() {
    if (!this.game.combat.friendlyFire) return true;
    const a = this.archer, t = this.target;
    const ax = a.pos.x, az = a.pos.z;
    const bx = t.pos.x - ax, bz = t.pos.z - az;
    const L2 = bx * bx + bz * bz;
    for (const m of this.game.teams[a.team]) {
      if (m === a || !m.alive) continue;
      const px = m.pos.x - ax, pz = m.pos.z - az;
      const s = (px * bx + pz * bz) / L2;
      if (s <= 0 || s >= 1) continue;
      const cx = px - bx * s, cz = pz - bz * s;
      if (cx * cx + cz * cz < 1.2) return false;
    }
    return true;
  }
}
