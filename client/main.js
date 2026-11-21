// 꼬꼬 스파이 클라이언트: 렌더링, 내 닭 예측, 다른 닭 보간, 화면 표시(HUD), 메뉴.
import * as THREE from 'three';
import { ACT, ANIM, CFG, EXPOSED_BIT, wrapAngle } from './shared/config.js';
import { blocked } from './shared/map.js';
import { stepChicken } from './shared/sim.js';
import { buildWorld, SKY } from './world.js';
import { ChickenView } from './chickens.js';
import { Fx } from './fx.js';
import { Input } from './input.js';
import { Sfx } from './audio.js';
import { Net } from './net.js';
import { LocalLink } from './local.js';
import { DEFAULT_SERVER, normalizeServer } from './settings.js';

const $ = (id) => document.getElementById(id);
const DT = 1 / CFG.TICK_RATE;
const INTERP = 0.12; // 다른 닭은 이만큼 늦게 그려 부드럽게 잇는다 (초)
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ───────────────────────── 설정 (기기에 저장) ─────────────────────────
const PKEY = 'kkokko.prefs';
const prefs = { name: '', sens: 1, vol: 0.8, server: '' };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem(PKEY)) || {});
} catch {}
const savePrefs = () => {
  try {
    localStorage.setItem(PKEY, JSON.stringify(prefs));
  } catch {}
};

// ───────────────────────── 렌더러 ─────────────────────────
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // 그림자는 건물·나무뿐이라 한 번만 그린다

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY.fog, 48, 175);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 420);
scene.add(new THREE.HemisphereLight(0xe4f0ff, 0xc2b48a, 1.75));
const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
sun.position.set(-26, 34, -20);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 120 });
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const world = buildWorld(scene, { blocked });
renderer.shadowMap.needsUpdate = true;
const chickens = new ChickenView(scene);
const fx = new Fx(scene);
const sfx = new Sfx();
sfx.vol = prefs.vol;

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // 세로 화면에서는 시야를 넓혀 옆이 너무 잘리지 않게
  camera.fov = camera.aspect < 1 ? 72 : 58;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const input = new Input({
  surface: canvas,
  stick: $('stick'),
  knob: $('knob'),
  buttons: { stab: $('stab'), run: $('run'), peck: $('peck'), flap: $('flap') },
});
input.sens = prefs.sens;

// ───────────────────────── 상태 ─────────────────────────
const S = {
  link: null,
  mode: 'menu', // 'menu' | 'game'
  online: false,
  snaps: [], // { k(서버 틱), ents: Map }
  offset: null, // 내 시계 - 서버 시계 (초)
  phase: 'count',
  tl: 0,
  myId: null,
  body: null,
  pred: null, // 내 닭 (예측)
  pending: [],
  seq: 0,
  err: { x: 0, z: 0 }, // 서버 보정으로 생긴 차이 (조금씩 줄인다)
  cd: 0,
  stabLock: 0,
  ex: 0,
  rs: 0,
  killerId: null,
  killerName: '',
  deadAt: 0,
  myAct: 0,
  myActAt: -10,
  board: [],
  pid: null,
  name: '',
  ended: false,
  lastBig: '',
  camSnap: true,
};
const vis = new Map(); // id → 화면용 상태
let frameNo = 0;

// ───────────────────────── 연결 ─────────────────────────
function startDemo() {
  closeLink();
  S.mode = 'menu';
  resetMatch();
  S.link = new LocalLink({ demo: true, onMessage });
}

function closeLink() {
  if (S.link) S.link.close();
  S.link = null;
}

function resetMatch() {
  S.snaps = [];
  S.offset = null;
  S.myId = null;
  S.body = null;
  S.pred = null;
  S.pending = [];
  S.err = { x: 0, z: 0 };
  S.ended = false;
  S.board = [];
  S.killerId = null;
  S.myAct = 0;
  S.camSnap = true;
  vis.clear();
  feedEl.innerHTML = '';
}

function startSolo() {
  closeLink();
  enterGame();
  S.online = false;
  S.link = new LocalLink({ name: S.name, onMessage });
}

let net = null;
function serverOrigin() {
  if (servedByGameServer) return location.origin;
  return normalizeServer(prefs.server) || normalizeServer(DEFAULT_SERVER);
}

async function startOnline() {
  const origin = serverOrigin();
  if (!origin) {
    openSheet('settings');
    $('serverIn').focus();
    $('serverNote').textContent = '온라인으로 하려면 게임 서버 주소가 필요해요.';
    return;
  }
  closeLink();
  $('onlineState').textContent = '연결하는 중…';
  net?.close();
  net = new Net({
    url: () => origin.replace(/^http/, 'ws') + '/ws',
    health: () => origin + '/healthz',
    onMessage,
    onState: (st) => {
      $('onlineState').textContent = { connecting: '연결하는 중…', waking: '서버 깨우는 중… (최대 1분)', open: '연결됨', closed: '끊어졌어요', failed: '연결 실패' }[st] || '';
      if ((st === 'closed' || st === 'failed') && S.mode === 'game' && S.online) {
        toast('서버와 연결이 끊어졌어요', 'bad');
        setTimeout(() => S.online && S.mode === 'game' && exitGame(), 1500);
      }
    },
  });
  const ok = await net.open();
  if (!ok) return;
  enterGame();
  S.online = true;
  S.link = { send: (m) => net.send(m), close: () => net.close() };
  net.send({ t: 'join', name: S.name });
}

function enterGame() {
  sfx.unlock();
  S.mode = 'game';
  S.name = ($('nameIn').value || '').trim().slice(0, 12) || prefs.name || '';
  prefs.name = S.name;
  savePrefs();
  resetMatch();
  $('menu').hidden = true;
  $('hud').hidden = false;
  $('hint').hidden = false;
  setTimeout(() => ($('hint').hidden = true), 7000);
  input.enabled = true;
  input.reset();
  hideSheets();
  goFullscreen();
}

function exitGame() {
  input.enabled = false;
  input.reset();
  S.online = false;
  net?.close();
  net = null;
  $('hud').hidden = true;
  hideSheets();
  $('menu').hidden = false;
  $('onlineState').textContent = onlineLabel();
  startDemo();
}

function goFullscreen() {
  if (!matchMedia('(pointer: coarse)').matches) return;
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch {}
}

// ───────────────────────── 메시지 ─────────────────────────
function onMessage(m) {
  if (m.t !== 's') return;
  const now = performance.now() / 1000;
  const st = m.k / CFG.TICK_RATE;
  const sample = now - st;
  // 가장 빨리 도착한 쪽에 맞추고, 시계가 어긋나면 천천히 따라간다
  if (S.offset === null || sample < S.offset || Math.abs(sample - S.offset) > 1) S.offset = sample;
  else S.offset += (sample - S.offset) * 0.01;

  const ents = new Map();
  const e = m.e;
  for (let i = 0; i < e.length; i += 5) ents.set(e[i], { x: e[i + 1] / 100, z: e[i + 2] / 100, yaw: e[i + 3] / 100, code: e[i + 4] });
  S.snaps.push({ k: m.k, ents });
  while (S.snaps.length > 2 && S.snaps[1].k / CFG.TICK_RATE < now - S.offset - INTERP - 0.3) S.snaps.shift();
  if (S.snaps.length > 30) S.snaps.shift();

  if (m.ev) for (const ev of m.ev) onEvent(ev);
  if (S.mode !== 'game') return;
  const prevPhase = S.phase;
  S.phase = m.ph;
  S.tl = m.tl;
  if (prevPhase !== 'play' && S.phase === 'play') S.pending = [];
  if (m.b) {
    S.board = m.b;
    if (!$('board').hidden) renderBoard($('boardList'), S.board);
  }
  onYou(m.y);
}

function onYou(y) {
  if (!y) return;
  S.pid = y.pid ?? S.pid;
  if (y.id !== S.myId) {
    if (y.id) {
      S.pred = { x: y.x, z: y.z, yaw: y.yaw, vx: y.vx, vz: y.vz };
      S.pending = [];
      S.err = { x: 0, z: 0 };
      input.yaw = y.yaw; // 새 닭의 등 뒤에서 본다
      S.camSnap = true;
      $('dead').hidden = true;
    } else {
      S.deadAt = performance.now() / 1000;
    }
    S.myId = y.id;
  } else if (y.id && S.pred) {
    S.pending = S.pending.filter((p) => p.seq > y.ack);
    const ox = S.pred.x;
    const oz = S.pred.z;
    Object.assign(S.pred, { x: y.x, z: y.z, yaw: y.yaw, vx: y.vx, vz: y.vz });
    for (const p of S.pending) stepChicken(S.pred, p, DT);
    S.err.x += ox - S.pred.x;
    S.err.z += oz - S.pred.z;
    if (Math.hypot(S.err.x, S.err.z) > 2) S.err = { x: 0, z: 0 };
  }
  S.body = y.body ?? null;
  S.rs = y.rs ?? 0;
  S.cd = y.cd ?? 0;
  S.ex = y.ex ?? 0;
}

function onEvent(ev) {
  switch (ev.t) {
    case 'feed':
      addFeed(ev.k, ev.v);
      break;
    case 'oops':
      toast('AI 를 찔렀어요! −1점 · 머리 위에 ❗ 가 떴어요', 'bad');
      sfx.bad();
      buzz([60, 40, 60]);
      break;
    case 'got':
      toast(`🔪 ${esc(ev.v)} 잡았다! +1점`, 'good');
      sfx.good();
      buzz(40);
      break;
    case 'dead':
      S.killerId = ev.kid;
      S.killerName = ev.by;
      $('deadBy').innerHTML = `<b>${esc(ev.by)}</b> 에게 찔렸어요`;
      $('dead').hidden = false;
      buzz([120, 60, 120]);
      break;
    case 'spawn':
      $('dead').hidden = true;
      S.killerId = null;
      toast('문 앞에서 다시 태어났어요. 얼른 무리에 섞이세요!', '');
      break;
    case 'go':
      bigText('시작!', true);
      sfx.beep(true);
      break;
    case 'end':
      showResult(ev.rank);
      break;
    case 'round':
      resetMatch();
      $('result').hidden = true;
      $('dead').hidden = true;
      break;
    case 'hello':
      S.pid = ev.pid;
      break;
  }
}

// ───────────────────────── 입력 → 서버 (30Hz) ─────────────────────────
function tickInput() {
  const yaw = input.yaw;
  const fx_ = Math.sin(yaw);
  const fz_ = Math.cos(yaw);
  // 화면 기준 → 월드 방향 (앞 = 카메라가 보는 쪽, 오른쪽 = (-cos, sin))
  const dx = fx_ * input.mz - fz_ * input.mx;
  const dz = fz_ * input.mz + fx_ * input.mx;
  const run = input.running && Math.hypot(input.mx, input.mz) > 0.1;
  const now = performance.now() / 1000;
  let a = input.takeAct();
  const alive = S.mode === 'game' && S.myId !== null && S.pred && S.phase === 'play';
  if (!alive) a = 0;
  const busy = now - S.myActAt < actTime(S.myAct);
  if (a === ACT.STAB) {
    if (S.cd > 0.05 || now < S.stabLock) a = 0;
    else {
      S.stabLock = now + CFG.STAB_CD;
      S.myAct = ACT.STAB;
      S.myActAt = now;
      sfx.whiff();
      buzz(25);
    }
  } else if (a) {
    if (busy) a = 0;
    else {
      S.myAct = a;
      S.myActAt = now;
    }
  }
  S.seq++;
  S.link.send({ t: 'in', s: S.seq, x: +dx.toFixed(3), z: +dz.toFixed(3), r: run ? 1 : 0, a });
  if (alive) {
    const inp = { seq: S.seq, dx, dz, run };
    S.pending.push(inp);
    if (S.pending.length > 90) S.pending.shift();
    stepChicken(S.pred, inp, DT);
  }
}

const actTime = (a) => (a === ACT.STAB ? CFG.STAB_TIME : a === ACT.PECK ? CFG.PECK_TIME : a === ACT.FLAP ? CFG.FLAP_TIME : 0);

function myCode(now) {
  let code;
  if (now - S.myActAt < actTime(S.myAct)) code = S.myAct === ACT.STAB ? ANIM.STAB : S.myAct === ACT.PECK ? ANIM.PECK : ANIM.FLAP;
  else {
    const sp = Math.hypot(S.pred.vx, S.pred.vz);
    code = sp > 3.2 ? ANIM.RUN : sp > 0.25 ? ANIM.WALK : ANIM.IDLE;
  }
  if (S.ex > 0) code |= EXPOSED_BIT;
  return code;
}

// ───────────────────────── 보간 ─────────────────────────
function sampleEnts(now) {
  const snaps = S.snaps;
  if (!snaps.length) return new Map();
  const rt = (now - S.offset - INTERP) * CFG.TICK_RATE; // 서버 틱 단위
  let i = snaps.length - 1;
  while (i > 0 && snaps[i - 1].k > rt) i--;
  // snaps[i-1].k <= rt < snaps[i].k 가 되도록
  if (i === 0 || snaps[snaps.length - 1].k <= rt) return snaps[snaps.length - 1].ents;
  const a = snaps[i - 1];
  const b = snaps[i];
  const t = Math.max(0, Math.min(1, (rt - a.k) / (b.k - a.k)));
  const out = new Map();
  for (const [id, eb] of b.ents) {
    const ea = a.ents.get(id);
    if (!ea) {
      out.set(id, eb);
      continue;
    }
    out.set(id, { x: lerp(ea.x, eb.x, t), z: lerp(ea.z, eb.z, t), yaw: lerpAngle(ea.yaw, eb.yaw, t), code: t < 0.5 ? ea.code : eb.code });
  }
  return out;
}

// ───────────────────────── 그리기 ─────────────────────────
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const desired = new THREE.Vector3();
let ambientT = 1;
let stepT = 0;

function render(dt, now) {
  frameNo++;
  const ents = sampleEnts(now);
  const decay = Math.exp(-dt * 10);
  S.err.x *= decay;
  S.err.z *= decay;

  // 듣는 위치 (소리 크기)
  let lx = 0;
  let lz = 0;
  if (S.myId && S.pred) {
    lx = S.pred.x;
    lz = S.pred.z;
  } else {
    lx = camTarget.x;
    lz = camTarget.z;
  }

  chickens.begin();
  fx.beginMarks();
  let killerPos = null;
  for (const [id, e] of ents) {
    let v = vis.get(id);
    let { x, z, yaw, code } = e;
    const mine = id === S.myId && S.pred;
    if (mine) {
      x = S.pred.x + S.err.x;
      z = S.pred.z + S.err.z;
      yaw = S.pred.yaw;
      code = myCode(now);
    }
    if (!v) {
      v = { anim: code & 7, animAt: now - 5, deadAt: now - 5, phase: Math.random() * 6, px: x, pz: z, seed: (id * 7919) % 100, puffT: 0, mine: false };
      vis.set(id, v);
    }
    v.seen = frameNo;
    const anim = code & 7;
    const dist = Math.hypot(x - lx, z - lz);
    if (anim !== v.anim) {
      if (anim === ANIM.DEAD) {
        v.deadAt = now;
        fx.burst(x, z);
        sfx.squawk(dist);
        sfx.stab(dist);
      } else if (anim === ANIM.PECK || anim === ANIM.FLAP || anim === ANIM.STAB) {
        v.animAt = now;
        if (anim === ANIM.FLAP) {
          sfx.flap(dist);
          fx.puff(x, 0.2, z, 0.6, { life: 0.6 });
        } else if (anim === ANIM.PECK) sfx.peck(dist);
        else {
          fx.slash(x, z, yaw);
          if (!mine) sfx.whiff();
        }
      }
      v.anim = anim;
    }
    const moved = Math.hypot(x - v.px, z - v.pz);
    v.phase += Math.min(moved, 1) * 5.6;
    if (anim === ANIM.RUN && moved > 0.001) {
      v.puffT -= dt;
      if (v.puffT <= 0) {
        v.puffT = 0.1 + Math.random() * 0.04;
        fx.puff(x - Math.sin(yaw) * 0.35 + (Math.random() - 0.5) * 0.3, 0.22, z - Math.cos(yaw) * 0.35, 0.75 + Math.random() * 0.3, { vx: -Math.sin(yaw) * 0.6, vz: -Math.cos(yaw) * 0.6 });
        if (mine) {
          stepT -= 1;
          if (stepT <= 0) (stepT = 2), sfx.step();
        }
      }
    }
    v.px = x;
    v.pz = z;
    const head = chickens.draw({ x, z, yaw, anim, at: now - v.animAt, phase: v.phase, seed: v.seed, deadAt: now - v.deadAt });
    if (head && code & EXPOSED_BIT && anim !== ANIM.DEAD) fx.exclaim(head, now);
    if (mine) {
      fx.meRing.visible = true;
      fx.meRing.position.set(x, 0.05, z);
      fx.meRing.material.opacity = 0.45 + Math.sin(now * 3) * 0.15;
    }
    if (id === S.killerId && !S.myId && anim !== ANIM.DEAD) killerPos = { x, z, head: head?.clone() };
  }
  // 사라진 닭: 쓰러진 닭이 치워질 때 연기
  for (const [id, v] of vis) {
    if (v.seen === frameNo) continue;
    if (v.anim === ANIM.DEAD) for (let i = 0; i < 4; i++) fx.puff(v.px + (Math.random() - 0.5) * 0.8, 0.3, v.pz + (Math.random() - 0.5) * 0.8, 0.9);
    vis.delete(id);
  }
  if (!(S.myId && S.pred)) fx.meRing.visible = false;
  chickens.end();
  fx.endMarks();

  // 범인 표시 (잡힌 동안)
  fx.badRing.visible = fx.arrow.visible = !!killerPos;
  if (killerPos) {
    fx.badRing.position.set(killerPos.x, 0.05, killerPos.z);
    fx.arrow.position.set(killerPos.x, (killerPos.head?.y || 1.8) + 0.45 + Math.sin(now * 6) * 0.08, killerPos.z);
  }

  // 주변 AI 닭 울음 (분위기)
  ambientT -= dt;
  if (ambientT <= 0 && ents.size) {
    ambientT = 0.9 + Math.random() * 1.8;
    const list = [...ents.values()].filter((e) => (e.code & 7) !== ANIM.DEAD);
    const e = list[Math.floor(Math.random() * list.length)];
    if (e) sfx.cluck(Math.hypot(e.x - lx, e.z - lz));
  }

  updateCamera(dt, now, ents, killerPos);
  world.update(dt);
  fx.update(dt, now);
  renderer.render(scene, camera);
}

function updateCamera(dt, now, ents, killerPos) {
  let tx;
  let tz;
  let dist = 5.4;
  let pitch = input.pitch;
  if (S.mode === 'game' && S.myId && S.pred) {
    tx = S.pred.x + S.err.x;
    tz = S.pred.z + S.err.z;
  } else if (S.mode === 'game' && S.body && ents.get(S.body)) {
    const b = ents.get(S.body);
    tx = b.x;
    tz = b.z;
    dist = 6.5;
    // 잠깐 뒤 범인 쪽으로 돌아본다
    if (killerPos && now - S.deadAt > 0.5) {
      const want = Math.atan2(killerPos.x - tx, killerPos.z - tz);
      input.yaw = lerpAngle(input.yaw, want, 1 - Math.exp(-dt * 3));
    }
  } else if (S.mode === 'game') {
    tx = camTarget.x;
    tz = camTarget.z;
  } else {
    // 메뉴: 장터 위를 천천히 돈다
    const a = now * 0.06;
    tx = 2 + Math.sin(a) * 5;
    tz = Math.cos(a) * 5;
    input.yaw = a + Math.PI * 0.8;
    pitch = 0.62;
    dist = 17;
  }
  camTarget.set(tx, 1.0, tz);
  const yaw = input.yaw;
  const hd = Math.cos(pitch) * dist;
  desired.set(tx - Math.sin(yaw) * hd, 1.0 + Math.sin(pitch) * dist, tz - Math.cos(yaw) * hd);
  // 건물에 가리면 카메라를 당긴다
  if (S.mode === 'game') {
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const x = lerp(tx, desired.x, t);
      const z = lerp(tz, desired.z, t);
      const y = lerp(1.0, desired.y, t);
      if (blocked(x, z, 0.25, y - 0.3)) {
        const k = Math.max(0.25, (i - 1) / 12);
        desired.set(lerp(tx, desired.x, k), lerp(1.0, desired.y, k) + 0.3, lerp(tz, desired.z, k));
        break;
      }
    }
  }
  if (S.camSnap) {
    camPos.copy(desired);
    S.camSnap = false;
  } else camPos.lerp(desired, 1 - Math.exp(-dt * 14));
  camera.position.copy(camPos);
  camera.lookAt(camTarget.x, camTarget.y + 0.35, camTarget.z);
}

// ───────────────────────── HUD ─────────────────────────
const feedEl = $('feed');
function addFeed(k, v) {
  const row = document.createElement('div');
  row.className = 'kill';
  const mine = k === S.name || v === S.name;
  if (mine && S.mode === 'game') row.classList.add('me');
  row.innerHTML = `<span translate="no">${esc(k)}</span><i class="skull"></i><span translate="no" class="${v ? '' : 'ai'}">${v ? esc(v) : 'AI'}</span>`;
  feedEl.prepend(row);
  while (feedEl.children.length > 5) feedEl.lastChild.remove();
  setTimeout(() => row.classList.add('fade'), 7000);
  setTimeout(() => row.remove(), 7600);
}

let toastTimer = 0;
function toast(html, kind) {
  const el = $('toast');
  el.innerHTML = html;
  el.className = `show ${kind || ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 2600);
}

function bigText(t, pop) {
  const el = $('big');
  el.textContent = t;
  el.classList.remove('pop');
  void el.offsetWidth;
  if (pop) el.classList.add('pop');
  if (t === '시작!') setTimeout(() => el.textContent === '시작!' && (el.textContent = ''), 900);
}

function buzz(p) {
  try {
    navigator.vibrate?.(p);
  } catch {}
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
let hudT = 0;
function updateHud(dt, now) {
  hudT -= dt;
  if (hudT > 0 || S.mode !== 'game') return;
  hudT = 0.1;
  if (S.phase === 'count') {
    const n = String(Math.max(1, Math.ceil(S.tl)));
    if (S.lastBig !== n) {
      S.lastBig = n;
      bigText(n, true);
      sfx.beep(false);
    }
    $('timer').textContent = fmt(CFG.ROUND_TIME);
  } else {
    S.lastBig = '';
    $('timer').textContent = S.phase === 'play' ? fmt(Math.max(0, S.tl)) : '0:00';
    $('timer').classList.toggle('hurry', S.phase === 'play' && S.tl < 30);
  }
  const me = S.board.find((b) => b.pid === S.pid);
  if (me) $('myScore').innerHTML = `⭐ <b>${me.s}</b><small>🔪${me.k} · 🐔${me.a} · 💀${me.d}</small>`;
  // 찌르기 쿨다운
  const left = Math.max(S.cd, S.stabLock - now);
  const total = S.cd > CFG.STAB_CD ? CFG.PENALTY_CD : CFG.STAB_CD;
  $('cdMask').style.setProperty('--p', left > 0.05 ? `${Math.min(1, left / total) * 360}deg` : '0deg');
  $('stab').classList.toggle('cool', left > 0.05);
  $('exposed').hidden = !(S.ex > 0 && S.myId);
  if (!$('dead').hidden) $('respawn').textContent = S.rs > 0 ? `${S.rs.toFixed(1)}초 뒤 다시 태어나요` : '';
  $('pad').classList.toggle('off', !(S.myId && S.phase === 'play'));
}

function renderBoard(el, rows) {
  el.innerHTML = rows
    .map((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `<em>${i + 1}</em>`;
      return `<div class="row${r.pid === S.pid ? ' me' : ''}"><span class="rank">${medal}</span><span class="nm" translate="no">${esc(r.n)}</span><span class="pt">${r.s}</span><span class="st">${r.k}</span><span class="st">${r.a}</span><span class="st">${r.d}</span></div>`;
    })
    .join('');
}

function showResult(rank) {
  S.ended = true;
  $('board').hidden = true;
  const i = rank.findIndex((r) => r.pid === S.pid);
  const title = i === 0 ? '🏆 우승!' : i > 0 ? `${i + 1}등` : '판 끝';
  $('resultTitle').textContent = title;
  $('resultSub').textContent = i === 0 ? '최고의 연기파 닭이에요' : '다음 판에는 더 감쪽같이!';
  renderBoard($('resultList'), rank);
  $('againBtn').disabled = false;
  $('againBtn').textContent = '▶ 다시 하기';
  $('result').hidden = false;
  $('dead').hidden = true;
  if (i === 0) sfx.good();
}

// ───────────────────────── 메뉴·시트 ─────────────────────────
function openSheet(id) {
  hideSheets();
  $(id).hidden = false;
}
function hideSheets() {
  for (const id of ['help', 'settings', 'board', 'confirm']) $(id).hidden = true;
}
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => (sfx.click(), (b.closest('.sheet').hidden = true)));

$('nameIn').value = prefs.name;
$('soloBtn').addEventListener('click', () => startSolo());
$('onlineBtn').addEventListener('click', () => startOnline());
$('helpBtn').addEventListener('click', () => (sfx.unlock(), sfx.click(), openSheet('help')));
$('setBtn').addEventListener('click', () => (sfx.unlock(), sfx.click(), openSheet('settings')));
$('boardBtn').addEventListener('click', () => {
  if (!$('board').hidden) return ($('board').hidden = true);
  renderBoard($('boardList'), S.board);
  openSheet('board');
});
$('exitBtn').addEventListener('click', () => openSheet('confirm'));
$('confirmYes').addEventListener('click', () => exitGame());
$('againBtn').addEventListener('click', () => {
  S.link?.send({ t: 'again' });
  if (S.online) {
    $('againBtn').disabled = true;
    $('againBtn').textContent = '다른 플레이어를 기다리는 중…';
  }
});
$('leaveBtn').addEventListener('click', () => exitGame());
addEventListener('keydown', (e) => {
  if (S.mode !== 'game' || e.target instanceof HTMLInputElement) return;
  if (e.code === 'Tab') {
    e.preventDefault();
    renderBoard($('boardList'), S.board);
    $('board').hidden = false;
  }
  if (e.code === 'Escape') ($('confirm').hidden = !$('confirm').hidden);
});
addEventListener('keyup', (e) => e.code === 'Tab' && S.mode === 'game' && ($('board').hidden = true));

// 설정
$('sensIn').value = prefs.sens;
$('volIn').value = prefs.vol;
$('serverIn').value = prefs.server;
$('sensIn').addEventListener('input', () => ((prefs.sens = +$('sensIn').value), (input.sens = prefs.sens), savePrefs()));
$('volIn').addEventListener('input', () => ((prefs.vol = +$('volIn').value), (sfx.vol = prefs.vol), savePrefs()));
$('volIn').addEventListener('change', () => (sfx.unlock(), sfx.cluck(0)));
$('serverSave').addEventListener('click', () => {
  const v = normalizeServer($('serverIn').value);
  if ($('serverIn').value.trim() && !v) {
    $('serverNote').textContent = '주소를 알아볼 수 없어요. 예: kkokko-spy.onrender.com';
    return;
  }
  prefs.server = v ? new URL(v).host : '';
  $('serverIn').value = prefs.server;
  savePrefs();
  $('serverNote').textContent = v ? '저장했어요. 메뉴에서 온라인을 누르세요.' : '주소를 지웠어요.';
  $('onlineState').textContent = onlineLabel();
});

// 이 페이지를 게임 서버가 직접 보여 주는지 (그러면 온라인은 같은 주소로)
let servedByGameServer = false;
// 서버에 접속할 수 없는 곳(미리보기 페이지 등)은 <meta name="kkokko-offline"> 로 온라인을 끈다
const OFFLINE_ONLY = !!document.querySelector('meta[name="kkokko-offline"]');
if (OFFLINE_ONLY) $('onlineBtn').disabled = true;
const onlineLabel = () => (OFFLINE_ONLY ? '이 페이지에서는 혼자 하기만' : servedByGameServer || serverOrigin() ? '친구들과 같은 마을에서' : '서버 주소 필요');
fetch(new URL('healthz', location.href), { cache: 'no-store' })
  .then((r) => (r.ok ? r.text() : ''))
  .then((t) => (servedByGameServer = t.trim() === 'ok'))
  .catch(() => {})
  .finally(() => ($('onlineState').textContent = onlineLabel()));

// 첫 터치에 소리 켜기 (브라우저 정책)
addEventListener('pointerdown', () => sfx.unlock(), { once: true });

// ───────────────────────── 루프 ─────────────────────────
let last = performance.now();
let acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  input.update(dt);
  if (S.link && S.mode === 'game') {
    acc = Math.min(acc + dt, 0.25);
    while (acc >= DT) {
      acc -= DT;
      tickInput();
    }
  }
  render(dt, now);
  updateHud(dt, now);
}

startDemo();
if (/[?&]debug\b/.test(location.search)) window.__kkokko = { S, input, camera, vis };
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  $('loading').hidden = true;
});

if ('serviceWorker' in navigator && location.protocol === 'https:' && !/claude|anthropic/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
