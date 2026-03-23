import {
  addPendingOperation,
  getPendingOperations,
  removePendingOperation,
  updatePendingOperation,
} from "./db"
import { SYNC_TAGS, MAX_RETRIES, type StoreName, type PendingOperation } from "./constants"

function generateTempId(): string {
  return `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function hasBackgroundSync(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "SyncManager" in window
}

export interface OfflineFetchConfig {
  store: StoreName
  description?: string
}

export type SyncEventCallback = (data: {
  storeName: StoreName
  tempId: string
  serverData?: any
  error?: string
}) => void

const syncListeners: SyncEventCallback[] = []
const conflictListeners: SyncEventCallback[] = []

export function onSyncComplete(callback: SyncEventCallback): () => void {
  syncListeners.push(callback)
  return () => {
    const idx = syncListeners.indexOf(callback)
    if (idx >= 0) syncListeners.splice(idx, 1)
  }
}

export function onSyncConflict(callback: SyncEventCallback): () => void {
  conflictListeners.push(callback)
  return () => {
    const idx = conflictListeners.indexOf(callback)
    if (idx >= 0) conflictListeners.splice(idx, 1)
  }
}

function notifySyncComplete(data: Parameters<SyncEventCallback>[0]) {
  syncListeners.forEach((cb) => cb(data))
}

function notifySyncConflict(data: Parameters<SyncEventCallback>[0]) {
  conflictListeners.forEach((cb) => cb(data))
}

/**
 * Drop-in replacement for fetch() that queues operations when offline.
 * Returns normal Response when online, or a synthetic 202 Response when queued offline.
 */
export async function offlineFetch(
  url: string,
  options: RequestInit,
  config: OfflineFetchConfig
): Promise<Response> {
  // Try the real fetch first
  if (navigator.onLine) {
    try {
      const response = await fetch(url, options)
      return response
    } catch (error) {
      // Network error even though navigator.onLine says true — queue offline
      console.warn("[OfflineSync] Network error, queueing offline:", error)
    }
  }

  // Queue the operation in IndexedDB
  const tempId = generateTempId()
  const body = options.body ? JSON.parse(options.body as string) : {}

  await addPendingOperation(config.store, {
    url,
    method: (options.method as PendingOperation["method"]) || "POST",
    body,
    headers: { "Content-Type": "application/json" },
    tempId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
    lastError: null,
    status: "pending",
    description: config.description,
  })

  // Try to register background sync
  if (hasBackgroundSync()) {
    try {
      const registration = await navigator.serviceWorker.ready
      await (registration as any).sync.register(SYNC_TAGS[config.store])
    } catch (e) {
      console.warn("[OfflineSync] Background sync registration failed:", e)
    }
  }

  // Return a synthetic 202 response so the caller can handle optimistically
  return new Response(
    JSON.stringify({
      _offline: true,
      tempId,
      message: "Operación guardada offline. Se sincronizará automáticamente.",
    }),
    {
      status: 202,
      headers: { "Content-Type": "application/json" },
    }
  )
}

/**
 * Manually sync all pending operations for a given store.
 * Used as iOS fallback and for manual sync triggers.
 */
export async function syncStore(storeName: StoreName): Promise<{
  synced: number
  failed: number
  conflicts: number
}> {
  const results = { synced: 0, failed: 0, conflicts: 0 }

  let operations: PendingOperation[]
  try {
    operations = await getPendingOperations(storeName)
  } catch {
    return results
  }

  for (const op of operations) {
    if (op.retryCount >= MAX_RETRIES) {
      results.failed++
      continue
    }

    try {
      await updatePendingOperation(storeName, op.id!, { status: "syncing" })

      const response = await fetch(op.url, {
        method: op.method,
        headers: op.headers || { "Content-Type": "application/json" },
        body: JSON.stringify(op.body),
      })

      if (response.ok) {
        const serverData = await response.json().catch(() => null)
        await removePendingOperation(storeName, op.id!)
        results.synced++
        notifySyncComplete({ storeName, tempId: op.tempId, serverData })
      } else if (response.status === 409) {
        // Conflict
        await updatePendingOperation(storeName, op.id!, {
          status: "conflict",
          lastError: "Conflicto: el recurso fue modificado por otro usuario",
        })
        results.conflicts++
        notifySyncConflict({
          storeName,
          tempId: op.tempId,
          error: "Conflicto detectado",
        })
      } else {
        const errorText = await response.text().catch(() => "Error desconocido")
        await updatePendingOperation(storeName, op.id!, {
          status: "failed",
          retryCount: op.retryCount + 1,
          lastError: errorText,
        })
        results.failed++
      }
    } catch (error) {
      // Network still unavailable
      await updatePendingOperation(storeName, op.id!, {
        status: "pending",
        retryCount: op.retryCount + 1,
        lastError: "Error de red",
      }).catch(() => {})
      results.failed++
    }
  }

  return results
}

/**
 * Sync all stores. Used for iOS fallback and manual sync button.
 */
export async function syncAllStores(): Promise<{
  synced: number
  failed: number
  conflicts: number
}> {
  const { ALL_STORES } = await import("./constants")
  const totals = { synced: 0, failed: 0, conflicts: 0 }

  for (const storeName of ALL_STORES) {
    const result = await syncStore(storeName)
    totals.synced += result.synced
    totals.failed += result.failed
    totals.conflicts += result.conflicts
  }

  return totals
}
