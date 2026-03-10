"use client"

import { useState, useEffect } from "react"

export function TicketBadge() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/superadmin/soporte/stats")
        if (!res.ok) return
        const data = await res.json()
        setCount((data.abiertos || 0) + (data.enProceso || 0))
      } catch {
        // silently ignore fetch errors
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 60_000)
    return () => clearInterval(interval)
  }, [])

  if (count <= 0) return null

  return (
    <span className="ml-auto inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-semibold leading-none text-white bg-red-500 rounded-full">
      {count > 99 ? "99+" : count}
    </span>
  )
}
