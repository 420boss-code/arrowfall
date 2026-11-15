// Loaded on demand by the maths page. Keeps the game, Three.js and the game styles out of the first download.
import './ui/styles.css';
import markup from './game-markup.html?raw';
import { Game } from './core/Game.js';
import { loadTreeModels } from './world/treeModels.js';
import { loadPropModels } from './world/propModels.js';

export async function startGame() {
  document.getElementById('gameRoot').innerHTML = markup;
  const loading = document.getElementById('loading');
  const label = loading.querySelector('h2');
  loading.classList.remove('hidden');
  // tree models (e.g. from Meshy) in public/models/trees/ replace the built-in trees when present
  let treeModels = {};
  try {
    treeModels = await loadTreeModels((msg) => { label.textContent = msg; });
  } catch (e) {
    console.warn('Tree models unavailable, using built-in trees.', e);
  }
  let propModels = null;
  try {
    label.textContent = 'Sharpening knives…';
    propModels = await loadPropModels();
  } catch (e) {
    console.warn('Prop models unavailable, using built-in ones.', e);
  }
  label.textContent = 'Growing the forest…';
  // let the loading panel paint before the forest is generated
  requestAnimationFrame(() => setTimeout(() => {
    const game = new Game(document.getElementById('app'), { treeModels, propModels });
    window.game = game; // handy for debugging in the console
    loading.classList.add('hidden');
  }, 30));
}
