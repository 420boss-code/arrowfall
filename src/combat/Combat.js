// Shot resolution and damage rules shared by player and AI – Minecraft-style bow (see config.js).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/utils.js';

const B = CONFIG.bow;
const K = CONFIG.knife;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();

// Standard normal sample (Box–Muller)
function gaussian() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.friendlyFire = CONFIG.rules.friendlyFire;
  }

  // Draw fraction f (0..1, time held / full draw time) → power, as Minecraft: (f² + 2f) / 3
  static power(f) {
    f = clamp(f, 0, 1);
    return Math.min(1, (f * f + 2 * f) / 3);
  }

  static speedFor(f) { return Combat.power(f) * B.fullSpeed; }

  // Damage from impact speed (m/s): ceil(base × blocks per tick); critical arrows add a random bonus.
  static impactDamage(speed, crit) {
    let d = Math.ceil(B.baseDamage * (speed / 20) - 1e-9);
    if (crit) d += Math.floor(Math.random() * (Math.floor(d / 2) + 2));
    return d * B.hpScale;
  }

  // Release an arrow from archer in direction dir (unit vector).
  release(archer, dir) {
    const power = Combat.power(archer.drawFrac);
    archer.drawing = false;
    archer.drawTime = 0;
    archer.fullDrawHeld = 0;
    if (power < B.minPower || archer.arrows <= 0 || !archer.alive) return null;
    archer.arrows--;
    archer.releaseTimer = 0;
    archer.stats.shots++;
    // Minecraft-style inaccuracy: a little gaussian jitter on each component, then scale by speed
    _d.copy(dir).normalize();
    _d.x += gaussian() * B.inaccuracy;
    _d.y += gaussian() * B.inaccuracy;
    _d.z += gaussian() * B.inaccuracy;
    const vel = _d.multiplyScalar(power * B.fullSpeed);
    // arrows inherit the shooter's movement (vertical only while airborne)
    vel.x += archer.vel.x;
    vel.z += archer.vel.z;
    if (!archer.onGround) vel.y += archer.vel.y;
    const crit = power >= 1;
    archer.bowPos(_o);
    const arrow = this.game.projectiles.fire(archer, _o, vel, 0, crit);
    this.game.audio.release(archer.pos, power, archer.isPlayer);
    this.game.onShot(archer, _o, vel, crit);
    return arrow;
  }

  // Called by projectiles when an arrow meets an archer.
  // Returns true (arrow sticks), false (passes through) or 'deflect' (bounces off).
  onArrowHit(arrow, victim, headshot) {
    const shooter = arrow.owner;
    if (!victim.alive) return true;
    const sameTeam = shooter && !this.game.isEnemy(shooter, victim);
    if (sameTeam && !this.friendlyFire) return false;
    if (this.game.role === 'client') {
      // online: the server decides damage; locally the arrow only sticks and thuds
      this.game.audio.impact('body', arrow.pos, victim.isPlayer);
      return true;
    }
    const head = headshot && B.headshotMultiplier > 1;
    const dmg = Combat.impactDamage(arrow.vel.length(), arrow.crit) * (head ? B.headshotMultiplier : 1);
    const hl = Math.hypot(arrow.vel.x, arrow.vel.z) || 1;
    return this.dealDamage(victim, shooter, dmg, {
      crit: arrow.crit, head, dir: arrow.dir, kx: arrow.vel.x / hl, kz: arrow.vel.z / hl, knock: B.knockback, at: arrow.pos,
    });
  }

  // Shared by arrows and the knife (offline / server only). Applies invulnerability frames, knockback,
  // feedback and the kill. Returns true, or 'deflect' when the hit was absorbed by the iframes.
  dealDamage(victim, shooter, dmg, { crit = false, head = false, dir, kx, kz, knock, at, weapon = 'bow' }) {
    const sameTeam = shooter && !this.game.isEnemy(shooter, victim);
    // invulnerability frames: during the window only a harder hit counts, and only the difference
    const now = this.game.time;
    if (now < victim.iframeUntil) {
      if (dmg <= victim.lastDamage) return 'deflect';
      const extra = dmg - victim.lastDamage;
      victim.lastDamage = dmg;
      dmg = extra;
    } else {
      victim.iframeUntil = now + B.iframes;
      victim.lastDamage = dmg;
    }
    victim.hp -= dmg;
    victim.hitFlash = 0.15;
    victim.lastHitBy = shooter;
    victim.lastHitDir = dir.clone();
    if (shooter && !sameTeam) {
      shooter.stats.hits++;
      shooter.stats.damage += Math.min(dmg, dmg + Math.min(0, victim.hp));
      if (head || crit) shooter.stats.headshots++;
    }
    const bx = kx * knock, bz = kz * knock;
    if (!victim.remote) Combat.applyKnockback(victim, bx, bz);
    this.game.health.onDamage(victim, dmg, shooter, crit);
    Combat.hitReaction(victim, bx, bz);
    this.game.audio.impact(weapon === 'knife' ? 'stab' : 'body', at, victim.isPlayer);
    if (shooter && shooter.isPlayer) this.game.hud.hitMarker(crit, victim.hp <= 0);
    if (victim.isPlayer) this.game.hud.damageIndicator(shooter ? shooter.pos : null);
    if (victim.ai) victim.ai.onDamaged(shooter);
    const killed = victim.hp <= 0;
    this.game.emit({ t: 'hit', v: victim.idx, s: shooter ? shooter.idx : -1, h: crit ? 1 : 0, k: killed ? 1 : 0, kb: [+bx.toFixed(2), +bz.toFixed(2)], dm: Math.round(dmg), ...(weapon === 'knife' ? { w: 'k' } : {}) });
    this.game.onHitFeedback(victim, shooter, Math.round(dmg), crit);
    if (killed) this.kill(victim, shooter, head, weapon);
    return true;
  }

  // ---------------------------------------------------------------- knife
  // Start a stab (all roles animate it; only offline / server resolve the hit, a moment later).
  stab(a) {
    if (!a.alive || a.stabCooldown > 0 || a.bandaging) return false;
    a.stabT = K.time;
    a.stabCooldown = K.cooldown * a.mods.knifeCd;
    a.stabPending = this.game.role !== 'client';
    if (a.drawing) { a.drawing = false; a.drawTime = 0; a.fullDrawHeld = 0; if (a.isPlayer) this.game.audio.stopDraw(); }
    this.game.audio.swish(a.pos, a.isPlayer);
    this.game.emit({ t: 'stab', i: a.idx });
    return true;
  }

  // The archer this stab would land on: the nearest rival within reach and inside the arc in front.
  stabTarget(a) {
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    const cosArc = Math.cos((K.arc * Math.PI) / 180);
    let best = null, bd = K.reach;
    for (const v of this.game.archers) {
      if (v === a || !v.alive || v.active === false) continue;
      if (!this.game.isEnemy(a, v) && !this.friendlyFire) continue;
      const dx = v.pos.x - a.pos.x, dz = v.pos.z - a.pos.z, dy = v.pos.y - a.pos.y;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(dy) > 1.4) continue;
      if (d > 0.3 && (dx * fx + dz * fz) / d < cosArc) continue;
      best = v; bd = d;
    }
    return best;
  }

  // Resolve stabs whose blade has reached its target (offline / server).
  updateMelee() {
    for (const a of this.game.archers) {
      if (!a.stabPending || K.time - a.stabT < K.hitAt) continue;
      a.stabPending = false;
      if (!a.alive) continue;
      const v = this.stabTarget(a);
      if (!v) continue;
      // from behind: the victim is facing away from the attacker
      const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z, l = Math.hypot(dx, dz) || 1;
      const vfx = -Math.sin(v.yaw), vfz = -Math.cos(v.yaw);
      const behind = (dx * vfx + dz * vfz) / l < -0.35;
      const dir = _d.set(-dx / l, 0, -dz / l);
      _o.set(v.pos.x, v.pos.y + 1.2, v.pos.z);
      this.dealDamage(v, a, K.damage * (behind ? K.backstab : 1), { crit: behind, dir, kx: dir.x, kz: dir.z, knock: K.knockback, at: _o, weapon: 'knife' });
    }
  }

  // Flinch in the direction the arrow was travelling.
  static hitReaction(a, kx, kz) {
    const l = Math.hypot(kx, kz) || 1;
    a.hitReactT = 0.35;
    a.hitDirX = kx / l;
    a.hitDirZ = kz / l;
  }

  static applyKnockback(a, kx, kz) {
    if (!a.alive) return;
    a.vel.x = a.vel.x * 0.5 + kx;
    a.vel.z = a.vel.z * 0.5 + kz;
    a.vel.y = Math.min(a.vel.y * 0.5 + B.knockbackUp, B.knockbackUp);
    a.onGround = false;
  }

  kill(victim, killer, headshot, weapon = 'bow') {
    victim.hp = 0;
    victim.alive = false;
    victim.drawing = false;
    victim.deathTime = 0;
    victim.bandaging = false;
    victim.deathStyle = Math.floor(Math.random() * 4); // back/forward fall, sideways, crumple, spin
    victim.stats.deaths++;
    // fall away from the arrow
    const d = victim.lastHitDir;
    if (d) {
      const fx = -Math.sin(victim.yaw), fz = -Math.cos(victim.yaw);
      victim.deathDir = (d.x * fx + d.z * fz) < 0 ? 1 : -1;
    } else victim.deathDir = 1;
    if (killer && this.game.isEnemy(killer, victim)) killer.stats.kills++;
    this.game.emit({ t: 'kill', v: victim.idx, s: killer ? killer.idx : -1, h: headshot ? 1 : 0, d: victim.deathDir, st: victim.deathStyle, ...(weapon === 'knife' ? { w: 'k' } : {}) });
    this.game.onKill(victim, killer, headshot, weapon);
  }
}
