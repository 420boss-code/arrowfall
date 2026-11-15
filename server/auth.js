// Access control.
//   Players log in with their own 8-digit player code: 3 digits of player number (001–999) followed
//   by a 5-digit check calculated from a server secret (HMAC). Codes are never stored: the server
//   recalculates the check at login, so they keep working across restarts on hosts whose disk is
//   wiped (e.g. Render's free tier). Revoking a player blocks their number.
//   The admin logs in with the admin password (a 5-letter word and 2 digits, e.g. "otter58").
//
// Settings (environment variables):
//   ADMIN_PASSWORD   the admin password
//   CODE_SECRET      long random secret that player codes are derived from (keep it private;
//                    changing it changes every player's code)
//   REVOKED_PLAYERS  comma-separated player numbers that are always blocked, e.g. "7,12"
//   DATA_DIR         where admin changes are saved (factions, revocations, names) – optional
// Changes made in the admin panel are saved to DATA_DIR/auth.json, which a wiped disk loses;
// the environment variables always apply.
//
// Logins are signed tokens (HMAC with a key derived from CODE_SECRET) kept in an HttpOnly cookie,
// so they survive server restarts and sleeps. "Keep me signed in" makes the cookie last 90 days
// (renewed as it is used); otherwise it ends when the browser closes, or after 12 hours.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanName } from '../src/net/protocol.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const FILE = path.join(DATA_DIR, 'auth.json');
const REMEMBER_DAYS = 90;          // "keep me signed in"
const SHORT_HOURS = 12;            // otherwise: until the browser closes, at most this long
const GUEST_HOURS = 24;
const COOKIE = 'af_session';
const MAX_PLAYER = 999;            // admin-made codes: 3-digit player numbers (8-digit codes)
const SELF_MIN = 100000, SELF_MAX = 999999; // self-made codes: 6-digit player numbers (11-digit codes)
export const validNumber = (n) => Number.isInteger(n) && ((n >= 1 && n <= MAX_PLAYER) || (n >= SELF_MIN && n <= SELF_MAX));

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(password), salt, 32).toString('hex')}`;
}

function check(password, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 32);
  const want = Buffer.from(key, 'hex');
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}

// The 5-digit check for a player number.
export function codeCheck(secret, n) {
  const h = crypto.createHmac('sha256', secret).update(`arrowfall-player-${n}`).digest();
  return String(h.readUInt32BE(0) % 100000).padStart(5, '0');
}

export function playerCode(secret, n) {
  return String(n).padStart(n > MAX_PLAYER ? 6 : 3, '0') + codeCheck(secret, n);
}

// Parse "00731415", "007-31415" or "007 31415" into a player number if the check matches.
export function verifyCode(secret, input) {
  const digits = String(input || '').replace(/[\s-]/g, '');
  if (!/^(\d{8}|\d{11})$/.test(digits)) return null;
  const split = digits.length === 8 ? 3 : 6;
  const n = Number(digits.slice(0, split));
  if (split === 3 ? n < 1 || n > MAX_PLAYER : n < SELF_MIN || n > SELF_MAX) return null;
  const want = Buffer.from(codeCheck(secret, n)), got = Buffer.from(digits.slice(split));
  return crypto.timingSafeEqual(want, got) ? n : null;
}

const WORDS = ['otter', 'raven', 'cedar', 'flint', 'heron', 'maple', 'birch', 'amber', 'quail', 'stoat', 'thorn', 'aspen', 'lynx', 'hazel', 'brook'].filter((w) => w.length === 5);
const randomAdminPassword = () => WORDS[crypto.randomInt(WORDS.length)] + String(crypto.randomInt(10, 100));

export class Auth {
  constructor() {
    this.sessions = new Map();       // token id -> { role, ip, player, expires, gen, remember } (cache of live logins)
    this.attempts = new Map();       // ip -> { count, until }
    // names: player number -> label given by the admin; revoked: numbers blocked from the panel
    this.state = { adminHash: null, adminGen: 1, names: {}, accounts: [], revoked: [], factions: [], bans: [], adminPointsClaimed: false };
    this._load();
    if (!Array.isArray(this.state.accounts)) this.state.accounts = [];
    if (typeof this.state.adminPointsClaimed !== 'boolean') this.state.adminPointsClaimed = false;
  }

  _load() {
    try {
      if (fs.existsSync(FILE)) Object.assign(this.state, JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } catch (e) { console.warn('Could not read', FILE, e.message); }
    const notes = [];
    this.secret = process.env.CODE_SECRET;
    if (!this.secret || this.secret.length < 16) {
      this.secret = crypto.randomBytes(24).toString('base64url');
      notes.push('CODE_SECRET is not set (or too short): player codes made now stop working when the server restarts.');
    }
    this.sessionKey = crypto.createHmac('sha256', this.secret).update('arrowfall-session-v1').digest();
    this.loggedOut = new Map();   // token id -> expiry: logged-out tokens until they would have expired
    if (!this.state.adminHash) {
      const pw = process.env.ADMIN_PASSWORD || randomAdminPassword();
      if (!process.env.ADMIN_PASSWORD) notes.push(`admin password for this run: ${pw}`);
      this.state.adminHash = hash(pw);
    }
    this.envRevoked = new Set(String(process.env.REVOKED_PLAYERS || '').split(',').map((s) => Number(s.trim())).filter(validNumber));
    if (process.env.ALLOW_SIGNUP === '0') this.state.signupOpen = false;
    else if (typeof this.state.signupOpen !== 'boolean') this.state.signupOpen = true;
    if (process.env.ALLOW_GUESTS === '0') this.state.guestsOpen = false;
    else if (typeof this.state.guestsOpen !== 'boolean') this.state.guestsOpen = true;
    this.guests = new Map();    // ip -> [timestamps] (rate limit)
    this.guestTimes = [];
    this.signups = new Map();   // ip -> [timestamps] (rate limit)
    this.signupTimes = [];      // all sign-ups in the last hour
    if (notes.length) console.log(notes.join('\n'));
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch (e) { console.warn('Could not save', FILE, e.message); }
  }

  // ---------------------------------------------------------------- players
  isRevoked(n) { return this.envRevoked.has(n) || this.state.revoked.includes(n); }

  createCode(n, label) {
    n = Number(n);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PLAYER) return { error: `Player numbers go from 1 to ${MAX_PLAYER}.` };
    const name = cleanName(label, 24, '');
    if (name) this.state.names[n] = name; else delete this.state.names[n];
    if (!this.state.accounts.includes(n)) this.state.accounts.push(n);
    this._save();
    return { player: n, code: playerCode(this.secret, n), name, revoked: this.isRevoked(n) };
  }

  // The lowest number not yet named, revoked or currently logged in.
  suggestNumber() {
    const used = new Set([...this.state.accounts, ...Object.keys(this.state.names).map(Number), ...this.state.revoked, ...this.envRevoked]);
    for (const s of this.sessions.values()) if (s.player) used.add(s.player);
    for (let n = 1; n <= MAX_PLAYER; n++) if (!used.has(n)) return n;
    return null;
  }

  // Self sign-up: a random unused 6-digit player number. Limited to 3 per address and 60 overall per hour.
  signup(ip, label, remember = true) {
    if (!this.state.signupOpen) return { error: 'New codes are not available right now.', status: 403 };
    if (this.isBanned(ip)) return { error: 'Access denied.', status: 403 };
    const now = Date.now(), hour = 3600_000;
    const mine = (this.signups.get(ip) || []).filter((t) => now - t < hour);
    this.signupTimes = this.signupTimes.filter((t) => now - t < hour);
    if (mine.length >= 3) return { error: 'You have made 3 codes in the last hour – use one of those, or try later.', status: 429 };
    if (this.signupTimes.length >= 60) return { error: 'Too many new codes right now – try again later.', status: 429 };
    const used = new Set([...Object.keys(this.state.names).map(Number), ...this.state.revoked, ...this.envRevoked]);
    for (const s of this.sessions.values()) if (s.player) used.add(s.player);
    let n;
    do n = crypto.randomInt(SELF_MIN, SELF_MAX + 1); while (used.has(n));
    mine.push(now); this.signups.set(ip, mine); this.signupTimes.push(now);
    this.state.names[n] = cleanName(label, 24, '') || 'Self sign-up';
    this.state.accounts.push(n);
    this._save();
    const { token, maxAge } = this.issue({ role: 'player', ip, player: n }, remember);
    return { role: 'player', player: n, code: playerCode(this.secret, n), token, maxAge };
  }

  setSignup(open) { this.state.signupOpen = !!open; this._save(); }

  // ---------------------------------------------------------------- guests
  // A guest gets a one-day session with no player number: they can join games but cannot make
  // servers or use friends. Closing guest access ends every guest session at its next request.
  guest(ip, remember = true) {
    if (!this.state.guestsOpen) return { error: 'Signing in without a code is not available right now.', status: 403 };
    if (this.isGuestBanned(ip)) return { error: 'Access denied.', status: 403 };
    const now = Date.now(), hour = 3600_000;
    const mine = (this.guests.get(ip) || []).filter((t) => now - t < hour);
    this.guestTimes = this.guestTimes.filter((t) => now - t < hour);
    if (mine.length >= 10) return { error: 'Too many sign-ins from here – try again later.', status: 429 };
    if (this.guestTimes.length >= 300) return { error: 'Too many sign-ins right now – try again later.', status: 429 };
    mine.push(now); this.guests.set(ip, mine); this.guestTimes.push(now);
    const guestId = crypto.randomInt(1000, 10000);
    const { token, maxAge } = this.issue({ role: 'guest', ip, player: null, guestId }, remember);
    return { role: 'guest', player: null, guestId, token, maxAge };
  }

  setGuests(open) {
    this.state.guestsOpen = !!open;
    if (!open) for (const [t, s] of this.sessions) if (s.role === 'guest') this.sessions.delete(t);
    this._save();
  }

  // ---------------------------------------------------------------- friends
  // Friend lists live in the browser; each poll tells the server which numbers this session cares
  // about. A friend's status is only revealed when they have added you back.
  setFriends(sess, ids) {
    sess.friends = new Set(ids);
  }

  // player number -> { lastSeen, friends } merged across that player's sessions
  presenceIndex() {
    const idx = new Map();
    for (const s of this.sessions.values()) {
      if (!s.player) continue;
      const e = idx.get(s.player) || { lastSeen: 0, friends: new Set() };
      e.lastSeen = Math.max(e.lastSeen, s.lastSeen || 0);
      if (s.friends) for (const f of s.friends) e.friends.add(f);
      idx.set(s.player, e);
    }
    return idx;
  }

  revoke(n) {
    n = Number(n);
    if (!this.state.revoked.includes(n)) this.state.revoked.push(n);
    for (const [t, s] of this.sessions) if (s.player === n) this.sessions.delete(t);
    this._save();
  }

  restore(n) {
    n = Number(n);
    this.state.revoked = this.state.revoked.filter((x) => x !== n);
    this._save();
  }

  playerList() {
    const nums = new Set([...this.state.accounts, ...Object.keys(this.state.names).map(Number), ...this.state.revoked, ...this.envRevoked]);
    return [...nums].sort((a, b) => a - b).map((n) => ({
      player: n, name: this.state.names[n] || '', code: playerCode(this.secret, n),
      revoked: this.isRevoked(n), permanent: this.envRevoked.has(n),
    }));
  }

  // ---------------------------------------------------------------- address bans (kept for abuse)
  // A full ban stops every login from the address. A guest ban (guestOnly) only stops guest logins,
  // so people with their own codes on a shared network (a school, say) are not caught by it.
  isBanned(ip) { return this.state.bans.some((b) => b.ip === ip && !b.guestOnly); }
  isGuestBanned(ip) { return this.state.bans.some((b) => b.ip === ip); }

  ban(ip, name, { guestOnly = false } = {}) {
    if (!ip || this.state.bans.some((b) => b.ip === ip && (!b.guestOnly || guestOnly))) return;
    this.state.bans.push({ id: crypto.randomBytes(4).toString('hex'), ip, name: cleanName(name, 24, 'Unknown'), at: new Date().toISOString(), ...(guestOnly ? { guestOnly: true } : {}) });
    for (const [t, s] of this.sessions) if (s.ip === ip && (!guestOnly || s.role === 'guest')) this.sessions.delete(t);
    this._save();
  }

  unban(id) {
    this.state.bans = this.state.bans.filter((b) => b.id !== id);
    this._save();
  }

  // ---------------------------------------------------------------- login
  // Returns { role, token, player } or { error, status }.
  login(input, ip, remember = true) {
    if (this.isBanned(ip)) return { error: 'Access denied.', status: 403 };
    const now = Date.now();
    const at = this.attempts.get(ip) || { count: 0, until: 0 };
    if (at.until > now) return { error: `Too many attempts – try again in ${Math.ceil((at.until - now) / 1000)} s.`, status: 429 };
    let role = null, player = null;
    if (check(input, this.state.adminHash)) role = 'admin';
    else {
      player = verifyCode(this.secret, input);
      if (player && this.isRevoked(player)) { at.count++; this.attempts.set(ip, at); return { error: 'This code has been revoked.', status: 403 }; }
      if (player) role = 'player';
    }
    if (!role) {
      at.count++;
      if (at.count >= 5) at.until = now + 60_000 * Math.min(10, at.count - 4);
      this.attempts.set(ip, at);
      return { error: 'That code was not recognised.', status: 401 };
    }
    this.attempts.delete(ip);
    const { token, maxAge } = this.issue({ role, ip, player }, remember);
    return { role, token, player, maxAge };
  }

  // ---------------------------------------------------------------- signed login tokens
  _mac(body) { return crypto.createHmac('sha256', this.sessionKey).update(body).digest('base64url'); }

  // Make a token for a new login. Returns { token, maxAge } (maxAge in seconds, or null for a cookie
  // that ends with the browser session).
  issue({ role, ip, player = null, guestId = null }, remember = true) {
    const now = Date.now();
    const life = role === 'guest' ? GUEST_HOURS * 3600e3 : remember ? REMEMBER_DAYS * 864e5 : SHORT_HOURS * 3600e3;
    const j = crypto.randomBytes(12).toString('base64url');
    const payload = { r: role, p: player, g: guestId, e: now + life, a: this.state.adminGen, j, k: remember ? 1 : 0 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    this.sessions.set(j, { role, ip, player, guestId, expires: payload.e, gen: payload.a, remember: !!remember, jti: j });
    return { token: `${body}.${this._mac(body)}`, maxAge: remember ? Math.round(life / 1000) : null };
  }

  _decode(token) {
    const dot = token.indexOf('.');
    if (dot < 1) return null;
    const body = token.slice(0, dot), mac = token.slice(dot + 1);
    const want = this._mac(body);
    if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  }

  logout(req) {
    const t = this._token(req);
    const p = t && this._decode(t);
    if (!p) return;
    this.loggedOut.set(p.j, p.e);
    this.sessions.delete(p.j);
    const now = Date.now();
    if (this.loggedOut.size > 5000) for (const [j, e] of this.loggedOut) if (e < now) this.loggedOut.delete(j);
  }

  _token(req) {
    const m = /(?:^|;\s*)af_session=([A-Za-z0-9_.-]+)/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }

  // The login behind a request, or null. Admin logins end when the admin password changes; player
  // logins end when their number is revoked; guest logins end when guest play is switched off.
  session(req, ip) {
    const t = this._token(req);
    const p = t && this._decode(t);
    if (!p || p.e < Date.now() || this.loggedOut.has(p.j)) return null;
    let s = this.sessions.get(p.j);
    if (!s) {
      // first sight of this token since a restart
      s = { role: p.r, ip, player: p.p, guestId: p.g, expires: p.e, gen: p.a, remember: !!p.k, jti: p.j };
      if (this.sessions.size > 20000) this.sessions.clear();
      this.sessions.set(p.j, s);
    }
    s.ip = ip;
    const dead = (s.role === 'guest' ? this.isGuestBanned(ip) : this.isBanned(ip)) ||
      (s.role === 'admin' ? s.gen !== this.state.adminGen : s.role === 'guest' ? !this.state.guestsOpen : this.isRevoked(s.player));
    if (dead) { this.sessions.delete(p.j); return null; }
    s.lastSeen = Date.now();
    return s;
  }

  // A remembered login that is past a third of its life gets a fresh 90 days.
  renewal(s) {
    if (!s || !s.remember || s.role === 'guest' || s.renewed) return null;
    if (s.expires - Date.now() > REMEMBER_DAYS * 864e5 * (2 / 3)) return null;
    s.renewed = true;
    this.loggedOut.set(s.jti, s.expires);
    this.sessions.delete(s.jti);
    const fresh = this.issue({ role: s.role, ip: s.ip, player: s.player }, true);
    const next = this.sessions.get(this._decode(fresh.token).j);
    if (next && s.friends) next.friends = s.friends;
    return fresh;
  }

  cookie(token, secure, maxAge) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (maxAge) parts.push(`Max-Age=${maxAge}`);
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

  // ---------------------------------------------------------------- admin settings
  claimAdminPoints() {
    if (this.state.adminPointsClaimed) return { error: 'The admin point grant has already been claimed.' };
    this.state.adminPointsClaimed = true;
    this._save();
    return { points: 50000 };
  }

  setAdminPassword(password) {
    if (typeof password !== 'string' || !/^[A-Za-z]{5}\d{2}$/.test(password)) return 'The admin password must be a 5-letter word followed by 2 digits, e.g. otter58.';
    this.state.adminHash = hash(password);
    this.state.adminGen++;
    this._save();
    return null;
  }

  addFaction({ name, tag, colour }) {
    const n = cleanName(name, 24, '');
    const t = cleanName(tag, 5, '').toUpperCase();
    if (!n || !t) return { error: 'A faction needs a name and a tag (up to 5 letters).' };
    if (this.state.factions.some((f) => f.tag === t)) return { error: 'That tag is already taken.' };
    if (this.state.factions.length >= 30) return { error: 'There are already 30 factions.' };
    const c = /^#[0-9a-fA-F]{6}$/.test(colour) ? colour : '#d9b45a';
    const f = { id: crypto.randomBytes(4).toString('hex'), name: n, tag: t, colour: c };
    this.state.factions.push(f);
    this._save();
    return { faction: f };
  }

  removeFaction(id) {
    this.state.factions = this.state.factions.filter((f) => f.id !== id);
    this._save();
  }

  faction(id) { return this.state.factions.find((f) => f.id === id) || null; }
}

export function maskIp(ip) {
  const v4 = /(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip || '');
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  return (ip || '?').split(':').slice(0, 3).join(':') + ':…';
}
