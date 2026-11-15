// Ember Yard: an original scrapyard map built from boxes — a central warehouse, a catwalk
// bridge over the mid road, a foundry yard (site A) west and a container depot (site B) east.
// The same box list drives the meshes, the AABB colliders and the bullet/LOS occluders, so
// what you see is exactly what physics and raycasts hit. Textures are painted on canvases at
// boot; no image files exist anywhere in the game.

import * as THREE from 'three';
import { ACTOR } from './config.js';

const STEP_UP = 0.55;

// --------------------------------------------------------------------------- textures

function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function speckle(ctx, s, n, alpha, dark = true) {
  for (let i = 0; i < n; i++) {
    const g = dark ? 0 : 200 + Math.random() * 55;
    ctx.fillStyle = `rgba(${g},${g},${g},${alpha * Math.random()})`;
    ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

const asphalt = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#43444a'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 2600, 0.16); speckle(ctx, s, 900, 0.1, false);
  ctx.strokeStyle = 'rgba(20,20,22,0.35)'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) { // cracks
    ctx.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}, 10);

const concrete = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#8d8d90'; ctx.fillRect(0, 0, s, s);
  speckle(ctx, s, 1500, 0.12);
  ctx.strokeStyle = 'rgba(40,40,44,0.5)'; ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, s, s);
  ctx.beginPath(); ctx.moveTo(0, s / 2); ctx.lineTo(s, s / 2); ctx.stroke();
}, 2);

const crateWood = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#9a6b3f'; ctx.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 36) {
    ctx.fillStyle = `rgba(60,35,15,${0.12 + Math.random() * 0.1})`;
    ctx.fillRect(0, y, s, 3);
    for (let i = 0; i < 26; i++) { // grain
      ctx.fillStyle = `rgba(70,45,20,${Math.random() * 0.16})`;
      ctx.fillRect(Math.random() * s, y + 4 + Math.random() * 28, 12 + Math.random() * 42, 1.5);
    }
  }
  ctx.strokeStyle = '#6e4a26'; ctx.lineWidth = 18; ctx.strokeRect(0, 0, s, s);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(s, s); ctx.moveTo(s, 0); ctx.lineTo(0, s);
  ctx.lineWidth = 10; ctx.stroke();
});

const containerSide = () => canvasTex(256, (ctx, s) => {
  ctx.fillStyle = '#c9c9c9'; ctx.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 24) { // corrugation: light/shadow stripe pairs
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, 0, 7, s);
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(x + 14, 0, 8, s);
  }
  for (let i = 0; i < 26; i++) { // rust streaks from the top edge
    ctx.fillStyle = `rgba(122,66,30,${0.08 + Math.random() * 0.2})`;
    const x = Math.random() * s;
    ctx.fillRect(x, 0, 2 + Math.random() * 5, 20 + Math.random() * 90);
  }
  speckle(ctx, s, 500, 0.1);
}, 1);

function siteDecal(letter, colorCss) {
  const tex = canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = colorCss; ctx.lineWidth = 13;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 12, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = colorCss;
    ctx.font = `700 ${s * 0.52}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, s / 2, s / 2 + 6);
    // wear: knock out speckles so the paint looks driven over
    ctx.globalCompositeOperation = 'destination-out';
    speckle(ctx, s, 700, 0.5);
    ctx.globalCompositeOperation = 'source-over';
  });
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// --------------------------------------------------------------------------- the world

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];   // {minX..maxZ, kind:'box'} plus {kind:'ramp', axis, dir, lowTop, highTop}
    this.occluders = [];   // meshes bullets and sight lines raycast against
    this.boxes = [];       // plain {minX,minY,minZ,maxX,maxY,maxZ} for fast LOS segment tests
    this.time = 0;
    this.pulseMats = [];
    this.sites = [
      { id: 'A', center: new THREE.Vector3(-23, 0, -17), radius: 6.5 },
      { id: 'B', center: new THREE.Vector3(23, 0, -17), radius: 6.5 },
    ];
    this.spawns = {
      warden: [new THREE.Vector3(0, 0, -29), new THREE.Vector3(-3, 0, -28), new THREE.Vector3(3, 0, -28), new THREE.Vector3(-6, 0, -29.5), new THREE.Vector3(6, 0, -29.5)],
      breaker: [new THREE.Vector3(0, 0, 30), new THREE.Vector3(-3, 0, 29), new THREE.Vector3(3, 0, 29), new THREE.Vector3(-6, 0, 31), new THREE.Vector3(6, 0, 31)],
    };
    this.buildLights();
    this.buildGroundAndSky();
    this.buildMap();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xbdd3ea, 0x54483a, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.0);
    sun.position.set(34, 46, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -46; sun.shadow.camera.right = 46;
    sun.shadow.camera.top = 46; sun.shadow.camera.bottom = -46;
    sun.shadow.camera.far = 130;
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);
    // Yard lamps: warm pools of light at the two sites and mid (no shadows, cheap).
    for (const [x, z] of [[-23, -17], [23, -17], [0, 7]]) {
      const lamp = new THREE.PointLight(0xffa64d, 60, 26, 1.8);
      lamp.position.set(x, 5.4, z);
      this.scene.add(lamp);
    }
  }

  buildGroundAndSky() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(76, 76),
      new THREE.MeshStandardMaterial({ map: asphalt(), roughness: 0.96, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.name = 'ground';
    this.scene.add(ground);
    this.occluders.push(ground);

    // Gradient sky dome painted with vertex colours: dusk blue up top, ember at the horizon.
    const skyGeo = new THREE.SphereGeometry(220, 24, 12);
    const pos = skyGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0x39597e), horizon = new THREE.Color(0xe8a05c), low = new THREE.Color(0x584a3c);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 220;
      if (y >= 0) tmp.copy(horizon).lerp(top, Math.pow(Math.min(1, y * 1.6), 0.7));
      else tmp.copy(horizon).lerp(low, Math.min(1, -y * 3));
      colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
    }
    skyGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.scene.add(sky);
    this.scene.fog = new THREE.Fog(0xc7a27a, 55, 165);
  }

  // One box that is at once a mesh, a collider and an occluder.
  box(x, z, w, d, h, mat, { y = 0, ry = 0, collide = true, name = '' } = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (name) mesh.name = name;
    this.scene.add(mesh);
    if (collide) {
      // Axis-aligned colliders only: rotated decor must opt out or stay axis-aligned.
      const c = { minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2, kind: 'box' };
      this.colliders.push(c);
      this.boxes.push(c);
      this.occluders.push(mesh);
    }
    return mesh;
  }

  // A walkable slope along x: the walking surface runs from h0 at the -x edge to h1 at the
  // +x edge. Collision treats it as support only (see groundHeightAt); visually it is a
  // rotated slab closed at its high end by a face plate so it never floats.
  ramp(cx, cz, width, run, h0, h1) {
    const len = Math.hypot(run, h1 - h0);
    const angle = Math.atan2(h1 - h0, run);
    const mat = new THREE.MeshStandardMaterial({ color: 0x707880, roughness: 0.8, metalness: 0.35 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(len, 0.3, width), mat);
    slab.position.set(cx, (h0 + h1) / 2 - 0.15, cz);
    slab.rotation.z = angle;
    slab.castShadow = slab.receiveShadow = true;
    this.scene.add(slab);
    const highTop = Math.max(h0, h1);
    const highX = h1 >= h0 ? cx + run / 2 - 0.2 : cx - run / 2 + 0.2;
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.4, highTop, width),
      new THREE.MeshStandardMaterial({ color: 0x565d63, roughness: 0.9 }));
    face.position.set(highX, highTop / 2, cz);
    face.castShadow = face.receiveShadow = true;
    this.scene.add(face);
    this.colliders.push({ kind: 'ramp', minX: cx - run / 2, maxX: cx + run / 2, minZ: cz - width / 2, maxZ: cz + width / 2, minY: 0, maxY: highTop, h0, h1 });
    this.occluders.push(slab);
    return slab;
  }

  buildMap() {
    const M = {
      concrete: new THREE.MeshStandardMaterial({ map: concrete(), roughness: 0.9 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x49505a, roughness: 0.6, metalness: 0.5 }),
      rust: new THREE.MeshStandardMaterial({ color: 0x9c4a26, roughness: 0.85, metalness: 0.2 }),
      crate: new THREE.MeshStandardMaterial({ map: crateWood(), roughness: 0.9 }),
      contTeal: new THREE.MeshStandardMaterial({ map: containerSide(), color: 0x3f8f86, roughness: 0.7, metalness: 0.3 }),
      contRust: new THREE.MeshStandardMaterial({ map: containerSide(), color: 0xb45a30, roughness: 0.7, metalness: 0.3 }),
      contSand: new THREE.MeshStandardMaterial({ map: containerSide(), color: 0xc2a15a, roughness: 0.7, metalness: 0.3 }),
      wallBlue: new THREE.MeshStandardMaterial({ map: concrete(), color: 0x7e93a8, roughness: 0.85 }),
      ember: new THREE.MeshStandardMaterial({ color: 0x3c3f45, roughness: 0.7, metalness: 0.4 }),
    };
    const crate = (x, z, s = 1.2, y = 0) => this.box(x, z, s, s, s, M.crate, { y });
    const container = (x, z, mat, ry = 0, y = 0) => {
      // Containers are 6 long; rotated ones are decor-only against walls (collide axis-aligned only when ry=0)
      if (ry === 0) return this.box(x, z, 6, 2.5, 2.6, mat, { y });
      const m = this.box(x, z, 6, 2.5, 2.6, mat, { y, ry, collide: false });
      this.occluders.push(m); // bullets still respect the rotated mesh itself
      // approximate a rotated container with an axis-aligned core so bodies respect it
      const c1 = { minX: x - 1.6, maxX: x + 1.6, minY: y, maxY: y + 2.6, minZ: z - 1.6, maxZ: z + 1.6, kind: 'box' };
      this.colliders.push(c1); this.boxes.push(c1);
      return m;
    };

    // Perimeter walls.
    this.box(0, -36.5, 74, 1, 6, M.concrete);
    this.box(0, 36.5, 74, 1, 6, M.concrete);
    this.box(-36.5, 0, 1, 74, 6, M.concrete);
    this.box(36.5, 0, 1, 74, 6, M.concrete);

    // --- Warehouse (mid): rectangle x[-8,8], z[-12,4], walls 4.5 high with door gaps.
    const W = M.wallBlue, wh = 4.5, wt = 0.6;
    this.box(-5, -12, 6, wt, wh, W); this.box(5, -12, 6, wt, wh, W);          // north wall, gap x[-2,2]
    this.box(-4.75, 4, 6.5, wt, wh, W); this.box(4.75, 4, 6.5, wt, wh, W);   // south wall, gap x[-1.5,1.5]
    this.box(-8, -9, wt, 6, wh, W); this.box(-8, 1, wt, 6, wh, W);           // west wall, gap z[-6,-2]... segments z[-12,-6],[-2,4]
    this.box(8, -7, wt, 6, wh, W); this.box(8, 2, wt, 4, wh, W);             // east wall, gap z[-4,0]
    // Interior: a half divider (west side only, so the east route stays open) and crate
    // stacks make the inside a fight, not a corridor.
    this.box(-2.75, -7, 4.5, 0.5, 1.15, M.darkMetal);
    crate(-4, -1.5); crate(-4, -1.5, 1.2, 1.2); crate(4.5, -9); crate(3.2, -9);
    crate(-5, -10.5); crate(5.5, 1.5);

    // --- Catwalk bridge over the mid road (z 6..9), deck top y=3.0, ramps at both ends.
    const deckMat = M.darkMetal;
    this.box(0, 7.5, 26, 3, 0.35, deckMat, { y: 2.65 });                      // deck slab, top at 3.0
    for (const px of [-12, -6, 0, 6, 12]) this.box(px, 7.5, 0.5, 0.5, 2.65, M.rust); // pillars
    this.box(0, 6.1, 26, 0.18, 0.9, M.rust, { y: 3.0, collide: false });      // rails (decor)
    this.box(0, 8.9, 26, 0.18, 0.9, M.rust, { y: 3.0, collide: false });
    this.ramp(-16, 7.5, 3, 6, 0, 3.0);                                       // west ramp: ground at x=-19 up to deck at x=-13
    this.ramp(16, 7.5, 3, 6, 3.0, 0);                                        // east ramp: deck at x=13 down to ground at x=19

    // --- Site A: the Foundry (west). Furnace block, chimney, partial walls, cover.
    this.box(-28, -22, 5, 4, 3.4, M.ember, { name: 'furnace' });
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 6.5, 10), M.rust);
    chimney.position.set(-29.5, 3.25 + 3.4, -23);
    chimney.castShadow = true;
    this.scene.add(chimney);
    this.colliders.push({ minX: -30.4, maxX: -28.6, minY: 0, maxY: 9.9, minZ: -23.9, maxZ: -22.1, kind: 'box' });
    this.boxes.push(this.colliders[this.colliders.length - 1]);
    this.occluders.push(chimney);
    // warning beacon on the furnace: a pulsing ember light for life in screenshots
    const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff5a26, emissive: 0xff4400, emissiveIntensity: 2 });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), beaconMat);
    beacon.position.set(-26, 3.8, -20.5);
    this.scene.add(beacon);
    this.pulseMats.push(beaconMat);
    this.box(-23, -26.5, 12, 0.6, 3.2, M.concrete);                            // north back wall
    this.box(-31.5, -20, 0.6, 8, 3.2, M.concrete);                             // west side wall
    container(-17.5, -13, M.contTeal);
    crate(-20, -21); crate(-20, -21, 1.2, 1.2); crate(-25.5, -11); crate(-19, -16.5);

    // --- Site B: the Depot (east). Container stacks with a lane between them.
    container(26, -23, M.contRust);
    container(26, -19.5, M.contSand);
    container(27.5, -23, M.contTeal, 0, 2.6);                                  // stacked box on top
    this.box(23, -26.5, 12, 0.6, 3.2, M.concrete);
    this.box(31.5, -20, 0.6, 8, 3.2, M.concrete);
    crate(19.5, -21); crate(19.5, -21, 1.2, 1.2); crate(25, -11.5); crate(18.5, -15);
    // step crates so a player can climb the B stack and hold from height
    crate(21.6, -23, 1.2, 0); crate(21.6, -23, 1.2, 1.2);

    // --- Lanes and mid-south cover.
    crate(-30, -2); crate(-30, 5); crate(-29, 5, 1.2, 1.2);
    crate(30, -2); crate(30, 5); crate(29, 5, 1.2, 1.2);
    crate(-30, 16); crate(30, 16);
    this.box(-15, 13, 0.6, 7, 3, M.concrete);                                  // west-mid choke wall
    this.box(15, 13, 0.6, 7, 3, M.concrete);                                   // east-mid choke wall
    container(0, 15.5, M.contSand, Math.PI / 2);                               // mid-south roadblock container
    crate(-11, 20); crate(11, 20); crate(-5, 24); crate(5, 24);
    crate(-13, -19); crate(13, -19);                                           // site approach cover
    crate(-6, -25); crate(6, -25);                                             // warden spawn cover
    this.box(-19, -2, 4, 0.6, 2.6, M.concrete);                                // west connector wall
    this.box(19, -2, 4, 0.6, 2.6, M.concrete);                                 // east connector wall

    // Lamp posts (decor poles; the PointLights live in buildLights).
    for (const [x, z] of [[-23, -17], [23, -17], [0, 7]]) {
      this.box(x + 2.5, z + 2.5, 0.22, 0.22, 5.4, M.darkMetal, { collide: false });
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8),
        new THREE.MeshStandardMaterial({ color: 0xffc98a, emissive: 0xff9a3c, emissiveIntensity: 2.4 }));
      bulb.position.set(x, 5.4, z);
      this.scene.add(bulb);
    }

    // Site decals: painted rings with letters, slightly above the asphalt.
    for (const [site, letter, css] of [[this.sites[0], 'A', 'rgba(47,191,174,0.85)'], [this.sites[1], 'B', 'rgba(224,100,50,0.85)']]) {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(site.radius, 40),
        new THREE.MeshBasicMaterial({ map: siteDecal(letter, css), transparent: true, depthWrite: false }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(site.center.x, 0.02, site.center.z);
      this.scene.add(m);
    }
  }

  update(dt) {
    this.time += dt;
    const pulse = 1.4 + Math.sin(this.time * 2.6) * 1.1;
    for (const m of this.pulseMats) m.emissiveIntensity = pulse;
  }

  // ------------------------------------------------------------- physics queries

  // Highest walkable surface at (x,z) that an actor standing at feetY can step onto.
  groundHeightAt(x, z, feetY) {
    let best = 0;
    for (const c of this.colliders) {
      if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      let top;
      if (c.kind === 'ramp') {
        const t = (x - c.minX) / (c.maxX - c.minX);
        top = c.h0 + (c.h1 - c.h0) * t;
      } else top = c.maxY;
      if (top <= feetY + STEP_UP && top > best) best = top;
    }
    return best;
  }

  // Move an actor (pos = feet centre, vel in m/s) through the world for dt seconds.
  // Horizontal axes resolve against boxes whose top is above step-up reach; the vertical
  // pass lands the actor on groundHeightAt. Sets actor.onGround.
  moveActor(actor, dt) {
    const p = actor.pos, v = actor.vel, r = ACTOR.radius;
    // vertical
    p.y += v.y * dt;
    // horizontal, one axis at a time so sliding along walls works
    p.x += v.x * dt;
    this.resolveAxis(actor, 'x');
    p.z += v.z * dt;
    this.resolveAxis(actor, 'z');
    // ground
    const gy = this.groundHeightAt(p.x, p.z, p.y + (v.y > 0 ? 0 : STEP_UP));
    if (p.y <= gy) {
      if (!actor.onGround && v.y < -3.4) actor.landed = true;
      p.y = gy;
      if (v.y < 0) v.y = 0;
      actor.onGround = true;
    } else if (p.y - gy > 0.02) {
      actor.onGround = false;
    }
    // world bounds: the yard is fenced
    p.x = Math.max(-35.6, Math.min(35.6, p.x));
    p.z = Math.max(-35.6, Math.min(35.6, p.z));
  }

  resolveAxis(actor, axis) {
    const p = actor.pos, r = ACTOR.radius, h = actor.height;
    for (const c of this.colliders) {
      if (c.kind !== 'box') continue;
      if (c.maxY <= p.y + STEP_UP) continue;              // low enough to step onto
      if (c.minY >= p.y + h) continue;                    // entirely above the head
      const overlapX = p.x + r > c.minX && p.x - r < c.maxX;
      const overlapZ = p.z + r > c.minZ && p.z - r < c.maxZ;
      if (!overlapX || !overlapZ) continue;
      if (axis === 'x') {
        p.x = actor.vel.x > 0 ? c.minX - r : c.maxX + r;
        if (actor.vel.x === 0) p.x = (p.x < (c.minX + c.maxX) / 2) ? c.minX - r : c.maxX + r;
      } else {
        p.z = actor.vel.z > 0 ? c.minZ - r : c.maxZ + r;
        if (actor.vel.z === 0) p.z = (p.z < (c.minZ + c.maxZ) / 2) ? c.minZ - r : c.maxZ + r;
      }
    }
  }

  // Shared actor locomotion: accelerate the horizontal velocity toward a wish direction,
  // apply gravity, then moveActor. The player and every bot drive through here, so movement
  // feel — and the accuracy cost of moving — is identical for all of them.
  driveActor(actor, dt, wishX, wishZ, { speed = ACTOR.walkSpeed, jump = false, crouch = false } = {}) {
    actor.crouching = crouch;
    const targetHeight = crouch ? ACTOR.crouchHeight : ACTOR.standHeight;
    actor.height += (targetHeight - actor.height) * Math.min(1, dt * 11);
    const targetEye = crouch ? ACTOR.eyeCrouch : ACTOR.eyeStand;
    actor.eyeHeight += (targetEye - actor.eyeHeight) * Math.min(1, dt * 11);
    const wishLen = Math.hypot(wishX, wishZ);
    const wx = wishLen > 0 ? wishX / wishLen : 0;
    const wz = wishLen > 0 ? wishZ / wishLen : 0;
    if (actor.onGround) {
      const a = (wishLen > 0 ? ACTOR.accel : ACTOR.friction * ACTOR.walkSpeed) * dt;
      actor.vel.x = approach(actor.vel.x, wx * speed, a);
      actor.vel.z = approach(actor.vel.z, wz * speed, a);
      if (jump) {
        actor.vel.y = ACTOR.jumpSpeed;
        actor.onGround = false;
        actor.jumped = true;
      }
    } else {
      actor.vel.x = approach(actor.vel.x, wx * speed, ACTOR.airAccel * dt);
      actor.vel.z = approach(actor.vel.z, wz * speed, ACTOR.airAccel * dt);
    }
    actor.vel.y -= ACTOR.gravity * dt;
    this.moveActor(actor, dt);
  }

  // Segment vs the box list: true when a sight/bullet line from a to b is blocked.
  // (Bullets use three.js raycasts against occluder meshes for exact hit points; bots use
  // this cheaper test for visibility.)
  segmentBlocked(a, b) {
    for (const c of this.boxes) {
      if (segmentHitsBox(a, b, c)) return true;
    }
    return false;
  }
}

function approach(value, target, maxDelta) {
  if (value < target) return Math.min(target, value + maxDelta);
  return Math.max(target, value - maxDelta);
}

// Slab test of a segment against one AABB.
function segmentHitsBox(a, b, c) {
  let tmin = 0, tmax = 1;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const axes = [
    [a.x, dx, c.minX, c.maxX],
    [a.y, dy, c.minY, c.maxY],
    [a.z, dz, c.minZ, c.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return false;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
