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

  // 닭 목소리: 톱니파(성대) → 부리·목의 울림 두 봉우리(포먼트) + 몸통 울림, 거친 떨림(진폭 변조)
  // f: [처음, 가장 높을 때(30% 지점), 끝] 높이(Hz), rough: 0~1 거칠기(꽥꽥), form: 울림 높이 배율
  voice({ f, dur = 0.1, gain = 0.1, delay = 0, rough = 0, form = 1, a = 0.006 }) {
    if (!this.ok || gain < 0.003) return;
    const c = this.ctx;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f[0], t);
    o.frequency.linearRampToValueAtTime(f[1], t + dur * 0.3);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, f[2] ?? f[1]), t + dur);
    const g = c.createGain();
    this.env(g, t, a, gain, dur);
    const band = (type, freq, q, amt) => {
      const flt = c.createBiquadFilter();
      flt.type = type;
      flt.frequency.value = freq;
      flt.Q.value = q;
      const m = c.createGain();
      m.gain.value = amt;
      o.connect(flt).connect(m).connect(g);
    };
    band('bandpass', 1050 * form, 3, 1.6); // "꼭" 하는 부리 울림
    band('bandpass', 2600 * form, 5, 0.9); // 날카로운 윗소리
    band('lowpass', 1300, 0.7, 0.35); // 몸통
    let out = g;
    if (rough) {
      // 빠르게 떨어 거친 목소리 (꽤액)
      const am = c.createGain();
      am.gain.value = 1 - rough * 0.5;
      const lfo = c.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 36 + Math.random() * 22;
      const lg = c.createGain();
      lg.gain.value = rough * 0.5;
      lfo.connect(lg).connect(am.gain);
      g.connect(am);
      out = am;
      lfo.start(t);
      lfo.stop(t + dur + 0.03);
    }
    out.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  // 주변 닭이 가끔: "꼭 꼭 (꼬댁)"
  cluck(d = 0) {
    const k = this.near(d);
    const p = 0.85 + Math.random() * 0.3;
    this.voice({ f: [360 * p, 420 * p, 300 * p], dur: 0.075, gain: 0.16 * k });
    this.voice({ f: [340 * p, 400 * p, 280 * p], dur: 0.08, gain: 0.15 * k, delay: 0.14 });
    if (Math.random() < 0.3) this.voice({ f: [420 * p, 720 * p, 520 * p], dur: 0.22, gain: 0.15 * k, delay: 0.3, rough: 0.4 });
  }

  // 찔린 닭: "꼬-액!!"
  squawk(d = 0) {
    const k = this.near(d);
    this.voice({ f: [900, 1000, 820], dur: 0.07, gain: 0.16 * k, rough: 0.3 });
    this.voice({ f: [700, 1350, 450], dur: 0.5, gain: 0.22 * k, delay: 0.08, rough: 0.65, form: 1.1 });
    this.noise({ dur: 0.25, gain: 0.08 * k, f: 700, q: 0.6, type: 'lowpass', delay: 0.05 });
  }

  // 칼에 맞는 소리
  stab(d = 0) {
    const k = this.near(d);
    this.noise({ dur: 0.13, gain: 0.25 * k, f: 2400, f1: 6000, q: 0.8 });
    this.tone({ type: 'triangle', f0: 240, f1: 70, dur: 0.14, gain: 0.3 * k, delay: 0.05 });
  }

  // 찌르는 닭의 기합: "꽤액!"
  battle(d = 0) {
    const k = this.near(d);
    const p = 0.92 + Math.random() * 0.16;
    this.voice({ f: [620 * p, 1150 * p, 700 * p], dur: 0.24, gain: 0.32 * k, rough: 0.75, form: 1.15 });
    this.noise({ dur: 0.12, gain: 0.05 * k, f: 2800, q: 1.2 });
  }

  // 칼 휘두르는 바람 소리
  whiff(d = 0) {
    this.noise({ dur: 0.16, gain: 0.18 * this.near(d), f: 1500, f1: 4500, q: 1.2 });
  }

  // 날갯짓: 퍼덕퍼덕 + "꼬꼬꼬꼬댁!"
  flap(d = 0) {
    const k = this.near(d);
    const p = 0.9 + Math.random() * 0.2;
    for (let i = 0; i < 6; i++) this.noise({ dur: 0.06, gain: 0.12 * k, f: 800, q: 0.6, delay: i * 0.12 });
    for (let i = 0; i < 3; i++) this.voice({ f: [420 * p, 490 * p, 380 * p], dur: 0.06, gain: 0.13 * k, delay: 0.02 + i * 0.1 });
    this.voice({ f: [480 * p, 880 * p, 560 * p], dur: 0.3, gain: 0.18 * k, delay: 0.33, rough: 0.5 });
  }

  // 쪼기: 작게 "꾸룩" + 부리로 땅을 톡톡 (애니메이션의 두 번 쪼기에 맞춘다)
  peck(d = 0) {
    const k = this.near(d);
    this.voice({ f: [300, 335, 250], dur: 0.1, gain: 0.1 * k, form: 0.9 });
    for (const at of [0.17, 0.52]) {
      this.noise({ dur: 0.018, gain: 0.14 * k, f: 3200, q: 2, delay: at });
      this.tone({ type: 'triangle', f0: 1400, f1: 900, dur: 0.015, gain: 0.05 * k, delay: at });
    }
  }

  // 뛰는 발소리: 흙바닥에 "탁" + 발톱 긁는 소리
  step(d = 0) {
    const k = this.near(d);
    const p = 0.85 + Math.random() * 0.3;
    this.noise({ dur: 0.05, gain: 0.32 * k, f: 420 * p, q: 0.6, type: 'lowpass' });
    this.noise({ dur: 0.016, gain: 0.09 * k, f: 2300 * p, q: 1.5 });
  }

  // 뛰면서 숨찬 "꼭꼭꼭"
  runCluck(d = 0) {
    const k = this.near(d);
    const p = 0.95 + Math.random() * 0.2;
    const n = 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) this.voice({ f: [480 * p, 560 * p, 430 * p], dur: 0.05, gain: 0.15 * k, delay: i * 0.085, rough: 0.2 });
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
