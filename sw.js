const CACHE_NAME = "nmt-codepad-shell-v0.5.0";
const SHELL = ["./","./index.html","./styles.css","./manifest.json","./js/app.js","./icons/icon-192.png","./icons/icon-512.png"];
self.addEventListener("install",e=>e.waitUntil((async()=>{const c=await caches.open(CACHE_NAME);await c.addAll(SHELL);await self.skipWaiting();})()));
self.addEventListener("activate",e=>e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith("nmt-codepad-shell-")&&k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim();})()));
self.addEventListener("message",e=>{if(e.data?.type==="SKIP_WAITING")self.skipWaiting();});
self.addEventListener("fetch",e=>{
 const r=e.request;if(r.method!=="GET")return;const u=new URL(r.url);if(u.origin!==location.origin)return;
 const shell=/\.(html|js|css|json)$/.test(u.pathname)||u.pathname.endsWith("/codepad/");
 e.respondWith((async()=>{const c=await caches.open(CACHE_NAME);
  if(shell){try{const n=await fetch(r);if(n.ok)c.put(r,n.clone());return n;}catch{return await c.match(r)||Response.error();}}
  const hit=await c.match(r);if(hit)return hit;try{const n=await fetch(r);if(n.ok)c.put(r,n.clone());return n;}catch{return Response.error();}
 })());
});