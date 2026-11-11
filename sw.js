// ===== いつも最新のアプリを開くためのしくみ（サービスワーカー） =====
// iPhone のホーム画面から開くと、前に読み込んだ古いファイルのまま開くことがある。
// そこで、このアプリのファイル（HTML・JS・CSS・アイコン）は毎回インターネットから取り直し、
// 取れたら控えを保存しておく。電波がないときだけ、その控えで開く。
// （Google のログインやカレンダーの通信には手を出さない）

const CACHE = "baito-app";

self.addEventListener("install", () => self.skipWaiting()); // 新しい版をすぐ使う
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return; // ほかのサイトの通信はそのまま

  e.respondWith((async () => {
    try {
      // 保存された古いものは使わず、サーバーに確かめて取り直す
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      // 電波がないとき：控えがあればそれで開く
      const cached = await caches.match(req);
      if (cached) return cached;
      throw new Error("offline");
    }
  })());
});
