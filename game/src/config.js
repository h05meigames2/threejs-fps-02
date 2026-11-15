// RUSTLINE — central tuning table. Every gameplay number the other modules read lives here,
// so balance changes happen in one place and the simulation never reaches for a magic literal.

// Teams. The player always fights for the Wardens (defence); the Breakers attack with the bomb.
export const TEAM = { WARDEN: 0, BREAKER: 1 };
export const TEAM_NAME = ['Wardens', 'Breakers'];
export const TEAM_COLOR = [0x2fbfae, 0xe06432]; // teal vs rust

// Match and round shape.
export const MATCH = {
  roundsToWin: 7,        // first to 7 takes the match
  maxRounds: 12,          // hard cap; 6-6 is a draw
  buySeconds: 12,         // frozen buy phase at each round start
  roundSeconds: 100,      // live clock before the bomb decides it
  endSeconds: 4.5,        // banner pause between rounds
  bombFuseSeconds: 35,    // after a plant, Wardens have this long to defuse
  plantSeconds: 3,        // carrier channel time inside a site
  defuseSeconds: 5,       // Warden channel time on a planted bomb
  startMoney: 800,
  maxMoney: 9000,
};

// Economy: what a round pays and what the shop charges.
export const PAY = {
  kill: 300,
  plant: 300,        // to the planter's team pool (each living member)
  winElimination: 1400,
  winObjective: 1500,
  loss: 1200,
};

// Weapon table. damage is per pellet at point blank against the chest; head/leg multipliers and
// distance falloff are applied in weapons.js. spread is in radians at rest; moveSpread multiplies
// it while the shooter is moving or airborne. rpm is rounds per minute; 0 means semi-automatic.
export const WEAPONS = {
  sidearm: {
    name: 'P9 Sidearm', slot: 2, price: 0, damage: 26, headMult: 3.4, legMult: 0.7,
    rpm: 320, auto: false, mag: 12, reserve: 96, reloadSeconds: 1.5,
    spread: 0.011, moveSpread: 3.2, recoil: 0.011, range: 55, pellets: 1,
    falloffStart: 14, falloffEnd: 46, zoom: 1.0, tracer: 0xffd9a0,
  },
  wasp: {
    name: 'Wasp SMG', slot: 1, price: 1500, damage: 19, headMult: 3.0, legMult: 0.7,
    rpm: 780, auto: true, mag: 30, reserve: 120, reloadSeconds: 2.0,
    spread: 0.02, moveSpread: 2.4, recoil: 0.007, range: 45, pellets: 1,
    falloffStart: 9, falloffEnd: 34, zoom: 1.0, tracer: 0xffe9b0,
  },
  scatter: {
    name: 'Scattergun', slot: 1, price: 1800, damage: 13, headMult: 2.2, legMult: 0.8,
    rpm: 68, auto: false, mag: 6, reserve: 30, reloadSeconds: 3.1,
    spread: 0.045, moveSpread: 2.0, recoil: 0.05, range: 26, pellets: 7,
    falloffStart: 5, falloffEnd: 18, zoom: 1.0, tracer: 0xffc98a,
  },
  carbine: {
    name: 'VK-7 Carbine', slot: 1, price: 2700, damage: 33, headMult: 3.6, legMult: 0.75,
    rpm: 600, auto: true, mag: 30, reserve: 120, reloadSeconds: 2.4,
    spread: 0.008, moveSpread: 3.6, recoil: 0.013, range: 80, pellets: 1,
    falloffStart: 22, falloffEnd: 70, zoom: 1.12, tracer: 0xffe2a8,
  },
  longshot: {
    name: 'Longshot DMR', slot: 1, price: 3300, damage: 72, headMult: 2.6, legMult: 0.6,
    rpm: 150, auto: false, mag: 10, reserve: 40, reloadSeconds: 2.8,
    spread: 0.0025, moveSpread: 5.0, recoil: 0.034, range: 120, pellets: 1,
    falloffStart: 40, falloffEnd: 110, zoom: 2.4, tracer: 0xfff3c4,
  },
};

export const ARMOR_PRICE = 650;
export const ARMOR_ABSORB = 0.55;   // fraction of damage a vest+helmet soaks (rounded up kept)
export const GRENADES = {
  frag: { name: 'Frag grenade', price: 300, damage: 92, radius: 6.5, fuse: 1.6 },
  smoke: { name: 'Smoke grenade', price: 300, radius: 5.2, duration: 13 },
};

// Actor physics shared by the player and every bot.
export const ACTOR = {
  radius: 0.36,
  standHeight: 1.78,
  crouchHeight: 1.28,
  eyeStand: 1.62,
  eyeCrouch: 1.12,
  walkSpeed: 4.4,
  crouchSpeed: 2.1,
  accel: 42,
  airAccel: 6,
  friction: 11,
  jumpSpeed: 6.4,   // ~1.3 m of jump: enough to mount a 1.2 m crate, not a container
  gravity: 15.5,
  health: 100,
};

// Bot perception and gun skill. Distances in metres, times in seconds.
export const BOT = {
  viewDistance: 46,
  viewCos: Math.cos(1.25),     // ~143 degree total cone; generous so bots feel aware
  reaction: 0.34,              // delay between seeing a target and the first aimed shot
  burstPause: 0.42,            // pause between bursts
  aimError: 0.028,             // base angular error in radians, scaled by target movement
  forgetSeconds: 2.6,          // how long a bot keeps hunting a lost target's last position
  hearDistance: 26,            // gunshots inside this radius alert the bot
  plantRange: 3.4,             // carrier must stand this close to the site centre to plant
};
