// RUSTLINE sound: every effect is synthesised with WebAudio — noise bursts through filters for
// gunfire and explosions, short oscillator blips for UI and markers. No audio files exist, so
// the game loads nothing over the network and sounds identical everywhere.

export class SoundBank {
  constructor() {
    this.ctx = null;        // created lazily on the first user gesture (browser policy)
    this.master = null;
    this.noiseBuf = null;   // one shared 1s white-noise buffer, reused by every noise voice
    this.lastStep = 0;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.startAmbience();
  }

  // A voice of filtered noise: the workhorse for shots, booms and hisses.
  noise({ dur = 0.2, type = 'lowpass', freq = 1200, q = 0.8, gain = 0.5, sweepTo = null, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) filter.frequency.exponentialRampToValueAtTime(Math.max(30, sweepTo), t + dur);
    filter.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // A voice of oscillator: beeps, dings and stingers.
  tone({ freq = 440, dur = 0.12, type = 'sine', gain = 0.2, sweepTo = null, delay = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // Gunfire, shaped per weapon class. dist01 (0 near, 1 far) thins out other actors' shots.
  shot(kind, dist01 = 0) {
    const near = 1 - dist01 * 0.75;
    if (kind === 'scatter') {
      this.noise({ dur: 0.32, freq: 900, sweepTo: 120, gain: 0.85 * near });
      this.tone({ freq: 110, dur: 0.18, type: 'triangle', gain: 0.4 * near, sweepTo: 45 });
    } else if (kind === 'longshot') {
      this.noise({ dur: 0.4, freq: 2400, sweepTo: 200, gain: 0.8 * near });
      this.tone({ freq: 160, dur: 0.22, type: 'triangle', gain: 0.45 * near, sweepTo: 55 });
    } else if (kind === 'wasp') {
      this.noise({ dur: 0.11, freq: 2600, sweepTo: 700, gain: 0.5 * near });
    } else if (kind === 'sidearm') {
      this.noise({ dur: 0.16, freq: 2000, sweepTo: 350, gain: 0.6 * near });
      this.tone({ freq: 130, dur: 0.1, type: 'triangle', gain: 0.3 * near, sweepTo: 60 });
    } else { // carbine
      this.noise({ dur: 0.2, freq: 1700, sweepTo: 260, gain: 0.7 * near });
      this.tone({ freq: 120, dur: 0.13, type: 'triangle', gain: 0.35 * near, sweepTo: 50 });
    }
  }

  dryFire() { this.tone({ freq: 1900, dur: 0.04, type: 'square', gain: 0.08 }); }
  reloadStart() { this.noise({ dur: 0.07, type: 'bandpass', freq: 900, q: 2, gain: 0.25 }); }
  reloadEnd() {
    this.noise({ dur: 0.06, type: 'bandpass', freq: 1400, q: 2, gain: 0.3 });
    this.tone({ freq: 700, dur: 0.05, type: 'square', gain: 0.06, delay: 0.05 });
  }
  hit(head) {
    this.tone({ freq: head ? 1560 : 980, dur: 0.06, type: 'square', gain: head ? 0.16 : 0.11 });
    if (head) this.tone({ freq: 2090, dur: 0.09, type: 'sine', gain: 0.12, delay: 0.03 });
  }
  killConfirm() { this.tone({ freq: 620, dur: 0.09, type: 'triangle', gain: 0.18, sweepTo: 880 }); }
  hurt() { this.noise({ dur: 0.12, type: 'lowpass', freq: 500, gain: 0.3 }); }
  jump() { this.noise({ dur: 0.06, type: 'bandpass', freq: 500, q: 1, gain: 0.06 }); }
  land() { this.noise({ dur: 0.09, type: 'lowpass', freq: 300, gain: 0.16 }); }

  step(run) {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastStep < (run ? 235 : 330)) return;
    this.lastStep = now;
    this.noise({ dur: 0.07, type: 'lowpass', freq: 260 + Math.random() * 120, gain: run ? 0.13 : 0.08 });
  }

  throwWhoosh() { this.noise({ dur: 0.22, type: 'bandpass', freq: 700, sweepTo: 1800, q: 1.5, gain: 0.14 }); }
  explosion(dist01 = 0) {
    const near = 1 - dist01 * 0.6;
    this.noise({ dur: 1.1, freq: 3000, sweepTo: 60, gain: 1.0 * near });
    this.tone({ freq: 90, dur: 0.8, type: 'sine', gain: 0.7 * near, sweepTo: 30 });
  }
  smokeHiss() { this.noise({ dur: 1.4, type: 'highpass', freq: 2500, gain: 0.1 }); }
  bombBeep(final) { this.tone({ freq: final ? 1760 : 1180, dur: final ? 0.2 : 0.07, type: 'square', gain: 0.14 }); }
  channelTick() { this.tone({ freq: 840, dur: 0.05, type: 'sine', gain: 0.1 }); }
  buy() { this.tone({ freq: 520, dur: 0.06, type: 'triangle', gain: 0.14 }); this.tone({ freq: 780, dur: 0.08, type: 'triangle', gain: 0.12, delay: 0.05 }); }
  denied() { this.tone({ freq: 190, dur: 0.12, type: 'square', gain: 0.1 }); }

  roundWin() {
    this.tone({ freq: 523, dur: 0.14, type: 'triangle', gain: 0.16 });
    this.tone({ freq: 659, dur: 0.14, type: 'triangle', gain: 0.16, delay: 0.12 });
    this.tone({ freq: 784, dur: 0.26, type: 'triangle', gain: 0.18, delay: 0.24 });
  }
  roundLose() {
    this.tone({ freq: 392, dur: 0.16, type: 'triangle', gain: 0.16 });
    this.tone({ freq: 330, dur: 0.16, type: 'triangle', gain: 0.16, delay: 0.13 });
    this.tone({ freq: 262, dur: 0.3, type: 'triangle', gain: 0.18, delay: 0.26 });
  }

  // Low wind over the yard, looped through a slow LFO so the menu is never silent.
  startAmbience() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(filter.frequency);
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    lfo.start();
  }
}
