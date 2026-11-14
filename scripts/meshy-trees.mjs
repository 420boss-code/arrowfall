#!/usr/bin/env node
// Generate Arrowfall's tree models with Meshy's Text to 3D API (v2) and save them where the game
// looks for them: public/models/trees/. Run it on your own machine with your own key:
//
//   MESHY_API_KEY=your-key node scripts/meshy-trees.mjs            (shows the plan and cost, spends nothing)
//   MESHY_API_KEY=your-key node scripts/meshy-trees.mjs --yes      (generates and downloads)
//
// Options: --only pine,broadleaf,grass,bush   --variants 2   --polycount 1000 (trees; grass uses 300)
// (the game draws thousands of trees, so models are kept light; it simplifies further if needed)
//
// Each model is a preview (mesh, 20 credits with meshy-7.1) then a refine (2K texture, 10 credits):
// about 30 credits per model. Creating API keys needs a paid Meshy plan. Check Meshy's terms for
// how you may use and must credit the generated models.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models/trees');
const CREDITS_PER_MODEL = 30;

const SPECS = {
  pine: {
    prompt: 'A single tall Scots pine tree, stylised low-poly game asset, straight reddish-brown trunk, layered dark green needle canopy starting a third of the way up, whole tree from roots to tip, isolated, no ground, no base, no pot',
    texture: 'Hand-painted stylised textures: warm reddish-brown bark with vertical grooves, deep green pine needles with lighter tips',
  },
  broadleaf: {
    prompt: 'A single mature English oak tree, stylised low-poly game asset, thick trunk with a few large branches, broad rounded leafy canopy, whole tree from roots to crown, isolated, no ground, no base',
    texture: 'Hand-painted stylised textures: grey-brown rough oak bark, rich green leaves with soft yellow-green highlights',
  },
  grass: {
    prompt: 'A small clump of wild meadow grass, a tuft of about a dozen thin curved blades growing from one point, stylised low-poly game asset, ankle height, isolated, no ground, no soil, no base',
    texture: 'Hand-painted stylised grass: darker green at the roots, fresh light green towards the tips',
    polycount: 300,
  },
  bush: {
    prompt: 'A small round leafy forest bush, stylised low-poly game asset, dense green foliage, about knee to waist high, isolated, no ground, no base, no pot',
    texture: 'Hand-painted stylised green leaves with darker shading underneath',
  },
};

// ---------------------------------------------------------------- arguments
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const confirmed = args.includes('--yes');
const kinds = opt('only', 'pine,broadleaf,bush').split(',').map((s) => s.trim()).filter((k) => SPECS[k]);
const variants = Math.max(1, Math.min(4, Number(opt('variants', 2))));
const polycount = Math.max(300, Math.min(30000, Number(opt('polycount', 1000))));
const key = process.env.MESHY_API_KEY;

const jobs = kinds.flatMap((k) => Array.from({ length: variants }, (_, i) => ({ kind: k, file: `${k}_${i + 1}.glb` })));
console.log(`Plan: ${jobs.length} model(s) – ${jobs.map((j) => j.file).join(', ')}`);
console.log(`Target polycount ${polycount} faces each. Estimated cost: about ${jobs.length * CREDITS_PER_MODEL} Meshy credits.`);
if (!key) { console.error('\nSet MESHY_API_KEY in your environment first (it is never written to disk).'); process.exit(1); }
if (!confirmed) { console.log('\nNothing has been spent. Re-run with --yes to generate.'); process.exit(0); }

// ---------------------------------------------------------------- API helpers
const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function create(body) {
  const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Meshy ${res.status}: ${data.message || JSON.stringify(data)}`);
  return data.result;
}

async function wait(id, label) {
  const started = Date.now();
  for (;;) {
    const res = await fetch(`${API}/${id}`, { headers });
    const task = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Meshy ${res.status} while checking ${label}: ${task.message || ''}`);
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') throw new Error(`${label} ${task.status}: ${task.task_error ? task.task_error.message : ''}`);
    process.stdout.write(`\r  ${label}: ${task.status} ${task.progress ?? 0}%   `);
    if (Date.now() - started > 20 * 60 * 1000) throw new Error(`${label} timed out after 20 minutes`);
    await sleep(Number(res.headers.get('retry-after')) || 5);
  }
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${path.basename(file)}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

// ---------------------------------------------------------------- run
fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const creditsFile = path.join(OUT, 'CREDITS.md');
const log = [];

for (const job of jobs) {
  const spec = SPECS[job.kind];
  console.log(`\n${job.file}`);
  try {
    const previewId = await create({
      mode: 'preview', prompt: spec.prompt, ai_model: 'latest',
      should_remesh: true, topology: 'triangle', target_polycount: spec.polycount || polycount, target_formats: ['glb'],
    });
    await wait(previewId, 'preview (mesh)');
    const refineId = await create({ mode: 'refine', preview_task_id: previewId, texture_prompt: spec.texture, enable_pbr: false });
    const task = await wait(refineId, 'refine (texture)');
    if (!task.model_urls || !task.model_urls.glb) throw new Error('No GLB in the result');
    await download(task.model_urls.glb, path.join(OUT, job.file));
    manifest[job.kind] = [...new Set([...(manifest[job.kind] || []), job.file])];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    log.push(`- \`${job.file}\` – Meshy Text to 3D, preview ${previewId}, refine ${refineId}, ${new Date().toISOString().slice(0, 10)}. Prompt: "${spec.prompt}"`);
    console.log(`\r  saved ${job.file}                         `);
  } catch (e) {
    console.error(`\n  ${job.file} failed: ${e.message}`);
  }
}

if (log.length) {
  const head = fs.existsSync(creditsFile) ? '' : '# Tree models\n\nGenerated with Meshy (meshy.ai). Check Meshy\'s terms for attribution and licensing.\n\n';
  fs.appendFileSync(creditsFile, head + log.join('\n') + '\n');
}
console.log(`\nDone. Models are in ${OUT}. Restart "npm run dev" (or rebuild) and the game will use them.`);
