"use client"

import { Loader2, ArrowDown } from "lucide-react"
import { usePullToRefresh } from "@/hooks/use-pull-to-refresh"

interface PullToRefreshProps {
  /** Refresco a ejecutar (ej: mutate() de SWR). Si devuelve Promise, el spinner espera. */
  onRefresh: () => Promise<unknown> | unknown
  /** Desactiva el gesto (ej: con un modal abierto o en escritorio sin touch). */
  disabled?: boolean
  children: React.ReactNode
}

/**
 * Envoltorio opt-in de pull-to-refresh para páginas de listado. Touch-only: en
 * escritorio no hace nada (los listeners no disparan) y no altera el layout.
 */
export function PullToRefresh({ onRefresh, disabled, children }: PullToRefreshProps) {
  const { pullDistance, refreshing, threshold } = usePullToRefresh({ onRefresh, disabled })
  const active = pullDistance > 0 || refreshing
  const reached = pullDistance >= threshold

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2"
        style={{
          transform: `translate(-50%, ${Math.max(0, (refreshing ? threshold : pullDistance) - 28)}px)`,
          opacity: active ? 1 : 0,
          transition: active ? "none" : "opacity 0.2s ease",
        }}
        aria-hidden={!refreshing}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full border bg-card shadow-md">
          {refreshing ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : (
            <ArrowDown
              className="h-5 w-5 text-muted-foreground transition-transform duration-150"
              style={{ transform: reached ? "rotate(180deg)" : "none" }}
            />
          )}
        </div>
      </div>

      <div
        style={{
          transform: active ? `translateY(${refreshing ? threshold * 0.6 : pullDistance}px)` : undefined,
          transition: pullDistance === 0 ? "transform 0.25s ease" : undefined,
        }}
      >
        {children}
      </div>

      {/* Región viva para lectores de pantalla */}
      <span className="sr-only" role="status" aria-live="polite">
        {refreshing ? "Actualizando…" : ""}
      </span>
    </div>
  )
}
