// Foliage geometry and wind. Geometry is built at unit scale (scaled per instance) with vertex
// colours used as light/shade multipliers; instance colours supply the hue.
import * as THREE from 'three';

// ---------------------------------------------------------------- helpers
function toNonIndexed(g) {
  const out = g.index ? g.toNonIndexed() : g;
  if (out.attributes.uv) out.deleteAttribute('uv');
  if (out.attributes.uv1) out.deleteAttribute('uv1');
  return out;
}

// Build a non-indexed geometry from a flat list of triangles: [[p0, p1, p2, c0, c1, c2], …]
function fromTris(tris) {
  const pos = new Float32Array(tris.length * 9), col = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      pos.set(t[k], i * 9 + k * 3);
      const c = t[3 + k];
      col.set(typeof c === 'number' ? [c, c, c] : c, i * 9 + k * 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// Shade by height: dark underneath, bright on top, with optional per-triangle variation.
function shadeByHeight(g, bottom, top, yMin, yMax, rand = null, vary = 0) {
  g = toNonIndexed(g);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i += 3) {
    const v = rand ? 1 + (rand() - 0.5) * vary : 1;
    for (let k = 0; k < 3; k++) {
      const t = Math.min(1, Math.max(0, (p.getY(i + k) - yMin) / (yMax - yMin)));
      const s = (bottom + (top - bottom) * t) * v;
      col[(i + k) * 3] = s; col[(i + k) * 3 + 1] = s; col[(i + k) * 3 + 2] = s;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function merge(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    col.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

function jitter(g, rand, amt) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * (1 + (rand() - 0.5) * amt), p.getY(i) * (1 + (rand() - 0.5) * amt), p.getZ(i) * (1 + (rand() - 0.5) * amt));
  }
  return g;
}

// ---------------------------------------------------------------- trees
// One pine tier: a jagged, drooping skirt of needles with a shaded underside.
function pineTier(rBottom, y0, h, segs, droop, rand, light) {
  const tris = [];
  const ring = [];
  const n = segs * 2;
  const off = rand() * Math.PI;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const tip = i % 2 === 0;
    const r = rBottom * (tip ? 1 : 0.72) * (0.9 + rand() * 0.2);
    ring.push([Math.cos(a) * r, y0 - (tip ? droop : 0) + (rand() - 0.5) * 0.015, Math.sin(a) * r, tip]);
  }
  const apex = [0, y0 + h, 0];
  const under = [0, y0 + h * 0.28, 0];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ca = a[3] ? 1.25 * light : 1.0 * light, cb = b[3] ? 1.25 * light : 1.0 * light;
    tris.push([apex, b.slice(0, 3), a.slice(0, 3), 0.85 * light, cb, ca]);
    tris.push([under, a.slice(0, 3), b.slice(0, 3), 0.62, 0.78, 0.78]);
  }
  return fromTris(tris);
}

export function pineGeometry(rand, detail = 'hi') {
  if (detail === 'lo') {
    return merge([
      shadeByHeight(new THREE.ConeGeometry(0.5, 0.6, 6).translate(0, 0.3, 0), 0.55, 1.05, 0, 0.6),
      shadeByHeight(new THREE.ConeGeometry(0.32, 0.55, 6).translate(0, 0.72, 0), 0.75, 1.15, 0.45, 1),
    ]);
  }
  const tiers = [];
  const count = 6;
  for (let k = 0; k < count; k++) {
    const t = k / count;
    tiers.push(pineTier(0.5 * (1 - t * 0.82), t * 0.8, 0.3 - t * 0.1, 7, 0.06 * (1 - t), rand, 0.85 + t * 0.3));
  }
  tiers.push(shadeByHeight(new THREE.ConeGeometry(0.05, 0.2, 5).translate(0, 0.98, 0), 1, 1.2, 0.88, 1.08));
  return merge(tiers);
}

export function broadleafGeometry(rand, detail = 'hi') {
  if (detail === 'lo') return shadeByHeight(jitter(new THREE.IcosahedronGeometry(0.55, 0), rand, 0.2), 0.5, 1.15, -0.5, 0.5);
  const blobs = [];
  const add = (r, x, y, z, det) => {
    const g = jitter(new THREE.IcosahedronGeometry(r, det), rand, 0.3).translate(x, y, z);
    blobs.push(shadeByHeight(g, 0.58, 1.2, -0.45, 0.5, rand, 0.18));
  };
  add(0.4, 0, 0.02, 0, 1);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + rand() * 0.5;
    add(0.24 + rand() * 0.07, Math.cos(a) * 0.3, -0.06 + rand() * 0.14, Math.sin(a) * 0.3, 0);
  }
  add(0.27, 0.06, 0.24, -0.05, 0);
  add(0.2, -0.12, 0.3, 0.1, 0);
  return merge(blobs);
}

// Trunk with a flared, mossy base and bark-like variation in shade.
export function trunkGeometry(rand, detail = 'hi') {
  if (detail === 'lo') return shadeByHeight(new THREE.CylinderGeometry(0.7, 1, 1, 5).translate(0, 0.5, 0), 0.75, 1.05, 0, 1);
  const pts = [[1.45, 0], [1.1, 0.03], [0.95, 0.09], [0.86, 0.22], [0.8, 0.5], [0.72, 0.8], [0.66, 1.0]].map(([r, y]) => new THREE.Vector2(r, y));
  const g = shadeByHeight(new THREE.LatheGeometry(pts, 8), 0.7, 1.1, 0, 0.6, rand, 0.3);
  // a mossy green tint around the roots
  const p = g.attributes.position, c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    const m = Math.max(0, 1 - p.getY(i) / 0.12);
    c.setXYZ(i, c.getX(i) * (1 - 0.3 * m), c.getY(i) * (1 + 0.25 * m), c.getZ(i) * (1 - 0.35 * m));
  }
  return g;
}

export function bushGeometry(rand, detail = 'hi') {
  if (detail === 'lo') return shadeByHeight(new THREE.IcosahedronGeometry(1, 0), 0.5, 1.1, -1, 1);
  const parts = [];
  parts.push(shadeByHeight(jitter(new THREE.IcosahedronGeometry(0.8, 1), rand, 0.3), 0.45, 1.15, -0.8, 0.8, rand, 0.2));
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rand();
    const g = jitter(new THREE.IcosahedronGeometry(0.5 + rand() * 0.15, 0), rand, 0.3).translate(Math.cos(a) * 0.55, -0.2 + rand() * 0.2, Math.sin(a) * 0.55);
    parts.push(shadeByHeight(g, 0.45, 1.15, -0.8, 0.8, rand, 0.2));
  }
  return merge(parts);
}

// ---------------------------------------------------------------- ground cover
// A curved, tapering grass blade: 5 vertices, 3 triangles.
function blade(rand, ox, oz, h, w, lean, dir) {
  const cx = Math.cos(dir), cz = Math.sin(dir);   // lean direction
  const px = -cz * w, pz = cx * w;                  // blade width direction
  const mid = h * 0.55;
  const bL = [ox - px, 0, oz - pz], bR = [ox + px, 0, oz + pz];
  const mL = [ox - px * 0.7 + cx * lean * 0.35, mid, oz - pz * 0.7 + cz * lean * 0.35];
  const mR = [ox + px * 0.7 + cx * lean * 0.35, mid, oz + pz * 0.7 + cz * lean * 0.35];
  const tip = [ox + cx * lean, h, oz + cz * lean];
  const d = 0.32, m = 0.72, t = 1.12;
  return [[bL, bR, mR, d, d, m], [bL, mR, mL, d, m, m], [mL, mR, tip, m, m, t]];
}

export function grassTuftGeometry(rand, blades = 5) {
  const tris = [];
  for (let k = 0; k < blades; k++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.16;
    tris.push(...blade(rand, Math.cos(a) * r, Math.sin(a) * r, 0.24 + rand() * 0.2, 0.022 + rand() * 0.01, 0.05 + rand() * 0.12, rand() * Math.PI * 2));
  }
  return fromTris(tris);
}

// Fern: arching fronds radiating from the centre.
export function fernGeometry(rand) {
  const tris = [];
  const n = 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.4;
    const cx = Math.cos(a), cz = Math.sin(a), px = -cz, pz = cx;
    const L = 0.55 + rand() * 0.25;
    const pts = [[0, 0.02], [0.35, 0.3], [0.7, 0.36], [1, 0.18]].map(([s, y]) => [cx * L * s, y * L, cz * L * s]);
    const widths = [0.02, 0.11, 0.09, 0];
    const shades = [0.35, 0.8, 1.0, 1.15];
    for (let i = 0; i < 3; i++) {
      const a0 = pts[i], a1 = pts[i + 1];
      const w0 = widths[i] * L, w1 = widths[i + 1] * L;
      const l0 = [a0[0] - px * w0, a0[1], a0[2] - pz * w0], r0 = [a0[0] + px * w0, a0[1], a0[2] + pz * w0];
      const l1 = [a1[0] - px * w1, a1[1], a1[2] - pz * w1], r1 = [a1[0] + px * w1, a1[1], a1[2] + pz * w1];
      tris.push([l0, r0, r1, shades[i], shades[i], shades[i + 1]]);
      if (w1 > 0) tris.push([l0, r1, l1, shades[i], shades[i + 1], shades[i + 1]]);
    }
  }
  return fromTris(tris);
}

export function flowerGeometry() {
  const tris = [];
  const s = 0.05, h = 0.3;
  // stem (green-ish dark) + two crossed petal quads at the top
  tris.push([[-0.006, 0, 0], [0.006, 0, 0], [0, h, 0], [0.25, 0.4, 0.15], [0.25, 0.4, 0.15], [0.3, 0.5, 0.2]]);
  for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const a = [-s * dx, h - s, -s * dz], b = [s * dx, h - s, s * dz], c = [s * dx, h + s, s * dz], d = [-s * dx, h + s, -s * dz];
    tris.push([a, b, c, 1, 1, 1], [a, c, d, 1, 1, 1]);
  }
  // a flat face up too, so flowers read from above
  tris.push([[-s, h, -s], [s, h, -s], [s, h, s], 1, 1, 1], [[-s, h, -s], [s, h, s], [-s, h, s], 1, 1, 1]);
  return fromTris(tris);
}

// ---------------------------------------------------------------- wind
// Patch a Lambert material so instances sway: amplitude grows with local height.
// Two-sided foliage also gets its normals forced to face the light (no black backsides).
export function windMaterial({ amp = 0.03, gust = 0, twoSided = false, uniforms }) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: twoSided ? THREE.DoubleSide : THREE.FrontSide });
  return addWind(mat, { amp, gust, twoSided, uniforms });
}

// Add wind sway to any material (used for loaded tree models too).
export function addWind(mat, { amp = 0.03, gust = 0, twoSided = false, uniforms }) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vec3 ip = instanceMatrix[3].xyz;
      float ph = ip.x * 0.31 + ip.z * 0.23;
      float hgt = max(position.y, 0.0);
      float g = ${gust.toFixed(3)} * (0.5 + 0.5 * sin(ip.x * 0.12 + ip.z * 0.05 + uTime * 1.6));
      transformed.x += (sin(uTime * 1.5 + ph) * ${amp.toFixed(4)} + g) * hgt;
      transformed.z += (cos(uTime * 1.2 + ph * 1.3) * ${(amp * 0.7).toFixed(4)} + g * 0.4) * hgt;
    `);
    if (twoSided) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => `wind-${amp}-${gust}-${twoSided}`;
  return mat;
}
