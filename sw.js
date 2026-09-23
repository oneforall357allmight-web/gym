/* UNIT service worker — put this file next to index.html on your hosting.

   Two jobs:
   1. Keep a copy of the app so it opens with no signal. The page itself is
      fetched fresh whenever there is a connection (so updates arrive), and
      the saved copy is used only when the network fails. Firebase and font
      files are versioned URLs, so they are served from the copy first.
      Database and sign-in traffic is never touched — it always goes live.
   2. Fire the "rest complete" notification when the phone is locked or the
      app is in the background.

   Bump CACHE when you want every phone to drop its old saved copy. */
const CACHE='unit-v1';
const SHELL=['./','./index.html'];
const LIBS=/^https:\/\/(www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com\/|fonts\.gstatic\.com\/)/;

self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));
  self.skipWaiting();
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k.startsWith('unit-')&&k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',e=>{
  const r=e.request;
  if(r.method!=='GET')return;
  const url=new URL(r.url);

  // the app page: network first, saved copy when offline
  if(r.mode==='navigate'){
    e.respondWith((async()=>{
      try{
        const res=await fetch(r);
        if(res&&res.ok){const c=await caches.open(CACHE);c.put('./',res.clone());}
        return res;
      }catch(err){
        const c=await caches.open(CACHE);
        return (await c.match(r,{ignoreSearch:true}))||(await c.match('./'))||(await c.match('./index.html'))||Response.error();
      }
    })());
    return;
  }

  // Firebase SDK and fonts: saved copy first, fetched and saved the first time
  if(LIBS.test(r.url)){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      const hit=await c.match(r);
      if(hit)return hit;
      const res=await fetch(r);
      if(res&&(res.ok||res.type==='opaque'))c.put(r,res.clone());
      return res;
    })());
    return;
  }

  // other files on your own site (icons, manifest): serve saved, refresh behind
  if(url.origin===self.location.origin){
    e.respondWith((async()=>{
      const c=await caches.open(CACHE);
      const hit=await c.match(r);
      const net=fetch(r).then(res=>{if(res&&res.ok)c.put(r,res.clone());return res;}).catch(()=>hit);
      return hit||net;
    })());
  }
  // everything else (database, sign-in) goes straight to the network
});

/* ── rest timer ──
   The page posts {type:'S', ms, n} when a rest starts and {type:'C'} when it
   ends early. waitUntil keeps the worker awake for the length of the rest
   (browsers allow a few minutes), then the notification fires. */
let restT=null,restDone=null;
function stopRest(){clearTimeout(restT);restT=null;if(restDone){restDone();restDone=null;}}
self.addEventListener('message',e=>{
  const d=e.data||{};
  if(d.type==='S'){
    stopRest();
    e.waitUntil(new Promise(res=>{
      restDone=res;
      restT=setTimeout(()=>{
        self.registration.showNotification('Rest complete',{
          body:d.n||'Next set',tag:'rest',renotify:true,vibrate:[200,100,200]
        }).catch(()=>{}).finally(()=>{restDone=null;res();});
      },Math.max(0,d.ms||0));
    }));
  }
  if(d.type==='C'){
    stopRest();
    e.waitUntil(self.registration.getNotifications({tag:'rest'}).then(ns=>ns.forEach(n=>n.close())).catch(()=>{}));
  }
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){if('focus'in c)return c.focus();}
    return self.clients.openWindow('./');
  }));
});
