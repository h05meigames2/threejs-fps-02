// Transient visuals, all pooled: tracers, impact sparks, hit puffs, muzzle flash, smoke
// clouds and explosion flashes. Nothing here allocates in the frame loop — pools are built
// once and recycled by index, which keeps the render loop garbage-free during a firefight.
// Smoke clouds are also gameplay state: bots ask smokeBlocks() before they may see through.

import * as THREE from 'three';

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TRACERS = 40, SPARKS = 320, PUFFS = 24, SMOKES = 10;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;

    // --- tracers: thin additive boxes stretched between muzzle and hit point
    this.tracerPool = [];
    const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    for (let i = 0; i < TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.tracerPool.push({ mesh, until: 0 });
    }
    this.tracerIdx = 0;

    // --- sparks: one THREE.Points cloud, positions/velocities/lives in flat arrays
    this.sparkPos = new Float32Array(SPARKS * 3);
    this.sparkVel = new Float32Array(SPARKS * 3);
    this.sparkLife = new Float32Array(SPARKS);
    this.sparkIdx = 0;
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.085, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    this.sparkPoints.frustumCulled = false;
    scene.add(this.sparkPoints);
    for (let i = 0; i < SPARKS; i++) this.sparkPos[i * 3 + 1] = -100;

    // --- puffs: soft sprites for body hits and dust
    this.puffTex = radialTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
    this.puffPool = [];
    for (let i = 0; i < PUFFS; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.puffTex, transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.puffPool.push({ sprite, born: 0, life: 0.4, grow: 1 });
    }
    this.puffIdx = 0;

    // --- smoke clouds: big slow sprites + a LOS-blocking sphere while active
    this.smokeTex = radialTexture('rgba(210,210,215,0.55)', 'rgba(210,210,215,0)');
    this.smokePool = [];
    for (let i = 0; i < SMOKES; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, opacity: 0, depthWrite: false });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      scene.add(sprite);
      this.smokePool.push({ sprite, center: new THREE.Vector3(), radius: 5, from: 0, until: 0 });
    }
    this.smokeIdx = 0;

    // --- one shared flash light for muzzles and explosions
    this.flash = new THREE.PointLight(0xffb45e, 0, 18, 1.6);
    scene.add(this.flash);
    this.flashUntil = 0;

    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  tracer(from, to, color = 0xffe2a8) {
    const slot = this.tracerPool[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % TRACERS;
    const mesh = slot.mesh;
    this.tmp.copy(to).sub(from);
    const len = this.tmp.length();
    if (len < 0.5) return;
    mesh.position.copy(from).addScaledVector(this.tmp, 0.5);
    mesh.scale.set(1, 1, len);
    mesh.lookAt(to);
    mesh.material.color.setHex(color);
    mesh.material.opacity = 0.85;
    mesh.visible = true;
    slot.until = this.time + 0.055;
  }

  sparks(pos, dir, count = 7, color = 0xffc46b) {
    for (let n = 0; n < count; n++) {
      const i = this.sparkIdx;
      this.sparkIdx = (this.sparkIdx + 1) % SPARKS;
      this.sparkPos[i * 3] = pos.x; this.sparkPos[i * 3 + 1] = pos.y; this.sparkPos[i * 3 + 2] = pos.z;
      this.sparkVel[i * 3] = dir.x * (1 + Math.random() * 2.4) + (Math.random() - 0.5) * 2.2;
      this.sparkVel[i * 3 + 1] = Math.abs(dir.y) * 1.4 + Math.random() * 2.0;
      this.sparkVel[i * 3 + 2] = dir.z * (1 + Math.random() * 2.4) + (Math.random() - 0.5) * 2.2;
      this.sparkLife[i] = 0.25 + Math.random() * 0.3;
    }
    this.sparkPoints.material.color.setHex(color);
  }

  puff(pos, colorHex, scale = 0.55, life = 0.38) {
    const slot = this.puffPool[this.puffIdx];
    this.puffIdx = (this.puffIdx + 1) % PUFFS;
    slot.sprite.position.copy(pos);
    slot.sprite.material.color.setHex(colorHex);
    slot.sprite.material.opacity = 0.75;
    slot.sprite.scale.setScalar(scale);
    slot.sprite.visible = true;
    slot.born = this.time;
    slot.life = life;
    slot.grow = scale;
  }

  muzzle(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 26;
    this.flashUntil = this.time + 0.045;
    this.puff(pos, 0xffca7a, 0.34, 0.07);
  }

  explosion(pos) {
    this.flash.position.copy(pos);
    this.flash.intensity = 160;
    this.flash.distance = 34;
    this.flashUntil = this.time + 0.22;
    this.tmp.set(0, 1, 0);
    this.sparks(pos, this.tmp, 42, 0xff9a4d);
    this.puff(pos, 0x8a8078, 3.4, 0.8);
    this.puff(pos, 0xffa050, 1.8, 0.4);
  }

  smoke(pos, radius, duration) {
    const slot = this.smokePool[this.smokeIdx];
    this.smokeIdx = (this.smokeIdx + 1) % SMOKES;
    slot.center.copy(pos);
    slot.center.y += 1.1;
    slot.radius = radius;
    slot.from = this.time + 0.9;         // takes a moment to billow out
    slot.until = this.time + duration;
    slot.sprite.position.copy(slot.center);
    slot.sprite.scale.setScalar(radius * 2.3);
    slot.sprite.visible = true;
    slot.sprite.material.opacity = 0;
    return slot;
  }

  // Does any live smoke cloud swallow the segment a→b? Bots may not see through smoke.
  smokeBlocks(a, b) {
    for (const s of this.smokePool) {
      if (this.time < s.from || this.time > s.until) continue;
      if (segmentNearPoint(a, b, s.center, s.radius * 0.82)) return true;
    }
    return false;
  }

  update(dt) {
    this.time += dt;
    for (const slot of this.tracerPool) {
      if (slot.mesh.visible && this.time > slot.until) slot.mesh.visible = false;
    }
    // sparks
    let anySpark = false;
    for (let i = 0; i < SPARKS; i++) {
      if (this.sparkLife[i] <= 0) continue;
      anySpark = true;
      this.sparkLife[i] -= dt;
      if (this.sparkLife[i] <= 0) { this.sparkPos[i * 3 + 1] = -100; continue; }
      this.sparkVel[i * 3 + 1] -= 6.5 * dt;
      this.sparkPos[i * 3] += this.sparkVel[i * 3] * dt;
      this.sparkPos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.sparkPos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
    }
    if (anySpark) this.sparkPoints.geometry.attributes.position.needsUpdate = true;
    // puffs
    for (const slot of this.puffPool) {
      if (!slot.sprite.visible) continue;
      const age = this.time - slot.born;
      if (age >= slot.life) { slot.sprite.visible = false; continue; }
      const t = age / slot.life;
      slot.sprite.material.opacity = 0.75 * (1 - t);
      slot.sprite.scale.setScalar(slot.grow * (0.7 + t * 0.9));
    }
    // smoke fade in/out
    for (const s of this.smokePool) {
      if (!s.sprite.visible) continue;
      if (this.time > s.until + 1.6) { s.sprite.visible = false; continue; }
      const fadeIn = Math.min(1, Math.max(0, (this.time - (s.from - 0.9)) / 0.9));
      const fadeOut = Math.min(1, Math.max(0, (s.until + 1.6 - this.time) / 1.6));
      s.sprite.material.opacity = 0.88 * Math.min(fadeIn, fadeOut);
    }
    if (this.time > this.flashUntil) {
      this.flash.intensity = 0;
      this.flash.distance = 18;
    }
  }
}

// Distance from point c to segment a→b below r?
function segmentNearPoint(a, b, c, r) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const lenSq = abx * abx + aby * aby + abz * abz;
  let t = lenSq > 0 ? ((c.x - a.x) * abx + (c.y - a.y) * aby + (c.z - a.z) * abz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = a.x + abx * t - c.x, dy = a.y + aby * t - c.y, dz = a.z + abz * t - c.z;
  return dx * dx + dy * dy + dz * dz < r * r;
}
