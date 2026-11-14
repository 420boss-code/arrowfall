// Loads tree models (e.g. generated with Meshy) from public/models/trees/ and prepares them for
// instancing. Files: <kind>_<n>.glb or <kind>.glb, where kind is pine, broadleaf or bush, optionally
// listed in manifest.json. Anything missing keeps the procedural trees.
//
// Each model is: flattened to world space, grouped by material, rebased so the trunk base sits at
// the origin, scaled to unit height, capped in detail, given a simplified distant LOD, and switched
// to a cheap Lambert material that sways in the wind.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { CONFIG } from '../config.js';

export const TREE_KINDS = ['pine', 'broadleaf', 'bush', 'grass'];
const BASE = 'models/trees/';

async function isModelFile(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    // dev servers answer unknown paths with index.html: only accept non-HTML responses
    return r.ok && !(r.headers.get('content-type') || '').includes('text/html');
  } catch { return false; }
}

async function findFiles() {
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (r.ok && (r.headers.get('content-type') || '').includes('json')) return await r.json();
  } catch { /* no manifest: probe */ }
  const out = {};
  for (const kind of TREE_KINDS) {
    const names = [`${kind}.glb`, `${kind}_1.glb`, `${kind}_2.glb`, `${kind}_3.glb`];
    const found = [];
    for (const n of names) if (await isModelFile(BASE + n)) found.push(n);
    if (found.length) out[kind] = found;
  }
  return out;
}

// Reduce a mesh to roughly keepFraction of its triangles. SimplifyModifier.modify() is async in
// current three.js (it returns a Promise), so this must be awaited.
// Join vertices that share a position, keeping the first one's normal and UV. Generated models have
// texture seams everywhere, which stop the simplifier collapsing edges; at reduced detail a little
// texture smearing along seams is a fair price.
function weld(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const map = new Map(), P = [], N = [], U = [], idx = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = P.length / 3;
      map.set(key, j);
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      N.push(nor ? nor.getX(i) : 0, nor ? nor.getY(i) : 1, nor ? nor.getZ(i) : 0);
      U.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    idx[i] = j;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

async function simplify(geo, keepFraction, label) {
  const g = weld(geo);
  const remove = Math.floor(g.attributes.position.count * (1 - keepFraction));
  if (remove < 10) return geo;
  try {
    const s = await new SimplifyModifier().modify(g, remove);
    s.computeVertexNormals();
    return s;
  } catch (e) {
    console.warn(`Could not simplify ${label}; using it at full detail.`, e);
    return geo;
  }
}

const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// Turn one loaded glTF scene into { parts: [{ hi, lo, material }], width } at unit height.
async function prepare(scene, file, kind) {
  scene.updateMatrixWorld(true);
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const src = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const list = mats.length > 1 && src.groups.length
      ? src.groups.map((gr) => ({ mat: mats[gr.materialIndex], geo: extract(src, gr) }))
      : [{ mat: mats[0], geo: src }];
    for (const { mat, geo } of list) {
      const clean = new THREE.BufferGeometry();
      const g = geo.index ? geo.toNonIndexed() : geo;
      clean.setAttribute('position', g.attributes.position);
      if (g.attributes.normal) clean.setAttribute('normal', g.attributes.normal); else clean.computeVertexNormals();
      clean.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (!groups.has(mat.uuid)) groups.set(mat.uuid, { mat, geos: [] });
      groups.get(mat.uuid).geos.push(clean);
    }
  });
  if (!groups.size) return null;

  // rebase: trunk base at the origin, unit height
  const box = new THREE.Box3();
  for (const { geos } of groups.values()) for (const g of geos) { g.computeBoundingBox(); box.union(g.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const h = size.y || 1;
  const m = new THREE.Matrix4().makeScale(1 / h, 1 / h, 1 / h)
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));

  const F = CONFIG.forest;
  const parts = [];
  let total = 0;
  for (const { mat, geos } of groups.values()) {
    let geo = mergeGeometries(geos, false);
    geo.applyMatrix4(m);
    total += triCount(geo);
    parts.push({ geo, src: mat });
  }
  // keep the instanced forest affordable: cap detail near, and build a coarse distant version
  const cap = kind === 'bush' ? F.modelMaxTrisBush : kind === 'grass' ? F.modelMaxTrisGrass : F.modelMaxTris;
  const capKeep = Math.min(1, cap / total);
  return {
    width: Math.max(size.x, size.z) / h,
    tris: total,
    parts: await Promise.all(parts.map(async ({ geo, src }) => {
      const hi = capKeep < 0.98 ? await simplify(geo, capKeep, file) : geo;
      const lo = await simplify(hi, F.modelLodFraction, file);
      return { hi, lo, material: convertMaterial(src) };
    })),
  };
}

function extract(geo, group) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = g.attributes[name];
    if (!a) continue;
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(group.start * a.itemSize, (group.start + group.count) * a.itemSize), a.itemSize));
  }
  return out;
}

function convertMaterial(src) {
  const mat = new THREE.MeshLambertMaterial({
    map: src.map || null,
    color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
    side: src.side,
    alphaTest: src.alphaTest || (src.transparent && src.map ? 0.5 : 0),
  });
  if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
  return mat;
}

// Returns { pine: [model, …], broadleaf: [...], bush: [...] } with whatever was found.
export async function loadTreeModels(onProgress) {
  const files = await findFiles();
  const loader = new GLTFLoader();
  const out = {};
  for (const kind of TREE_KINDS) {
    for (const file of files[kind] || []) {
      try {
        if (onProgress) onProgress(`Loading ${file}…`);
        const gltf = await loader.loadAsync(BASE + file);
        const model = await prepare(gltf.scene, file, kind);
        if (model) (out[kind] = out[kind] || []).push({ file, ...model });
      } catch (e) {
        console.warn(`Tree model ${file} could not be loaded; using the built-in tree instead.`, e);
      }
    }
  }
  return out;
}
