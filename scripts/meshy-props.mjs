#!/usr/bin/env node
// Generate Arrowfall's small prop models (the archer's knife and quiver) with Meshy's Text to 3D API
// and save them to public/models/props/. The game colours them itself, so only the untextured
// preview mesh is made: a few credits each with meshy-6-lite.
//
//   MESHY_API_KEY=your-key node scripts/meshy-props.mjs                 (shows the plan, spends nothing)
//   MESHY_API_KEY=your-key node scripts/meshy-props.mjs --yes           (generates and downloads)
//   ... --only knife   (or quiver)
//
// Missing files are fine: the game falls back to its built-in knife and quiver.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.meshy.ai/openapi/v2/text-to-3d';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public/models/props');

const SPECS = {
  knife: {
    prompt: 'A small hunting knife lying straight, short single-edged steel blade about as long as the handle, simple wooden handle wrapped in leather with a small brass crossguard, stylised low-poly game asset, isolated, no sheath, no base',
    polycount: 400,
  },
  quiver: {
    prompt: 'An empty medieval archer\'s back quiver, a tall slightly tapered leather tube with an open top and a closed rounded bottom, two stitched leather bands, stylised low-poly game asset, upright, isolated, no arrows, no strap, no base',
    polycount: 600,
  },
};

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const kinds = opt('only', 'knife,quiver').split(',').map((s) => s.trim()).filter((k) => SPECS[k]);
const key = process.env.MESHY_API_KEY;
console.log(`Plan: ${kinds.map((k) => `${k}.glb`).join(', ')} – untextured meshes, about ${kinds.length * 5} credits.`);
if (!key) { console.error('\nSet MESHY_API_KEY first (it is never written to disk).'); process.exit(1); }
if (!args.includes('--yes')) { console.log('\nNothing has been spent. Re-run with --yes to generate.'); process.exit(0); }

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

fs.mkdirSync(OUT, { recursive: true });
const log = [];
for (const kind of kinds) {
  const spec = SPECS[kind];
  console.log(`\n${kind}.glb`);
  try {
    const id = await create({
      mode: 'preview', prompt: spec.prompt, ai_model: 'meshy-6-lite',
      should_remesh: true, topology: 'triangle', target_polycount: spec.polycount, target_formats: ['glb'],
    });
    const task = await wait(id, 'preview (mesh)');
    if (!task.model_urls || !task.model_urls.glb) throw new Error('No GLB in the result');
    const res = await fetch(task.model_urls.glb);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    fs.writeFileSync(path.join(OUT, `${kind}.glb`), Buffer.from(await res.arrayBuffer()));
    log.push(`- \`${kind}.glb\` – Meshy Text to 3D (meshy-6-lite preview, untextured), task ${id}, ${new Date().toISOString().slice(0, 10)}. Prompt: "${spec.prompt}"`);
    console.log(`\r  saved ${kind}.glb                       `);
  } catch (e) {
    console.error(`\n  ${kind}.glb failed: ${e.message}`);
  }
}
if (log.length) {
  const file = path.join(OUT, 'CREDITS.md');
  const head = fs.existsSync(file) ? '' : '# Prop models\n\nGenerated with Meshy (meshy.ai). Check Meshy\'s terms for attribution and licensing.\n\n';
  fs.appendFileSync(file, head + log.join('\n') + '\n');
}
