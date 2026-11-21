// 서버 연결 하나를 로비에서부터 게임까지 유지한다.
// 무료 서버(Render 등)는 잠들어 있으면 깨어나는 데 1분 가까이 걸리므로, 여는 동안 몇 번이고 다시 시도한다.
export class Net {
  // url(): 접속할 ws 주소, onMessage(obj), onState(state): 'connecting' | 'waking' | 'open' | 'closed' | 'failed'
  constructor({ url, health, onMessage, onState }) {
    this.url = url;
    this.health = health;
    this.onMessage = onMessage;
    this.onState = onState;
    this.ws = null;
    this.opening = null;
    this.wanted = false; // 연결을 계속 유지하고 싶은지 (끊기면 다시 붙는다)
  }

  get ready() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  // 연결될 때까지 기다린다. 성공하면 true, 90초 안에 못 붙으면 false.
  open() {
    this.wanted = true;
    if (this.ready) return Promise.resolve(true);
    if (this.opening) return this.opening;
    const deadline = performance.now() + 90_000;
    fetch(this.health(), { mode: 'no-cors' }).catch(() => {}); // 잠든 서버 깨우기
    this.onState('connecting');
    this.opening = new Promise((resolve) => {
      const attempt = () => {
        let opened = false;
        const ws = new WebSocket(this.url());
        this.ws = ws;
        ws.onopen = () => {
          opened = true;
          this.opening = null;
          this.onState('open');
          resolve(true);
        };
        ws.onmessage = (ev) => {
          let m;
          try {
            m = JSON.parse(ev.data);
          } catch {
            return;
          }
          this.onMessage(m);
        };
        ws.onclose = () => {
          if (this.ws !== ws) return;
          if (opened) {
            this.ws = null;
            this.onState('closed');
            // 로비에 있는 동안 끊기면 잠시 뒤 다시 붙는다 (친구 접속 상태, 초대를 받기 위해)
            if (this.wanted) setTimeout(() => this.wanted && !this.ready && this.open(), 3000);
            return;
          }
          if (this.wanted && performance.now() < deadline) {
            this.onState('waking');
            setTimeout(attempt, 3000);
            return;
          }
          this.ws = null;
          this.opening = null;
          this.onState('failed');
          resolve(false);
        };
      };
      attempt();
    });
    return this.opening;
  }

  send(obj) {
    if (this.ready) this.ws.send(JSON.stringify(obj));
    return this.ready;
  }

  close() {
    this.wanted = false;
    const ws = this.ws;
    this.ws = null;
    this.opening = null;
    if (ws) ws.close();
  }
}
