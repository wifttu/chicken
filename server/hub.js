// 온라인 방 관리: 사람 8명까지 한 방(마을). 자리가 차면 새 방을 연다. 빈 자리는 봇이 채운다.
// - 공개 방: "아무 방"으로 들어온 사람들끼리
// - 친구 방: 방 만들기로 4자리 코드를 받고, 친구가 그 코드로 들어온다
// - 끊김: 연결이 끊겨도 GRACE 동안은 자리(그 닭)를 맡아 둔다. 같은 열쇠(tok)로 다시 붙으면 그대로 이어서 한다
import { CFG } from '../shared/config.js';
import { Game } from './game.js';

export const GRACE_MS = 20_000;
const TOK = /^[A-Za-z0-9_-]{8,64}$/;

export class Hub {
  constructor() {
    this.rooms = [new Game()]; // 공개 방
    this.priv = new Map(); // 코드 → 친구 방
    this.away = new Map(); // 열쇠 → { game, slot, timer }
  }

  *all() {
    yield* this.rooms;
    yield* this.priv.values();
  }

  newCode() {
    for (;;) {
      const c = String(Math.floor(1000 + Math.random() * 9000));
      if (!this.priv.has(c)) return c;
    }
  }

  // room: '' (아무 방) | 'new' (친구 방 만들기) | '1234' (코드로 들어가기)
  join(session, name, tok, room) {
    tok = typeof tok === 'string' && TOK.test(tok) ? tok : null;
    // 끊겼던 사람이 돌아왔다: 맡아 둔 자리를 돌려준다.
    // 망이 바뀌면 서버가 옛 연결이 끊긴 걸 알기 전에 새 연결이 올 수도 있다: 그때도 같은 자리를 넘겨준다
    let back = tok && this.away.get(tok);
    if (!back && tok) {
      for (const game of this.all()) {
        const slot = game.slots.find((x) => !x.bot && x.tok === tok);
        if (slot) back = { game, slot };
      }
    }
    if (back) {
      this.away.delete(tok);
      clearTimeout(back.timer);
      if (back.slot.session) back.slot.session.slot = null; // 옛 연결은 이제 아무것도 못 한다
      back.game.reattach(back.slot, session);
      Object.assign(session, { game: back.game, slot: back.slot, tok });
      session.send({ t: 'room', code: back.game.opts.code || '' });
      return;
    }
    let g;
    if (room === 'new') {
      const code = this.newCode();
      g = new Game({ code });
      this.priv.set(code, g);
    } else if (room) {
      g = this.priv.get(String(room));
      if (!g) return session.send({ t: 'err', m: '그 코드의 방이 없어요. 코드를 다시 확인해 주세요.' });
      if (g.humanCount >= CFG.PLAYERS) return session.send({ t: 'err', m: '그 방은 8명이 다 찼어요.' });
    } else {
      g = this.rooms.find((r) => r.humanCount < CFG.PLAYERS);
      if (!g) {
        g = new Game();
        this.rooms.push(g);
      }
    }
    const slot = g.addHuman({ name, session });
    slot.tok = tok;
    Object.assign(session, { game: g, slot, tok });
    session.send({ t: 'room', code: g.opts.code || '' });
  }

  handle(session, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (!session.slot) this.join(session, m.name, m.tok, typeof m.room === 'string' ? m.room.slice(0, 8) : '');
      return;
    }
    if (m.t === 'bye') {
      // 일부러 나갔다: 자리를 맡아 두지 않는다
      session.tok = null;
      return this.leave(session);
    }
    if (session.slot) session.game.handle(session.slot, m);
  }

  leave(session) {
    if (!session.slot) return;
    const { game, slot, tok } = session;
    session.slot = null;
    if (slot.session !== session) return; // 이미 다른 연결이 이어받았다
    if (tok) {
      // 잠깐 끊긴 것일 수 있다: 자리를 맡아 둔다 (그동안 닭은 제자리에 서 있다)
      game.detach(slot);
      const timer = setTimeout(() => {
        this.away.delete(tok);
        game.removeHuman(slot);
        this.tidy();
      }, GRACE_MS);
      timer.unref?.();
      this.away.set(tok, { game, slot, timer });
      return;
    }
    game.removeHuman(slot);
    this.tidy();
  }

  // 첫 공개 방이 아닌 빈 방은 닫는다
  tidy() {
    this.rooms = this.rooms.filter((g, i) => i === 0 || g.humanCount > 0);
    for (const [c, g] of this.priv) if (g.humanCount === 0) this.priv.delete(c);
  }

  // 사람이 있는 방만 시뮬레이션한다
  *active() {
    for (const g of this.all()) if (g.humanCount > 0) yield g;
  }

  summary() {
    const list = [...this.all()];
    return { rooms: list.length, players: list.reduce((n, g) => n + g.humanCount, 0) };
  }
}
