// 앱 화면 파일을 저장해 두어 현장에서 신호가 약해도 열리게 합니다.
// 파일을 고친 뒤에는 CACHE 숫자를 올려야 휴대폰에 새 버전이 들어갑니다.
const CACHE = 'hyeonjang-v31';
const SHELL = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './config.js',
  './js/app.js', './js/store.js', './js/seed.js', './js/util.js', './js/calc.js', './js/photos.js',
  './js/parse.js', './js/report.js', './js/icons.js', './js/ocr.js',
  './icons/icon.svg', './icons/icon-192.png',
];
self.addEventListener('install', (e) => {
  // 브라우저에 남아 있는 옛 파일이 아니라 서버의 새 파일을 받아 저장
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('hyeonjang-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
// 인터넷이 되면 항상 최신 파일, 안 되면 저장해 둔 파일
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net/.test(url.href);
  if (!cacheable || /supabase\.co/.test(url.href)) return;
  // 앱 파일은 매번 서버에 바뀌었는지 물어봄 (GitHub가 10분간 옛 파일을 주는 문제 방지)
  const fresh = url.origin !== location.origin ? req
    : new Request(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' }); // 페이지 요청은 주소로 새로 만듦
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
