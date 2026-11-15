// Keyboard and mouse state. Continuous input (held keys, look angles) is polled by the
// simulation; discrete presses (reload, buy, throw) are queued as named actions so a tap
// between frames is never lost. Pointer lock is owned here; the round manager asks for it.

export class Input {
  constructor(dom) {
    this.keys = new Set();
    this.actions = [];       // queued one-shot action names, drained by the consumer each step
    this.yaw = 0;            // radians, 0 faces -Z
    this.pitch = 0;          // radians, clamped to just under vertical
    this.firing = false;     // primary mouse button held
    this.aiming = false;     // right mouse button held (DMR scope / carbine sight)
    this.locked = false;
    this.sensitivity = 0.0021;
    this.dom = dom;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.mapKey(e.code, true);
      if (['Space', 'Tab', 'ControlLeft'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      this.mapKey(e.code, false);
    });
    addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
      this.aiming = false;
    });

    dom.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.aiming = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.aiming = false;
    });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;
      const lim = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) {
        this.firing = false;
        this.aiming = false;
        this.push('unlock');
      }
    });
  }

  mapKey(code, down) {
    if (!down) return;
    switch (code) {
      case 'KeyR': this.push('reload'); break;
      case 'KeyB': this.push('buy'); break;
      case 'KeyG': this.push('grenade'); break;
      case 'KeyF': this.push('grenadeAlt'); break;
      case 'Digit1': this.push('slot1'); break;
      case 'Digit2': this.push('slot2'); break;
      case 'Digit3': this.push('slot3'); break;
      case 'Digit4': this.push('slot4'); break;
      case 'Digit5': this.push('slot5'); break;
      case 'Digit6': this.push('slot6'); break;
      case 'Digit7': this.push('slot7'); break;
      case 'KeyQ': this.push('lastWeapon'); break;
      case 'Enter': this.push('deploy'); break;
      case 'Space': this.push('jump'); break;
    }
  }

  push(name) { this.actions.push(name); }

  // Drain the queued one-shot actions; called once per simulation step by the owner.
  drain() {
    const out = this.actions;
    this.actions = [];
    return out;
  }

  has(action) { return this.actions.includes(action); }

  down(code) { return this.keys.has(code); }

  // Movement axes in the player's local frame: x strafe right, z forward.
  moveAxes() {
    let x = 0, z = 0;
    if (this.down('KeyW') || this.down('ArrowUp')) z += 1;
    if (this.down('KeyS') || this.down('ArrowDown')) z -= 1;
    if (this.down('KeyD') || this.down('ArrowRight')) x += 1;
    if (this.down('KeyA') || this.down('ArrowLeft')) x -= 1;
    return { x, z };
  }

  get crouch() { return this.down('ControlLeft') || this.down('ControlRight') || this.down('KeyC'); }
  get walk() { return this.down('ShiftLeft') || this.down('ShiftRight'); }

  lock() {
    if (!this.locked) this.dom.requestPointerLock();
  }
  unlock() {
    if (this.locked) document.exitPointerLock();
  }
  face(yaw, pitch = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
  }
}
