// Service Worker para PWA - Optimizado para móviles
const CACHE_NAME = 'stapp-v4'
const API_CACHE_NAME = 'stapp-api-v1'
const STATIC_CACHE_NAME = 'stapp-static-v1'

// Assets estáticos para cachear inmediatamente
const STATIC_ASSETS = [
  '/logo.png',
  '/manifest.json',
]

// Rutas que NO deben cachearse (landing page y rutas públicas de marketing)
const EXCLUDED_ROUTES = [
  '/',
  '/landing',
]

// Rutas de API que se pueden cachear temporalmente
const CACHEABLE_API_ROUTES = [
  '/api/clientes',
  '/api/inventario',
  '/api/servicios',
]

// Tiempo de vida del caché de API (5 minutos)
const API_CACHE_TTL = 5 * 60 * 1000

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS)
    })
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Eliminar caches antiguos
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return name.startsWith('stapp-') &&
                     name !== CACHE_NAME &&
                     name !== API_CACHE_NAME &&
                     name !== STATIC_CACHE_NAME
            })
            .map((name) => caches.delete(name))
        )
      })
    ])
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Ignorar requests que no son de nuestro origen
  if (url.origin !== location.origin) {
    return
  }

  // Estrategia para navegación (páginas HTML)
  if (request.mode === 'navigate') {
    // No cachear rutas excluidas (landing page)
    if (EXCLUDED_ROUTES.includes(url.pathname)) {
      event.respondWith(fetch(request))
      return
    }
    event.respondWith(networkFirstWithOfflineFallback(request))
    return
  }

  // Estrategia para API calls
  if (url.pathname.startsWith('/api/')) {
    // Para API que puede cachearse, usar stale-while-revalidate
    if (CACHEABLE_API_ROUTES.some(route => url.pathname.startsWith(route)) && request.method === 'GET') {
      event.respondWith(staleWhileRevalidate(request, API_CACHE_NAME))
    } else {
      // Para otras APIs, network only con fallback a error
      event.respondWith(networkOnlyWithError(request))
    }
    return
  }

  // Estrategia para assets estáticos (imágenes, CSS, JS, fonts)
  if (url.pathname.match(/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|woff2?|ttf|eot)$/)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE_NAME))
    return
  }

  // Para todo lo demás, network first
  event.respondWith(fetch(request))
})

// Estrategia: Network first con fallback offline
async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request)
    // Cachear la respuesta para uso offline
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    // Intentar servir desde caché
    const cached = await caches.match(request)
    if (cached) {
      return cached
    }
    // Fallback a login como página offline
    const offlinePage = await caches.match('/login')
    if (offlinePage) {
      return offlinePage
    }
    // Última opción: respuesta de error
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
  }
}

// Estrategia: Cache first para assets estáticos
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) {
    return cached
  }

  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    return new Response('Asset not available', { status: 404 })
  }
}

// Estrategia: Stale-while-revalidate para APIs cacheables
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  // Fetch en background para actualizar el caché
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  }).catch(() => null)

  // Retornar cached si existe, sino esperar el fetch
  if (cached) {
    return cached
  }

  const response = await fetchPromise
  if (response) {
    return response
  }

  return new Response(JSON.stringify({ error: 'No data available' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  })
}

// Estrategia: Network only con manejo de error
async function networkOnlyWithError(request) {
  try {
    return await fetch(request)
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Network unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}

// Background Sync para operaciones pendientes
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders())
  }
  if (event.tag === 'sync-clients') {
    event.waitUntil(syncPendingClients())
  }
})

async function syncPendingOrders() {
  try {
    const db = await openIndexedDB()
    const pendingOrders = await getPendingItems(db, 'pendingOrders')

    for (const order of pendingOrders) {
      try {
        const response = await fetch('/api/ordenes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(order.data)
        })

        if (response.ok) {
          await removeFromPending(db, 'pendingOrders', order.id)
        }
      } catch (err) {
        console.log('Failed to sync order:', order.id)
      }
    }
  } catch (error) {
    console.log('Sync failed:', error)
  }
}

async function syncPendingClients() {
  try {
    const db = await openIndexedDB()
    const pendingClients = await getPendingItems(db, 'pendingClients')

    for (const client of pendingClients) {
      try {
        const response = await fetch('/api/clientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(client.data)
        })

        if (response.ok) {
          await removeFromPending(db, 'pendingClients', client.id)
        }
      } catch (err) {
        console.log('Failed to sync client:', client.id)
      }
    }
  } catch (error) {
    console.log('Sync failed:', error)
  }
}

// IndexedDB helpers para Background Sync
function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('stapp-offline', 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('pendingOrders')) {
        db.createObjectStore('pendingOrders', { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains('pendingClients')) {
        db.createObjectStore('pendingClients', { keyPath: 'id', autoIncrement: true })
      }
    }
  })
}

function getPendingItems(db, storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}

function removeFromPending(db, storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

// Push notifications (preparado para futuro uso)
self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()

  const options = {
    body: data.body || 'Nueva notificación',
    icon: '/logo.png',
    badge: '/logo.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/dashboard'
    },
    actions: data.actions || []
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'STApp', options)
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const url = event.notification.data?.url || '/dashboard'

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Si ya hay una ventana abierta, enfocarla
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url)
            return client.focus()
          }
        }
        // Si no, abrir una nueva
        return clients.openWindow(url)
      })
  )
})
