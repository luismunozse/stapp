"use client"

import { useMemo, useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, ArrowRightLeft } from "lucide-react"
import { toast } from "sonner"

interface TecnicoOpt {
  id: string
  nombre: string
  email: string
  activo: boolean
  ordenesActivas: number
  porcentajeComision?: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tecnicoOrigenId: string
  tecnicoOrigenNombre: string
  /** The count the screen already shows; the dialog replaces it with the one the server says will move. */
  ordenesActivas: number
  /** Every open order he holds in every branch (the screen's total): it tells "nothing to move here" from "nothing at all". */
  ordenesActivasTotal?: number
  onSuccess?: () => void
}

/** What the picker of a bulk move answers (GET /api/tecnicos?paraReasignarDe=). */
interface DestinosDeReasignacion {
  tecnicos: TecnicoOpt[]
  /** The open orders in the ADMIN's scope that the move touches: how many it will move. */
  ordenesAMover: number
  /** They are handled by more than one branch (the ADMIN is on Todas): a branch has to be picked first. */
  variasSucursales: boolean
}

// A failed answer is an error, not a list: the dialog says so instead of showing "no technicians".
const fetcher = async (url: string): Promise<DestinosDeReasignacion> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error("No se pudo cargar la lista de técnicos")
  return res.json()
}

export function ReasignarOrdenesDialog({
  open,
  onOpenChange,
  tecnicoOrigenId,
  tecnicoOrigenNombre,
  ordenesActivas,
  ordenesActivasTotal,
  onSuccess,
}: Props) {
  // The server offers the technicians that can take every open order of this one (BM-5): the branch
  // that handles those orders, which is not always the technician's own. It also says how many orders
  // the move touches, and whether they span several branches. A failure is shown with its own retry
  // button: the cache must not retry behind it (the alert would flicker into the spinner).
  const { data: destinos, error: errorDeCarga, isLoading, mutate } = useSWR<DestinosDeReasignacion>(
    open ? `/api/tecnicos?paraReasignarDe=${encodeURIComponent(tecnicoOrigenId)}` : null,
    fetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )
  const tecnicos = useMemo(() => destinos?.tecnicos ?? [], [destinos])
  const ordenesAMover = destinos?.ordenesAMover ?? ordenesActivas
  const variasSucursales = destinos?.variasSucursales === true
  // The server answered and there is nothing to move in this scope (his open orders, if any, are in other branches).
  const sinNadaQueMover = destinos !== undefined && destinos.ordenesAMover === 0 && !variasSucursales
  const sinCantidad = variasSucursales || sinNadaQueMover
  const cargando = isLoading && !errorDeCarga
  const enOtrasSucursales = Math.max(0, (ordenesActivasTotal ?? 0) - ordenesAMover)

  const [destinoId, setDestinoId] = useState<string>("")
  const [submitting, setSubmitting] = useState(false)

  const opciones = useMemo(
    () =>
      tecnicos.filter(
        (t) => t.id !== tecnicoOrigenId && t.activo !== false
      ),
    [tecnicos, tecnicoOrigenId]
  )

  const handleSubmit = async () => {
    if (!destinoId) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/tecnicos/${tecnicoOrigenId}/reasignar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tecnicoDestinoId: destinoId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Error al reasignar")
      }
      const data = await res.json()
      toast.success(
        data.reasignadas === 0
          ? "No había órdenes activas para reasignar"
          : `Se reasignaron ${data.reasignadas} orden(es)`
      )
      onSuccess?.()
      onOpenChange(false)
      setDestinoId("")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al reasignar")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-5 w-5" />
            Reasignar órdenes activas
          </DialogTitle>
          <DialogDescription>
            {sinCantidad ? (
              <>
                Mover las órdenes activas de <strong>{tecnicoOrigenNombre}</strong> a otro técnico.
              </>
            ) : (
              <>
                Mover las <strong>{ordenesAMover}</strong> orden(es) activa(s) de{" "}
                <strong>{tecnicoOrigenNombre}</strong> a otro técnico.
              </>
            )}{" "}
            Las comisiones aún no pagadas adoptarán el % del nuevo técnico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Técnico destino</Label>
            {cargando ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando técnicos…
              </div>
            ) : errorDeCarga ? (
              <div role="alert" className="space-y-2">
                <p className="text-sm text-destructive">
                  No pudimos cargar los técnicos disponibles. Probá de nuevo en un momento.
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => mutate()}>
                  Reintentar
                </Button>
              </div>
            ) : variasSucursales ? (
              <p className="text-sm text-muted-foreground">
                Este técnico tiene órdenes abiertas en más de una sucursal. Elegí una sucursal en el
                selector para mover las de esa sucursal.
              </p>
            ) : sinNadaQueMover ? (
              <p className="text-sm text-muted-foreground">
                {enOtrasSucursales > 0
                  ? `No hay órdenes activas de ${tecnicoOrigenNombre} en esta sucursal para mover. Tiene ${enOtrasSucursales} en otras sucursales: elegí esa sucursal en el selector.`
                  : `No hay órdenes activas de ${tecnicoOrigenNombre} para mover.`}
              </p>
            ) : opciones.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay otros técnicos activos disponibles.
              </p>
            ) : (
              <Select value={destinoId} onValueChange={setDestinoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar técnico" />
                </SelectTrigger>
                <SelectContent>
                  {opciones.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      <span className="flex items-center gap-2">
                        <span>{t.nombre}</span>
                        <span className="text-xs text-muted-foreground">
                          · {t.ordenesActivas} activa(s)
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!destinoId || submitting || opciones.length === 0 || sinCantidad || !!errorDeCarga}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-4 w-4 mr-2" />
            )}
            {sinCantidad ? "Reasignar órdenes" : `Reasignar ${ordenesAMover} orden(es)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
