// Access control: an entry password (play) and an admin password (play + admin panel), login
// sessions in HttpOnly cookies, brute-force lockout, factions and bans.
//
// Passwords are stored only as scrypt hashes. Where they come from, in order:
//   1. data/auth.json – written whenever the admin changes something (passwords, factions, bans)
//   2. ENTRY_PASSWORD / ADMIN_PASSWORD environment variables
//   3. otherwise random ones are generated and printed to the server log once
// On hosts with a temporary disk (e.g. Render's free tier) data/auth.json is lost on restart, so the
// environment variables win again then; mount a persistent disk at data/ to keep admin changes.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanName } from '../src/net/protocol.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_DAYS = 14;
const COOKIE = 'af_session';

function hash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const key = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `${salt}:${key}`;
}

function check(password, stored) {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 32);
  const want = Buffer.from(key, 'hex');
  return want.length === test.length && crypto.timingSafeEqual(want, test);
}

const randomPassword = () => crypto.randomBytes(9).toString('base64url');

export class Auth {
  constructor() {
    this.sessions = new Map();       // token -> { role, ip, expires, gen }
    this.attempts = new Map();       // ip -> { count, until }
    this.state = { entryHash: null, adminHash: null, entryGen: 1, adminGen: 1, factions: [], bans: [] };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(FILE)) Object.assign(this.state, JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } catch (e) { console.warn('Could not read', FILE, e.message); }
    const gen = [];
    if (!this.state.entryHash) {
      const pw = process.env.ENTRY_PASSWORD || randomPassword();
      if (!process.env.ENTRY_PASSWORD) gen.push(`entry password: ${pw}`);
      this.state.entryHash = hash(pw);
    }
    if (!this.state.adminHash) {
      const pw = process.env.ADMIN_PASSWORD || randomPassword();
      if (!process.env.ADMIN_PASSWORD) gen.push(`admin password: ${pw}`);
      this.state.adminHash = hash(pw);
    }
    if (gen.length) console.log(`No passwords configured – generated for this run:\n  ${gen.join('\n  ')}\nSet ENTRY_PASSWORD and ADMIN_PASSWORD to choose your own.`);
  }

  _save() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    } catch (e) { console.warn('Could not save', FILE, e.message); }
  }

  // ---------------------------------------------------------------- bans
  isBanned(ip) { return this.state.bans.some((b) => b.ip === ip); }

  ban(ip, name) {
    if (!ip || this.isBanned(ip)) return;
    this.state.bans.push({ id: crypto.randomBytes(4).toString('hex'), ip, name: cleanName(name, 24, 'Unknown'), at: new Date().toISOString() });
    for (const [t, s] of this.sessions) if (s.ip === ip) this.sessions.delete(t);
    this._save();
  }

  unban(id) {
    this.state.bans = this.state.bans.filter((b) => b.id !== id);
    this._save();
  }

  // ---------------------------------------------------------------- login
  // Returns { role, token } or { error, status }.
  login(password, ip) {
    if (this.isBanned(ip)) return { error: 'Access denied.', status: 403 };
    const now = Date.now();
    const at = this.attempts.get(ip) || { count: 0, until: 0 };
    if (at.until > now) return { error: `Too many attempts – try again in ${Math.ceil((at.until - now) / 1000)} s.`, status: 429 };
    let role = null;
    if (check(password, this.state.adminHash)) role = 'admin';
    else if (check(password, this.state.entryHash)) role = 'player';
    if (!role) {
      at.count++;
      if (at.count >= 5) { at.until = now + 60_000 * Math.min(10, at.count - 4); }
      this.attempts.set(ip, at);
      return { error: 'Wrong password.', status: 401 };
    }
    this.attempts.delete(ip);
    const token = crypto.randomBytes(24).toString('base64url');
    this.sessions.set(token, { role, ip, expires: now + SESSION_DAYS * 864e5, gen: role === 'admin' ? this.state.adminGen : this.state.entryGen });
    return { role, token };
  }

  logout(req) {
    const t = this._token(req);
    if (t) this.sessions.delete(t);
  }

  _token(req) {
    const m = /(?:^|;\s*)af_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }

  // The session behind a request, or null. Sessions die when their password is changed.
  session(req, ip) {
    const t = this._token(req);
    const s = t && this.sessions.get(t);
    if (!s) return null;
    const gen = s.role === 'admin' ? this.state.adminGen : this.state.entryGen;
    if (s.expires < Date.now() || s.gen !== gen || this.isBanned(ip)) { this.sessions.delete(t); return null; }
    return s;
  }

  cookie(token, secure) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${SESSION_DAYS * 86400}`];
    if (secure) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

  // ---------------------------------------------------------------- admin actions
  setPassword(which, password) {
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) return 'Passwords need 6 to 128 characters.';
    if (which === 'entry') { this.state.entryHash = hash(password); this.state.entryGen++; }
    else if (which === 'admin') { this.state.adminHash = hash(password); this.state.adminGen++; }
    else return 'Unknown password.';
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

// Show a little of an address so admins can tell people apart without exposing it whole.
export function maskIp(ip) {
  const v4 = /(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip || '');
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  return (ip || '?').split(':').slice(0, 3).join(':') + ':…';
}
