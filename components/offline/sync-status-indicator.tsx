"use client"

import { useState } from "react"
import { useOffline } from "@/contexts/offline-context"
import { Cloud, CloudOff, Loader2, AlertTriangle, RefreshCw, ChevronDown, Check } from "lucide-react"
import { OPERATION_LABELS } from "@/lib/offline/constants"
import type { StoreName } from "@/lib/offline/constants"

export function SyncStatusIndicator() {
  const { isOnline, pendingCount, isSyncing, pendingOperations, conflicts, syncNow } = useOffline()
  const [isExpanded, setIsExpanded] = useState(false)

  // Don't show anything if online and no pending operations
  if (isOnline && pendingCount === 0 && !isSyncing) return null

  return (
    <div className="fixed bottom-24 right-4 z-[55] lg:bottom-6">
      {/* Main indicator button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`
          flex items-center gap-2 rounded-full px-4 py-2.5 shadow-lg backdrop-blur-sm
          text-sm font-medium transition-all active:scale-95
          ${!isOnline
            ? "bg-yellow-500/90 text-yellow-950"
            : conflicts.length > 0
              ? "bg-red-500/90 text-white"
              : isSyncing
                ? "bg-blue-500/90 text-white"
                : "bg-primary/90 text-primary-foreground"
          }
        `}
      >
        {!isOnline ? (
          <CloudOff className="h-4 w-4" />
        ) : isSyncing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : conflicts.length > 0 ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <Cloud className="h-4 w-4" />
        )}

        <span>
          {!isOnline
            ? `Offline · ${pendingCount} pendiente${pendingCount !== 1 ? "s" : ""}`
            : isSyncing
              ? "Sincronizando..."
              : conflicts.length > 0
                ? `${conflicts.length} conflicto${conflicts.length !== 1 ? "s" : ""}`
                : `${pendingCount} pendiente${pendingCount !== 1 ? "s" : ""}`
          }
        </span>

        <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div className="absolute bottom-full right-0 mb-2 w-80 rounded-lg bg-background border shadow-xl overflow-hidden">
          <div className="p-3 border-b flex items-center justify-between">
            <h3 className="font-semibold text-sm">
              {!isOnline ? "Modo offline" : "Operaciones pendientes"}
            </h3>
            {isOnline && pendingCount > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  syncNow()
                }}
                disabled={isSyncing}
                className="text-xs flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isSyncing ? "animate-spin" : ""}`} />
                Sincronizar ahora
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto">
            {pendingOperations.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <Check className="h-5 w-5 mx-auto mb-1 text-green-500" />
                Todo sincronizado
              </div>
            ) : (
              <ul className="divide-y">
                {pendingOperations.map((op) => (
                  <li key={`${op.storeName}-${op.id}`} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">
                        {OPERATION_LABELS[op.storeName as StoreName] || op.storeName}
                      </span>
                      <StatusBadge status={op.status} />
                    </div>
                    {op.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {op.description}
                      </p>
                    )}
                    {op.lastError && op.status === "failed" && (
                      <p className="text-xs text-red-500 mt-0.5 truncate">{op.lastError}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {new Date(op.createdAt).toLocaleTimeString()}
                      {op.retryCount > 0 && ` · Intento ${op.retryCount}/5`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!isOnline && (
            <div className="p-3 border-t bg-yellow-50 dark:bg-yellow-950/20 text-xs text-yellow-800 dark:text-yellow-200">
              Los cambios se sincronizarán automáticamente cuando vuelva la conexión.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
    syncing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    conflict: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  }

  const labels: Record<string, string> = {
    pending: "Pendiente",
    syncing: "Sincronizando",
    failed: "Error",
    conflict: "Conflicto",
  }

  return (
    <span className={`text-xs px-1.5 py-0.5 rounded-full ${styles[status] || styles.pending}`}>
      {labels[status] || status}
    </span>
  )
}
