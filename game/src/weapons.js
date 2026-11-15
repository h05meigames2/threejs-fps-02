// Gunplay: hitscan weapons with spread, recoil bloom, distance falloff and hit zones, plus
// thrown grenades with real projectile physics. One fire() path serves the player and every
// bot, so the rules are identical on both sides of the gun. Damage numbers come from
// config.js; this module is the mechanics only.

import * as THREE from 'three';
import { WEAPONS, ACTOR } from './config.js';

const _ray = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export function weaponState(key) {
  const def = WEAPONS[key];
  return { key, def, mag: def.mag, reserve: def.reserve };
}

export function newLoadout() {
  return {
    primary: null,
    sidearm: weaponState('sidearm'),
    current: 'sidearm',
    lastSlot: 'sidearm',
    armor: false,
    frag: 0,
    smoke: 0,
  };
}

export function currentWeapon(actor) {
  const l = actor.loadout;
  return l.current === 'primary' && l.primary ? l.primary : l.sidearm;
}

export function giveWeapon(actor, key) {
  const def = WEAPONS[key];
  const ws = weaponState(key);
  if (def.slot === 1) {
    actor.loadout.primary = ws;
    actor.loadout.current = 'primary';
  } else {
    actor.loadout.sidearm = ws;
    actor.loadout.current = 'sidearm';
  }
  return ws;
}

export function eyePos(actor, out) {
  return out.set(actor.pos.x, actor.pos.y + actor.eyeHeight, actor.pos.z);
}

// How wild the cone is right now: still and crouched is a laser, sprinting is a hose.
export function spreadFor(actor, def) {
  const speed = Math.hypot(actor.vel.x, actor.vel.z);
  const moveT = Math.min(1.25, speed / ACTOR.walkSpeed);
  let s = def.spread * (1 + (def.moveSpread - 1) * moveT);
  if (!actor.onGround) s *= 2.1;
  if (actor.crouching) s *= 0.68;
  if (actor.aiming) s *= 0.4;
  s += actor.bloom * 0.012;
  return s;
}

function falloff(def, dist) {
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return 0.45;
  const t = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 - t * 0.55;
}

// Fire one trigger pull. Returns true when a round actually left the barrel.
export function fire(game, actor) {
  const ws = currentWeapon(actor);
  const def = ws.def;
  const now = game.time;
  if (actor.reloading || now < actor.nextShotAt || !actor.alive) return false;
  if (ws.mag <= 0) {
    if (actor.isPlayer) game.sound.dryFire();
    actor.nextShotAt = now + 0.3;
    startReload(game, actor);
    return false;
  }
  ws.mag--;
  actor.nextShotAt = now + 60 / def.rpm;
  actor.bloom = Math.min(6, actor.bloom + 1);
  actor.lastShotAt = now;

  eyePos(actor, _origin);
  // Aim direction: bots steer an explicit aimDir; the player aims where the camera looks.
  if (actor.aimDir) _dir.copy(actor.aimDir);
  else {
    _dir.set(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch));
  }
  const spread = spreadFor(actor, def);
  muzzlePos(game, actor, _muzzle);

  for (let p = 0; p < def.pellets; p++) {
    // perturb the direction inside the spread cone
    _tmp.copy(_dir);
    _tmp.x += (Math.random() * 2 - 1) * spread;
    _tmp.y += (Math.random() * 2 - 1) * spread;
    _tmp.z += (Math.random() * 2 - 1) * spread;
    _tmp.normalize();
    _ray.set(_origin, _tmp);
    _ray.far = def.range;
    const hits = _ray.intersectObjects(game.hitTargets, false);
    let end = null;
    for (const hit of hits) {
      const ud = hit.object.userData;
      if (ud.actor === actor) continue;
      if (ud.actor && ud.actor.team === actor.team) continue;   // no friendly fire
      if (ud.actor && !ud.actor.alive) continue;
      end = hit.point;
      if (ud.actor) damageActor(game, actor, ud.actor, def, ud.zone, hit.distance);
      else game.effects.sparks(hit.point, _tmp, 6);
      break;
    }
    if (!end) {
      end = _tmp.multiplyScalar(def.range).add(_origin);
    }
    game.effects.tracer(_muzzle, end, def.tracer);
  }
  game.effects.muzzle(_muzzle);
  if (actor.isPlayer && game.stats) game.stats.shots += def.pellets;
  const distToPlayer = game.player && actor !== game.player ? actor.pos.distanceTo(game.player.pos) : 0;
  game.sound.shot(actorWeaponKind(actor), actor.isPlayer ? 0 : Math.min(1, distToPlayer / 42));
  game.onShotFired(actor, _origin);
  // recoil: the player's view kicks (part permanent muzzle climb on the input pitch, part
  // a springy kick the rig settles); bots just accumulate bloom (already done above)
  if (actor.isPlayer) {
    actor.recoilKick += def.recoil;
    game.input.pitch += def.recoil * 0.3;
    const lim = Math.PI / 2 - 0.02;
    game.input.pitch = Math.min(lim, game.input.pitch);
  }
  if (ws.mag === 0) startReload(game, actor);
  return true;
}

function actorWeaponKind(actor) {
  return currentWeapon(actor).key;
}

function muzzlePos(game, actor, out) {
  if (actor.gunTip) return actor.gunTip.getWorldPosition(out);
  return eyePos(actor, out).add(_tmp.set(0, -0.12, 0));
}

export function damageActor(game, attacker, victim, def, zone, dist) {
  let dmg = def.damage * falloff(def, dist);
  if (zone === 'head') dmg *= def.headMult;
  else if (zone === 'legs') dmg *= def.legMult;
  if (victim.loadout.armor) dmg *= 1 - 0.55;
  dmg = Math.max(1, Math.round(dmg));
  const wasAlive = victim.alive;
  victim.health -= dmg;
  victim.lastAttacker = attacker;
  victim.lastHitAt = game.time;
  if (attacker.isPlayer && game.stats) game.stats.hits++;
  if (attacker.isPlayer && wasAlive) {
    game.hud.hitmarker(zone === 'head', victim.health <= 0);
    game.sound.hit(zone === 'head');
  }
  if (victim.isPlayer) {
    game.hud.damageFlash(attacker.pos);
    game.sound.hurt();
  }
  game.effects.puff(_tmp.copy(victim.pos).setY(victim.pos.y + (zone === 'head' ? 1.55 : 1.05)), 0x7e2a22, zone === 'head' ? 0.4 : 0.55);
  if (victim.health <= 0 && wasAlive) {
    victim.health = 0;
    game.onKill(victim, attacker, zone === 'head');
  }
}

export function startReload(game, actor) {
  const ws = currentWeapon(actor);
  if (actor.reloading || ws.mag >= ws.def.mag || ws.reserve <= 0) return;
  actor.reloading = true;
  actor.reloadEnd = game.time + ws.def.reloadSeconds;
  if (actor.isPlayer) game.sound.reloadStart();
}

function finishReload(game, actor) {
  const ws = currentWeapon(actor);
  const take = Math.min(ws.def.mag - ws.mag, ws.reserve);
  ws.mag += take;
  ws.reserve -= take;
  actor.reloading = false;
  if (actor.isPlayer) game.sound.reloadEnd();
}

// --------------------------------------------------------------------------- grenades

const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMats = {
  frag: new THREE.MeshStandardMaterial({ color: 0x4a5d3a, roughness: 0.6 }),
  smoke: new THREE.MeshStandardMaterial({ color: 0xb9bdc2, roughness: 0.5 }),
};

export function throwGrenade(game, actor, kind) {
  if (actor.loadout[kind] <= 0 || !actor.alive) return false;
  actor.loadout[kind]--;
  eyePos(actor, _origin);
  if (actor.aimDir) _dir.copy(actor.aimDir);
  else _dir.set(-Math.sin(actor.yaw) * Math.cos(actor.pitch), Math.sin(actor.pitch), -Math.cos(actor.yaw) * Math.cos(actor.pitch));
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMats[kind]);
  mesh.position.copy(_origin).addScaledVector(_dir, 0.4);
  game.scene.add(mesh);
  game.grenades.push({
    mesh, kind,
    pos: mesh.position,
    vel: new THREE.Vector3().copy(_dir).multiplyScalar(15.5).add(_tmp.set(actor.vel.x * 0.5, 1.6, actor.vel.z * 0.5)),
    fuseAt: game.time + (kind === 'frag' ? 1.6 : 1.15),
    owner: actor,
    settled: false,
  });
  game.sound.throwWhoosh();
  return true;
}

function updateGrenades(game, dt) {
  for (let i = game.grenades.length - 1; i >= 0; i--) {
    const g = game.grenades[i];
    if (!g.settled) {
      g.vel.y -= 15.5 * dt;
      g.pos.addScaledVector(g.vel, dt);
      // bounce off the ground and the yard's boxes with a dull restitution
      const gy = game.world.groundHeightAt(g.pos.x, g.pos.z, g.pos.y + 1);
      if (g.pos.y < gy + 0.09) {
        g.pos.y = gy + 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.38;
        g.vel.x *= 0.72; g.vel.z *= 0.72;
        if (Math.abs(g.vel.y) < 0.8) { g.vel.y = 0; if (g.vel.lengthSq() < 0.4) g.settled = true; }
      }
      for (const c of game.world.boxes) {
        if (g.pos.x > c.minX - 0.09 && g.pos.x < c.maxX + 0.09 && g.pos.z > c.minZ - 0.09 && g.pos.z < c.maxZ + 0.09 && g.pos.y > c.minY && g.pos.y < c.maxY) {
          // push out along the smallest penetration axis, reflect that velocity part
          const dxl = g.pos.x - (c.minX - 0.09), dxr = (c.maxX + 0.09) - g.pos.x;
          const dzl = g.pos.z - (c.minZ - 0.09), dzr = (c.maxZ + 0.09) - g.pos.z;
          const m = Math.min(dxl, dxr, dzl, dzr);
          if (m === dxl) { g.pos.x = c.minX - 0.09; g.vel.x = -Math.abs(g.vel.x) * 0.4; }
          else if (m === dxr) { g.pos.x = c.maxX + 0.09; g.vel.x = Math.abs(g.vel.x) * 0.4; }
          else if (m === dzl) { g.pos.z = c.minZ - 0.09; g.vel.z = -Math.abs(g.vel.z) * 0.4; }
          else { g.pos.z = c.maxZ + 0.09; g.vel.z = Math.abs(g.vel.z) * 0.4; }
        }
      }
    }
    if (game.time >= g.fuseAt) {
      game.scene.remove(g.mesh);
      game.grenades.splice(i, 1);
      if (g.kind === 'frag') explodeFrag(game, g);
      else {
        game.effects.smoke(g.pos, 5.2, 13);
        game.sound.smokeHiss();
      }
    }
  }
}

function explodeFrag(game, g) {
  game.effects.explosion(g.pos);
  const distToPlayer = game.player ? g.pos.distanceTo(game.player.pos) : 99;
  game.sound.explosion(Math.min(1, distToPlayer / 46));
  if (game.player && distToPlayer < 9) game.hud.shake(0.25 * (1 - distToPlayer / 9));
  for (const actor of game.actors) {
    if (!actor.alive) continue;
    const d = actor.pos.distanceTo(g.pos);
    if (d > 6.5) continue;
    _tmp.copy(actor.pos).setY(actor.pos.y + 1);
    if (game.world.segmentBlocked(g.pos, _tmp)) continue;   // hard cover saves you
    let dmg = 92 * (1 - d / 6.5) + 8;
    if (actor.loadout.armor) dmg *= 0.6;
    dmg = Math.round(dmg);
    actor.health -= dmg;
    actor.lastAttacker = g.owner;
    if (actor.isPlayer) { game.hud.damageFlash(g.pos); game.sound.hurt(); }
    if (g.owner.isPlayer && actor.team !== g.owner.team) game.hud.hitmarker(false, actor.health <= 0);
    if (actor.health <= 0) {
      actor.health = 0;
      game.onKill(actor, g.owner, false);
    }
  }
}

// Per-step upkeep shared by all actors: reload timers and bloom decay, plus grenade sim.
export function updateWeapons(game, dt) {
  for (const actor of game.actors) {
    if (actor.reloading && game.time >= actor.reloadEnd) finishReload(game, actor);
    actor.bloom = Math.max(0, actor.bloom - dt * 5.5);
  }
  updateGrenades(game, dt);
}

// --------------------------------------------------------------------------- viewmodel guns

const gunMats = {
  body: new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.45, metalness: 0.6 }),
  accent: new THREE.MeshStandardMaterial({ color: 0xb46a28, roughness: 0.6, metalness: 0.3 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x1d1f23, roughness: 0.8, metalness: 0.1 }),
  sight: new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.4, metalness: 0.5 }),
};

// A low-poly gun built from boxes, per weapon key. The returned group faces -Z with a
// `muzzle` Object3D at the barrel tip; the player rig parents it to the camera.
export function buildGunModel(key) {
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, mat = gunMats.body) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  let muzzleZ = -0.6;
  if (key === 'sidearm') {
    add(0.07, 0.11, 0.24, 0, 0.02, -0.08);                 // slide
    add(0.06, 0.12, 0.09, 0, -0.08, 0.03, gunMats.grip);   // grip
    add(0.05, 0.05, 0.1, 0, -0.05, -0.06);                 // mag
    muzzleZ = -0.22;
  } else if (key === 'wasp') {
    add(0.08, 0.13, 0.52, 0, 0.02, -0.16);
    add(0.05, 0.2, 0.07, 0, -0.13, -0.1, gunMats.grip);    // long mag
    add(0.06, 0.1, 0.14, 0, -0.04, 0.2, gunMats.grip);     // stock
    add(0.03, 0.05, 0.05, 0, 0.11, -0.2, gunMats.sight);
    muzzleZ = -0.45;
  } else if (key === 'scatter') {
    add(0.09, 0.12, 0.62, 0, 0.02, -0.2);
    add(0.07, 0.07, 0.3, 0, -0.05, -0.28, gunMats.accent); // pump
    add(0.06, 0.11, 0.16, 0, -0.05, 0.18, gunMats.grip);
    muzzleZ = -0.53;
  } else if (key === 'longshot') {
    add(0.07, 0.12, 0.86, 0, 0.02, -0.3);
    add(0.04, 0.04, 0.34, 0, 0.03, -0.78, gunMats.sight);  // barrel
    add(0.06, 0.09, 0.2, 0, 0.12, -0.28, gunMats.sight);   // scope body
    add(0.05, 0.16, 0.07, 0, -0.11, -0.12, gunMats.grip);
    add(0.06, 0.1, 0.22, 0, -0.03, 0.26, gunMats.grip);
    muzzleZ = -0.97;
  } else { // carbine
    add(0.08, 0.14, 0.58, 0, 0.02, -0.18);
    add(0.05, 0.19, 0.08, 0, -0.13, -0.08, gunMats.grip);  // mag
    add(0.06, 0.11, 0.12, 0, -0.06, 0.02, gunMats.grip);   // grip
    add(0.07, 0.1, 0.2, 0, 0.0, 0.3, gunMats.accent);      // stock
    add(0.03, 0.06, 0.03, 0, 0.12, -0.3, gunMats.sight);   // front post
    add(0.07, 0.05, 0.12, 0, 0.11, 0.02, gunMats.sight);   // carry handle
    muzzleZ = -0.5;
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, muzzleZ);
  g.add(muzzle);
  g.userData.muzzle = muzzle;
  return g;
}
