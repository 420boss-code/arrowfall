// The archer's knife and quiver. Loads Meshy models from public/models/props/ when present (they are
// untextured meshes, coloured here by region) and falls back to simple built-in shapes otherwise.
//
// Both come back as single BufferGeometries with position, normal and color:
//   knife  – grip at the origin, blade pointing along -Z, edge down, about 0.27 m long
//   quiver – base at the origin, mouth at +Y = 1, about 0.2 across (scale uniformly to the length
//            you want), with a few fletched arrows standing out of the top
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BASE = 'models/props/';
const STEEL = new THREE.Color(0xc9ced4), STEEL_DARK = new THREE.Color(0x8a9097), BRASS = new THREE.Color(0xc8a050);
const HANDLE = new THREE.Color(0x5a3a22), WRAP = new THREE.Color(0x3b2616);
const LEATHER = new THREE.Color(0x7a5232), LEATHER_DARK = new THREE.Color(0x4e331f), RIM = new THREE.Color(0x9b6c42);
const SHAFT = new THREE.Color(0xc9a978), FEATHER = new THREE.Color(0xeeeae0), FEATHER_RED = new THREE.Color(0xb8473a);

function paint(geo, colourAt) {
  const p = geo.attributes.position, arr = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { colourAt(p.getX(i), p.getY(i), p.getZ(i), c); arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

const plain = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); if (!g.attributes.normal) g.computeVertexNormals(); return g; };
const solid = (g, col) => paint(plain(g), (x, y, z, c) => c.copy(col));

// One geometry from every mesh in a loaded scene, in scene space.
function flatten(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((o) => { if (o.isMesh) parts.push(plain(o.geometry.clone().applyMatrix4(o.matrixWorld))); });
  return parts.length ? mergeGeometries(parts) : null;
}

// ---------------------------------------------------------------- knife
function prepareKnife(geo) {
  geo.computeBoundingBox();
  const s = geo.boundingBox.getSize(new THREE.Vector3());
  const axis = s.x >= s.y && s.x >= s.z ? 'x' : s.y >= s.z ? 'y' : 'z';
  // put the long axis along X
  if (axis === 'y') geo.rotateZ(-Math.PI / 2); else if (axis === 'z') geo.rotateY(Math.PI / 2);
  geo.computeBoundingBox();
  let bb = geo.boundingBox;
  // the blade is the thin end: compare thickness near each end
  const p = geo.attributes.position, len = bb.max.x - bb.min.x;
  const thick = (lo, hi) => { let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (let i = 0; i < p.count; i++) { const t = (p.getX(i) - bb.min.x) / len; if (t >= lo && t <= hi) { a = Math.min(a, p.getY(i)); b = Math.max(b, p.getY(i)); c = Math.min(c, p.getZ(i)); d = Math.max(d, p.getZ(i)); } } return Math.min(b - a, d - c); };
  if (thick(0, 0.3) > thick(0.7, 1)) geo.rotateY(Math.PI); // blade must be at -X
  // the flat of the blade should face sideways: thin direction along Z → swap to X after the turn below
  geo.computeBoundingBox(); bb = geo.boundingBox;
  const sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
  if (sy < sz) geo.rotateX(Math.PI / 2); // keep the blade's height (edge to spine) vertical
  geo.computeBoundingBox(); bb = geo.boundingBox;
  // guard: the widest slice in the middle of the length; grip a little behind it
  const bins = new Float32Array(20).fill(0);
  for (let i = 0; i < p.count; i++) { const k = Math.min(19, Math.floor(((p.getX(i) - bb.min.x) / len) * 20)); bins[k] = Math.max(bins[k], Math.abs(p.getZ(i) - (bb.min.z + bb.max.z) / 2)); }
  let gk = 8; for (let k = 8; k < 16; k++) if (bins[k] > bins[gk]) gk = k;
  const guardX = bb.min.x + ((gk + 0.5) / 20) * len;
  const gripX = guardX + (bb.max.x - guardX) * 0.45;
  const cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
  paint(geo, (x, y, z, c) => {
    const t = (x - guardX) / len;
    if (t < -0.03) c.copy(y > cy + (bb.max.y - cy) * 0.35 ? STEEL_DARK : STEEL);        // blade, darker spine
    else if (t < 0.035) c.copy(BRASS);                                                 // guard
    else c.copy(Math.floor(t * 30) % 3 === 0 ? WRAP : HANDLE);                          // wrapped handle
  });
  const scale = 0.27 / len;
  geo.translate(-gripX, -cy, -cz);
  geo.scale(scale, scale, scale);
  geo.rotateY(-Math.PI / 2); // blade from -X to -Z
  geo.computeVertexNormals();
  return geo;
}

export function knifeGeometry() {
  const blade = new THREE.BufferGeometry();
  // a flat single-edged blade in the YZ plane, tip at -Z
  const v = [0, 0.012, -0.035, 0, 0.016, -0.17, 0, -0.004, -0.19, 0, -0.016, -0.035];
  const pos = [];
  for (const x of [-0.003, 0.003]) for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) for (const k of x < 0 ? [a, c, b] : [a, b, c]) pos.push(x, v[k * 3 + 1], v[k * 3 + 2]);
  blade.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  blade.computeVertexNormals();
  const guard = new THREE.BoxGeometry(0.014, 0.05, 0.012).translate(0, 0, -0.03);
  const handle = new THREE.BoxGeometry(0.022, 0.026, 0.09).translate(0, 0, 0.02);
  return mergeGeometries([solid(blade, STEEL), solid(guard, BRASS), solid(handle, HANDLE)]);
}

// ---------------------------------------------------------------- quiver
function arrowsInQuiver() {
  const parts = [];
  const spots = [[-0.03, -0.02, 0.18, 0.1], [0.035, 0.0, 0.24, -0.15], [0.0, 0.035, 0.2, 0.3], [-0.015, -0.045, 0.26, 0.6], [0.04, -0.035, 0.16, -0.4]];
  spots.forEach(([x, z, h, rot], k) => {
    const shaft = solid(new THREE.BoxGeometry(0.012, h, 0.012).translate(x, 1 + h / 2 - 0.12, z), SHAFT);
    parts.push(shaft);
    for (const r of [0, Math.PI / 2]) {
      const f = new THREE.BoxGeometry(0.05, 0.1, 0.002).rotateY(r + rot).translate(x, 1 + h - 0.08, z);
      parts.push(solid(f, k === 0 ? FEATHER_RED : FEATHER));
    }
  });
  return parts;
}

function prepareQuiver(geo) {
  geo.computeBoundingBox();
  let bb = geo.boundingBox;
  const s = bb.getSize(new THREE.Vector3());
  // long axis up
  if (s.x > s.y && s.x >= s.z) geo.rotateZ(Math.PI / 2); else if (s.z > s.y && s.z > s.x) geo.rotateX(-Math.PI / 2);
  geo.computeBoundingBox(); bb = geo.boundingBox;
  const c = bb.getCenter(new THREE.Vector3());
  geo.translate(-c.x, -bb.min.y, -c.z);
  const h = bb.max.y - bb.min.y, w = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
  // Meshy's quiver is stout; slim it to a quiver's proportions (about 0.2 of its height across)
  geo.scale(0.2 / w, 1 / h, 0.2 / w);
  paint(geo, (x, y, z, col) => {
    if (y > 0.93) col.copy(RIM);
    else if (Math.abs(y - 0.28) < 0.035 || Math.abs(y - 0.7) < 0.035) col.copy(LEATHER_DARK);
    else col.copy(LEATHER).lerp(LEATHER_DARK, 0.25 * (1 - y));
  });
  geo.computeVertexNormals();
  return mergeGeometries([geo, ...arrowsInQuiver()]);
}

export function quiverGeometry() {
  const tube = new THREE.CylinderGeometry(0.1, 0.085, 1, 8, 4, true).translate(0, 0.5, 0);
  const bottom = new THREE.CircleGeometry(0.085, 8).rotateX(Math.PI / 2);
  const g = mergeGeometries([plain(tube), plain(bottom)]);
  paint(g, (x, y, z, col) => col.copy(y > 0.93 ? RIM : Math.abs(y - 0.28) < 0.04 || Math.abs(y - 0.7) < 0.04 ? LEATHER_DARK : LEATHER));
  return mergeGeometries([g, ...arrowsInQuiver()]);
}

// ---------------------------------------------------------------- loading
async function load(file) {
  const r = await fetch(BASE + file, { method: 'HEAD' });
  if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) return null;
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(BASE + file);
  return flatten(gltf.scene);
}

export async function loadPropModels() {
  const out = { knife: null, quiver: null };
  for (const [kind, prep] of [['knife', prepareKnife], ['quiver', prepareQuiver]]) {
    try {
      const g = await load(`${kind}.glb`);
      if (g) out[kind] = prep(g);
    } catch (e) {
      console.warn(`Prop model ${kind}.glb could not be loaded; using the built-in one.`, e);
    }
  }
  return out;
}

export function propGeometries(models) {
  return {
    knife: (models && models.knife) || knifeGeometry(),
    quiver: (models && models.quiver) || quiverGeometry(),
  };
}
