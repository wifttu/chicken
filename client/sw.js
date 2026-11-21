// 서비스 워커: 홈 화면에 앱으로 설치할 수 있게 하고, 인터넷이 끊겨도 마지막으로 받은 화면으로 열리게 한다.
// 항상 네트워크를 먼저 쓰므로 새 버전이 배포되면 바로 반영된다(캐시는 오프라인일 때만 쓴다).
// GitHub Pages 는 파일을 10분 동안 캐시하라고 알려 주므로, 브라우저 캐시도 건너뛰고 매번 서버에 확인한다.
const CACHE = 'kkokko-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // 같은 사이트의 파일만 다룬다 (게임 서버 /ws, /healthz, /rooms 등 다른 주소는 그대로 통과)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req.url, { cache: 'no-cache' }) // 주소로 다시 요청 (페이지 이동 요청은 옵션을 붙여 복제할 수 없다)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('./index.html'))),
  );
});
