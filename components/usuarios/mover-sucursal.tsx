"use client"

import { useCallback, useEffect, useId, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

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

const ERROR_LECTURA = "No pudimos leer el trabajo pendiente de este usuario"

interface MoverSucursalProps {
  usuarioId: string
  /** Active branches of the organization (the form already fetches them). */
  sucursales: SucursalOpcion[]
  onMoved?: (sucursalId: string) => void
}

const dondeEsta = (sucursal: string | null) => (sucursal ? `en ${sucursal}` : "sin sucursal")
const quienEs = (rol: string) => (rol === "VENDEDOR" ? "este vendedor" : "este técnico")

/** One warning line per branch group. A branch name can be missing: never print "null". */
export function lineaOrdenesAbiertas(cantidad: number, sucursal: string | null, rol: string): string {
  const donde = dondeEsta(sucursal)
  return cantidad === 1
    ? `Tiene 1 orden abierta ${donde}. Seguirá asignada a ${quienEs(rol)}.`
    : `Tiene ${cantidad} órdenes abiertas ${donde}. Seguirán asignadas a ${quienEs(rol)}.`
}

/** Appointments stay assigned, but the technician's agenda only lists the branch they are in. */
export function lineaTurnosPendientes(cantidad: number, sucursal: string | null, rol: string): string {
  const donde = dondeEsta(sucursal)
  return cantidad === 1
    ? `Tiene 1 turno pendiente ${donde}. Sigue asignado a ${quienEs(rol)}, pero dejará de verlo en su agenda.`
    : `Tiene ${cantidad} turnos pendientes ${donde}. Siguen asignados a ${quienEs(rol)}, pero dejará de verlos en su agenda.`
}

/** Warning lines of the panel: open orders (if any), then pending appointments, one per branch group. */
function avisosDe({ usuario: { rol }, ordenesAbiertas, totalOrdenesAbiertas, turnosPendientes }: InfoUsuario) {
  return [
    ...(totalOrdenesAbiertas > 0 ? ordenesAbiertas : []).map(({ sucursalId, sucursalNombre, cantidad }) => ({
      clave: `ordenes-${sucursalId ?? "sin-sucursal"}`,
      texto: lineaOrdenesAbiertas(cantidad, sucursalNombre, rol),
    })),
    ...(turnosPendientes ?? []).map(({ sucursalId, sucursalNombre, cantidad }) => ({
      clave: `turnos-${sucursalId ?? "sin-sucursal"}`,
      texto: lineaTurnosPendientes(cantidad, sucursalNombre, rol),
    })),
  ]
}

/** The server refuses the move while a cash session is open; this says why before it is attempted. */
export function lineaCajaAbierta(sucursal: string | null): string {
  return `Tiene una caja abierta${sucursal ? ` en ${sucursal}` : ""}. Cerrala antes de moverlo.`
}

const SELECT_CLASS =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * "Mover de sucursal" section of the technician / seller edit forms (BM-2, BM-3).
 *
 * ADMIN-only and only when there is somewhere to move to. It reads the user's
 * pending work first (orders, appointments, open cash session) and refuses to
 * offer the move if that read fails: confirming without seeing what stays behind
 * is exactly what the warning exists to prevent. An open cash session blocks the
 * confirm button (the server refuses it too). Moving never touches the orders,
 * and the copy says so.
 *
 * Mounted inside the edit `<form>`, so every button is `type="button"`.
 */
export function MoverSucursal({ usuarioId, sucursales, onMoved }: MoverSucursalProps) {
  const { data: session } = useSession()
  const visible = session?.user?.role === "ADMIN" && sucursales.length > 1
  const selectId = useId()

  const [info, setInfo] = useState<InfoUsuario | null>(null)
  const [errorLectura, setErrorLectura] = useState("")
  const [abierto, setAbierto] = useState(false)
  const [destino, setDestino] = useState("")
  const [moviendo, setMoviendo] = useState(false)
  const [errorMover, setErrorMover] = useState("")
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

  if (!visible) return null

  const cerrar = () => {
    setAbierto(false)
    setDestino("")
    setErrorMover("")
  }

  const mover = async () => {
    if (!destino) return
    setErrorMover("")
    setMoviendo(true)
    try {
      const res = await fetch(`/api/usuarios/${usuarioId}/sucursal`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sucursalId: destino }),
      }).catch(() => null)
      if (!res) {
        setErrorMover("Error de conexión. Revisá tu internet e intentá de nuevo.")
        return
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMover(data.error || "No pudimos mover al usuario de sucursal")
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
      onMoved?.(destino)
    } finally {
      setMoviendo(false)
    }
  }

  if (errorLectura) {
    return (
      <div role="alert" className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
        <p>{errorLectura}. Por ahora no se puede mover.</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void cargar()}>
          Reintentar
        </Button>
      </div>
    )
  }
  if (!info) return null

  // The user's branch comes from the API response, never from the session.
  const { sucursalId: actualId } = info.usuario
  const nombreActual = actualId
    ? (sucursales.find((s) => s.id === actualId)?.nombre ?? "Sucursal inactiva")
    : "Sin sucursal"
  const avisos = avisosDe(info)
  const conOrdenes = info.totalOrdenesAbiertas > 0
  const cajaAbierta = info.cajaAbierta ?? null

  return (
    <div className="space-y-2">
      <Label>Sucursal</Label>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-medium">{nombreActual}</p>
        {!abierto && (
          <Button type="button" variant="outline" size="sm" onClick={() => { setMensaje(""); setAbierto(true) }}>
            Mover de sucursal
          </Button>
        )}
      </div>

      {mensaje && !abierto && (
        <p role="status" className="text-xs text-green-700 dark:text-green-400">
          {mensaje}
        </p>
      )}

      {abierto && (
        <div className="space-y-3 rounded-md border bg-muted/30 p-3">
          {cajaAbierta && (
            <p className="break-words rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-400">
              {lineaCajaAbierta(cajaAbierta.sucursalNombre)}
            </p>
          )}

          {avisos.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <ul className="space-y-1 break-words">
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
            <select id={selectId} value={destino} onChange={(e) => setDestino(e.target.value)} className={SELECT_CLASS}>
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
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {errorMover}
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
