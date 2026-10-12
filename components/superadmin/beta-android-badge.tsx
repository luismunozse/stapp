"use client"

import { useState, useEffect } from "react"

// Cuántos inscriptos faltan cargar en Play Console. Mismo patrón que LeadsHotBadge.
export function BetaAndroidBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/superadmin/beta-android/stats")
        if (!res.ok) return
        const data = await res.json()
        setCount(data.pendientes || 0)
      } catch {
        // silently ignore
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (count <= 0) return null

  return (
    <span
      className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-semibold leading-none text-white bg-red-500 rounded-full"
      title={`${count} inscripto${count !== 1 ? "s" : ""} por agregar en Play Console`}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}
