"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3, AlertTriangle, RefreshCw } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

/** Qué contestó el chequeo de permiso de inventario. "indeterminado" es el que
 *  importa: no es un "no", es un chequeo que no se pudo completar. */
type ResultadoAcceso = "permitido" | "denegado" | "indeterminado"

/**
 * El veredicto viaja junto al usuario sobre el que se emitió, y uno ajeno se
 * IGNORA al renderizar.
 *
 * Lo que habilita a un vendedor no habilita al siguiente: sin el sello, el
 * permiso concedido a u1 seguía en pie mientras se verificaba a u2 — inventario
 * completo para alguien a quien nadie habilitó todavía, y si ese chequeo además
 * fallaba, el aviso quedaba suprimido porque "ya había permiso".
 *
 * Ignorarlo en vez de limpiarlo al re-correr el efecto es deliberado: limpiarlo
 * devuelve la pantalla al estado "chequeando", o sea DESMONTA la lista en cada
 * reintento y se lleva el trabajo que esta pantalla existe para proteger (es la
 * misma pérdida que arregló #273, con el modal de importación y el archivo ya
 * elegido adentro). Con el sello, un cambio de usuario oculta la pantalla —no
 * hay trabajo de u2 que proteger todavía— y un reintento del mismo usuario la
 * deja en pie.
 */
interface VeredictoAcceso {
  userId: string | undefined
  resultado: ResultadoAcceso
}

export default function InventarioPage() {
  const [showAnalytics, setShowAnalytics] = useState(false)
  const { data: session, status } = useSession()
  const router = useRouter()
  const [veredicto, setVeredicto] = useState<VeredictoAcceso | null>(null)
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
    const emitir = (resultado: ResultadoAcceso) => setVeredicto({ userId, resultado })

    fetch("/api/org/features", { cache: "no-store", signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`org/features respondió ${r.status}`)
        return r.json()
      })
      .then((d) => {
        if (d?.vendedoresAdministranInventario) {
          emitir("permitido")
          return
        }
        // Denegación explícita: la organización contestó que este vendedor no
        // administra inventario.
        emitir("denegado")
        router.replace("/dashboard")
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return
        // No se pudo completar el chequeo (red caída, 503, respuesta ilegible).
        // Eso NO es una denegación: sacar al operador de acá por un error de
        // transporte le borra todo lo que tenga escrito en el formulario, y el
        // inventario todavía no persiste borradores. El permiso real lo aplica
        // el servidor —requireInventarioAccess en los endpoints de inventario
        // que escriben, denyIfNoInventarioAccess en la importación—, así que
        // quien de verdad no tiene acceso recibe 403 al guardar en lugar de
        // perder el trabajo.
        emitir("indeterminado")
      })

    return () => controller.abort()
  }, [userId, role, reintento, router])

  const esVendedor = role === "VENDEDOR"
  // Un veredicto sobre otro usuario no dice nada sobre este: cuenta como "sin
  // chequear".
  const resultado = veredicto && veredicto.userId === userId ? veredicto.resultado : null

  // La lista ofrece importación masiva, que crea items de inventario por
  // /api/import. El servidor ya la gatea con el mismo permiso; acá la pantalla
  // no ofrece una acción que todavía no puede justificar.
  const puedeImportar = !esVendedor || resultado === "permitido"

  // Solo ocultamos la página en la carga inicial. Un refresco de sesión deja
  // status en "loading" un instante, y desmontar acá tiraba abajo todo el
  // subárbol: se perdía el modal de importación con el archivo ya elegido.
  if (status === "loading" && !sesionConocida) return null
  // Mientras el chequeo de ESTE usuario está en curso, o ya se resolvió que no
  // hay acceso (y la navegación al dashboard está en camino). Un chequeo que no
  // se pudo hacer deja la página en pie con el aviso de abajo.
  if (esVendedor && (resultado === null || resultado === "denegado")) return null

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
      {esVendedor && resultado === "indeterminado" && (
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

      <InventarioList allowImport={puedeImportar} />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </PageShell>
  )
}
