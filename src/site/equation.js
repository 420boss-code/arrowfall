// Linear equations in one unknown, solved the way you would on paper: simplify each side, collect
// the unknown on the left, the numbers on the right, then divide. Fractions stay exact.
//   e.g. 2x + 3 = 11,  3(x − 2) = 2x + 5,  x/4 − 1 = 2,  solve 5 − 2y = 3y + 20

// ---------------------------------------------------------------- exact fractions
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const LIMIT = 1e12;
function Q(n, d = 1) {
  if (d === 0) throw new Error("You can't divide by zero.");
  if (!Number.isInteger(n) || !Number.isInteger(d) || Math.abs(n) > LIMIT || Math.abs(d) > LIMIT) throw new Error('Those numbers are too big (or not exact) for the equation solver.');
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const add = (a, b) => Q(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => Q(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a, b) => Q(a.n * b.n, a.d * b.d);
const div = (a, b) => { if (b.n === 0) throw new Error("You can't divide by zero."); return Q(a.n * b.d, a.d * b.n); };
const isZero = (a) => a.n === 0;
const isOne = (a) => a.n === 1 && a.d === 1;
const neg = (a) => Q(-a.n, a.d);
const decimalQ = (s) => { const [i, f = ''] = s.split('.'); const d = 10 ** f.length; return Q(Number(i || 0) * d + Number(f || 0), d); };

const fmtQ = (a) => (a.d === 1 ? String(Math.abs(a.n)) : `${Math.abs(a.n)}/${a.d}`);
const signed = (a) => (a.n < 0 ? `−${fmtQ(a)}` : fmtQ(a));

// a·v + b
function show(L, v) {
  const parts = [];
  if (!isZero(L.a)) {
    const c = isOne(L.a) || isOne(neg(L.a)) ? '' : L.a.d === 1 ? fmtQ(L.a) : `(${fmtQ(L.a)})`;
    parts.push(`${L.a.n < 0 ? '−' : ''}${c}${v}`);
  }
  if (!isZero(L.b) || !parts.length) {
    if (!parts.length) parts.push(signed(L.b));
    else parts.push(`${L.b.n < 0 ? '−' : '+'} ${fmtQ(L.b)}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------- parsing (linear only)
function tokenise(src, v) {
  const out = [];
  const s = src.replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; const t = s.slice(i, j); if ((t.match(/\./g) || []).length > 1) throw new Error(`"${t}" is not a number.`); out.push({ t: 'num', v: decimalQ(t) }); i = j; continue; }
    if (c === v) { out.push({ t: 'var' }); i++; continue; }
    if ('+-*/()'.includes(c)) { out.push({ t: c }); i++; continue; }
    if (c === '^') throw new Error('The equation solver handles linear equations (no powers of the unknown).');
    throw new Error(`I don't understand "${c}" in that equation.`);
  }
  return out;
}

function parseSide(tokens) {
  let i = 0;
  const peek = () => tokens[i], take = () => tokens[i++];
  const lin = (a, b) => ({ a, b });
  function expr() {
    let L = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) {
      const op = take().t, R = term();
      L = op === '+' ? lin(add(L.a, R.a), add(L.b, R.b)) : lin(sub(L.a, R.a), sub(L.b, R.b));
    }
    return L;
  }
  function times(A, B) {
    if (!isZero(A.a) && !isZero(B.a)) throw new Error('That has the unknown multiplied by itself, so it is not linear.');
    return isZero(A.a) ? lin(mul(A.b, B.a), mul(A.b, B.b)) : lin(mul(A.a, B.b), mul(A.b, B.b));
  }
  function term() {
    let L = factor();
    for (;;) {
      const t = peek();
      if (t && (t.t === '*' || t.t === '/')) {
        take();
        const R = factor();
        if (t.t === '*') L = times(L, R);
        else { if (!isZero(R.a)) throw new Error('Dividing by the unknown makes it non-linear.'); L = lin(div(L.a, R.b), div(L.b, R.b)); }
      } else if (t && (t.t === 'num' || t.t === 'var' || t.t === '(')) L = times(L, factor()); // 2x, 3(x+1), (x+1)2
      else return L;
    }
  }
  function factor() {
    const t = take();
    if (!t) throw new Error('That equation ends too soon.');
    if (t.t === 'num') return lin(Q(0), t.v);
    if (t.t === 'var') return lin(Q(1), Q(0));
    if (t.t === '-') { const F = factor(); return lin(neg(F.a), neg(F.b)); }
    if (t.t === '+') return factor();
    if (t.t === '(') { const L = expr(); if (!peek() || take().t !== ')') throw new Error('A bracket is missing.'); return L; }
    throw new Error('Something is in the wrong place in that equation.');
  }
  const L = expr();
  if (i < tokens.length) throw new Error('Something is in the wrong place in that equation.');
  return L;
}

// ---------------------------------------------------------------- solving
const FUNCS = /sqrt|sin|cos|tan|pi/gi;

// Is this an equation we should handle? Returns the unknown's letter, or null.
export function equationVariable(input) {
  const s = input.replace(/^\s*solve\s*:?\s*/i, '');
  if ((s.match(/=/g) || []).length !== 1) return null;
  const letters = new Set(s.replace(FUNCS, '').toLowerCase().match(/[a-z]/g) || []);
  return letters.size === 1 ? [...letters][0] : null;
}

export function solveEquation(input) {
  const v = equationVariable(input);
  const src = input.replace(/^\s*solve\s*:?\s*/i, '').toLowerCase();
  const [lhsS, rhsS] = src.split('=');
  if (!lhsS.trim() || !rhsS.trim()) throw new Error('Both sides of the equation need something on them.');
  const L = parseSide(tokenise(lhsS, v)), R = parseSide(tokenise(rhsS, v));
  const steps = [];
  const eq = (A, B) => `${show(A, v)} = ${show(B, v)}`;
  const tidy = (t) => t.trim().replace(/\s+/g, '').replace(/([^(+\-*/=])([+\-])/g, '$1 $2 ').replace(/\*/g, ' × ').replace(/-/g, '−');
  const tidyIn = `${tidy(lhsS)} = ${tidy(rhsS)}`;
  steps.push({ why: 'Start', eq: tidyIn });
  let A = L, B = R;
  if (eq(A, B).replace(/\s/g, '') !== tidyIn.replace(/\s/g, '').replace(/×/g, '')) steps.push({ why: src.includes('(') ? 'Expand the brackets and simplify each side' : 'Simplify each side', eq: eq(A, B) });
  // unknowns to the left
  if (!isZero(B.a)) {
    const k = B.a;
    const term = `${isOne(k) || isOne(neg(k)) ? '' : fmtQ(k)}${v}`;
    A = { a: sub(A.a, k), b: A.b }; B = { a: Q(0), b: B.b };
    steps.push({ why: k.n > 0 ? `Subtract ${term} from both sides` : `Add ${term} to both sides`, eq: eq(A, B) });
  }
  if (isZero(A.a)) {
    const same = A.b.n === B.b.n && A.b.d === B.b.d;
    return { steps, answer: same ? `True for every value of ${v}` : 'No solution', note: same ? 'Both sides are always equal.' : `The ${v} terms cancel and leave a false statement, so no value of ${v} works.` };
  }
  // numbers to the right
  if (!isZero(A.b)) {
    const k = A.b;
    B = { a: Q(0), b: sub(B.b, k) }; A = { a: A.a, b: Q(0) };
    steps.push({ why: k.n > 0 ? `Subtract ${fmtQ(k)} from both sides` : `Add ${fmtQ(k)} to both sides`, eq: eq(A, B) });
  }
  // divide by the coefficient
  if (!isOne(A.a)) {
    const k = A.a;
    B = { a: Q(0), b: div(B.b, k) };
    const why = k.d !== 1 && Math.abs(k.n) === 1 ? `Multiply both sides by ${k.n < 0 ? '−' : ''}${k.d}` : `Divide both sides by ${signed(k)}`;
    steps.push({ why, eq: `${v} = ${signed(B.b)}` });
  }
  const x = B.b;
  const check = `Check: with ${v} = ${signed(x)}, the left side is ${signed(add(mul(L.a, x), L.b))} and the right side is ${signed(add(mul(R.a, x), R.b))}.`;
  return { steps, answer: `${v} = ${signed(x)}`, decimal: x.d !== 1 ? +(x.n / x.d).toPrecision(10) : null, note: check };
}
