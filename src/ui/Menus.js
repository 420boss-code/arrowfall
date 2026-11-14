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
    $('btnMenu').addEventListener('click', () => game.quitToMenu());
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
    for (const id of ['startMenu', 'serverMenu', 'pauseMenu', 'roundMenu', 'loading']) $(id).classList.add('hidden');
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
      const welcome = await net.connect(roomId, name);
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
