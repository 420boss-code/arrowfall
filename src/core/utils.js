// Small maths helpers, seeded RNG and value noise.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const DEG = Math.PI / 180;

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function approachAngle(cur, target, maxStep) {
  const d = wrapAngle(target - cur);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

// 2D value noise with smooth interpolation
export function makeNoise2D(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const vals = new Float32Array(256);
  for (let i = 0; i < 256; i++) { perm[i] = i; vals[i] = rand(); }
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const v = (x, y) => vals[perm[(x & 255) + perm[y & 255]]];
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    const a = v(xi, yi), b = v(xi + 1, yi), c = v(xi, yi + 1), d = v(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), w) * 2 - 1;
  };
}

// Closest approach between segment p0->p1 and an infinite vertical line at (cx, cz).
// Returns t in [0,1] of first entry into a circle of radius r (XZ plane), or -1.
export function segmentCircleXZ(x0, z0, x1, z1, cx, cz, r) {
  const dx = x1 - x0, dz = z1 - z0;
  const fx = x0 - cx, fz = z0 - cz;
  const a = dx * dx + dz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (a < 1e-9) return c <= 0 ? 0 : -1;
  const b = 2 * (fx * dx + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  if (c <= 0) return 0; // starts inside
  return -1;
}

// Segment vs sphere: returns t in [0,1] or -1
export function segmentSphere(x0, y0, z0, x1, y1, z1, cx, cy, cz, r) {
  const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
  const fx = x0 - cx, fy = y0 - cy, fz = z0 - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a < 1e-9) return -1;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : -1;
}

// Segment vs vertical capsule (axis from (cx,yb,cz) to (cx,yt,cz), radius r).
// Approximated: XZ circle entry, then check y at that point within [yb-r, yt].
export function segmentVerticalCapsule(x0, y0, z0, x1, y1, z1, cx, cz, yb, yt, r) {
  const t = segmentCircleXZ(x0, z0, x1, z1, cx, cz, r);
  if (t < 0) return -1;
  const y = y0 + (y1 - y0) * t;
  if (y >= yb && y <= yt) return t;
  // could still pass through the circle and hit further along when descending; sample exit
  const dx = x1 - x0, dz = z1 - z0;
  // sample a few points inside the circle span
  for (let k = 1; k <= 4; k++) {
    const tt = t + (1 - t) * (k / 4);
    const px = x0 + dx * tt - cx, pz = z0 + dz * tt - cz;
    if (px * px + pz * pz > r * r) break;
    const py = y0 + (y1 - y0) * tt;
    if (py >= yb && py <= yt) return tt;
  }
  return -1;
}

const FIRST = ['Ash', 'Bran', 'Cael', 'Dara', 'Edda', 'Finn', 'Gwen', 'Hal', 'Isa', 'Jory', 'Kit', 'Lark', 'Mael', 'Nell',
  'Oswin', 'Pip', 'Quill', 'Rhos', 'Sib', 'Tam', 'Una', 'Vane', 'Wren', 'Yorick', 'Zara', 'Alder', 'Briar', 'Cole',
  'Dunn', 'Elm', 'Fern', 'Gale', 'Heath', 'Ivo', 'Jem', 'Kestrel', 'Linnet', 'Moss', 'Nye', 'Orrin', 'Perry', 'Rook'];
export function makeNames(count, rand) {
  const pool = FIRST.slice();
  const out = [];
  for (let i = 0; i < count; i++) {
    if (pool.length === 0) pool.push(...FIRST);
    const j = Math.floor(rand() * pool.length);
    out.push(pool.splice(j, 1)[0]);
  }
  return out;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
