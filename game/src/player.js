// The human fighter: WASD + mouse-look movement through the same physics as the bots, a
// camera rig with recoil, landing dip and walk bob, weapon viewmodels that swap/reload/kick,
// and two invisible hit volumes so bot fire can strike the player exactly where it aims.

import * as THREE from 'three';
import { ACTOR } from './config.js';
import { newLoadout, currentWeapon, buildGunModel } from './weapons.js';

const HITMAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });

export class Player {
  constructor(game) {
    this.game = game;
    this.isPlayer = true;
    this.team = 0; // Wardens
    this.name = 'You';
    this.pos = new THREE.Vector3(0, 0, -29);
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
    this.money = 800;
    this.loadout = newLoadout();
    this.bloom = 0;
    this.reloading = false;
    this.reloadEnd = 0;
    this.nextShotAt = 0;
    this.lastShotAt = -99;
    this.lastHitAt = -99;
    this.lastAttacker = null;
    this.recoilKick = 0;
    this.aimDir = null;          // the player aims through the camera instead
    this.frozen = true;          // buy phase / menus hold the player still
    this.kills = 0;
    this.deaths = 0;
    // camera feel state
    this.bobPhase = 0;
    this.landDip = 0;
    this.wasGrounded = true;
    this.stepAcc = 0;
    this.fov = 74;
    this.shownWeaponKey = null;

    // viewmodel rig: camera -> bob group -> gun group
    this.camera = game.camera;
    this.rig = new THREE.Group();
    this.camera.add(this.rig);
    this.gunGroups = {};
    for (const key of Object.keys(game.weaponDefs)) {
      const model = buildGunModel(key);
      model.position.set(0.26, -0.24, -0.45);
      model.visible = false;
      this.rig.add(model);
      this.gunGroups[key] = model;
    }
    this.gunTip = null;

    // hit volumes bot raycasts test against (invisible, but real geometry)
    this.bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.68, 1.2, 0.42), HITMAT);
    this.bodyMesh.userData.actor = this;
    this.bodyMesh.userData.zone = 'body';
    this.headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), HITMAT);
    this.headMesh.userData.actor = this;
    this.headMesh.userData.zone = 'head';
    this.hitMeshes = [this.bodyMesh, this.headMesh];
    game.scene.add(this.bodyMesh, this.headMesh);
  }

  reset(spawn, yaw) {
    this.pos.copy(spawn);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.game.input.face(yaw, 0);
    this.alive = true;
    this.health = ACTOR.health;
    this.bloom = 0;
    this.reloading = false;
    this.nextShotAt = 0;
    this.lastHitAt = -99;
    this.recoilKick = 0;
    this.shownWeaponKey = null;
  }

  // One simulation step. actions are the input queue drained by the round manager.
  update(dt, actions) {
    const game = this.game;
    const input = game.input;
    this.yaw = input.yaw;
    this.pitch = input.pitch + this.recoilKick * 0.5;
    this.aiming = input.aiming && this.alive && !this.frozen;

    if (!this.alive) {
      this.updateCamera(dt);
      return;
    }

    let wishX = 0, wishZ = 0, speed = ACTOR.walkSpeed, jump = false;
    if (!this.frozen) {
      const axes = input.moveAxes();
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward (-Z at yaw 0) and right (+X at yaw 0) rotated by yaw
      wishX = (-sin) * axes.z + cos * axes.x;
      wishZ = (-cos) * axes.z + (-sin) * axes.x;
      if (input.walk) speed = 2.15;
      if (input.crouch) speed = ACTOR.crouchSpeed;
      if (this.aiming) speed *= 0.55;
      jump = actions.includes('jump');
      if (jump) game.sound.jump();
    }
    const wasGrounded = this.onGround;
    game.world.driveActor(this, dt, wishX, wishZ, { speed, jump, crouch: !this.frozen && input.crouch });
    if (!wasGrounded && this.onGround) {
      this.landDip = 0.09;
      game.sound.land();
    }
    // footsteps: distance-based, silent while walking quietly
    const speed2D = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && speed2D > 0.6) {
      this.stepAcc += speed2D * dt;
      const stride = input.walk ? 3.4 : 2.3;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        game.sound.step(!input.walk);
        if (!input.walk) game.noise(this.pos, this.team, 7.5);
      }
      this.bobPhase += dt * speed2D * 1.9;
    }
    this.syncWeaponVisual();
    this.updateCamera(dt);
    this.syncHitMeshes();
  }

  syncWeaponVisual() {
    const ws = currentWeapon(this);
    if (ws.key !== this.shownWeaponKey) {
      for (const key of Object.keys(this.gunGroups)) this.gunGroups[key].visible = key === ws.key;
      this.shownWeaponKey = ws.key;
      this.gunTip = this.gunGroups[ws.key].userData.muzzle;
    }
    const gun = this.gunGroups[ws.key];
    // recoil recovery + reload dip + walk bob, all on the rig so the camera stays clean
    this.recoilKick *= Math.pow(0.002, dt); // fast exponential settle after each shot
    const speed2D = Math.hypot(this.vel.x, this.vel.z);
    const bobAmt = this.onGround ? Math.min(1, speed2D / ACTOR.walkSpeed) * 0.016 : 0;
    const reloadT = this.reloading ? Math.sin(Math.min(1, (this.game.time - (this.reloadEnd - ws.def.reloadSeconds)) / ws.def.reloadSeconds) * Math.PI) : 0;
    gun.position.set(
      0.26 + Math.sin(this.bobPhase * 0.5) * bobAmt,
      -0.24 + Math.abs(Math.sin(this.bobPhase)) * bobAmt - reloadT * 0.13,
      -0.45 + this.recoilKick * 1.4,
    );
    gun.rotation.x = this.recoilKick * 2.2 - reloadT * 0.7;
    // ADS: pull the gun to centre and narrow the field of view
    const adsT = this.aiming ? 1 : 0;
    gun.position.x += (0 - gun.position.x) * adsT * 0.92;
    gun.position.y += (-0.185 - gun.position.y) * adsT * 0.92;
    const targetFov = 74 / (this.aiming ? ws.def.zoom : 1);
    this.fov += (targetFov - this.fov) * 0.22;
    if (Math.abs(this.fov - this.camera.fov) > 0.05) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  updateCamera(dt) {
    const cam = this.camera;
    this.landDip = Math.max(0, this.landDip - dt * 0.5);
    const shake = this.game.hud.shakeOffset;
    if (this.alive) {
      cam.position.set(
        this.pos.x + (shake ? shake.x : 0),
        this.pos.y + this.eyeHeight - this.landDip + (shake ? shake.y : 0),
        this.pos.z,
      );
      cam.rotation.set(0, 0, 0);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw;
      cam.rotation.x = this.pitch;
      cam.rotation.z = shake ? shake.z : 0;
    } else {
      // death cam: sink to the floor and tilt, then the round manager takes over spectating
      cam.position.set(this.pos.x, this.pos.y + 0.35, this.pos.z);
      cam.rotation.order = 'YXZ';
      cam.rotation.y = this.yaw;
      cam.rotation.x = -0.12;
      cam.rotation.z = 0.6;
    }
  }

  syncHitMeshes() {
    const crouch = this.crouching;
    this.bodyMesh.position.set(this.pos.x, this.pos.y + (crouch ? 0.62 : 0.92), this.pos.z);
    this.headMesh.position.set(this.pos.x, this.pos.y + (crouch ? 1.18 : 1.66), this.pos.z);
    const show = this.alive;
    this.bodyMesh.visible = show;
    this.headMesh.visible = show;
  }

  die() {
    this.alive = false;
    this.deaths++;
  }
}
