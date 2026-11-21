// GitHub Pages용 정적 사이트를 dist/ 에 만든다.
// 서버와 같은 배치(client 파일이 루트, /shared, /server, /vendor/three)를 상대 경로로 그대로 재현한다.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(dist, to)), { recursive: true });
  fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
};

for (const f of fs.readdirSync(path.join(root, 'client'))) copy(`client/${f}`, f);
copy('shared', 'shared');
for (const f of ['game.js', 'ai.js', 'bots.js']) copy(`server/${f}`, `server/${f}`); // 혼자 하기가 서버 로직을 그대로 쓴다
copy('node_modules/three/build/three.module.min.js', 'vendor/three/three.module.min.js');
copy('node_modules/three/LICENSE', 'vendor/three/LICENSE'); // MIT: 저작권·허가 표시를 함께 배포
copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('built', dist);
