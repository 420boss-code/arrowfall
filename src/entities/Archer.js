// Shared archer state and movement physics, used by both the player and the AI.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp, lerp } from '../core/utils.js';

const A = CONFIG.archer;
const H = CONFIG.health;
const B = CONFIG.bow;
let NEXT_ID = 0;

export class Archer {
  constructor(team, name, isPlayer = false) {
    this.id = NEXT_ID++;
    this.team = team;           // 'red' | 'blue'
    this.name = name;
    this.isPlayer = isPlayer;
    this.botName = name;   // restored when a human leaves the slot
    this.idx = -1;         // stable index in game.archers, used on the wire
    this.remote = false;   // server side: controlled by a connected human
    this.human = false;    // shown in the scoreboard
    this.epoch = 0;        // bumped whenever the server forcibly repositions this archer
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.moveDir = new THREE.Vector2(); // desired XZ direction (world), length 0..1
    this.yaw = 0;               // facing; 0 looks toward -Z
    this.pitch = 0;             // aim pitch (radians, +up)
    this.stats = { kills: 0, deaths: 0, shots: 0, hits: 0, damage: 0, headshots: 0 };
    this.lastAttacker = null;
    this.reset(new THREE.Vector3());
  }

  reset(spawn) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.hp = H.max;
    this.bandages = H.bandages;
    this.bandaging = false;
    this.bandageT = 0;
    this.lastHurt = -99;       // game time of the last damage taken (regeneration waits after it)
    this.regenerating = false;
    this.damageLog = [];       // recent hits taken: { s: shooter idx, dmg, crit, t }
    // animation state
    this.hitReactT = 0; this.hitDirX = 0; this.hitDirZ = 0;
    this.landT = 0;
    this.pickupT = 0;
    this.cheer = false;
    this.deathStyle = 0;
    this.arrows = A.quiver;
    this.stamina = A.stamina;
    this.alive = true;
    this.deathTime = 0;
    this.onGround = true;
    this.crouching = false;
    this.sprinting = false;
    this.drawing = false;
    this.drawTime = 0;          // seconds held
    this.fullDrawHeld = 0;      // seconds held at full draw (for sway)
    this.releaseTimer = 9;      // seconds since last release (animation + cooldown); none yet
    this.stabT = 0;             // knife: time left in the stab animation
    this.stabCooldown = 0;
    this.stabPending = false;   // the blade has not landed yet (offline / server)
    this.speed = 0;
    this.animPhase = 0;
    this.hitFlash = 0;
    this.lastHitBy = null;
    this.noise = 0;             // how loud the archer currently is (for AI hearing)
    this.respawnAt = 0;
    this.deathYaw = 0;
    this.iframeUntil = 0;       // damage immunity window after a hit
    this.lastDamage = 0;
  }

  get drawFrac() { return clamp(this.drawTime / B.fullDrawTime, 0, 1); }
  get eyeHeight() { return this.bandaging ? 1.0 : this.crouching ? 1.1 : 1.62; }
  get height() { return this.crouching || this.bandaging ? A.crouchHeight : A.height; }

  headPos(out) {
    return out.set(this.pos.x, this.pos.y + this.height - 0.14, this.pos.z);
  }

  eyePos(out) {
    return out.set(this.pos.x, this.pos.y + this.eyeHeight, this.pos.z);
  }

  // World-space position of the arrow nock (roughly in front of the chest).
  bowPos(out) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const h = this.crouching ? 1.08 : 1.45;
    return out.set(this.pos.x - s * 0.35 + c * 0.05, this.pos.y + h, this.pos.z - c * 0.35 - s * 0.05);
  }

  aimDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // Integrate movement against terrain, obstacles and map bounds.
  physics(dt, world) {
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.tickAnim(dt);
    if (!this.alive) {
      // corpses settle onto the terrain
      this.pos.y = world.terrain.height(this.pos.x, this.pos.z);
      return;
    }
    let target = this.crouching ? A.crouchSpeed : this.sprinting ? A.runSpeed : A.walkSpeed;
    if (this.drawing) target *= A.drawMoveFactor;
    if (this.hp < H.limpBelow) target *= H.limpSpeed;       // wounded archers limp
    if (this.bandaging) target *= 0.25;                     // kneeling: moving off interrupts it
    const mx = this.moveDir.x, mz = this.moveDir.y;
    const mlen = Math.min(1, Math.hypot(mx, mz));
    const accel = this.onGround ? 14 : 3;
    const tvx = mlen > 0.01 ? (mx / Math.hypot(mx, mz)) * target * mlen : 0;
    const tvz = mlen > 0.01 ? (mz / Math.hypot(mx, mz)) * target * mlen : 0;
    const k = clamp(accel * dt, 0, 1);
    this.vel.x = lerp(this.vel.x, tvx, k);
    this.vel.z = lerp(this.vel.z, tvz, k);
    this.vel.y -= A.gravity * dt;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;

    world.forest.collideCircle(this.pos, A.radius, this.pos.y);
    const lim = CONFIG.map.size / 2 - CONFIG.map.boundaryMargin;
    this.pos.x = clamp(this.pos.x, -lim, lim);
    this.pos.z = clamp(this.pos.z, -lim, lim);

    const g = world.terrain.height(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      if (!this.onGround && this.vel.y < -4) this.landT = 0.28; // landing squash
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > g + 0.05) {
      this.onGround = false;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // stamina
    if (this.sprinting && this.speed > 1) {
      this.stamina = Math.max(0, this.stamina - A.staminaDrain * dt);
      if (this.stamina <= 0) this.sprinting = false;
    } else {
      this.stamina = Math.min(A.stamina, this.stamina + A.staminaRegen * dt * (this.speed < 0.5 ? 1.4 : 1));
    }
    // noise level for AI hearing: crouching is quiet, sprinting loud
    this.noise = this.speed < 0.3 ? 0 : this.crouching ? 0.3 : this.sprinting ? 1.4 : 1;
    this.releaseTimer += dt;
  }

  // Count down animation timers (all roles).
  tickAnim(dt) {
    if (this.hitReactT > 0) this.hitReactT -= dt;
    if (this.landT > 0) this.landT -= dt;
    if (this.pickupT > 0) this.pickupT -= dt;
    if (this.stabT > 0) this.stabT = Math.max(0, this.stabT - dt);
    if (this.stabCooldown > 0) this.stabCooldown -= dt;
  }

  // Server-side tick for a human-controlled archer: position comes from the client.
  remoteTick(dt, world) {
    this.tickAnim(dt);
    if (this.hitFlash > 0) this.hitFlash -= dt;
    this.releaseTimer += dt;
    if (!this.alive) this.pos.y = world.terrain.height(this.pos.x, this.pos.z);
  }

  jump() {
    if (!this.alive || !this.onGround || this.stamina < A.staminaJumpCost * 0.5) return false;
    this.vel.y = A.jumpVelocity;
    this.onGround = false;
    this.stamina = Math.max(0, this.stamina - A.staminaJumpCost);
    return true;
  }

  // Current inaccuracy cone in degrees.
  // Crosshair size in degrees. Minecraft's bow has the same small inaccuracy whatever you're doing.
  spread() { return B.crosshairSpread; }

  // Sway amplitude (degrees) after holding full draw too long
  swayAmount() {
    if (this.fullDrawHeld <= B.swayDelay) return 0;
    return clamp((this.fullDrawHeld - B.swayDelay) / B.swayRamp, 0, 1) * B.swayMax;
  }

  canDraw() {
    return this.alive && this.arrows > 0 && this.releaseTimer > B.releaseCooldown && this.stabT <= 0;
  }

  updateDraw(dt) {
    if (!this.drawing) { this.fullDrawHeld = 0; return; }
    this.drawTime += dt;
    if (this.drawTime >= B.fullDrawTime) this.fullDrawHeld += dt;
  }
}
