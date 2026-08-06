// Service Worker für Schichtklar PWA
const VERSION = 'v5';
const STATIC_CACHE = `schichtklar-static-${VERSION}`;
const RUNTIME_CACHE = `schichtklar-runtime-${VERSION}`;

const PRECACHE_URLS = [
  '/',
  '/anmelden',
  '/manifest.webmanifest',
  '/offline.html',
  '/employee/zeiterfassung',
  '/employee/zeiten',
];

const cacheFirst = async (request) => {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
      return response;
    }
    // Wenn Response nicht OK ist, versuche cached Version oder re-throw
    if (cached) {
      return cached;
    }
    return response;
  } catch (error) {
    // Bei Netzwerkfehler: cached Version zurückgeben oder Fehler
    if (cached) {
      return cached;
    }
    // Für Next.js Assets: nicht cachen wenn 404
    if (request.url.includes('/_next/')) {
      return Promise.reject(error);
    }
    return cached || Promise.reject(error);
  }
};

const staleWhileRevalidate = async (request, cacheName = RUNTIME_CACHE) => {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);
  return cached ?? networkFetch ?? fetch(request);
};

const networkFirst = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    throw error;
  }
};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => ![STATIC_CACHE, RUNTIME_CACHE].includes(name))
          .map((name) => {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          })
      )
    )
    .then(() => {
      console.log('Service Worker activated, cache cleared');
      return self.clients.claim();
    })
  );
});

const handleNavigationRequest = async (request) => {
  try {
    const response = await fetch(request);
    // Nur erfolgreiche Antworten cachen – sonst landen 404/500-Seiten im
    // Static-Cache und werden später als "Offline-Version" ausgeliefert.
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cache = await caches.open(STATIC_CACHE);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    const offlineFallback = await cache.match('/offline.html');
    if (offlineFallback) {
      return offlineFallback;
    }
    return Response.error();
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  // API-Requests NIEMALS cachen: staleWhileRevalidate hätte nutzerbezogene
  // Antworten (Stunden, Nachweise, Personaldaten) im Runtime-Cache abgelegt und
  // sie später – auch nach Rollen-/Nutzerwechsel – erneut ausgeliefert.
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith('/api/')) {
    return; // direkt ans Netz, kein Service-Worker-Handling
  }

  // In Development: Next.js Assets nicht abfangen, einfach durchlassen
  const isDevelopment = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
  
  if (isDevelopment) {
    // Next.js Assets in Development nicht abfangen
    if (requestUrl.pathname.startsWith('/_next/')) {
      return; // Request durchlassen, Service Worker greift nicht ein
    }
  }

  // In Produktion: Next.js-Bundles direkt laden, um korrupten Cache zu vermeiden
  if (requestUrl.pathname.startsWith('/_next/static/')) {
    return; // Browser/Caching-Schicht von Next.js übernimmt Handling
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  if (requestUrl.origin === self.location.origin) {
    // Statische Assets aus /static/ network first, dann cache
    if (requestUrl.pathname.startsWith('/static/')) {
      event.respondWith(
        networkFirst(request).catch(() => {
          // Bei Fehler: versuche Cache
          return caches.match(request).then(cached => {
            if (cached) return cached;
            // Wenn auch kein Cache: Request durchlassen statt 404
            return fetch(request).catch(() => {
              return new Response('Asset not found', { status: 404, statusText: 'Not Found' });
            });
          });
        })
      );
      return;
    }

    // Styles und Scripts: nur abfangen wenn nicht Next.js Assets
    if ((request.destination === 'style' || request.destination === 'script') && 
        !requestUrl.pathname.startsWith('/_next/')) {
      event.respondWith(
        staleWhileRevalidate(request, STATIC_CACHE).catch(() => {
          // Bei Fehler: versuche Cache
          return caches.match(request).then(cached => {
            if (cached) return cached;
            // Request durchlassen
            return fetch(request).catch(() => {
              return new Response('Asset not found', { status: 404, statusText: 'Not Found' });
            });
          });
        })
      );
      return;
    }

    if (request.destination === 'image' || request.destination === 'font') {
      event.respondWith(staleWhileRevalidate(request));
      return;
    }

    if (PRECACHE_URLS.includes(requestUrl.pathname)) {
      event.respondWith(cacheFirst(request));
      return;
    }
  }

  if (requestUrl.hostname.includes('firestore.googleapis.com') || requestUrl.hostname.includes('firebase')) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});

// Push-Benachrichtigungen
self.addEventListener('push', (event) => {
  let notificationData = {
    title: 'Schichtklar',
    body: 'Sie haben eine neue Benachrichtigung',
    icon: '/favicon-192.png',
    badge: '/favicon-96.png',
    data: {},
    tag: 'default',
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      
      // Unterstütze sowohl Firebase Cloud Messaging als auch Web Push Standard
      if (payload.notification) {
        notificationData = {
          title: payload.notification.title || notificationData.title,
          body: payload.notification.body || notificationData.body,
          icon: payload.notification.icon || notificationData.icon,
          badge: payload.notification.badge || notificationData.badge,
          data: payload.data || {},
          tag: payload.data?.assignmentId || payload.data?.tag || notificationData.tag,
        };
      } else if (payload.title || payload.body) {
        // Fallback für einfache Payloads
        notificationData = {
          title: payload.title || notificationData.title,
          body: payload.body || notificationData.body,
          icon: payload.icon || notificationData.icon,
          badge: payload.badge || notificationData.badge,
          data: payload.data || {},
          tag: payload.tag || notificationData.tag,
        };
      }
    } catch (error) {
      console.error('Fehler beim Parsen der Push-Daten:', error);
      // Fallback: Versuche als Text zu lesen
      try {
        const text = event.data.text();
        if (text) {
          notificationData.body = text;
        }
      } catch (textError) {
        console.error('Fehler beim Lesen der Push-Daten als Text:', textError);
      }
    }
  }

  const promiseChain = self.registration.showNotification(notificationData.title, {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    data: notificationData.data,
    tag: notificationData.tag,
    requireInteraction: false,
    vibrate: [200, 100, 200],
    timestamp: Date.now(),
    actions: notificationData.data?.link ? [
      {
        action: 'open',
        title: 'Öffnen',
      },
      {
        action: 'close',
        title: 'Schließen',
      },
    ] : [],
  });

  event.waitUntil(promiseChain);
});

// Klick auf Benachrichtigung
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const action = event.action || 'open';
  const link = notificationData.link || '/';

  if (action === 'close') {
    return; // Nur schließen, nichts weiter tun
  }

  event.waitUntil(
    clients.matchAll({ 
      type: 'window', 
      includeUncontrolled: true 
    }).then((clientList) => {
      // Prüfe ob bereits ein Fenster/Tab geöffnet ist
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus().then(() => {
            // Navigiere zu Link wenn vorhanden
            if (link && link !== '/') {
              // Verwende postMessage für Navigation, falls navigate nicht verfügbar
              if (client.navigate) {
                return client.navigate(link);
              } else {
                // Fallback: Sende Message an Client
                client.postMessage({ type: 'NAVIGATE', url: link });
                return Promise.resolve();
              }
            }
          });
        }
      }
      // Öffne neues Fenster/Tab
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    }).catch((error) => {
      console.error('Fehler beim Öffnen des Clients:', error);
      // Fallback: Versuche trotzdem zu öffnen
      if (clients.openWindow) {
        return clients.openWindow(link);
      }
    })
  );
});

// Background Message Handler (für Firebase Cloud Messaging)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

