// Screen-space overlay for things that belong to the 3D world: health bars over heads (teammates,
// and enemies you've hit recently) and floating damage numbers. Drawn on one transparent 2D canvas.
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { clamp } from '../core/utils.js';

const H = CONFIG.health;
const _p = new THREE.Vector3();

export class WorldOverlay {
  constructor(game) {
    this.game = game;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'worldOverlay';
    document.getElementById('hud').prepend(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.numbers = [];
    this._resize();
    window.addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  damageNumber(victim, dmg, crit) {
    if (!dmg) return;
    this.numbers.push({
      x: victim.pos.x + (Math.random() - 0.5) * 0.4, y: victim.pos.y + victim.height + 0.15, z: victim.pos.z + (Math.random() - 0.5) * 0.4,
      text: crit ? `${dmg}!` : `${dmg}`, crit, t: 0,
    });
    if (this.numbers.length > 40) this.numbers.shift();
  }

  _project(x, y, z) {
    _p.set(x, y, z).project(this.game.camera);
    if (_p.z > 1 || _p.z < -1) return null;
    return [(_p.x * 0.5 + 0.5) * this.canvas.width, (-_p.y * 0.5 + 0.5) * this.canvas.height];
  }

  update(dt) {
    const g = this.game, ctx = this.ctx, dpr = this.dpr;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (g.state !== 'playing' && g.state !== 'roundEnd') { this.numbers.length = 0; return; }
    const me = g.me, cam = g.camera.position;

    // health bars over heads
    ctx.textAlign = 'center';
    const showBars = !g.settings || g.settings.healthBars !== false;
    for (const a of showBars ? g.archers : []) {
      if (!a.alive || a === me) continue;
      if (!a.active) continue;
      const ally = !g.ffa && a.team === me.team;
      const d = cam.distanceTo(a.pos);
      const recent = g.time - (a.lastHitByMe ?? -99) < 6;
      const friend = g.isFriend(a);
      const bar = ally ? d <= 40 : recent && d < 100;
      if (!bar && !(friend && d < 60)) continue;
      const sp = this._project(a.pos.x, a.pos.y + a.height + 0.45, a.pos.z);
      if (!sp) continue;
      const w = clamp(70 - d * 0.7, 34, 70) * dpr, h = 6 * dpr;
      const x = sp[0] - w / 2, y = sp[1];
      const f = clamp(a.hp / H.max, 0, 1);
      if (!bar) {
        // a friend on the other side: just their name and a heart
        ctx.globalAlpha = clamp(1.5 - d / 60, 0.4, 1);
        ctx.font = `${12 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = '#ff8fc2';
        ctx.fillText(`♥ ${a.name}`, sp[0], y);
        continue;
      }
      ctx.globalAlpha = ally ? clamp(1.4 - d / 40, 0.35, 1) : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - dpr, y - dpr, w + 2 * dpr, h + 2 * dpr);
      ctx.fillStyle = f > 0.6 ? '#5fd35a' : f > 0.3 ? '#f2c94c' : '#ff5a45';
      if (!ally) ctx.fillStyle = '#ff5a45';
      ctx.fillRect(x, y, w * f, h);
      if (a.regenerating || a.bandaging) { ctx.fillStyle = 'rgba(160,255,170,0.55)'; ctx.fillRect(x, y, w * f, h / 3); }
      if ((ally && d < 25) || friend) {
        ctx.font = `${11 * dpr}px system-ui, sans-serif`;
        ctx.fillStyle = friend ? '#ff8fc2' : '#f3efe4';
        ctx.fillText((friend ? '♥ ' : a.human ? '★ ' : '') + a.name + (a.bandaging ? ' ✚' : ''), sp[0], y - 4 * dpr);
      }
    }
    ctx.globalAlpha = 1;

    // floating damage numbers
    for (let k = this.numbers.length - 1; k >= 0; k--) {
      const n = this.numbers[k];
      n.t += dt;
      if (n.t > 1.1) { this.numbers.splice(k, 1); continue; }
      const sp = this._project(n.x, n.y + n.t * 0.9, n.z);
      if (!sp) continue;
      const pop = n.t < 0.12 ? 1 + (0.12 - n.t) * 4 : 1;
      ctx.globalAlpha = clamp(1.6 - n.t * 1.5, 0, 1);
      ctx.font = `${(n.crit ? 22 : 17) * pop * dpr}px Georgia, serif`;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(n.text, sp[0], sp[1]);
      ctx.fillStyle = n.crit ? '#bfe6ff' : '#ffe9a8';
      ctx.fillText(n.text, sp[0], sp[1]);
    }
    ctx.globalAlpha = 1;
  }
}
