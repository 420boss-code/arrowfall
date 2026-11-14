// Start, server browser, pause and end-of-round menus.
import { NetClient } from '../net/NetClient.js';
import { escapeHtml } from '../core/utils.js';

const $ = (id) => document.getElementById(id);
const MODE_NAMES = { tdm: 'Team Deathmatch', kotf: 'King of the Field' };
const DIFF_NAMES = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; }

export class Menus {
  constructor(game) {
    this.game = game;
    $('optSens').addEventListener('input', (e) => { $('sensVal').textContent = Number(e.target.value).toFixed(2); });
    $('btnStart').addEventListener('click', () => {
      const opts = this.localOptions();
      Object.assign(opts, { mode: $('optMode').value, difficulty: $('optDiff').value, friendlyFire: $('optFF').checked });
      this._syncPause(opts);
      if (opts.fullscreen) this._fullscreen();
      this.hideAll();
      game.startMatch(opts);
    });
    $('btnOnline').addEventListener('click', () => this.showServers());
    $('btnBack').addEventListener('click', () => this.showStart());
    $('btnRefresh').addEventListener('click', () => this.refreshServers());
    $('btnCreate').addEventListener('click', () => this.createServer());
    $('btnJoinCode').addEventListener('click', () => {
      const code = $('joinCode').value.trim().toUpperCase();
      if (code) this.join(code);
    });
    $('playerName').value = store('arrowfall-name') || '';
    $('btnResume').addEventListener('click', () => game.resume());
    $('btnQuit').addEventListener('click', () => game.quitToMenu());
    $('pFF').addEventListener('change', (e) => { game.combat.friendlyFire = e.target.checked; });
    $('pSens').addEventListener('input', (e) => { game.player.sensitivity = Number(e.target.value); });
    $('pVol').addEventListener('input', (e) => { game.audio.setVolume(Number(e.target.value)); });
    $('btnNext').addEventListener('click', () => game.continueAfterRound());
    // session, logout and admin
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
    $('admEntryBtn').addEventListener('click', () => this.changePassword('entry', 'admEntry'));
    $('admAdminBtn').addEventListener('click', () => this.changePassword('admin', 'admAdmin'));
    $('admFAdd').addEventListener('click', () => this.addFaction());
    $('btnMenu').addEventListener('click', () => game.quitToMenu());
  }

  _applySession() {
    const admin = this.session && this.session.role === 'admin';
    $('btnAdmin').classList.toggle('hidden', !admin);
    $('btnPauseAdmin').classList.toggle('hidden', !admin);
    const sel = $('playerFaction');
    const keep = sel.value || store('arrowfall-faction') || '';
    sel.innerHTML = '<option value="">None</option>' + ((this.session && this.session.factions) || [])
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
      $('admFactions').innerHTML = st.factions.length ? st.factions.map((f) => item(
        `<span class="swatch" style="background:${escapeHtml(f.colour)}"></span><span class="grow"><b>[${escapeHtml(f.tag)}]</b> ${escapeHtml(f.name)}</span><button class="secondary" data-del="${escapeHtml(f.id)}">Delete</button>`)).join('') : '<div class="empty">No factions yet.</div>';
      $('admPlayers').innerHTML = st.players.length ? st.players.map((p) => item(
        `<span class="grow">${escapeHtml(p.name)}${p.faction ? ` <small>[${escapeHtml(p.faction)}]</small>` : ''} <small>· ${escapeHtml(p.room)} · ${escapeHtml(p.ip)}</small></span><button class="secondary" data-kick="${escapeHtml(p.key)}">Kick</button><button data-ban="${escapeHtml(p.key)}">Ban</button>`)).join('') : '<div class="empty">Nobody is in an online game right now.</div>';
      $('admBans').innerHTML = st.bans.length ? st.bans.map((b) => item(
        `<span class="grow">${escapeHtml(b.name)} <small>· ${escapeHtml(b.ip)} · ${escapeHtml(b.at.slice(0, 10))}</small></span><button class="secondary" data-unban="${escapeHtml(b.id)}">Unban</button>`)).join('') : '<div class="empty">No bans.</div>';
      const act = (attr, path, label) => $('adminMenu').querySelectorAll(`[${attr}]`).forEach((btn) => btn.addEventListener('click', async () => {
        if (attr === 'data-ban' && !confirm('Ban this player? Everyone on their internet address will be blocked.')) return;
        try { await this._admin(path, attr === 'data-del' || attr === 'data-unban' ? { id: btn.getAttribute(attr) } : { key: btn.getAttribute(attr) }); this.admStatus(label); this.refreshAdmin(); } catch (e) { this.admStatus(e.message, true); }
      }));
      act('data-del', '/api/admin/faction/delete', 'Faction deleted.');
      act('data-kick', '/api/admin/kick', 'Player kicked.');
      act('data-ban', '/api/admin/ban', 'Player banned.');
      act('data-unban', '/api/admin/unban', 'Ban lifted.');
    } catch (e) { this.admStatus(e.message, true); }
  }

  async changePassword(which, inputId) {
    const pw = $(inputId).value;
    try {
      const r = await this._admin('/api/admin/password', { which, password: pw });
      $(inputId).value = '';
      this.admStatus(`${which === 'entry' ? 'Entry' : 'Admin'} password changed. ${r.note}`);
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

  localOptions() {
    return {
      sensitivity: Number($('optSens').value),
      volume: Number($('optVol').value),
      shadows: $('optShadows').checked,
      fullscreen: $('optFull').checked,
    };
  }

  _syncPause(opts) {
    $('pFF').checked = !!opts.friendlyFire;
    $('pSens').value = opts.sensitivity;
    $('pVol').value = opts.volume;
  }

  async _fullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      // Keyboard Lock stops Ctrl+W (crouch + forward) closing the tab in Chromium browsers
      if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock();
    } catch (e) { /* not supported: Ctrl+W may close the tab, use C to crouch */ }
  }

  hideAll() {
    for (const id of ['startMenu', 'serverMenu', 'pauseMenu', 'roundMenu', 'loading', 'adminMenu']) $(id).classList.add('hidden');
  }

  showStart(message) {
    this.hideAll();
    $('startMenu').classList.remove('hidden');
    $('startNote').textContent = message || '';
  }

  // ---------------------------------------------------------------- server browser
  showServers() {
    this.hideAll();
    $('serverMenu').classList.remove('hidden');
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
    body.innerHTML = '<tr><td colspan="5">Looking for servers…</td></tr>';
    try {
      const res = await fetch('/api/servers');
      if (!res.ok) throw new Error();
      const list = await res.json();
      if (!list.length) { body.innerHTML = '<tr><td colspan="5">No public servers right now – create one below.</td></tr>'; return; }
      body.innerHTML = list.map((s) => `<tr>
        <td><b>${escapeHtml(s.name)}</b></td>
        <td>${MODE_NAMES[s.mode] || escapeHtml(s.mode)}${s.ff ? ' · FF' : ''}</td>
        <td>${DIFF_NAMES[s.difficulty] || escapeHtml(s.difficulty)}</td>
        <td>${s.humans}/${s.max} players</td>
        <td><button class="join" data-id="${escapeHtml(s.id)}" ${s.humans >= s.max ? 'disabled' : ''}>Join</button></td></tr>`).join('');
      body.querySelectorAll('button.join').forEach((b) => b.addEventListener('click', () => this.join(b.dataset.id)));
    } catch {
      body.innerHTML = '<tr><td colspan="5">No game server found. Online play needs <code>npm run dev</code> or <code>npm start</code> (see README).</td></tr>';
    }
  }

  async createServer() {
    const payload = {
      name: $('newName').value.trim() || `${this.playerName()}'s server`,
      mode: $('newMode').value,
      difficulty: $('newDiff').value,
      friendlyFire: $('newFF').checked,
      isPublic: $('newPublic').checked,
    };
    this.status('Creating server…');
    try {
      const res = await fetch('/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create a server.');
      await this.join(data.id);
    } catch (e) {
      this.status(e.message, true);
    }
  }

  async join(roomId) {
    const name = this.playerName();
    this.status(`Joining ${roomId}…`);
    const net = new NetClient(this.game);
    try {
      const faction = $('playerFaction').value;
      store('arrowfall-faction', faction);
      const welcome = await net.connect(roomId, name, faction || null);
      const opts = this.localOptions();
      this._syncPause(opts);
      if (opts.fullscreen) this._fullscreen();
      this.game.startOnline(net, welcome, opts);
    } catch (e) {
      net.close();
      this.status(e.message, true);
    }
  }

  // ---------------------------------------------------------------- in-game
  showPause(on, online = false) {
    $('pauseMenu').classList.toggle('hidden', !on);
    if (!on) return;
    $('pFFRow').classList.toggle('hidden', online);
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
    $('roundWait').textContent = info.online ? (info.matchOver ? 'A new match starts shortly…' : 'The next round starts shortly…') : '';
    $('btnMenu').textContent = info.online ? 'Leave server' : 'Main menu';
    $('roundMenu').classList.remove('hidden');
  }

  hideRound() { $('roundMenu').classList.add('hidden'); }
}
