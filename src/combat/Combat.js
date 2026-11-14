// Shot resolution and damage rules shared by player and AI – Minecraft-style bow (see config.js).
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/utils.js';

const B = CONFIG.bow;
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
    const sameTeam = shooter && shooter.team === victim.team;
    if (sameTeam && !this.friendlyFire) return false;
    if (this.game.role === 'client') {
      // online: the server decides damage; locally the arrow only sticks and thuds
      this.game.audio.impact('body', arrow.pos, victim.isPlayer);
      return true;
    }
    const head = headshot && B.headshotMultiplier > 1;
    let dmg = Combat.impactDamage(arrow.vel.length(), arrow.crit) * (head ? B.headshotMultiplier : 1);
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
    victim.lastHitDir = arrow.dir.clone();
    if (shooter && !sameTeam) {
      shooter.stats.hits++;
      shooter.stats.damage += Math.min(dmg, dmg + Math.min(0, victim.hp));
      if (head || arrow.crit) shooter.stats.headshots++;
    }
    // knockback along the arrow's horizontal direction
    const hl = Math.hypot(arrow.vel.x, arrow.vel.z) || 1;
    const kx = (arrow.vel.x / hl) * B.knockback, kz = (arrow.vel.z / hl) * B.knockback;
    if (!victim.remote) Combat.applyKnockback(victim, kx, kz);
    this.game.health.onDamage(victim, dmg, shooter, arrow.crit);
    Combat.hitReaction(victim, kx, kz);
    this.game.audio.impact('body', arrow.pos, victim.isPlayer);
    if (shooter && shooter.isPlayer) this.game.hud.hitMarker(arrow.crit, victim.hp <= 0);
    if (victim.isPlayer) this.game.hud.damageIndicator(shooter ? shooter.pos : null);
    if (victim.ai) victim.ai.onDamaged(shooter);
    const killed = victim.hp <= 0;
    this.game.emit({ t: 'hit', v: victim.idx, s: shooter ? shooter.idx : -1, h: arrow.crit ? 1 : 0, k: killed ? 1 : 0, kb: [+kx.toFixed(2), +kz.toFixed(2)], dm: Math.round(dmg) });
    this.game.onHitFeedback(victim, shooter, Math.round(dmg), arrow.crit);
    if (killed) this.kill(victim, shooter, head);
    return true;
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

  kill(victim, killer, headshot) {
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
    if (killer && killer.team !== victim.team) killer.stats.kills++;
    this.game.emit({ t: 'kill', v: victim.idx, s: killer ? killer.idx : -1, h: headshot ? 1 : 0, d: victim.deathDir, st: victim.deathStyle });
    this.game.onKill(victim, killer, headshot);
  }
}
