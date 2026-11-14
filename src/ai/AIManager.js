// Squads, routes and time-sliced AI updates so 39 bots never think on the same frame.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { AIController } from './AIController.js';

const AIC = CONFIG.ai;
const FR = CONFIG.map.fieldRadius;

class Squad {
  constructor(team, members, index, aggression, mode) {
    this.team = team;
    this.members = members;
    this.index = index;
    this.side = team === 'red' ? -1 : 1;
    this.lastKnown = null;
    this.lastKnownTime = -99;
    this.alertUntil = 0;
    this.regrouping = false;
    this.regroupStart = 0;
    this.hurry = false;
    this.plan(aggression, mode);
  }

  leader() { return this.members.find((m) => m.alive && !m.remote) || null; }

  plan(aggression, mode) {
    const s = this.side;
    const wps = [];
    this.wpIndex = 0;
    if (mode === 'kotf') {
      const a = Math.random() * Math.PI * 2;
      wps.push({ x: s * (FR + 12), z: (Math.random() - 0.5) * 30, regroup: true });
      wps.push({ x: Math.cos(a) * 5, z: Math.sin(a) * 5, cross: true });
      this.waypoints = wps;
      this.holdAtEnd = true;
      return;
    }
    // cautious squads skirt round the field in the forest; bold ones cross in a group
    const cross = Math.random() < aggression * 0.6;
    if (cross) {
      const z = (Math.random() - 0.5) * 30;
      wps.push({ x: s * (FR + 9), z, regroup: true });
      wps.push({ x: s * 4, z: z * 0.4, cross: true });
      wps.push({ x: -s * (FR + 10), z: -z * 0.3, cross: true });
      wps.push({ x: -s * 85, z: (Math.random() - 0.5) * 40 });
      wps.push({ x: -s * 115, z: (Math.random() - 0.5) * 30 });
    } else {
      const zs = this.index % 2 === 0 ? 1 : -1;
      wps.push({ x: s * 75, z: zs * (30 + Math.random() * 15) });
      wps.push({ x: s * 30, z: zs * (FR + 18 + Math.random() * 10) });
      wps.push({ x: -s * 30, z: zs * (FR + 18 + Math.random() * 10) });
      wps.push({ x: -s * 80, z: zs * (25 + Math.random() * 15) });
      wps.push({ x: -s * 115, z: (Math.random() - 0.5) * 30 });
    }
    this.waypoints = wps;
    this.holdAtEnd = false;
  }

  currentWaypoint() { return this.waypoints[Math.min(this.wpIndex, this.waypoints.length - 1)]; }

  report(enemy, time) {
    if (!this.lastKnown) this.lastKnown = new THREE.Vector3();
    this.lastKnown.copy(enemy.pos);
    this.lastKnownTime = time;
    this.alertUntil = time + 8;
  }

  update(time, game) {
    const L = this.leader();
    if (!L) return;
    const wp = this.currentWaypoint();
    // regroup at the forest edge before crossing open ground
    if (wp.regroup && Math.hypot(L.pos.x - wp.x, L.pos.z - wp.z) < 8) {
      if (!this.regrouping) { this.regrouping = true; this.regroupStart = time; }
      const allIn = this.members.every((m) => !m.alive || m.pos.distanceTo(L.pos) < 12);
      if (allIn || time - this.regroupStart > 9) { this.regrouping = false; this.wpIndex++; }
      return;
    }
    if (Math.hypot(L.pos.x - wp.x, L.pos.z - wp.z) < 7) {
      if (this.wpIndex < this.waypoints.length - 1) this.wpIndex++;
      else if (!this.holdAtEnd) {
        // route finished: hunt toward a known or random enemy position
        const e = game.randomAliveEnemy(this.team);
        if (e) this.waypoints.push({ x: e.pos.x, z: e.pos.z }), this.wpIndex++;
      }
    }
    this.hurry = time > 100;
  }
}

export class AIManager {
  constructor(game) {
    this.game = game;
    this.bots = [];
    this.squads = [];
    this.cursor = 0;
    this.thinksThisFrame = 0;
  }

  setup(teams, difficultyName, mode) {
    const diff = AIC.difficulties[difficultyName];
    this.diff = diff;
    this.bots = [];
    this.squads = [];
    for (const team of ['red', 'blue']) for (const a of teams[team]) a.ai = null;
    for (const team of ['red', 'blue']) {
      const members = teams[team].filter((a) => !a.isPlayer);
      let idx = 0;
      for (let i = 0; i < members.length; i += AIC.squadSize) {
        const group = members.slice(i, i + AIC.squadSize);
        const sq = new Squad(team, group, idx++, diff.aggression, mode);
        this.squads.push(sq);
        for (const m of group) this.bots.push(new AIController(this.game, m, sq, diff));
      }
    }
  }

  newRound(mode) {
    for (const sq of this.squads) {
      sq.plan(this.diff.aggression, mode);
      sq.lastKnown = null; sq.regrouping = false; sq.alertUntil = 0;
    }
    for (const b of this.bots) b.reset();
  }

  update(dt) {
    const time = this.game.time;
    for (const sq of this.squads) sq.update(time, this.game);
    // Time-slicing: each frame at most N bots run their expensive think(); others only act().
    const n = this.bots.length;
    let budget = AIC.thinkBudgetPerFrame;
    this.thinksThisFrame = 0;
    for (let k = 0; k < n && budget > 0; k++) {
      const b = this.bots[(this.cursor + k) % n];
      if (b.archer.alive && !b.archer.remote && time >= b.nextThink) {
        b.think();
        b.nextThink = time + this.diff.thinkInterval * (0.85 + Math.random() * 0.3);
        budget--;
        this.thinksThisFrame++;
      }
    }
    this.cursor = (this.cursor + AIC.thinkBudgetPerFrame) % Math.max(1, n);
    for (const b of this.bots) if (!b.archer.remote) b.act(dt);
  }
}
