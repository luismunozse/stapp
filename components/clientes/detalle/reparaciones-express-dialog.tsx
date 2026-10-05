"use client"

import { useState, useMemo, useRef } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Plus, Trash2, Loader2, Wrench } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { toast } from "sonner"
import type { Cliente } from "@/types"
import { RevertirCargoDialog } from "./revertir-cargo-dialog"

// This app has no global SWR fetcher: every component declares its own
// (see cliente-detalle.tsx). useSWR(key) with no fetcher would throw.
const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface OrdenCreada {
  id: string
  numeroOrden: number
  codigoOrden: string
  dispositivo: string
  precio: number
  movimientoId: string
}

interface LoteResponse {
  ordenes: OrdenCreada[]
  totalCargado: number
  saldoNuevo: number
}

interface Fila {
  key: string
  dispositivo: string
  tipoDispositivo: string
  marca: string
  imei: string
  trabajoRealizado: string
  precio: string
  diasGarantia: string
}

function filaVacia(key: string): Fila {
  return {
    key, dispositivo: "", tipoDispositivo: "", marca: "", imei: "",
    trabajoRealizado: "", precio: "", diasGarantia: "0",
  }
}

// Fresh key on every reset (mirrors the "add row" key at line ~297): reusing
// the literal "f0" key would leave the surviving row's key unchanged, so
// React would update its <Select> in place instead of remounting it — the
// same "set from outside while closed" trigger as the documented Radix
// gotcha, just reached through a reset instead of an effect.
function filaVaciaFresca(): Fila {
  return filaVacia(`f0-${Date.now()}`)
}

interface ReparacionesExpressDialogProps {
  cliente: Cliente
  // Live balance from the parent's own cuenta-corriente fetch (ccData.saldo),
  // not cliente.saldoCuenta: a deposit/reversal done elsewhere on this page
  // only revalidates that cuenta-corriente key, so cliente.saldoCuenta can be
  // stale while this number stays correct. This is the number the user reads
  // before confirming a charge with no undo but the reversal flow.
  saldoActual: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => void
}

export function ReparacionesExpressDialog({
  cliente, saldoActual, open, onOpenChange, onDone,
}: ReparacionesExpressDialogProps) {
  const { formatPrice } = useCurrency()
  const [filas, setFilas] = useState<Fila[]>([filaVacia("f0")])
  const [loading, setLoading] = useState(false)
  // Success state: the batch just landed. Keeping it on screen is what makes
  // "Revertir lote" reachable exactly when the mistake is still in sight.
  const [creadas, setCreadas] = useState<OrdenCreada[]>([])
  // Authoritative post-charge balance from the API response, not recomputed
  // client-side: the RPC is the single source of truth for saldo_cuenta.
  const [saldoTrasLote, setSaldoTrasLote] = useState<number | null>(null)
  const [revertirOpen, setRevertirOpen] = useState(false)
  // Tied to PAYLOAD identity, not to the dialog's lifecycle: minted lazily on
  // the first submit of a given set of filas and reused on a retry of that
  // exact batch, so a lost-response retry replays server-side instead of
  // double-charging. Any edit to filas after an attempt (actualizar, add
  // row, remove row) clears it, because the server's replay-on-repeated-key
  // barrier returns attempt #1's stored response verbatim with no payload
  // comparison (migration 320) — if the key survived an edit, a resubmit of
  // genuinely different data would come back as a false "success" for the
  // OLD batch while the edited data was silently never charged. Deliberately
  // NOT cleared on Cancelar/ESC/overlay-close: that would let an unedited
  // retry after a dropped response mint a fresh key, miss the barrier, and
  // create a real duplicate charge instead.
  const idempotencyKeyRef = useRef<string | null>(null)
  const { data: tipos } = useSWR<Array<{ codigo: string; nombre: string }>>(
    open ? "/api/tipos-dispositivo" : null,
    fetcher,
    { revalidateOnFocus: false }
  )

  const total = useMemo(
    () => filas.reduce((sum, f) => sum + (parseFloat(f.precio) || 0), 0),
    [filas]
  )

  function actualizar(key: string, campo: keyof Fila, valor: string) {
    // The batch just changed: a stale key here would let a resubmit replay
    // as attempt #1's response instead of actually charging the new data.
    idempotencyKeyRef.current = null
    setFilas((prev) => prev.map((f) => (f.key === key ? { ...f, [campo]: valor } : f)))
  }

  function agregarFila() {
    idempotencyKeyRef.current = null
    setFilas((prev) => [...prev, filaVacia(`f${prev.length}-${Date.now()}`)])
  }

  function quitarFila(key: string) {
    idempotencyKeyRef.current = null
    setFilas((prev) => prev.filter((f) => f.key !== key))
  }

  async function handleGuardar() {
    const reparaciones = filas.map((f) => ({
      dispositivo: f.dispositivo.trim(),
      tipoDispositivo: f.tipoDispositivo,
      marca: f.marca.trim() || undefined,
      imei: f.imei.trim() || undefined,
      trabajoRealizado: f.trabajoRealizado.trim(),
      precio: parseFloat(f.precio) || 0,
      diasGarantia: parseInt(f.diasGarantia, 10) || 0,
    }))

    const filaIncompletaIndex = reparaciones.findIndex(
      (r) => !r.dispositivo || !r.tipoDispositivo || !r.trabajoRealizado || r.precio <= 0
    )
    if (filaIncompletaIndex !== -1) {
      const r = reparaciones[filaIncompletaIndex]
      const faltantes: string[] = []
      if (!r.dispositivo) faltantes.push("equipo")
      if (!r.tipoDispositivo) faltantes.push("tipo")
      if (!r.trabajoRealizado) faltantes.push("trabajo realizado")
      if (r.precio <= 0) faltantes.push("precio")
      toast.error(`Fila ${filaIncompletaIndex + 1}: falta ${faltantes.join(", ")}`)
      return
    }

    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = crypto.randomUUID()
    }

    setLoading(true)
    try {
      const res = await fetch("/api/reparaciones-express", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clienteId: cliente.id,
          reparaciones,
          idempotencyKey: idempotencyKeyRef.current,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al cargar las reparaciones")
      const result = json as LoteResponse
      toast.success(
        `${result.ordenes.length} ${result.ordenes.length === 1 ? "reparación cargada" : "reparaciones cargadas"} · ${formatPrice(result.totalCargado)}`
      )
      setFilas([filaVaciaFresca()])
      setCreadas(result.ordenes)
      setSaldoTrasLote(result.saldoNuevo)
      // Batch landed: the next submit (a brand-new batch) needs its own key.
      idempotencyKeyRef.current = null
      onDone()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar las reparaciones")
    } finally {
      setLoading(false)
    }
  }

  function cerrar() {
    setCreadas([])
    setSaldoTrasLote(null)
    setFilas([filaVaciaFresca()])
    idempotencyKeyRef.current = null
    onOpenChange(false)
  }

  if (creadas.length > 0) {
    return (
      <>
        <Dialog open={open} onOpenChange={(v) => !v && cerrar()}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reparaciones cargadas</DialogTitle>
              <DialogDescription>
                Quedaron en la cuenta corriente de {cliente.nombre}.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1 text-sm max-h-[40vh] overflow-y-auto">
              {creadas.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-lg bg-muted/50 p-2">
                  <a
                    href={`/ordenes/${o.id}`}
                    className="underline underline-offset-2"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {o.codigoOrden} · {o.dispositivo}
                  </a>
                  <span>{formatPrice(o.precio)}</span>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button variant="destructive" onClick={() => setRevertirOpen(true)}>
                Revertir lote
              </Button>
              <Button onClick={cerrar}>Listo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <RevertirCargoDialog
          clienteId={cliente.id}
          movimientos={creadas.map((o) => ({ id: o.movimientoId, monto: o.precio }))}
          saldoActual={saldoTrasLote ?? saldoActual}
          open={revertirOpen}
          onOpenChange={setRevertirOpen}
          onDone={() => { onDone(); cerrar() }}
        />
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Cargar reparaciones</DialogTitle>
          <DialogDescription>
            Se cargan como deuda en la cuenta corriente de {cliente.nombre}. No se cobra nada ahora.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-[50vh] overflow-y-auto">
          {filas.map((fila) => (
            <div key={fila.key} className="grid grid-cols-12 gap-2 items-end border-b pb-3">
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Equipo</Label>
                <Input
                  value={fila.dispositivo}
                  onChange={(e) => actualizar(fila.key, "dispositivo", e.target.value)}
                  placeholder="iPhone 11 Pro"
                  disabled={loading}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Tipo</Label>
                {/* Radix Select set only by user interaction: setting it from
                    outside while the dropdown is closed wipes the value. */}
                <Select
                  value={fila.tipoDispositivo}
                  onValueChange={(v) => actualizar(fila.key, "tipoDispositivo", v)}
                  disabled={loading}
                >
                  <SelectTrigger><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {(tipos || []).map((t) => (
                      <SelectItem key={t.codigo} value={t.codigo}>{t.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3 space-y-1">
                <Label className="text-xs">Trabajo realizado</Label>
                <Input
                  value={fila.trabajoRealizado}
                  onChange={(e) => actualizar(fila.key, "trabajoRealizado", e.target.value)}
                  placeholder="Cambio de pantalla"
                  disabled={loading}
                />
              </div>
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Precio</Label>
                <Input
                  inputMode="decimal"
                  value={fila.precio}
                  onChange={(e) => actualizar(fila.key, "precio", e.target.value)}
                  placeholder="0"
                  disabled={loading}
                />
              </div>
              <div className="col-span-1 space-y-1">
                <Label className="text-xs">Gar.</Label>
                <Input
                  inputMode="numeric"
                  value={fila.diasGarantia}
                  onChange={(e) => actualizar(fila.key, "diasGarantia", e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="col-span-1 flex justify-end">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={loading || filas.length === 1}
                  aria-label="Quitar reparación"
                  onClick={() => quitarFila(fila.key)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <div className="col-span-6 space-y-1">
                <Label className="text-xs">Marca</Label>
                <Input
                  value={fila.marca}
                  onChange={(e) => actualizar(fila.key, "marca", e.target.value)}
                  placeholder="Apple"
                  disabled={loading}
                />
              </div>
              <div className="col-span-6 space-y-1">
                <Label className="text-xs">IMEI / N° de serie</Label>
                <Input
                  value={fila.imei}
                  onChange={(e) => actualizar(fila.key, "imei", e.target.value)}
                  disabled={loading}
                />
              </div>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            onClick={agregarFila}
          >
            <Plus className="h-4 w-4" /> Agregar reparación
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3 text-sm">
          <span>Total a cargar: <strong>{formatPrice(total)}</strong></span>
          <span className="text-muted-foreground">
            Saldo del cliente: {formatPrice(saldoActual)} → {formatPrice(saldoActual - total)}
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleGuardar} disabled={loading || total <= 0}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
            Cargar a cuenta corriente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
