// Match layout picker: free-for-all, 5 v 5, 10 v 10, 20 v 20 or a custom size, with an optional
// "fill with bots" switch (online only). Renders into a container and reports the chosen layout.
import { CONFIG } from '../config.js';

const T = CONFIG.teams.size;
const PRESETS = [
  ['ffa', 'Free-for-all', { type: 'ffa', count: 10 }],
  ['5v5', '5 v 5', { type: 'teams', blue: 5, red: 5 }],
  ['10v10', '10 v 10', { type: 'teams', blue: 10, red: 10 }],
  ['20v20', '20 v 20', { type: 'teams', blue: T, red: T }],
  ['custom', 'Custom', null],
];

export class LayoutPicker {
  constructor(root, { bots = false, initial = '20v20', onChange = null } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.preset = initial;
    const p = (id) => `${root.id}_${id}`;
    this.ids = { kind: p('kind'), ffaN: p('ffaN'), blue: p('blue'), red: p('red'), bots: p('bots') };
    root.classList.add('layoutPicker');
    root.innerHTML = `
      <div class="chips">${PRESETS.map(([k, t]) => `<button type="button" class="chip" data-p="${k}">${t}</button>`).join('')}</div>
      <div class="custom hidden">
        <div class="row"><label>Kind</label><select id="${this.ids.kind}"><option value="teams">Two teams</option><option value="ffa">Free-for-all</option></select></div>
        <div class="row ffaOnly"><label>Players</label><input type="number" id="${this.ids.ffaN}" min="2" max="${T * 2}" value="12" class="num" /><small>2 to ${T * 2}</small></div>
        <div class="row teamsOnly"><label>Team sizes</label><span class="vs">Blue <input type="number" id="${this.ids.blue}" min="1" max="${T}" value="8" class="num" /> v Red <input type="number" id="${this.ids.red}" min="1" max="${T}" value="8" class="num" /></span></div>
      </div>
      <div class="row ffaCount hidden"><label>Players</label><input type="range" id="${p('ffaR')}" min="2" max="${T * 2}" step="1" value="10" /><span class="val" id="${p('ffaRv')}">10</span></div>
      ${bots ? `<div class="row"><label for="${this.ids.bots}">Fill empty places with bots</label><input type="checkbox" id="${this.ids.bots}" checked /></div>` : ''}
      <p class="layoutNote note"></p>`;
    this.ffaR = root.querySelector(`#${p('ffaR')}`);
    this.ffaRv = root.querySelector(`#${p('ffaRv')}`);
    root.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => { this.preset = b.dataset.p; this._sync(); }));
    root.querySelectorAll('input, select').forEach((el) => el.addEventListener(el.type === 'range' ? 'input' : 'change', () => this._sync()));
    this._sync();
  }

  _el(k) { return this.root.querySelector(`#${this.ids[k]}`); }

  get value() {
    const n = (el, lo, hi) => Math.min(hi, Math.max(lo, Math.round(Number(el.value)) || lo));
    const botsEl = this._el('bots');
    const bots = botsEl ? botsEl.checked : true;
    if (this.preset === 'ffa') return { type: 'ffa', count: n(this.ffaR, 2, T * 2), bots };
    if (this.preset !== 'custom') return { ...PRESETS.find((x) => x[0] === this.preset)[2], bots };
    if (this._el('kind').value === 'ffa') return { type: 'ffa', count: n(this._el('ffaN'), 2, T * 2), bots };
    return { type: 'teams', blue: n(this._el('blue'), 1, T), red: n(this._el('red'), 1, T), bots };
  }

  get isFfa() { return this.value.type === 'ffa'; }

  _sync() {
    const r = this.root;
    r.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b.dataset.p === this.preset));
    const custom = this.preset === 'custom';
    r.querySelector('.custom').classList.toggle('hidden', !custom);
    r.querySelector('.ffaCount').classList.toggle('hidden', this.preset !== 'ffa');
    const kind = this._el('kind').value;
    r.querySelector('.ffaOnly').classList.toggle('hidden', kind !== 'ffa');
    r.querySelector('.teamsOnly').classList.toggle('hidden', kind !== 'teams');
    this.ffaRv.textContent = this.ffaR.value;
    const v = this.value;
    const people = v.type === 'ffa' ? `Up to ${v.count} archers, each for themselves. One round; the last one standing wins.` : `${v.blue} Blue against ${v.red} Red${v.blue !== v.red ? ' (uneven teams)' : ''}.`;
    r.querySelector('.layoutNote').textContent = v.bots ? people : `${people} No bots: play starts once ${v.type === 'ffa' ? 'two people have joined' : 'each side has a player'}.`;
    if (this.onChange) this.onChange(v);
  }
}
