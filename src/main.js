// Numberwell: a working maths solver and practice page. Searching "1+1" opens Arrowfall.
import './site/site.css';
import { solve } from './site/solver.js';
import { escapeHtml } from './core/utils.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- the way in
const SECRET = /^1\+1=?$/;
let unlocked = false;

async function openGame() {
  if (unlocked) return;
  // the game is members-only: check for a login session first
  let session = null;
  try {
    const r = await fetch('/api/session', { credentials: 'same-origin' });
    if (r.ok) session = await r.json();
  } catch { /* server unreachable */ }
  if (!session) { showLogin(); return; }
  launch(session);
}

async function launch(session) {
  if (unlocked) return;
  unlocked = true;
  window.__afSession = session;
  $('nwLogin').hidden = true;
  $('site').hidden = true;
  $('gameRoot').hidden = false;
  // the game (and its styles) are only downloaded now, as a separate chunk
  const { startGame } = await import('./game-entry.js');
  startGame();
}

const fmtCode = (c) => (c.length === 8 ? `${c.slice(0, 3)} ${c.slice(3)}` : `${c.slice(0, 6)} ${c.slice(6)}`);

function showCard(id) {
  for (const c of ['nwLoginForm', 'nwSignupForm', 'nwCodeCard']) $(c).hidden = c !== id;
}

async function showLogin() {
  $('nwLogin').hidden = false;
  showCard('nwLoginForm');
  $('nwLoginErr').textContent = '';
  $('nwPass').value = '';
  setTimeout(() => $('nwPass').focus(), 30);
  // offer self sign-up only while the admin allows it
  $('nwSignupShow').hidden = true;
  try {
    const r = await fetch('/api/signup-status');
    if (r.ok) $('nwSignupShow').hidden = !(await r.json()).open;
  } catch { /* stays hidden */ }
}

let newSession = null;
$('nwSignupShow').addEventListener('click', () => { showCard('nwSignupForm'); $('nwSignupErr').textContent = ''; setTimeout(() => $('nwSignupName').focus(), 30); });
$('nwSignupBack').addEventListener('click', () => showCard('nwLoginForm'));
$('nwSignupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('nwSignupErr');
  err.textContent = '';
  try {
    const r = await fetch('/api/signup', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: $('nwSignupName').value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = data.error || 'Could not make a code.'; return; }
    newSession = data;
    $('nwCodeShow').textContent = fmtCode(data.code);
    showCard('nwCodeCard');
  } catch {
    err.textContent = 'Could not reach the server.';
  }
});
$('nwCodeCopy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('nwCodeShow').textContent.replace(/\s/g, '')); $('nwCodeCopy').textContent = 'Copied'; } catch { $('nwCodeCopy').textContent = 'Select the code above to copy it'; }
});
$('nwCodeGo').addEventListener('click', () => { if (newSession) launch(newSession); });

$('nwLoginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('nwLoginErr');
  err.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('nwPass').value }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = data.error || 'That code was not accepted.'; return; }
    launch(data);
  } catch {
    err.textContent = 'Could not reach the server.';
  }
});
$('nwLoginCancel').addEventListener('click', () => { $('nwLogin').hidden = true; $('nwQuery').value = ''; });

// ---------------------------------------------------------------- solver
function showResult(q) {
  const box = $('nwResult');
  box.hidden = false;
  try {
    const r = solve(q);
    const working = r.steps.map((s, i) => `<li>${i ? '= ' : ''}${escapeHtml(s)}</li>`).join('');
    box.innerHTML = `<div class="nw-answer">${escapeHtml(r.answer)}${r.decimal !== null ? ` <small>≈ ${r.decimal}</small>` : ''}</div>
      <h4>Working</h4><ol class="nw-steps">${working}</ol>`;
  } catch (e) {
    box.innerHTML = `<div class="nw-error">${escapeHtml(e.message)}</div>`;
  }
}

$('nwSearch').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('nwQuery').value;
  if (SECRET.test(q.replace(/\s+/g, '').replace(/＋/g, '+'))) { openGame(); return; }
  showResult(q);
});
document.querySelectorAll('.nw-examples button').forEach((b) => b.addEventListener('click', () => {
  $('nwQuery').value = b.dataset.q;
  showResult(b.dataset.q);
}));

// ---------------------------------------------------------------- practice
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[rnd(0, arr.length - 1)];
const GEN = {
  mental() {
    const op = pick(['+', '−', '×']);
    if (op === '+') { const a = rnd(12, 99), b = rnd(12, 99); return [`${a} + ${b}`, a + b]; }
    if (op === '−') { const a = rnd(30, 150), b = rnd(5, a); return [`${a} − ${b}`, a - b]; }
    const a = rnd(3, 25), b = rnd(3, 12); return [`${a} × ${b}`, a * b];
  },
  tables() { const a = rnd(2, 12), b = rnd(2, 12); return [`${a} × ${b}`, a * b]; },
  fractions() {
    const d = pick([2, 3, 4, 5, 8, 10]), n = rnd(1, d - 1), whole = d * rnd(2, 15);
    return [`${n}/${d} of ${whole}`, (whole / d) * n];
  },
  percent() {
    const p = pick([5, 10, 15, 20, 25, 30, 40, 50, 75]), x = pick([20, 40, 60, 80, 120, 160, 200, 240, 360, 400]);
    return [`${p}% of ${x}`, (p * x) / 100];
  },
};
let topic = 'mental', current = null, streak = 0;
let best = 0;
try { best = Number(localStorage.getItem('nw-best')) || 0; } catch { /* private mode */ }
$('nwBest').textContent = best;

function nextQuestion() {
  current = GEN[topic]();
  $('nwQuestion').textContent = `${current[0]} = ?`;
  $('nwAnswer').value = '';
}
$('nwTopics').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  topic = b.dataset.topic;
  document.querySelectorAll('#nwTopics button').forEach((x) => x.classList.toggle('on', x === b));
  $('nwFeedback').textContent = '';
  nextQuestion();
});
$('nwAnswerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const given = Number($('nwAnswer').value.replace(/[−–]/g, '-').trim());
  const fb = $('nwFeedback');
  if (Math.abs(given - current[1]) < 1e-9) {
    streak++;
    if (streak > best) { best = streak; try { localStorage.setItem('nw-best', best); } catch { /* ignore */ } }
    fb.textContent = pick(['Correct!', 'Spot on.', 'Nicely done.', 'Yes – keep going!']);
    fb.className = 'nw-feedback good';
  } else {
    fb.textContent = `Not quite: ${current[0]} = ${current[1]}.`;
    fb.className = 'nw-feedback bad';
    streak = 0;
  }
  $('nwStreak').textContent = streak;
  $('nwBest').textContent = best;
  nextQuestion();
});
nextQuestion();

// ---------------------------------------------------------------- times tables grid
const grid = $('nwTable');
for (let r = 0; r <= 12; r++) {
  for (let c = 0; c <= 12; c++) {
    const cell = document.createElement('div');
    if (r === 0 && c === 0) cell.textContent = '×';
    else if (r === 0 || c === 0) { cell.textContent = r || c; cell.className = 'h'; }
    else { cell.textContent = r * c; cell.dataset.r = r; cell.dataset.c = c; }
    grid.appendChild(cell);
  }
}
const hl = (e) => {
  const t = e.target.closest('[data-r]');
  grid.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
  if (!t) return;
  const r = +t.dataset.r, c = +t.dataset.c;
  grid.querySelectorAll('[data-r]').forEach((x) => { if (+x.dataset.r === r && +x.dataset.c <= c || +x.dataset.c === c && +x.dataset.r <= r) x.classList.add('on'); });
  $('nwTableSum').textContent = `${r} × ${c} = ${r * c}`;
};
grid.addEventListener('mouseover', hl);
grid.addEventListener('click', hl);
