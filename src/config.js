// All tunable values live here. Units: metres, seconds, degrees unless noted.

export const CONFIG = {
  map: {
    size: 300,               // square map edge length
    fieldRadius: 40,         // open circular field in the centre (80 m across)
    fieldEdgeSoftness: 6,    // blend distance between field and forest
    terrainSegments: 150,
    terrainAmplitude: 2.2,   // gentle undulation height in the forest
    boundaryMargin: 4,       // invisible wall distance from edge
    seed: 1337,
  },

  forest: {
    treeSpacing: 4.6,        // jittered grid spacing for tree placement
    treeDensity: 0.82,       // chance a grid cell gets a tree
    bushDensity: 0.55,
    chunkSize: 50,
    lodDistance: 70,         // beyond this chunks use low-detail geometry
    spawnClearRadius: 7,     // clearings around spawn points
    rocksInField: 6,
    logsInField: 2,
    fernCount: 9000,       // decorative ferns across the forest floor
    modelMaxTris: 800,     // loaded (e.g. Meshy) tree models are simplified to at most this many triangles
    modelMaxTrisBush: 300, // …and bushes to this many
    modelMaxTrisGrass: 60, // …and a grass clump to this many (it is repeated thousands of times)
    modelLodFraction: 0.2, // distant version keeps this share of the triangles
    modelLodDistance: 55,  // loaded models switch to the distant version sooner than built-in trees
  },

  teams: {
    size: 20,
    spawnX: 118,             // |x| of spawn centre; Red at -x (west), Blue at +x (east)
    spawnSpread: 22,
  },

  archer: {
    hp: 100,
    quiver: 30,
    maxArrows: 45,
    walkSpeed: 3.4,
    runSpeed: 6.2,
    crouchSpeed: 1.7,
    drawMoveFactor: 0.2,     // drawing a bow slows you to a fifth of walking speed
    jumpVelocity: 5.2,
    gravity: 18,
    radius: 0.38,
    height: 1.8,
    crouchHeight: 1.25,
    headRadius: 0.16,
    stamina: 100,
    staminaDrain: 22,        // per second while sprinting
    staminaRegen: 16,
    staminaJumpCost: 12,
    pickupRadius: 2.6,
  },

  // Minecraft-style bow (1 metre = 1 block, 20 game ticks per second).
  //   charge:   f = held / 1 s (capped at 1); power = (f² + 2f) / 3; below 0.1 power nothing is fired
  //   launch:   power × 60 m/s (3 blocks/tick), plus the shooter's own movement
  //   flight:   speed × 0.99 every tick (drag) and 20 m/s² gravity
  //   damage:   ceil(2 × impact speed in blocks/tick); a full-power arrow is critical and adds
  //             a random 0 … (damage/2 + 1); scaled ×5 because archers have 100 HP, not 20
  bow: {
    fullDrawTime: 1.0,       // seconds to full power
    minPower: 0.1,           // releasing below this keeps the arrow
    fullSpeed: 60,           // m/s at full power
    baseDamage: 2,           // per block/tick of impact speed (Minecraft arrow base damage)
    hpScale: 5,              // Minecraft hit points → Arrowfall hit points (20 HP → 100 HP)
    inaccuracy: 0.0075,      // gaussian jitter added to each component of the aim direction
    headshotMultiplier: 1,   // Minecraft has no headshots; set to 2 to bring them back
    iframes: 0.5,            // seconds of damage immunity after a hit (10 ticks)
    knockback: 6,            // m/s horizontal push from a hit
    knockbackUp: 4.5,        // m/s upward pop from a hit
    swayMax: 0,              // no hold sway in Minecraft (degrees; >0 re-enables it)
    swayDelay: 3.0,
    swayRamp: 2.5,
    crosshairSpread: 0.6,    // fixed crosshair: accuracy doesn't change with draw or movement
    releaseCooldown: 0.1,
    drawZoom: 0.15,          // field of view narrows by up to 15% as you draw (f² curve)
    zoomFov: 52,             // right mouse adds a further optional zoom
  },

  arrows: {
    gravity: 20,             // m/s² (0.05 blocks/tick²)
    drag: 0.99,              // velocity multiplier per tick in air
    poolSize: 1600,          // max arrows in the world (flying + stuck)
    maxFlightTime: 8,
    length: 0.78,
    stuckLifetime: 60,       // stuck arrows despawn after a minute
  },

  camera: {
    fov: 70,
    thirdPersonOffset: { x: 0.55, y: 0.35, z: 2.6 },
    startFirstPerson: true,  // V switches to third person
    near: 0.05,
    far: 320,
  },

  rules: {
    friendlyFire: false,
    roundsToWin: 3,          // best of five
    roundTimeLimit: 480,     // seconds; most survivors wins on timeout (Minecraft-style fights run longer)
    interRoundDelay: 6,
    kotfZoneRadius: 10,
    kotfScoreToWin: 120,
    kotfRespawnDelay: 6,
    onlineRoundBreak: 10,    // seconds between rounds on servers (after the 3 s result banner)
    onlineMatchBreak: 15,    // seconds before a server starts a fresh match
  },

  ai: {
    visionRangeForest: 55,
    visionRangeField: 120,
    fov: 150,
    hearingRange: 16,
    hearingRangeCrouch: 5,
    thinkBudgetPerFrame: 4,  // max bots doing a full "think" each frame
    squadSize: 4,
    retreatHp: 35,
    difficulties: {
      easy:   { aimError: 4.0, reaction: 0.9,  aggression: 0.3, thinkInterval: 0.55, leadSkill: 0.4, drawTarget: 0.6 },
      normal: { aimError: 2.0, reaction: 0.5,  aggression: 0.55, thinkInterval: 0.35, leadSkill: 0.75, drawTarget: 0.8 },
      hard:   { aimError: 0.9, reaction: 0.25, aggression: 0.8, thinkInterval: 0.22, leadSkill: 1.0, drawTarget: 0.95 },
    },
  },

  server: {
    port: 8787,
    tickRate: 60,
    maxRooms: 30,
    maxRoomsPerIp: 3,
    maxConnectionsPerIp: 8,
    emptyRoomTtl: 120,       // seconds a player-made room survives with nobody in it
  },

  graphics: {
    shadows: true,
    shadowMapSize: 2048,
    shadowArea: 70,
    pixelRatioCap: 1.5,
    grassCount: 18000,     // field grass tufts (thinned automatically with distance)
    grassNearDistance: 40,
    grassFarFraction: 0.25,
    flowerCount: 1600,
    grassModelCount: 3500,  // clumps of a loaded grass model, scattered through the built-in grass
    grassModelHeight: 0.5,  // metres
    grassModelBrightness: 1.45, // textured clumps are lifted to match the lit field
  },

  colours: {
    blue: 0x2f6fd6,
    blueDark: 0x1d3f7a,
    red: 0xc8352b,
    redDark: 0x6e1c16,
    skin: 0xd9a77c,
    leather: 0x5a3b22,
  },
};
