// Service Worker para PWA - Network-first para navegación
const CACHE_NAME = 'stapp-v2'

// Solo cachear assets estáticos, no páginas
const urlsToCache = [
  '/logo.png',
  '/manifest.json',
]

self.addEventListener('install', (event) => {
  // Forzar activación inmediata
  self.skipWaiting()
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache)
    })
  )
})

self.addEventListener('activate', (event) => {
  // Tomar control inmediatamente
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Eliminar caches antiguos
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        )
      })
    ])
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Para navegación (páginas HTML), siempre ir a la red primero
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        // Solo si falla la red, mostrar página offline
        return caches.match('/dashboard')
      })
    )
    return
  }

  // Para assets estáticos, usar cache-first
  if (url.pathname.match(/\.(png|jpg|jpeg|svg|ico|css|js|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then((response) => {
        return response || fetch(request).then((fetchResponse) => {
          // Cachear el nuevo asset
          if (fetchResponse.ok) {
            const responseClone = fetchResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone)
            })
          }
          return fetchResponse
        })
      })
    )
    return
  }

  // Para todo lo demás (API calls, etc), siempre red
  event.respondWith(fetch(request))
})
