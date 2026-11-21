// 게임 한 판(방 하나)의 권위 시뮬레이션. 온라인 서버와 "혼자 하기"(브라우저 안)가 같은 코드를 쓴다.
//
// 비밀 지키기: 스냅샷에는 닭마다 [id, x, z, 방향, 동작] 만 실린다. AI 와 플레이어가 같은 꼴이고,
// id 는 무작위이며 id 순으로 보내므로 만든 순서도 드러나지 않는다. 내가 누구인지만 따로 알려 준다.
import { ACT, ANIM, CFG, STAB_TICKS } from '../shared/config.js';
import { randomOpen } from '../shared/map.js';
import { stepChicken, speedOf } from '../shared/sim.js';
import { mulberry32, range } from '../shared/rng.js';
import { AiBrain } from './ai.js';
import { BotBrain, botName } from './bots.js';

const DT = 1 / CFG.TICK_RATE;
const IDLE_INPUT = Object.freeze({ dx: 0, dz: 0, run: false, face: null, act: ACT.NONE });
const HOLD_INPUT = Object.freeze({ dx: 0, dz: 0, run: false, face: null, act: ACT.NONE, stop: true }); // 찌르는 중
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);

export class Game {
  // opts: players(사람+봇 수), ai(AI 닭 수), autoRestart(결과 뒤 자동으로 다음 판), seed
  constructor(opts = {}) {
    this.opts = { players: CFG.PLAYERS, ai: CFG.AI_COUNT, autoRestart: true, ...opts };
    this.rng = mulberry32(opts.seed ?? Math.floor(Math.random() * 2 ** 32));
    this.ents = new Map(); // id → 닭
    this.slots = []; // 플레이어 자리 (사람 또는 봇)
    this.tick = 0;
    this.nextPid = 1;
    this.round = 0;
    this.newRound();
  }

  get humanCount() {
    return this.slots.filter((s) => !s.bot).length;
  }

  // ───────────── 판 관리 ─────────────
  newRound() {
    this.round++;
    this.ents.clear();
    this.events = []; // 모두에게 (다음 스냅샷에 실린다)
    this.finishT = 0; // 마지막 한 명이 남은 뒤 판이 끝날 때까지
    this.time = 0;
    this.phase = 'count';
    this.phaseT = CFG.COUNTDOWN;
    this.timeLeft = CFG.ROUND_TIME;
    this.boardDirty = true;
    this.result = null;
    while (this.slots.length < this.opts.players) this.addBot();
    for (const s of this.slots) {
      Object.assign(s, { score: 0, kills: 0, aiKills: 0, deaths: 0, deadAt: 0, ent: null, again: false, inputs: [] });
      s.inbox.push({ t: 'round', n: this.round });
    }
    // 처음에는 맵 곳곳에 흩어 놓는다. 만드는 순서를 섞어 둔다.
    const kinds = [...Array(this.opts.ai).fill(null), ...this.slots];
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [kinds[i], kinds[j]] = [kinds[j], kinds[i]];
    }
    for (const slot of kinds) {
      const p = randomOpen(this.rng, 0.7);
      const e = this.spawn(p.x, p.z, this.rng() * Math.PI * 2, slot);
      if (slot) {
        slot.ent = e.id;
        slot.bot?.onSpawn(this);
      }
    }
  }

  endRound() {
    this.phase = 'end';
    this.phaseT = CFG.END_TIME;
    this.result = this.board();
    this.events.push({ t: 'end', rank: this.result });
  }

  isAlive(s) {
    return !!this.ents.get(s.ent)?.alive;
  }

  get alivePlayers() {
    return this.slots.filter((s) => this.isAlive(s)).length;
  }

  // 점수표 (데스매치): 살아남은 닭이 먼저(잡은 수 순), 잡힌 닭은 늦게 잡힐수록 위, 같으면 잡은 수
  board() {
    const rows = this.slots.map((s) => ({ s, al: this.isAlive(s) }));
    return rows
      .sort((a, b) => b.al - a.al || (a.al ? 0 : b.s.deadAt - a.s.deadAt) || b.s.kills - a.s.kills)
      .map(({ s, al }) => ({ pid: s.pid, n: s.name, s: s.score, k: s.kills, a: s.aiKills, d: s.deaths, al: al ? 1 : 0 }));
  }

  // ───────────── 자리 (사람/봇) ─────────────
  newSlot(name, bot) {
    return { pid: this.nextPid++, name, bot, session: null, score: 0, kills: 0, aiKills: 0, deaths: 0, deadAt: 0, ent: null, inputs: [], ack: 0, inbox: [], again: false };
  }

  addBot() {
    const taken = new Set(this.slots.map((s) => s.name));
    const s = this.newSlot(botName(this.rng, taken), new BotBrain(this.rng));
    this.slots.push(s);
    return s;
  }

  // 사람이 들어오면 봇 하나의 자리(지금 그 닭 그대로)를 넘겨받는다. 살아 있는 봇을 먼저 고른다. 자리가 없으면 null.
  addHuman({ name, session }) {
    const s = this.slots.find((x) => x.bot && this.isAlive(x)) || this.slots.find((x) => x.bot);
    if (!s) return null;
    s.bot = null;
    s.session = session;
    s.name = cleanName(name, new Set(this.slots.map((x) => x.name)));
    Object.assign(s, { score: 0, kills: 0, aiKills: 0, deaths: 0, inputs: [], ack: 0, again: false });
    this.boardDirty = true;
    s.inbox.push({ t: 'hello', pid: s.pid, round: this.round });
    if (this.phase === 'end') s.inbox.push({ t: 'end', rank: this.result });
    return s;
  }

  // 사람이 나가면 봇이 그 닭을 이어받는다
  removeHuman(s) {
    if (s.bot) return;
    s.bot = new BotBrain(this.rng);
    s.session = null;
    s.name = botName(this.rng, new Set(this.slots.map((x) => x.name)));
    s.inbox = [];
    this.boardDirty = true;
  }

  // 클라이언트 메시지
  handle(s, m) {
    if (!m || typeof m !== 'object' || s.bot) return;
    if (m.t === 'in') {
      const inp = {
        seq: Math.floor(num(m.s, 0, 1e9)),
        dx: num(m.x, -1, 1),
        dz: num(m.z, -1, 1),
        run: !!m.r,
        face: null,
        act: Math.floor(num(m.a, 0, 3)),
      };
      s.inputs.push(inp);
      if (s.inputs.length > 12) s.inputs.splice(0, s.inputs.length - 12);
    } else if (m.t === 'again') {
      // 혼자 하기는 잡혀서 관전 중일 때도 바로 새 판
      if (!this.opts.autoRestart && this.phase === 'play' && !this.isAlive(s)) return this.newRound();
      if (this.phase !== 'end') return;
      s.again = true;
      const humans = this.slots.filter((x) => !x.bot);
      const allIn = humans.every((x) => x.again);
      // 혼자 하기는 바로, 온라인은 모두 누르면(결과를 최소 2.5초는 보여 주고) 다음 판
      if (!this.opts.autoRestart || (allIn && CFG.END_TIME - this.phaseT > 2.5)) this.newRound();
      else if (allIn) this.phaseT = Math.min(this.phaseT, 2.5 - (CFG.END_TIME - this.phaseT));
    }
  }

  // ───────────── 닭 ─────────────
  newId() {
    for (;;) {
      const id = 1 + Math.floor(this.rng() * 9999);
      if (!this.ents.has(id)) return id;
    }
  }

  spawn(x, z, yaw, slot = null) {
    const e = {
      id: this.newId(),
      x, z, yaw, vx: 0, vz: 0,
      slot, // 플레이어면 자리, AI 면 null (스냅샷에는 실리지 않는다)
      brain: slot ? null : new AiBrain(this.rng),
      alive: true,
      act: ACT.NONE,
      actT: 0,
      cd: 0,
      lockN: 0, // 찌르는 중: 남은 멈춤 (입력 수)
      panicT: 0,
      fleeX: 0,
      fleeZ: 1,
      deadT: 0,
      killer: 0,
      sus: 0, // 수상한 정도 (봇이 노릴 닭을 고를 때 쓴다. 보이는 행동으로만 쌓인다)
      moveT: 0,
    };
    this.ents.set(e.id, e);
    return e;
  }

  nearby(ent, r) {
    const out = [];
    for (const o of this.ents.values()) {
      if (o === ent || !o.alive) continue;
      if (Math.abs(o.x - ent.x) > r || Math.abs(o.z - ent.z) > r) continue;
      if (Math.hypot(o.x - ent.x, o.z - ent.z) <= r) out.push(o);
    }
    return out;
  }

  panic(e, fx, fz, t) {
    e.panicT = t;
    e.fleeX = fx;
    e.fleeZ = fz;
  }

  // ───────────── 한 틱 ─────────────
  step() {
    this.tick++;
    if (this.phase === 'count') {
      this.phaseT -= DT;
      if (this.phaseT <= 0) {
        this.phase = 'play';
        this.events.push({ t: 'go' });
      }
    } else if (this.phase === 'play') {
      this.timeLeft -= DT;
      if (this.timeLeft <= 0) this.endRound();
      // 데스매치: 플레이어가 한 명만 남으면 잠깐 뒤 끝 (혼자 하는 시험판은 제외)
      else if (this.finishT > 0) {
        if ((this.finishT -= DT) <= 0) this.endRound();
      } else if (this.slots.length >= 2 && this.alivePlayers <= 1) this.finishT = CFG.FINISH_DELAY;
    } else if (this.phase === 'end') {
      this.phaseT -= DT;
      if (this.phaseT <= 0 && this.opts.autoRestart) this.newRound();
    }
    this.simulate(DT);
  }

  simulate(dt) {
    const play = this.phase === 'play';
    if (this.phase !== 'count') this.time += dt;

    // 플레이어 입력 (사람: 받은 입력을 틱마다 하나씩, 봇: 생각)
    // 사람의 닭은 받은 입력 하나에 꼭 한 번만 움직인다. 입력이 늦게 와서 비면 기다리고(움직이지 않고),
    // 밀려 쌓이면 한 틱에 두 개를 처리해 따라잡는다. 그래야 휴대폰의 예측과 서버가 한 치도 어긋나지 않는다.
    for (const s of this.slots) {
      const e = this.ents.get(s.ent);
      if (!e || !e.alive) {
        // 잡힌 플레이어는 다시 태어나지 않는다 (관전)
        if (!s.bot) this.takeInputs(s, s.inputs.length);
        continue;
      }
      if (s.bot) {
        if (this.phase === 'count') continue; // 카운트다운 동안은 모두 멈춘다
        this.tickTimers(e, dt);
        this.apply(e, play ? s.bot.think(this, e, dt) : IDLE_INPUT, dt, play);
        continue;
      }
      const list = this.takeInputs(s, s.inputs.length > 2 ? 2 : 1);
      if (this.phase === 'count') continue;
      this.tickTimers(e, dt);
      for (const q of list) this.apply(e, play ? q : IDLE_INPUT, dt, play);
    }

    // AI 닭
    if (this.phase !== 'count') {
      for (const e of this.ents.values()) {
        if (e.slot || !e.alive) continue;
        this.tickTimers(e, dt);
        const inp = e.brain.think(this, e, dt);
        inp.run = false; // AI 닭은 절대 뛰지 않는다 (뛰는 건 플레이어뿐)
        this.apply(e, inp, dt, play);
      }
    }

    // 쓰러진 닭 치우기 (AI 도 플레이어도 다시 태어나지 않는다)
    for (const e of [...this.ents.values()]) {
      if (!e.alive && (e.deadT -= dt) <= 0) this.ents.delete(e.id);
    }
    this.updateSuspicion(dt);
  }

  // 받은 입력을 꺼낸다 (마지막으로 처리한 입력 번호를 ack 로 돌려준다)
  takeInputs(s, n) {
    const list = s.inputs.splice(0, n);
    if (list.length) s.ack = list.at(-1).seq;
    return list;
  }

  tickTimers(e, dt) {
    // 칼이 쭉 나가는 순간에 맞는다
    if (e.act === ACT.STAB && !e.struck && e.actT - dt <= CFG.STAB_TIME - CFG.STAB_HIT + 1e-6) {
      e.struck = true;
      this.strike(e);
    }
    // 동작 모양은 시간으로 끝낸다 (찌르기 멈춤 자체는 입력 수로 센다: 입력이 끊긴 사람도 칼을 내민 채 굳지 않게)
    if (e.actT > 0 && (e.actT -= dt) <= 0) e.act = ACT.NONE;
    e.cd = Math.max(0, e.cd - dt);
    e.panicT = Math.max(0, e.panicT - dt);
  }

  apply(e, inp, dt, play) {
    const a = inp.act;
    if (a === ACT.STAB) {
      if (play && e.slot && e.cd <= 0 && e.lockN <= 0) this.stab(e);
    } else if (a && !e.act) {
      e.act = a;
      e.actT = a === ACT.PECK ? CFG.PECK_TIME : CFG.FLAP_TIME;
      if (speedOf(e) > 0.8) e.sus += 0.5; // 걸으면서 쪼는 닭은 없다
    }
    // 찌르는 동안은 그 자리에 딱 멈춘다 (찌른 그 입력부터 STAB_TICKS 개)
    if (e.lockN > 0) {
      inp = HOLD_INPUT;
      if (--e.lockN <= 0 && e.act === ACT.STAB) e.act = ACT.NONE;
    }
    stepChicken(e, inp, dt);
  }

  // 찌르기 시작: 멈추고 칼을 젖힌다. 맞는 건 STAB_HIT 뒤 (strike)
  stab(e) {
    e.act = ACT.STAB;
    e.actT = CFG.STAB_TIME;
    e.lockN = STAB_TICKS;
    e.struck = false;
    e.sus += 4; // 칼을 휘두르는 건 플레이어뿐
  }

  // 칼끝: 앞쪽 부채꼴 안에서 가장 가까운 닭 하나
  strike(e) {
    const fx = Math.sin(e.yaw);
    const fz = Math.cos(e.yaw);
    let best = null;
    let bestScore = Infinity;
    for (const o of this.ents.values()) {
      if (o === e || !o.alive) continue;
      const dx = o.x - e.x;
      const dz = o.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > CFG.STAB_RANGE) continue;
      const ang = d < 0.05 ? 0 : Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d)));
      if (ang > CFG.STAB_ANGLE) continue;
      const score = d + ang * 0.6;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    if (best) this.kill(best, e);
  }

  kill(v, k) {
    v.alive = false;
    v.deadT = CFG.BODY_TIME;
    v.act = ACT.NONE;
    v.lockN = 0;
    v.vx = v.vz = 0;
    v.killer = k.id;
    const ks = k.slot;
    if (!v.slot) {
      // AI 를 찔렀다: 점수는 그대로, 아무 표시도 없다(다른 사람에게는 알리지 않는다). 칼만 조금 늦게 돌아온다
      ks.aiKills++;
      k.cd = CFG.PENALTY_CD;
      ks.inbox.push({ t: 'oops' });
    } else {
      const vs = v.slot;
      vs.deaths++;
      vs.deadAt = this.time;
      vs.bot && (vs.bot.target = null);
      ks.kills++;
      ks.score++;
      ks.inbox.push({ t: 'got', v: vs.name });
      vs.inbox.push({ t: 'dead', by: ks.name, kid: k.id });
      this.events.push({ t: 'feed', k: ks.name, v: vs.name });
    }
    this.boardDirty = true;
    // 근처 AI 닭은 놀라서 (걸어서) 달아나고, 봇도 대개 따라 걷는다 (찌른 닭이 섞여 빠져나갈 틈)
    for (const o of this.nearby(v, CFG.PANIC_RADIUS)) {
      if (o === k || (o.slot && (!o.slot.bot || this.rng() > 0.75))) continue;
      const fx = o.x - v.x;
      const fz = o.z - v.z;
      const l = Math.hypot(fx, fz) || 1;
      const a = Math.atan2(fx / l, fz / l) + (this.rng() - 0.5) * 1.0;
      this.panic(o, Math.sin(a), Math.cos(a), range(this.rng, 1.6, 3.2));
      if (!o.slot) o.act = ACT.NONE;
    }
  }

  // 의심 점수: 화면에서 누구나 볼 수 있는 행동으로만 쌓인다
  updateSuspicion(dt) {
    const decay = Math.exp(-0.2 * dt);
    for (const e of this.ents.values()) {
      if (!e.alive) continue;
      e.sus *= decay;
      const sp = speedOf(e);
      if (sp > 3.2) e.sus = Math.max(e.sus, 2.2) + 2.5 * dt; // 뛰는 건 플레이어뿐이다 (AI 는 뛰지 않는다)
      e.moveT = sp > 0.5 ? e.moveT + dt : 0;
      if (e.moveT > 8) e.sus += 0.5 * dt; // 쉬지 않고 걷는다
    }
  }

  // ───────────── 보내기 ─────────────
  animOf(e) {
    let code;
    if (!e.alive) code = ANIM.DEAD;
    else if (e.act === ACT.STAB) code = ANIM.STAB;
    else if (e.act === ACT.PECK) code = ANIM.PECK;
    else if (e.act === ACT.FLAP) code = ANIM.FLAP;
    else {
      const sp = speedOf(e);
      code = sp > 3.2 ? ANIM.RUN : sp > 0.25 ? ANIM.WALK : ANIM.IDLE;
    }
    return code;
  }

  entityList() {
    const ids = [...this.ents.keys()].sort((a, b) => a - b);
    const out = new Array(ids.length * 5);
    let i = 0;
    for (const id of ids) {
      const e = this.ents.get(id);
      out[i++] = id;
      out[i++] = Math.round(e.x * 100);
      out[i++] = Math.round(e.z * 100);
      out[i++] = Math.round(e.yaw * 100);
      out[i++] = this.animOf(e);
    }
    return out;
  }

  youOf(s) {
    const e = this.ents.get(s.ent);
    const y = { ack: s.ack, pid: s.pid };
    if (e && e.alive) {
      Object.assign(y, {
        id: e.id,
        x: e.x, z: e.z, yaw: e.yaw, vx: e.vx, vz: e.vz,
        cd: +e.cd.toFixed(2),
      });
    } else {
      y.id = null;
      y.body = e ? e.id : null; // 쓰러진 내 닭 (카메라가 비춘다)
      // 관전: 잡힌 사람에게만 살아 있는 플레이어의 닭을 알려 준다 [id, 이름, 잡은 수]
      y.spec = this.slots.filter((o) => this.isAlive(o)).map((o) => [o.ent, o.name, o.kills]);
    }
    return y;
  }

  // 구경꾼용 스냅샷 (메뉴 배경)
  spectate() {
    return { t: 's', k: this.tick, ph: this.phase, tl: 0, e: this.entityList(), y: { id: null } };
  }

  broadcast() {
    const e = this.entityList();
    const tl = this.phase === 'play' ? this.timeLeft : this.phaseT;
    const board = this.boardDirty || this.tick % 60 === 0 ? this.board() : null;
    const al = this.alivePlayers; // 남은 플레이어 수 (모두에게)
    this.boardDirty = false;
    for (const s of this.slots) {
      if (!s.session) continue;
      const msg = { t: 's', k: this.tick, ph: this.phase, tl: +tl.toFixed(2), al, e, y: this.youOf(s) };
      const ev = this.events.length || s.inbox.length ? [...this.events, ...s.inbox] : null;
      if (ev) msg.ev = ev;
      if (board) msg.b = board;
      s.session.send(msg);
    }
    this.events = [];
    for (const s of this.slots) s.inbox = [];
  }
}

// 이름: 앞뒤 공백 제거, 12자, 비었으면 "닭123". 같은 이름이 있으면 숫자를 붙인다.
export function cleanName(v, taken = new Set()) {
  let n = String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
  if (!n) n = `닭${Math.floor(Math.random() * 900 + 100)}`;
  let out = n;
  for (let i = 2; taken.has(out); i++) out = `${n.slice(0, 10)}${i}`;
  return out;
}
