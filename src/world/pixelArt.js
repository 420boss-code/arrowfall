// Blocky pixel-art look: small textures drawn in code (no image files), shown with nearest-neighbour
// filtering so every texel is a crisp square. All designs here are original to Arrowfall.
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

function canvasTexture(w, h, draw, { repeat = false, mip = true } = {}) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = mip ? THREE.NearestMipmapLinearFilter : THREE.NearestFilter;
  t.generateMipmaps = mip;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const px = (ctx, x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, 1, 1); };
const grey = (v, a = 1) => { const n = Math.round(Math.max(0, Math.min(1, v)) * 255); return `rgba(${n},${n},${n},${a})`; };

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

// Woven cloth / leather: light speckled grey that the instance colour tints (team colours etc.).
export const clothTexture = () => once('cloth', () => canvasTexture(8, 8, (ctx) => {
  const r = mulberry32(17);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(ctx, x, y, grey(0.8 + r() * 0.2 - (y % 4 === 3 ? 0.06 : 0)));
}, { mip: false }));

// The face: front of the head cube. Skin, a fringe of hair, two eyes and a mouth.
export const faceTexture = () => once('face', () => canvasTexture(8, 8, (ctx) => {
  const r = mulberry32(5);
  const skin = ['#d9a77f', '#d29d74', '#dcae86'];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(ctx, x, y, skin[Math.floor(r() * 3)]);
  for (let x = 0; x < 8; x++) px(ctx, x, 0, '#5a3a22');
  px(ctx, 0, 1, '#5a3a22'); px(ctx, 7, 1, '#5a3a22');
  // eyes: white then pupil, looking slightly inward
  px(ctx, 1, 4, '#f4f1ea'); px(ctx, 2, 4, '#2c3e66');
  px(ctx, 5, 4, '#2c3e66'); px(ctx, 6, 4, '#f4f1ea');
  px(ctx, 1, 3, '#7a5236'); px(ctx, 2, 3, '#7a5236'); px(ctx, 5, 3, '#7a5236'); px(ctx, 6, 3, '#7a5236');
  px(ctx, 3, 5, '#c08a63'); px(ctx, 4, 5, '#c08a63');
  px(ctx, 3, 6, '#8e4f3c'); px(ctx, 4, 6, '#8e4f3c');
}, { mip: false }));

// Skin on the other faces of the head (and hands).
export const skinTexture = () => once('skin', () => canvasTexture(8, 8, (ctx) => {
  const r = mulberry32(9);
  const skin = ['#d9a77f', '#d29d74', '#dcae86'];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(ctx, x, y, skin[Math.floor(r() * 3)]);
}, { mip: false }));

// Back of the head: hair.
export const hairTexture = () => once('hair', () => canvasTexture(8, 8, (ctx) => {
  const r = mulberry32(11);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px(ctx, x, y, ['#5a3a22', '#4e321d', '#644127'][Math.floor(r() * 3)]);
}, { mip: false }));

// A grass tuft for crossed quads: 16×16, transparent background, blades in light greens that the
// instance colour tints (lush, dry and deep patches).
export const grassTexture = () => once('grass', () => canvasTexture(16, 16, (ctx) => {
  const r = mulberry32(31);
  for (let b = 0; b < 9; b++) {
    let x = 1 + Math.floor(r() * 14);
    const h = 6 + Math.floor(r() * 10);
    for (let k = 0; k < h; k++) {
      const y = 15 - k;
      if (k > 3 && r() < 0.25) x = Math.max(0, Math.min(15, x + (r() < 0.5 ? -1 : 1)));
      const shade = 0.62 + (k / h) * 0.38 + (r() - 0.5) * 0.08;
      px(ctx, x, y, `rgb(${Math.round(shade * 200)},${Math.round(shade * 255)},${Math.round(shade * 170)})`);
    }
  }
}, { mip: true }));

// A small flower: stem and leaves in green, the head in white so the instance colour sets its hue.
export const flowerTexture = () => once('flower', () => canvasTexture(16, 16, (ctx) => {
  for (let y = 7; y < 16; y++) px(ctx, 7, y, '#3f7f2c');
  px(ctx, 6, 11, '#4f9a36'); px(ctx, 5, 10, '#4f9a36'); px(ctx, 8, 12, '#4f9a36'); px(ctx, 9, 11, '#4f9a36');
  const petal = '#ffffff', mid = '#f2e2a0';
  for (const [x, y] of [[6, 3], [7, 3], [8, 3], [5, 4], [9, 4], [5, 5], [9, 5], [6, 6], [7, 6], [8, 6], [6, 4], [8, 4], [6, 5], [8, 5]]) px(ctx, x, y, petal);
  px(ctx, 7, 4, mid); px(ctx, 7, 5, mid);
}, { mip: true }));

// Ground: a 16×16 tile of speckled greys, one tile per metre, multiplied over the ground colours.
export const groundTexture = () => once('ground', () => canvasTexture(16, 16, (ctx) => {
  const r = mulberry32(47);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = 0.78 + r() * 0.22 - (r() < 0.06 ? 0.12 : 0);
    px(ctx, x, y, grey(v));
  }
}, { repeat: true, mip: true }));

// Two vertical quads crossed in an X, base at y = 0, 1 × 1. Normals point up so both sides light alike.
export function crossQuadGeometry() {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  a.rotateY(Math.PI / 4); b.rotateY(Math.PI / 4);
  const pos = [], uv = [], nor = [];
  for (const g of [a, b]) {
    const ng = g.toNonIndexed();
    pos.push(...ng.attributes.position.array);
    uv.push(...ng.attributes.uv.array);
    for (let i = 0; i < ng.attributes.position.count; i++) nor.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

// A bow built from small cubes along a stepped arc (tips at y ±0.62, belly toward -Z), with a
// darker wrapped grip. Vertex colours are light so the material/instance colour gives the wood.
export function voxelBowGeometry() {
  const parts = [];
  const step = 0.052, size = 0.05;
  const box = new THREE.BoxGeometry(size, size, size);
  const n = 25;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * 2 - 1;
    const y = Math.round((t * 0.62) / step) * step;
    const z = Math.round((-0.14 * (1 - t * t) + 0.04 * Math.pow(Math.abs(t), 6)) / (step * 0.5)) * (step * 0.5);
    const g = box.clone().translate(0, y, z);
    const grip = Math.abs(t) < 0.12, tip = Math.abs(t) > 0.92;
    const shade = grip ? 0.55 : tip ? 1.25 : 1 - (i % 2) * 0.08;
    const col = new Float32Array(g.attributes.position.count * 3).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  // merge
  let count = 0;
  for (const p of parts) count += p.index ? p.index.count : p.attributes.position.count;
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), col = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const ng = p.index ? p.toNonIndexed() : p;
    pos.set(ng.attributes.position.array, o * 3); nor.set(ng.attributes.normal.array, o * 3); col.set(ng.attributes.color.array, o * 3);
    o += ng.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
