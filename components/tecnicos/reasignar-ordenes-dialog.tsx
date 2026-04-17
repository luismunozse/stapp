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
  ordenesActivas: number
  onSuccess?: () => void
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function ReasignarOrdenesDialog({
  open,
  onOpenChange,
  tecnicoOrigenId,
  tecnicoOrigenNombre,
  ordenesActivas,
  onSuccess,
}: Props) {
  const { data: tecnicos = [], isLoading } = useSWR<TecnicoOpt[]>(
    open ? "/api/tecnicos" : null,
    fetcher,
    { revalidateOnFocus: false }
  )

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
            Mover las <strong>{ordenesActivas}</strong> orden(es) activa(s) de{" "}
            <strong>{tecnicoOrigenNombre}</strong> a otro técnico. Las comisiones aún
            no pagadas adoptarán el % del nuevo técnico.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-2">
            <Label>Técnico destino</Label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Cargando técnicos…
              </div>
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
            disabled={!destinoId || submitting || opciones.length === 0}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-4 w-4 mr-2" />
            )}
            Reasignar {ordenesActivas} orden(es)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
