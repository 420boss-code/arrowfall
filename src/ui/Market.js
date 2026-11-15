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
