// 꼬꼬 마을 그리기: 하늘, 바닥 그림, 건물·나무·소품(꼭짓점 색으로 합친 메시 몇 개), 풍차 날개, 연못.
import * as THREE from 'three';
import { HALF, MAP_SIZE, OBSTACLES, PATHS, PLAZA } from './shared/map.js';
import { mulberry32 } from './shared/rng.js';
import { Builder, mat } from './geo.js';

export const SKY = { top: 0x5d9fe0, horizon: 0xffe2b8, fog: 0xf3dcc0 };

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n);
const prism = () => new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2); // 꼭짓점이 위, z 로 늘어난 삼각기둥

// 하늘: 위는 파랗고 지평선은 노을빛
function buildSky() {
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(SKY.top) }, hor: { value: new THREE.Color(SKY.horizon) } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 hor; varying vec3 vP;
      void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(hor, top, pow(h, 0.55));
      float sun = pow(max(0.0, dot(vP, normalize(vec3(-0.6, 0.25, -0.75)))), 60.0);
      gl_FragColor = vec4(c + vec3(1.0, 0.85, 0.6) * sun * 0.6, 1.0); }`,
  });
  const s = new THREE.Mesh(new THREE.SphereGeometry(300, 24, 12), m);
  s.renderOrder = -10;
  return s;
}

// 바닥 그림 (64m → 2048px): 잔디 얼룩, 흙길, 광장 돌, 연못 둘레 모래, 텃밭 흙
function groundTexture(rng) {
  const S = 2048;
  const k = S / MAP_SIZE;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const P = (x) => (x + MAP_SIZE / 2) * k;
  g.fillStyle = '#8fc25c';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const c = ['#86b955', '#9acb66', '#84b350', '#a2d06c'][i % 4];
    g.fillStyle = c;
    g.globalAlpha = 0.35;
    g.beginPath();
    g.arc(rng() * S, rng() * S, 10 + rng() * 60, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // 연못 둘레 모래·젖은 흙
  for (const o of OBSTACLES.filter((o) => o.kind === 'pond')) {
    g.fillStyle = '#d8c690';
    g.beginPath();
    g.arc(P(o.x), P(o.z), (o.r + 0.9) * k, 0, Math.PI * 2);
    g.fill();
  }
  for (const o of OBSTACLES.filter((o) => o.kind === 'pond')) {
    g.fillStyle = '#7d8f5a';
    g.beginPath();
    g.arc(P(o.x), P(o.z), (o.r + 0.25) * k, 0, Math.PI * 2);
    g.fill();
  }
  // 흙길: 가장자리 한 번, 안쪽 한 번
  g.lineCap = g.lineJoin = 'round';
  for (const [pass, col, add] of [[0, '#c9a66e', 0.5], [1, '#ddbf87', 0]]) {
    for (const [w, pts] of PATHS) {
      g.strokeStyle = col;
      g.lineWidth = (w + add) * k;
      g.beginPath();
      pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z))));
      g.stroke();
    }
    g.fillStyle = col;
    g.beginPath();
    g.arc(P(PLAZA.x), P(PLAZA.z), (PLAZA.r + add / 2) * k, 0, Math.PI * 2);
    g.fill();
    void pass;
  }
  // 광장 돌바닥
  for (let i = 0; i < 520; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * (PLAZA.r - 0.4);
    g.fillStyle = ['#cdb48a', '#e6d0a0', '#c3a979'][i % 3];
    g.beginPath();
    g.ellipse(P(PLAZA.x + Math.sin(a) * r), P(PLAZA.z + Math.cos(a) * r), (0.25 + rng() * 0.2) * k, (0.18 + rng() * 0.15) * k, rng() * 3, 0, Math.PI * 2);
    g.fill();
  }
  // 흙길의 작은 자갈
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = rng() < 0.5 ? 'rgba(150,110,70,0.35)' : 'rgba(255,240,200,0.35)';
    g.fillRect(rng() * S, rng() * S, 3, 3);
  }
  // 텃밭 흙과 고랑
  g.fillStyle = '#8b5e3c';
  g.fillRect(P(11.2), P(9.7), 7.6 * k, 6.6 * k);
  g.strokeStyle = '#6f4a2e';
  g.lineWidth = 0.25 * k;
  for (let x = 12; x < 18.6; x += 1.1) {
    g.beginPath();
    g.moveTo(P(x), P(10.2));
    g.lineTo(P(x), P(15.8));
    g.stroke();
  }
  // 건물 아래 그늘 (붙어 있어 보이게)
  g.fillStyle = 'rgba(60,50,40,0.25)';
  for (const o of OBSTACLES) {
    if (o.shape !== 'box' || o.kind === 'fence') continue;
    g.fillRect(P(o.x - o.w / 2 - 0.25), P(o.z - o.d / 2 - 0.25), (o.w + 0.5) * k, (o.d + 0.5) * k);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// 건물 틀: 문이 로컬 +z 를 보도록 돌린 행렬
const DOOR_YAW = { '+z': 0, '-z': Math.PI, '+x': Math.PI / 2, '-x': -Math.PI / 2 };
function frameOf(o) {
  const rot = DOOR_YAW[o.door || o.face || '+z'];
  const along = !o.door || o.door.endsWith('z');
  return { F: mat(o.x, 0, o.z, 0, rot, 0), w: along ? o.w : o.d, d: along ? o.d : o.w };
}
const at = (F, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => F.clone().multiply(mat(x, y, z, rx, ry, rz, sx, sy, sz));

// 박공 지붕: 용마루가 로컬 axis('x' 또는 'z') 방향
function gableRoof(b, F, w, d, wallH, peak, color, wallColor, axis) {
  const rise = peak - wallH;
  const [span, len] = axis === 'z' ? [w, d] : [d, w];
  const ry = axis === 'z' ? 0 : Math.PI / 2;
  // 박공 삼각형(벽 색)
  b.add(prism(), wallColor, at(F, 0, wallH + rise / 3, 0, 0, ry, 0, span / Math.sqrt(3), rise / 1.5, len));
  const half = span / 2 + 0.35;
  const L = Math.hypot(half, rise + 0.12);
  const ang = Math.atan2(rise + 0.12, half);
  for (const s of [1, -1]) {
    const cx = (s * half) / 2;
    const cy = wallH - 0.12 + (rise + 0.12) / 2;
    const m = axis === 'z' ? at(F, cx, cy, 0, 0, 0, s * ang) : at(F, 0, cy, cx, -s * ang, 0, 0);
    b.add(axis === 'z' ? box(L, 0.2, len + 0.6) : box(len + 0.6, 0.2, L), color, m);
  }
  b.add(axis === 'z' ? box(0.3, 0.3, len + 0.7) : box(len + 0.7, 0.3, 0.3), new THREE.Color(color).multiplyScalar(0.75).getHex(), at(F, 0, peak + 0.06, 0, axis === 'z' ? 0 : 0, 0, Math.PI / 4));
}

function windowAt(b, glow, F, x, y, z, w = 0.9, h = 1.0) {
  b.add(box(w + 0.22, h + 0.22, 0.1), 0x6e4b33, at(F, x, y, z));
  glow.add(box(w, h, 0.12), 0xffd877, at(F, x, y, z + 0.01));
  b.add(box(0.08, h, 0.14), 0x6e4b33, at(F, x, y, z + 0.02));
  b.add(box(w, 0.08, 0.14), 0x6e4b33, at(F, x, y, z + 0.02));
  b.add(box(w + 0.3, 0.2, 0.3), 0x8a5a3a, at(F, x, y - h / 2 - 0.15, z + 0.1)); // 화분 받침
  for (let i = 0; i < 4; i++) b.add(new THREE.IcosahedronGeometry(0.13, 0), [0xe8566a, 0xffc94d, 0xf08fc0, 0xffffff][i], at(F, x - w / 2 + 0.12 + i * (w / 3.3), y - h / 2 + 0.02, z + 0.12));
}

function buildBarn(b, glow, o) {
  const { F, w, d } = frameOf(o);
  const wallH = 4.3;
  b.add(box(w, wallH, d), 0xb8443a, at(F, 0, wallH / 2, 0));
  b.add(box(w + 0.1, 0.5, d + 0.1), 0x8f8a84, at(F, 0, 0.25, 0)); // 돌 기초
  gableRoof(b, F, w, d, wallH, o.h, 0x5a4a52, 0xb8443a, 'z');
  // 흰 모서리 장식
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.add(box(0.28, wallH, 0.28), 0xf2ece0, at(F, (sx * w) / 2, wallH / 2, (sz * d) / 2));
  b.add(box(w + 0.2, 0.25, 0.3), 0xf2ece0, at(F, 0, wallH, d / 2));
  // 큰 문 (안은 어둡게) + 흰 X 장식
  const dw = 3.6;
  const dh = 3.5;
  b.add(box(dw, dh, 0.1), 0x2b2025, at(F, 0, dh / 2, d / 2 + 0.02));
  for (const s of [-1, 1]) {
    b.add(box(0.22, dh, 0.16), 0xf2ece0, at(F, s * (dw / 2 + 0.05), dh / 2, d / 2 + 0.06));
    b.add(box(dw / 2 - 0.1, 0.2, 0.14), 0x9b3a32, at(F, s * (dw / 4 + 0.3), dh - 0.2, d / 2 + 0.2));
    // 열린 문짝
    const leaf = at(F, s * (dw / 2 + 0.15 + 0.85), dh / 2, d / 2 + 0.85, 0, s * 1.2, 0);
    b.add(box(1.75, dh, 0.14), 0xb8443a, leaf);
    b.add(box(0.15, Math.hypot(1.6, dh) - 0.2, 0.18), 0xf2ece0, leaf.clone().multiply(mat(0, 0, 0.02, 0, 0, Math.atan2(1.6, dh) * s)));
  }
  b.add(box(dw + 0.5, 0.25, 0.2), 0xf2ece0, at(F, 0, dh + 0.1, d / 2 + 0.05));
  // 건초 창
  b.add(box(1.4, 1.2, 0.1), 0x2b2025, at(F, 0, wallH + 0.8, d / 2 + 0.02));
  b.add(box(1.2, 0.5, 0.2), 0xe2c25c, at(F, 0, wallH + 0.45, d / 2 + 0.06));
  for (const s of [-1, 1]) windowAt(b, glow, F, s * 4.2, 2.6, d / 2 + 0.02, 0.9, 0.9);
}

function buildHouse(b, glow, o) {
  const { F, w, d } = frameOf(o);
  const wallH = 3.0;
  b.add(box(w, 0.6, d), 0x9c958c, at(F, 0, 0.3, 0)); // 돌 기초
  b.add(box(w - 0.1, wallH - 0.6, d - 0.1), 0xf3e6c8, at(F, 0, 0.6 + (wallH - 0.6) / 2, 0));
  // 나무 기둥 (모서리)
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.add(box(0.26, wallH, 0.26), 0x7a5236, at(F, (sx * w) / 2, wallH / 2, (sz * d) / 2));
  b.add(box(w + 0.1, 0.22, d + 0.1), 0x7a5236, at(F, 0, wallH, 0));
  gableRoof(b, F, w, d, wallH, o.h, o.roof || 0xc8643b, 0xf3e6c8, 'x');
  // 굴뚝
  b.add(box(0.7, 2.2, 0.7), 0xa0786a, at(F, w / 2 - 1.2, o.h - 0.2, -d / 4));
  b.add(box(0.85, 0.2, 0.85), 0x7f5f55, at(F, w / 2 - 1.2, o.h + 0.9, -d / 4));
  // 문 + 차양
  b.add(box(1.2, 2.0, 0.12), 0x8a5532, at(F, 0, 1.0, d / 2 + 0.02));
  b.add(box(0.12, 0.12, 0.1), 0xf0c040, at(F, 0.4, 1.0, d / 2 + 0.1));
  b.add(box(1.8, 0.14, 0.8), new THREE.Color(o.roof || 0xc8643b).getHex(), at(F, 0, 2.25, d / 2 + 0.4, 0.25));
  b.add(box(1.6, 0.15, 0.6), 0x9c958c, at(F, 0, 0.07, d / 2 + 0.35)); // 계단
  windowAt(b, glow, F, -w / 2 + 1.3, 1.75, d / 2 + 0.02);
  windowAt(b, glow, F, w / 2 - 1.3, 1.75, d / 2 + 0.02);
  // 옆·뒤 창문
  windowAt(b, glow, F.clone().multiply(mat(0, 0, 0, 0, Math.PI / 2)), 0, 1.75, w / 2 + 0.02);
  windowAt(b, glow, F.clone().multiply(mat(0, 0, 0, 0, -Math.PI / 2)), 0, 1.75, w / 2 + 0.02);
  windowAt(b, glow, F.clone().multiply(mat(0, 0, 0, 0, Math.PI)), 0, 1.75, d / 2 + 0.02);
}

function buildCoop(b, o) {
  const { F, w, d } = frameOf(o);
  b.add(box(w, 1.7, d), 0xb07a4a, at(F, 0, 0.35 + 0.85, 0));
  for (let y = 0.6; y < 2; y += 0.35) b.add(box(w + 0.04, 0.05, d + 0.04), 0x8e5f38, at(F, 0, y, 0)); // 판자 줄
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.add(box(0.18, 0.5, 0.18), 0x6e4b33, at(F, (sx * (w - 0.3)) / 2, 0.25, (sz * (d - 0.3)) / 2));
  // 한쪽으로 기운 지붕
  b.add(box(w + 0.5, 0.15, d + 0.6), 0x8b3f36, at(F, 0, 2.2, 0, -0.22));
  // 문 구멍과 경사로
  b.add(box(0.85, 1.0, 0.08), 0x2a1f1c, at(F, 0, 0.95, d / 2 + 0.02));
  b.add(box(0.9, 0.08, 1.3), 0x9a6b45, at(F, 0, 0.3, d / 2 + 0.6, 0.42));
  for (let i = 0; i < 4; i++) b.add(box(0.9, 0.05, 0.06), 0x7a5236, at(F, 0, 0.18 + i * 0.12, d / 2 + 1.1 - i * 0.26, 0.42));
}

function buildStall(b, o) {
  const { F, w, d } = frameOf(o);
  b.add(box(w, 1.0, d), 0x9a6b45, at(F, 0, 0.5, 0));
  b.add(box(w + 0.15, 0.1, d + 0.15), 0x7a5236, at(F, 0, 1.02, 0));
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) b.add(box(0.12, 2.6, 0.12), 0x6e4b33, at(F, (sx * w) / 2, 1.3, (sz * d) / 2 - (sz < 0 ? 0 : 0)));
  // 줄무늬 차양 (앞으로 기운다)
  const n = 7;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 - 0.2 + ((w + 0.4) / n) * (i + 0.5);
    b.add(box((w + 0.4) / n, 0.08, d + 1.2), i % 2 ? 0xfaf6ec : o.awning, at(F, x, 2.55, 0.25, 0.28));
  }
  for (let i = 0; i < n; i++) {
    const x = -w / 2 - 0.2 + ((w + 0.4) / n) * (i + 0.5);
    b.add(box((w + 0.4) / n, 0.35, 0.05), i % 2 ? o.awning : 0xfaf6ec, at(F, x, 2.2, d / 2 + 0.82));
  }
  // 진열한 과일·채소
  const rng = mulberry32(Math.round(o.x * 13 + o.z * 7));
  const cols = [0xe0413a, 0xf29b2c, 0x8ac34a, 0xf2d43c, 0x9b4fb0];
  for (let i = 0; i < 3; i++) {
    const cx = -w / 2 + 0.6 + i * ((w - 1.2) / 2);
    b.add(box(0.8, 0.25, 0.6), 0xc49a6c, at(F, cx, 1.18, 0));
    const c = cols[Math.floor(rng() * cols.length)];
    for (let j = 0; j < 7; j++) b.add(new THREE.IcosahedronGeometry(0.11, 1), c, at(F, cx + (rng() - 0.5) * 0.55, 1.36 + rng() * 0.06, (rng() - 0.5) * 0.4));
  }
}

function buildTree(b, o, rng) {
  const F = mat(o.x, 0, o.z, 0, rng() * 6, 0);
  const autumn = o.v % 5 === 3;
  const greens = autumn ? [0xe39a3b, 0xd47f2f, 0xf0b54d] : [0x5d9e4a, 0x4b8a40, 0x73b257];
  const th = 2.0 + rng() * 0.8;
  b.add(cyl(0.22, 0.34, th, 7), 0x7a5236, at(F, 0, th / 2, 0));
  const big = 1.5 + rng() * 0.5;
  b.add(new THREE.IcosahedronGeometry(big, 0), greens[0], at(F, 0, th + big * 0.7, 0));
  b.add(new THREE.IcosahedronGeometry(big * 0.75, 0), greens[1], at(F, big * 0.6, th + big * 0.3, 0.2, 0.5, 0.3));
  b.add(new THREE.IcosahedronGeometry(big * 0.7, 0), greens[2], at(F, -big * 0.5, th + big * 0.5, -0.3, 0.2, 0.8));
  b.add(new THREE.IcosahedronGeometry(big * 0.6, 0), greens[1], at(F, 0.1, th + big * 1.3, 0.1, 0.7));
}

function buildPine(b, x, z, s, rng) {
  const F = mat(x, 0, z, 0, rng() * 6, 0, s);
  b.add(cyl(0.2, 0.3, 1.4, 6), 0x6e4b33, at(F, 0, 0.7, 0));
  const g = [0x3f7f4a, 0x4a8d52, 0x37704a][Math.floor(rng() * 3)];
  for (let i = 0; i < 3; i++) b.add(new THREE.ConeGeometry(1.7 - i * 0.4, 2.0, 7), g, at(F, 0, 1.8 + i * 1.1, 0));
}

function buildWindmill(b, o) {
  const F = mat(o.x, 0, o.z, 0, Math.atan2(-o.x, -o.z), 0); // 날개가 마을 가운데를 본다
  b.add(cyl(1.55, o.r, 8, 8), 0xece3d2, at(F, 0, 4, 0));
  b.add(cyl(o.r + 0.1, o.r + 0.15, 0.6, 8), 0x9c958c, at(F, 0, 0.3, 0));
  b.add(new THREE.ConeGeometry(2.0, 2.4, 8), 0x7d4a3a, at(F, 0, 9.2, 0));
  b.add(box(1.0, 1.8, 0.2), 0x7a5236, at(F, 0, 0.9, o.r - 0.05, -0.08));
  for (const y of [3.4, 5.8]) b.add(box(0.7, 0.8, 0.2), 0x6e4b33, at(F, 0, y, 1.75 - (y - 3.4) * 0.08, -0.08));
  b.add(cyl(0.35, 0.35, 1.2, 8), 0x5a4a52, at(F, 0, 8.3, 1.6, Math.PI / 2));
}

function windmillBlades(o) {
  const g = new THREE.Group();
  const yaw = Math.atan2(-o.x, -o.z);
  g.position.set(o.x + Math.sin(yaw) * 2.25, 8.3, o.z + Math.cos(yaw) * 2.25);
  g.rotation.y = yaw;
  const b = new Builder();
  b.add(cyl(0.45, 0.45, 0.4, 8), 0x5a4a52, mat(0, 0, 0, Math.PI / 2));
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const F = mat(0, 0, 0.1, 0, 0, a);
    b.add(box(0.22, 5.4, 0.15), 0x7a5236, F.clone().multiply(mat(0, 2.8, 0)));
    b.add(box(1.25, 4.0, 0.06), 0xf6efe0, F.clone().multiply(mat(0.72, 3.3, 0.04)));
    for (let k = 0; k < 4; k++) b.add(box(1.3, 0.06, 0.1), 0x7a5236, F.clone().multiply(mat(0.72, 1.6 + k * 1.1, 0.08)));
  }
  const m = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  g.add(m);
  g.userData.spin = m;
  return g;
}

function buildSilo(b, o) {
  const F = mat(o.x, 0, o.z);
  b.add(cyl(o.r, o.r, 7.2, 14), 0xb9c3cf, at(F, 0, 3.6, 0));
  for (const y of [1.5, 3.2, 4.9, 6.6]) b.add(cyl(o.r + 0.05, o.r + 0.05, 0.14, 14), 0x8e99a6, at(F, 0, y, 0));
  b.add(new THREE.SphereGeometry(o.r + 0.05, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xd3dbe3, at(F, 0, 7.2, 0));
  b.add(box(0.3, 7, 0.1), 0x6f7a88, at(F, 0.4, 3.5, o.r + 0.05)); // 사다리
}

function buildWell(b, o) {
  const F = mat(o.x, 0, o.z, 0, 0.3, 0);
  b.add(cyl(o.r, o.r + 0.05, 0.95, 12), 0xa9a49a, at(F, 0, 0.47, 0));
  b.add(cyl(o.r - 0.25, o.r - 0.25, 0.1, 12), 0x3c6f8f, at(F, 0, 0.85, 0));
  b.add(cyl(o.r + 0.08, o.r + 0.08, 0.15, 12), 0x8f8a84, at(F, 0, 0.98, 0));
  for (const s of [-1, 1]) b.add(box(0.18, 2.0, 0.18), 0x7a5236, at(F, s * (o.r - 0.05), 1.6, 0));
  b.add(prism(), 0x8b3f36, at(F, 0, 2.75, 0, 0, Math.PI / 2, 0, 2.6 / Math.sqrt(3), 0.7 / 1.5, 1.6));
  b.add(cyl(0.06, 0.06, 2.1, 6), 0x5a4030, at(F, 0, 2.2, 0, 0, 0, Math.PI / 2));
  b.add(cyl(0.2, 0.16, 0.3, 8), 0x8a5a3a, at(F, 0, 1.55, 0));
}

function buildHay(b, o, rng) {
  const F = mat(o.x, 0, o.z, 0, rng() * 3, 0);
  b.add(cyl(o.r, o.r, 1.1, 12), 0xe2c25c, at(F, 0, o.r, 0, 0, 0, Math.PI / 2));
  b.add(cyl(o.r * 0.75, o.r * 0.75, 1.12, 12), 0xf0d983, at(F, 0, o.r, 0, 0, 0, Math.PI / 2));
}

function buildCart(b, o) {
  const F = mat(o.x, 0, o.z, 0, 0.15, 0);
  b.add(box(o.w, 0.2, o.d), 0x9a6b45, at(F, 0, 0.75, 0));
  for (const s of [-1, 1]) {
    b.add(box(0.1, 0.5, o.d), 0x8a5a3a, at(F, (s * o.w) / 2, 1.05, 0));
    b.add(cyl(0.55, 0.55, 0.12, 10), 0x6e4b33, at(F, s * (o.w / 2 + 0.1), 0.55, -0.3, 0, 0, Math.PI / 2));
    b.add(cyl(0.2, 0.2, 0.16, 8), 0x3e2b20, at(F, s * (o.w / 2 + 0.1), 0.55, -0.3, 0, 0, Math.PI / 2));
    b.add(box(0.08, 0.08, 1.6), 0x7a5236, at(F, s * 0.4, 0.75, o.d / 2 + 0.8, 0.1));
  }
  for (let i = 0; i < 5; i++) b.add(new THREE.IcosahedronGeometry(0.32, 0), [0xf29b2c, 0xe2c25c][i % 2], at(F, (i % 3) * 0.4 - 0.4, 1.05, i * 0.45 - 0.9));
}

function buildFence(b, o) {
  const along = o.w > o.d;
  const len = along ? o.w : o.d;
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const t = -len / 2 + (len / n) * i;
    b.add(box(0.16, 1.05, 0.16), 0xb88a5c, mat(o.x + (along ? t : 0), 0.52, o.z + (along ? 0 : t)));
  }
  for (const y of [0.4, 0.82]) b.add(box(along ? len : 0.08, 0.1, along ? 0.08 : len), 0xc89c6c, mat(o.x, y, o.z));
}

function buildScarecrow(b, o) {
  const F = mat(o.x, 0, o.z, 0, 0.6, 0);
  b.add(box(0.12, 2.3, 0.12), 0x7a5236, at(F, 0, 1.15, 0));
  b.add(box(1.6, 0.1, 0.1), 0x7a5236, at(F, 0, 1.7, 0));
  b.add(box(0.7, 0.8, 0.35), 0x4a78b5, at(F, 0, 1.55, 0));
  b.add(new THREE.IcosahedronGeometry(0.28, 1), 0xe6cf98, at(F, 0, 2.25, 0));
  b.add(new THREE.ConeGeometry(0.45, 0.45, 8), 0x9a6b45, at(F, 0, 2.55, 0));
  b.add(cyl(0.5, 0.5, 0.05, 10), 0x9a6b45, at(F, 0, 2.38, 0));
}

// 울타리 안쪽 맵 둘레 울타리와 바깥 숲·언덕·먼 산
function buildOutskirts(b, rng) {
  const L = HALF + 0.4;
  for (const side of [0, 1, 2, 3]) {
    for (let t = -L; t < L; t += 1.6) {
      const [x, z] = side === 0 ? [t, -L] : side === 1 ? [t, L] : side === 2 ? [-L, t] : [L, t];
      b.add(box(0.18, 1.1, 0.18), 0xa47a50, mat(x, 0.55, z));
    }
    for (const y of [0.45, 0.88]) {
      const m = side < 2 ? mat(0, y, side === 0 ? -L : L) : mat(side === 2 ? -L : L, y, 0);
      b.add(side < 2 ? box(L * 2, 0.1, 0.08) : box(0.08, 0.1, L * 2), 0xc49a6c, m);
    }
  }
  // 바깥 숲
  for (let i = 0; i < 150; i++) {
    const a = rng() * Math.PI * 2;
    const r = 32 + rng() * 22;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    if (Math.max(Math.abs(x), Math.abs(z)) < HALF + 2.5) continue;
    if (rng() < 0.7) buildPine(b, x, z, 0.9 + rng() * 0.8, rng);
    else buildTree(b, { x, z, v: Math.floor(rng() * 5) }, rng);
  }
  // 언덕
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rng() * 0.2;
    const r = 62 + rng() * 15;
    const s = 10 + rng() * 10;
    b.add(new THREE.IcosahedronGeometry(1, 1), [0x7fae58, 0x6e9e4e, 0x8cba62][i % 3], mat(Math.sin(a) * r, -s * 0.35, Math.cos(a) * r, rng(), rng(), 0, s * 1.6, s * 0.7, s * 1.3));
  }
  // 먼 산 (눈 덮인 봉우리)
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.25;
    const r = 120 + rng() * 25;
    const h = 30 + rng() * 25;
    const w = 28 + rng() * 18;
    const m = mat(Math.sin(a) * r, h / 2 - 4, Math.cos(a) * r, 0, rng() * 3, 0);
    b.add(new THREE.ConeGeometry(w, h, 6), [0x8d9cc0, 0x7f8fb5, 0x97a5c6][i % 3], m);
    b.add(new THREE.ConeGeometry(w * 0.32, h * 0.32, 6), 0xf6f4fb, m.clone().multiply(mat(0, h * 0.34 + 0.2, 0)));
  }
}

// 풀·꽃·돌 (부딪히지 않는 꾸밈)
function buildScatter(b, rng, blocked) {
  for (let i = 0; i < 420; i++) {
    const x = (rng() * 2 - 1) * (HALF - 0.5);
    const z = (rng() * 2 - 1) * (HALF - 0.5);
    if (blocked(x, z, 0.4) || Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 0.5) continue;
    const F = mat(x, 0, z, 0, rng() * 6, 0);
    const r = rng();
    if (r < 0.62) {
      const g = [0x6ea547, 0x7cb552, 0x5f9640][i % 3];
      for (let k = 0; k < 3; k++) b.add(new THREE.ConeGeometry(0.05, 0.35 + rng() * 0.2, 4), g, at(F, (k - 1) * 0.07, 0.18, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.5, 0, (k - 1) * 0.35));
    } else if (r < 0.9) {
      const c = [0xffffff, 0xffd24d, 0xf27aa0, 0xb38cf0, 0xff8a4d][i % 5];
      b.add(cyl(0.015, 0.015, 0.3, 3), 0x5f9640, at(F, 0, 0.15, 0));
      b.add(new THREE.IcosahedronGeometry(0.08, 0), c, at(F, 0, 0.32, 0));
      b.add(new THREE.IcosahedronGeometry(0.035, 0), 0xffe066, at(F, 0, 0.36, 0.04));
    } else {
      b.add(new THREE.DodecahedronGeometry(0.15 + rng() * 0.25, 0), [0xa9a49a, 0x9a958c][i % 2], at(F, 0, 0.05, 0, rng(), rng(), 0, 1, 0.6, 1));
    }
  }
}

function buildPond(scene, b, rng) {
  const ponds = OBSTACLES.filter((o) => o.kind === 'pond');
  const water = new THREE.MeshPhongMaterial({ color: 0x4aa6d6, shininess: 90, specular: 0xffffff, flatShading: true });
  for (const o of ponds) {
    const g = new THREE.CircleGeometry(o.r + 0.15, 28).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, water);
    m.position.set(o.x, 0.04, o.z);
    m.receiveShadow = true;
    scene.add(m);
  }
  // 둘레 돌, 갈대, 연잎
  for (const o of ponds) {
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2;
      const x = o.x + Math.sin(a) * (o.r + 0.2);
      const z = o.z + Math.cos(a) * (o.r + 0.2);
      if (ponds.some((p) => p !== o && Math.hypot(x - p.x, z - p.z) < p.r)) continue;
      if (rng() < 0.5) b.add(new THREE.DodecahedronGeometry(0.22 + rng() * 0.2, 0), 0xa9a49a, mat(x, 0.08, z, rng(), rng(), 0, 1, 0.55, 1));
      else for (let k = 0; k < 4; k++) b.add(cyl(0.025, 0.03, 0.9 + rng() * 0.5, 4), 0x6c8f3e, mat(x + (rng() - 0.5) * 0.4, 0.5, z + (rng() - 0.5) * 0.4, (rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
    }
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * (o.r - 0.8);
      b.add(cyl(0.38, 0.38, 0.03, 9, 1), 0x5c9e46, mat(o.x + Math.sin(a) * r, 0.07, o.z + Math.cos(a) * r));
      if (rng() < 0.5) b.add(new THREE.IcosahedronGeometry(0.09, 0), 0xf7a8c8, mat(o.x + Math.sin(a) * r + 0.1, 0.13, o.z + Math.cos(a) * r));
    }
  }
}

export function buildWorld(scene, { blocked }) {
  const rng = mulberry32(20261121);
  scene.add(buildSky());

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ map: groundTexture(rng) }));
  ground.receiveShadow = true;
  scene.add(ground);
  // 바깥 바닥 (맵 그림 바깥)
  const outer = new THREE.Mesh(new THREE.RingGeometry(MAP_SIZE * 0.7, 260, 4, 1, Math.PI / 4).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x86b955 }));
  outer.position.y = -0.02;
  outer.receiveShadow = true;
  scene.add(outer);
  // 맵 그림 가장자리와 바깥 바닥 사이 틈 메우기
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(MAP_SIZE * 1.5, MAP_SIZE * 1.5).rotateX(-Math.PI / 2), outer.material);
  fill.position.y = -0.03;
  scene.add(fill);

  const b = new Builder();
  const glow = new Builder();
  const spinners = [];
  for (const o of OBSTACLES) {
    switch (o.kind) {
      case 'barn': buildBarn(b, glow, o); break;
      case 'house': buildHouse(b, glow, o); break;
      case 'coop': buildCoop(b, o); break;
      case 'stall': buildStall(b, o); break;
      case 'tree': buildTree(b, o, rng); break;
      case 'windmill': buildWindmill(b, o); spinners.push(windmillBlades(o)); break;
      case 'silo': buildSilo(b, o); break;
      case 'well': buildWell(b, o); break;
      case 'hay': buildHay(b, o, rng); break;
      case 'cart': buildCart(b, o); break;
      case 'fence': buildFence(b, o); break;
      case 'scarecrow': buildScarecrow(b, o); break;
      case 'crate':
        b.add(box(0.8, 0.8, 0.8), 0xb88a5c, mat(o.x, 0.4, o.z, 0, 0.4, 0));
        b.add(box(0.84, 0.1, 0.84), 0x8e6440, mat(o.x, 0.6, o.z, 0, 0.4, 0));
        break;
      case 'barrel':
        b.add(cyl(o.r, o.r * 0.9, 0.9, 10), 0x9a6b45, mat(o.x, 0.45, o.z));
        for (const y of [0.2, 0.7]) b.add(cyl(o.r + 0.02, o.r + 0.02, 0.06, 10), 0x5a4a52, mat(o.x, y, o.z));
        break;
    }
  }
  // 텃밭 양배추
  for (let x = 12.4; x < 18.4; x += 1.1) for (let z = 10.6; z < 15.8; z += 0.9) if (Math.hypot(x - 15, z - 13) > 0.8) b.add(new THREE.IcosahedronGeometry(0.24, 0), (x * 10 + z) % 3 < 1.5 ? 0x7cc05a : 0x93cf6b, mat(x, 0.18, z, x, z, 0));
  buildPond(scene, b, rng);
  buildOutskirts(b, rng);
  buildScatter(b, rng, blocked);

  const lit = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  lit.castShadow = true;
  lit.receiveShadow = true;
  scene.add(lit);
  scene.add(new THREE.Mesh(glow.build(), new THREE.MeshBasicMaterial({ vertexColors: true })));
  for (const s of spinners) scene.add(s);

  return {
    update(dt) {
      for (const s of spinners) s.userData.spin.rotation.z += dt * 0.6;
    },
  };
}
