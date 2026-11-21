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
// 찌른 뒤 칼이 쭉 나가 맞을 때까지
const hit = (g) => {
  for (let i = 0; i <= Math.ceil(CFG.STAB_HIT * CFG.TICK_RATE); i++) g.step();
};
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

test('AI 를 찔러도 점수는 그대로, 아무 표시도 없음, 칼만 늦게 돌아옴', () => {
  const { g, s, got } = withHuman();
  play(g);
  const e = entOf(g, s);
  const a = aiNear(g, e);
  putInFront(e, a);
  s.score = 2;
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  hit(g);
  assert.equal(a.alive, false);
  assert.equal(s.score, 2, '점수를 깎지 않는다');
  assert.equal(s.aiKills, 1);
  assert.ok(e.cd > CFG.STAB_TIME, '칼은 멈춤보다 늦게 돌아온다');
  g.broadcast();
  const ev = got.at(-1).ev;
  assert.ok(!ev.some((x) => x.t === 'feed'), '킬 소식에도 안 뜬다');
  assert.ok(ev.some((x) => x.t === 'oops'), '찌른 사람에게만 알려 준다');
  for (let i = 0; i < STAB_TICKS + 2; i++) g.step();
  g.broadcast();
  const snap = got.at(-1).e;
  assert.equal(snap[snap.indexOf(e.id) + 4], ANIM.IDLE, '머리 위 표시 없이 평범한 닭으로 보인다');
});

test('데스매치: 플레이어를 찌르면 +1점, 잡힌 쪽은 다시 태어나지 않고 살아 있는 플레이어를 관전한다', () => {
  const { g, s, got } = withHuman();
  play(g);
  const e = entOf(g, s);
  const vs = g.slots.find((x) => x !== s);
  const v = entOf(g, vs);
  putInFront(e, v, 1.2);
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  hit(g);
  assert.equal(v.alive, false);
  assert.equal(s.score, 1);
  assert.equal(vs.deaths, 1);
  g.broadcast();
  assert.ok(got.at(-1).ev.some((x) => x.t === 'got' && x.v === vs.name));
  assert.equal(got.at(-1).al, CFG.PLAYERS - 1, '남은 플레이어 수');
  assert.equal(got.at(-1).y.spec, undefined, '살아 있는 사람은 누가 플레이어인지 모른다');
  for (let i = 0; i < CFG.TICK_RATE * 6; i++) g.step();
  assert.ok(!entOf(g, vs)?.alive, '다시 태어나지 않는다');
  // 내가 잡히면: 관전 목록(살아 있는 플레이어의 닭)을 받는다
  const k = g.slots.find((x) => x !== s && g.isAlive(x));
  g.kill(e, entOf(g, k));
  got.length = 0;
  g.step();
  g.step();
  g.broadcast();
  const spec = got.at(-1).y.spec;
  assert.equal(spec.length, g.alivePlayers);
  for (const [id] of spec) assert.ok(g.ents.get(id).slot, '관전 목록에는 플레이어만');
  assert.ok(spec.some(([id]) => id === k.ent));
});

test('데스매치: AI 닭은 잡히면 그대로 줄고, 플레이어가 한 명만 남으면 판이 끝나며 그 닭이 1등', () => {
  const { g, s } = withHuman();
  play(g);
  const e = entOf(g, s);
  const ai0 = [...g.ents.values()].filter((o) => !o.slot && o.alive).length;
  g.kill(aiNear(g, e), e);
  for (let i = 0; i < CFG.TICK_RATE * 10; i++) g.step();
  assert.equal([...g.ents.values()].filter((o) => !o.slot && o.alive).length, ai0 - 1, 'AI 는 다시 태어나지 않는다');
  for (const o of g.slots) if (o !== s && g.isAlive(o)) g.kill(entOf(g, o), e);
  assert.equal(g.alivePlayers, 1);
  for (let i = 0; i < CFG.TICK_RATE * (CFG.FINISH_DELAY + 0.2); i++) g.step();
  assert.equal(g.phase, 'end');
  assert.equal(g.result[0].pid, s.pid);
  assert.equal(g.result[0].al, 1);
});

test('혼자 하기: 잡혀서 관전 중이면 새 판을 바로 시작할 수 있다', () => {
  const { g, s } = withHuman();
  play(g);
  g.handle(s, { t: 'again' });
  assert.equal(g.round, 1, '살아 있으면 안 된다');
  g.kill(entOf(g, s), entOf(g, g.slots.find((x) => x !== s)));
  g.handle(s, { t: 'again' });
  assert.equal(g.round, 2);
  assert.ok(g.isAlive(s));
});

test('뒤나 멀리 있는 닭은 찔리지 않고, 카운트다운 중에는 칼을 못 쓴다', () => {
  const { g, s } = withHuman();
  const e = entOf(g, s);
  const a = aiNear(g, e);
  putInFront(e, a);
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  hit(g);
  assert.equal(a.alive, true, '카운트다운');
  play(g);
  putInFront(e, a, -1);
  g.handle(s, { t: 'in', s: 2, x: 0, z: 0, a: ACT.STAB });
  hit(g);
  assert.equal(a.alive, true, '등 뒤');
  for (let i = 0; i < 40; i++) g.step();
  putInFront(e, a, CFG.STAB_RANGE + 0.4);
  g.handle(s, { t: 'in', s: 3, x: 0, z: 0, a: ACT.STAB });
  hit(g);
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
  hit(g);
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

test('찌르면 1초 동안 그 자리에 멈춰 칼을 한 번 찌르고, 그동안 다시 못 찌른다', () => {
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
    send(1, i === 10 ? ACT.STAB : 0);
    g.step();
    if (i < STAB_TICKS - 1) assert.equal(g.animOf(e) & 7, ANIM.STAB);
  }
  assert.equal(e.x, x0, '멈춘 동안은 조이스틱을 밀어도 안 움직인다');
  assert.equal(e.sus >= 4 && e.sus < 8, true, '멈춘 동안 누른 찌르기는 무시된다');
  send(1);
  g.step();
  assert.ok(e.x > x0, '1초가 지나면 다시 움직인다');
  assert.notEqual(g.animOf(e) & 7, ANIM.STAB);
});

test('칼은 누른 순간이 아니라 쭉 나가는 순간에 맞는다 (그 사이에 비켜나면 빗나간다)', () => {
  const { g, s } = withHuman();
  play(g);
  const e = entOf(g, s);
  const a = aiNear(g, e);
  putInFront(e, a);
  g.handle(s, { t: 'in', s: 1, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(a.alive, true, '아직 칼을 젖히는 중');
  hit(g);
  assert.equal(a.alive, false);
  // 젖히는 동안 비켜나면 빗나간다 (멈춤과 AI 를 찌른 벌칙이 풀릴 때까지 3초 기다린다)
  let seq = 1;
  for (let i = 0; i < CFG.TICK_RATE * 3; i++) g.handle(s, { t: 'in', s: ++seq, x: 0, z: 0 }), g.step();
  const b = aiNear(g, e);
  putInFront(e, b);
  g.handle(s, { t: 'in', s: ++seq, x: 0, z: 0, a: ACT.STAB });
  g.step();
  assert.equal(e.act, ACT.STAB, '두 번째 찌르기가 시작됐다');
  putInFront(e, b, 3);
  hit(g);
  assert.equal(b.alive, true);
});

test('휴대폰 예측과 서버가 어긋나지 않는다 (입력이 늦게 오거나 몰려 와도)', () => {
  const { g, s } = withHuman({ players: 1 }); // 봇에게 찔리지 않게 혼자
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
  // AI 는 잡힌 만큼 줄어든다
  const aiKills = g.slots.reduce((a, s) => a + s.aiKills, 0);
  assert.equal([...g.ents.values()].filter((e) => !e.slot && e.alive).length, CFG.AI_COUNT - aiKills);
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

test('온라인: 잠깐 끊겨도 같은 열쇠로 돌아오면 같은 닭, 일부러 나가면 봇이 이어받는다', () => {
  const hub = new Hub();
  const a = { send() {} };
  const tok = 'abcdefgh12345678';
  hub.handle(a, { t: 'join', name: '하나', tok });
  const g = a.game;
  const slot = a.slot;
  const ent = slot.ent;
  hub.leave(a); // 끊김
  assert.equal(slot.bot, null, '자리를 맡아 둔다');
  assert.equal(g.humanCount, 1);
  const b = { send() {} };
  hub.handle(b, { t: 'join', name: '하나', tok });
  assert.equal(b.slot, slot);
  assert.equal(slot.ent, ent, '같은 닭');
  assert.equal(slot.session, b);
  hub.leave(a); // 옛 연결이 늦게 끊겨도 아무 일 없다
  assert.equal(slot.session, b);
  // 망이 바뀌어 옛 연결이 살아 있는데 새 연결이 오면 넘겨받는다
  const c = { send() {} };
  hub.handle(c, { t: 'join', name: '하나', tok });
  assert.equal(c.slot, slot);
  assert.equal(b.slot, null);
  // 일부러 나가면 바로 봇이 맡는다
  hub.handle(c, { t: 'bye' });
  assert.ok(slot.bot);
  assert.equal(g.humanCount, 0);
});

test('온라인: 친구 방은 코드로만 들어가고, 없는 코드면 알려 준다', () => {
  const hub = new Hub();
  const got = [];
  const a = { send: (m) => got.push(m) };
  hub.handle(a, { t: 'join', name: '방장', room: 'new' });
  const code = got.find((m) => m.t === 'room').code;
  assert.match(code, /^\d{4}$/);
  const b = { send() {} };
  hub.handle(b, { t: 'join', name: '친구', room: code });
  assert.equal(b.game, a.game);
  const c = { send() {} };
  hub.handle(c, { t: 'join', name: '모르는 사람' });
  assert.notEqual(c.game, a.game, '아무 방으로 온 사람은 친구 방에 안 들어간다');
  const errs = [];
  const d = { send: (m) => errs.push(m) };
  hub.handle(d, { t: 'join', name: 'x', room: code === '0000' ? '0001' : '0000' });
  assert.equal(errs[0].t, 'err');
  assert.equal(d.slot, undefined);
});

test('친구 방: 대기실에 모였다가 방장만 시작할 수 있고, 판이 끝나면 대기실로 돌아온다', () => {
  const hub = new Hub();
  const ga = [];
  const a = { send: (m) => ga.push(m) };
  hub.handle(a, { t: 'join', name: '방장', room: 'new' });
  const g = a.game;
  const code = ga.find((m) => m.t === 'room').code;
  const gb = [];
  const b = { send: (m) => gb.push(m) };
  hub.handle(b, { t: 'join', name: '친구', room: code });
  for (let i = 0; i < 30; i++) g.step();
  assert.equal(g.phase, 'lobby', '방장이 누르기 전에는 시작하지 않는다');
  g.broadcast();
  const lb = gb.at(-1).lb;
  assert.equal(lb.h, a.slot.pid);
  assert.deepEqual(lb.p.map((p) => p[1]), ['방장', '친구']);
  hub.handle(b, { t: 'start' });
  assert.equal(g.phase, 'lobby', '방장이 아니면 시작 못 한다');
  hub.handle(a, { t: 'start' });
  assert.equal(g.phase, 'count');
  assert.equal(g.slots.length, CFG.PLAYERS, '빈 자리는 봇이 채운다');
  g.endRound();
  hub.handle(b, { t: 'again' });
  assert.equal(g.phase, 'end');
  hub.handle(a, { t: 'again' });
  assert.equal(g.phase, 'lobby', '방장이 누르면 대기실로');
  // 방장이 나가면 친구가 방장
  hub.handle(a, { t: 'bye' });
  assert.equal(g.hostPid, b.slot.pid);
  // 결과를 다 보여 주면 저절로 대기실로
  hub.handle(b, { t: 'start' });
  g.endRound();
  for (let i = 0; i <= CFG.TICK_RATE * CFG.END_TIME + 2; i++) g.step();
  assert.equal(g.phase, 'lobby');
});

test('혼자 하기 난이도: 어려운 봇이 더 잘 알아챈다', () => {
  const easy = new Game({ seed: 9, level: 'easy' });
  const hard = new Game({ seed: 9, level: 'hard' });
  const avg = (g) => g.slots.reduce((a, s) => a + s.bot.skill, 0) / g.slots.length;
  assert.ok(avg(hard) > avg(easy) + 0.3);
});

test('이름 정리', () => {
  assert.equal(cleanName('  <b>닭</b>  '), 'b닭/b');
  assert.equal(cleanName('a'.repeat(30)).length, 12);
  assert.match(cleanName(''), /^닭\d+$/);
});
