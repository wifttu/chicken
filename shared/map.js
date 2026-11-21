// 맵 "꼬꼬 마을": 서버(충돌·AI 길찾기)와 클라이언트(그리기)가 같은 데이터를 쓴다.
// 좌표: x 오른쪽, z 앞쪽(남쪽). 바라보는 방향 yaw 의 전방 벡터는 (sin yaw, cos yaw).
import { CFG } from './config.js';

export const HALF = 29; // 울타리 안쪽 반 크기 (닭이 갈 수 있는 곳 -29..29)
export const MAP_SIZE = 64; // 바닥 그림이 덮는 크기

// 사각형 장애물: 가운데 x,z, 너비 w(x), 깊이 d(z), 높이 h. door: 문이 난 쪽
// 원형 장애물: 가운데 x,z, 반지름 r, 높이 h
const box = (kind, x, z, w, d, h, extra = {}) => ({ shape: 'box', kind, x, z, w, d, h, ...extra });
const circ = (kind, x, z, r, h, extra = {}) => ({ shape: 'circle', kind, x, z, r, h, ...extra });

export const OBSTACLES = [
  // 북쪽: 큰 헛간, 사일로, 건초 더미, 풍차
  box('barn', 0, -21, 12, 8, 7, { door: '+z' }),
  circ('silo', 8.8, -22, 2.0, 9),
  circ('hay', -7.5, -15.6, 0.8, 1.1),
  circ('hay', -8.9, -14.1, 0.8, 1.1),
  circ('hay', -6.2, -13.9, 0.8, 1.1),
  circ('hay', 10.4, -16.4, 0.8, 1.1),
  circ('windmill', 21, -20, 2.4, 11),
  box('house', -20, -19, 7, 6, 4.6, { door: '+z', roof: 0x3f8f8a }),

  // 가운데 장터: 우물과 노점
  circ('well', 2, 0, 1.15, 2.8),
  box('stall', -3.5, -5, 3.2, 1.3, 1.0, { awning: 0x4f9d5d, face: '+z' }),
  box('stall', 8.2, -4.5, 3.2, 1.3, 1.0, { awning: 0xe0a32e, face: '+z' }),
  box('stall', 8.6, 5.2, 3.2, 1.3, 1.0, { awning: 0x4673c4, face: '-z' }),
  circ('crate', -6, -5.2, 0.42, 0.8),
  circ('crate', 10.9, -4.6, 0.42, 0.8),
  circ('barrel', 11.2, 5.4, 0.4, 0.9),
  circ('barrel', 5.6, 5.8, 0.4, 0.9),

  // 서쪽: 연못, 닭장
  circ('pond', -15, 3, 4.2, 0),
  circ('pond', -18.5, 6.8, 3.0, 0),
  circ('pond', -12.2, 7.2, 2.4, 0),
  box('coop', -25.2, -6, 2.8, 2.6, 2.4, { door: '+x' }),

  // 동쪽: 집, 닭장, 텃밭(울타리, 남쪽에 입구)
  box('house', 21.5, -6, 6, 7, 4.6, { door: '-x', roof: 0xc8643b }),
  box('coop', 25.2, 6, 2.8, 2.6, 2.4, { door: '-x' }),
  box('fence', 15, 9.5, 8.2, 0.25, 1.0),
  box('fence', 12.1, 16.5, 2.4, 0.25, 1.0),
  box('fence', 17.9, 16.5, 2.4, 0.25, 1.0),
  box('fence', 11, 13, 0.25, 7.2, 1.0),
  box('fence', 19, 13, 0.25, 7.2, 1.0),
  circ('scarecrow', 15, 13, 0.3, 2.4),

  // 남쪽: 집 두 채, 닭장, 수레, 건초
  box('house', -19, 20, 7, 6, 4.6, { door: '-z', roof: 0x9a4a6b }),
  box('house', 19.5, 22, 6, 6, 4.6, { door: '-z', roof: 0x5a6fb0 }),
  box('coop', 0, 25.6, 2.8, 2.6, 2.4, { door: '-z' }),
  box('cart', -6.5, 15, 1.7, 2.9, 1.5),
  circ('hay', 6.5, 18.5, 0.8, 1.1),
  circ('hay', 7.9, 19.7, 0.8, 1.1),

  // 나무 (줄기만 부딪힌다)
  ...[
    [-26.5, -26.5], [-13, -26.5], [14.5, -27], [27, -13.5], [27.5, 13], [-27.5, 13.5], [-26.5, 26.5], [9.5, 27.5],
    [-10, 26.5], [27, 27], [-12.5, -11.5], [13.5, -12.5], [-5.5, 9], [15.5, 0.5], [-24.5, -16], [26.5, -1],
    [-2, -27.5], [-27.5, 1], [3.5, 12.5], [-14, 14.5],
  ].map(([x, z], i) => circ('tree', x, z, 0.45, 6, { v: i })),
];

// 문 앞: 새 닭이 걸어 나오는 곳 (AI 와 플레이어 모두 여기서 태어난다)
export const SPAWNS = (() => {
  const out = [];
  const yawOf = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };
  for (const o of OBSTACLES) {
    if (o.shape !== 'box' || !o.door) continue;
    const yaw = yawOf[o.door];
    const reach = (o.door.endsWith('z') ? o.d : o.w) / 2 + 0.7;
    out.push({ x: o.x + Math.sin(yaw) * reach, z: o.z + Math.cos(yaw) * reach, yaw, kind: o.kind });
  }
  return out;
})();

// 흙길 (바닥 그림용): [폭, 점들]
export const PATHS = [
  [3.2, [[0, -16.5], [1, -9], [2, -6]]],
  [2.2, [[-20, -15.6], [-14, -11], [-6, -6.5], [-3, -3]]],
  [2.2, [[18.2, -6], [13, -3], [8, -1.5]]],
  [2.2, [[-22.6, -6], [-17, -4], [-8, -2.5], [-4, -1]]],
  [2.2, [[22.6, 6], [17, 6.5], [12, 3], [8, 2]]],
  [2.4, [[0, 23], [0.5, 17], [1.5, 9], [2, 6]]],
  [2.2, [[-19, 16.5], [-12, 13], [-5, 8], [-2, 4.5]]],
  [2.2, [[19.5, 18.5], [15, 17.5], [10, 12], [6, 5]]],
  [1.8, [[21, -17], [17, -13], [9, -7]]],
];
export const PLAZA = { x: 2, z: 0, r: 7.5 };

// 원 c(x,z) 반지름 r 을 장애물과 맵 밖에서 밀어낸다. 밀었으면 true.
export function pushOut(c, r = CFG.RADIUS) {
  let hit = false;
  const lim = HALF - r;
  if (c.x < -lim) (c.x = -lim), (hit = true);
  if (c.x > lim) (c.x = lim), (hit = true);
  if (c.z < -lim) (c.z = -lim), (hit = true);
  if (c.z > lim) (c.z = lim), (hit = true);
  for (const o of OBSTACLES) {
    if (o.shape === 'circle') {
      const dx = c.x - o.x;
      const dz = c.z - o.z;
      const R = o.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1e-6;
      c.x = o.x + (dx / d) * R;
      c.z = o.z + (dz / d) * R;
      hit = true;
    } else {
      const hw = o.w / 2;
      const hd = o.d / 2;
      const px = Math.max(o.x - hw, Math.min(o.x + hw, c.x));
      const pz = Math.max(o.z - hd, Math.min(o.z + hd, c.z));
      const dx = c.x - px;
      const dz = c.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        c.x = px + (dx / d) * r;
        c.z = pz + (dz / d) * r;
      } else {
        // 가운데가 상자 안: 가장 가까운 면으로 밀어낸다
        const ex = hw + r - Math.abs(c.x - o.x);
        const ez = hd + r - Math.abs(c.z - o.z);
        if (ex < ez) c.x = o.x + Math.sign(c.x - o.x || 1) * (hw + r);
        else c.z = o.z + Math.sign(c.z - o.z || 1) * (hd + r);
      }
      hit = true;
    }
  }
  return hit;
}

// 점 (x,z) 에 반지름 r 인 몸이 들어갈 수 없으면 true. minH 보다 낮은 장애물은 무시한다 (카메라용).
export function blocked(x, z, r = CFG.RADIUS, minH = -1) {
  if (Math.abs(x) > HALF - r || Math.abs(z) > HALF - r) return minH < 0;
  for (const o of OBSTACLES) {
    if (o.h <= minH) continue;
    if (o.shape === 'circle') {
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz < (o.r + r) ** 2) return true;
    } else if (Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r) return true;
  }
  return false;
}

// 두 점 사이를 몸이 막힘 없이 지나갈 수 있으면 true
export function clearPath(x0, z0, x1, z1, r = CFG.RADIUS) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.ceil(len / 0.4));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, r)) return false;
  }
  return true;
}

// 빈 곳 아무 데나
export function randomOpen(rng, r = 0.6) {
  for (let i = 0; i < 200; i++) {
    const x = (rng() * 2 - 1) * (HALF - 1);
    const z = (rng() * 2 - 1) * (HALF - 1);
    if (!blocked(x, z, r)) return { x, z };
  }
  return { x: PLAZA.x + 4, z: PLAZA.z + 4 };
}
