// 봇 플레이어: 평소에는 AI 닭처럼 연기하다가, 수상한 닭을 골라 슬금슬금 다가가 찌른다.
// 봇은 정답(누가 사람인지)을 거의 모른다. 화면에서 보이는 행동(찌르기, 뛰기, 쉬지 않고 걷기)으로
// 쌓인 의심 점수를 보고 고르기 때문에 AI 를 잘못 찌르기도 한다.
import { ACT, CFG, wrapAngle } from '../shared/config.js';
import { clearPath } from '../shared/map.js';
import { range } from '../shared/rng.js';
import { AiBrain } from './ai.js';

const NAMES = [
  '깃털공주', '부리부리', '닭강정', '계란말이', '꼬끼오', '병아리반장', '치킨너겟', '볏돌이', '달걀프라이', '노른자',
  '암탉여사', '수탉형님', '털뭉치', '모이도둑', '닭발', '꼬꼬몽', 'peckpeck', 'eggroll', 'chick_99', 'nugget',
  'featherz', 'clucky', 'yolk', 'henry',
];

export function botName(rng, taken) {
  const free = NAMES.filter((n) => !taken.has(n));
  if (free.length) return free[Math.floor(rng() * free.length)];
  return `닭${Math.floor(rng() * 900 + 100)}`;
}

export class BotBrain {
  constructor(rng) {
    this.rng = rng;
    this.ai = new AiBrain(rng);
    this.skill = range(rng, 0.2, 0.55); // 사람 냄새를 맡는 감 (높을수록 정답을 잘 고른다)
    this.target = null;
    this.pickT = range(rng, 2, 5);
    this.lastTry = 0; // 마지막으로 찌르려 한 게임 시각
    this.gait = 'walk';
    this.gaitT = range(rng, 1, 2.5);
    this.aim = null;
  }

  onSpawn(game) {
    this.target = null;
    this.lastTry = game.time;
    this.pickT = range(this.rng, 3, 6);
    this.ai = new AiBrain(this.rng);
  }

  // 의심 점수 + 운 + (가끔) 감으로 노릴 닭을 고른다. 오래 못 찔렀으면 기준을 낮춰 아무나 노린다.
  pickTarget(game, ent) {
    const rng = this.rng;
    const wait = game.time - this.lastTry;
    let bestW = Math.max(0.3, 2.4 - wait / 12);
    let best = null;
    for (const o of game.nearby(ent, 16)) {
      let w = o.sus + rng() * 0.9 - Math.hypot(o.x - ent.x, o.z - ent.z) * 0.03;
      if (o.slot && rng() < this.skill * 0.5) w += 1.2;
      if (w > bestW) {
        bestW = w;
        best = o;
      }
    }
    return best ? best.id : null;
  }

  think(game, ent, dt) {
    const rng = this.rng;
    // 놀람(근처에서 누가 잡힘)·찌른 뒤 빠져나가기는 AI 와 똑같이 걷는다. 뛰면 플레이어인 게 들키니까.
    if (ent.panicT > 0) return this.ai.think(game, ent, dt);

    this.pickT -= dt;
    if (this.pickT <= 0) {
      this.pickT = range(rng, 2, 4.5);
      const t = this.pickTarget(game, ent);
      if (t !== null) this.target = t;
    }
    const tg = this.target !== null ? game.ents.get(this.target) : null;
    if (!tg || !tg.alive) {
      this.target = null;
      return this.ai.think(game, ent, dt);
    }
    const dx = tg.x - ent.x;
    const dz = tg.z - ent.z;
    const d = Math.hypot(dx, dz);
    if (d > 18) {
      this.target = null;
      return this.ai.think(game, ent, dt);
    }
    const out = { dx: 0, dz: 0, run: false, face: null, act: ACT.NONE };
    const ang = Math.atan2(dx, dz);
    if (d < CFG.STAB_RANGE - 0.2) {
      // 닿는 거리: 돌아서서 찌른다
      out.face = ang;
      if (Math.abs(wrapAngle(ang - ent.yaw)) < 0.45 && ent.cd <= 0 && ent.lockN <= 0) {
        out.act = ACT.STAB;
        this.target = null;
        this.lastTry = game.time;
        // 찌르는 동안 멈춰 있다가, 끝나면 놀란 AI 들 사이에 섞여 걸어서 빠져나간다
        const a = ang + Math.PI + (rng() - 0.5) * 1.6;
        game.panic(ent, Math.sin(a), Math.cos(a), CFG.STAB_TIME + range(rng, 1.2, 2.2));
      }
      return out;
    }
    if (d < 3.2) {
      // 마지막 접근은 멈추지 않고 곧장
      out.dx = dx / d;
      out.dz = dz / d;
      return out;
    }
    // 멀리서는 걷다 멈추다를 섞어 AI 처럼 다가간다
    this.gaitT -= dt;
    if (this.gaitT <= 0) {
      if (this.gait === 'walk') {
        this.gait = 'pause';
        this.gaitT = range(rng, 0.4, 1.5);
      } else {
        this.gait = 'walk';
        this.gaitT = range(rng, 1.2, 3.2);
        const a = rng() * Math.PI * 2;
        this.aim = { ox: Math.sin(a) * 1.2, oz: Math.cos(a) * 1.2 };
      }
    }
    if (this.gait === 'pause') {
      if (!ent.act && rng() < 0.5 * dt) out.act = ACT.PECK;
      return out;
    }
    const ax = tg.x + (this.aim?.ox || 0) - ent.x;
    const az = tg.z + (this.aim?.oz || 0) - ent.z;
    const al = Math.hypot(ax, az) || 1;
    if (!clearPath(ent.x, ent.z, ent.x + (ax / al) * 1.5, ent.z + (az / al) * 1.5)) {
      // 막혔으면 일단 AI 처럼 움직인다 (길찾기 대신)
      return this.ai.think(game, ent, dt);
    }
    out.dx = ax / al;
    out.dz = az / al;
    return out;
  }
}
