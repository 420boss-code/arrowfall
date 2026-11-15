// Marketplace items: cosmetics (looks only) and perks (small gameplay boosts, one equipped at a time).
// Pure data plus the weekly stock rotation, shared by the game, the marketplace and the server.
import { mulberry32 } from './utils.js';

// ---------------------------------------------------------------- perks
// mods: quiver (+arrows carried and at spawn), bandages (+per life), speed (×), stamina (×),
// draw (× time to full draw), herb (× herb healing), knifeCd (× knife cooldown), regenDelay (+ seconds)
export const PERK_DEFAULTS = { quiver: 0, bandages: 0, speed: 1, stamina: 1, draw: 1, herb: 1, knifeCd: 1, regenDelay: 0 };
export const PERKS = {
  deep_quiver: { name: 'Deep Quiver', desc: 'Start every life with 6 more arrows, and carry 6 more.', price: 800, rarity: 'epic', mods: { quiver: 6 } },
  field_medic: { name: 'Field Medic', desc: 'One extra bandage every life (3 instead of 2).', price: 700, rarity: 'rare', mods: { bandages: 1 } },
  fleet_foot: { name: 'Fleet Foot', desc: 'Move 5% faster.', price: 750, rarity: 'rare', mods: { speed: 1.05 } },
  iron_lungs: { name: 'Iron Lungs', desc: '20% more stamina for sprinting and jumping.', price: 550, rarity: 'common', mods: { stamina: 1.2 } },
  steady_hands: { name: 'Steady Hands', desc: 'Reach full draw 10% sooner (0.9 s instead of 1 s).', price: 900, rarity: 'epic', mods: { draw: 0.9 } },
  herbalist: { name: 'Herbalist', desc: 'Healing herbs heal 60 instead of 40.', price: 500, rarity: 'common', mods: { herb: 1.5 } },
  quick_blade: { name: 'Quick Blade', desc: 'Stab again 25% sooner.', price: 600, rarity: 'rare', mods: { knifeCd: 0.75 } },
  second_wind: { name: 'Second Wind', desc: 'Start healing naturally after 4 s without a hit, instead of 6.', price: 650, rarity: 'rare', mods: { regenDelay: -2 } },
};

export function perkMods(id) {
  return { ...PERK_DEFAULTS, ...(PERKS[id] ? PERKS[id].mods : {}) };
}

// ---------------------------------------------------------------- cosmetics
// bow: wood colour · hood: hood colour · knife: tint over the knife · trail: sparkles behind every
// arrow you shoot · fx: colour of the burst when you take someone down ('rainbow' for many colours)
export const SLOTS = { bow: 'Bow', hood: 'Hood', knife: 'Knife', trail: 'Arrow trail', fx: 'Kill effect', perk: 'Perk' };
const c = (cat, name, rarity, colour, extra = {}) => ({ cat, name, rarity, colour, ...extra });
export const COSMETICS = {
  bow_yew: c('bow', 'Yew Longbow', 'common', 0xa8552a),
  bow_birch: c('bow', 'Silver Birch', 'common', 0xd8d2c2),
  bow_blackthorn: c('bow', 'Blackthorn', 'rare', 0x2b2421),
  bow_verdigris: c('bow', 'Verdigris', 'rare', 0x3f8f7a),
  bow_crimson: c('bow', 'Crimson Lacquer', 'rare', 0x9e1b22),
  bow_frost: c('bow', 'Frostbark', 'epic', 0x9cc6e6),
  bow_gilded: c('bow', 'Gilded Bow', 'epic', 0xd9ab3a),
  hood_moss: c('hood', 'Moss Hood', 'common', 0x5b7a3a),
  hood_charcoal: c('hood', 'Charcoal Hood', 'common', 0x2f3235),
  hood_saffron: c('hood', 'Saffron Hood', 'common', 0xe0a526),
  hood_snow: c('hood', 'Snow Hood', 'rare', 0xeef1f4),
  hood_ember: c('hood', 'Ember Hood', 'rare', 0xd2552a),
  hood_royal: c('hood', 'Royal Hood', 'epic', 0x5b2b8c),
  knife_bronze: c('knife', 'Bronze Knife', 'common', 0xc98a4b, { tint: [1.1, 0.8, 0.5] }),
  knife_obsidian: c('knife', 'Obsidian Knife', 'rare', 0x3a3540, { tint: [0.38, 0.35, 0.44] }),
  knife_frost: c('knife', 'Frost Knife', 'rare', 0xa8d8ff, { tint: [0.75, 0.95, 1.25] }),
  knife_gilded: c('knife', 'Gilded Knife', 'epic', 0xe6b84a, { tint: [1.3, 1.05, 0.45] }),
  trail_ember: c('trail', 'Ember Trail', 'common', 0xff7326, { rgb: [1, 0.45, 0.15] }),
  trail_verdant: c('trail', 'Verdant Trail', 'common', 0x66ff73, { rgb: [0.4, 1, 0.45] }),
  trail_frost: c('trail', 'Frost Trail', 'rare', 0x99d9ff, { rgb: [0.6, 0.85, 1] }),
  trail_violet: c('trail', 'Violet Trail', 'rare', 0xbf73ff, { rgb: [0.75, 0.45, 1] }),
  trail_gold: c('trail', 'Golden Trail', 'epic', 0xffd94d, { rgb: [1, 0.85, 0.3] }),
  fx_ember: c('fx', 'Ember Sparks', 'common', 0xff6a1a),
  fx_frost: c('fx', 'Frost Shards', 'rare', 0x8fd3ff),
  fx_violet: c('fx', 'Violet Smoke', 'rare', 0x9a4dff),
  fx_gold: c('fx', 'Gold Leaf', 'epic', 0xffcc33),
  fx_rainbow: c('fx', 'Prism Burst', 'epic', 0xff4fa3, { rainbow: true }),
};
const COS_PRICE = { common: 150, rare: 300, epic: 500 };
for (const it of Object.values(COSMETICS)) it.price = COS_PRICE[it.rarity];

// Every item in one list: { id, cat, name, rarity, price, ... }
export const CATALOGUE = [
  ...Object.entries(COSMETICS).map(([id, it]) => ({ id, ...it })),
  ...Object.entries(PERKS).map(([id, it]) => ({ id, cat: 'perk', ...it })),
];
export const ITEM = Object.fromEntries(CATALOGUE.map((it) => [it.id, it]));

// Keep only real item ids, each in its own slot (used for anything that arrives over the network).
export function cleanLoadout(l) {
  const out = {};
  if (!l || typeof l !== 'object') return out;
  for (const slot of Object.keys(SLOTS)) {
    const id = l[slot];
    if (typeof id === 'string' && ITEM[id] && ITEM[id].cat === slot) out[slot] = id;
  }
  return out;
}

// ---------------------------------------------------------------- the weekly stock
// A new week starts every Monday at 00:00 UTC. The stock is the same for everyone: it is picked by
// a random generator seeded with the week number.
const EPOCH = Date.UTC(2024, 0, 1); // a Monday
const WEEK = 7 * 864e5;
export const weekIndex = (now = Date.now()) => Math.floor((now - EPOCH) / WEEK);
export const weekStarts = (w) => EPOCH + w * WEEK;

export function weeklyStock(week = weekIndex()) {
  const rand = mulberry32(week * 7919 + 1301);
  const shuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // four cosmetics from four different slots, two perks
  const cats = shuffle(['bow', 'hood', 'knife', 'trail', 'fx']).slice(0, 4);
  const cos = cats.map((cat) => shuffle(CATALOGUE.filter((it) => it.cat === cat))[0]);
  const perks = shuffle(CATALOGUE.filter((it) => it.cat === 'perk')).slice(0, 2);
  const items = [...cos, ...perks];
  const deal = items[Math.floor(rand() * items.length)].id;
  return items.map((it) => ({ ...it, price: it.id === deal ? Math.round((it.price * 0.7) / 10) * 10 : it.price, was: it.id === deal ? it.price : null }));
}
