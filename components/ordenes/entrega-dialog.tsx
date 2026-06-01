"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { SignaturePad } from "@/components/firma/signature-pad"
import { Input } from "@/components/ui/input"
import { Loader2, PackageCheck, PackageX, AlertTriangle, Shield, HandCoins } from "lucide-react"
import { defaultMotivoSinCobro, type MotivoSinCobro } from "@/lib/seguimiento-state"

const MOTIVO_OPTIONS: Array<{ value: MotivoSinCobro; label: string; hint: string }> = [
  { value: "NO_REPARABLE", label: "No reparable", hint: "El equipo no se pudo reparar." },
  { value: "CORTESIA", label: "Cortesía del taller", hint: "Reparado pero decidimos no cobrar." },
  { value: "GARANTIA", label: "Garantía vigente", hint: "Reingreso bajo garantía, sin cargo." },
  { value: "CLIENTE_DESISTIO", label: "Cliente desistió", hint: "Cliente aprobó y luego se arrepintió." },
  { value: "OTRO", label: "Otro motivo", hint: "" },
]

interface EntregaDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  orden: {
    id: string
    numeroOrden: number
    codigoOrden?: string
    dispositivo: string
    estado?: string
    cliente: {
      nombre: string
      telefono: string
    }
    estadoCobro?: string
    pendienteCobro?: number
  }
  encargadoNombre: string
  esRetiro?: boolean
  sinCobro?: boolean
  garantiaDiasDefault?: number
}

export function EntregaDialog({
  open,
  onClose,
  onSuccess,
  orden,
  encargadoNombre,
  esRetiro = false,
  sinCobro = false,
  garantiaDiasDefault = 30,
}: EntregaDialogProps) {
  const [loading, setLoading] = useState(false)
  const [firmaCliente, setFirmaCliente] = useState<string | null>(null)
  const [firmaClienteMime, setFirmaClienteMime] = useState<string | null>(null)
  const [firmaEncargado, setFirmaEncargado] = useState<string | null>(null)
  const [firmaEncargadoMime, setFirmaEncargadoMime] = useState<string | null>(null)
  const [notasEntrega, setNotasEntrega] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [conGarantia, setConGarantia] = useState(!esRetiro && !sinCobro)
  const [diasGarantia, setDiasGarantia] = useState(String(garantiaDiasDefault))
  const [notasGarantia, setNotasGarantia] = useState("")
  const [motivoSinCobro, setMotivoSinCobro] = useState<MotivoSinCobro>(
    () => defaultMotivoSinCobro(orden.estado)
  )

  useEffect(() => {
    if (open && sinCobro) {
      setMotivoSinCobro(defaultMotivoSinCobro(orden.estado))
    }
  }, [open, sinCobro, orden.estado])

  const tienePendiente = !esRetiro && !sinCobro && orden.estadoCobro && orden.estadoCobro !== "COBRADO" && (orden.pendienteCobro || 0) > 0

  const handleFirmaClienteChange = (data: string | null, mime: string | null) => {
    setFirmaCliente(data)
    setFirmaClienteMime(mime)
    setError(null)
  }

  const handleFirmaEncargadoChange = (data: string | null, mime: string | null) => {
    setFirmaEncargado(data)
    setFirmaEncargadoMime(mime)
    setError(null)
  }

  const handleConfirmar = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/ordenes/${orden.id}/entregar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaClienteEntrega: firmaCliente || null,
          firmaClienteMime: firmaClienteMime || null,
          firmaEncargadoEntrega: firmaEncargado || null,
          firmaEncargadoMime: firmaEncargadoMime || null,
          notasEntrega: notasEntrega || null,
          sinCobro: sinCobro || undefined,
          motivoSinCobro: sinCobro ? motivoSinCobro : undefined,
          ...(conGarantia && !esRetiro && !sinCobro ? {
            diasGarantia: Math.max(1, parseInt(diasGarantia, 10) || 30),
            notasGarantia: notasGarantia || null,
          } : {}),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al registrar entrega")
        return
      }

      onSuccess()
      onClose()
    } catch (err) {
      console.error("Error:", err)
      setError("Error al registrar entrega")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setFirmaCliente(null)
      setFirmaClienteMime(null)
      setFirmaEncargado(null)
      setFirmaEncargadoMime(null)
      setNotasEntrega("")
      setError(null)
      setConGarantia(!esRetiro && !sinCobro)
      setDiasGarantia(String(garantiaDiasDefault))
      setNotasGarantia("")
      onClose()
    }
  }

  const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {sinCobro ? <HandCoins className="h-5 w-5" /> : esRetiro ? <PackageX className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
            {sinCobro ? "Entrega sin Cobro" : esRetiro ? "Retiro de Equipo Sin Reparación" : "Entrega de Equipo"}
          </DialogTitle>
          <DialogDescription>
            Orden {codigoDisplay} - {orden.dispositivo}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Banner informativo de entrega sin cobro */}
          {sinCobro && (
            <>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-sm">
                <HandCoins className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">
                    Entrega sin cobro
                  </p>
                  <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
                    El equipo será entregado sin cargo al cliente. No se generará cobro por esta reparación.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="motivo-sin-cobro" className="text-sm font-medium">
                  Motivo de la entrega sin cobro
                </Label>
                <select
                  id="motivo-sin-cobro"
                  value={motivoSinCobro}
                  onChange={(e) => setMotivoSinCobro(e.target.value as MotivoSinCobro)}
                  disabled={loading}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {MOTIVO_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {(() => {
                  const hint = MOTIVO_OPTIONS.find((m) => m.value === motivoSinCobro)?.hint
                  return hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null
                })()}
              </div>
            </>
          )}

          {/* Banner informativo de retiro sin reparación */}
          {esRetiro && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Retiro sin reparación
                </p>
                <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
                  El cliente retira el equipo sin reparar. Al firmar, confirma que recibe el equipo en el estado en que se encuentra, eximiendo al taller de responsabilidad sobre el mismo.
                </p>
              </div>
            </div>
          )}

          {/* Aviso informativo si hay cobro pendiente (solo para entregas normales) */}
          {tienePendiente && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Cobro pendiente: {orden.pendienteCobro?.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                </p>
                <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
                  Puede cobrar después de la entrega desde el detalle de la orden.
                </p>
              </div>
            </div>
          )}

          <div className="bg-muted/50 p-3 rounded-lg text-sm">
            <p><strong>Cliente:</strong> {orden.cliente.nombre}</p>
            <p><strong>Telefono:</strong> {orden.cliente.telefono}</p>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Firma del Cliente (opcional)
              </Label>
              <SignaturePad
                onSignatureChange={handleFirmaClienteChange}
                disabled={loading}
              />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Firma del Encargado - {encargadoNombre} (opcional)
              </Label>
              <SignaturePad
                onSignatureChange={handleFirmaEncargadoChange}
                disabled={loading}
              />
            </div>
          </div>

          {/* Garantía (solo para entregas normales, no retiros ni sin cobro) */}
          {!esRetiro && !sinCobro && (
            <div className="space-y-3 p-3 rounded-lg border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conGarantia}
                  onChange={(e) => setConGarantia(e.target.checked)}
                  disabled={loading}
                  className="rounded"
                />
                <span className="flex items-center gap-2 font-medium text-sm">
                  <Shield className="h-4 w-4" />
                  Incluir garantía
                </span>
              </label>
              {conGarantia && (
                <div className="space-y-2 pl-6">
                  <div>
                    <Label htmlFor="dias-garantia" className="text-sm">Días de garantía</Label>
                    <Input
                      id="dias-garantia"
                      type="number"
                      min="1"
                      value={diasGarantia}
                      onChange={(e) => setDiasGarantia(e.target.value)}
                      disabled={loading}
                      className="mt-1 w-32"
                    />
                  </div>
                  <div>
                    <Label htmlFor="notas-garantia" className="text-sm">Condiciones (opcional)</Label>
                    <Textarea
                      id="notas-garantia"
                      value={notasGarantia}
                      onChange={(e) => setNotasGarantia(e.target.value)}
                      placeholder="Condiciones o alcance de la garantía..."
                      rows={2}
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="notas-entrega">Notas de entrega (opcional)</Label>
            <Textarea
              id="notas-entrega"
              value={notasEntrega}
              onChange={(e) => setNotasEntrega(e.target.value)}
              placeholder="Observaciones sobre la entrega..."
              rows={2}
              disabled={loading}
              className="mt-1"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  {sinCobro ? <HandCoins className="mr-2 h-4 w-4" /> : esRetiro ? <PackageX className="mr-2 h-4 w-4" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                  {sinCobro ? "Confirmar Entrega sin Cobro" : esRetiro ? "Confirmar Retiro" : "Confirmar Entrega"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
