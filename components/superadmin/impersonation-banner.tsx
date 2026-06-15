"use client"

import { useState } from "react"
import { Eye, LogOut, Loader2 } from "lucide-react"

interface ImpersonationBannerProps {
  /** Display name of the user/tenant being impersonated. */
  viewingAs: string
}

/**
 * Persistent, non-dismissible banner shown while a superadmin impersonates a
 * tenant in read-only mode. It is intentionally intrusive (fixed, top, loud
 * color) so the superadmin always knows they are not in their own session.
 */
export function ImpersonationBanner({ viewingAs }: ImpersonationBannerProps) {
  const [loading, setLoading] = useState(false)

  const handleExit = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/auth/impersonate/exit", { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data?.url) {
        window.location.href = data.url
        return
      }
      // Fallback: reload so middleware re-evaluates the (now cleared) session.
      window.location.reload()
    } catch {
      window.location.reload()
    }
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 bg-violet-700 px-4 py-1.5 text-sm font-medium text-white shadow-md"
      role="alert"
    >
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate">
        Modo impersonación (solo lectura) · viendo como{" "}
        <strong className="font-semibold">{viewingAs}</strong>
      </span>
      <button
        onClick={handleExit}
        disabled={loading}
        className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 transition-colors hover:bg-white/25 disabled:opacity-60"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
        Salir
      </button>
    </div>
  )
}
