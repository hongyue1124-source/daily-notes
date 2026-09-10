/* 每日行业笔记 · Service Worker
   每次内容更新时，把下面的 BUILD 改成当天日期，旧缓存会被自动清掉。 */
const BUILD = '2026-09-10';
/* 同一天内容又改过就把 REV 往前推一格（BUILD 由 insert_issue.py 按期号日期改，别动它的格式）。
   改 REV 会让 sw.js 字节变化 → 手机端重新 install → 旧缓存被 activate 清掉。 */
const REV = 'r2';
const CACHE = 'dib-' + BUILD + '-' + REV;
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // 版本探针：永远走网络、绝不进缓存，否则 App 永远发现不了新一期
  if (new URL(req.url).pathname.endsWith('/version.json')) {
    e.respondWith(
      fetch(req).catch(() => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // 页面导航：优先联网（这样每天的新内容立刻可见），断网时回落到缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => { const cl = r.clone(); caches.open(CACHE).then(c => c.put('./index.html', cl)); return r; })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 其余静态资源（图标、字体）：优先缓存
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(resp => {
      if (resp && (resp.ok || resp.type === 'opaque')) {
        const cl = resp.clone();
        caches.open(CACHE).then(c => c.put(req, cl));
      }
      return resp;
    }).catch(() => hit))
  );
});
