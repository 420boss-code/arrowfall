// Numberwell: a working maths solver and practice page. Searching "1+1" opens Arrowfall.
import './site/site.css';
import { solve } from './site/solver.js';
import { solveEquation, equationVariable } from './site/equation.js';
import { mountResources } from './site/resources.js';
import { escapeHtml } from './core/utils.js';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- the way in
const SECRET = /^1\+1=?$/;
const ADMIN_SECRET = /^1\+1\+1\+1=?$/;
let unlocked = false;
let adminShortcutPending = false;

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
  window.__afOpenAdmin = adminShortcutPending && session.role === 'admin';
  adminShortcutPending = false;
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
  $('nwGuest').hidden = true;
  try {
    const r = await fetch('/api/signup-status');
    if (r.ok) { const st = await r.json(); $('nwSignupShow').hidden = !st.open; $('nwGuest').hidden = !st.guests; }
  } catch { /* stays hidden */ }
}

// guests get a one-day session with no number: they can join games but not create them
$('nwGuest').addEventListener('click', async () => {
  const err = $('nwLoginErr');
  err.textContent = '';
  try {
    const r = await fetch('/api/guest', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remember: $('nwRemember').checked }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = data.error || 'That is not available right now.'; return; }
    launch(data);
  } catch {
    err.textContent = 'Could not reach the server.';
  }
});

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
      body: JSON.stringify({ name: $('nwSignupName').value, remember: $('nwRemember').checked }),
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
      body: JSON.stringify({ password: $('nwPass').value, remember: $('nwRemember').checked }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = data.error || 'That code was not accepted.'; return; }
    launch(data);
  } catch {
    err.textContent = 'Could not reach the server.';
  }
});
$('nwLoginCancel').addEventListener('click', () => { adminShortcutPending = false; $('nwLogin').hidden = true; $('nwQuery').value = ''; });

// ---------------------------------------------------------------- solver
// "15% of 80" reads as 15% × 80
const normalise = (q) => q.replace(/\bof\b/gi, '*');

function showResult(q) {
  const box = $('nwResult');
  box.hidden = false;
  try {
    if (equationVariable(q)) {
      const r = solveEquation(q);
      const steps = r.steps.map((st) => `<li><span class="nw-why">${escapeHtml(st.why)}</span>${escapeHtml(st.eq)}</li>`).join('');
      box.innerHTML = `<div class="nw-answer">${escapeHtml(r.answer)}${r.decimal !== null && r.decimal !== undefined ? ` <small>≈ ${r.decimal}</small>` : ''}</div>
        <h4>Working</h4><ol class="nw-steps nw-eq">${steps}</ol>${r.note ? `<p class="nw-check">${escapeHtml(r.note)}</p>` : ''}`;
      return;
    }
    const r = solve(normalise(q));
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
  showResult(q);
  // The four-ones shortcut only opens the admin panel after an admin has authenticated.
  const expression = q.replace(/\s+/g, '').replace(/＋/g, '+');
  const adminShortcut = ADMIN_SECRET.test(expression);
  if (adminShortcut) adminShortcutPending = true;
  if (SECRET.test(expression) || adminShortcut) setTimeout(openGame, 650);
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
  angles() {
    const kind = pick(['line', 'triangle', 'point']);
    if (kind === 'line') { const a = rnd(15, 165); return [`Angles on a straight line: ${a}° and x°. x`, 180 - a]; }
    if (kind === 'triangle') { const a = rnd(20, 100), b = rnd(20, 160 - a); return [`A triangle has angles ${a}°, ${b}° and x°. x`, 180 - a - b]; }
    const a = rnd(60, 150), b = rnd(40, 300 - a - 10); return [`Around a point: ${a}°, ${b}° and x°. x`, 360 - a - b];
  },
  trig() {
    const [q, ans] = pick([['sin 30°', 0.5], ['cos 60°', 0.5], ['tan 45°', 1], ['sin 90°', 1], ['cos 0°', 1], ['sin 0°', 0], ['cos 90°', 0], ['tan 0°', 0], ['sin 150°', 0.5], ['cos 180°', -1]]);
    return [q, ans];
  },
  percent() {
    const p = pick([5, 10, 15, 20, 25, 30, 40, 50, 75]), x = pick([20, 40, 60, 80, 120, 160, 200, 240, 360, 400]);
    return [`${p}% of ${x}`, (p * x) / 100];
  },
  equations() {
    const x = rnd(-6, 12), a = rnd(2, 9), b = rnd(1, 20) * pick([1, -1]);
    const num = (n) => (n < 0 ? `−${-n}` : `${n}`);
    const lin = (k, c) => `${k === 1 ? '' : k}x ${c < 0 ? '−' : '+'} ${Math.abs(c)}`;
    if (Math.random() < 0.35) { const c = rnd(1, a - 1), d = a * x + b - c * x; return [`Solve ${lin(a, b)} = ${d === 0 ? `${c === 1 ? '' : c}x` : lin(c, d)}. x`, x]; }
    return [`Solve ${lin(a, b)} = ${num(a * x + b)}. x`, x];
  },
};
GEN.mixed = () => GEN[pick(['mental', 'fractions', 'percent', 'equations', 'angles', 'tables'])]();
// questions answered today (kept in this browser)
const todayKey = () => new Date().toISOString().slice(0, 10);
let today = 0;
try { const t = JSON.parse(localStorage.getItem('nw-today') || '{}'); today = t.d === todayKey() ? t.n : 0; } catch { /* ignore */ }
$('nwToday').textContent = today;
let topic = 'mental', current = null, streak = 0;
let best = 0, quiz = null, quizTimer = null, quizSummary = '', answered = false;
try { best = Number(localStorage.getItem('nw-best')) || 0; } catch { /* private mode */ }
$('nwBest').textContent = best;

function updateQuizStatus() {
  const status = $('nwQuizStatus');
  if (!quiz) { status.textContent = quizSummary || 'Practice mode'; return; }
  if (quiz.kind === 'timed') {
    const left = Math.max(0, Math.ceil((quiz.endAt - Date.now()) / 1000));
    status.textContent = `60-second challenge · ${quiz.score} correct · ${left}s left`;
  } else status.textContent = `Question ${Math.min(quiz.answered + 1, quiz.total)} of ${quiz.total} · ${quiz.score} correct`;
}

function nextQuestion() {
  current = GEN[topic]();
  $('nwQuestion').textContent = /\. x$/.test(current[0]) ? `${current[0].slice(0, -2)}  x = ?` : `${current[0]} = ?`;
  $('nwAnswer').value = '';
  $('nwAnswer').disabled = false;
  $('nwCheck').disabled = false;
  $('nwNext').hidden = true;
  $('nwNext').textContent = 'Next question';
  $('nwHint').hidden = true;
  $('nwHintToggle').textContent = 'Show a hint';
  answered = false;
  $('nwAnswer').focus();
  updateQuizStatus();
}

function endQuiz() {
  if (!quiz) return;
  clearInterval(quizTimer); quizTimer = null;
  const finished = quiz;
  quiz = null;
  const total = finished.kind === 'timed' ? finished.answered : finished.total;
  const percent = total ? Math.round(finished.score / total * 100) : 0;
  quizSummary = total ? `Quiz complete · ${finished.score}/${total} correct (${percent}%)` : 'Challenge over · no answers yet';
  $('nwQuizStatus').textContent = quizSummary;
  $('nwFeedback').textContent = quizSummary;
  $('nwFeedback').className = 'nw-feedback good';
  $('nwNext').hidden = true;
  $('nwAnswer').disabled = true;
  $('nwCheck').disabled = true;
}

function startQuiz(kind, total = 10) {
  clearInterval(quizTimer); quizTimer = null;
  quiz = { kind, total, answered: 0, score: 0, endAt: kind === 'timed' ? Date.now() + 60000 : 0 };
  quizSummary = '';
  $('nwFeedback').textContent = '';
  nextQuestion();
  if (kind === 'timed') quizTimer = setInterval(() => {
    if (quiz && Date.now() >= quiz.endAt) endQuiz();
    else updateQuizStatus();
  }, 250);
}
$('nwQuiz10').addEventListener('click', () => startQuiz('counted', 10));
$('nwTimedQuiz').addEventListener('click', () => startQuiz('timed'));
$('nwNext').addEventListener('click', () => {
  if (!answered) return;
  if (quiz && quiz.kind === 'counted' && quiz.answered >= quiz.total) { endQuiz(); return; }
  nextQuestion();
});
$('nwHintToggle').addEventListener('click', () => {
  const hint = $('nwHint');
  if (hint.hidden) {
    hint.textContent = ({
      mental: 'Split the numbers into tens and ones, or use a nearby easy number.',
      tables: 'Use a nearby multiplication fact you already know.',
      fractions: 'Divide the amount by the denominator, then multiply by the numerator.',
      percent: 'Find 10% first, then scale it up or down to the percentage asked.',
      equations: 'Undo the same operations on both sides until x is on its own.',
      angles: 'Use the total: a straight line is 180°, a triangle 180°, and around a point 360°.',
      trig: 'Use the special-angle values on the unit circle.',
    })[topic];
    hint.hidden = false;
    $('nwHintToggle').textContent = 'Hide hint';
  } else {
    hint.hidden = true;
    $('nwHintToggle').textContent = 'Show a hint';
  }
});
$('nwTopics').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  topic = b.dataset.topic;
  document.querySelectorAll('#nwTopics button').forEach((x) => x.classList.toggle('on', x === b));
  $('nwFeedback').textContent = '';
  if (quiz) { quizSummary = ''; }
  nextQuestion();
});
$('nwAnswerForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (answered || !current) return;
  const raw = $('nwAnswer').value.replace(/[−–]/g, '-').trim();
  const given = Number(raw);
  const fb = $('nwFeedback');
  if (!raw || !Number.isFinite(given)) { fb.textContent = 'Enter a number to check your answer.'; fb.className = 'nw-feedback bad'; return; }
  const correct = Math.abs(given - current[1]) < 1e-9;
  answered = true;
  $('nwAnswer').disabled = true;
  $('nwCheck').disabled = true;
  $('nwNext').hidden = false;
  if (quiz) {
    quiz.answered++;
    if (correct) quiz.score++;
  }
  if (correct) {
    streak++;
    if (streak > best) { best = streak; try { localStorage.setItem('nw-best', best); } catch { /* ignore */ } }
    fb.textContent = pick(['Correct!', 'Spot on.', 'Nicely done.', 'Yes – keep going!']);
    fb.className = 'nw-feedback good';
  } else {
    fb.textContent = `Not quite: ${current[0]} = ${current[1]}. Try the next one.`;
    fb.className = 'nw-feedback bad';
    streak = 0;
  }
  $('nwStreak').textContent = streak;
  $('nwBest').textContent = best;
  today++;
  $('nwToday').textContent = today;
  try { localStorage.setItem('nw-today', JSON.stringify({ d: todayKey(), n: today })); } catch { /* ignore */ }
  if (quiz && quiz.kind === 'counted' && quiz.answered >= quiz.total) $('nwNext').textContent = 'See results';
  updateQuizStatus();
});
nextQuestion();

// Live percentage tool
function updatePercentTool() {
  const rateText = $('pctRate').value.trim(), amountText = $('pctAmount').value.trim();
  const rate = Number(rateText), amount = Number(amountText), action = $('pctAction').value;
  const out = $('pctResult');
  if (!rateText || !amountText || !Number.isFinite(rate) || !Number.isFinite(amount)) { out.textContent = 'Enter valid numbers to see the result.'; return; }
  let result, formula;
  if (action === 'of') { result = amount * rate / 100; formula = `${rate}% × ${amount}`; }
  else if (action === 'increase') { result = amount * (1 + rate / 100); formula = `${amount} × (1 + ${rate}/100)`; }
  else if (action === 'decrease') { result = amount * (1 - rate / 100); formula = `${amount} × (1 − ${rate}/100)`; }
  else {
    const factor = 1 + rate / 100;
    if (factor === 0) { out.textContent = 'A 100% decrease cannot be reversed from zero.'; return; }
    result = amount / factor; formula = `${amount} ÷ (1 + ${rate}/100)`;
  }
  const answer = String(Number(result.toFixed(6)));
  out.textContent = `${formula} = ${answer}`;
}
['pctAction', 'pctRate', 'pctAmount'].forEach((id) => $(id).addEventListener('input', updatePercentTool));
$('pctAction').addEventListener('change', updatePercentTool);
updatePercentTool();
mountResources();

// ---------------------------------------------------------------- worksheets
let sheet = null;
function makeWorksheet() {
  const topic = $('wsTopic').value, count = Number($('wsCount').value);
  const seen = new Set(), qs = [];
  for (let guard = 0; qs.length < count && guard < count * 20; guard++) {
    const [q, a] = GEN[topic]();
    if (seen.has(q)) continue;
    seen.add(q); qs.push([q, a]);
  }
  sheet = qs;
  const title = $('wsTitle').value.trim() || `${$('wsTopic').selectedOptions[0].text} – ${count} questions`;
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  // "Solve 3x + 4 = 19. x" and "…angles 40° and x°. x" end by naming the unknown; sums just need "= ___"
  const ask = (q) => (/\. x$/.test(q) ? `${escapeHtml(q.slice(0, -2))} <span class="nw-ws-line">x = ________</span>` : `${escapeHtml(q)} = ________`);
  $('wsSheet').innerHTML = `
    <div class="nw-ws-page">
      <div class="nw-ws-head"><div><h3>${escapeHtml(title)}</h3><div class="nw-ws-meta">Name: ______________________ &nbsp; Date: ${date}</div></div><div class="nw-ws-logo">Σ Numberwell</div></div>
      <ol class="nw-ws-qs">${qs.map(([q]) => `<li>${ask(q)}</li>`).join('')}</ol>
    </div>
    <div class="nw-ws-page nw-ws-key" hidden>
      <div class="nw-ws-head"><div><h3>Answers – ${escapeHtml(title)}</h3></div><div class="nw-ws-logo">Σ Numberwell</div></div>
      <ol class="nw-ws-qs">${qs.map(([, a]) => `<li>${String(+a.toFixed(4)).replace('-', '−')}</li>`).join('')}</ol>
    </div>`;
  $('wsSheet').hidden = false;
  $('wsAnswers').disabled = $('wsPrint').disabled = false;
  $('wsAnswers').textContent = 'Show answers';
}
$('wsMake').addEventListener('click', makeWorksheet);
$('wsAnswers').addEventListener('click', () => {
  const key = $('wsSheet').querySelector('.nw-ws-key');
  key.hidden = !key.hidden;
  $('wsAnswers').textContent = key.hidden ? 'Show answers' : 'Hide answers';
});
$('wsPrint').addEventListener('click', () => {
  // the answer key always prints, on its own page
  const key = $('wsSheet').querySelector('.nw-ws-key');
  const was = key.hidden;
  key.hidden = false;
  document.body.classList.add('nw-printing');
  window.print();
  document.body.classList.remove('nw-printing');
  key.hidden = was;
});

// ---------------------------------------------------------------- footer
document.querySelectorAll('[data-dlg]').forEach((b) => b.addEventListener('click', () => { const d = $(b.dataset.dlg); if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }));
$('nwYear').textContent = new Date().getFullYear();

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
