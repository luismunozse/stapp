// Service Worker para PWA - Optimizado para móviles con soporte offline completo
const CACHE_NAME = 'stapp-v8'
// v3: el caché de API pasó a llevar sello de tiempo y dejó de guardar
// /api/inventario. Renombrarlo hace que `activate` borre las entradas viejas
// (sin sello, y posiblemente con inventario de otro rol o sucursal).
// v4: se intentó escopear el caché limpiándolo al cambiar la identidad.
// v5: se revirtió — limpiar es una carrera por construcción (ver
// CACHEABLE_API_ROUTES). Los caches v3/v4 alcanzaron a guardar /api/clientes y
// /api/inventario bajo la regla permisiva; renombrar es lo que los saca de
// encima al actualizar, porque en un equipo compartido son de otra sesión.
const API_CACHE_NAME = 'stapp-api-v5'
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
// ESTÁ VACÍA, Y NO ES UN DESCUIDO. Hoy NINGUNA respuesta de API se cachea.
//
// LA REGLA: acá no entra ninguna ruta cuya respuesta dependa de la identidad
// —usuario, rol, org o sucursal activa—. No "se cachea y después se limpia":
// no se guarda. El motivo es que este caché es del navegador, no de la sesión:
// la clave es la URL y nada más, sin cookie, sin usuario, sin rol, sin org. Una
// respuesta guardada acá no sabe de quién es, así que puede devolverse a otra
// sesión del mismo equipo — el mostrador compartido donde el usuario A de la
// org 1 cierra sesión y entra el usuario B de la org 2.
//
// Aplicada de verdad, en una app multi-tenant esa regla no deja NADA:
//   - /api/inventario — bajo scope=venta trae el stock de una sucursal concreta
//     (más los headers X-Venta-Sucursal-*) y, para un ADMIN, precioCompra.
//   - /api/clientes — la lista es de UNA org, y lo que cuelga abajo
//     (deuda-sucursal, ordenes-pendientes) corre sucursalParaLectura. Dejar
//     afuera el prefijo cubre todo lo anidado sin listas de excepciones.
//   - /api/configuracion — es requireAdmin() y filtra por org. Peor todavía:
//     acá solo se guardan respuestas 200, así que toda entrada suya es una
//     respuesta de ADMIN, y un VENDEDOR pidiendo esa misma URL la recibiría del
//     caché sin que salga un solo request a la red.
//   - /api/tipos-dispositivo — filtra por organization_id, misma forma.
//   - /api/servicios — no existe; era una entrada muerta.
//
// Ya se intentó sostenerlo limpiando el caché al cambiar la identidad de sesión
// (ApiCacheSessionGuard). No alcanza, y no por cómo esté escrito: limpiar es
// una carrera por construcción. Tiene que haber TERMINADO antes de que algo
// lea, y la primera pantalla lee en el mismo commit en que monta el guard
// (CurrencyProvider pide /api/configuracion ahí mismo); además no puede
// demostrar que corrió: sin `controller` el mensaje se pierde en silencio y el
// borrado del worker es asincrónico. El guard sigue vivo como defensa en
// profundidad — por si alguien agrega una ruta acá — pero no es una garantía.
//
// El costo, explícito: NO hay datos de API offline. El POS no tiene catálogo
// offline y la app depende de la red para todo lo que no sea el shell.
//
// Para recuperarlo hace falta cambiar el modelo, no la lista: un caché KEYEADO
// POR IDENTIDAD (un nombre de caché por sesión, p. ej. `stapp-api-v5-<hash de
// usuario+org+rol+sucursal>`), donde otra identidad simplemente lee otro caché.
// Ahí no hay nada que limpiar ni nada que pueda llegar tarde, y estas rutas
// vuelven a ser cacheables sin carrera. Es otro cambio, no este.
//
// La maquinaria de abajo (sello de tiempo, stale-while-revalidate, presupuesto,
// waitUntil) queda como andamiaje para ese cambio y hoy es inalcanzable: con la
// lista vacía, `cacheable` siempre da false y todo /api/ cae en
// networkOnlyWithError. Los tests la siguen cubriendo inyectando una ruta.
// OJO si alguna vez vuelve a entrar una ruta escopeada por SUCURSAL: el guard
// mira la sesión, no la cookie de sucursal activa, así que haría falta volver a
// limpiar desde SucursalSwitcher (o meter la sucursal en la clave del caché).
const CACHEABLE_API_ROUTES = []

// Tiempo de vida del caché de API (5 minutos). Se aplica con el sello
// CACHED_AT_HEADER que se escribe al guardar: pasado el TTL la entrada deja de
// servirse mientras haya red, pero sigue siendo el fallback offline.
const API_CACHE_TTL = 5 * 60 * 1000
const CACHED_AT_HEADER = 'x-sw-cached-at'

// Cuánto se espera a la red antes de servir una copia vencida que igual sirve.
//
// "Mientras haya red" no puede significar "esperemos el connect timeout del
// sistema operativo". Un enlace a medias — portal cautivo, celda muerta, el
// estado normal de un mostrador — no rechaza el fetch: lo cuelga decenas de
// segundos, y sin este presupuesto el operador mira un spinner mientras la
// respuesta que necesita ya está en el caché. Pasado el presupuesto se sirve la
// copia vencida y la revalidación sigue en segundo plano, así que la próxima
// lectura ya encuentra la fresca. Con red sana la red gana igual y el TTL sigue
// mandando: este límite solo decide cuánto se espera, no qué se prefiere.
const STALE_REVALIDATE_BUDGET = 1500

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
    // `cache: 'api'` borra SOLO el caché de API (todas sus versiones). Lo manda
    // quien limpia por un cambio de identidad o de sucursal, que ocurre seguido
    // en un mostrador que rota operadores: borrar además el shell de navegación
    // (CACHE_NAME) y los assets (STATIC_CACHE_NAME) le sacaría a ese equipo la
    // capacidad de arrancar offline, que no tiene nada que ver con la sesión.
    // Sin `cache` se borra todo: es la recuperación manual (pull-to-refresh,
    // pantallas de error), donde justamente se quiere empezar de cero.
    const soloApi = event.data.cache === 'api'
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => soloApi ? name.startsWith('stapp-api-') : name.startsWith('stapp-'))
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
    const cacheable = CACHEABLE_API_ROUTES.some(route => url.pathname.startsWith(route))
    if (cacheable && request.method === 'GET') {
      event.respondWith(staleWhileRevalidate(request, API_CACHE_NAME, event))
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

// Espera una promesa hasta `ms` y resuelve a null si no llegó a tiempo (o si
// falló). La promesa original sigue viva: acá solo se deja de esperarla.
function conTiempoLimite(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(null) }
    )
  })
}

// Estrategia: Stale-while-revalidate para APIs cacheables
async function staleWhileRevalidate(request, cacheName, event) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const fetchPromise = fetch(request).catch(() => null)

  // Guardar es un efecto de responder, NUNCA parte de responder. Mientras el put
  // vivía dentro de esta cadena, la página recibía su respuesta recién después
  // de bufferear el body entero y escribirlo: en un miss eso es la descarga
  // completa antes de empezar a mostrar nada, y en el camino de la copia vencida
  // esa escritura se le cobraba a STALE_REVALIDATE_BUDGET, así que un
  // almacenamiento lento podía hacer que una red rápida no llegue a tiempo.
  // Ahora `fetchPromise` resuelve con la respuesta y el guardado corre aparte.
  const guardado = fetchPromise.then((response) => {
    if (!response || !response.ok) return null
    // El clone tiene que salir ANTES de que la página empiece a consumir el
    // body; por eso es lo primero del callback y no hay ningún await antes.
    const copia = response.clone()
    return conSelloDeCache(copia)
      .then((sellada) => cache.put(request, sellada))
      .catch((error) => {
        // Un QuotaExceededError en un teléfono al límite ya no puede degradar
        // una respuesta 200 buena: acá no está en el camino de la respuesta.
        console.log('[SW] No se pudo cachear la respuesta de API:', request.url, error.message)
        return null
      })
  })

  // Dejar de ESPERAR la revalidación no es renunciar a ella. Servida la
  // respuesta, el navegador puede terminar el worker cuando quiera: sin esto el
  // guardado nunca llega a correr y, en un enlace a medias, cada request paga el
  // presupuesto y vuelve a servir la MISMA copia vencida para siempre. waitUntil
  // es lo que mantiene vivo al worker hasta guardarla (y `guardado` depende de
  // `fetchPromise`, así que también cubre la revalidación en sí).
  if (event) {
    event.waitUntil(guardado)
  }

  if (cached && !cacheVencido(cached)) {
    return cached
  }

  // Con una copia vencida en mano la revalidación tiene presupuesto: si la red
  // no contesta a tiempo se sirve esa copia y la revalidación sigue sola. Sin
  // copia no hay nada mejor que esperar, así que el presupuesto no aplica.
  const response = cached
    ? await conTiempoLimite(fetchPromise, STALE_REVALIDATE_BUDGET)
    : await fetchPromise
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
