// In-game HUD: crosshair, draw meter, vitals, ammo, team counts, kill feed, hit/damage feedback,
// scoreboard and performance overlay. DOM writes are cached to avoid layout churn.
import { CONFIG } from '../config.js';
import { clamp, escapeHtml } from '../core/utils.js';
import { Combat } from '../combat/Combat.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = {
      hud: $('hud'), round: $('roundInfo'), feed: $('killfeed'),
      ch: $('crosshair'), chT: document.querySelector('#crosshair .t'), chB: document.querySelector('#crosshair .b'),
      chL: document.querySelector('#crosshair .l'), chR: document.querySelector('#crosshair .r'),
      hit: $('hitmarker'), meter: $('drawMeter'), fill: $('drawFill'), prompt: $('prompt'), centre: $('centreMsg'),
      vignette: $('damageVignette'), dmgArrow: $('dmgArrow'), hp: $('hpFill'), hpText: $('hpText'), sta: $('staFill'),
      ammo: $('ammo'), counts: $('teamCounts'), stance: $('stance'), drawLabel: $('drawLabel'), hpChip: $('hpChip'), bandagePrompt: $('bandagePrompt'), bandageBar: $('bandageBar'), bandageFill: $('bandageFill'), recap: $('deathRecap'), arrows: $('arrowCount'), perf: $('perf'), scoreboard: $('scoreboard'),
    };
    this.cache = {};
    this.hitTimer = 0;
    this.centreTimer = 0;
    this.dmgTimer = 0;
    this.dmgFrom = null;
    this.showPerf = false;
  }

  _set(key, el, prop, val) {
    if (this.cache[key] === val) return;
    this.cache[key] = val;
    if (prop === 'text') el.textContent = val;
    else if (prop === 'html') el.innerHTML = val;
    else el.style[prop] = val;
  }

  show(on) { this.el.hud.classList.toggle('hidden', !on); }

  centre(msg, seconds = 2.5) {
    this.el.centre.innerHTML = msg;
    this.centreTimer = seconds;
  }

  killFeed(killer, victim, headshot, weapon = 'bow') {
    const div = document.createElement('div');
    const name = (a) => `<span class="${a.team}${a.isPlayer ? ' you' : ''}">${a.isPlayer ? 'You' : escapeHtml(a.name)}</span>`;
    div.innerHTML = killer && killer !== victim
      ? `${name(killer)} ${weapon === 'knife' ? '🗡' : headshot ? '🎯' : '➶'} ${name(victim)}`
      : `${name(victim)} fell`;
    this.el.feed.prepend(div);
    while (this.el.feed.children.length > 6) this.el.feed.lastChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  clearFeed() { this.el.feed.innerHTML = ''; }

  hitMarker(headshot, kill) {
    const h = this.el.hit;
    h.className = 'show' + (headshot ? ' head' : '') + (kill ? ' kill' : '');
    this.hitTimer = 0.12;
    this.game.audio.hitTick(headshot);
  }

  damageIndicator(fromPos) {
    this.dmgTimer = 0.6;
    this.dmgFrom = fromPos ? fromPos.clone() : null;
  }

  update(dt) {
    const g = this.game;
    const p = g.player.archer;
    // team counts (or survivors in a free-for-all)
    const counts = g.ffa
      ? `<span>Alive <b>${g.aliveCount()}</b> of ${g.activeCount()}</span>`
      : `<span class="blue">Blue <b>${g.aliveCount('blue')}</b></span> – <span class="red">Red <b>${g.aliveCount('red')}</b></span>`;
    this._set('counts', this.el.counts, 'html', counts);
    this._set('round', this.el.round, 'html', g.roundInfoText());

    // crosshair spread
    const visible = p.alive && !g.roundOver;
    this._set('chvis', this.el.ch, 'display', visible ? 'block' : 'none');
    if (visible) {
      const spreadDeg = p.spread() + p.swayAmount() * 0.6;
      const fov = g.camera.fov;
      const px = Math.tan((spreadDeg * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360) * (window.innerHeight / 2);
      const gap = Math.round(clamp(px, 3, 80));
      this._set('gap', this.el.chT, 'top', `${-gap - 9}px`);
      this._set('gapb', this.el.chB, 'top', `${gap}px`);
      this._set('gapl', this.el.chL, 'left', `${-gap - 9}px`);
      this._set('gapr', this.el.chR, 'left', `${gap}px`);
    }
    // draw meter
    const drawing = p.alive && p.drawing;
    this.el.meter.classList.toggle('on', drawing);
    if (drawing) {
      const f = Combat.power(p.drawFrac);
      this._set('draw', this.el.fill, 'width', `${Math.round(f * 100)}%`);
      const cls = p.swayAmount() > 0 ? 'sway' : f >= 1 ? 'full' : '';
      this._set('drawLbl', this.el.drawLabel, 'text', f >= 1 ? 'Full power – critical' : f < CONFIG.bow.minPower ? 'Too weak to loose' : `${Math.round(f * 100)}% power`);
      if (this.cache.drawCls !== cls) { this.cache.drawCls = cls; this.el.fill.className = cls; }
    }
    // vitals
    const H = CONFIG.health;
    const hpPct = `${Math.max(0, (p.hp / H.max) * 100).toFixed(1)}%`;
    this._set('hp', this.el.hp, 'width', hpPct);
    this._set('hpChip', this.el.hpChip, 'width', hpPct); // trails behind by CSS, showing the chunk just lost
    if (this.cache.regen !== p.regenerating) { this.cache.regen = p.regenerating; this.el.hp.classList.toggle('regen', !!p.regenerating); }
    // bandages
    const bp = !p.alive ? '' : p.bandaging ? '' : p.bandages > 0 ? (p.hp < H.max ? `Q – bandage (${p.bandages} left)` : `Bandages: ${p.bandages}`) : 'No bandages left';
    this._set('bandP', this.el.bandagePrompt, 'text', bp);
    this.el.bandageBar.classList.toggle('on', !!(p.alive && p.bandaging));
    if (p.bandaging) this._set('bandF', this.el.bandageFill, 'width', `${Math.min(100, (p.bandageT / H.bandageTime) * 100).toFixed(0)}%`);
    // low health: red pulse and a heartbeat
    const low = p.alive && p.hp < H.lowHpWarning;
    if (this.cache.low !== low) { this.cache.low = low; this.el.vignette.classList.toggle('low', low); }
    if (low) {
      this.beat = (this.beat ?? 0) - dt;
      if (this.beat <= 0) { this.game.audio.heartbeat(); this.beat = 0.55 + (p.hp / H.lowHpWarning) * 0.5; }
    }
    this._set('hpt', this.el.hpText, 'text', String(Math.max(0, Math.ceil(p.hp))));
    this._set('sta', this.el.sta, 'width', `${Math.round(p.stamina)}%`);
    this._set('arr', this.el.arrows, 'text', String(p.arrows));
    const stance = !p.alive ? '' : p.bandaging ? '✚ Bandaging – stay still' : p.hp < CONFIG.health.limpBelow ? '✚ Wounded – limping' : p.crouching ? '▾ Crouched · quiet' : p.sprinting ? '» Sprinting' : '';
    this._set('stance', this.el.stance, 'text', stance);
    if (this.cache.crouchCls !== p.crouching) { this.cache.crouchCls = p.crouching; this.el.stance.classList.toggle('crouch', p.crouching); }
    if (this.cache.empty !== (p.arrows === 0)) { this.cache.empty = p.arrows === 0; this.el.ammo.classList.toggle('empty', p.arrows === 0); }

    // pick-up prompt
    let prompt = '';
    if (p.alive) {
      const n = g.projectiles.countPickupsNear(p.pos, CONFIG.archer.pickupRadius);
      const corpse = g.nearestLootableCorpse(p, CONFIG.archer.pickupRadius);
      if (p.arrows >= CONFIG.archer.maxArrows && (n || corpse)) prompt = 'Quiver full';
      else if (n || corpse) prompt = `E – pick up ${n + (corpse ? corpse.arrows : 0)} arrow${n + (corpse ? corpse.arrows : 0) === 1 ? '' : 's'}`;
    } else if (!g.roundOver) {
      prompt = g.mode === 'kotf' ? `Respawning in ${Math.max(0, Math.ceil(p.respawnAt - g.time))}…` : 'You fell. Spectating your team.';
    }
    this._set('prompt', this.el.prompt, 'text', prompt);

    // timers
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.el.hit.className = this.el.hit.className.replace('show', ''); }
    if (this.centreTimer > 0) { this.centreTimer -= dt; if (this.centreTimer <= 0) this.el.centre.innerHTML = ''; }
    if (this.dmgTimer > 0) {
      this.dmgTimer -= dt;
      const a = clamp(this.dmgTimer / 0.6, 0, 1);
      this.el.vignette.style.boxShadow = `inset 0 0 160px rgba(200,0,0,${0.55 * a})`;
      if (this.dmgFrom) {
        const dx = this.dmgFrom.x - p.pos.x, dz = this.dmgFrom.z - p.pos.z;
        const ang = Math.atan2(-dx, -dz) - p.yaw;
        this.el.dmgArrow.style.transform = `rotate(${-ang}rad)`;
        this.el.dmgArrow.style.opacity = a;
      }
    } else if (this.cache.vig !== 0) {
      this.cache.vig = 0;
      this.el.vignette.style.boxShadow = 'none';
      this.el.dmgArrow.style.opacity = 0;
    }
    if (this.dmgTimer > 0) this.cache.vig = 1;

    // scoreboard
    const showSb = g.input.down('Tab') && g.state === 'playing' && !g.menuOpen;
    this.el.scoreboard.classList.toggle('hidden', !showSb);
    if (showSb) {
      this.sbTimer = (this.sbTimer || 0) - dt;
      if (this.sbTimer <= 0) { this.el.scoreboard.innerHTML = `<div class="sb">${g.ffa ? this.teamTable(null) : this.teamTable('blue') + this.teamTable('red')}</div>`; this.sbTimer = 0.25; }
    }
    if (g.input.wasPressed('F3')) { this.showPerf = !this.showPerf; this.el.perf.classList.toggle('hidden', !this.showPerf); }
  }

  deathRecap(victim, killer) {
    const g = this.game;
    const recent = victim.damageLog.filter((h) => g.time - h.t < 12);
    const who = (i) => { const a = g.archers[i]; return a ? (a.isPlayer ? 'You' : escapeHtml(a.name)) : 'Unknown'; };
    const total = recent.reduce((s, h) => s + h.dmg, 0);
    this.el.recap.innerHTML = `<h4>${killer && killer !== victim ? `Killed by ${who(killer.idx)}` : 'You fell'}</h4>` +
      recent.map((h) => `<div class="row2"><span>${who(h.s)}</span><span class="${h.crit ? 'crit' : ''}">${h.dmg}${h.crit ? ' critical' : ''}</span></div>`).join('') +
      `<div class="row2" style="margin-top:6px;opacity:.7"><span>${recent.length} hit${recent.length === 1 ? '' : 's'}</span><span>${total} damage</span></div>`;
    this.el.recap.classList.add('on');
    clearTimeout(this.recapTimer);
    this.recapTimer = setTimeout(() => this.el.recap.classList.remove('on'), 7000);
  }

  clearDeathRecap() { this.el.recap.classList.remove('on'); }

  updatePerf(text) { if (this.showPerf) this.el.perf.textContent = text; }

  teamTable(team) {
    const rows = (team ? this.game.teams[team] : this.game.archers).filter((a) => a.active).sort((a, b) => b.stats.kills - a.stats.kills || b.stats.damage - a.stats.damage);
    const tr = rows.map((a) => {
      const acc = a.stats.shots ? Math.round((a.stats.hits / a.stats.shots) * 100) : 0;
      return `<tr class="${a.alive ? '' : 'dead'} ${a.isPlayer ? 'you' : ''}"><td>${a.isPlayer ? 'You' : escapeHtml(a.name) + (a.human ? ' ★' : '')}</td><td>${a.stats.kills}</td><td>${a.stats.deaths}</td><td>${acc}%</td><td>${Math.round(a.stats.damage)}</td></tr>`;
    }).join('');
    const head = !team ? 'Free-for-all' : `${team === 'blue' ? 'Blue' : 'Red'} – ${this.game.roundWins[team]} round${this.game.roundWins[team] === 1 ? '' : 's'}`;
    return `<div><h3 class="${team || ''}">${head}</h3>
      <table><tr><th>Archer</th><th>K</th><th>D</th><th>Acc</th><th>Dmg</th></tr>${tr}</table></div>`;
  }
}
