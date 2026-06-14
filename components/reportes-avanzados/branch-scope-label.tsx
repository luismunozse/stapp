"use client"

import { useEffect, useState } from "react"

interface Sucursal {
  id: string
  nombre: string
  principal: boolean
}

const LS_KEY = "sucursal-activa-ui"
const TODAS = "todas"

/**
 * BranchScopeLabel — read-only label showing the currently active branch context.
 * Reads localStorage["sucursal-activa-ui"] (mirrored by SucursalSwitcher) and
 * fetches /api/sucursales to resolve the name. No dropdown, no selector.
 *
 * Renders:
 *   - "Todas las sucursales" when no branch or "todas" is active
 *   - "Viendo: {nombre}" when a specific branch is active
 */
export function BranchScopeLabel() {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    const activaId =
      typeof window !== "undefined" ? window.localStorage.getItem(LS_KEY) : null

    if (!activaId || activaId === TODAS) {
      setLabel("Todas las sucursales")
      return
    }

    // Resolve name from API
    fetch("/api/sucursales")
      .then((r) => r.json())
      .then((d: { data?: Sucursal[] }) => {
        const sucursales = d.data || []
        const match = sucursales.find((s) => s.id === activaId)
        setLabel(match ? `Viendo: ${match.nombre}` : "Todas las sucursales")
      })
      .catch(() => {
        setLabel("Todas las sucursales")
      })
  }, [])

  if (label === null) return null

  return (
    <p className="text-sm text-muted-foreground">
      {label}
    </p>
  )
}
