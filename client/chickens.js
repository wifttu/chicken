// 닭 그리기: 사람처럼 두 발로 서서 팔(날개)로 칼을 쥔 닭. 모든 닭이 똑같은 모양이다.
// 부위마다 InstancedMesh 하나씩 (몸통+머리, 팔, 허벅지, 정강이+발, 칼, 그림자) → 드로우콜 6번.
//
// 뼈대 (로컬, 발밑이 원점, +z 가 앞):
//   뿌리(위치·방향) → 엉덩이(HIP) → 몸통(숙이기·비틀기) → 어깨 → 팔 → 손 → 칼
//                    └ 허벅지 → 무릎 → 정강이·발
import * as THREE from 'three';
import { ANIM } from './shared/config.js';
import { Builder, mat } from './geo.js';

export const COLORS = {
  body: 0xf4f2f9,
  shade: 0xe4e0ee,
  belly: 0xfbfaff,
  comb: 0xdc2a33,
  beak: 0xf6c12a,
  leg: 0xf2a22c,
  eye: 0xffffff,
  pupil: 0x1d1b24,
  blade: 0xd4dbe6,
  handle: 0x5b3a22,
};

const HIP = 0.62; // 엉덩이 높이
const SHOULDER = [0.31, 0.5, 0.0]; // 엉덩이 기준 어깨
const LEG_X = 0.15;
const KNEE = -0.3; // 허벅지 길이
const HEAD_TOP = 1.25; // 엉덩이 기준 머리 꼭대기

const sph = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);

// 몸통 + 목 + 머리 (엉덩이가 원점)
function torsoGeo() {
  const b = new Builder();
  b.add(sph(0.3, 14, 10), COLORS.body, mat(0, 0.08, -0.01, 0, 0, 0, 1.08, 0.85, 0.98)); // 배·엉덩이
  b.add(sph(0.3, 14, 10), COLORS.body, mat(0, 0.36, 0, 0, 0, 0, 1.0, 1.12, 0.9)); // 가슴
  b.add(sph(0.2, 10, 8), COLORS.belly, mat(0, 0.3, 0.16, 0, 0, 0, 1.05, 1.25, 0.6)); // 앞가슴 깃털
  b.add(sph(0.2, 12, 8), COLORS.body, mat(0, 0.62, 0.02)); // 목
  b.add(sph(0.27, 14, 10), COLORS.body, mat(0, 0.86, 0.04, 0, 0, 0, 0.95, 1.05, 0.95)); // 머리
  for (const s of [1, -1]) {
    b.add(sph(0.105, 12, 9), COLORS.eye, mat(0.125 * s, 0.93, 0.2)); // 큰 눈
    b.add(sph(0.048, 8, 6), COLORS.pupil, mat(0.14 * s, 0.935, 0.3));
  }
  b.add(new THREE.ConeGeometry(0.095, 0.28, 10), COLORS.beak, mat(0, 0.82, 0.36, Math.PI / 2 + 0.25)); // 부리
  b.add(sph(0.062, 8, 6), COLORS.comb, mat(0, 0.67, 0.27, 0, 0, 0, 1, 1.7, 0.8)); // 턱볏
  b.add(sph(0.08, 8, 6), COLORS.comb, mat(0, 1.12, 0.13, 0, 0, 0, 0.75, 1, 1)); // 볏
  b.add(sph(0.098, 8, 6), COLORS.comb, mat(0, 1.17, 0.02, 0, 0, 0, 0.75, 1.1, 1));
  b.add(sph(0.075, 8, 6), COLORS.comb, mat(0, 1.12, -0.09, 0, 0, 0, 0.75, 1, 1));
  // 꽁지깃
  b.add(sph(0.12, 8, 6), COLORS.body, mat(0, 0.2, -0.3, -0.9, 0, 0, 0.55, 1.4, 0.5));
  b.add(sph(0.1, 8, 6), COLORS.shade, mat(0.09, 0.16, -0.28, -0.75, 0, -0.4, 0.5, 1.3, 0.5));
  b.add(sph(0.1, 8, 6), COLORS.shade, mat(-0.09, 0.16, -0.28, -0.75, 0, 0.4, 0.5, 1.3, 0.5));
  return b.build();
}

// 팔: 어깨가 원점, 아래로 늘어진 날개팔 + 주먹
function armGeo() {
  const b = new Builder();
  b.add(sph(0.1, 10, 8), COLORS.shade, mat(0, -0.19, -0.01, 0, 0, 0, 0.85, 2.25, 1.05));
  b.add(sph(0.06, 8, 6), COLORS.body, mat(0, -0.35, -0.06, 0.3, 0, 0, 0.7, 1.5, 0.8)); // 깃털 끝
  b.add(sph(0.078, 10, 8), COLORS.belly, mat(0, -0.43, 0.025)); // 주먹
  b.add(sph(0.032, 6, 5), COLORS.belly, mat(0, -0.4, 0.09)); // 엄지
  return b.build();
}

// 허벅지: 엉덩이 관절이 원점
function thighGeo() {
  const b = new Builder();
  b.add(sph(0.125, 10, 8), COLORS.body, mat(0, -0.12, 0, 0, 0, 0, 1, 1.55, 1.05));
  b.add(new THREE.CylinderGeometry(0.05, 0.048, 0.12, 8), COLORS.leg, mat(0, -0.27, 0));
  return b.build();
}

// 정강이와 발: 무릎이 원점
function shinGeo() {
  const b = new Builder();
  b.add(new THREE.CylinderGeometry(0.047, 0.04, 0.28, 8), COLORS.leg, mat(0, -0.14, 0));
  b.add(sph(0.05, 8, 6), COLORS.leg, mat(0, -0.285, 0.01)); // 발목
  for (const a of [-0.5, 0, 0.5]) b.add(new THREE.BoxGeometry(0.045, 0.035, 0.2), COLORS.leg, mat(Math.sin(a) * 0.09, -0.3, 0.02 + Math.cos(a) * 0.09, 0, a));
  b.add(new THREE.BoxGeometry(0.04, 0.035, 0.1), COLORS.leg, mat(0, -0.3, -0.07));
  return b.build();
}

function knifeGeo() {
  // 손잡이가 원점, 칼날은 +z 쪽
  const b = new Builder();
  // 칼날의 넓은 면이 앞(정면)에서 보이도록 x 로 넓고 y 로 얇다
  b.add(new THREE.BoxGeometry(0.055, 0.05, 0.15), COLORS.handle, mat(0, 0, 0));
  b.add(new THREE.BoxGeometry(0.12, 0.045, 0.03), 0x8a8f99, mat(0, 0, 0.085)); // 날밑
  b.add(new THREE.BoxGeometry(0.085, 0.018, 0.32), COLORS.blade, mat(0.008, 0, 0.26));
  b.add(new THREE.BoxGeometry(0.02, 0.02, 0.32), 0xf4f7fb, mat(0.045, 0, 0.26)); // 날 끝 반짝
  b.add(new THREE.ConeGeometry(0.06, 0.11, 4), COLORS.blade, mat(0.008, 0, 0.47, Math.PI / 2, 0, Math.PI / 4, 1, 1, 0.3));
  return b.build();
}

const _root = new THREE.Matrix4();
const _torso = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _k = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const ONE = new THREE.Vector3(1, 1, 1);

// out = parent × (위치 · 회전 XYZ)
function local(out, parent, x, y, z, rx, ry, rz) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _tmp.compose(_v, _q, ONE);
  return out.multiplyMatrices(parent, _tmp);
}

const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export class ChickenView {
  constructor(scene, max = 96) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2c2a3a });
    const make = (geo, n) => {
      const m = new THREE.InstancedMesh(geo, material, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.torso = make(torsoGeo(), max);
    this.arms = make(armGeo(), max * 2);
    this.thighs = make(thighGeo(), max * 2);
    this.shins = make(shinGeo(), max * 2);
    this.knives = make(knifeGeo(), max);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x2a2440, transparent: true, opacity: 0.28, depthWrite: false });
    this.shadows = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), shadowMat, max);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
    scene.add(this.shadows);
    this.max = max;
    this.n = 0;
    this.head = new THREE.Vector3();
  }

  begin() {
    this.n = 0;
  }

  // c: { x, z, yaw, anim, at(동작 경과 초), phase(걸음 위상), seed, deadAt(쓰러진 뒤 경과 초) }
  // 돌려주는 값: 머리 위 위치 (표시용)
  draw(c) {
    if (this.n >= this.max) return null;
    const i = this.n++;
    const a = c.anim;
    const t = c.at || 0;
    const ph = c.phase || 0;
    const sw = Math.sin(ph);
    const cw = Math.cos(ph);
    const seed = c.seed || 0;

    // 자세 값
    let bob = 0; // 몸 위아래
    let lean = 0; // 몸통 앞으로 숙이기
    let twist = 0; // 몸통 비틀기
    let roll = 0; // 뒤뚱
    let thighL = 0;
    let thighR = 0;
    let kneeL = 0;
    let kneeR = 0;
    let legOut = 0; // 다리 벌리기
    let armL = 0; // 팔 앞뒤 (+ 뒤로)
    let armR = 0;
    let armOutL = 0.12; // 팔 옆으로 벌리기
    let armOutR = 0.12;
    let knifeA = 0.75; // 칼 각도 (손 기준, 0.75 = 앞아래, 1.5 = 팔 따라 곧게)
    let lift = 0; // 점프
    let deadA = 0;

    if (a === ANIM.WALK || a === ANIM.RUN) {
      const run = a === ANIM.RUN;
      const A = run ? 0.95 : 0.55;
      const B = run ? 1.3 : 0.7;
      const C = run ? 0.95 : 0.45;
      thighL = -sw * A;
      thighR = sw * A;
      kneeL = Math.max(0, cw) * B;
      kneeR = Math.max(0, -cw) * B;
      armL = sw * C;
      armR = -sw * C;
      bob = Math.abs(cw) * (run ? 0.07 : 0.04) - (run ? 0.05 : 0.01);
      roll = sw * (run ? 0.04 : 0.07);
      lean = run ? 0.28 : 0.04;
      if (run) armOutL = armOutR = 0.3;
    } else if (a === ANIM.PECK) {
      // 허리를 굽혀 땅을 두 번 쫀다
      const u = (t / 0.7) * 2;
      const k = u >= 2 ? 0 : Math.pow(Math.max(0, Math.sin(Math.PI * (u % 1))), 0.6);
      lean = 1.15 * k;
      kneeL = kneeR = 0.35 * k;
      thighL = thighR = -0.2 * k;
      bob = -0.05 * k;
      armL = armR = -0.35 * k;
      armOutL = armOutR = 0.25 * k + 0.12;
    } else if (a === ANIM.FLAP) {
      // 팔을 날개처럼 퍼덕이며 살짝 뛴다
      const u = Math.min(1, t / 0.9);
      const env = Math.sin(Math.PI * u);
      const f = Math.abs(Math.sin(t * 24));
      armOutL = armOutR = 0.25 + (0.6 + 1.0 * f) * env;
      lift = env * 0.25;
      kneeL = kneeR = (1 - env) * 0.2;
      lean = -0.08;
    } else if (a === ANIM.STAB) {
      // 칼 든 오른팔: 뒤로 젖혔다가 앞으로 쭉 찌르기
      const u = Math.min(1, t / 0.35);
      if (u < 0.3) armR = 0.6 * ease(u / 0.3);
      else if (u < 0.55) armR = 0.6 - 2.2 * ease((u - 0.3) / 0.25);
      else armR = -1.6 * (1 - ease((u - 0.55) / 0.45));
      const k = Math.max(0, -armR / 1.6);
      knifeA = 0.75 + 0.75 * k;
      lean = 0.2 * k;
      twist = -0.35 * k;
      thighL = -0.35 * k;
      kneeR = 0.3 * k;
      armL = 0.4 * k;
    } else if (a === ANIM.DEAD) {
      // 뒤로 벌러덩, 팔다리는 하늘로
      const d = c.deadAt || 0;
      deadA = ease(Math.min(1, d / 0.3)) * 1.52;
      if (d < 0.3) lift = Math.sin((d / 0.3) * Math.PI) * 0.3;
      const twitch = Math.sin(performance.now() / 85 + seed) * 0.15 * Math.max(0, 1 - d / 1.6);
      const k = Math.min(1, d / 0.3);
      thighL = (-1.25 + twitch) * k;
      thighR = (-1.25 - twitch) * k;
      legOut = 0.35 * k;
      armOutL = armOutR = 0.12 + 1.25 * k;
      armL = armR = -0.4 * k;
      roll = ((seed % 7) / 7 - 0.5) * 0.5;
    } else {
      // 가만히: 숨쉬기, 팔 살랑
      const br = Math.sin(performance.now() / 420 + seed);
      bob = br * 0.01;
      armL = armR = br * 0.04;
    }

    // 뿌리: 발밑, 방향
    _e.set(0, c.yaw, 0);
    _q.setFromEuler(_e);
    _v.set(c.x, lift, c.z);
    _root.compose(_v, _q, ONE);
    if (deadA) {
      // 등이 땅에 닿도록 0.3 높이를 축으로 뒤로 넘어간다
      local(_root, _root, 0, 0.3, 0, -deadA, 0, roll);
      _root.multiply(_tmp.makeTranslation(0, -0.3, 0));
      roll = 0;
    }

    // 몸통 (엉덩이 기준)
    local(_torso, _root, 0, HIP + bob, 0, lean, twist, roll);
    this.torso.setMatrixAt(i, _torso);

    // 팔 (왼쪽 +x, 오른쪽 -x: 오른손에 칼)
    const ai = i * 2;
    local(_m, _torso, SHOULDER[0], SHOULDER[1], SHOULDER[2], armL, 0, armOutL);
    this.arms.setMatrixAt(ai, _m);
    local(_m, _torso, -SHOULDER[0], SHOULDER[1], SHOULDER[2], armR, 0, -armOutR);
    this.arms.setMatrixAt(ai + 1, _m);
    local(_k, _m, 0, -0.43, 0.03, knifeA, 0, 0);
    this.knives.setMatrixAt(i, _k);

    // 다리: 허벅지는 뿌리(엉덩이 높이)에, 정강이는 무릎에
    const hipY = HIP + bob * 0.5;
    local(_m, _root, LEG_X, hipY, 0, thighL, 0, legOut);
    this.thighs.setMatrixAt(ai, _m);
    local(_k, _m, 0, KNEE, 0, kneeL, 0, 0);
    this.shins.setMatrixAt(ai, _k);
    local(_m, _root, -LEG_X, hipY, 0, thighR, 0, -legOut);
    this.thighs.setMatrixAt(ai + 1, _m);
    local(_k, _m, 0, KNEE, 0, kneeR, 0, 0);
    this.shins.setMatrixAt(ai + 1, _k);

    // 그림자
    const ss = (deadA ? 1.3 : 1) * (1 - lift * 0.8);
    _e.set(0, c.yaw, 0);
    _q.setFromEuler(_e);
    // 쓰러지면 몸이 뒤쪽으로 길게 눕는다
    const back = deadA ? 0.65 * (deadA / 1.52) : 0;
    _v.set(c.x - Math.sin(c.yaw) * back, 0.03, c.z - Math.cos(c.yaw) * back);
    _s.set(ss, 1, ss * (deadA ? 2.1 : 1.05));
    this.shadows.setMatrixAt(i, _m.compose(_v, _q, _s));

    if (deadA) this.head.set(c.x, 1.1, c.z);
    else this.head.set(0, HEAD_TOP, 0).applyMatrix4(_torso);
    return this.head;
  }

  end() {
    const n = this.n;
    for (const [m, k] of [[this.torso, 1], [this.arms, 2], [this.thighs, 2], [this.shins, 2], [this.knives, 1], [this.shadows, 1]]) {
      m.count = n * k;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
