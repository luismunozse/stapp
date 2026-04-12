"use client"

import { useState, useEffect } from "react"
import { Skeleton } from "./skeleton"
import { Button } from "./button"
import { cn } from "@/lib/utils"
import { RefreshCw } from "lucide-react"

interface LoadingStateProps {
  /** Skeleton layout to show while loading */
  children: React.ReactNode
  /** Seconds before showing timeout message (default: 8) */
  timeoutSeconds?: number
  /** Callback when "Reintentar" is clicked */
  onRetry?: () => void
  className?: string
}

/** Loading wrapper with skeleton + timeout fallback */
export function LoadingState({
  children,
  timeoutSeconds = 8,
  onRetry,
  className,
}: LoadingStateProps) {
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), timeoutSeconds * 1000)
    return () => clearTimeout(timer)
  }, [timeoutSeconds])

  return (
    <div className={cn("relative", className)}>
      {children}
      {timedOut && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm rounded-lg">
          <p className="text-sm text-muted-foreground mb-3">
            Esto está tardando más de lo esperado
          </p>
          {onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Reintentar
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Dashboard skeleton with KPI cards + chart areas */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Skeleton className="h-8 w-40 mb-2" />
        <Skeleton className="h-4 w-56" />
      </div>
      {/* KPI Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="rounded-lg border bg-card p-3 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
            <Skeleton className="h-7 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      {/* Charts area */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-48 w-full rounded" />
        </div>
        <div className="rounded-lg border bg-card p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-48 w-full rounded" />
        </div>
      </div>
    </div>
  )
}

/** Table page skeleton: search bar + table rows */
export function TablePageSkeleton({ columns = 5, rows = 8 }: { columns?: number; rows?: number }) {
  return (
    <div className="space-y-4">
      {/* Header + search */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-10 w-32 rounded-md" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
        <Skeleton className="h-10 w-28 rounded-md" />
      </div>
      {/* Table */}
      <div className="rounded-lg border bg-card">
        <div className="border-b p-3 flex gap-4">
          {[...Array(columns)].map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        {[...Array(rows)].map((_, rowIdx) => (
          <div key={rowIdx} className="border-b p-3 flex gap-4">
            {[...Array(columns)].map((_, colIdx) => (
              <Skeleton key={colIdx} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
