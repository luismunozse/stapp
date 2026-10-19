"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"

/**
 * Whether the current user may register cobros on repair orders.
 *
 * ADMIN always. VENDEDOR only when the org enabled `vendedores_manejan_caja`
 * (the same flag that gates the caja). Everyone else never.
 *
 * Fail-closed when DRAWING: while the flag is unknown (loading, 503, network
 * error) the VENDEDOR does not see the Cobrar action. Nothing is ever redirected
 * or removed from the screen on an unknown, so no one is expelled; the server
 * (POST /api/ordenes/[id]/cobros) decides for real regardless of what is drawn.
 */
export function usePuedeCobrar(): boolean {
  const { data: session } = useSession()
  const role = session?.user?.role
  // null = unknown (not resolved yet or the read failed).
  const [permiso, setPermiso] = useState<boolean | null>(null)

  useEffect(() => {
    if (role !== "VENDEDOR") return
    let cancelado = false
    fetch("/api/org/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado || !d) return
        setPermiso(!!d.vendedoresManejanCaja)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [role])

  if (role === "ADMIN") return true
  if (role === "VENDEDOR") return permiso === true
  return false
}
