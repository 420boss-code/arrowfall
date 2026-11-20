#!/usr/bin/env node
// Packs dist-static/ (the offline edition) into arrowfall-offline.zip, with index.html at the top
// level, ready to upload to itch.io, Netlify Drop, Neocities and similar. Uses only Node built-ins.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'dist-static');
const OUT = path.join(ROOT, 'arrowfall-offline.zip');

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    return e.isDirectory() ? walk(path.join(dir, e.name), rel) : [rel];
  });
}

if (!fs.existsSync(path.join(SRC, 'index.html'))) { console.error('Build the offline edition first (npm run build:static).'); process.exit(1); }
const files = walk(SRC).sort();
const locals = [], centrals = [];
let offset = 0;
for (const rel of files) {
  const data = fs.readFileSync(path.join(SRC, rel));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const useDeflate = packed.length < data.length;
  const body = useDeflate ? packed : data;
  const name = Buffer.from(rel, 'utf8');
  const crc = crc32(data);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6);
  head.writeUInt16LE(useDeflate ? 8 : 0, 8); head.writeUInt32LE(0, 10);
  head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22);
  head.writeUInt16LE(name.length, 26); head.writeUInt16LE(0, 28);
  locals.push(head, name, body);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
  cen.writeUInt16LE(useDeflate ? 8 : 0, 10); cen.writeUInt32LE(0, 12);
  cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(offset, 42);
  centrals.push(cen, name);
  offset += head.length + name.length + body.length;
}
const cdSize = centrals.reduce((s, b) => s + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
fs.writeFileSync(OUT, Buffer.concat([...locals, ...centrals, end]));
console.log(`arrowfall-offline.zip: ${files.length} files, ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
