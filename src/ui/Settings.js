// Player settings: one schema drives the panel, the saved copy in localStorage and the live game.
// Everything here is local to this browser; nothing is sent to the server.
import { CONFIG } from '../config.js';

const KEY = 'arrowfall-settings';

// [key, label, kind, default, extra]
export const SCHEMA = [
  ['h', 'Controls'],
  ['sensitivity', 'Mouse sensitivity', 'range', 1, { min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) }],
  ['invertY', 'Invert mouse Y', 'check', false],
  ['crouchMode', 'Crouch key (C)', 'select', 'toggle', { options: [['toggle', 'Press to toggle'], ['hold', 'Hold to crouch']] }],
  ['h', 'View'],
  ['fov', 'Field of view', 'range', CONFIG.camera.fov, { min: 60, max: 100, step: 1, fmt: (v) => `${v}°` }],
  ['firstPerson', 'Start in first person', 'check', CONFIG.camera.startFirstPerson],
  ['fullscreen', 'Fullscreen on start (locks Ctrl+W)', 'check', false],
  ['h', 'Graphics'],
  ['shadows', 'Shadows', 'check', true],
  ['resolution', 'Render resolution', 'select', 'auto', { options: [['auto', 'Automatic (keeps 60 fps)'], ['1', 'Full'], ['0.75', 'Three quarters'], ['0.5', 'Half']] }],
  ['deathParticles', 'Death particles', 'check', true],
  ['h', 'Interface'],
  ['healthBars', 'Health bars over heads', 'check', true],
  ['damageNumbers', 'Damage numbers', 'check', true],
  ['showPerf', 'Performance readout (F3)', 'check', false],
  ['h', 'Sound'],
  ['volume', 'Volume', 'range', 0.8, { min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` }],
];

export function defaults() {
  const d = {};
  for (const [k, , kind, def] of SCHEMA) if (k !== 'h' && kind) d[k] = def;
  return d;
}

export function loadSettings() {
  const s = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(s)) if (saved[k] !== undefined && typeof saved[k] === typeof s[k]) s[k] = saved[k];
  } catch { /* private window or bad JSON: defaults */ }
  return s;
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// Push the settings into a running game. Safe to call at any time, in or out of a match.
export function applySettings(game, s) {
  game.settings = s;
  if (game.headless) return;
  const p = game.player;
  if (p) { p.sensitivity = s.sensitivity; p.invertY = s.invertY; p.crouchHold = s.crouchMode === 'hold'; }
  game.audio.setVolume(s.volume);
  if (s.shadows !== game.renderer.shadowMap.enabled) {
    game.renderer.shadowMap.enabled = s.shadows;
    game.terrain.sun.castShadow = s.shadows;
    game.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
  }
  const scale = s.resolution === 'auto' ? (game.adaptive ? game.adaptive.scale : 1) : Number(s.resolution);
  if (s.resolution !== 'auto') game.adaptive = { scale, cooldown: 2 };
  game.renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.graphics.pixelRatioCap) * scale);
  game.renderer.setSize(window.innerWidth, window.innerHeight);
  if (game.hud) { game.hud.showPerf = s.showPerf; game.hud.el.perf.classList.toggle('hidden', !s.showPerf); }
}

// Build the panel's rows into `root`; every change saves and applies at once.
export function buildSettingsPanel(root, game) {
  const s = game.settings;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  root.innerHTML = SCHEMA.map(([k, label, kind, , x]) => {
    if (k === 'h') return `<h3>${esc(label)}</h3>`;
    const id = `set_${k}`;
    let input;
    if (kind === 'range') input = `<input type="range" id="${id}" min="${x.min}" max="${x.max}" step="${x.step}" value="${s[k]}" /><span class="val" id="${id}_v">${esc(x.fmt(s[k]))}</span>`;
    else if (kind === 'check') input = `<input type="checkbox" id="${id}" ${s[k] ? 'checked' : ''} />`;
    else input = `<select id="${id}">${x.options.map(([v, t]) => `<option value="${v}" ${v === s[k] ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    return `<div class="row"><label for="${id}">${esc(label)}</label>${input}</div>`;
  }).join('');
  for (const [k, , kind, , x] of SCHEMA) {
    if (k === 'h') continue;
    const el = root.querySelector(`#set_${k}`);
    el.addEventListener(kind === 'range' ? 'input' : 'change', () => {
      s[k] = kind === 'range' ? Number(el.value) : kind === 'check' ? el.checked : el.value;
      if (kind === 'range') root.querySelector(`#set_${k}_v`).textContent = x.fmt(s[k]);
      saveSettings(s);
      applySettings(game, s);
    });
  }
}

export function resetSettings(root, game) {
  const d = defaults();
  Object.assign(game.settings, d);
  saveSettings(game.settings);
  applySettings(game, game.settings);
  buildSettingsPanel(root, game);
}
