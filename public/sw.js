// Service Worker para PWA - Optimizado para móviles con soporte offline completo
const CACHE_NAME = 'stapp-v8'
// v3: el caché de API pasó a llevar sello de tiempo y dejó de guardar
// /api/inventario. Renombrarlo hace que `activate` borre las entradas viejas
// (sin sello, y posiblemente con inventario de otro rol o sucursal).
const API_CACHE_NAME = 'stapp-api-v3'
const STATIC_CACHE_NAME = 'stapp-static-v3'
const DB_NAME = 'stapp-offline'
const DB_VERSION = 2

// Assets estáticos para cachear inmediatamente
const STATIC_ASSETS = [
  '/logo.png',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/favicon.svg',
]

// Rutas que NO deben cachearse (landing page y rutas públicas de marketing)
const EXCLUDED_ROUTES = [
  '/',
  '/landing',
]

// Rutas de API que se pueden cachear temporalmente (lectura).
//
// NO agregar acá ninguna ruta cuya respuesta dependa del rol o de la sucursal
// activa. Este caché es del navegador, no de la sesión: la clave es la URL y
// nada más — sin cookie, sin usuario, sin rol. Todo lo que entra puede
// devolverse después a OTRA sesión del mismo equipo, o a la misma sesión
// después de cambiar de sucursal.
//
// Por eso /api/inventario quedó fuera: bajo scope=venta la respuesta trae el
// stock de una sucursal concreta (más los headers X-Venta-Sucursal-*) y, para
// un ADMIN, precioCompra. Servirla desde el caché mostraba el stock de la
// sucursal anterior mientras la venta descontaba de otra, y en un mostrador
// compartido le entregaba a un VENDEDOR el catálogo del ADMIN.
const CACHEABLE_API_ROUTES = [
  '/api/clientes',
  '/api/servicios',
  '/api/configuracion',
  '/api/tipos-dispositivo',
]

// Excepciones a lo anterior: rutas que caen bajo un prefijo cacheable pero
// cuya respuesta depende del rol y de la sucursal activa (las dos corren
// sucursalParaLectura). Mismo problema que /api/inventario, solo que anidadas.
const SUCURSAL_SCOPED_API_PATTERNS = [
  /^\/api\/clientes\/[^/]+\/deuda-sucursal$/,
  /^\/api\/clientes\/[^/]+\/ordenes-pendientes$/,
]

// Tiempo de vida del caché de API (5 minutos). Se aplica con el sello
// CACHED_AT_HEADER que se escribe al guardar: pasado el TTL la entrada deja de
// servirse mientras haya red, pero sigue siendo el fallback offline.
const API_CACHE_TTL = 5 * 60 * 1000
const CACHED_AT_HEADER = 'x-sw-cached-at'

// Todos los stores de IndexedDB para operaciones offline
const ALL_STORES = [
  'pendingOrders',
  'pendingClients',
  'pendingVentas',
  'pendingPagos',
  'pendingCobros',
  'pendingOrderEdits',
  'pendingFacturas',
  'pendingUploads',
]

// Mapeo de sync tags a store names
const SYNC_TAG_MAP = {
  'sync-orders': 'pendingOrders',
  'sync-clients': 'pendingClients',
  'sync-ventas': 'pendingVentas',
  'sync-pagos': 'pendingPagos',
  'sync-cobros': 'pendingCobros',
  'sync-order-edits': 'pendingOrderEdits',
  'sync-facturas': 'pendingFacturas',
  'sync-uploads': 'pendingUploads',
}

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

// Manejar mensajes del cliente
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name.startsWith('stapp-'))
            .map((name) => caches.delete(name))
        )
      }).then(() => {
        if (event.source) {
          event.source.postMessage({ type: 'CACHE_CLEARED' })
        }
      })
    )
  }

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }

  // Force sync all stores (used by iOS fallback)
  if (event.data && event.data.type === 'FORCE_SYNC') {
    event.waitUntil(syncAllStores())
  }

  // Get pending count across all stores
  if (event.data && event.data.type === 'GET_PENDING_COUNT') {
    event.waitUntil(
      getPendingCountAll().then((count) => {
        if (event.source) {
          event.source.postMessage({ type: 'PENDING_COUNT', count })
        }
      })
    )
  }
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
    const cacheable =
      CACHEABLE_API_ROUTES.some(route => url.pathname.startsWith(route)) &&
      !SUCURSAL_SCOPED_API_PATTERNS.some(pattern => pattern.test(url.pathname))
    if (cacheable && request.method === 'GET') {
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
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await caches.match(request)
    if (cached) {
      return cached
    }
    const offlinePage = await caches.match('/login')
    if (offlinePage) {
      return offlinePage
    }
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

// Sella la respuesta con la hora de guardado. Los headers de una respuesta de
// red son inmutables, así que hay que reconstruirla.
async function conSelloDeCache(response) {
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT_HEADER, String(Date.now()))
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

// Una entrada sin sello viene de una versión anterior del SW: se trata como
// vencida (se revalida) en vez de asumir que es fresca.
function cacheVencido(response) {
  const sello = response.headers.get(CACHED_AT_HEADER)
  if (!sello) return true
  return Date.now() - Number(sello) > API_CACHE_TTL
}

// Estrategia: Stale-while-revalidate para APIs cacheables
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request).then(async (response) => {
    if (response.ok) {
      // Guardar es un efecto de servir el request, nunca una precondicion. En un
      // telefono con el almacenamiento al limite `cache.put` rechaza con
      // QuotaExceededError: dejar que ese rechazo suba lo tomaria el .catch de
      // abajo como "no hubo red" y degradaria una respuesta 200 buena a la copia
      // vencida o al 503 sintetico. La red siempre gana.
      try {
        await cache.put(request, await conSelloDeCache(response.clone()))
      } catch (error) {
        console.log('[SW] No se pudo cachear la respuesta de API:', request.url, error.message)
      }
    }
    return response
  }).catch(() => null)

  if (cached && !cacheVencido(cached)) {
    return cached
  }

  const response = await fetchPromise
  if (response) {
    return response
  }

  // Sin red: una copia vencida sigue siendo mejor que nada (es el caso que la
  // PWA offline existe para cubrir).
  if (cached) {
    return cached
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

// ============================================
// Background Sync - Generalizado
// ============================================

self.addEventListener('sync', (event) => {
  const storeName = SYNC_TAG_MAP[event.tag]
  if (storeName) {
    event.waitUntil(syncStore(storeName))
  }
})

// Sync genérico para cualquier store
async function syncStore(storeName) {
  try {
    const db = await openIndexedDB()
    const items = await getPendingItems(db, storeName)

    for (const item of items) {
      // Skip items that have exceeded max retries
      if (item.retryCount >= 5) continue

      try {
        const response = await fetch(item.url || getDefaultUrl(storeName), {
          method: item.method || 'POST',
          headers: item.headers || { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.body || item.data)
        })

        if (response.ok) {
          const serverData = await response.json().catch(() => null)
          await removeFromPending(db, storeName, item.id)

          // Notify all clients about successful sync
          const allClients = await self.clients.matchAll()
          allClients.forEach(client => {
            client.postMessage({
              type: 'SYNC_ITEM_COMPLETE',
              storeName,
              tempId: item.tempId,
              serverData,
              description: item.description
            })
          })
        } else if (response.status === 409) {
          // Conflict - mark but don't remove
          await updateItemInStore(db, storeName, item.id, {
            status: 'conflict',
            lastError: 'Conflicto: recurso modificado por otro usuario'
          })

          const allClients = await self.clients.matchAll()
          allClients.forEach(client => {
            client.postMessage({
              type: 'SYNC_CONFLICT',
              storeName,
              tempId: item.tempId,
              error: 'Conflicto detectado'
            })
          })
        } else {
          // Other error - increment retry count
          await updateItemInStore(db, storeName, item.id, {
            retryCount: (item.retryCount || 0) + 1,
            lastError: `Error ${response.status}`,
            status: 'failed'
          })
        }
      } catch (err) {
        console.log(`[SW] Failed to sync ${storeName} item:`, item.id, err.message)
        await updateItemInStore(db, storeName, item.id, {
          retryCount: (item.retryCount || 0) + 1,
          lastError: 'Error de red',
          status: 'pending'
        }).catch(() => {})
      }
    }

    db.close()
  } catch (error) {
    console.log(`[SW] Sync ${storeName} failed:`, error)
  }
}

// Sync all stores
async function syncAllStores() {
  for (const storeName of ALL_STORES) {
    await syncStore(storeName)
  }

  // Notify clients that full sync is done
  const allClients = await self.clients.matchAll()
  const count = await getPendingCountAll()
  allClients.forEach(client => {
    client.postMessage({ type: 'SYNC_ALL_COMPLETE', remainingCount: count })
  })
}

// Default URLs for legacy items that don't have a url field
function getDefaultUrl(storeName) {
  const urls = {
    pendingOrders: '/api/ordenes',
    pendingClients: '/api/clientes',
    pendingVentas: '/api/ventas',
    pendingPagos: '/api/pagos',
    pendingCobros: '/api/ordenes',
    pendingOrderEdits: '/api/ordenes',
    pendingFacturas: '/api/facturacion/generar',
    pendingUploads: '/api/ordenes',
  }
  return urls[storeName] || '/api/ordenes'
}

// ============================================
// IndexedDB helpers - Actualizado para v2
// ============================================

function openIndexedDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      for (const storeName of ALL_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true })
        }
      }
    }
  })
}

function getPendingItems(db, storeName) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([])
      return
    }
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

function updateItemInStore(db, storeName, id, updates) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const existing = getRequest.result
      if (!existing) {
        resolve()
        return
      }
      const putRequest = store.put({ ...existing, ...updates })
      putRequest.onerror = () => reject(putRequest.error)
      putRequest.onsuccess = () => resolve()
    }
    getRequest.onerror = () => reject(getRequest.error)
  })
}

async function getPendingCountAll() {
  try {
    const db = await openIndexedDB()
    let total = 0
    for (const storeName of ALL_STORES) {
      if (db.objectStoreNames.contains(storeName)) {
        const count = await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly')
          const store = tx.objectStore(storeName)
          const request = store.count()
          request.onerror = () => resolve(0)
          request.onsuccess = () => resolve(request.result)
        })
        total += count
      }
    }
    db.close()
    return total
  } catch {
    return 0
  }
}

// ============================================
// Push notifications
// ============================================

self.addEventListener('push', (event) => {
  // Parse payload defensively: server may send JSON, plain text, or empty.
  let data = {}
  if (event.data) {
    try { data = event.data.json() }
    catch { data = { title: 'STApp', body: event.data.text?.() || '' } }
  }

  // `path` matches the native Capacitor hook convention.
  // `url` kept as legacy fallback.
  const target = data.path || data.url || '/dashboard'

  const title = data.title || 'STApp'
  const options = {
    body: data.body || 'Nueva notificación',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    image: data.image,
    vibrate: data.silent ? [] : [100, 50, 100],
    tag: data.tag,            // groups/dedups same-tag notifications
    renotify: !!data.tag,     // re-alert even if tag exists
    requireInteraction: !!data.requireInteraction,
    silent: !!data.silent,
    timestamp: data.timestamp || Date.now(),
    data: { path: target, ...(data.data || {}) },
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  // Action button click → use action's id as path if present.
  const data = event.notification.data || {}
  const target = (event.action && data[event.action]) || data.path || data.url || '/dashboard'

  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // Prefer an existing same-origin window: focus + navigate without full reload.
    const origin = self.location.origin
    const sameOrigin = all.find((c) => c.url.startsWith(origin))
    if (sameOrigin) {
      try { await sameOrigin.focus() } catch {}
      try { await sameOrigin.navigate(target) } catch {
        // Some browsers throw on navigate from SW; post a message instead so
        // the client-side hook can router.push.
        sameOrigin.postMessage({ type: 'PUSH_NAVIGATE', path: target })
      }
      return
    }
    await self.clients.openWindow(target)
  })())
})

// Optional: track dismissals to refine future targeting.
self.addEventListener('notificationclose', (event) => {
  // No-op for now. Hook later for analytics if needed.
  void event
})
