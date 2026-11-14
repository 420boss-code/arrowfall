// Shared wire format. Snapshots are binary (Float32Array) for size; everything else is JSON.
//
// Snapshot layout: HEADER floats, then STRIDE floats per archer (in game.archers order).
//   header: [1, serverTime, roundTime, zoneBlue, zoneRed, zoneCode, winsBlue, winsRed, round, roundOver]
//   archer: [x, y, z, yaw, pitch, vx, vz, hp, arrows, flags, drawTime, epoch]
export const HEADER = 10;
export const STRIDE = 12;
export const SNAP_RATE = 20;       // snapshots per second
export const CLIENT_RATE = 30;     // client state messages per second

export const FL = {
  ALIVE: 1, CROUCH: 2, DRAW: 4, GROUND: 8, SPRINT: 16, DDIR: 32, SPOT_BLUE: 64, SPOT_RED: 128,
};

export const ZONE = { none: 0, blue: 1, red: 2, contested: 3 };

export function encodeSnapshot(game) {
  const n = game.archers.length;
  const f = new Float32Array(HEADER + n * STRIDE);
  f[0] = 1;
  f[1] = game.time;
  f[2] = game.roundTime || 0;
  f[3] = game.zoneScore ? game.zoneScore.blue : 0;
  f[4] = game.zoneScore ? game.zoneScore.red : 0;
  f[5] = game.zoneContested ? ZONE.contested : ZONE[game.zoneOwner || 'none'];
  f[6] = game.roundWins.blue;
  f[7] = game.roundWins.red;
  f[8] = game.round;
  f[9] = game.roundOver ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const a = game.archers[i];
    const b = HEADER + i * STRIDE;
    f[b] = a.pos.x; f[b + 1] = a.pos.y; f[b + 2] = a.pos.z;
    f[b + 3] = a.yaw; f[b + 4] = a.pitch;
    f[b + 5] = a.vel.x; f[b + 6] = a.vel.z;
    f[b + 7] = a.hp; f[b + 8] = a.arrows;
    let fl = 0;
    if (a.alive) fl |= FL.ALIVE;
    if (a.crouching) fl |= FL.CROUCH;
    if (a.drawing) fl |= FL.DRAW;
    if (a.onGround) fl |= FL.GROUND;
    if (a.sprinting) fl |= FL.SPRINT;
    if (a.deathDir > 0) fl |= FL.DDIR;
    if (game.isSpotted(a, 'blue')) fl |= FL.SPOT_BLUE;
    if (game.isSpotted(a, 'red')) fl |= FL.SPOT_RED;
    f[b + 9] = fl;
    f[b + 10] = a.drawTime;
    f[b + 11] = a.epoch;
  }
  return f;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
export const vec3 = (v) => [r3(v.x), r3(v.y), r3(v.z)];

// Names and room titles: letters, digits, spaces, _ and - only.
export function cleanName(s, max = 16, fallback = 'Archer') {
  const t = String(s || '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return t || fallback;
}
