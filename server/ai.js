// AI 닭의 행동: 걷다 멈추고, 두리번거리고, 땅을 쪼고, 가끔 퍼덕인다. AI 닭은 절대 뛰지 않는다(뛰는 건 플레이어뿐).
// 근처에서 닭이 잡히면 놀라 걸어서 달아난다. 출력은 사람의 입력과 같은 꼴이라 같은 이동 코드로 움직인다.
import { ACT, CFG } from '../shared/config.js';
import { clearPath, HALF } from '../shared/map.js';
import { range } from '../shared/rng.js';

export class AiBrain {
  constructor(rng) {
    this.rng = rng;
    this.state = 'idle';
    this.t = range(rng, 0.2, 3.5);
    this.dest = null;
    this.face = null;
    this.walkT = 0;
  }

  // 다음 목적지: 가까운 닭 곁(무리 짓기) 또는 아무 방향으로 3~11m
  pickDest(game, ent) {
    const rng = this.rng;
    if (rng() < 0.35) {
      const near = game.nearby(ent, 12);
      if (near.length) {
        const o = near[Math.floor(rng() * near.length)];
        const a = rng() * Math.PI * 2;
        const x = o.x + Math.sin(a) * range(rng, 1.2, 2.5);
        const z = o.z + Math.cos(a) * range(rng, 1.2, 2.5);
        if (clearPath(ent.x, ent.z, x, z)) return { x, z };
      }
    }
    for (let i = 0; i < 10; i++) {
      // 바라보는 쪽을 조금 더 자주 고른다 (빙글빙글 돌지 않게)
      const a = ent.yaw + (rng() - 0.5) * (i < 4 ? 2.4 : Math.PI * 2);
      const d = range(rng, 3, 11);
      const x = ent.x + Math.sin(a) * d;
      const z = ent.z + Math.cos(a) * d;
      if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) continue;
      if (clearPath(ent.x, ent.z, x, z)) return { x, z };
    }
    return null;
  }

  // 놀라서 달아나기: 정해진 방향으로 걷다가 막히면 옆으로 꺾는다
  flee(ent, out) {
    let a = Math.atan2(ent.fleeX, ent.fleeZ);
    for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.2, -2.2]) {
      const b = a + turn;
      if (clearPath(ent.x, ent.z, ent.x + Math.sin(b) * 1.6, ent.z + Math.cos(b) * 1.6)) {
        a = b;
        break;
      }
    }
    ent.fleeX = Math.sin(a);
    ent.fleeZ = Math.cos(a);
    out.dx = ent.fleeX;
    out.dz = ent.fleeZ;
    this.state = 'idle';
    this.t = range(this.rng, 0.6, 2.2); // 멈춘 뒤 잠깐 가만히
    this.face = null;
    return out;
  }

  think(game, ent, dt) {
    const rng = this.rng;
    const out = { dx: 0, dz: 0, run: false, face: null, act: ACT.NONE };
    if (ent.panicT > 0) return this.flee(ent, out);
    this.t -= dt;

    if (this.state === 'idle') {
      if (!ent.act) {
        // 가만히 있는 동안: 땅 쪼기, 두리번, 가끔 퍼덕
        if (rng() < 0.55 * dt) out.act = ACT.PECK;
        else if (rng() < 0.035 * dt) out.act = ACT.FLAP;
        else if (rng() < 0.4 * dt) this.face = ent.yaw + (rng() - 0.5) * 2.6;
      }
      out.face = this.face;
      if (this.t <= 0) {
        const r = rng();
        if (r < 0.12) {
          this.t = range(rng, 0.6, 2.5); // 조금 더 쉰다
        } else {
          this.dest = this.pickDest(game, ent);
          if (this.dest) {
            this.state = 'walk';
            this.walkT = 0;
            this.face = null;
          } else this.t = range(rng, 0.5, 1.5);
        }
      }
      return out;
    }

    // 걷기
    const dx = this.dest.x - ent.x;
    const dz = this.dest.z - ent.z;
    const d = Math.hypot(dx, dz);
    this.walkT += dt;
    if (d < 0.45 || this.walkT > d / CFG.WALK + 3 + 0.5) {
      this.state = 'idle';
      this.t = range(rng, 0.8, 4.5);
      return out;
    }
    out.dx = dx / d;
    out.dz = dz / d;
    return out;
  }
}
