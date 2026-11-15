// RUSTLINE — boot and the frame loop. This module assembles the one game state object every
// other module reads (scene, world, actors, effects, sound, hud, round), then runs a
// fixed-step simulation (120 steps a second would be wasted; 60 is the design rate) with
// rendering after each batch of steps. Deterministic parts: the sim step is constant and
// nothing in the loop reads the wall clock except the accumulator that feeds it.

import * as THREE from 'three';
import { TEAM, WEAPONS, BOT } from './config.js';
import { World } from './world.js';
import { NavGraph } from './nav.js';
import { Effects } from './effects.js';
import { SoundBank } from './audio.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Player } from './player.js';
import { Bot } from './bots.js';
import { RoundManager } from './round.js';
import { fire, currentWeapon, updateWeapons } from './weapons.js';

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');           // start | play | end — posed scenes for screenshots
if (params.get('seed')) {
  // a tiny deterministic RNG so a posed scene is the same on every load
  let s = Number(params.get('seed')) * 2654435761 >>> 0;
  Math.random = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.08, 420);
scene.add(camera);

const game = {
  scene, camera,
  time: 0,
  weaponDefs: WEAPONS,
  stats: { shots: 0, hits: 0 },
  actors: [],
  bots: [],
  grenades: [],
  noiseEvents: [],
  hitTargets: [],
  world: null, nav: null, effects: null, sound: null, input: null, hud: null, player: null, round: null, bomb: null,
};

game.world = new World(scene);
game.nav = new NavGraph();
game.effects = new Effects(scene);
game.sound = new SoundBank();
game.input = new Input(renderer.domElement);

game.player = new Player(game);
game.actors.push(game.player);
const BOT_NAMES = {
  [TEAM.WARDEN]: ['Vex', 'Ondo', 'Pell'],
  [TEAM.BREAKER]: ['Rusk', 'Havoc', 'Mira', 'Tarn'],
};
for (const team of [TEAM.WARDEN, TEAM.BREAKER]) {
  BOT_NAMES[team].forEach((name, i) => {
    const bot = new Bot(game, team, name, i);
    game.bots.push(bot);
    game.actors.push(bot);
  });
}
game.hud = new Hud(game);
game.round = new RoundManager(game);

game.refreshHitTargets = () => {
  game.hitTargets = [...game.world.occluders];
  for (const a of game.actors) if (a.alive) game.hitTargets.push(...a.hitMeshes);
};
game.refreshHitTargets();

game.noise = (pos, team, radius) => {
  game.noiseEvents.push({ pos: pos.clone(), team, at: game.time, radius });
  if (game.noiseEvents.length > 24) game.noiseEvents.shift();
};
game.onShotFired = (actor, origin) => game.noise(origin, actor.team, BOT.hearDistance);
game.onKill = (victim, attacker, headshot) => game.round.onKill(victim, attacker, headshot);
game.carrierAlive = () => !!(game.bomb.carrier && game.bomb.carrier.alive);

// ------------------------------------------------------------- menu & buttons

document.getElementById('play').addEventListener('click', () => {
  game.sound.unlock();
  game.round.startMatch();
});
document.getElementById('again').addEventListener('click', () => {
  game.sound.unlock();
  game.round.startMatch();
});
// pointer lock dropped mid-round (Esc): pause the action behind the menu-less overlay
game.input.dom.addEventListener('click', () => {
  if (game.round.state === 'live' && !game.input.locked && game.player.alive) game.input.lock();
});

// ------------------------------------------------------------- screenshot poses
// ?shot=start|play|end&seed=n — used by the maker's screenshot script (shots.json).
// The game runs for real; only the opening state is posed.
if (shotMode) {
  game.sound.unlock = () => {};   // no audio context without a gesture; keep the pose silent
  game.round.startMatch();
  if (shotMode === 'play') {
    const p = game.player;
    p.money = 9000;
    game.round.buyItem('carbine');   // still in the buy phase: purchases are legal here
    game.round.buyItem('armor');
    game.round.endBuy();
    // On the catwalk deck's west end, looking east-south-east along the deck: the
    // catwalk guard crosses the frame, the mid-south crossing and the B lane run
    // through the lower right, and the Breaker push develops there at distance —
    // a live lane view that keeps the posed rifleman out of point-blank traffic.
    p.pos.set(-11, 3, 7.5);
    p.vel.set(0, 0, 0);
    game.input.face(-1.81, -0.11);
    p.frozen = true;               // a posed rifleman on the catwalk, bots fighting below
  } else if (shotMode === 'end') {
    game.round.score = [6, 4];
    game.round.round = 11;
    game.round.endMatch();
  } else {
    // 'start': the menu overlay over a live yard — hold the buy phase open, hide the HUD,
    // show the menu again (startMatch hid it) and park the camera over the yard in step()
    game.round.timer = 3600;
    game.hud.el.buymenu.hidden = true;
    game.hud.el.hud.hidden = true;
    game.hud.el.menu.hidden = false;
  }
}

// ------------------------------------------------------------- the loop

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let prevFiring = false;
let menuAngle = 0;

function step(dt) {
  game.time += dt;
  const actions = game.input.drain();
  const state = game.round.state;

  game.round.update(dt, actions);

  if (state === 'live' || game.round.state === 'live') {
    for (const bot of game.bots) bot.update(dt);
    game.player.update(dt, actions);
    // the player's trigger: automatics repeat while held, semi-automatics need a fresh press
    const p = game.player;
    if (game.input.firing && p.alive && !p.frozen && game.input.locked) {
      const ws = currentWeapon(p);
      if (ws.def.auto || !prevFiring) fire(game, p);
    }
    prevFiring = game.input.firing;
    updateWeapons(game, dt);
  } else if (game.round.state === 'end') {
    for (const bot of game.bots) if (!bot.alive) bot.update(dt);   // corpses settle
    game.player.update(dt, []);
    updateWeapons(game, dt);
  } else if (game.round.state === 'buy') {
    game.player.update(dt, []);
  } else {
    // menu / match end: a slow cinematic orbit over the yard
    menuAngle += dt * 0.045;
    const r = 30;
    camera.position.set(Math.sin(menuAngle) * r, 13.5, Math.cos(menuAngle) * r - 4);
    camera.lookAt(0, 1, -6);
  }

  // prune heard-noise memory
  while (game.noiseEvents.length && game.time - game.noiseEvents[0].at > 1.2) game.noiseEvents.shift();

  if (shotMode === 'start') {
    // the start pose: the menu over an elevated yard vista, whatever the round state
    // machine is doing — the match-end orbit's height and radius at a fixed south-east
    // angle, so the depot containers, the warehouse and the catwalk read behind the
    // panel. (The old spot sat on the catwalk deck inside its own guard rail: a
    // raycast grid over the frame put ~69% of it on deck + rail within 3 m and 0%
    // on the yard itself.)
    camera.position.set(21.2, 13.5, 17.2);
    camera.lookAt(0, 1, -6);
  }

  game.world.update(dt);
  game.effects.update(dt);
  game.hud.update(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  let elapsed = (now - last) / 1000;
  last = now;
  if (elapsed > 0.25) elapsed = 0.25;      // a hidden tab must not teleport the sim
  acc += elapsed;
  while (acc >= STEP) {
    step(STEP);
    acc -= STEP;
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
