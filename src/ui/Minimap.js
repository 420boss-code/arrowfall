// Heading-up circular minimap. The terrain/forest layer is pre-rendered once; only dots are drawn per frame.
import { CONFIG } from '../config.js';

const PX_PER_M = 2;
const VIEW_M = 130; // metres across the minimap

export class Minimap {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.timer = 0;
    this._prerender();
  }

  _prerender() {
    const size = CONFIG.map.size * PX_PER_M;
    const bg = document.createElement('canvas');
    bg.width = bg.height = size;
    const c = bg.getContext('2d');
    c.fillStyle = '#26381f';
    c.fillRect(0, 0, size, size);
    const half = CONFIG.map.size / 2;
    c.fillStyle = '#7fa651';
    c.beginPath();
    c.arc(size / 2, size / 2, CONFIG.map.fieldRadius * PX_PER_M, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(18, 40, 14, 0.9)';
    for (const t of this.game.forest.trees) {
      c.beginPath();
      c.arc((t.x + half) * PX_PER_M, (t.z + half) * PX_PER_M, Math.max(1.2, t.canopyW * 0.35 * PX_PER_M), 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#9a9a92';
    for (const r of this.game.forest.fieldRocks) {
      c.beginPath(); c.arc((r.x + half) * PX_PER_M, (r.z + half) * PX_PER_M, r.s * 1.2 * PX_PER_M, 0, Math.PI * 2); c.fill();
    }
    c.strokeStyle = '#6b4d33'; c.lineWidth = 3;
    for (const l of this.game.forest.logs) {
      const dx = Math.cos(l.ang) * l.len / 2, dz = Math.sin(l.ang) * l.len / 2;
      c.beginPath();
      c.moveTo((l.x - dx + half) * PX_PER_M, (l.z - dz + half) * PX_PER_M);
      c.lineTo((l.x + dx + half) * PX_PER_M, (l.z + dz + half) * PX_PER_M);
      c.stroke();
    }
    this.bg = bg;
  }

  update(dt) {
    // 30 Hz is plenty for a minimap
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / 30;
    const g = this.game;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const scale = W / VIEW_M;
    const me = g.player.archer;
    const focus = me.alive || !g.player.spectating ? me : g.player.spectating;
    const half = CONFIG.map.size / 2;
    const yaw = me.alive ? me.yaw : g.player.specYaw;
    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath(); ctx.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); ctx.clip();
    ctx.translate(W / 2, W / 2);
    // heading-up: rotate so the facing direction (-Z at yaw 0) points to the top
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-focus.pos.x, -focus.pos.z);
    ctx.drawImage(this.bg, -half, -half, CONFIG.map.size, CONFIG.map.size);
    if (g.mode === 'kotf') {
      ctx.strokeStyle = g.zoneColour(); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, CONFIG.rules.kotfZoneRadius, 0, Math.PI * 2); ctx.stroke();
    }
    const dot = (x, z, col, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, z, r, 0, Math.PI * 2); ctx.fill(); };
    const myTeam = me.team;
    for (const a of g.archers) {
      if (a === me) continue;
      if (a.team === myTeam) {
        const c = myTeam === 'blue' ? '90,160,255' : '255,110,90';
        dot(a.pos.x, a.pos.z, `rgba(${c},${a.alive ? 1 : 0.35})`, a.human ? 1.9 : 1.4);
      } else if (a.alive && g.isSpotted(a, myTeam)) {
        dot(a.pos.x, a.pos.z, myTeam === 'blue' ? '#ff4a3a' : '#4a8fff', 1.5);
      }
    }
    ctx.restore();
    // player marker (always centre, pointing up)
    ctx.fillStyle = me.alive ? '#ffffff' : '#888';
    ctx.beginPath();
    ctx.moveTo(W / 2, W / 2 - 7); ctx.lineTo(W / 2 - 5, W / 2 + 5); ctx.lineTo(W / 2 + 5, W / 2 + 5);
    ctx.closePath(); ctx.fill();
  }
}
