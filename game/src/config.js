// Sunset relay station — shared constants for the three.js tactical FPS.
// One source of truth for weapons, economy, map dimensions and team colours.
// No network access anywhere: every value below is local and static.

// ---- Teams ---------------------------------------------------------------
export const TEAMS = {
  amber: { name: 'Amber', color: 0xff9f1c, css: '#ff9f1c', visor: 0xffe14d, spawnZ: 20 },
  teal: { name: 'Teal', color: 0x19c3d6, css: '#19c3d6', visor: 0x7df9ff, spawnZ: -20 },
};

// ---- Weapons -------------------------------------------------------------
// damage = body damage per hit; head damage is damage * headMult (about 2x).
// spread is radians of cone half-angle at rest; moveSpread adds while moving.
export const WEAPONS = {
  pistol: {
    id: 'pistol', slot: 1, name: 'P9 Sidearm', price: 0, auto: false,
    damage: 30, headMult: 2.0, fireInterval: 0.16, reloadTime: 1.1,
    magSize: 12, reserveMax: 48, spread: 0.006, moveSpread: 0.030,
    recoil: 0.010, range: 60, tracer: 0xffe14d, sound: 'pistol',
  },
  smg: {
    id: 'smg', slot: 2, name: 'Dune-9 SMG', price: 1500, auto: true,
    damage: 25, headMult: 2.0, fireInterval: 0.085, reloadTime: 1.5,
    magSize: 32, reserveMax: 96, spread: 0.011, moveSpread: 0.034,
    recoil: 0.008, range: 55, tracer: 0xffc46b, sound: 'smg',
  },
  rifle: {
    id: 'rifle', slot: 3, name: 'VK-47 Carbine', price: 2700, auto: true,
    damage: 40, headMult: 2.0, fireInterval: 0.11, reloadTime: 1.9,
    magSize: 30, reserveMax: 90, spread: 0.007, moveSpread: 0.032,
    recoil: 0.014, range: 70, tracer: 0xffd166, sound: 'rifle',
  },
  shotgun: {
    id: 'shotgun', slot: 4, name: 'Breacher 12', price: 1800, auto: false,
    damage: 13, headMult: 2.0, fireInterval: 0.85, reloadTime: 2.4,
    magSize: 6, reserveMax: 24, spread: 0.055, moveSpread: 0.060,
    recoil: 0.045, range: 22, tracer: 0xffb703, sound: 'shotgun', pellets: 8,
  },
  sniper: {
    id: 'sniper', slot: 5, name: 'Longshot 50', price: 4000, auto: false,
    damage: 82, headMult: 2.0, fireInterval: 1.15, reloadTime: 2.8,
    magSize: 5, reserveMax: 15, spread: 0.001, moveSpread: 0.060,
    recoil: 0.060, range: 90, tracer: 0xffffff, sound: 'sniper',
  },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'shotgun', 'sniper'];

// ---- Grenades ------------------------------------------------------------
export const GRENADES = {
  frag: { id: 'frag', name: 'Frag Grenade', price: 300, key: 'frag' },
  flash: { id: 'flash', name: 'Flashbang', price: 200, key: 'flash' },
  smoke: { id: 'smoke', name: 'Smoke Grenade', price: 300, key: 'smoke' },
};
export const GRENADE_ORDER = ['frag', 'flash', 'smoke'];

// ---- Economy -------------------------------------------------------------
export const ECONOMY = {
  startMoney: 800,
  killReward: 300,
  winReward: 3250,
  lossReward: 1900,
  kevlarPrice: 650,
  kevlarAbsorb: 0.5,
};

// ---- Match rules ---------------------------------------------------------
export const MATCH = {
  roundsToWin: 5,
  maxRounds: 9,
  buyPhaseSeconds: 5,
  roundSeconds: 100,
  bombPlantSeconds: 3,
  bombDefuseSeconds: 5,
  bombTimerSeconds: 35,
  roundEndSeconds: 3.5,
  playerHealth: 100,
  respawnSeconds: 0,
};

// ---- Map -----------------------------------------------------------------
// Arena in metres. X east, Z south (three.js: -Z is north). Attackers (Amber)
// spawn south, defenders (Teal) north. Site A north-west, site B north-east.
export const MAP = {
  halfX: 32,
  halfZ: 24,
  wallHeight: 4,
  siteRadius: 5.5,
  siteA: { x: -22, z: -16, label: 'A' },
  siteB: { x: 22, z: -16, label: 'B' },
  attackerSpawn: { x: 0, z: 20 },
  defenderSpawn: { x: 0, z: -20 },
  eyeHeight: 1.62,
  crouchEyeHeight: 1.05,
  playerRadius: 0.42,
};

// ---- Small helpers -------------------------------------------------------
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randPick = (arr) => arr[(Math.random() * arr.length) | 0];
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
export const TAU = Math.PI * 2;
export function angleLerp(a, b, t) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
}
