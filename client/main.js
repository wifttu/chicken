// 꼬꼬 스파이 클라이언트: 렌더링, 내 닭 예측, 다른 닭 보간, 화면 표시(HUD), 메뉴.
import * as THREE from 'three';
import { ACT, ANIM, CFG, STAB_TICKS, wrapAngle } from './shared/config.js';
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
const MOBILE = matchMedia('(pointer: coarse)').matches;
const IS_APP = !!window.Capacitor?.isNativePlatform?.(); // 안드로이드 앱(Capacitor) 안
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// 해상도: 휴대폰은 최대 1.75배, 프레임이 떨어지면 스스로 낮춘다 (아래 adaptRes)
const PR_CAP = MOBILE ? 1.75 : 2;
let resScale = 1;
const applyPixelRatio = () => renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PR_CAP) * resScale);
applyPixelRatio();
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
sun.shadow.mapSize.setScalar(MOBILE ? 1024 : 2048);
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
  pred: null, // 내 닭 (예측, 30Hz 틱마다)
  prev: null, // 바로 앞 틱의 내 닭: 화면은 prev → pred 사이를 이어 그린다 (프레임마다 부드럽게)
  pending: [],
  seq: 0,
  err: { x: 0, z: 0 }, // 서버 보정으로 생긴 차이 (조금씩 줄인다)
  cd: 0,
  lockN: 0, // 찌르는 중: 남은 멈춤 (입력 수, 서버와 똑같이 센다)
  spec: [], // 관전: 살아 있는 플레이어 [id, 이름, 잡은 수] (잡힌 뒤에만 서버가 알려 준다)
  specId: null,
  spectating: false,
  aliveN: 0,
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
const killedBy = new Map(); // 잡힌 이름 → 잡은 이름 (이번 판)
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
  $('hud').classList.remove('spectating', 'out');
  $('spec').hidden = true;
  input.lookOnly = false;
  S.snaps = [];
  S.offset = null;
  S.myId = null;
  S.body = null;
  S.pred = null;
  S.prev = null;
  S.pending = [];
  S.lockN = 0;
  S.err = { x: 0, z: 0 };
  S.ended = false;
  S.board = [];
  S.killerId = null;
  S.spec = [];
  S.specId = null;
  S.specName = '';
  S.spectating = false;
  S.deadAt = 0;
  killedBy.clear();
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
  $('hint').textContent = MOBILE ? '왼쪽을 끌어 걷고, 오른쪽을 끌어 둘러보세요' : 'WASD 걷기 · 마우스 끌기 둘러보기 · Space 찌르기 · Shift 달리기';
  $('hint').hidden = false;
  setTimeout(() => ($('hint').hidden = true), 7000);
  input.enabled = true;
  input.reset();
  hideSheets();
  goFullscreen();
  keepAwake(true);
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
  keepAwake(false);
  startDemo();
}

// 게임 중에는 화면이 꺼지지 않게 (지원하는 브라우저만)
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && S.mode === 'game' && keepAwake(true));

function goFullscreen() {
  if (!MOBILE || IS_APP) return; // 앱은 처음부터 전체 화면
  if (document.fullscreenElement) return;
  try {
    const p = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch {}
}
// 주소창·내비게이션 바가 다시 나타나면(화면 가장자리를 쓸어서 풀린 경우 등) 다음에 화면을 건드릴 때 다시 전체 화면으로
for (const ev of ['pointerup', 'touchend']) addEventListener(ev, () => S.mode === 'game' && goFullscreen(), { passive: true });

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
  if (m.al !== undefined) S.aliveN = m.al;
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
      S.prev = { x: y.x, z: y.z, yaw: y.yaw };
      S.lockN = 0;
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
    const oyaw = S.pred.yaw;
    Object.assign(S.pred, { x: y.x, z: y.z, yaw: y.yaw, vx: y.vx, vz: y.vz });
    for (const p of S.pending) stepChicken(S.pred, p, DT);
    // 서버와 어긋난 만큼은 err 로 받아 조금씩 줄인다 (보통은 0). 앞 틱(prev)도 같이 옮겨 화면이 튀지 않게
    const dx = S.pred.x - ox;
    const dz = S.pred.z - oz;
    S.err.x -= dx;
    S.err.z -= dz;
    S.prev.x += dx;
    S.prev.z += dz;
    S.prev.yaw += wrapAngle(S.pred.yaw - oyaw);
    if (Math.hypot(S.err.x, S.err.z) > 2) S.err = { x: 0, z: 0 };
  }
  S.body = y.body ?? null;
  S.spec = y.spec || [];
  S.cd = y.cd ?? 0;
}

function onEvent(ev) {
  switch (ev.t) {
    case 'feed':
      addFeed(ev.k, ev.v);
      if (ev.v) killedBy.set(ev.v, ev.k); // 관전: 보던 닭이 잡히면 범인으로 넘어간다
      break;
    case 'oops':
      toast(`AI 였어요 · 칼을 ${CFG.PENALTY_CD}초 동안 못 써요`, 'bad');
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
      S.specId = ev.kid; // 관전은 나를 찌른 닭부터
      buzz([120, 60, 120]);
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
  let dx = fx_ * input.mz - fz_ * input.mx;
  let dz = fz_ * input.mz + fx_ * input.mx;
  let run = input.running && Math.hypot(input.mx, input.mz) > 0.1;
  const now = performance.now() / 1000;
  let a = input.takeAct();
  const alive = S.mode === 'game' && S.myId !== null && S.pred && S.phase === 'play';
  if (!alive) a = 0;
  const busy = S.lockN > 0 || now - S.myActAt < actTime(S.myAct);
  if (a === ACT.STAB) {
    if (S.cd > 0 || S.lockN > 0) a = 0;
    else {
      S.lockN = STAB_TICKS; // 찌른 이 입력부터 멈춘다 (서버도 똑같이 센다)
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
  // 찌르는 중이거나 살아 있지 않으면 움직이지 않는다
  const stop = alive && S.lockN > 0;
  if (stop) S.lockN--;
  if (stop || !alive) {
    dx = dz = 0;
    run = false;
  }
  S.seq++;
  S.link.send({ t: 'in', s: S.seq, x: +dx.toFixed(3), z: +dz.toFixed(3), r: run ? 1 : 0, a });
  if (alive) {
    // 서버가 받는 값(소수 셋째 자리)과 똑같이 예측해야 어긋나지 않는다
    const inp = { seq: S.seq, dx: +dx.toFixed(3), dz: +dz.toFixed(3), run, stop };
    S.pending.push(inp);
    if (S.pending.length > 90) S.pending.shift();
    S.prev.x = S.pred.x;
    S.prev.z = S.pred.z;
    S.prev.yaw = S.pred.yaw;
    stepChicken(S.pred, inp, DT);
  }
}

const actTime = (a) => (a === ACT.PECK ? CFG.PECK_TIME : a === ACT.FLAP ? CFG.FLAP_TIME : 0);

function myCode(now) {
  let code;
  if (S.myAct === ACT.STAB && S.lockN > 0) code = ANIM.STAB;
  else if (S.myAct !== ACT.STAB && now - S.myActAt < actTime(S.myAct)) code = S.myAct === ACT.PECK ? ANIM.PECK : ANIM.FLAP;
  else {
    const sp = Math.hypot(S.pred.vx, S.pred.vz);
    code = sp > 3.2 ? ANIM.RUN : sp > 0.25 ? ANIM.WALK : ANIM.IDLE;
  }
  return code;
}

// ───────────────────────── 보간 ─────────────────────────
// 내 닭: 30Hz 틱 사이를 프레임마다 이어 그린다 (60·90·120Hz 화면에서도 매 프레임 조금씩 움직인다)
let tickAlpha = 1;
const myPos = { x: 0, z: 0, yaw: 0 };
function updateMyPos() {
  const p = S.prev || S.pred;
  myPos.x = lerp(p.x, S.pred.x, tickAlpha) + S.err.x;
  myPos.z = lerp(p.z, S.pred.z, tickAlpha) + S.err.z;
  myPos.yaw = lerpAngle(p.yaw, S.pred.yaw, tickAlpha);
}

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
  if (S.pred) updateMyPos();

  // 듣는 위치 (소리 크기)
  let lx = 0;
  let lz = 0;
  if (S.myId && S.pred) {
    lx = myPos.x;
    lz = myPos.z;
  } else {
    lx = camTarget.x;
    lz = camTarget.z;
  }

  chickens.begin();
  let killerPos = null;
  let specPos = null;
  for (const [id, e] of ents) {
    let v = vis.get(id);
    let { x, z, yaw, code } = e;
    const mine = id === S.myId && S.pred;
    if (mine) {
      x = myPos.x;
      z = myPos.z;
      yaw = myPos.yaw;
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
          if (!mine) sfx.whiff(dist);
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
    if (mine) {
      fx.meRing.visible = true;
      fx.meRing.position.set(x, 0.05, z);
      fx.meRing.material.opacity = 0.45 + Math.sin(now * 3) * 0.15;
    }
    if (id === S.killerId && !S.myId && !S.spectating && anim !== ANIM.DEAD) killerPos = { x, z, head: head?.clone() };
    if (S.spectating && id === S.specId && anim !== ANIM.DEAD) specPos = { x, z };
  }
  // 사라진 닭: 쓰러진 닭이 치워질 때 연기
  for (const [id, v] of vis) {
    if (v.seen === frameNo) continue;
    if (v.anim === ANIM.DEAD) for (let i = 0; i < 4; i++) fx.puff(v.px + (Math.random() - 0.5) * 0.8, 0.3, v.pz + (Math.random() - 0.5) * 0.8, 0.9);
    vis.delete(id);
  }
  if (!(S.myId && S.pred)) fx.meRing.visible = !!specPos;
  if (specPos) {
    // 관전 중인 닭 발밑 고리
    fx.meRing.position.set(specPos.x, 0.05, specPos.z);
    fx.meRing.material.opacity = 0.45 + Math.sin(now * 3) * 0.15;
  }
  chickens.end();

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

  updateCamera(dt, now, ents, killerPos, specPos);
  world.update(dt);
  fx.update(dt, now);
  renderer.render(scene, camera);
}

function updateCamera(dt, now, ents, killerPos, specPos) {
  let tx;
  let tz;
  let dist = 5.9;
  let pitch = input.pitch;
  if (S.mode === 'game' && S.myId && S.pred) {
    tx = myPos.x;
    tz = myPos.z;
  } else if (S.mode === 'game' && specPos) {
    // 관전: 고른 플레이어의 닭을 따라간다 (둘러보기는 화면 끌기)
    tx = specPos.x;
    tz = specPos.z;
  } else if (S.mode === 'game' && S.body && ents.get(S.body)) {
    const b = ents.get(S.body);
    tx = b.x;
    tz = b.z;
    dist = 6.8;
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
  const ty = S.mode === 'game' ? 1.35 : 1.0; // 닭 가슴 높이
  camTarget.set(tx, ty, tz);
  const yaw = input.yaw;
  const hd = Math.cos(pitch) * dist;
  desired.set(tx - Math.sin(yaw) * hd, ty + Math.sin(pitch) * dist, tz - Math.cos(yaw) * hd);
  // 건물에 가리면 카메라를 당긴다
  if (S.mode === 'game') {
    for (let i = 1; i <= 12; i++) {
      const t = i / 12;
      const x = lerp(tx, desired.x, t);
      const z = lerp(tz, desired.z, t);
      const y = lerp(ty, desired.y, t);
      if (blocked(x, z, 0.25, y - 0.3)) {
        const k = Math.max(0.25, (i - 1) / 12);
        desired.set(lerp(tx, desired.x, k), lerp(ty, desired.y, k) + 0.3, lerp(tz, desired.z, k));
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
  if (me) $('myScore').innerHTML = `⭐ <b>${me.s}</b><small>🐔${me.a}</small>`;
  $('alive').innerHTML = `👤 <b>${S.aliveN}</b><small>남음</small>`;
  updateSpectate(now);
  // 찌르기: 멈춰 있는 시간(그동안 다시 못 찌른다), AI 를 찔렀으면 더 길게
  const left = Math.max(S.cd, S.lockN * DT);
  const total = S.cd > 0.05 ? CFG.PENALTY_CD : CFG.STAB_TIME;
  $('cdMask').style.setProperty('--p', left > 0.05 ? `${Math.min(1, left / total) * 360}deg` : '0deg');
  $('stab').classList.toggle('cool', left > 0.05);
  $('pad').classList.toggle('off', !(S.myId && S.phase === 'play'));
  $('hud').classList.toggle('out', !S.myId && S.phase === 'play' && S.snaps.length > 0); // 잡혔다
}

function renderBoard(el, rows) {
  el.innerHTML = rows
    .map((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `<em>${i + 1}</em>`;
      const state = r.al ? '<b class="alive">생존</b>' : '💀';
      return `<div class="row${r.pid === S.pid ? ' me' : ''}${r.al ? '' : ' out'}"><span class="rank">${medal}</span><span class="nm" translate="no">${esc(r.n)}</span><span class="pt">${r.s}</span><span class="st">${r.a}</span><span class="st">${state}</span></div>`;
    })
    .join('');
}

function showResult(rank) {
  S.ended = true;
  $('board').hidden = true;
  const i = rank.findIndex((r) => r.pid === S.pid);
  const title = i === 0 ? '🏆 최후의 닭!' : i > 0 ? `${i + 1}등` : '판 끝';
  $('resultTitle').textContent = title;
  const survivors = rank.filter((r) => r.al).length;
  $('resultSub').textContent = i === 0 ? (survivors === 1 ? '끝까지 살아남았어요' : '살아남은 닭 중 가장 많이 잡았어요') : '다음 판에는 더 감쪽같이!';
  renderBoard($('resultList'), rank);
  $('againBtn').disabled = false;
  $('againBtn').textContent = '▶ 다시 하기';
  $('result').hidden = false;
  $('dead').hidden = true;
  if (i === 0) sfx.good();
}

// ───────────────────────── 관전 (잡힌 뒤) ─────────────────────────
// 잡히면 2.5초 동안 쓰러진 내 닭과 범인을 보여 주고, 그 뒤 살아 있는 플레이어를 따라간다
function updateSpectate(now) {
  const on = S.mode === 'game' && !S.myId && S.spec.length > 0 && S.phase !== 'end' && now - S.deadAt > 2.5;
  if (on !== S.spectating) {
    S.spectating = on;
    $('hud').classList.toggle('spectating', on);
    input.lookOnly = on;
    if (on) $('dead').hidden = true;
  }
  $('spec').hidden = !on;
  if (!on) return;
  if (!S.spec.some((p) => p[0] === S.specId)) {
    // 보던 닭이 잡혔으면 그 닭을 잡은 닭으로 (모르면 남은 사람 중 첫 번째)
    const killer = killedBy.get(S.specName);
    S.specId = (S.spec.find((q) => q[1] === killer) || S.spec[0])[0];
  }
  const p = S.spec.find((q) => q[0] === S.specId);
  S.specName = p[1];
  $('specName').textContent = p[1];
  $('specInfo').textContent = `🔪 ${p[2]} · ${S.spec.indexOf(p) + 1}/${S.spec.length}`;
  $('specAgain').hidden = S.online;
}
function cycleSpec(d) {
  if (!S.spectating || !S.spec.length) return;
  sfx.click();
  const i = Math.max(0, S.spec.findIndex((q) => q[0] === S.specId));
  S.specId = S.spec[(i + d + S.spec.length) % S.spec.length][0];
  S.camSnap = true;
  updateSpectate(performance.now() / 1000);
}
$('specPrev').addEventListener('click', () => cycleSpec(-1));
$('specNext').addEventListener('click', () => cycleSpec(1));
$('specAgain').addEventListener('click', () => (sfx.click(), S.link?.send({ t: 'again' })));

// ───────────────────────── 메뉴·시트 ─────────────────────────
function openSheet(id) {
  hideSheets();
  $(id).hidden = false;
}
function hideSheets() {
  for (const id of ['help', 'settings', 'board', 'confirm', 'install']) $(id).hidden = true;
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
  if (S.spectating && (e.code === 'KeyA' || e.code === 'KeyD')) cycleSpec(e.code === 'KeyA' ? -1 : 1);
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

// ───────────────────────── 휴대폰: 앱 설치, 뒤로 가기 ─────────────────────────
let installEvent = null;
const IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const STANDALONE = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  if (!OFFLINE_ONLY) $('installBtn').hidden = false;
});
if (IOS && !STANDALONE && !IS_APP && !OFFLINE_ONLY) $('installBtn').hidden = false;
$('installBtn').addEventListener('click', async () => {
  sfx.click();
  if (installEvent) {
    installEvent.prompt();
    const r = await installEvent.userChoice.catch(() => null);
    if (r?.outcome === 'accepted') $('installBtn').hidden = true;
    installEvent = null;
  } else openSheet('install');
});
addEventListener('appinstalled', () => ($('installBtn').hidden = true));

// 안드로이드 앱의 뒤로 가기: 열린 창 닫기 → 게임 중이면 나가기 확인 → 메뉴면 앱 끄기
const NativeApp = window.Capacitor?.Plugins?.App;
NativeApp?.addListener?.('backButton', () => {
  const open = [...document.querySelectorAll('.sheet')].find((el) => !el.hidden && el.id !== 'result');
  if (open) open.hidden = true;
  else if (S.mode === 'game') openSheet('confirm');
  else NativeApp.exitApp();
});

// ───────────────────────── 루프 ─────────────────────────
let last = performance.now();
let acc = 0;
// 프레임이 낮으면 해상도를 낮추고, 넉넉하면 천천히 되돌린다
let fpsT = 0;
let fpsN = 0;
let fpsGood = 0;
function adaptRes(dt) {
  fpsT += dt;
  fpsN++;
  if (fpsT < 2) return;
  const fps = fpsN / fpsT;
  fpsT = fpsN = 0;
  if (document.visibilityState !== 'visible') return;
  if (fps < 40 && resScale > 0.55) {
    resScale = Math.max(0.55, resScale - 0.15);
    fpsGood = 0;
    applyPixelRatio();
    resize();
  } else if (fps > 57 && resScale < 1 && ++fpsGood >= 2) {
    resScale = Math.min(1, resScale + 0.1);
    fpsGood = 0;
    applyPixelRatio();
    resize();
  }
}
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
    tickAlpha = acc / DT;
  } else tickAlpha = 1;
  render(dt, now);
  updateHud(dt, now);
  adaptRes(dt);
}

startDemo();
if (/[?&]debug\b/.test(location.search)) window.__kkokko = { S, input, camera, vis, renderer };
requestAnimationFrame((t) => {
  last = t;
  frame(t);
  $('loading').hidden = true;
});

if ('serviceWorker' in navigator && location.protocol === 'https:' && !IS_APP && !/claude|anthropic/.test(location.hostname)) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
