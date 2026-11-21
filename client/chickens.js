// 닭 그리기: 모든 닭이 똑같은 모양이다. 부위마다 InstancedMesh 하나씩 (몸통, 날개, 다리, 칼, 그림자) → 드로우콜 5번.
import * as THREE from 'three';
import { ANIM } from './shared/config.js';
import { Builder, mat } from './geo.js';

export const COLORS = {
  body: 0xf3f1f8,
  shade: 0xe6e3ef,
  comb: 0xd92a32,
  beak: 0xf4bf2a,
  leg: 0xf0a52c,
  eye: 0xffffff,
  pupil: 0x1d1b24,
  blade: 0xd4dbe6,
  handle: 0x5b3a22,
};

const sph = (r, w = 12, h = 9) => new THREE.SphereGeometry(r, w, h);

function bodyGeo() {
  const b = new Builder();
  b.add(sph(0.37, 14, 10), COLORS.body, mat(0, 0.62, -0.03, 0, 0, 0, 1, 1.08, 1.15)); // 몸통
  b.add(sph(0.27, 12, 9), COLORS.body, mat(0, 0.9, 0.08)); // 가슴·목
  b.add(sph(0.235, 12, 9), COLORS.body, mat(0, 1.12, 0.12)); // 머리
  for (const s of [1, -1]) {
    b.add(sph(0.098, 10, 8), COLORS.eye, mat(0.115 * s, 1.17, 0.27)); // 큰 눈
    b.add(sph(0.045, 8, 6), COLORS.pupil, mat(0.13 * s, 1.175, 0.36));
  }
  b.add(new THREE.ConeGeometry(0.08, 0.22, 8), COLORS.beak, mat(0, 1.08, 0.41, Math.PI / 2)); // 부리
  b.add(sph(0.055, 8, 6), COLORS.comb, mat(0, 0.97, 0.36, 0, 0, 0, 1, 1.7, 1)); // 턱볏
  b.add(sph(0.085, 8, 6), COLORS.comb, mat(0, 1.36, 0.17, 0, 0, 0, 0.8, 1, 1)); // 볏
  b.add(sph(0.1, 8, 6), COLORS.comb, mat(0, 1.39, 0.06, 0, 0, 0, 0.8, 1.1, 1));
  b.add(sph(0.08, 8, 6), COLORS.comb, mat(0, 1.34, -0.04, 0, 0, 0, 0.8, 1, 1));
  // 꽁지깃
  b.add(sph(0.12, 8, 6), COLORS.body, mat(0, 0.86, -0.42, -0.75, 0, 0, 0.55, 1.3, 0.55));
  b.add(sph(0.1, 8, 6), COLORS.body, mat(0.08, 0.82, -0.41, -0.6, 0, -0.35, 0.5, 1.2, 0.55));
  b.add(sph(0.1, 8, 6), COLORS.body, mat(-0.08, 0.82, -0.41, -0.6, 0, 0.35, 0.5, 1.2, 0.55));
  return b.build();
}

function wingGeo() {
  // 어깨(원점)에 매달려 아래로 늘어진 날개
  return new Builder().add(sph(0.2, 10, 8), COLORS.shade, mat(0, -0.17, -0.02, 0, 0, 0, 0.42, 1.05, 1.3)).build();
}

function legGeo() {
  const b = new Builder();
  b.add(sph(0.1, 8, 6), COLORS.body, mat(0, -0.03, 0)); // 허벅지 깃털
  b.add(new THREE.CylinderGeometry(0.034, 0.03, 0.3, 6), COLORS.leg, mat(0, -0.2, 0));
  for (const a of [-0.45, 0, 0.45]) b.add(new THREE.BoxGeometry(0.035, 0.025, 0.16), COLORS.leg, mat(Math.sin(a) * 0.07, -0.35, Math.cos(a) * 0.07, 0, a));
  b.add(new THREE.BoxGeometry(0.03, 0.025, 0.09), COLORS.leg, mat(0, -0.35, -0.05));
  return b.build();
}

function knifeGeo() {
  // 손잡이가 원점, 칼날은 +z 쪽
  const b = new Builder();
  b.add(new THREE.BoxGeometry(0.045, 0.055, 0.13), COLORS.handle, mat(0, 0, 0.02));
  b.add(new THREE.BoxGeometry(0.07, 0.075, 0.02), 0x8a8f99, mat(0, 0, 0.09)); // 날밑
  const blade = new THREE.BoxGeometry(0.016, 0.07, 0.28);
  b.add(blade, COLORS.blade, mat(0, 0.008, 0.24));
  b.add(new THREE.ConeGeometry(0.036, 0.08, 4), COLORS.blade, mat(0, 0.008, 0.41, Math.PI / 2, 0, Math.PI / 4, 0.45, 1, 1));
  return b.build();
}

const _root = new THREE.Matrix4();
const _tmp = new THREE.Matrix4();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const ONE = new THREE.Vector3(1, 1, 1);

// 부분 행렬: 부모 × (위치 · 회전 XYZ)
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
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2c2a3a });
    const make = (geo, n) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
      return m;
    };
    this.body = make(bodyGeo(), max);
    this.wings = make(wingGeo(), max * 2);
    this.legs = make(legGeo(), max * 2);
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

  // c: { x, z, yaw, anim, at(동작 경과 초), phase(걸음 위상), speed, seed, deadAt(쓰러진 뒤 경과 초), scale }
  // 돌려주는 값: 머리 위 위치 (표시용)
  draw(c) {
    if (this.n >= this.max) return null;
    const i = this.n++;
    const a = c.anim;
    const t = c.at || 0;
    const sc = c.scale ?? 1;
    let bob = 0;
    let pitch = 0;
    let roll = 0;
    let legA = 0;
    let wingOut = 0.08;
    let wingFwd = 0;
    let stabFwd = 0;
    let lift = 0;
    let legDead = 0;
    let deadA = 0;
    const sw = Math.sin(c.phase || 0);

    if (a === ANIM.WALK || a === ANIM.RUN) {
      const run = a === ANIM.RUN;
      legA = sw * (run ? 0.95 : 0.6);
      bob = Math.abs(Math.cos(c.phase || 0)) * (run ? 0.09 : 0.05);
      roll = sw * (run ? 0.05 : 0.08);
      pitch = run ? 0.22 : 0.05;
      if (run) wingOut = 0.45 + Math.abs(Math.sin((c.phase || 0) * 2)) * 0.5;
    } else if (a === ANIM.PECK) {
      const u = (t / 0.7) * 2;
      const k = u >= 2 ? 0 : Math.sin(Math.PI * (u % 1));
      pitch = 0.95 * Math.pow(Math.max(0, k), 0.6);
    } else if (a === ANIM.FLAP) {
      const u = Math.min(1, t / 0.9);
      wingOut = 0.35 + Math.abs(Math.sin(t * 26)) * 1.15 * Math.sin(Math.PI * u);
      lift = Math.sin(Math.PI * u) * 0.22;
      pitch = -0.08;
    } else if (a === ANIM.STAB) {
      const u = Math.min(1, t / 0.35);
      const k = u < 0.35 ? ease(u / 0.35) : 1 - ease((u - 0.35) / 0.65);
      stabFwd = k;
      pitch = 0.18 * k;
    } else if (a === ANIM.DEAD) {
      const d = c.deadAt || 0;
      deadA = ease(Math.min(1, d / 0.28)) * 1.62;
      if (d < 0.28) lift = Math.sin((d / 0.28) * Math.PI) * 0.25;
      legDead = 1;
      wingOut = 0.9;
      roll = ((c.seed || 0) % 7) / 7 - 0.5;
    } else {
      // 가만히: 숨쉬기
      bob = Math.sin(performance.now() / 420 + (c.seed || 0)) * 0.012;
    }

    // 몸 전체: 발밑 기준
    _e.set(0, c.yaw, 0);
    _q.setFromEuler(_e);
    _v.set(c.x, bob + lift, c.z);
    _s.set(sc, sc, sc);
    _root.compose(_v, _q, _s);
    if (deadA) {
      // 뒤로 벌러덩 (몸 중심이 땅에 닿도록 0.4 높이를 축으로)
      local(_root, _root, 0, 0.4, 0, -deadA, 0, roll * 0.6);
      _root.multiply(_tmp.makeTranslation(0, -0.4, 0));
    } else {
      local(_root, _root, 0, 0.32, 0, pitch, 0, roll);
      _root.multiply(_tmp.makeTranslation(0, -0.32, 0));
    }
    this.body.setMatrixAt(i, _root);

    // 날개 (왼쪽 +x, 오른쪽 -x: 오른날개에 칼)
    const wl = i * 2;
    local(_m, _root, 0.33, 0.8, 0.02, wingFwd, 0, wingOut);
    this.wings.setMatrixAt(wl, _m);
    const rFwd = -1.45 * stabFwd - (a === ANIM.WALK ? sw * 0.15 : 0);
    local(_m, _root, -0.33, 0.8, 0.02, rFwd, 0, -wingOut + 0.1 * stabFwd);
    this.wings.setMatrixAt(wl + 1, _m);
    // 칼: 오른날개 끝에 쥐고 앞을 향한다
    local(_tmp, _m, -0.02, -0.3, 0.06, 0.25 + 1.2 * stabFwd, 0, 0);
    this.knives.setMatrixAt(i, _tmp);

    // 다리
    const twitch = legDead ? Math.sin(performance.now() / 90 + (c.seed || 0)) * 0.12 * Math.max(0, 1 - (c.deadAt || 0) / 1.5) : 0;
    local(_m, _root, 0.13, 0.36, 0, legDead ? -0.93 + twitch : legA, 0, legDead ? 0.25 : 0);
    this.legs.setMatrixAt(wl, _m);
    local(_m, _root, -0.13, 0.36, 0, legDead ? -0.93 - twitch : -legA, 0, legDead ? -0.25 : 0);
    this.legs.setMatrixAt(wl + 1, _m);

    // 그림자
    const ss = (deadA ? 1.25 : 1) * sc * (1 - lift * 0.8);
    _e.set(0, c.yaw, 0);
    _q.setFromEuler(_e);
    _v.set(c.x, 0.03, c.z);
    _s.set(ss, 1, ss * (deadA ? 1.5 : 1.1));
    this.shadows.setMatrixAt(i, _m.compose(_v, _q, _s));

    this.head.set(0, deadA ? 0.9 : 1.75, 0).applyMatrix4(_root);
    if (deadA) this.head.set(c.x, 1.2, c.z);
    return this.head;
  }

  end() {
    const n = this.n;
    for (const [m, k] of [[this.body, 1], [this.wings, 2], [this.legs, 2], [this.knives, 1], [this.shadows, 1]]) {
      m.count = n * k;
      m.instanceMatrix.needsUpdate = true;
    }
  }
}
