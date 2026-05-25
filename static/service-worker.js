/* ═══════════════════════════════════════════════════════════════════════
   SureBet Pro — Service Worker v3.0
   ═══════════════════════════════════════════════════════════════════════ */

const CACHE_NAME = 'surebet-pro-v3';
const STATIC_CACHE = 'surebet-static-v3';

const PRECACHE_URLS = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/manifest.json',
];

// Install
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== STATIC_CACHE && k !== CACHE_NAME)
          .map(k => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch with network-first strategy for API, cache-first for static
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // API requests - network only
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }
  
  // Static assets - cache first
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        const fetchPromise = fetch(event.request)
          .then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(STATIC_CACHE).then(cache => {
                cache.put(event.request, clone);
              });
            }
            return response;
          })
          .catch(() => cached);
        
        return cached || fetchPromise;
      })
  );
});

// Background sync for offline bets
self.addEventListener('sync', event => {
  if (event.tag === 'sync-bets') {
    event.waitUntil(syncPendingBets());
  }
});

async function syncPendingBets() {
  const cache = await caches.open(CACHE_NAME);
  const pending = await cache.match('/api/bets/pending');
  if (pending) {
    const bets = await pending.json();
    for (const bet of bets) {
      try {
        await fetch('/api/bets/place', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bet),
        });
      } catch(e) {}
    }
  }
}

// Push notifications
self.addEventListener('push', event => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    const options = {
      body: data.body || 'Nowy surebet dostępny!',
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/icon-72.png',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/',
        surebetId: data.surebet_id,
      },
      actions: [
        { action: 'view', title: '🔍 Zobacz' },
        { action: 'place', title: '⚡ Obstaw' },
      ],
    };
    
    event.waitUntil(
      self.registration.showNotification(
        data.title || '🎯 SureBet Pro',
        options
      )
    );
  } catch(e) {}
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'place' && event.notification.data?.surebetId) {
    event.waitUntil(
      clients.openWindow(`/?surebet=${event.notification.data.surebetId}`)
    );
  } else {
    event.waitUntil(
      clients.openWindow(event.notification.data?.url || '/')
    );
  }
});
