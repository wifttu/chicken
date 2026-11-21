// 서버 없이 브라우저 안에서 게임을 돌린다: "혼자 하기"(봇 7마리)와 메뉴 뒤 배경(AI 닭만).
// 온라인 서버와 똑같은 Game 코드를 쓰고, 메시지도 같은 꼴로 받는다.
import { CFG } from './shared/config.js';
import { Game } from './server/game.js';

export class LocalLink {
  constructor({ name, onMessage, demo = false }) {
    this.onMessage = onMessage;
    this.demo = demo;
    this.game = new Game({ autoRestart: !!demo, players: demo ? 0 : CFG.PLAYERS, ai: demo ? 30 : CFG.AI_COUNT });
    if (demo) {
      this.game.phase = 'play';
      this.game.timeLeft = 1e9;
    } else {
      this.slot = this.game.addHuman({ name, session: { send: (m) => this.onMessage(m) } });
    }
    this.acc = 0;
    this.last = performance.now();
    this.timer = setInterval(() => this.pump(), 1000 / CFG.TICK_RATE / 2);
  }

  pump() {
    const now = performance.now();
    this.acc += Math.min(250, now - this.last);
    this.last = now;
    const step = 1000 / CFG.TICK_RATE;
    const g = this.game;
    while (this.acc >= step) {
      this.acc -= step;
      g.step();
      if (g.tick % CFG.SNAPSHOT_EVERY) continue;
      if (this.demo) this.onMessage(g.spectate());
      else g.broadcast();
    }
  }

  send(m) {
    if (this.slot) this.game.handle(this.slot, m);
    return true;
  }

  close() {
    clearInterval(this.timer);
    this.onMessage = () => {};
  }
}
