// Health: natural regeneration after a quiet spell, bandages (kneel to heal over time, interrupted by
// moving, drawing, jumping or being hit), healing herbs around the map, and a log of recent hits
// for the death recap. Authoritative offline and on the server; clients only mirror the results.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { mulberry32 } from '../core/utils.js';
import { fernGeometry, addWind } from '../world/foliage.js';

const H = CONFIG.health;
const M = CONFIG.map;

export class Health {
  constructor(game, { visual = true } = {}) {
    this.game = game;
    this.herbs = [];
    this._placeHerbs();
    if (visual) this._buildHerbMeshes();
  }

  // ---------------------------------------------------------------- damage bookkeeping
  onDamage(a, dmg, shooter, crit) {
    a.lastHurt = this.game.time;
    a.regenerating = false;
    a.damageLog.push({ s: shooter ? shooter.idx : -1, dmg: Math.round(dmg), crit: !!crit, t: this.game.time });
    if (a.damageLog.length > 8) a.damageLog.shift();
    if (a.bandaging) this.stopBandage(a);
  }

  startBandage(a) {
    if (!a.alive || a.bandaging || a.bandages <= 0 || a.hp >= H.max || a.drawing || !a.onGround) return false;
    a.bandages--;
    a.bandaging = true;
    a.bandageT = 0;
    if (a.isPlayer) this.game.audio.bandage();
    return true;
  }

  stopBandage(a) { a.bandaging = false; a.bandageT = 0; }

  heal(a, amount) {
    if (!a.alive) return;
    a.hp = Math.min(H.max, a.hp + amount);
  }

  // ---------------------------------------------------------------- per-frame (offline / server)
  update(dt) {
    const g = this.game;
    for (const a of g.archers) {
      if (!a.alive) { a.bandaging = false; a.regenerating = false; continue; }
      if (a.bandaging) {
        // anything active breaks the kneel; what was healed so far is kept
        if (a.speed > 0.8 || a.drawing || !a.onGround || a.sprinting) { this.stopBandage(a); continue; }
        a.bandageT += dt;
        this.heal(a, (H.bandageHeal / H.bandageTime) * dt);
        if (a.bandageT >= H.bandageTime || a.hp >= H.max) this.stopBandage(a);
      }
      a.regenerating = !a.bandaging && a.hp < H.max && g.time - a.lastHurt > H.regenDelay;
      if (a.regenerating) this.heal(a, H.regenRate * dt);
      // herbs: walk over one while hurt to eat it
      if (a.hp < H.max) {
        for (const h of this.herbs) {
          if (!h.ready) continue;
          const dx = a.pos.x - h.x, dz = a.pos.z - h.z;
          if (dx * dx + dz * dz < 1.6) { this.takeHerb(h, a); break; }
        }
      }
    }
    for (const h of this.herbs) {
      if (!h.ready && g.time >= h.readyAt) { h.ready = true; g.emit({ t: 'herb', h: h.idx, a: 1 }); }
    }
  }

  takeHerb(h, a) {
    h.ready = false;
    h.readyAt = this.game.time + H.herbRegrow;
    this.heal(a, H.herbHeal);
    a.pickupT = 0.6;
    if (a.isPlayer) this.game.audio.heal();
    this.game.emit({ t: 'herb', h: h.idx, a: 0, i: a.idx });
  }

  resetHerbs() { for (const h of this.herbs) { h.ready = true; h.readyAt = 0; } }

  nearestHerb(pos, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const h of this.herbs) {
      if (!h.ready) continue;
      const d = (h.x - pos.x) ** 2 + (h.z - pos.z) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }

  // ---------------------------------------------------------------- herbs: placement and looks
  _placeHerbs() {
    const g = this.game;
    const rand = mulberry32(M.seed + 4242);
    const spots = [];
    for (let i = 0; i < H.herbsField; i++) {
      const a = (i / H.herbsField) * Math.PI * 2 + 0.6, r = 18 + rand() * 12;
      spots.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    for (let i = 0, tries = 0; i < H.herbsForest && tries < 400; tries++) {
      const a = rand() * Math.PI * 2, r = M.fieldRadius + 12 + rand() * 70;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) > M.size / 2 - 10 || Math.abs(z) > M.size / 2 - 10 || Math.abs(x) > 95) continue; // keep out of spawns
      const p = new THREE.Vector3(x, 0, z);
      g.forest.collideCircle(p, 0.8, g.terrain.height(x, z));
      spots.push([p.x, p.z]);
      i++;
    }
    this.herbs = spots.map(([x, z], idx) => ({ idx, x, z, y: g.terrain.height(x, z), ready: true, readyAt: 0, grow: 1 }));
  }

  _buildHerbMeshes() {
    const leafMat = addWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, color: 0x6fbf4a }), { amp: 0.08, twoSided: true, uniforms: this.game.terrain.grassUniforms });
    this.berryMat = new THREE.MeshLambertMaterial({ color: 0xff3b5c, emissive: 0xff2244, emissiveIntensity: 0.6 });
    const leafGeo = fernGeometry(mulberry32(7));
    const berryGeo = new THREE.IcosahedronGeometry(0.06, 1);
    const rand = mulberry32(99);
    for (const h of this.herbs) {
      const grp = new THREE.Group();
      const leaves = new THREE.Mesh(leafGeo, leafMat);
      leaves.scale.setScalar(0.75);
      grp.add(leaves);
      for (let k = 0; k < 6; k++) {
        const b = new THREE.Mesh(berryGeo, this.berryMat);
        const a = rand() * Math.PI * 2, r = 0.05 + rand() * 0.18;
        b.position.set(Math.cos(a) * r, 0.22 + rand() * 0.12, Math.sin(a) * r);
        grp.add(b);
      }
      // a soft glow on the ground so herbs can be spotted
      const glow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: 0xff6b8a, transparent: true, opacity: 0.18, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.05;
      grp.add(glow);
      grp.position.set(h.x, h.y, h.z);
      this.game.scene.add(grp);
      h.mesh = grp;
    }
  }

  // Visual update (all roles): regrowth and a gentle pulse.
  animate(dt) {
    if (this.berryMat) this.berryMat.emissiveIntensity = 0.45 + Math.sin(this.game.time * 3) * 0.25;
    for (const h of this.herbs) {
      if (!h.mesh) continue;
      const target = h.ready ? 1 : 0.15;
      h.grow += (target - h.grow) * Math.min(1, dt * (h.ready ? 2 : 8));
      h.mesh.scale.setScalar(h.grow);
      h.mesh.children[h.mesh.children.length - 1].visible = h.ready;
    }
  }
}
