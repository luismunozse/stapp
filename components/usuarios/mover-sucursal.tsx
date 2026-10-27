"use client"

import { useCallback, useEffect, useId, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

export interface SucursalOpcion {
  id: string
  nombre: string
}

interface GrupoPendiente {
  sucursalId: string | null
  sucursalNombre: string | null
  cantidad: number
}

// Shape of GET /api/usuarios/[id]/sucursal. The appointments and cash session
// fields are optional on purpose: the UI must keep working against a server that
// does not send them.
interface InfoUsuario {
  usuario: { rol: string; sucursalId: string | null }
  ordenesAbiertas: GrupoPendiente[]
  totalOrdenesAbiertas: number
  turnosPendientes?: GrupoPendiente[]
  cajaAbierta?: { sucursalNombre: string | null } | null
}

/** A failed move. `caja` marks the cash-session refusal, whose sentence the reread would repeat. */
interface ErrorMover {
  texto: string
  caja: boolean
}

const ERROR_LECTURA = "No pudimos leer el trabajo pendiente de este usuario"

interface MoverSucursalProps {
  usuarioId: string
  /** Active branches of the organization (the form already fetches them). */
  sucursales: SucursalOpcion[]
}

// Branch names are free text and can be very long. `anywhere` (unlike `break-word`)
// also shrinks the min-content width, which is what keeps the dialog grid from
// growing wider than a 384 px screen.
const TEXTO_LARGO = "break-words [overflow-wrap:anywhere]"

/** Where a group of pending work lives. A branch name can be missing: never print "null". */
function ubicacion({ sucursalId, sucursalNombre }: GrupoPendiente) {
  if (!sucursalId) return { donde: "sin sucursal", conSucursal: false }
  return { donde: `en ${sucursalNombre ?? "otra sucursal"}`, conSucursal: true }
}

const quienEs = (rol: string) => (rol === "VENDEDOR" ? "este vendedor" : "este técnico")

/**
 * One warning line per branch group. The orders keep their assignee, but the
 * technician's lists only show the branch they are in, so they disappear from view
 * until the user is back in that branch.
 */
export function lineaOrdenesAbiertas(grupo: GrupoPendiente, rol: string): string {
  const { cantidad } = grupo
  const { donde, conSucursal } = ubicacion(grupo)
  const unica = cantidad === 1
  const cola = conSucursal
    ? `, pero dejará de ver${unica ? "la" : "las"} hasta que vuelva a esa sucursal`
    : ""
  return unica
    ? `Tiene 1 orden abierta ${donde}. Seguirá asignada a ${quienEs(rol)}${cola}.`
    : `Tiene ${cantidad} órdenes abiertas ${donde}. Seguirán asignadas a ${quienEs(rol)}${cola}.`
}

/** Appointments stay assigned, but the technician's agenda only lists the branch they are in. */
export function lineaTurnosPendientes(grupo: GrupoPendiente, rol: string): string {
  const { cantidad } = grupo
  const { donde } = ubicacion(grupo)
  return cantidad === 1
    ? `Tiene 1 turno pendiente ${donde}. Sigue asignado a ${quienEs(rol)}, pero dejará de verlo en su agenda.`
    : `Tiene ${cantidad} turnos pendientes ${donde}. Siguen asignados a ${quienEs(rol)}, pero dejará de verlos en su agenda.`
}

/** The server refuses the move while a cash session is open; this says why before it is attempted. */
export function lineaCajaAbierta(sucursal: string | null): string {
  return `Tiene una caja abierta${sucursal ? ` en ${sucursal}` : ""}. Cerrala antes de moverlo.`
}

const claveDe = ({ sucursalId }: GrupoPendiente) => sucursalId ?? "sin-sucursal"

/** Warning lines of the panel: open orders (if any), then pending appointments, one per branch group. */
function avisosDe({ usuario: { rol }, ordenesAbiertas, totalOrdenesAbiertas, turnosPendientes }: InfoUsuario) {
  return [
    ...(totalOrdenesAbiertas > 0 ? ordenesAbiertas : []).map((g) => ({
      clave: `ordenes-${claveDe(g)}`,
      texto: lineaOrdenesAbiertas(g, rol),
    })),
    ...(turnosPendientes ?? []).map((g) => ({
      clave: `turnos-${claveDe(g)}`,
      texto: lineaTurnosPendientes(g, rol),
    })),
  ]
}

const SELECT_CLASS =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * "Mover de sucursal" section of the technician / seller edit forms (BM-2, BM-3).
 *
 * ADMIN-only. It reads the user's pending work first (orders, appointments, open
 * cash session) and refuses to offer the move if that read fails: confirming
 * without seeing what stays behind is exactly what the warning exists to prevent.
 * An open cash session blocks the confirm button (the server refuses it too).
 * Moving never touches the orders, and the copy says so.
 *
 * One active branch is enough to mount it: a user stranded in an INACTIVE branch
 * can only be rescued by moving them to the single active one. Whether there is
 * anywhere to go is decided once the user is read, and a one-branch org whose user
 * is already in that branch sees nothing at all.
 *
 * Mounted inside the edit `<form>`, so every button is `type="button"`.
 */
export function MoverSucursal({ usuarioId, sucursales }: MoverSucursalProps) {
  const { data: session } = useSession()
  const visible = session?.user?.role === "ADMIN" && sucursales.length >= 1
  const selectId = useId()
  const tituloId = useId()
  const botonRef = useRef<HTMLButtonElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const devolverFoco = useRef(false)

  const [info, setInfo] = useState<InfoUsuario | null>(null)
  const [errorLectura, setErrorLectura] = useState("")
  const [abierto, setAbierto] = useState(false)
  const [destino, setDestino] = useState("")
  const [moviendo, setMoviendo] = useState(false)
  const [errorMover, setErrorMover] = useState<ErrorMover | null>(null)
  const [mensaje, setMensaje] = useState("")

  const cargar = useCallback(async () => {
    setErrorLectura("")
    try {
      const res = await fetch(`/api/usuarios/${usuarioId}/sucursal`, { cache: "no-store" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErrorLectura(data.error || ERROR_LECTURA)
        return
      }
      setInfo(await res.json())
    } catch {
      setErrorLectura(ERROR_LECTURA)
    }
  }, [usuarioId])

  useEffect(() => {
    if (visible) void cargar()
  }, [visible, cargar])

  // The trigger unmounts while the panel is open, so focus is handed over by hand:
  // into the select when it opens, back to the trigger when it closes.
  useEffect(() => {
    if (abierto) {
      selectRef.current?.focus()
    } else if (devolverFoco.current) {
      devolverFoco.current = false
      botonRef.current?.focus()
    }
  }, [abierto])

  if (!visible) return null

  const cerrar = () => {
    devolverFoco.current = true
    setAbierto(false)
    setDestino("")
    setErrorMover(null)
  }

  const mover = async () => {
    if (!destino) return
    setErrorMover(null)
    setMoviendo(true)
    try {
      const res = await fetch(`/api/usuarios/${usuarioId}/sucursal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursalId: destino }),
      }).catch(() => null)
      if (!res) {
        setErrorMover({ texto: "Error de conexión. Revisá tu internet e intentá de nuevo.", caja: false })
        return
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMover({
          texto: data.error || "No pudimos mover al usuario de sucursal",
          caja: data.code === "CAJA_ABIERTA",
        })
        // 409: what the ADMIN saw is out of date (someone moved the user, or a cash
        // session opened). Reread so the panel shows the truth, and ask for a new choice.
        if (res.status === 409) {
          setDestino("")
          void cargar()
        }
        return
      }

      setInfo((prev) => (prev ? { ...prev, usuario: { ...prev.usuario, sucursalId: destino } } : prev))
      setMensaje(data.message ?? "Sucursal actualizada.")
      cerrar()
    } finally {
      setMoviendo(false)
    }
  }

  if (errorLectura) {
    // A one-branch org has nothing to offer anyway: do not alarm it over a read it never asked for.
    if (sucursales.length < 2) return null
    return (
      <div role="alert" className={cn("space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400", TEXTO_LARGO)}>
        <p>{errorLectura}</p>
        <p>Por ahora no se puede mover.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void cargar()}>
          Reintentar
        </Button>
      </div>
    )
  }
  if (!info) return null

  // The user's branch comes from the API response, never from the session.
  const { sucursalId: actualId } = info.usuario
  if (!sucursales.some((s) => s.id !== actualId)) return null

  const nombreActual = actualId
    ? (sucursales.find((s) => s.id === actualId)?.nombre ?? "Sucursal inactiva")
    : "Sin sucursal"
  const avisos = avisosDe(info)
  const conOrdenes = info.totalOrdenesAbiertas > 0
  const cajaAbierta = info.cajaAbierta ?? null

  return (
    <div role="group" aria-labelledby={tituloId} className="space-y-2">
      <span id={tituloId} className="block text-sm font-medium leading-none">
        Sucursal
      </span>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("min-w-0 text-sm font-medium", TEXTO_LARGO)}>{nombreActual}</p>
        {!abierto && (
          <Button
            ref={botonRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setMensaje("")
              setAbierto(true)
            }}
          >
            Mover de sucursal
          </Button>
        )}
      </div>

      {/* Always mounted: a live region that appears together with its text is often not announced. */}
      <p
        role="status"
        aria-live="polite"
        className={cn(mensaje ? "text-xs text-green-700 dark:text-green-400" : "sr-only", TEXTO_LARGO)}
      >
        {mensaje}
      </p>

      {abierto && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          {/* After a 409 the error above already says it; the reread must not repeat the sentence. */}
          {cajaAbierta && !errorMover?.caja && (
            <p className={cn("rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400", TEXTO_LARGO)}>
              {lineaCajaAbierta(cajaAbierta.sucursalNombre)}
            </p>
          )}

          {avisos.length > 0 && (
            <div className={cn("rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200", TEXTO_LARGO)}>
              <ul className="space-y-1">
                {avisos.map((aviso) => (
                  <li key={aviso.clave}>{aviso.texto}</li>
                ))}
              </ul>
              {conOrdenes && (
                <p className="mt-2 text-xs">Mover al usuario no reasigna ni cambia de sucursal ninguna orden.</p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={selectId}>Nueva sucursal</Label>
            <select
              ref={selectRef}
              id={selectId}
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">Elegí una sucursal</option>
              {sucursales
                .filter((s) => s.id !== actualId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              El cambio se aplica en unos segundos, sin que tenga que volver a iniciar sesión.
            </p>
          </div>

          {errorMover && (
            <p role="alert" className={cn("text-sm text-red-700 dark:text-red-400", TEXTO_LARGO)}>
              {errorMover.texto}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={cerrar} disabled={moviendo}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void mover()} disabled={!destino || moviendo || !!cajaAbierta}>
              {moviendo ? "Moviendo..." : "Confirmar movimiento"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
