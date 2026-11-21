// HTTP(정적 파일) + WebSocket 게임 서버.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { CFG } from '../shared/config.js';
import { Hub } from './hub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3000;

const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/server/', path.join(ROOT, 'server')], // 혼자 하기(브라우저 안 서버 로직)용: 아래 세 파일만 허용
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/build')],
  ['/', path.join(ROOT, 'client')],
];
const BROWSER_SERVER_FILES = ['game.js', 'ai.js', 'bots.js'];
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }).end('ok');
    return;
  }
  if (url === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }).end(JSON.stringify(hub.summary()));
    return;
  }
  if (url === '/') url = '/index.html';
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(dir, url.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) break; // 디렉터리 탈출 차단
    if (prefix === '/server/' && !BROWSER_SERVER_FILES.includes(path.basename(file))) break;
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': prefix.startsWith('/vendor') ? 'public, max-age=86400' : 'no-cache',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404).end('Not found');
});

const hub = new Hub();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 512 });
wss.on('connection', (ws) => {
  const session = {
    // 느린 클라이언트에 메시지가 쌓이지 않게 한다
    send: (obj) => ws.readyState === ws.OPEN && ws.bufferedAmount < 128 * 1024 && ws.send(JSON.stringify(obj)),
  };
  let msgCount = 0;
  const rateTimer = setInterval(() => (msgCount = 0), 1000);
  ws.on('message', (raw) => {
    if (++msgCount > 90) return; // 초당 메시지 제한 (입력은 초당 30개)
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    hub.handle(session, m);
  });
  ws.on('close', () => {
    clearInterval(rateTimer);
    hub.leave(session);
  });
  ws.on('error', () => {});
});

// 고정 틱 루프 (타이머 오차 누적 보정)
const STEP_MS = 1000 / CFG.TICK_RATE;
let next = performance.now();
setInterval(() => {
  const now = performance.now();
  let steps = 0;
  while (now >= next && steps < 5) {
    for (const g of [...hub.active()]) {
      g.step();
      if (g.tick % CFG.SNAPSHOT_EVERY === 0) g.broadcast();
    }
    next += STEP_MS;
    steps++;
  }
  if (now - next > 250) next = now;
}, STEP_MS / 2);

server.listen(PORT, () => console.log(`꼬꼬 스파이 서버: http://localhost:${PORT}`));
