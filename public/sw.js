const CACHE_NAME = '24happ-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdn.socket.io/4.7.5/socket.io.min.js'
];

// Instalação do Service Worker e cacheamento dos recursos
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Cacheando assets...');
      return cache.addAll(ASSETS);
    }).catch(err => {
      console.error('[Service Worker] Falha ao cachear assets durante instalação:', err);
    })
  );
  self.skipWaiting();
});

// Ativação e limpeza de caches antigos
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Removendo cache antigo:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Interceptar requisições e servir do cache se offline
self.addEventListener('fetch', (e) => {
  // Ignora requisições de API e WebSockets
  if (e.request.url.includes('/api/') || e.request.url.includes('socket.io')) {
    return;
  }
  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        // Cacheia novas requisições de assets externos como fontes
        if (e.request.url.startsWith('http')) {
          return caches.open(CACHE_NAME).then((cache) => {
            cache.put(e.request, networkResponse.clone());
            return networkResponse;
          });
        }
        return networkResponse;
      });
    }).catch(() => {
      // Retorna index.html como fallback offline geral
      return caches.match('/index.html');
    })
  );
});

// Escutar eventos de push notification (se implementados no futuro)
self.addEventListener('push', (e) => {
  let data = { title: 'Alerta de Localização', body: 'Atualização pendente' };
  if (e.data) {
    try {
      data = e.data.json();
    } catch (err) {
      data = { title: 'Notificação', body: e.data.text() };
    }
  }

  const options = {
    body: data.body,
    icon: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
    badge: 'https://cdn-icons-png.flaticon.com/512/854/854878.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  e.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});
