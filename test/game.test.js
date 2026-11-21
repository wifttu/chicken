import test from 'node:test';
import assert from 'node:assert/strict';
import { ACT, ANIM, CFG, STAB_TICKS } from '../shared/config.js';
import { OBSTACLES, SPAWNS, blocked, pushOut } from '../shared/map.js';
import { stepChicken } from '../shared/sim.js';
import { Game, cleanName } from '../server/game.js';
import { Hub } from '../server/hub.js';

const DT = 1 / CFG.TICK_RATE;
const play = (g) => {
  while (g.phase !== 'play') g.step();
};
// 사람 하나를 넣고, 받은 메시지를 모은다
function withHuman(opts = {}) {
  const g = new Game({ seed: 1, autoRestart: false, ...opts });
  const got = [];
  const s = g.addHuman({ name: '테스트', session: { send: (m) => got.push(m) } });
  return { g, s, got };
}
const entOf = (g, s) => g.ents.get(s.ent);
const aiNear = (g, e) => [...g.ents.values()].find((o) => !o.slot && o.alive && o !== e);
// a 를 e 바로 앞에 세운다
function putInFront(e, a, d = 1) {
  a.x = e.x + Math.sin(e.yaw) * d;
  a.z = e.z + Math.cos(e.yaw) * d;
}

test('걷는 속도는 AI 와 사람이 같고, 살짝 민 조이스틱은 돌기만 한다', () => {
  const a = { x: 0, z: 3, yaw: 0, vx: 0, vz: 0 };
  for (let i = 0; i < 30; i++) stepChicken(a, { dx: 1, dz: 0 }, DT);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - CFG.WALK) < 0.01);
  const b = { x: 0, z: 3, yaw: 0, vx: 0, vz: 0 };
  for (let i = 0; i < 30; i++) stepChicken(b, { dx: 0.3, dz: 0 }, DT);
  assert.equal(b.x, 0);
  assert.ok(b.yaw > 1.4, '오른쪽으로 돌아본다');
});

test('닭은 건물과 맵 밖으로 들어가지 못한다', () => {
  const barn = OBSTACLES.find((o) => o.kind === 'barn');
  const c = { x: barn.x, z: barn.z + barn.d / 2 + 2, yaw: Math.PI, vx: 0, vz: 0 };
  for (let i = 0; i < 120; i++) stepChicken(c, { dx: 0, dz: -1 }, DT);
  assert.ok(c.z >= barn.z + barn.d / 2 + CFG.RADIUS - 1e-6);
  const p = { x: 99, z: -99 };
  pushOut(p);
  assert.ok(!blocked(p.x, p.z, CFG.RADIUS - 0.01));
  for (const s of SPAWNS) assert.ok(!blocked(s.x, s.z), `문 앞 ${s.kind} 은 비어 있다`);
});

test('스냅샷에는 누가 플레이어인지 드러나지 않는다', () => {
  const { g, got } = withHuman();
  g.step();
  g.step();
  g.broadcast();
  const m = got.at(-1);
  assert.equal(m.e.length % 5, 0);
  assert.equal(m.e.length / 5, CFG.AI_COUNT + CFG.PLAYERS);
  const ids = m.e.filter((_, i) => i % 5 === 0);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'id 순서로 보낸다');
  assert.ok(!JSON.stringify(m).includes('slot'));
  assert.equal(typeof m.y.id, 'number', '내 닭은 알려 준다');
});

test('AI 를 찔러도 점수는 그대로, 대신 들킴, 칼 늦게 돌아옴', () => {
  const { g, s, got } = withHuman();
  play(g);
  const e = entOf(g, s);
  const a = aiNear(g, e);
  putInFront(e, a);
  s.score = 2;
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(a.alive, false);
  assert.equal(s.score, 2, '점수를 깎지 않는다');
  assert.equal(s.aiKills, 1);
  assert.ok(e.exposedT > CFG.EXPOSE_TIME - 0.1);
  assert.ok(e.cd > CFG.STAB_TIME, '칼은 멈춤보다 늦게 돌아온다');
  g.broadcast();
  const ev = got.at(-1).ev;
  assert.ok(ev.some((x) => x.t === 'feed' && x.v === null));
  assert.ok(ev.some((x) => x.t === 'oops'));
  assert.equal(got.at(-1).e[got.at(-1).e.indexOf(e.id) + 4] & 8, 8, '❗ 표시가 실린다');
});

test('플레이어를 찌르면 +1점, 잡힌 쪽은 3초 뒤 문 앞에서 새 닭으로 태어난다', () => {
  const { g, s, got } = withHuman();
  play(g);
  const e = entOf(g, s);
  const vs = g.slots.find((x) => x !== s);
  const v = entOf(g, vs);
  putInFront(e, v, 1.2);
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(v.alive, false);
  assert.equal(s.score, 1);
  assert.equal(vs.deaths, 1);
  g.broadcast();
  assert.ok(got.at(-1).ev.some((x) => x.t === 'got' && x.v === vs.name));
  for (let i = 0; i < CFG.TICK_RATE * (CFG.RESPAWN + 0.2); i++) g.step();
  const n = entOf(g, vs);
  assert.ok(n && n.alive && n.id !== v.id);
  assert.ok(SPAWNS.some((p) => Math.hypot(p.x - n.x, p.z - n.z) < 4), '문 앞에서 태어난다');
});

test('뒤나 멀리 있는 닭은 찔리지 않고, 카운트다운 중에는 칼을 못 쓴다', () => {
  const { g, s } = withHuman();
  const e = entOf(g, s);
  const a = aiNear(g, e);
  putInFront(e, a);
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(a.alive, true, '카운트다운');
  play(g);
  putInFront(e, a, -1);
  g.handle(s, { t: 'in', s: 2, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(a.alive, true, '등 뒤');
  for (let i = 0; i < 30; i++) g.step();
  putInFront(e, a, CFG.STAB_RANGE + 0.4);
  g.handle(s, { t: 'in', s: 3, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(a.alive, true, '너무 멀다');
});

test('닭이 잡히면 근처 AI 닭이 놀라 걸어서 달아난다 (AI 는 뛰지 않는다)', () => {
  const { g, s } = withHuman();
  play(g);
  const e = entOf(g, s);
  const ais = [...g.ents.values()].filter((o) => !o.slot);
  putInFront(e, ais[0]);
  ais[1].x = e.x + 2;
  ais[1].z = e.z;
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.ok(ais[1].panicT > 0);
  const x0 = ais[1].x;
  for (let i = 0; i < 10; i++) g.step();
  assert.equal(g.animOf(ais[1]) & 7, ANIM.WALK);
  assert.ok(ais[1].x - x0 > 0.3, '찔린 곳에서 멀어진다');
});

test('달리기는 플레이어만: 한 판 내내 AI 닭은 한 번도 뛰지 않는다', () => {
  const g = new Game({ seed: 5, autoRestart: false });
  let aiRan = 0;
  let playerRan = 0;
  while (g.phase !== 'end') {
    g.step();
    for (const e of g.ents.values()) {
      if (!e.alive || Math.hypot(e.vx, e.vz) <= CFG.WALK + 0.01) continue;
      if (e.slot) playerRan++;
      else aiRan++;
    }
  }
  assert.equal(aiRan, 0);
  // 사람은 뛸 수 있다
  const { g: g2, s } = withHuman();
  play(g2);
  for (let i = 1; i <= 30; i++) {
    g2.handle(s, { t: 'in', s: i, x: 1, z: 0, r: 1 });
    g2.step();
  }
  assert.ok(Math.hypot(entOf(g2, s).vx, entOf(g2, s).vz) > CFG.RUN - 0.05);
});

test('찌르면 2초 동안 그 자리에 멈춰 칼질을 하고, 그동안 다시 못 찌른다', () => {
  const { g, s } = withHuman();
  play(g);
  const e = entOf(g, s);
  let seq = 0;
  const send = (x, a = 0) => g.handle(s, { t: 'in', s: ++seq, x, z: 0, r: 1, a });
  for (let i = 0; i < 20; i++) send(1), g.step(); // 뛰는 중에
  const x0 = e.x;
  send(1, ACT.STAB);
  g.step();
  assert.equal(e.vx, 0, '그 자리에 딱 멈춘다');
  for (let i = 1; i < STAB_TICKS; i++) {
    send(1, i === 20 ? ACT.STAB : 0);
    g.step();
    if (i < STAB_TICKS - 1) assert.equal(g.animOf(e) & 7, ANIM.STAB);
  }
  assert.equal(e.x, x0, '멈춘 동안은 조이스틱을 밀어도 안 움직인다');
  assert.equal(e.sus >= 4 && e.sus < 8, true, '멈춘 동안 누른 찌르기는 무시된다');
  send(1);
  g.step();
  assert.ok(e.x > x0, '2초가 지나면 다시 움직인다');
  assert.notEqual(g.animOf(e) & 7, ANIM.STAB);
});

test('휴대폰 예측과 서버가 어긋나지 않는다 (입력이 늦게 오거나 몰려 와도)', () => {
  const { g, s } = withHuman();
  play(g);
  const e = entOf(g, s);
  const pred = { x: e.x, z: e.z, yaw: e.yaw, vx: e.vx, vz: e.vz };
  const sent = new Map();
  let seq = 0;
  let lockN = 0;
  // 입력이 0~3개씩 들쭉날쭉 도착한다
  const pattern = [1, 0, 2, 1, 1, 0, 0, 3, 1, 2, 0, 1];
  for (let t = 0; t < 240; t++) {
    for (let k = 0; k < pattern[t % pattern.length]; k++) {
      seq++;
      const a = seq === 50 || seq === 140 ? ACT.STAB : 0;
      if (a) lockN = STAB_TICKS;
      const stop = lockN > 0;
      if (stop) lockN--;
      const ang = seq * 0.05;
      const inp = { dx: stop ? 0 : +Math.sin(ang).toFixed(3), dz: stop ? 0 : +Math.cos(ang).toFixed(3), run: !stop && seq % 40 < 25, stop };
      stepChicken(pred, inp, DT);
      sent.set(seq, { x: pred.x, z: pred.z });
      g.handle(s, { t: 'in', s: seq, x: inp.dx, z: inp.dz, r: inp.run ? 1 : 0, a });
    }
    g.step();
    const want = sent.get(s.ack);
    if (want) {
      assert.equal(e.x, want.x, `x (입력 ${s.ack})`);
      assert.equal(e.z, want.z, `z (입력 ${s.ack})`);
    }
  }
  assert.ok(s.ack > 200 && s.inputs.length <= 3, '밀린 입력은 따라잡는다');
});

test('이상한 입력값은 잘라 낸다', () => {
  const { g, s } = withHuman();
  g.handle(s, { t: 'in', s: 'x', x: 1e9, z: NaN, r: 'yes', a: 99 });
  const q = s.inputs.at(-1);
  assert.deepEqual([q.seq, q.dx, q.dz, q.run, q.act], [0, 1, 0, true, 3]);
  g.handle(s, null);
  g.handle(s, { t: 'in', a: -5 });
  assert.equal(s.inputs.at(-1).act, 0);
});

test('봇만으로 한 판이 끝까지 돌고, 결과에 8명이 있다', () => {
  const g = new Game({ seed: 3, autoRestart: false });
  let n = 0;
  while (g.phase !== 'end' && n++ < CFG.TICK_RATE * (CFG.ROUND_TIME + 10)) g.step();
  assert.equal(g.phase, 'end');
  assert.equal(g.result.length, CFG.PLAYERS);
  const kills = g.slots.reduce((a, s) => a + s.kills + s.aiKills, 0);
  assert.ok(kills > 5, `봇들이 칼을 쓴다 (${kills})`);
  // AI 수는 계속 유지된다 (잡힌 AI 는 다시 태어난다)
  const ai = [...g.ents.values()].filter((e) => !e.slot && e.alive).length + g.aiQueue.length;
  assert.ok(ai >= CFG.AI_COUNT - 3);
});

test('혼자 하기: 다시 하기를 누르면 바로 새 판', () => {
  const { g, s } = withHuman();
  g.endRound();
  g.handle(s, { t: 'again' });
  assert.equal(g.phase, 'count');
  assert.equal(g.round, 2);
});

test('사람은 봇 자리와 그 닭을 이어받고, 나가면 봇이 다시 맡는다', () => {
  const g = new Game({ seed: 4 });
  const bot = g.slots[2];
  const ent = bot.ent;
  const s = g.addHuman({ name: ' 꼬꼬 ', session: { send() {} } });
  assert.equal(s, g.slots[0]);
  assert.equal(g.humanCount, 1);
  const s2 = g.addHuman({ name: '꼬꼬', session: { send() {} } });
  assert.equal(s2.name, '꼬꼬2');
  g.removeHuman(s);
  assert.ok(s.bot);
  assert.equal(g.humanCount, 1);
  assert.equal(bot.ent, ent);
});

test('온라인: 8명이 차면 새 방을 연다', () => {
  const hub = new Hub();
  const sessions = Array.from({ length: 9 }, () => ({ send() {} }));
  for (const [i, ss] of sessions.entries()) hub.handle(ss, { t: 'join', name: `p${i}` });
  assert.equal(hub.rooms.length, 2);
  assert.equal(sessions[8].game, hub.rooms[1]);
  hub.leave(sessions[8]);
  assert.equal(hub.rooms.length, 1);
});

test('이름 정리', () => {
  assert.equal(cleanName('  <b>닭</b>  '), 'b닭/b');
  assert.equal(cleanName('a'.repeat(30)).length, 12);
  assert.match(cleanName(''), /^닭\d+$/);
});
