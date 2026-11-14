// A small arithmetic solver that shows its working. Fractions stay exact (rational arithmetic);
// square roots and fractional powers fall back to decimals.
//   supports: + − × ÷ * / ^ ( ) %, unary minus, sqrt()/√, π/pi, sin cos tan and their inverses
//   (in degrees, as in school), implicit multiplication like 2(3+4) or 2π

// ---------------------------------------------------------------- numbers
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const SAFE = 1e15;

function frac(n, d = 1) {
  if (d === 0) throw new Error("You can't divide by zero.");
  if (!Number.isInteger(n) || !Number.isInteger(d) || Math.abs(n) > SAFE || Math.abs(d) > SAFE) return { f: n / d };
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
const val = (x) => ('f' in x ? x.f : x.n / x.d);
function fromDecimal(s) {
  const [i, f = ''] = s.split('.');
  const d = 10 ** f.length;
  return frac(Number(i || 0) * d + Number(f || 0), d);
}
const exact = (a, b) => !('f' in a) && !('f' in b);
const OPS = {
  '+': (a, b) => (exact(a, b) ? frac(a.n * b.d + b.n * a.d, a.d * b.d) : { f: val(a) + val(b) }),
  '-': (a, b) => (exact(a, b) ? frac(a.n * b.d - b.n * a.d, a.d * b.d) : { f: val(a) - val(b) }),
  '*': (a, b) => (exact(a, b) ? frac(a.n * b.n, a.d * b.d) : { f: val(a) * val(b) }),
  '/': (a, b) => {
    if (val(b) === 0) throw new Error("You can't divide by zero.");
    return exact(a, b) ? frac(a.n * b.d, a.d * b.n) : { f: val(a) / val(b) };
  },
  '^': (a, b) => {
    if (exact(a, b) && b.d === 1 && Math.abs(b.n) <= 64) {
      const p = Math.abs(b.n);
      const r = frac(a.n ** p, a.d ** p);
      return b.n >= 0 ? r : OPS['/'](frac(1), r);
    }
    const r = Math.pow(val(a), val(b));
    if (!Number.isFinite(r)) throw new Error('That number is too big (or not a real number).');
    return { f: r };
  },
};
function sqrtOf(a) {
  if (val(a) < 0) throw new Error('Negative numbers have no real square root.');
  if (!('f' in a)) {
    const rn = Math.round(Math.sqrt(a.n)), rd = Math.round(Math.sqrt(a.d));
    if (rn * rn === a.n && rd * rd === a.d) return frac(rn, rd);
  }
  return { f: Math.sqrt(val(a)) };
}

// Trig in degrees. Results within 1e-12 of a whole or half are snapped, so sin(30) is exactly 0.5.
function trig(name, x) {
  const R = Math.PI / 180;
  let r;
  if (name === 'tan' && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-9) throw new Error(`tan ${x}° is undefined (cos ${x}° = 0).`);
  if ((name === 'asin' || name === 'acos') && Math.abs(x) > 1) throw new Error(`${name} only takes values from −1 to 1.`);
  switch (name) {
    case 'sin': r = Math.sin(x * R); break;
    case 'cos': r = Math.cos(x * R); break;
    case 'tan': r = Math.tan(x * R); break;
    case 'asin': r = Math.asin(x) / R; break;
    case 'acos': r = Math.acos(x) / R; break;
    case 'atan': r = Math.atan(x) / R; break;
  }
  const snap = Math.round(r * 2) / 2;
  if (Math.abs(r - snap) < 1e-12) r = snap;
  return Number.isInteger(r * 2) && Math.abs(r) < 1e6 ? frac(r * 2, 2) : { f: r };
}

export function formatNum(x) {
  if ('f' in x) {
    const r = Math.round(x.f * 1e10) / 1e10;
    return Number.isInteger(r) ? String(r) : String(+r.toPrecision(10));
  }
  return x.d === 1 ? String(x.n) : `${x.n}/${x.d}`;
}

// ---------------------------------------------------------------- parsing
function tokenise(src) {
  const s = src.replace(/[×xX]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/√/g, 'sqrt').replace(/²/g, '^2').replace(/³/g, '^3').replace(/°/g, '').replace(/\s+/g, '').toLowerCase().replace(/=$/, '');
  if (!s) throw new Error('Type a sum to solve.');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const num = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: num[1] }); i += num[1].length; continue; }
    if (s.startsWith('sqrt', i)) { out.push({ t: 'sqrt' }); i += 4; continue; }
    const fn = ['asin', 'acos', 'atan', 'sin', 'cos', 'tan'].find((f) => s.startsWith(f, i));
    if (fn) { out.push({ t: 'fn', name: fn }); i += fn.length; continue; }
    if (s.startsWith('pi', i)) { out.push({ t: 'pi' }); i += 2; continue; }
    if (c === 'π') { out.push({ t: 'pi' }); i++; continue; }
    if ('+-*/^()%'.includes(c)) { out.push({ t: c }); i++; continue; }
    throw new Error(`Numberwell doesn't understand "${c}" yet.`);
  }
  // implicit multiplication: 2(…), )(…), )2, 2sqrt
  const res = [];
  for (let k = 0; k < out.length; k++) {
    const prev = res[res.length - 1], cur = out[k];
    if (prev && (prev.t === 'num' || prev.t === ')' || prev.t === '%' || prev.t === 'pi') && (cur.t === '(' || cur.t === 'sqrt' || cur.t === 'fn' || cur.t === 'pi' || (cur.t === 'num' && prev.t !== 'num'))) res.push({ t: '*' });
    res.push(cur);
  }
  return res;
}

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  const eat = (t) => { if (!peek() || peek().t !== t) throw new Error('Check your brackets and operators.'); p++; };
  function expr() {
    let n = term();
    while (peek() && (peek().t === '+' || peek().t === '-')) { const op = tokens[p++].t; n = { k: 'bin', op, a: n, b: term() }; }
    return n;
  }
  function term() {
    let n = unary();
    while (peek() && (peek().t === '*' || peek().t === '/')) { const op = tokens[p++].t; n = { k: 'bin', op, a: n, b: unary() }; }
    return n;
  }
  function unary() {
    if (peek() && peek().t === '-') { p++; return { k: 'neg', a: unary() }; }
    if (peek() && peek().t === '+') { p++; return unary(); }
    return power();
  }
  function power() {
    const base = postfix();
    if (peek() && peek().t === '^') { p++; return { k: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function postfix() {
    let n = primary();
    while (peek() && peek().t === '%') { p++; n = { k: 'pct', a: n }; }
    return n;
  }
  function primary() {
    const t = peek();
    if (!t) throw new Error('That sum looks unfinished.');
    if (t.t === 'num') { p++; return { k: 'num', v: fromDecimal(t.v) }; }
    if (t.t === '(') { p++; const e = expr(); eat(')'); return { k: 'par', a: e }; }
    if (t.t === 'sqrt') { p++; return { k: 'sqrt', a: primary() }; }
    if (t.t === 'fn') { p++; return { k: 'fn', name: t.name, a: primary() }; }
    if (t.t === 'pi') { p++; return { k: 'pi' }; }
    throw new Error('Check your brackets and operators.');
  }
  const tree = expr();
  if (p < tokens.length) throw new Error('Check your brackets and operators.');
  return tree;
}

// ---------------------------------------------------------------- working
const SYM = { '+': ' + ', '-': ' − ', '*': ' × ', '/': ' ÷ ', '^': '^' };
function show(n) {
  switch (n.k) {
    case 'num': { const s = formatNum(n.v); return s.includes('/') || s.startsWith('-') ? `(${s})` : s; }
    case 'par': return n.a.k === 'num' ? show(n.a) : `(${show(n.a)})`;
    case 'neg': return `−${show(n.a)}`;
    case 'pct': return `${show(n.a)}%`;
    case 'sqrt': return `√${n.a.k === 'par' || n.a.k === 'num' ? show(n.a) : `(${show(n.a)})`}`;
    case 'pi': return 'π';
    case 'fn': { const inner = n.a.k === 'par' ? n.a.a : n.a; return `${n.name}(${inner.k === 'num' ? formatNum(inner.v) : show(inner)})`; }
    case 'bin': return `${show(n.a)}${SYM[n.op]}${show(n.b)}`;
  }
  return '';
}

// Reduce the first operation whose inputs are already numbers (BIDMAS order falls out of the tree).
function reduceOnce(n) {
  if (n.k === 'num') return null;
  if (n.k === 'par') {
    if (n.a.k === 'num') return n.a;
    const r = reduceOnce(n.a); return r && { k: 'par', a: r };
  }
  for (const key of ['a', 'b']) {
    if (n[key] && n[key].k !== 'num') {
      const r = reduceOnce(n[key]);
      if (r) return { ...n, [key]: r };
    }
  }
  switch (n.k) {
    case 'neg': return { k: 'num', v: OPS['*'](frac(-1), n.a.v) };
    case 'pct': return { k: 'num', v: OPS['/'](n.a.v, frac(100)) };
    case 'sqrt': return { k: 'num', v: sqrtOf(n.a.v) };
    case 'pi': return { k: 'num', v: { f: Math.PI } };
    case 'fn': return { k: 'num', v: trig(n.name, val(n.a.v)) };
    case 'bin': return { k: 'num', v: OPS[n.op](n.a.v, n.b.v) };
  }
  return null;
}

export function solve(input) {
  let tree = parse(tokenise(input));
  const steps = [show(tree)];
  for (let guard = 0; guard < 60 && tree.k !== 'num'; guard++) {
    tree = reduceOnce(tree);
    const s = show(tree);
    if (s !== steps[steps.length - 1]) steps.push(s);
  }
  const v = tree.v;
  const answer = formatNum(v);
  const decimal = !('f' in v) && v.d !== 1 ? +(v.n / v.d).toPrecision(10) : null;
  return { steps, answer, decimal };
}
