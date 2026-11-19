"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"

/**
 * Whether the customer's phone is hidden from the current user: a TECNICO in an organization
 * that turned off `tecnicos_ven_telefono_clientes` (migration 416).
 *
 * Only for DRAWING: the server already sends the phone as null to that user, so nothing leaks
 * while this is still unknown. It lets the screen say "oculto" instead of "sin teléfono", and
 * hide the actions that need the number in the browser (WhatsApp link, call, edit the phone).
 */
export function useTelefonoClienteOculto(): boolean {
  const { data: session } = useSession()
  const role = session?.user?.role
  const [oculto, setOculto] = useState(false)

  useEffect(() => {
    if (role !== "TECNICO") return
    let cancelado = false
    fetch("/api/org/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado || !d) return
        setOculto(d.telefonoClienteOculto === true)
      })
      .catch(() => {})
    return () => {
      cancelado = true
    }
  }, [role])

  return role === "TECNICO" && oculto
}
