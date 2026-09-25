const CACHE = 'spy0dte-v64-paper-candidate-4';
const ASSETS = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./paper.html','./paper.js','./paper.css'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>Promise.all(ASSETS.map(url=>cache.add(url).catch(()=>null)))));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('spy0dte-')&&k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 // No API, price, or cross-origin responses enter the offline cache.
 if(url.origin!==self.location.origin||url.pathname.includes('/api/')||url.search)return;
 const assets=new Set(ASSETS.map(x=>new URL(x,self.location.href).pathname));
 if(!assets.has(url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
  return response;
 }).catch(async()=>await caches.match(event.request)||new Response('Offline',{status:503})));
});
