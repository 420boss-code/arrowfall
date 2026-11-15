// The marketplace: a wallet of silver earned in matches, a weekly stock of six items, and the kit
// you have equipped. Everything is saved in this browser (localStorage).
import { CATALOGUE, ITEM, SLOTS, weeklyStock, weekIndex, weekStarts, cleanLoadout } from '../core/items.js';
import { escapeHtml } from '../core/utils.js';

const KEY = 'arrowfall-wallet';
const STARTER = 250;
// what play earns
export const EARN = { hit: 2, kill: 20, knifeKill: 10, survive: 10, roundWin: 30, matchWin: 75, ffaWin: 100 };
const $ = (id) => document.getElementById(id);
const RARITY = { common: 'Common', rare: 'Rare', epic: 'Epic' };

function marketArt(it) {
  const ink = it.colour === undefined ? '#c58a3c' : `#${it.colour.toString(16).padStart(6, '0')}`;
  const shapes = {
    bow: `<path d="M95 18 Q48 50 95 82" fill="none" stroke="${ink}" stroke-width="8" stroke-linecap="round"/><path d="M95 18 L95 82" fill="none" stroke="#e2d8bc" stroke-width="2"/><path d="M84 50 L103 50" stroke="#d3b37a" stroke-width="5"/>`,
    hood: `<path d="M95 18 C67 18 56 40 59 68 L70 83 L120 83 L131 68 C134 40 123 18 95 18Z" fill="${ink}" stroke="#d9d0bb" stroke-width="3"/><path d="M75 52 Q95 34 115 52 L108 75 L82 75Z" fill="#222923"/><path d="M82 75 Q95 65 108 75" fill="none" stroke="#d9d0bb" stroke-width="3"/>`,
    knife: `<path d="M48 60 L116 30 L98 65 L56 72Z" fill="${ink}" stroke="#e7e4d8" stroke-width="3"/><path d="M47 60 L65 77 L51 83 L36 68Z" fill="#987044" stroke="#e7e4d8" stroke-width="2"/><path d="M64 66 L103 48" stroke="#fff" stroke-width="2" opacity=".7"/>`,
    trail: `<path d="M30 65 C55 26 77 78 100 42 S136 34 151 26" fill="none" stroke="${ink}" stroke-width="7" stroke-linecap="round"/><circle cx="48" cy="43" r="5" fill="#fff2c7"/><circle cx="117" cy="38" r="4" fill="#fff2c7"/><path d="M78 24 l4 9 10 1-8 6 3 10-9-6-8 6 2-10-8-6 10-1Z" fill="${ink}"/>`,
    fx: `<path d="M95 18 L103 40 L127 27 L117 51 L143 54 L119 64 L135 84 L108 76 L97 94 L90 73 L63 82 L76 60 L51 49 L80 46 L73 23Z" fill="${ink}" stroke="#f3e7c5" stroke-width="3"/><circle cx="95" cy="57" r="9" fill="#fff1bf"/>`,
    perk: `<path d="M55 38 L95 18 L135 38 L135 70 L95 90 L55 70Z" fill="${ink}" stroke="#d8d1bd" stroke-width="3"/><path d="M55 38 L95 59 L135 38 M95 59 L95 90 M75 28 L115 49" fill="none" stroke="#e1d9c5" stroke-width="3"/><path d="M95 49 L101 56 L95 63 L89 56Z" fill="#f1c46b"/>`,
  }[it.cat] || '';
  return `<svg class="mkArt" viewBox="0 0 190 100" role="img" aria-label="${escapeHtml(it.name)} preview">
    <rect x="1" y="1" width="188" height="98" rx="10" fill="#20271f" stroke="rgba(255,255,255,.12)"/>
    <circle cx="95" cy="52" r="36" fill="${ink}" opacity=".12"/>
    ${shapes}
  </svg>`;
}

export class Market {
  constructor(game) {
    this.game = game;
    this.wallet = this._load();
    this.matchEarned = 0;
    this._toastN = 0;
    this._toastT = null;
  }

  _load() {
    let w = null;
    try { w = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { w = null; }
    if (!w || typeof w !== 'object') w = { silver: STARTER, owned: [], equipped: {}, earned: 0, spent: 0 };
    w.silver = Math.max(0, Math.floor(Number(w.silver) || 0));
    w.owned = Array.isArray(w.owned) ? w.owned.filter((id) => ITEM[id]) : [];
    w.equipped = cleanLoadout(w.equipped);
    for (const [slot, id] of Object.entries(w.equipped)) if (!w.owned.includes(id)) delete w.equipped[slot];
    return w;
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.wallet)); } catch { /* private mode */ } }

  loadout() { return { ...this.wallet.equipped }; }

  // ---------------------------------------------------------------- earning
  earn(n, why) {
    if (!(n > 0)) return;
    this.wallet.silver += n;
    this.wallet.earned = (this.wallet.earned || 0) + n;
    this.matchEarned += n;
    this.save();
    this._toast(n, why);
    this._badge();
  }

  _toast(n, why) {
    const el = $('silverToast');
    if (!el) return;
    // hits come in quick succession: add them up in one toast
    this._toastN = el.classList.contains('show') ? this._toastN + n : n;
    el.innerHTML = `+${this._toastN} <span class="coin">◆</span>${why ? ` <small>${escapeHtml(why)}</small>` : ''}`;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => el.classList.remove('show'), 1600);
  }

  _badge() {
    const b = $('mkBadge');
    if (b) b.textContent = this.wallet.silver;
  }

  // ---------------------------------------------------------------- buying and equipping
  buy(id) {
    const it = weeklyStock().find((x) => x.id === id);
    if (!it) return 'That item is not in this week\'s stock.';
    if (this.wallet.owned.includes(id)) return 'You already own that.';
    if (this.wallet.silver < it.price) return `You need ${it.price - this.wallet.silver} more silver.`;
    this.wallet.silver -= it.price;
    this.wallet.spent = (this.wallet.spent || 0) + it.price;
    this.wallet.owned.push(id);
    this.wallet.equipped[it.cat] = id; // wear it straight away
    this.save();
    this._badge();
    return null;
  }

  equip(slot, id) {
    if (!id) delete this.wallet.equipped[slot];
    else if (this.wallet.owned.includes(id) && ITEM[id].cat === slot) this.wallet.equipped[slot] = id;
    this.save();
  }

  // ---------------------------------------------------------------- the panel
  render() {
    const w = this.wallet, week = weekIndex();
    $('mkSilver').textContent = w.silver;
    const left = weekStarts(week + 1) - Date.now();
    const d = Math.floor(left / 864e5), h = Math.floor((left % 864e5) / 3600e3), m = Math.floor((left % 3600e3) / 60e3);
    $('mkTimer').textContent = `New stock in ${d ? `${d} d ` : ''}${h} h${d ? '' : ` ${m} min`}.`;
    const stock = weeklyStock(week);
    $('mkStock').innerHTML = stock.map((it) => {
      const owned = w.owned.includes(it.id);
      const afford = w.silver >= it.price;
      const swatch = it.cat === 'perk' ? '<span class="mkIcon">✦</span>' : `<span class="mkSwatch ${it.rainbow ? 'rainbow' : ''}" style="background:#${it.colour.toString(16).padStart(6, '0')}"></span>`;
      return `<div class="mkCard ${it.rarity}${it.was ? ' deal' : ''}">
        ${it.was ? '<span class="mkDeal">Deal of the week</span>' : ''}
        ${marketArt(it)}
        <div class="mkTop">${swatch}<div><b>${escapeHtml(it.name)}</b><small>${SLOTS[it.cat]} · <span class="r ${it.rarity}">${RARITY[it.rarity]}</span></small></div></div>
        ${it.desc ? `<p class="mkDesc">${escapeHtml(it.desc)}</p>` : `<p class="mkDesc">${COS_DESC[it.cat]}</p>`}
        <div class="mkBuy"><span class="mkPrice">${it.was ? `<s>${it.was}</s> ` : ''}◆ ${it.price}</span>
        ${owned ? '<button class="secondary small" disabled>Owned</button>' : `<button class="small" data-buy="${it.id}" ${afford ? '' : 'disabled'}>${afford ? 'Buy' : 'Not enough'}</button>`}</div>
      </div>`;
    }).join('');
    $('mkStock').querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', () => {
      const err = this.buy(b.dataset.buy);
      $('mkStatus').textContent = err || `Bought ${ITEM[b.dataset.buy].name} – it's equipped.`;
      this.render();
    }));
    // your kit: a choice per slot from what you own
    $('mkKit').innerHTML = Object.entries(SLOTS).map(([slot, label]) => {
      const mine = CATALOGUE.filter((it) => it.cat === slot && w.owned.includes(it.id));
      const cur = w.equipped[slot] || '';
      return `<div class="row"><label>${label}</label><select data-slot="${slot}" ${mine.length ? '' : 'disabled'}>
        <option value="">${slot === 'perk' ? 'None' : 'Standard'}</option>${mine.map((it) => `<option value="${it.id}" ${it.id === cur ? 'selected' : ''}>${escapeHtml(it.name)}</option>`).join('')}</select></div>`;
    }).join('');
    $('mkKit').querySelectorAll('select').forEach((s) => s.addEventListener('change', () => { this.equip(s.dataset.slot, s.value); $('mkStatus').textContent = 'Kit saved. It applies from your next match.'; }));
    $('mkEarnList').innerHTML = `Hit an enemy: ${EARN.hit} · Take one down: ${EARN.kill} (+${EARN.knifeKill} with the knife) · Survive a round: ${EARN.survive} · Win a round: ${EARN.roundWin} · Win a match: ${EARN.matchWin} · Win a free-for-all: ${EARN.ffaWin}`;
    $('mkTotals').textContent = `Earned so far: ${w.earned || 0} · Spent: ${w.spent || 0} · Items owned: ${w.owned.length} of ${CATALOGUE.length}`;
    this._badge();
  }
}

const COS_DESC = {
  bow: 'A new finish for your bow.',
  hood: 'Your hood in a new colour. Your tunic still shows your team.',
  knife: 'A new finish for your knife.',
  trail: 'Sparkles follow every arrow you shoot.',
  fx: 'Colours the burst when you take someone down.',
};
