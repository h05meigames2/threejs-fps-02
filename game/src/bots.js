// Bot fighters: boxy soldiers with a state-machine brain. A bot perceives through a view
// cone plus line of sight (and hears gunfire), remembers the last place it saw an enemy, and
// plays its role: Wardens walk to a hold spot and watch a lane; Breakers run a route to a
// site, the carrier plants, the rest set up around the site. In a fight a bot bursts, strafes
// at close range, and pushes or holds by distance — the same fire() rules as the player.

import * as THREE from 'three';
import { TEAM, TEAM_COLOR, ACTOR, BOT } from './config.js';
import { newLoadout, currentWeapon, fire, eyePos } from './weapons.js';

const _eye = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

const SKIN = new THREE.MeshStandardMaterial({ color: 0xc9a186, roughness: 0.8 });
const PANTS = new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.9 });
const GUNMAT = new THREE.MeshStandardMaterial({ color: 0x22252a, roughness: 0.5, metalness: 0.5 });

export class Bot {
  constructor(game, team, name, index) {
    this.game = game;
    this.isPlayer = false;
    this.team = team;
    this.name = name;
    this.index = index;
    // shared actor shape (see weapons.js / world.driveActor)
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.height = ACTOR.standHeight;
    this.eyeHeight = ACTOR.eyeStand;
    this.yaw = 0;
    this.pitch = 0;
    this.onGround = true;
    this.crouching = false;
    this.aiming = false;
    this.alive = true;
    this.health = ACTOR.health;
    this.loadout = newLoadout();
    this.bloom = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShotAt = 0;
    this.lastShotAt = -99;
    this.lastHitAt = -99;
    this.lastAttacker = null;
    this.recoilKick = 0;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    // AI state
    this.state = 'idle';
    this.route = [];
    this.routeIdx = 0;
    this.goalPos = null;         // exact world position to end movement at (hold spots)
    this.watchDir = new THREE.Vector3(0, 0, 1);
    this.visibleTarget = null;
    this.lastSeenPos = new THREE.Vector3();
    this.lastSeenAt = -99;
    this.reactionAt = 0;
    this.burstLeft = 0;
    this.burstResumeAt = 0;
    this.thinkAt = Math.random() * 0.15;
    this.isCarrier = false;
    this.planting = false;
    this.strafeDir = 1;
    this.strafeFlipAt = 0;
    this.deathAt = 0;
    this.buildMesh();
  }

  buildMesh() {
    const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLOR[this.team], roughness: 0.75 });
    const darkMat = new THREE.MeshStandardMaterial({ color: this.team === TEAM.WARDEN ? 0x1d5a52 : 0x6e3018, roughness: 0.8 });
    const g = new THREE.Group();
    const mk = (geo, mat, x, y, z, zone) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      if (zone) {
        m.userData.actor = this;
        m.userData.zone = zone;
        this.hitMeshes.push(m);
      }
      g.add(m);
      return m;
    };
    this.hitMeshes = [];
    // legs (two boxes count as one legs hit volume each), torso, head + helmet, gun
    mk(new THREE.BoxGeometry(0.19, 0.82, 0.22), PANTS, -0.12, 0.41, 0, 'legs');
    mk(new THREE.BoxGeometry(0.19, 0.82, 0.22), PANTS, 0.12, 0.41, 0, 'legs');
    mk(new THREE.BoxGeometry(0.58, 0.72, 0.32), teamMat, 0, 1.17, 0, 'body');
    mk(new THREE.BoxGeometry(0.62, 0.3, 0.36), darkMat, 0, 1.32, 0, 'body');      // vest/shoulders
    mk(new THREE.BoxGeometry(0.3, 0.32, 0.3), SKIN, 0, 1.7, 0, 'head');
    mk(new THREE.BoxGeometry(0.34, 0.13, 0.34), darkMat, 0, 1.9, 0, 'head');      // helmet
    const gun = mk(new THREE.BoxGeometry(0.07, 0.13, 0.62), GUNMAT, 0.24, 1.28, -0.3, null);
    mk(new THREE.BoxGeometry(0.16, 0.3, 0.1), darkMat, 0, 1.28, 0.19, 'body');    // pack
    this.gunTip = new THREE.Object3D();
    this.gunTip.position.set(0.24, 1.3, -0.66);
    g.add(this.gunTip);
    this.group = g;
    this.game.scene.add(g);
  }

  reset(spawn, yaw) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.alive = true;
    this.health = ACTOR.health;
    this.loadout = newLoadout();
    this.bloom = 0;
    this.reloading = false;
    this.nextShotAt = 0;
    this.lastHitAt = -99;
    this.lastAttacker = null;
    this.visibleTarget = null;
    this.lastSeenAt = -99;
    this.isCarrier = false;
    this.planting = false;
    this.state = 'idle';
    this.route = [];
    this.routeIdx = 0;
    this.group.visible = true;
    this.group.rotation.set(0, yaw, 0);
    this.group.position.copy(spawn);
  }

  eye(out) { return eyePos(this, out); }

  // ------------------------------------------------------------- perception

  perceive() {
    const game = this.game;
    const now = game.time;
    this.eye(_eye);
    let best = null, bestD = Infinity;
    for (const other of game.actors) {
      if (other === this || !other.alive || other.team === this.team) continue;
      const d = this.pos.distanceTo(other.pos);
      if (d > BOT.viewDistance) continue;
      _chest.copy(other.pos); _chest.y += 1.25;
      _dir.copy(_chest).sub(_eye);
      const dist = _dir.length();
      _dir.normalize();
      // facing check (waived at point-blank, where you'd feel them)
      const fwd = _aim.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      if (dist > 4 && fwd.dot(_dir) < BOT.viewCos) continue;
      if (game.world.segmentBlocked(_eye, _chest)) continue;
      if (game.effects.smokeBlocks(_eye, _chest)) continue;
      if (d < bestD) { bestD = d; best = other; }
    }
    // hearing: a recent shot near me reveals its shooter's rough position
    if (!best) {
      for (const ev of game.noiseEvents) {
        if (ev.team === this.team || now - ev.at > 0.6) continue;
        if (this.pos.distanceTo(ev.pos) < (ev.radius ?? BOT.hearDistance)) {
          this.lastSeenPos.copy(ev.pos);
          this.lastSeenAt = now;
        }
      }
    }
    if (best) {
      if (this.visibleTarget !== best) this.reactionAt = now + BOT.reaction * (0.7 + Math.random() * 0.6);
      this.visibleTarget = best;
      this.lastSeenPos.copy(best.pos);
      this.lastSeenAt = now;
    } else if (this.visibleTarget && now - this.lastSeenAt > 0.4) {
      this.visibleTarget = null;
    }
    // being shot teaches you where the shooter stands
    if (this.lastAttacker && now - this.lastHitAt < 0.3 && this.lastAttacker.alive) {
      this.lastSeenPos.copy(this.lastAttacker.pos);
      this.lastSeenAt = now;
    }
  }

  // ------------------------------------------------------------- decisions

  setRouteTo(nodeIdx, goalPos = null) {
    this.route = this.game.nav.routeTo(this.pos, nodeIdx);
    this.routeIdx = 0;
    this.goalPos = goalPos;
  }

  // Role orders, issued by the round manager at round start and on bomb events.
  orderHold(spot) {
    this.holdSpot = spot;
    this.watchDir.copy(spot.watch).sub(spot.pos).setY(0).normalize();
    this.setRouteTo(spot.node, spot.pos);
    this.state = 'toHold';
  }

  orderPush(siteNode, guardOffset) {
    this.siteNode = siteNode;
    this.guardOffset = guardOffset;
    this.setRouteTo(siteNode);
    this.state = 'push';
  }

  think() {
    const game = this.game;
    const now = game.time;
    this.perceive();
    const bomb = game.bomb;

    if (this.visibleTarget) {
      this.state = 'combat';
      return;
    }
    if (this.state === 'combat') {
      // target lost: hunt the last seen position briefly, then fall back to orders
      if (now - this.lastSeenAt < BOT.forgetSeconds) {
        this.state = 'hunt';
        this.huntPos = this.lastSeenPos.clone();
      } else this.resumeOrders();
      return;
    }
    if (this.state === 'hunt' && now - this.lastSeenAt >= BOT.forgetSeconds) this.resumeOrders();

    // A Warden holding a quiet site while a firefight rages elsewhere rotates toward it:
    // distant enemy gunfire (heard, never seen) is worth investigating, close noise is not —
    // that fight will come through the door by itself.
    if (this.team === TEAM.WARDEN && (this.state === 'hold' || this.state === 'toHold')
      && now - this.lastSeenAt < 1.2 && !this.visibleTarget) {
      const d = this.pos.distanceTo(this.lastSeenPos);
      if (d > 15 && d < 34) {
        this.state = 'hunt';
        this.huntPos = this.lastSeenPos.clone();
      }
    }

    // bomb-driven reactions override routine orders
    if (bomb.state === 'planted') {
      if (this.team === TEAM.WARDEN) {
        if (this.state !== 'toBomb') { this.setRouteTo(bomb.site === game.world.sites[0] ? 3 : 4); this.state = 'toBomb'; }
      } else if (this.state !== 'hold' && this.state !== 'toHold') {
        this.state = 'holdNearBomb';
        this.setRouteTo(bomb.site === game.world.sites[0] ? 3 : 4, this.pos.clone());
      }
      return;
    }
    if (bomb.state === 'dropped' && this.team === TEAM.BREAKER && !game.carrierAlive()) {
      // the nearest free Breaker goes back for the bomb
      let nearest = null, nd = Infinity;
      for (const a of game.actors) {
        if (a.team !== TEAM.BREAKER || !a.alive || a.isPlayer) continue;
        const d = a.pos.distanceTo(bomb.pos);
        if (d < nd) { nd = d; nearest = a; }
      }
      if (nearest === this && this.state !== 'fetch') {
        this.setRouteTo(game.nav.nearestNode(bomb.pos), bomb.pos.clone());
        this.state = 'fetch';
      }
    }
  }

  resumeOrders() {
    if (this.team === TEAM.WARDEN && this.holdSpot) {
      this.setRouteTo(this.holdSpot.node, this.holdSpot.pos);
      this.state = 'toHold';
    } else if (this.team === TEAM.BREAKER && this.siteNode !== undefined) {
      this.setRouteTo(this.siteNode, this.guardOffset ?? null);
      this.state = 'push';
    } else {
      this.state = 'idle';
    }
  }

  // ------------------------------------------------------------- per-step update

  update(dt) {
    const game = this.game;
    if (!this.alive) {
      // corpse: fall over once, then rest
      const t = Math.min(1, (game.time - this.deathAt) / 0.35);
      this.group.rotation.x = -Math.PI / 2 * t;
      this.group.position.y = this.pos.y + 0.12 * t;
      return;
    }
    const now = game.time;
    if (now >= this.thinkAt) {
      this.thinkAt = now + 0.12;
      this.think();
    }

    let wishX = 0, wishZ = 0, speed = 4.25, crouch = false, faceYaw = null;
    this.planting = false;

    if (this.state === 'combat' && (this.visibleTarget || now - this.lastSeenAt < 0.5)) {
      const target = this.visibleTarget;
      const anchor = target ? target.pos : this.lastSeenPos;
      faceYaw = Math.atan2(-(anchor.x - this.pos.x), -(anchor.z - this.pos.z));
      const d = this.pos.distanceTo(anchor);
      if (target) {
        this.combatFire(target, d);
        if (d > 24) { wishX = anchor.x - this.pos.x; wishZ = anchor.z - this.pos.z; speed = 4.3; }
        else if (d < 9) {
          // strafe sideways across the target's view, flipping now and then
          if (now > this.strafeFlipAt) { this.strafeFlipAt = now + 0.7 + Math.random() * 0.9; this.strafeDir *= -1; }
          const px = -(anchor.z - this.pos.z), pz = (anchor.x - this.pos.x);
          wishX = px * this.strafeDir; wishZ = pz * this.strafeDir;
          speed = 3.4;
          crouch = Math.random() < 0.25;
        } else {
          crouch = this.index % 2 === 0;   // half the bots fight crouched at mid range
          speed = 0;
        }
      } else {
        wishX = anchor.x - this.pos.x; wishZ = anchor.z - this.pos.z;
      }
    } else if (this.state === 'hunt') {
      const arrived = this.steerTo(this.huntPos, dt);
      faceYaw = this.moveYaw;
      if (arrived) this.resumeOrders();
    } else if (this.state === 'plant') {
      this.planting = true;
      faceYaw = this.yaw; // stand still and work the device
    } else if (this.state === 'hold') {
      faceYaw = Math.atan2(-this.watchDir.x, -this.watchDir.z);
      crouch = this.index % 3 === 0;
    } else {
      // route-following states: toHold, push, toBomb, fetch, holdNearBomb
      const dest = this.routeDestination();
      if (dest) {
        const arrived = this.steerTo(dest, dt);
        faceYaw = this.moveYaw;
        if (arrived) this.onArrive();
      } else {
        // route exhausted with no goal position (the carrier at its site, a Warden at
        // the bomb): arrival is implicit — take up the state's end behaviour
        this.onArrive();
      }
    }

    // route steering writes its wish into this.moveWish; merge both paths here
    if (this.moveWish) { wishX = this.moveWish.x; wishZ = this.moveWish.z; this.moveWish = null; }
    // stuck recovery: pushing against geometry with nothing to show for it — hop and
    // sidestep briefly rather than grinding on the same wall forever
    const wantMove = Math.hypot(wishX, wishZ) > 0.1;
    const moved = Math.hypot(this.pos.x - (this.lastX ?? this.pos.x), this.pos.z - (this.lastZ ?? this.pos.z));
    if (wantMove && moved < 0.02) {
      this.stuckTime = (this.stuckTime ?? 0) + dt;
      if (this.stuckTime > 1.1) {
        this.stuckTime = 0;
        this.unstuckUntil = now + 0.55;
        this.strafeDir *= -1;
      }
    } else this.stuckTime = 0;
    this.lastX = this.pos.x; this.lastZ = this.pos.z;
    if (this.unstuckUntil && now < this.unstuckUntil) {
      const px = -wishZ * this.strafeDir, pz = wishX * this.strafeDir;
      wishX = wishX * 0.4 + px; wishZ = wishZ * 0.4 + pz;
      if (this.onGround) { this.vel.y = 5.4; this.onGround = false; }
    }
    if (faceYaw !== null && faceYaw !== undefined) this.turnToward(faceYaw, dt);
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.01) {
      this.game.world.driveActor(this, dt, wishX / wishLen, wishZ / wishLen, { speed, crouch });
    } else {
      this.game.world.driveActor(this, dt, 0, 0, { speed, crouch });
    }
    this.syncMesh();
  }

  routeDestination() {
    if (this.routeIdx < this.route.length) return this.route[this.routeIdx];
    return this.goalPos;
  }

  // Steer along the route; returns true when the final destination is reached.
  steerTo(dest, dt) {
    const dx = dest.x - this.pos.x, dz = dest.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const isNode = this.routeIdx < this.route.length;
    const arriveR = isNode ? 0.85 : 0.55;
    if (dist < arriveR) {
      if (isNode) { this.routeIdx++; return false; }
      return true;
    }
    this.moveWish = { x: dx / dist, z: dz / dist };
    this.moveYaw = Math.atan2(-dx, -dz);
    return false;
  }

  onArrive() {
    const game = this.game;
    switch (this.state) {
      case 'toHold':
        this.state = 'hold';
        break;
      case 'push': {
        if (this.isCarrier) {
          this.state = 'plant';
        } else {
          // guards settle where they stand and watch back toward the defence
          this.watchDir.copy(this.pos).sub(game.world.spawns.warden[0]).setY(0).normalize().negate();
          this.state = 'hold';
          this.holdSpot = null;
        }
        break;
      }
      case 'fetch': {
        // picked the bomb back up (round manager notices the proximity too)
        this.isCarrier = true;
        game.bomb.state = 'carried';
        game.bomb.carrier = this;
        this.setRouteTo(this.siteNode ?? 3);
        this.state = 'push';
        break;
      }
      case 'toBomb':
        this.state = 'hold';   // at the site: watch for the defuser fight
        this.watchDir.set(0, 0, 1);
        break;
      case 'holdNearBomb':
        this.state = 'hold';
        break;
      default:
        this.state = 'idle';
    }
  }

  combatFire(target, dist) {
    const game = this.game;
    const now = game.time;
    const ws = currentWeapon(this);
    if (ws.mag === 0 && ws.reserve === 0 && this.loadout.current === 'primary') {
      this.loadout.current = 'sidearm';   // dry primary: fall back like a player would
      return;
    }
    if (this.reloading) return;
    if (now < this.reactionAt) return;
    if (now < this.burstResumeAt) return;
    if (this.burstLeft <= 0) {
      this.burstLeft = ws.def.auto ? 3 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
    }
    // aim at the chest, with error that grows with range and target speed
    this.eye(_eye);
    _chest.copy(target.pos);
    _chest.y += target.crouching ? 1.0 : 1.3;
    const targetSpeed = Math.hypot(target.vel.x, target.vel.z);
    const err = BOT.aimError * dist * (1 + targetSpeed * 0.22);
    _chest.x += (Math.random() * 2 - 1) * err;
    _chest.y += (Math.random() * 2 - 1) * err * 0.6;
    _chest.z += (Math.random() * 2 - 1) * err;
    this.aimDir.copy(_chest).sub(_eye).normalize();
    this.yaw = Math.atan2(-this.aimDir.x, -this.aimDir.z);
    if (fire(game, this)) {
      this.burstLeft--;
      if (this.burstLeft <= 0) this.burstResumeAt = now + BOT.burstPause * (0.7 + Math.random() * 0.7);
    }
  }

  turnToward(targetYaw, dt) {
    let diff = targetYaw - this.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = 7.5 * dt;
    this.yaw += Math.max(-maxTurn, Math.min(maxTurn, diff));
  }

  syncMesh() {
    this.group.position.copy(this.pos);
    this.group.rotation.set(0, this.yaw, 0);
    // a slight crouch dip sells the stance; legs stay planted
    this.group.scale.y = this.crouching ? 0.86 : 1;
  }

  die(now) {
    this.alive = false;
    this.deathAt = now;
    this.planting = false;
  }
}
