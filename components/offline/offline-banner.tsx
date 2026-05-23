"use client"

import { useOffline } from "@/contexts/offline-context"
import { WifiOff } from "lucide-react"

export function OfflineBanner() {
  const { isOnline, pendingCount } = useOffline()

  if (isOnline) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-yellow-500 text-yellow-950 px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium pt-[env(safe-area-inset-top,0px)]">
      <WifiOff className="h-4 w-4 flex-shrink-0" />
      <span>
        Sin conexión — Tus cambios se guardan y sincronizarán automáticamente
        {pendingCount > 0 && ` (${pendingCount} pendiente${pendingCount !== 1 ? "s" : ""})`}
      </span>
    </div>
  )
}
