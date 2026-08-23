"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { InventarioList } from "@/components/inventario/inventario-list"
import { InventarioAnalytics } from "@/components/inventario/inventario-analytics"
import { Button } from "@/components/ui/button"
import { BarChart3, AlertTriangle, RefreshCw, LogOut, Loader2 } from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"

/**
 * Cuánto se espera al chequeo antes de darlo por no contestado.
 *
 * Sin esto el AbortController solo colgaba de la limpieza del efecto, y el modo
 * de falla más común de una tablet de mostrador no es un fetch que rechaza sino
 * uno que NO rechaza: public/sw.js rutea /api/org/features por
 * networkOnlyWithError, cuyo propio comentario lo dice — un enlace medio muerto
 * "no rechaza el fetch: lo cuelga decenas de segundos".
 *
 * Diez segundos, y no los cinco de la primera versión, porque el presupuesto
 * dejó de competir contra una pantalla en blanco. Mientras el chequeo está en
 * curso ahora se ve un estado de "verificando" (ver más abajo): antes no se veía
 * NADA, así que cada segundo de espera era un segundo de nada y el timeout tenía
 * que ser corto — y uno corto convierte un arranque en frío sobre una conexión
 * lenta pero sana en una falsa alarma, con aviso ámbar y sin el botón de
 * importar, para alguien que sí tenía el permiso. Con la espera visible, errar
 * por lento cuesta poco y errar por apurado cuesta una falsa alarma: conviene
 * esperar.
 */
const TIEMPO_MAXIMO_CHEQUEO_MS = 10000

/** Qué contestó el chequeo de permiso de inventario. */
type ResultadoAcceso =
  | "permitido"
  /** Denegación explícita, y el operador sale al panel. */
  | "denegado"
  /** Denegación explícita, pero había trabajo en pantalla y el operador eligió
   *  quedarse para rescatarlo. No puede guardar nada: el servidor lo rechaza. */
  | "denegado-se-queda"
  /** El chequeo no se pudo completar. NO es un "no". */
  | "indeterminado"

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

  /** Usuario para el que la pantalla llegó a mostrarse, o sea el único caso en
   *  que puede haber trabajo sin guardar adentro (el formulario, el modal de
   *  importación con el archivo ya elegido). En la primera carga no hay nada:
   *  ahí una denegación sale derecho, sin preguntar nada a nadie. */
  const contenidoMostradoPara = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (status === "authenticated") setSesionConocida(true)
  }, [status])

  useEffect(() => {
    if (role !== "VENDEDOR") return
    const controller = new AbortController()
    const emitir = (resultado: ResultadoAcceso) => setVeredicto({ userId, resultado })
    let vencido = false
    const timer = setTimeout(() => {
      vencido = true
      controller.abort()
    }, TIEMPO_MAXIMO_CHEQUEO_MS)

    fetch("/api/org/features", { cache: "no-store", signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`org/features respondió ${r.status}`)
        return r.json()
      })
      .then(async (d) => {
        const habilitado = d?.vendedoresAdministranInventario
        if (habilitado === true) {
          emitir("permitido")
          return
        }
        // Solo un `false` explícito es una denegación. Cualquier otro falsy —un
        // 200 cuyo body no trae la clave, un body que no es un objeto— es la
        // misma tesis que se arregló en el servidor: "no pude leer" no es "el
        // flag está apagado". Y acá pesa más todavía, porque una vez denegada la
        // pantalla no queda botón de reintento: una denegación falsa es
        // irrecuperable sin recargar.
        if (habilitado !== false) {
          emitir("indeterminado")
          return
        }
        // Denegación explícita. Salir de acá desmonta la lista y todo lo que
        // tenga adentro, así que si la pantalla ya estuvo arriba para este
        // operador —o sea, si pudo haber empezado a cargar algo— no se sale
        // solo: se avisa y se espera a que él decida. Quedarse es seguro, todas
        // las escrituras de inventario están gateadas en el servidor.
        //
        // El aviso va EN LA PANTALLA y no en un modal, por dos razones. La
        // primera es que ModalProvider tiene un solo diálogo y un solo
        // `confirmResolve`: preguntar desde un callback de red —o sea en
        // cualquier momento— podía pisar el confirm que el operador ya tenía
        // abierto ("Editar este") y dejar ese await colgado para siempre. La
        // segunda es el default: el de un modal es responder, y responder de
        // apuro acá borra el trabajo; el de un aviso es no hacer nada, que es la
        // dirección segura.
        if (contenidoMostradoPara.current === userId) {
          emitir("denegado-se-queda")
          return
        }
        emitir("denegado")
        router.replace("/dashboard")
      })
      .catch((err: unknown) => {
        // Un abort de la limpieza del efecto (desmontaje, cambio de identidad)
        // no es un chequeo fallido y no tiene nada que reportar. El del timeout
        // sí: es el pedido colgado.
        if ((err as Error)?.name === "AbortError" && !vencido) return
        // No se pudo completar el chequeo (red caída, 503, respuesta ilegible,
        // pedido colgado). Eso NO es una denegación: sacar al operador de acá
        // por un error de transporte le borra todo lo que tenga escrito en el
        // formulario, y el inventario todavía no persiste borradores. El permiso
        // real lo aplica el servidor —requireInventarioAccess en los endpoints
        // de inventario que escriben, denyIfNoInventarioAccess en la
        // importación—, así que quien de verdad no tiene acceso recibe 403 al
        // guardar en lugar de perder el trabajo.
        emitir("indeterminado")
      })
      .finally(() => clearTimeout(timer))

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [userId, role, reintento, router])

  const esVendedor = role === "VENDEDOR"
  // Un veredicto sobre otro usuario no dice nada sobre este: cuenta como "sin
  // chequear".
  const resultado = veredicto && veredicto.userId === userId ? veredicto.resultado : null

  // Solo ocultamos la página en la carga inicial. Un refresco de sesión deja
  // status en "loading" un instante, y desmontar acá tiraba abajo todo el
  // subárbol: se perdía el modal de importación con el archivo ya elegido.
  const esperandoSesion = status === "loading" && !sesionConocida
  // El chequeo de ESTE usuario está en curso. Un chequeo que no se pudo hacer, o
  // una denegación que el operador todavía no aceptó, dejan la página en pie.
  const verificando = esVendedor && resultado === null
  // Denegado y aceptado: la navegación al panel está en camino.
  const saliendo = esVendedor && resultado === "denegado"
  const mostrandoContenido = !esperandoSesion && !verificando && !saliendo

  useEffect(() => {
    if (mostrandoContenido) contenidoMostradoPara.current = userId
  }, [mostrandoContenido, userId])

  // La lista ofrece importación masiva, que crea items de inventario por
  // /api/import. El servidor ya la gatea con el mismo permiso; acá la pantalla
  // no ofrece una acción que todavía no puede justificar.
  const puedeImportar = !esVendedor || resultado === "permitido"

  if (esperandoSesion || saliendo) return null

  // Esperar sin decir nada era el verdadero costo del chequeo: el operador veía
  // una pantalla en blanco, sin explicación ni forma de salir, todo el tiempo que
  // tardara la red. Decirlo es lo que permite además esperar más (ver
  // TIEMPO_MAXIMO_CHEQUEO_MS).
  if (verificando) {
    return (
      <PageShell
        title="Inventario"
        description="Gestiona el stock de repuestos, accesorios y productos"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Verificando tu acceso al inventario…
        </div>
      </PageShell>
    )
  }

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

      {esVendedor && resultado === "denegado-se-queda" && (
        <div className="mb-4 flex flex-col gap-2 rounded-md border border-red-200 dark:border-red-900/40 bg-red-50/70 dark:bg-red-950/20 px-3 py-2 text-sm text-red-900 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            Tu organización no te habilitó la administración de inventario: no vas a poder guardar
            nada desde acá. Copiá lo que necesites antes de salir.
          </span>
          <button
            type="button"
            onClick={() => router.replace("/dashboard")}
            className="inline-flex items-center gap-1 shrink-0 font-medium underline-offset-2 hover:underline"
          >
            <LogOut className="h-3.5 w-3.5" />
            Salir al panel
          </button>
        </div>
      )}

      <InventarioList allowImport={puedeImportar} />

      <InventarioAnalytics open={showAnalytics} onOpenChange={setShowAnalytics} />
    </PageShell>
  )
}
