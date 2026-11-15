// Numberwell resources: Sets, Pi, Trigonometry, Angles, Statistics, Pythagoras and Ratio – notes plus
// an interactive tool for each.
const $ = (id) => document.getElementById(id);
const R = Math.PI / 180;
const fmt = (x, dp = 4) => {
  if (!Number.isFinite(x)) return '—';
  const r = Math.round(x * 10 ** dp) / 10 ** dp;
  return String(Object.is(r, -0) ? 0 : r);
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const svgPoint = (svg, e) => {
  const p = svg.createSVGPoint();
  p.x = e.clientX; p.y = e.clientY;
  return p.matrixTransform(svg.getScreenCTM().inverse());
};
// Drag on an SVG: calls fn(point) on press and while dragging.
function draggable(svg, fn) {
  let down = false;
  svg.addEventListener('pointerdown', (e) => { down = true; svg.setPointerCapture(e.pointerId); fn(svgPoint(svg, e)); });
  svg.addEventListener('pointermove', (e) => { if (down) fn(svgPoint(svg, e)); });
  svg.addEventListener('pointerup', () => { down = false; });
  svg.addEventListener('pointercancel', () => { down = false; });
}

// ---------------------------------------------------------------- content
const SECTIONS = {
  sets: {
    title: 'Sets',
    notes: `
      <p>A <b>set</b> is a collection of distinct objects, called <b>elements</b>, written in curly brackets: A = {2, 4, 6, 8}. Order doesn't matter and repeats count once, so {1, 2, 2, 3} = {1, 2, 3}.</p>
      <table class="nw-sym">
        <tr><th>Symbol</th><th>Meaning</th><th>Example</th></tr>
        <tr><td>∈</td><td>is an element of</td><td>4 ∈ {2, 4, 6}</td></tr>
        <tr><td>∉</td><td>is not an element of</td><td>5 ∉ {2, 4, 6}</td></tr>
        <tr><td>∪</td><td>union: in A <i>or</i> B (or both)</td><td>{1, 2} ∪ {2, 3} = {1, 2, 3}</td></tr>
        <tr><td>∩</td><td>intersection: in A <i>and</i> B</td><td>{1, 2} ∩ {2, 3} = {2}</td></tr>
        <tr><td>A′</td><td>complement: in the universal set ξ but not in A</td><td>ξ = {1, …, 5}, A = {1, 2} → A′ = {3, 4, 5}</td></tr>
        <tr><td>A ⊂ B</td><td>A is a subset of B (every element of A is in B)</td><td>{2, 4} ⊂ {2, 4, 6}</td></tr>
        <tr><td>∅ or { }</td><td>the empty set</td><td>{1, 2} ∩ {3, 4} = ∅</td></tr>
        <tr><td>n(A)</td><td>the number of elements in A</td><td>n({a, b, c}) = 3</td></tr>
      </table>
      <p><b>Useful rule:</b> n(A ∪ B) = n(A) + n(B) − n(A ∩ B), because the elements in both would otherwise be counted twice.</p>`,
    tool: `
      <h4>Venn diagram</h4>
      <div class="nw-form">
        <label>ξ (optional) <input id="setU" value="1, 2, 3, 4, 5, 6, 7, 8, 9, 10" /></label>
        <label>A <input id="setA" value="2, 4, 6, 8, 10" /></label>
        <label>B <input id="setB" value="3, 6, 9" /></label>
      </div>
      <div class="nw-chips" id="setOps">
        <button data-op="union">A ∪ B</button><button data-op="inter" class="on">A ∩ B</button><button data-op="aonly">A only</button><button data-op="bonly">B only</button><button data-op="outside">(A ∪ B)′</button>
      </div>
      <svg id="venn" viewBox="0 0 360 220" role="img" aria-label="Venn diagram of sets A and B"></svg>
      <div id="setOut" class="nw-out"></div>`,
  },
  pi: {
    title: 'Pi',
    notes: `
      <p><b>π</b> is the ratio of any circle's circumference to its diameter: π = C ÷ d. It is the same for every circle, and it is <b>irrational</b> – its decimals never end or repeat.</p>
      <p class="nw-digits">π = 3.14159 26535 89793 23846 26433 83279 50288 41971 69399 37510…</p>
      <table class="nw-sym">
        <tr><th>Circle</th><th>Formula</th></tr>
        <tr><td>Circumference</td><td>C = πd = 2πr</td></tr>
        <tr><td>Area</td><td>A = πr²</td></tr>
        <tr><td>Arc length (angle θ°)</td><td>(θ ÷ 360) × 2πr</td></tr>
        <tr><td>Sector area (angle θ°)</td><td>(θ ÷ 360) × πr²</td></tr>
      </table>
      <p><b>A little history:</b> Archimedes (3rd century BC) trapped π between polygons drawn inside and outside a circle. With 96 sides he showed 223/71 &lt; π &lt; 22/7, which is why 22/7 became a classroom favourite. In the 5th century Zu Chongzhi found 355/113, correct to six decimal places. Pi Day is 14 March (3/14).</p>`,
    tool: `
      <h4>Circle calculator</h4>
      <div class="nw-form"><label>Radius <input id="piR" type="number" value="5" min="0" step="any" /></label><label>Sector angle (°) <input id="piDeg" type="number" value="90" min="0" max="360" step="any" /></label></div>
      <div id="piOut" class="nw-out"></div>
      <h4>Archimedes' polygons</h4>
      <div class="nw-form"><label>Sides <input id="piN" type="range" min="3" max="96" value="6" /> <b id="piNv">6</b></label></div>
      <svg id="piSvg" viewBox="-110 -110 220 220" role="img" aria-label="Polygons inside and outside a circle"></svg>
      <div id="piPoly" class="nw-out"></div>`,
  },
  trig: {
    title: 'Trigonometry',
    notes: `
      <p>In a right-angled triangle, label the sides from the angle θ: <b>hypotenuse</b> (opposite the right angle, the longest), <b>opposite</b> (facing θ) and <b>adjacent</b> (next to θ).</p>
      <p class="nw-big">SOH CAH TOA</p>
      <table class="nw-sym">
        <tr><td>sin θ = opposite ÷ hypotenuse</td><td>cos θ = adjacent ÷ hypotenuse</td><td>tan θ = opposite ÷ adjacent</td></tr>
      </table>
      <p><b>Exact values</b> worth knowing:</p>
      <table class="nw-sym nw-exact">
        <tr><th>θ</th><th>0°</th><th>30°</th><th>45°</th><th>60°</th><th>90°</th></tr>
        <tr><td>sin θ</td><td>0</td><td>1/2</td><td>√2/2</td><td>√3/2</td><td>1</td></tr>
        <tr><td>cos θ</td><td>1</td><td>√3/2</td><td>√2/2</td><td>1/2</td><td>0</td></tr>
        <tr><td>tan θ</td><td>0</td><td>√3/3</td><td>1</td><td>√3</td><td>undefined</td></tr>
      </table>
      <p><b>Any triangle</b> (sides a, b, c opposite angles A, B, C):</p>
      <ul>
        <li>Sine rule: a ÷ sin A = b ÷ sin B = c ÷ sin C</li>
        <li>Cosine rule: a² = b² + c² − 2bc cos A</li>
        <li>Area = ½ab sin C</li>
        <li>Identity: sin²θ + cos²θ = 1, and tan θ = sin θ ÷ cos θ</li>
      </ul>
      <p>The solver above understands trig in degrees: try <code>sin(30)</code> or <code>2cos(60)</code>.</p>`,
    tool: `
      <h4>Unit circle</h4>
      <p class="nw-hint">Drag the point round the circle.</p>
      <svg id="unitSvg" viewBox="-1.45 -1.35 2.9 2.7" role="img" aria-label="Unit circle"></svg>
      <div id="unitOut" class="nw-out"></div>
      <h4>Right-angled triangle solver</h4>
      <p class="nw-hint">Fill in any two (at least one side), leave the rest blank.</p>
      <div class="nw-form nw-tri">
        <label>Angle θ (°) <input id="triA" type="number" step="any" value="35" /></label>
        <label>Opposite <input id="triO" type="number" step="any" /></label>
        <label>Adjacent <input id="triJ" type="number" step="any" /></label>
        <label>Hypotenuse <input id="triH" type="number" step="any" value="10" /></label>
      </div>
      <div id="triOut" class="nw-out"></div>`,
  },
  angles: {
    title: 'Angles',
    notes: `
      <table class="nw-sym">
        <tr><th>Type</th><th>Size</th></tr>
        <tr><td>Acute</td><td>less than 90°</td></tr>
        <tr><td>Right</td><td>exactly 90°</td></tr>
        <tr><td>Obtuse</td><td>between 90° and 180°</td></tr>
        <tr><td>Straight</td><td>exactly 180°</td></tr>
        <tr><td>Reflex</td><td>between 180° and 360°</td></tr>
        <tr><td>Full turn</td><td>360°</td></tr>
      </table>
      <p><b>Angle facts</b></p>
      <ul>
        <li>Angles on a straight line add up to 180°.</li>
        <li>Angles around a point add up to 360°.</li>
        <li>Vertically opposite angles are equal.</li>
        <li>Angles in a triangle add up to 180°; in a quadrilateral, 360°.</li>
        <li>With parallel lines: alternate angles are equal, corresponding angles are equal, and co-interior angles add up to 180°.</li>
        <li>Interior angles of an n-sided polygon add up to (n − 2) × 180°; exterior angles always add up to 360°.</li>
      </ul>
      <p><b>Radians</b> measure an angle by arc length on a circle of radius 1: a full turn is 2π radians, so 180° = π radians and 1 radian ≈ 57.3°.</p>`,
    tool: `
      <h4>Angle explorer</h4>
      <p class="nw-hint">Drag the arm to change the angle.</p>
      <svg id="angSvg" viewBox="-120 -120 240 240" role="img" aria-label="Adjustable angle"></svg>
      <div id="angOut" class="nw-out"></div>
      <h4>Degrees ⇄ radians</h4>
      <div class="nw-form"><label>Degrees <input id="degIn" type="number" step="any" value="60" /></label><label>Radians <input id="radIn" type="number" step="any" /></label></div>
      <div id="radOut" class="nw-out"></div>
      <h4>Polygon angles</h4>
      <div class="nw-form"><label>Number of sides <input id="polyN" type="number" min="3" max="1000" value="6" /></label></div>
      <div id="polyOut" class="nw-out"></div>`,
  },
  stats: {
    title: 'Statistics',
    notes: `
      <p>Four numbers summarise a list of data. For 3, 7, 7, 2, 9:</p>
      <table class="nw-sym">
        <tr><th>Measure</th><th>How to find it</th><th>Example</th></tr>
        <tr><td><b>Mean</b></td><td>add them all up and divide by how many there are</td><td>28 ÷ 5 = 5.6</td></tr>
        <tr><td><b>Median</b></td><td>put them in order; take the middle one (with an even count, halfway between the middle two)</td><td>2, 3, <b>7</b>, 7, 9 → 7</td></tr>
        <tr><td><b>Mode</b></td><td>the value that appears most often (there can be more than one, or none)</td><td>7</td></tr>
        <tr><td><b>Range</b></td><td>largest minus smallest – a measure of spread, not an average</td><td>9 − 2 = 7</td></tr>
      </table>
      <p>The mean uses every value, so one unusually large or small value (an <b>outlier</b>) can drag it a long way; the median is not affected as much. To compare two sets of data, give an average <i>and</i> the range.</p>
      <p><b>Mean from a frequency table:</b> multiply each value by its frequency, add those up, and divide by the total frequency.</p>`,
    tool: `
      <h4>Averages calculator</h4>
      <p class="nw-hint">Type numbers separated by commas or spaces.</p>
      <div class="nw-form"><label>Data <input id="statIn" value="3, 7, 7, 2, 9" /></label></div>
      <div id="statOut" class="nw-out"></div>`,
  },
  pythag: {
    title: 'Pythagoras',
    notes: `
      <p>In a right-angled triangle the longest side, opposite the right angle, is the <b>hypotenuse</b> c. <b>Pythagoras' theorem</b> says</p>
      <p class="nw-big">a² + b² = c²</p>
      <ul>
        <li><b>Finding the hypotenuse:</b> square the two shorter sides, add, then square-root. 3 and 4 give √(9 + 16) = √25 = 5.</li>
        <li><b>Finding a shorter side:</b> square the hypotenuse, <i>subtract</i> the square of the other side, then square-root. Hypotenuse 13, side 5: √(169 − 25) = √144 = 12.</li>
        <li><b>Is it right-angled?</b> If the squares of the two shorter sides add up to the square of the longest, yes.</li>
      </ul>
      <p>Whole-number answers like 3, 4, 5 and 5, 12, 13 are called <b>Pythagorean triples</b>. Any multiple of one is another: 6, 8, 10.</p>
      <p>The theorem also gives the distance between two points: from (x₁, y₁) to (x₂, y₂) is √((x₂ − x₁)² + (y₂ − y₁)²).</p>`,
    tool: `
      <h4>Find the missing side</h4>
      <p class="nw-hint">Fill in two sides and leave the one you want blank.</p>
      <div class="nw-form"><label>a <input id="pyA" type="number" step="any" min="0" value="6" /></label><label>b <input id="pyB" type="number" step="any" min="0" value="8" /></label><label>c (hypotenuse) <input id="pyC" type="number" step="any" min="0" /></label></div>
      <svg id="pySvg" viewBox="0 0 240 170" role="img" aria-label="Right-angled triangle"></svg>
      <div id="pyOut" class="nw-out"></div>`,
  },
  ratio: {
    title: 'Ratio',
    notes: `
      <p>A <b>ratio</b> compares amounts: 2 : 3 means "for every 2 of the first, 3 of the second".</p>
      <ul>
        <li><b>Simplifying:</b> divide every part by the highest common factor. 12 : 18 = 2 : 3 (dividing by 6).</li>
        <li><b>Sharing in a ratio:</b> add the parts to find the total number of parts, find one part, then multiply. Share £60 in the ratio 2 : 3 → 5 parts, one part = £12, so £24 and £36.</li>
        <li><b>Ratio to fraction:</b> in 2 : 3 the first amount is 2/5 of the total and the second is 3/5.</li>
        <li><b>Unitary method:</b> find the value of one, then scale. If 4 pens cost £3.20, one costs 80p, so 7 cost £5.60.</li>
      </ul>
      <p><b>Direct proportion</b>: when one quantity doubles, so does the other (cost and number of items). <b>Inverse proportion</b>: when one doubles, the other halves (number of workers and time taken).</p>`,
    tool: `
      <h4>Share an amount</h4>
      <div class="nw-form"><label>Amount <input id="raAmt" type="number" step="any" value="60" /></label><label>Ratio <input id="raRat" value="2 : 3" /></label></div>
      <div id="raOut" class="nw-out"></div>
      <h4>Simplify a ratio</h4>
      <div class="nw-form"><label>Ratio <input id="raSimp" value="12 : 18 : 30" /></label></div>
      <div id="raSimpOut" class="nw-out"></div>`,
  },
};

// ---------------------------------------------------------------- tools
function setsTool() {
  let op = 'inter';
  const parse = (s) => [...new Set(String(s).split(',').map((x) => x.trim()).filter(Boolean))];
  const sort = (arr) => arr.slice().sort((a, b) => (isNaN(a) || isNaN(b) ? String(a).localeCompare(String(b)) : a - b));
  const show = (arr) => (arr.length ? `{${sort(arr).map(esc).join(', ')}}` : '∅');
  function draw() {
    const U = parse($('setU').value), A = parse($('setA').value), B = parse($('setB').value);
    const inA = new Set(A), inB = new Set(B);
    const both = A.filter((x) => inB.has(x)), aOnly = A.filter((x) => !inB.has(x)), bOnly = B.filter((x) => !inA.has(x));
    const union = [...new Set([...A, ...B])];
    const outside = U.filter((x) => !inA.has(x) && !inB.has(x));
    const extra = union.filter((x) => U.length && !U.includes(x));
    const region = { union: ['a', 'b', 'ab'], inter: ['ab'], aonly: ['a'], bonly: ['b'], outside: ['out'] }[op];
    const hl = (r) => (region.includes(r) ? 'var(--hl)' : 'none');
    // shade regions using clip paths
    const place = (items, cx, cy, w) => items.slice(0, 12).map((x, i) => {
      const cols = Math.min(3, items.length), row = Math.floor(i / cols), col = i % cols;
      return `<text x="${cx + (col - (cols - 1) / 2) * w}" y="${cy + row * 18 - Math.floor(Math.min(items.length, 12) / cols) * 8}" class="vt">${esc(x)}</text>`;
    }).join('') + (items.length > 12 ? `<text x="${cx}" y="${cy + 66}" class="vt">…</text>` : '');
    $('venn').innerHTML = `
      <defs><clipPath id="cA"><circle cx="140" cy="110" r="80"/></clipPath><clipPath id="cB"><circle cx="220" cy="110" r="80"/></clipPath>
      <mask id="notA"><rect width="360" height="220" fill="white"/><circle cx="140" cy="110" r="80" fill="black"/></mask>
      <mask id="notB"><rect width="360" height="220" fill="white"/><circle cx="220" cy="110" r="80" fill="black"/></mask></defs>
      <rect x="4" y="4" width="352" height="212" rx="8" class="vu" fill="${hl('out')}"/>
      <circle cx="140" cy="110" r="80" fill="var(--bg-card)"/><circle cx="220" cy="110" r="80" fill="var(--bg-card)"/>
      <circle cx="140" cy="110" r="80" fill="${hl('a')}" mask="url(#notB)"/>
      <circle cx="220" cy="110" r="80" fill="${hl('b')}" mask="url(#notA)"/>
      <circle cx="220" cy="110" r="80" fill="${hl('ab')}" clip-path="url(#cA)"/>
      <circle cx="140" cy="110" r="80" class="vc"/><circle cx="220" cy="110" r="80" class="vc"/>
      <text x="16" y="24" class="vl">ξ</text><text x="74" y="44" class="vl">A</text><text x="282" y="44" class="vl">B</text>
      ${place(aOnly, 112, 112, 22)}${place(both, 180, 112, 18)}${place(bOnly, 248, 112, 22)}${place(outside, 312, 190, 18).replace(/y="(\d+)/g, (m, y) => `y="${Math.min(205, +y)}`)}`;
    const result = { union, inter: both, aonly: aOnly, bonly: bOnly, outside }[op];
    $('setOut').innerHTML = `<b>${{ union: 'A ∪ B', inter: 'A ∩ B', aonly: 'A only (A − B)', bonly: 'B only (B − A)', outside: '(A ∪ B)′' }[op]}</b> = ${show(result)} &nbsp; n = ${result.length}<br>
      n(A ∪ B) = n(A) + n(B) − n(A ∩ B) = ${A.length} + ${B.length} − ${both.length} = ${union.length}` +
      (op === 'outside' && !U.length ? '<br><small>Fill in ξ to see the elements outside A and B.</small>' : '') +
      (extra.length ? `<br><small>Not in ξ: ${show(extra)}</small>` : '');
  }
  $('setOps').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    op = b.dataset.op;
    $('setOps').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  for (const id of ['setU', 'setA', 'setB']) $(id).addEventListener('input', draw);
  draw();
}

function piTool() {
  function circle() {
    const r = Math.max(0, Number($('piR').value) || 0), deg = Math.min(360, Math.max(0, Number($('piDeg').value) || 0));
    $('piOut').innerHTML = `Diameter = ${fmt(2 * r)} &nbsp;·&nbsp; Circumference = 2πr = <b>${fmt(2 * Math.PI * r)}</b> &nbsp;·&nbsp; Area = πr² = <b>${fmt(Math.PI * r * r)}</b><br>
      ${fmt(deg)}° sector: arc = <b>${fmt((deg / 360) * 2 * Math.PI * r)}</b>, area = <b>${fmt((deg / 360) * Math.PI * r * r)}</b>`;
  }
  function poly() {
    const n = Number($('piN').value);
    $('piNv').textContent = n;
    const inner = n * Math.sin(Math.PI / n), outer = n * Math.tan(Math.PI / n);
    const pts = (rad) => Array.from({ length: n }, (_, k) => { const a = (k / n) * 2 * Math.PI - Math.PI / 2; return `${fmt(Math.cos(a) * rad, 2)},${fmt(Math.sin(a) * rad, 2)}`; }).join(' ');
    const R0 = 90;
    $('piSvg').innerHTML = `<polygon points="${pts(R0 / Math.cos(Math.PI / n))}" class="po"/><circle r="${R0}" class="pc"/><polygon points="${pts(R0)}" class="pi"/>`;
    $('piPoly').innerHTML = `Inside polygon: π &gt; <b>${inner.toFixed(6)}</b> &nbsp;·&nbsp; Outside polygon: π &lt; <b>${outer.toFixed(6)}</b><br>
      <small>Half the perimeter of each polygon, for a circle of radius 1. The gap is ${(outer - inner).toFixed(6)}; true value 3.141593.${n === 96 ? ' At 96 sides this is Archimedes\' result: 223/71 ≈ 3.140845 and 22/7 ≈ 3.142857 sit just outside these bounds.' : ''}</small>`;
  }
  $('piR').addEventListener('input', circle); $('piDeg').addEventListener('input', circle);
  $('piN').addEventListener('input', poly);
  circle(); poly();
}

function trigTool() {
  const svg = $('unitSvg');
  let theta = 40;
  function draw() {
    const t = theta * R, x = Math.cos(t), y = Math.sin(t);
    const tanTxt = Math.abs(Math.cos(t)) < 1e-9 ? 'undefined' : fmt(Math.tan(t));
    const quad = theta % 90 === 0 ? 'on an axis' : `quadrant ${Math.floor(theta / 90) + 1} (${['all positive', 'sin positive', 'tan positive', 'cos positive'][Math.floor(theta / 90)]})`;
    const large = theta > 180 ? 1 : 0;
    svg.innerHTML = `
      <line x1="-1.35" y1="0" x2="1.35" y2="0" class="ax"/><line x1="0" y1="-1.25" x2="0" y2="1.25" class="ax"/>
      <circle r="1" class="uc"/>
      <path d="M 0.25 0 A 0.25 0.25 0 ${large} 0 ${fmt(0.25 * x, 3)} ${fmt(-0.25 * y, 3)}" class="arc"/>
      <line x1="0" y1="0" x2="${x}" y2="${-y}" class="rad"/>
      <line x1="0" y1="0" x2="${x}" y2="0" class="cosl"/>
      <line x1="${x}" y1="0" x2="${x}" y2="${-y}" class="sinl"/>
      <circle cx="${x}" cy="${-y}" r="0.06" class="pt"/>
      <text x="${x / 2}" y="${y > 0 ? 0.13 : -0.06}" class="ut cos">cos</text>
      <text x="${x + (x >= 0 ? 0.05 : -0.27)}" y="${-y / 2}" class="ut sin">sin</text>`;
    $('unitOut').innerHTML = `θ = <b>${fmt(theta, 1)}°</b> = ${fmt(t)} rad, ${quad}<br>
      <span class="sinv">sin θ = ${fmt(y)}</span> &nbsp; <span class="cosv">cos θ = ${fmt(x)}</span> &nbsp; tan θ = ${tanTxt}<br>
      <small>sin²θ + cos²θ = ${fmt(y * y + x * x)}</small>`;
  }
  draggable(svg, (p) => {
    let a = Math.atan2(-p.y, p.x) / R;
    if (a < 0) a += 360;
    // snap near multiples of 15° so exact values are easy to hit
    const s = Math.round(a / 15) * 15;
    theta = Math.abs(a - s) < 2.5 ? s % 360 : Math.round(a);
    draw();
  });
  draw();

  function solveTri() {
    const v = (id) => { const x = $(id).value.trim(); return x === '' ? null : Number(x); };
    let A = v('triA'), o = v('triO'), j = v('triJ'), h = v('triH');
    const given = [A, o, j, h].filter((x) => x !== null).length;
    const out = $('triOut');
    if (given !== 2) { out.innerHTML = 'Fill in exactly two values.'; return; }
    if (A !== null && (A <= 0 || A >= 90)) { out.innerHTML = 'The angle must be between 0° and 90°.'; return; }
    if ([o, j, h].some((x) => x !== null && x <= 0)) { out.innerHTML = 'Sides must be positive.'; return; }
    let how;
    if (A !== null) {
      const t = A * R;
      if (h !== null) { o = h * Math.sin(t); j = h * Math.cos(t); how = `opp = hyp × sin θ, adj = hyp × cos θ`; }
      else if (o !== null) { h = o / Math.sin(t); j = o / Math.tan(t); how = `hyp = opp ÷ sin θ, adj = opp ÷ tan θ`; }
      else if (j !== null) { h = j / Math.cos(t); o = j * Math.tan(t); how = `hyp = adj ÷ cos θ, opp = adj × tan θ`; }
      else { out.innerHTML = 'Give at least one side as well as the angle.'; return; }
    } else {
      if (h !== null && ((o !== null && o >= h) || (j !== null && j >= h))) { out.innerHTML = 'The hypotenuse must be the longest side.'; return; }
      if (o !== null && j !== null) { h = Math.hypot(o, j); A = Math.atan(o / j) / R; how = 'θ = tan⁻¹(opp ÷ adj), hyp by Pythagoras'; }
      else if (o !== null) { A = Math.asin(o / h) / R; j = Math.sqrt(h * h - o * o); how = 'θ = sin⁻¹(opp ÷ hyp), adj by Pythagoras'; }
      else { A = Math.acos(j / h) / R; o = Math.sqrt(h * h - j * j); how = 'θ = cos⁻¹(adj ÷ hyp), opp by Pythagoras'; }
    }
    out.innerHTML = `θ = <b>${fmt(A, 2)}°</b> &nbsp; opposite = <b>${fmt(o, 3)}</b> &nbsp; adjacent = <b>${fmt(j, 3)}</b> &nbsp; hypotenuse = <b>${fmt(h, 3)}</b><br><small>${how}. The other angle is ${fmt(90 - A, 2)}°.</small>`;
  }
  for (const id of ['triA', 'triO', 'triJ', 'triH']) $(id).addEventListener('input', solveTri);
  solveTri();
}

function anglesTool() {
  const svg = $('angSvg');
  let ang = 125;
  const type = (a) => (a === 0 ? 'zero' : a < 90 ? 'acute' : a === 90 ? 'right' : a < 180 ? 'obtuse' : a === 180 ? 'straight' : a < 360 ? 'reflex' : 'full turn');
  function draw() {
    const t = ang * R, x = Math.cos(t) * 95, y = -Math.sin(t) * 95;
    const large = ang > 180 ? 1 : 0;
    const arc = ang >= 360 ? '<circle r="34" class="aarc"/>' : ang === 90 ? '<path d="M 22 0 L 22 -22 L 0 -22" class="aarc"/>' : `<path d="M 34 0 A 34 34 0 ${large} 0 ${fmt(Math.cos(t) * 34, 2)} ${fmt(-Math.sin(t) * 34, 2)}" class="aarc"/>`;
    svg.innerHTML = `<line x1="0" y1="0" x2="100" y2="0" class="arm"/><line x1="0" y1="0" x2="${fmt(x, 2)}" y2="${fmt(y, 2)}" class="arm"/>${arc}<circle cx="${fmt(x, 2)}" cy="${fmt(y, 2)}" r="7" class="pt"/><circle r="3" class="pt"/>
      <text x="${fmt(Math.cos(t / 2) * 58, 1)}" y="${fmt(-Math.sin(t / 2) * 58 + 5, 1)}" class="at">${ang}°</text>`;
    const facts = ang < 180 ? `Its partner on a straight line is ${180 - ang}°.` : '';
    $('angOut').innerHTML = `<b>${ang}°</b> is <b>${type(ang)}</b> = ${fmt(ang * R)} rad. ${facts} Around a point it leaves ${360 - ang}°.`;
  }
  draggable(svg, (p) => {
    let a = Math.round(Math.atan2(-p.y, p.x) / R);
    if (a < 0) a += 360;
    if (Math.abs(a - 90) < 3) a = 90; if (Math.abs(a - 180) < 3) a = 180;
    if (a < 3 && ang > 300) a = 360;
    ang = a;
    draw();
  });
  draw();

  let lock = false;
  const fromDeg = () => { if (lock) return; const d = Number($('degIn').value); lock = true; $('radIn').value = Number.isFinite(d) ? fmt(d * R, 6) : ''; lock = false; conv(); };
  const fromRad = () => { if (lock) return; const r = Number($('radIn').value); lock = true; $('degIn').value = Number.isFinite(r) ? fmt(r / R, 4) : ''; lock = false; conv(); };
  function conv() {
    const d = Number($('degIn').value);
    const k = d / 180;
    // show as a multiple of π when it's a tidy fraction
    let nice = '';
    for (const den of [1, 2, 3, 4, 6, 12]) {
      const num = k * den;
      if (Math.abs(num - Math.round(num)) < 1e-9 && Math.round(num) !== 0) { const n = Math.round(num); nice = ` = ${n === 1 ? '' : n === -1 ? '−' : n}π${den === 1 ? '' : `/${den}`}`; break; }
    }
    $('radOut').innerHTML = `${fmt(d)}° = <b>${fmt(d * R, 6)} rad</b>${nice} &nbsp; <small>(multiply by π/180; divide by π/180 to go back)</small>`;
  }
  $('degIn').addEventListener('input', fromDeg); $('radIn').addEventListener('input', fromRad);
  fromDeg();

  function poly() {
    const n = Math.round(Number($('polyN').value));
    if (!(n >= 3)) { $('polyOut').textContent = 'A polygon needs at least 3 sides.'; return; }
    const sum = (n - 2) * 180;
    const names = { 3: 'triangle', 4: 'quadrilateral', 5: 'pentagon', 6: 'hexagon', 7: 'heptagon', 8: 'octagon', 9: 'nonagon', 10: 'decagon', 12: 'dodecagon' };
    $('polyOut').innerHTML = `${names[n] ? `A ${names[n]}: ` : ''}interior angles add up to (${n} − 2) × 180° = <b>${sum}°</b>.<br>If it's regular, each interior angle is <b>${fmt(sum / n, 2)}°</b> and each exterior angle is <b>${fmt(360 / n, 2)}°</b> (exterior + interior = 180°).`;
  }
  $('polyN').addEventListener('input', poly);
  poly();
}

function statsTool() {
  const run = () => {
    const xs = ($('statIn').value.match(/-?\d*\.?\d+/g) || []).map(Number);
    if (!xs.length) { $('statOut').innerHTML = 'Type some numbers.'; return; }
    const n = xs.length, sum = xs.reduce((a, b) => a + b, 0), sorted = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(n / 2);
    const median = n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    const counts = new Map(); for (const x of xs) counts.set(x, (counts.get(x) || 0) + 1);
    const top = Math.max(...counts.values());
    const modes = top > 1 ? [...counts].filter(([, c]) => c === top).map(([x]) => x).sort((a, b) => a - b) : [];
    $('statOut').innerHTML = `
      <div>In order: ${sorted.map(fmt).join(', ')} <small>(${n} value${n > 1 ? 's' : ''})</small></div>
      <div><b>Mean</b> = ${fmt(sum)} ÷ ${n} = <b>${fmt(sum / n)}</b></div>
      <div><b>Median</b> = ${n % 2 ? `the ${mid + 1}${['st', 'nd', 'rd'][mid] || 'th'} value` : `halfway between ${fmt(sorted[mid - 1])} and ${fmt(sorted[mid])}`} = <b>${fmt(median)}</b></div>
      <div><b>Mode</b> = <b>${modes.length ? modes.map(fmt).join(' and ') : 'none'}</b>${modes.length ? ` <small>(appears ${top} times)</small>` : ' <small>(no value repeats)</small>'}</div>
      <div><b>Range</b> = ${fmt(sorted[n - 1])} − ${fmt(sorted[0])} = <b>${fmt(sorted[n - 1] - sorted[0])}</b></div>`;
  };
  $('statIn').addEventListener('input', run);
  run();
}

function pythagTool() {
  const ids = ['pyA', 'pyB', 'pyC'];
  const draw = (a, b, c, find) => {
    const k = 130 / Math.max(a, b, 1e-9);
    const w = a * k, h = b * k, x0 = 40, y0 = 150;
    const lab = (t, x, y, hi) => `<text x="${x}" y="${y}" text-anchor="middle" class="${hi ? 'nw-svg-hi' : ''}">${t}</text>`;
    $('pySvg').innerHTML = `<polygon points="${x0},${y0} ${x0 + w},${y0} ${x0},${y0 - h}" class="nw-svg-shape" />
      <rect x="${x0}" y="${y0 - 12}" width="12" height="12" class="nw-svg-right" />
      ${lab(`a = ${fmt(a, 3)}`, x0 + w / 2, y0 + 16, find === 'pyA')}
      ${lab(`b = ${fmt(b, 3)}`, x0 - 22, y0 - h / 2, find === 'pyB')}
      ${lab(`c = ${fmt(c, 3)}`, x0 + w / 2 + 26, y0 - h / 2 - 6, find === 'pyC')}`;
  };
  const run = () => {
    const v = ids.map((id) => ($(id).value.trim() === '' ? null : Number($(id).value)));
    const blanks = v.filter((x) => x === null).length;
    const out = $('pyOut');
    if (v.some((x) => x !== null && !(x > 0))) { out.innerHTML = 'Sides must be positive numbers.'; return; }
    if (blanks === 0) {
      const [a, b, c] = v;
      const ok = Math.abs(a * a + b * b - c * c) < 1e-9 * Math.max(1, c * c);
      out.innerHTML = `${fmt(a)}² + ${fmt(b)}² = ${fmt(a * a + b * b)} and ${fmt(c)}² = ${fmt(c * c)}, so this triangle <b>${ok ? 'is' : 'is not'}</b> right-angled.`;
      if (ok) draw(a, b, c, null);
      return;
    }
    if (blanks !== 1) { out.innerHTML = 'Fill in exactly two sides.'; return; }
    let [a, b, c] = v, find;
    if (c === null) { c = Math.sqrt(a * a + b * b); find = 'pyC'; out.innerHTML = `c² = a² + b² = ${fmt(a * a)} + ${fmt(b * b)} = ${fmt(a * a + b * b)}<br>c = √${fmt(a * a + b * b)} = <b>${fmt(c)}</b>`; }
    else {
      const known = a === null ? b : a;
      if (known >= c) { out.innerHTML = 'The hypotenuse must be the longest side.'; return; }
      const x = Math.sqrt(c * c - known * known);
      find = a === null ? 'pyA' : 'pyB';
      const nm = a === null ? 'a' : 'b';
      out.innerHTML = `${nm}² = c² − ${nm === 'a' ? 'b' : 'a'}² = ${fmt(c * c)} − ${fmt(known * known)} = ${fmt(c * c - known * known)}<br>${nm} = √${fmt(c * c - known * known)} = <b>${fmt(x)}</b>`;
      if (a === null) a = x; else b = x;
    }
    draw(a, b, c, find);
  };
  ids.forEach((id) => $(id).addEventListener('input', run));
  run();
}

function ratioTool() {
  const parts = (str) => (str.match(/\d*\.?\d+/g) || []).map(Number).filter((x) => x > 0);
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const share = () => {
    const amt = Number($('raAmt').value), r = parts($('raRat').value);
    const out = $('raOut');
    if (r.length < 2 || !Number.isFinite(amt)) { out.innerHTML = 'Enter an amount and a ratio like 2 : 3.'; return; }
    const total = r.reduce((a, b) => a + b, 0), one = amt / total;
    out.innerHTML = `Total parts: ${r.join(' + ')} = ${fmt(total)}<br>One part: ${fmt(amt)} ÷ ${fmt(total)} = ${fmt(one)}<br>Shares: ${r.map((p) => `${fmt(p)} × ${fmt(one)} = <b>${fmt(p * one)}</b>`).join(' · ')}`;
  };
  const simp = () => {
    const r = parts($('raSimp').value);
    const out = $('raSimpOut');
    if (r.length < 2) { out.innerHTML = 'Enter a ratio like 12 : 18.'; return; }
    // clear decimals first, then divide by the highest common factor
    const dp = Math.max(...r.map((x) => (String(x).split('.')[1] || '').length));
    const ints = r.map((x) => Math.round(x * 10 ** dp));
    const h = ints.reduce(gcd);
    out.innerHTML = `${dp ? `× ${10 ** dp} to clear decimals: ${ints.join(' : ')}<br>` : ''}Highest common factor: ${h}<br>Simplest form: <b>${ints.map((x) => x / h).join(' : ')}</b>`;
  };
  ['raAmt', 'raRat'].forEach((id) => $(id).addEventListener('input', share));
  $('raSimp').addEventListener('input', simp);
  share(); simp();
}

// ---------------------------------------------------------------- mount
export function mountResources() {
  const tabs = $('resTabs'), body = $('resBody');
  const build = (key) => {
    const s = SECTIONS[key];
    body.innerHTML = `<div class="nw-res"><div class="nw-res-notes">${s.notes}</div><div class="nw-res-tool">${s.tool}</div></div>`;
    ({ sets: setsTool, pi: piTool, trig: trigTool, angles: anglesTool, stats: statsTool, pythag: pythagTool, ratio: ratioTool })[key]();
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.res === key));
  };
  tabs.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) build(b.dataset.res); });
  build('sets');
}
