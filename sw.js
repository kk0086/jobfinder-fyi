// Job Finder service worker: makes the site installable, keeps static images fast, and shows a friendly page when offline.
// Job data is never cached here (the CDN already serves it quickly and it must stay fresh).
const V = "jf-static-v1";
const OFFLINE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline | Job Finder</title><body style="font:16px system-ui;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px;color:#1d1d1b"><div><h1 style="font-size:22px">You are offline</h1><p>Job Finder needs a connection to load jobs. Reconnect and try again.</p><p><a href="/" style="display:inline-block;background:#c43a27;color:#fff;border-radius:10px;padding:12px 22px;text-decoration:none;font-weight:700">Retry</a></p></div></body>';
self.addEventListener("install", e => { e.waitUntil(caches.open(V).then(c => c.addAll(["/logo.png?v=2", "/favicon-192.png"]).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin || /^\/(api|admin|\.netlify)\b/.test(u.pathname)) return;
  if (r.mode === "navigate") { e.respondWith(fetch(r).catch(() => new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }))); return; }
  if (/\.(png|ico|svg|webp|jpg|woff2?)$/.test(u.pathname)) {
    e.respondWith(caches.open(V).then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit); return hit || net; }));
  }
});
