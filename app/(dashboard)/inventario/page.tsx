"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3, AlertTriangle, RefreshCw } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

export default function InventarioPage() {
  const [showAnalytics, setShowAnalytics] = useState(false)
  const { data: session, status } = useSession()
  const router = useRouter()
  const [accesoVendedor, setAccesoVendedor] = useState<boolean | null>(null)
  const [verificacionFallida, setVerificacionFallida] = useState(false)
  const [reintento, setReintento] = useState(0)
  const [sesionConocida, setSesionConocida] = useState(false)

  // Primitivos, no el objeto de sesión: NextAuth devuelve una instancia nueva en
  // cada refresco, así que depender de `session` volvía a pedir /api/org/features
  // cada vez que la sesión se revalidaba (y el foco de la ventana la revalida).
  const userId = session?.user?.id
  const role = session?.user?.role

  useEffect(() => {
    if (status === "authenticated") setSesionConocida(true)
  }, [status])

  useEffect(() => {
    if (role !== "VENDEDOR") return
    const controller = new AbortController()
    fetch("/api/org/features", { cache: "no-store", signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`org/features respondió ${r.status}`)
        return r.json()
      })
      .then((d) => {
        setVerificacionFallida(false)
        if (d?.vendedoresAdministranInventario) {
          setAccesoVendedor(true)
          return
        }
        // Denegación explícita: la organización contestó que este vendedor no
        // administra inventario.
        setAccesoVendedor(false)
        router.replace("/dashboard")
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return
        // No se pudo completar el chequeo (red caída, 500, respuesta ilegible).
        // Eso NO es una denegación: sacar al operador de acá por un error de
        // transporte le borra todo lo que tenga escrito en el formulario, y el
        // inventario todavía no persiste borradores. El permiso real lo aplica
        // el servidor —requireInventarioAccess corre en todos los endpoints de
        // inventario que escriben—, así que quien de verdad no tiene acceso
        // recibe 403 al guardar en lugar de perder el trabajo.
        setVerificacionFallida(true)
      })
    return () => controller.abort()
  }, [userId, role, reintento, router])

  const esVendedor = role === "VENDEDOR"
  const chequeoPendiente = esVendedor && accesoVendedor === null && !verificacionFallida

  // Solo ocultamos la página en la carga inicial. Un refresco de sesión deja
  // status en "loading" un instante, y desmontar acá tiraba abajo todo el
  // subárbol: se perdía el modal de importación con el archivo ya elegido.
  if (status === "loading" && !sesionConocida) return null
  // Mientras el chequeo está en curso, o ya se resolvió que no hay acceso (y la
  // navegación al dashboard está en camino). Un chequeo que no se pudo hacer
  // deja la página en pie con el aviso de abajo.
  if (esVendedor && (chequeoPendiente || accesoVendedor === false)) return null

  return (
    <PageShell
      title="Inventario"
      description="Gestiona el stock de repuestos, accesorios y productos"
      actions={
        <Button variant="outline" onClick={() => setShowAnalytics(true)} className="gap-1.5 flex-1 sm:flex-none">
          <BarChart3 className="h-4 w-4" />
          Análisis
        </Button>
      }
    >
      {esVendedor && verificacionFallida && accesoVendedor !== true && (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-amber-200 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-900 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            No se pudo verificar tu permiso sobre el inventario. Podés seguir trabajando; si la
            organización no te lo habilitó, el sistema va a rechazar los cambios al guardar.
          </span>
          <button
            type="button"
            onClick={() => setReintento((n) => n + 1)}
            className="inline-flex items-center gap-1 shrink-0 font-medium underline-offset-2 hover:underline"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Reintentar
          </button>
        </div>
      )}

      <InventarioList />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </PageShell>
  )
}
