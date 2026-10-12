const C='gz-v1'
self.addEventListener('install',()=>self.skipWaiting())
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>clients.claim())))
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET')return;const u=new URL(r.url);if(u.origin!==location.origin||u.pathname.startsWith('/api/'))return
const put=x=>{const c=x.clone();caches.open(C).then(k=>k.put(r,c));return x}
if(u.pathname.startsWith('/_next/static/')||/\.(png|svg|ico|webmanifest)$/.test(u.pathname)){e.respondWith(caches.match(r).then(h=>h||fetch(r).then(put)));return}
if(r.mode==='navigate')e.respondWith(fetch(r).then(put).catch(()=>caches.match(r).then(h=>h||caches.match('/counter')||caches.match('/login'))))})
