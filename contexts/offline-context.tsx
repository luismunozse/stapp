"use client"

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react"
import { getPendingCount, getAllPendingOperations } from "@/lib/offline/db"
import { offlineFetch as offlineFetchFn, syncAllStores, onSyncComplete, onSyncConflict } from "@/lib/offline/sync-manager"
import { SYNC_INTERVAL_MS, PENDING_CHECK_INTERVAL_MS } from "@/lib/offline/constants"
import type { OfflineFetchConfig } from "@/lib/offline/sync-manager"
import type { PendingOperation } from "@/lib/offline/constants"

interface OfflineContextValue {
  isOnline: boolean
  pendingCount: number
  isSyncing: boolean
  conflicts: PendingOperation[]
  pendingOperations: PendingOperation[]
  offlineFetch: (url: string, options: RequestInit, config: OfflineFetchConfig) => Promise<Response>
  syncNow: () => Promise<void>
  refreshPendingCount: () => Promise<void>
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  pendingCount: 0,
  isSyncing: false,
  conflicts: [],
  pendingOperations: [],
  offlineFetch: offlineFetchFn,
  syncNow: async () => {},
  refreshPendingCount: async () => {},
})

export function useOffline() {
  return useContext(OfflineContext)
}

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [isSyncing, setIsSyncing] = useState(false)
  const [conflicts, setConflicts] = useState<PendingOperation[]>([])
  const [pendingOperations, setPendingOperations] = useState<PendingOperation[]>([])
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const wasOfflineRef = useRef(false)

  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getPendingCount()
      setPendingCount(count)
      if (count > 0) {
        const ops = await getAllPendingOperations()
        setPendingOperations(ops)
        setConflicts(ops.filter((op) => op.status === "conflict"))
      } else {
        setPendingOperations([])
        setConflicts([])
      }
    } catch {
      // IndexedDB not available
    }
  }, [])

  const syncNow = useCallback(async () => {
    if (isSyncing || !navigator.onLine) return
    setIsSyncing(true)
    try {
      await syncAllStores()
    } finally {
      setIsSyncing(false)
      await refreshPendingCount()
    }
  }, [isSyncing, refreshPendingCount])

  // Online/offline listeners
  useEffect(() => {
    setIsOnline(navigator.onLine)

    const handleOnline = () => {
      setIsOnline(true)
      // If was offline, trigger sync
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false
        syncNow()
      }
    }

    const handleOffline = () => {
      setIsOnline(false)
      wasOfflineRef.current = true
    }

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [syncNow])

  // Listen for SW sync messages
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SYNC_ITEM_COMPLETE") {
        refreshPendingCount()
      }
      if (event.data?.type === "SYNC_CONFLICT") {
        refreshPendingCount()
      }
      if (event.data?.type === "SYNC_ALL_COMPLETE") {
        setIsSyncing(false)
        refreshPendingCount()
      }
    }

    navigator.serviceWorker.addEventListener("message", handleMessage)
    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage)
    }
  }, [refreshPendingCount])

  // Listen for sync-manager events (direct, not via SW)
  useEffect(() => {
    const unsubComplete = onSyncComplete(() => refreshPendingCount())
    const unsubConflict = onSyncConflict(() => refreshPendingCount())
    return () => {
      unsubComplete()
      unsubConflict()
    }
  }, [refreshPendingCount])

  // Periodic pending count check
  useEffect(() => {
    refreshPendingCount()
    const interval = setInterval(refreshPendingCount, PENDING_CHECK_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [refreshPendingCount])

  // iOS fallback: periodic sync when online (Background Sync not supported)
  useEffect(() => {
    const hasBackgroundSync = "SyncManager" in window
    if (hasBackgroundSync) return // Background Sync available, no fallback needed

    // Visibility-based sync for iOS
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && navigator.onLine) {
        syncNow()
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)

    // Periodic sync for iOS (every 30s while online)
    syncIntervalRef.current = setInterval(() => {
      if (navigator.onLine) {
        syncNow()
      }
    }, SYNC_INTERVAL_MS)

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current)
      }
    }
  }, [syncNow])

  const value: OfflineContextValue = {
    isOnline,
    pendingCount,
    isSyncing,
    conflicts,
    pendingOperations,
    offlineFetch: offlineFetchFn,
    syncNow,
    refreshPendingCount,
  }

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}
