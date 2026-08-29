"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Loader2 } from "lucide-react"

/**
 * Permiso fino de POS para el rol TECNICO.
 *
 * El middleware deja entrar al técnico a /pos y /ventas porque corre en el Edge
 * y ahí no se puede leer `tecnicos_operan_pos`, que vive en la BD. Este gate es
 * quien lo lee. Para ADMIN y VENDEDOR no hay nada que preguntar: el permiso no
 * los toca, así que no pagan ni un fetch.
 *
 * Solo un `false` EXPLÍCITO saca al técnico de la pantalla. Un chequeo que no
 * se pudo completar —enlace caído, 503, la columna todavía sin migrar— NO es
 * una negativa, y tratarlo como tal expulsaría a alguien que sí tiene el
 * permiso (la misma denegación fabricada que ya se corrigió en /api/org/features
 * y en el gate de inventario). Dejarlo pasar no abre nada: toda escritura sigue
 * pasando por requirePosAccess(), que es fail-closed del lado del servidor.
 */
export function PosAccessGate({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { data: session } = useSession()
  const role = session?.user?.role
  const necesitaPermiso = role === "TECNICO"

  const [verificado, setVerificado] = useState(false)

  useEffect(() => {
    if (!necesitaPermiso) return
    let cancelado = false

    fetch("/api/org/features", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado) return
        // `d === null` es "no pude verificar": se deja pasar a propósito.
        if (d && !d.tecnicosOperanPos) {
          router.replace("/dashboard")
          return
        }
        setVerificado(true)
      })
      .catch(() => {
        if (!cancelado) setVerificado(true)
      })

    return () => {
      cancelado = true
    }
  }, [necesitaPermiso, router])

  if (necesitaPermiso && !verificado) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        <span className="text-sm">Verificando permisos…</span>
      </div>
    )
  }

  return <>{children}</>
}
