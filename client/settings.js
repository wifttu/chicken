// 배포 설정.
// GitHub Pages 처럼 서버가 없는 곳에서 "온라인"을 누르면 이 주소의 게임 서버로 접속한다.
// Render 에 서버를 올린 뒤 받은 주소를 넣으면 모든 사용자에게 적용된다. 예: 'kkokko-spy.onrender.com'
// 비워 두어도 각자 설정의 "온라인 서버 주소"에 붙여 넣어 쓸 수 있다.
// 서버(npm start, Render)가 직접 보여 주는 페이지에서는 이 값과 상관없이 같은 서버로 접속한다.
export const DEFAULT_SERVER = '';

// 붙여 넣은 서버 주소를 'https://호스트' 꼴로 정리한다. 쓸 수 없는 값이면 ''.
export function normalizeServer(input) {
  let v = String(input ?? '').trim();
  if (!v) return '';
  v = v.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:');
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  let u;
  try {
    u = new URL(v);
  } catch {
    return '';
  }
  if (!/^https?:$/.test(u.protocol) || (!u.hostname.includes('.') && u.hostname !== 'localhost')) return '';
  if (u.username || u.password) return '';
  return u.origin;
}
