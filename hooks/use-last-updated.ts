import { useState, useEffect, useCallback, useRef } from "react"

function formatRelativeTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < 10) return "hace unos segundos"
  if (diffSec < 60) return `hace ${diffSec}s`

  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `hace ${diffMin}m`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `hace ${diffHours}h`

  const diffDays = Math.floor(diffHours / 24)
  return `hace ${diffDays}d`
}

export function useLastUpdated() {
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [formattedLastUpdated, setFormattedLastUpdated] = useState("")
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Update the formatted string
  const updateFormatted = useCallback(() => {
    if (lastUpdated) {
      setFormattedLastUpdated(formatRelativeTime(lastUpdated))
    }
  }, [lastUpdated])

  // Mark as updated now
  const markUpdated = useCallback(() => {
    const now = new Date()
    setLastUpdated(now)
    setFormattedLastUpdated(formatRelativeTime(now))
  }, [])

  // Refresh the formatted string every 10 seconds
  useEffect(() => {
    if (!lastUpdated) return

    updateFormatted()

    intervalRef.current = setInterval(updateFormatted, 10_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [lastUpdated, updateFormatted])

  return { lastUpdated, formattedLastUpdated, markUpdated }
}
