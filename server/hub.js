// 온라인 방 관리: 사람 8명까지 한 방(마을). 자리가 차면 새 방을 연다. 빈 자리는 봇이 채운다.
import { CFG } from '../shared/config.js';
import { Game } from './game.js';

export class Hub {
  constructor() {
    this.rooms = [new Game()];
  }

  join(session, name) {
    let g = this.rooms.find((r) => r.humanCount < CFG.PLAYERS);
    if (!g) {
      g = new Game();
      this.rooms.push(g);
    }
    const slot = g.addHuman({ name, session });
    session.game = g;
    session.slot = slot;
  }

  handle(session, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      if (!session.slot) this.join(session, m.name);
      return;
    }
    if (session.slot) session.game.handle(session.slot, m);
  }

  leave(session) {
    if (!session.slot) return;
    session.game.removeHuman(session.slot);
    session.slot = null;
    // 첫 방이 아닌 빈 방은 닫는다
    this.rooms = this.rooms.filter((g, i) => i === 0 || g.humanCount > 0);
  }

  // 사람이 있는 방만 시뮬레이션한다
  *active() {
    for (const g of this.rooms) if (g.humanCount > 0) yield g;
  }

  summary() {
    return { rooms: this.rooms.length, players: this.rooms.reduce((n, g) => n + g.humanCount, 0) };
  }
}
