// 효과음: Web Audio 로 그때그때 합성한다 (음원 파일 없음).
export class Sfx {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
    this.muted = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const n = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, n, n);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running' && !this.muted && this.vol > 0;
  }

  env(g, t, a, peak, dur) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak * this.vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  tone({ type = 'sine', f0, f1 = f0, dur = 0.1, gain = 0.2, delay = 0, a = 0.005 }) {
    if (!this.ok || gain < 0.003) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this.env(g, t, a, gain, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise({ dur = 0.1, gain = 0.2, f = 1000, q = 1, type = 'bandpass', delay = 0, f1 }) {
    if (!this.ok || gain < 0.003) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    flt.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, 0.004, gain, dur);
    s.connect(flt).connect(g).connect(this.master);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // 거리 → 소리 크기 (25m 에서 0)
  near(d) {
    return Math.max(0, 1 - d / 25) ** 1.5;
  }

  cluck(d = 0) {
    const k = this.near(d);
    const p = 0.85 + Math.random() * 0.35;
    this.tone({ type: 'square', f0: 620 * p, f1: 380 * p, dur: 0.07, gain: 0.05 * k });
    this.tone({ type: 'square', f0: 560 * p, f1: 340 * p, dur: 0.08, gain: 0.045 * k, delay: 0.12 });
    if (Math.random() < 0.3) this.tone({ type: 'square', f0: 900 * p, f1: 520 * p, dur: 0.16, gain: 0.04 * k, delay: 0.26 });
  }

  stab(d = 0) {
    const k = this.near(d);
    this.noise({ dur: 0.13, gain: 0.25 * k, f: 2400, f1: 6000, q: 0.8 });
    this.tone({ type: 'triangle', f0: 240, f1: 70, dur: 0.14, gain: 0.3 * k, delay: 0.05 });
  }

  whiff() {
    this.noise({ dur: 0.16, gain: 0.18, f: 1500, f1: 4500, q: 1.2 });
  }

  squawk(d = 0) {
    const k = this.near(d);
    this.tone({ type: 'sawtooth', f0: 900, f1: 1500, dur: 0.12, gain: 0.08 * k });
    this.tone({ type: 'sawtooth', f0: 1400, f1: 420, dur: 0.35, gain: 0.08 * k, delay: 0.1 });
    this.noise({ dur: 0.25, gain: 0.12 * k, f: 700, q: 0.6, type: 'lowpass', delay: 0.05 });
  }

  flap(d = 0) {
    const k = this.near(d);
    for (let i = 0; i < 6; i++) this.noise({ dur: 0.05, gain: 0.1 * k, f: 900, q: 0.7, delay: i * 0.12 });
  }

  peck(d = 0) {
    const k = this.near(d);
    this.tone({ type: 'square', f0: 1900, f1: 1200, dur: 0.02, gain: 0.04 * k, delay: 0.15 });
    this.tone({ type: 'square', f0: 1900, f1: 1200, dur: 0.02, gain: 0.04 * k, delay: 0.5 });
  }

  step() {
    this.noise({ dur: 0.07, gain: 0.05, f: 380, q: 0.5, type: 'lowpass' });
  }

  beep(hi) {
    this.tone({ type: 'triangle', f0: hi ? 990 : 660, dur: hi ? 0.35 : 0.14, gain: 0.18 });
  }

  good() {
    this.tone({ type: 'triangle', f0: 880, dur: 0.12, gain: 0.2 });
    this.tone({ type: 'triangle', f0: 1320, dur: 0.25, gain: 0.2, delay: 0.1 });
  }

  bad() {
    this.tone({ type: 'square', f0: 240, f1: 150, dur: 0.35, gain: 0.12 });
    this.tone({ type: 'square', f0: 180, f1: 110, dur: 0.4, gain: 0.1, delay: 0.18 });
  }

  click() {
    this.tone({ type: 'triangle', f0: 700, f1: 900, dur: 0.05, gain: 0.12 });
  }
}
