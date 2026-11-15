// Start, online (servers and parties), friends, settings, pause, admin and end-of-round menus.
import { NetClient } from '../net/NetClient.js';
import { escapeHtml } from '../core/utils.js';
import { LayoutPicker } from './LayoutPicker.js';
import { buildSettingsPanel, resetSettings } from './Settings.js';

const $ = (id) => document.getElementById(id);
const MODE_NAMES = { tdm: 'Team Deathmatch', kotf: 'King of the Field' };
const DIFF_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const OVERLAYS = ['startMenu', 'serverMenu', 'pauseMenu', 'roundMenu', 'loading', 'adminMenu', 'settingsMenu', 'friendsMenu', 'marketMenu'];
const FRIENDS_KEY = 'arrowfall-friends';

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; }
const fmtNum = (n) => `#${n < 1000 ? String(n).padStart(3, '0') : n}`;

async function copyText(text, btn) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { btn.textContent = 'Select it to copy'; }
  setTimeout(() => { btn.textContent = btn.dataset.label || 'Copy'; }, 1800);
}

// Free-for-all has no hill to hold: switch the mode list to Team Deathmatch and grey out the other.
function lockModeForFfa(select, ffa) {
  const k = [...select.options].find((o) => o.value === 'kotf');
  k.disabled = ffa;
  if (ffa && select.value === 'kotf') select.value = 'tdm';
}

export class Menus {
  constructor(game) {
    this.game = game;
    this.currentRoom = null;
    this.returnTo = 'startMenu';

    // ---- start menu (offline)
    this.offlineLayout = new LayoutPicker($('optLayout'), { bots: false, initial: store('arrowfall-layout') || '20v20', onChange: (v) => lockModeForFfa($('optMode'), v.type === 'ffa') });
    $('btnStart').addEventListener('click', () => {
      store('arrowfall-layout', this.offlineLayout.preset);
      const opts = { mode: $('optMode').value, difficulty: $('optDiff').value, friendlyFire: $('optFF').checked, layout: this.offlineLayout.value };
      this._syncPause(opts);
      if (game.settings.fullscreen) this._fullscreen();
      this.currentRoom = null;
      this.hideAll();
      game.startMatch(opts);
    });
    $('btnOnline').addEventListener('click', () => this.showServers());
    $('btnSettings').addEventListener('click', () => this.showSettings('startMenu'));
    $('btnFriends').addEventListener('click', () => this.showFriends('startMenu'));
    $('btnMarket').addEventListener('click', () => { $('mkStatus').textContent = ''; game.market.render(); this._openPanel('marketMenu', 'startMenu'); });
    $('mkBack').addEventListener('click', () => this.closePanel('marketMenu'));
    game.market._badge();

    // ---- online menu
    $('btnBack').addEventListener('click', () => this.showStart());
    $('btnRefresh').addEventListener('click', () => this.refreshServers());
    this.onlineLayout = new LayoutPicker($('newLayout'), { bots: true, initial: '5v5', onChange: (v) => lockModeForFfa($('newMode'), v.type === 'ffa') });
    const syncWho = () => {
      const party = $('newWho').value === 'party';
      $('btnCreate').textContent = party ? 'Create party' : 'Create public server';
      $('newName').placeholder = party ? 'My party' : 'My server';
    };
    $('newWho').addEventListener('change', syncWho);
    syncWho();
    $('btnCreate').addEventListener('click', () => this.createServer());
    $('btnJoinCode').addEventListener('click', () => {
      const code = $('joinCode').value.trim().toUpperCase();
      if (code) this.join(code);
    });
    $('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoinCode').click(); });
    $('partyCopy').addEventListener('click', (e) => copyText($('partyCode').textContent, e.target));
    $('partyEnter').addEventListener('click', () => { if (this.pendingParty) this.join(this.pendingParty); });
    $('playerName').value = store('arrowfall-name') || '';

    // ---- settings and friends
    $('setBack').addEventListener('click', () => this.closePanel('settingsMenu'));
    $('setReset').addEventListener('click', () => resetSettings($('settingsBody'), game));
    $('frBack').addEventListener('click', () => this.closePanel('friendsMenu'));
    $('frAdd').addEventListener('click', () => this.addFriend());
    $('frNum').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.addFriend(); });
    $('frCopy').addEventListener('click', (e) => { if (this.session && this.session.player) copyText(String(this.session.player), e.target); });

    // ---- pause
    $('btnResume').addEventListener('click', () => game.resume());
    $('btnQuit').addEventListener('click', () => { this.currentRoom = null; game.quitToMenu(); });
    $('pFF').addEventListener('change', (e) => { game.combat.friendlyFire = e.target.checked; });
    $('btnPauseSettings').addEventListener('click', () => this.showSettings('pauseMenu'));
    $('btnPauseFriends').addEventListener('click', () => this.showFriends('pauseMenu'));
    $('pPartyCopy').addEventListener('click', (e) => copyText($('pPartyCode').textContent, e.target));
    $('btnNext').addEventListener('click', () => game.continueAfterRound());
    $('btnMenu').addEventListener('click', () => { this.currentRoom = null; game.quitToMenu(); });

    // ---- session, logout and admin
    this.session = window.__afSession || null;
    this._applySession();
    $('btnLogout').addEventListener('click', async () => {
      try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } catch { /* ignore */ }
      location.reload();
    });
    $('btnAdmin').addEventListener('click', () => this.showAdmin('startMenu'));
    $('btnPauseAdmin').addEventListener('click', () => this.showAdmin('pauseMenu'));
    $('admBack').addEventListener('click', () => this.hideAdmin());
    $('admRefresh').addEventListener('click', () => this.refreshAdmin());
    $('admGrantPoints').addEventListener('click', () => this.grantAdminPoints());
    $('admAdminBtn').addEventListener('click', () => this.changePassword('admin', 'admAdmin'));
    $('admCodeBtn').addEventListener('click', () => this.createCode());
    $('admSignup').addEventListener('change', async (e) => {
      try { const r = await this._admin('/api/admin/signup', { open: e.target.checked }); this.admStatus(r.open ? 'Anyone can now make a code.' : 'Sign-up closed: only you can make codes.'); } catch (err) { this.admStatus(err.message, true); }
    });
    $('admGuests').addEventListener('change', async (e) => {
      try { const r = await this._admin('/api/admin/guests', { open: e.target.checked }); this.admStatus(r.open ? 'Guests can now play without a code.' : 'Guest play switched off: every guest has been logged out.'); this.refreshAdmin(); } catch (err) { this.admStatus(err.message, true); }
    });
    $('admFAdd').addEventListener('click', () => this.addFaction());

    // ---- friends in the background: presence, party invites, and hearts for friends in your game
    this.friendStatus = {};
    this.dismissedInvites = new Set();
    this.invites = [];
    game.friendIds = new Set(this.friends().map((f) => f.id));
    $('invJoin').addEventListener('click', () => this.acceptInvite());
    $('invNo').addEventListener('click', () => this.dismissInvite());
    window.addEventListener('keydown', (e) => {
      // in the middle of a game the mouse is captured: J accepts the invite on screen
      if (e.code === 'KeyJ' && !$('inviteCard').classList.contains('hidden') && game.state === 'playing' && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) this.acceptInvite();
    });
    if (this.session && this.session.player) {
      this.pollFriends();
      this.socialTimer = setInterval(() => this.pollFriends(), 8000);
    }
    if (window.__afOpenAdmin && this.session && this.session.role === 'admin') {
      window.__afOpenAdmin = false;
      queueMicrotask(() => this.showAdmin('startMenu'));
    }
  }

  get isGuest() { return !!(this.session && this.session.role === 'guest'); }

  _applySession() {
    const s = this.session;
    const admin = s && s.role === 'admin';
    $('btnAdmin').classList.toggle('hidden', !admin);
    $('btnPauseAdmin').classList.toggle('hidden', !admin);
    const hasNumber = !!(s && s.player);
    $('btnFriends').classList.toggle('hidden', !hasNumber);
    $('btnPauseFriends').classList.toggle('hidden', !hasNumber);
    $('whoami').textContent = !s ? '' : admin ? 'Logged in as admin' : this.isGuest ? `Playing as a guest${s.guestId ? ` (guest ${s.guestId})` : ''} – online play only, no friends or parties of your own` : `Player ${fmtNum(s.player)}`;
    $('createSection').classList.toggle('hidden', this.isGuest);
    $('guestCreateNote').classList.toggle('hidden', !this.isGuest);
    const sel = $('playerFaction');
    const keep = sel.value || store('arrowfall-faction') || '';
    sel.innerHTML = '<option value="">None</option>' + ((s && s.factions) || [])
      .map((f) => `<option value="${escapeHtml(f.id)}">[${escapeHtml(f.tag)}] ${escapeHtml(f.name)}</option>`).join('');
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
  }

  async refreshSession() {
    try {
      const r = await fetch('/api/session', { credentials: 'same-origin' });
      if (r.status === 401) { location.reload(); return; }
      if (r.ok) { this.session = await r.json(); this._applySession(); }
    } catch { /* offline */ }
  }

  // ---------------------------------------------------------------- panels opened over a menu
  _openPanel(id, from) {
    this.returnTo = from;
    for (const o of ['startMenu', 'pauseMenu']) $(o).classList.add('hidden');
    $(id).classList.remove('hidden');
  }

  closePanel(id) {
    $(id).classList.add('hidden');
    if (id === 'friendsMenu') clearInterval(this.friendTimer);
    // the match may have ended while the panel was open
    const back = this.returnTo === 'pauseMenu' && this.game.state !== 'playing' ? 'startMenu' : this.returnTo;
    $(back).classList.remove('hidden');
  }

  showSettings(from) {
    buildSettingsPanel($('settingsBody'), this.game);
    this._openPanel('settingsMenu', from);
  }

  // ---------------------------------------------------------------- friends
  friends() {
    try { const f = JSON.parse(store(FRIENDS_KEY) || '[]'); return Array.isArray(f) ? f.filter((x) => x && Number.isInteger(x.id)) : []; } catch { return []; }
  }

  saveFriends(list) { store(FRIENDS_KEY, JSON.stringify(list)); }

  showFriends(from) {
    this._openPanel('friendsMenu', from);
    $('frMe').textContent = this.session && this.session.player ? this.session.player : '–';
    $('frStatus').textContent = '';
    this.renderFriends();
    this.pollFriends();
  }

  addFriend() {
    const raw = $('frNum').value.replace(/[^0-9]/g, '');
    const id = Number(raw);
    const st = $('frStatus');
    if (!raw || !((id >= 1 && id <= 999) || (id >= 100000 && id <= 999999))) { st.textContent = 'Player numbers have 1–3 or 6 digits.'; return; }
    if (this.session && id === this.session.player) { st.textContent = 'That is your own number.'; return; }
    const list = this.friends();
    if (list.some((f) => f.id === id)) { st.textContent = 'Already on your list.'; return; }
    if (list.length >= 100) { st.textContent = 'Your list is full (100 friends).'; return; }
    list.push({ id, nick: $('frNick').value.trim().slice(0, 20) });
    this.saveFriends(list);
    this.game.friendIds = new Set(list.map((f) => f.id));
    $('frNum').value = ''; $('frNick').value = '';
    st.textContent = `Added ${fmtNum(id)}. Ask them to add your number, ${this.session.player}, too.`;
    this.renderFriends();
    this.pollFriends();
  }

  async pollFriends() {
    const panel = !$('friendsMenu').classList.contains('hidden');
    try {
      const r = await fetch('/api/friends', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: this.friends().map((f) => f.id) }) });
      if (r.status === 401) { location.reload(); return; }
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not check on your friends.');
      this.friendStatus = Object.fromEntries(data.friends.map((f) => [f.id, f]));
      this.invites = data.invites || [];
      this.showInvite();
      if (panel) this.renderFriends();
    } catch (e) {
      if (panel) $('frStatus').textContent = e.message && !/fetch/i.test(e.message) ? e.message : 'Friends need the online server.';
    }
  }

  // ---------------------------------------------------------------- party invites
  nickFor(id) { const f = this.friends().find((x) => x.id === id); return f && f.nick ? f.nick : null; }

  showInvite() {
    const inv = this.invites.find((v) => !this.dismissedInvites.has(v.id) && (!this.currentRoom || this.currentRoom.id !== v.room));
    this.shownInvite = inv || null;
    $('inviteCard').classList.toggle('hidden', !inv);
    if (!inv) return;
    const who = escapeHtml(this.nickFor(inv.from) || inv.fromName || fmtNum(inv.from));
    $('invText').innerHTML = `<b>♥ ${who}</b> invited you to ${inv.party ? 'their party' : `<b>${escapeHtml(inv.roomName)}</b>`}<small>${escapeHtml(inv.layout)}${inv.party ? ` · code ${escapeHtml(inv.room)}` : ''}</small>`;
    $('invHint').textContent = this.game.state === 'playing' ? 'Press J to join, or Esc to use the mouse.' : '';
  }

  async dismissInvite(inv = this.shownInvite) {
    if (!inv) return;
    this.dismissedInvites.add(inv.id);
    this.showInvite();
    try { await fetch('/api/invites', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: inv.id }) }); } catch { /* offline */ }
  }

  acceptInvite() {
    const inv = this.shownInvite;
    if (!inv) return;
    this.dismissInvite(inv);
    for (const id of ['friendsMenu', 'settingsMenu', 'marketMenu', 'adminMenu']) $(id).classList.add('hidden');
    if (this.game.state !== 'menu') this.game.quitToMenu();
    this.showServers();
    this.join(inv.room, inv.from);
  }

  async invite(to, btn) {
    try {
      const r = await fetch('/api/invite', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Could not send the invite.');
      $('frStatus').textContent = `Invite sent to ${this.nickFor(to) || fmtNum(to)}. It lasts two minutes.`;
      if (btn) { btn.textContent = 'Invited'; btn.disabled = true; }
    } catch (e) { $('frStatus').textContent = e.message; }
  }

  renderFriends() {
    const list = this.friends();
    const order = { playing: 0, online: 1, offline: 2, pending: 3 };
    const st = (f) => (this.friendStatus[f.id] || { status: 'pending' });
    list.sort((a, b) => (order[st(a).status] ?? 4) - (order[st(b).status] ?? 4));
    $('frList').innerHTML = list.length ? list.map((f) => {
      const s = st(f);
      const text = s.status === 'playing' ? `in ${s.room.party ? 'a party' : escapeHtml(s.room.name)} · ${escapeHtml(s.room.layout)} · ${s.room.humans}/${s.room.max}`
        : s.status === 'online' ? 'online, in the menus' : s.status === 'offline' ? 'offline' : 'has not added you back yet';
      const canJoin = s.status === 'playing' && s.room.humans < s.room.max && (!this.currentRoom || this.currentRoom.id !== s.room.id);
      const here = s.status === 'playing' && this.currentRoom && this.currentRoom.id === s.room.id;
      const canInvite = this.currentRoom && !here && (s.status === 'online' || s.status === 'playing');
      return `<div class="it"><span class="presence ${s.status}"></span><span class="grow"><b>${escapeHtml(f.nick || fmtNum(f.id))}</b> <small>${f.nick ? `${fmtNum(f.id)} · ` : ''}${text}</small></span>` +
        `${here ? '<span class="heart" title="In your game">♥</span>' : ''}${canInvite ? `<button data-finv="${f.id}">Invite</button>` : ''}${canJoin ? `<button data-fjoin="${escapeHtml(s.room.id)}" data-fwith="${f.id}">Join</button>` : ''}<button class="secondary" data-frm="${f.id}">Remove</button></div>`;
    }).join('') : '<div class="empty">No friends added yet.</div>';
    $('frList').querySelectorAll('[data-finv]').forEach((b) => b.addEventListener('click', () => this.invite(Number(b.dataset.finv), b)));
    $('frList').querySelectorAll('[data-frm]').forEach((b) => b.addEventListener('click', () => {
      this.saveFriends(this.friends().filter((f) => f.id !== Number(b.dataset.frm)));
      this.game.friendIds = new Set(this.friends().map((f) => f.id));
      this.renderFriends();
      this.pollFriends();
    }));
    $('frList').querySelectorAll('[data-fjoin]').forEach((b) => b.addEventListener('click', () => {
      clearInterval(this.friendTimer);
      $('friendsMenu').classList.add('hidden');
      if (this.game.state !== 'menu') this.game.quitToMenu();
      this.showServers();
      this.join(b.dataset.fjoin, Number(b.dataset.fwith));
    }));
  }

  // ---------------------------------------------------------------- admin panel
  async _admin(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401) { location.reload(); throw new Error('Logged out.'); }
    if (!r.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  admStatus(msg, bad = false) { const el = $('admStatus'); el.textContent = msg; el.style.color = bad ? '#ff8a70' : ''; }

  showAdmin(from) {
    this.adminFrom = from;
    for (const id of ['startMenu', 'pauseMenu']) $(id).classList.add('hidden');
    $('adminMenu').classList.remove('hidden');
    this.admStatus('');
    this.refreshAdmin();
  }

  hideAdmin() {
    $('adminMenu').classList.add('hidden');
    $(this.adminFrom || 'startMenu').classList.remove('hidden');
    this.refreshSession();
  }

  async refreshAdmin() {
    try {
      const st = await this._admin('/api/admin/state');
      const item = (inner) => `<div class="it">${inner}</div>`;
      $('admPointsState').textContent = st.pointsClaimed ? 'Already claimed on this server.' : 'One-time admin grant.';
      $('admGrantPoints').disabled = !!st.pointsClaimed;
      $('admRooms').innerHTML = st.rooms.length ? st.rooms.map((room) => item(
        `<span class="grow"><b>${escapeHtml(room.name)}</b> <small>· ${room.isPublic ? 'public' : 'private'} · ${escapeHtml(room.layout)} · ${room.humans}/${room.max} players</small></span><button data-room="${escapeHtml(room.id)}" ${room.humans >= room.max ? 'disabled' : ''}>${room.humans >= room.max ? 'Full' : 'Enter'}</button>`)).join('') : '<div class="empty">No games are running.</div>';
      $('admFactions').innerHTML = st.factions.length ? st.factions.map((f) => item(
        `<span class="swatch" style="background:${escapeHtml(f.colour)}"></span><span class="grow"><b>[${escapeHtml(f.tag)}]</b> ${escapeHtml(f.name)}</span><button class="secondary" data-del="${escapeHtml(f.id)}">Delete</button>`)).join('') : '<div class="empty">No factions yet.</div>';
      $('admPlayers').innerHTML = st.players.length ? st.players.map((p) => item(
        `<span class="grow">${escapeHtml(p.name)}${p.faction ? ` <small>[${escapeHtml(p.faction)}]</small>` : ''} <small>· ${p.player ? fmtNum(p.player) : p.guest ? 'guest' : 'admin'} · ${escapeHtml(p.room)}</small></span><button class="secondary" data-kick="${escapeHtml(p.key)}">Kick</button>${p.player || p.guest ? `<button data-ban="${escapeHtml(p.key)}">Ban</button>` : ''}`)).join('') : '<div class="empty">Nobody is in an online game right now.</div>';
      if (!$('admNum').value && st.nextNumber) $('admNum').value = st.nextNumber;
      $('admSignup').checked = !!st.signupOpen;
      $('admGuests').checked = !!st.guestsOpen;
      $('admCodes').innerHTML = st.codes.length ? st.codes.map((c) => item(
        `<span class="grow">${fmtNum(c.player)} ${escapeHtml(c.name || '')} <code>${c.code.length === 8 ? `${c.code.slice(0, 3)} ${c.code.slice(3)}` : `${c.code.slice(0, 6)} ${c.code.slice(6)}`}</code>${c.revoked ? ` <small class="revoked">${c.permanent ? 'blocked (REVOKED_PLAYERS)' : 'revoked'}</small>` : ''}</span>` +
        (c.permanent ? '' : c.revoked ? `<button class="secondary" data-restore="${c.player}">Restore</button>` : `<button data-revoke="${c.player}">Revoke</button>`))).join('') : '<div class="empty">No player codes created yet.</div>';
      $('admBans').innerHTML = st.bans.length ? st.bans.map((b) => item(
        `<span class="grow">${escapeHtml(b.name)} <small>· ${escapeHtml(b.ip)}${b.guestOnly ? ' · guests only' : ''} · ${escapeHtml(b.at.slice(0, 10))}</small></span><button class="secondary" data-unban="${escapeHtml(b.id)}">Unban</button>`)).join('') : '<div class="empty">No bans.</div>';
      const act = (attr, path, label) => $('adminMenu').querySelectorAll(`[${attr}]`).forEach((btn) => btn.addEventListener('click', async () => {
        try {
          const r = await this._admin(path, attr === 'data-del' || attr === 'data-unban' ? { id: btn.getAttribute(attr) } : { key: btn.getAttribute(attr) });
          this.admStatus(typeof label === 'function' ? label(r) : label);
          this.refreshAdmin();
        } catch (e) { this.admStatus(e.message, true); }
      }));
      const actNum = (attr, path, label) => $('adminMenu').querySelectorAll(`[${attr}]`).forEach((btn) => btn.addEventListener('click', async () => {
        try { await this._admin(path, { player: Number(btn.getAttribute(attr)) }); this.admStatus(label); this.refreshAdmin(); } catch (e) { this.admStatus(e.message, true); }
      }));
      actNum('data-revoke', '/api/admin/revoke', 'Code revoked – that player has been logged out.');
      actNum('data-restore', '/api/admin/restore', 'Code restored.');
      act('data-del', '/api/admin/faction/delete', 'Faction deleted.');
      act('data-kick', '/api/admin/kick', 'Player kicked.');
      act('data-ban', '/api/admin/ban', (r) => (r.ipBan ? 'Guest logins from that address are now blocked; people with codes there are unaffected (lift it under Bans).' : 'Player banned: their code is revoked (Restore under Player codes to undo).'));
      act('data-unban', '/api/admin/unban', 'Ban lifted.');
      $('admRooms').querySelectorAll('[data-room]').forEach((btn) => btn.addEventListener('click', () => {
        const roomId = btn.dataset.room;
        this.hideAdmin();
        this.currentRoom = null;
        this.game.quitToMenu();
        this.join(roomId);
      }));
    } catch (e) { this.admStatus(e.message, true); }
  }

  async grantAdminPoints() {
    try {
      const r = await this._admin('/api/admin/points', {});
      this.game.market.wallet.silver += r.points;
      this.game.market.save();
      this.game.market._badge();
      $('admGrantPoints').disabled = true;
      $('admPointsState').textContent = 'Claimed on this server.';
      this.admStatus(`Added ${r.points.toLocaleString()} silver to this browser's marketplace wallet.`);
    } catch (e) { this.admStatus(e.message, true); }
  }

  async changePassword(which, inputId) {
    const pw = $(inputId).value;
    try {
      const r = await this._admin('/api/admin/password', { which, password: pw });
      $(inputId).value = '';
      this.admStatus(`Admin password changed. ${r.note}`);
    } catch (e) { this.admStatus(e.message, true); }
  }

  async createCode() {
    try {
      const r = await this._admin('/api/admin/code', { player: Number($('admNum').value), name: $('admNumName').value });
      const box = $('admNewCode');
      box.hidden = false;
      box.innerHTML = `Player ${fmtNum(r.player)}${r.name ? ` (${escapeHtml(r.name)})` : ''}: <b>${r.code.slice(0, 3)} ${r.code.slice(3)}</b>${r.revoked ? ' <span class="revoked">– currently revoked</span>' : ''}<br><small>Give this code to that player. The same number always gives the same code.</small>`;
      $('admNum').value = ''; $('admNumName').value = '';
      this.refreshAdmin();
    } catch (e) { this.admStatus(e.message, true); }
  }

  async addFaction() {
    try {
      await this._admin('/api/admin/faction', { name: $('admFName').value, tag: $('admFTag').value, colour: $('admFColour').value });
      $('admFName').value = ''; $('admFTag').value = '';
      this.admStatus('Faction created.');
      this.refreshAdmin();
    } catch (e) { this.admStatus(e.message, true); }
  }

  _syncPause(opts) {
    $('pFF').checked = !!opts.friendlyFire;
  }

  async _fullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      // Keyboard Lock stops Ctrl+W (crouch + forward) closing the tab in Chromium browsers
      if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock();
    } catch (e) { /* not supported: Ctrl+W may close the tab, use C to crouch */ }
  }

  hideAll() {
    for (const id of OVERLAYS) $(id).classList.add('hidden');
    clearInterval(this.friendTimer);
  }

  showStart(message) {
    this.hideAll();
    $('startMenu').classList.remove('hidden');
    $('startNote').textContent = message || '';
  }

  // ---------------------------------------------------------------- online: servers and parties
  showServers() {
    this.hideAll();
    $('serverMenu').classList.remove('hidden');
    $('partyBox').hidden = true;
    this.status('');
    this.refreshSession();
    this.refreshServers();
  }

  status(msg, bad = false) {
    const el = $('netStatus');
    el.textContent = msg;
    el.style.color = bad ? '#ff8a70' : '';
  }

  playerName() {
    const n = $('playerName').value.trim();
    if (n) store('arrowfall-name', n);
    return n || 'Archer';
  }

  async refreshServers() {
    const body = $('serverList');
    body.innerHTML = '<tr><td colspan="6">Looking for servers…</td></tr>';
    try {
      const res = await fetch('/api/servers');
      if (!res.ok) throw new Error();
      const list = await res.json();
      if (!list.length) { body.innerHTML = '<tr><td colspan="6">No public servers right now – start one below.</td></tr>'; return; }
      body.innerHTML = list.map((s) => `<tr>
        <td><b>${escapeHtml(s.name)}</b></td>
        <td>${escapeHtml(s.layout || '20 v 20')}</td>
        <td>${s.ffa ? 'Free-for-all' : MODE_NAMES[s.mode] || escapeHtml(s.mode)}${s.ff && !s.ffa ? ' · FF' : ''}</td>
        <td>${DIFF_NAMES[s.difficulty] || escapeHtml(s.difficulty)}</td>
        <td>${s.humans}/${s.max}</td>
        <td><button class="join" data-id="${escapeHtml(s.id)}" ${s.humans >= s.max ? 'disabled' : ''}>Join</button></td></tr>`).join('');
      body.querySelectorAll('button.join').forEach((b) => b.addEventListener('click', () => this.join(b.dataset.id)));
    } catch {
      body.innerHTML = '<tr><td colspan="6">No game server found. Online play needs <code>npm run dev</code> or <code>npm start</code> (see README).</td></tr>';
    }
  }

  async createServer() {
    const party = $('newWho').value === 'party';
    const layout = this.onlineLayout.value;
    const payload = {
      name: $('newName').value.trim() || (party ? `${this.playerName()}'s party` : `${this.playerName()}'s server`),
      mode: layout.type === 'ffa' ? 'tdm' : $('newMode').value,
      difficulty: $('newDiff').value,
      friendlyFire: $('newFF').checked,
      isPublic: !party,
      party,
      layout,
    };
    this.status(party ? 'Setting up your party…' : 'Creating server…');
    try {
      const res = await fetch('/api/servers', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create a server.');
      if (party) {
        this.pendingParty = data.id;
        $('partyCode').textContent = data.id;
        $('partyBox').hidden = false;
        this.status('');
        $('partyBox').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else await this.join(data.id);
    } catch (e) {
      this.status(e.message, true);
    }
  }

  async join(roomId, withPlayer = 0) {
    const name = this.playerName();
    this.status(`Joining ${roomId}…`);
    const net = new NetClient(this.game);
    try {
      const faction = $('playerFaction').value;
      store('arrowfall-faction', faction);
      const welcome = await net.connect(roomId, name, faction || null, this.game.market ? this.game.market.loadout() : null, withPlayer);
      this.currentRoom = welcome.room;
      this.showInvite(); // an invite to the game you just joined is no longer needed
      this._syncPause({ friendlyFire: welcome.match && welcome.match.ff });
      if (this.game.settings.fullscreen) this._fullscreen();
      this.game.startOnline(net, welcome, {});
    } catch (e) {
      net.close();
      this.status(e.message, true);
    }
  }

  // ---------------------------------------------------------------- in-game
  showPause(on, online = false) {
    $('pauseMenu').classList.toggle('hidden', !on);
    if (!on) { for (const id of ['settingsMenu', 'friendsMenu', 'adminMenu']) $(id).classList.add('hidden'); clearInterval(this.friendTimer); return; }
    $('pFFRow').classList.toggle('hidden', online);
    const party = online && this.currentRoom && !this.currentRoom.isPublic;
    $('pParty').classList.toggle('hidden', !party);
    if (party) $('pPartyCode').textContent = this.currentRoom.id;
    $('pauseTitle').textContent = online ? 'Menu – the battle goes on' : 'Paused';
    $('btnQuit').textContent = online ? 'Leave server' : 'Quit to menu';
  }

  showRound(info) {
    $('roundTitle').textContent = info.title;
    $('roundSub').textContent = info.subtitle;
    $('roundMvp').innerHTML = info.mvp;
    $('roundTable').innerHTML = info.tables;
    $('btnNext').classList.toggle('hidden', !!info.online);
    $('btnNext').textContent = info.matchOver ? 'Play again' : 'Next round';
    const m = this.game.market;
    $('roundSilver').innerHTML = m && m.matchEarned ? `◆ ${m.matchEarned} silver earned ${info.online ? "since you joined" : "this match"} · balance ${m.wallet.silver}` : '';
    $('roundWait').textContent = info.online ? (info.matchOver ? 'A new match starts shortly…' : 'The next round starts shortly…') : '';
    $('btnMenu').textContent = info.online ? 'Leave server' : 'Main menu';
    $('roundMenu').classList.remove('hidden');
  }

  hideRound() { $('roundMenu').classList.add('hidden'); }
}
