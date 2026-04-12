"use client"

import { useState } from "react"
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
import { Loader2, PackageCheck, PackageX, AlertTriangle, Shield } from "lucide-react"

interface EntregaDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  orden: {
    id: string
    numeroOrden: number
    codigoOrden?: string
    dispositivo: string
    cliente: {
      nombre: string
      telefono: string
    }
    estadoCobro?: string
    pendienteCobro?: number
  }
  encargadoNombre: string
  esRetiro?: boolean
}

export function EntregaDialog({
  open,
  onClose,
  onSuccess,
  orden,
  encargadoNombre,
  esRetiro = false,
}: EntregaDialogProps) {
  const [loading, setLoading] = useState(false)
  const [firmaCliente, setFirmaCliente] = useState<string | null>(null)
  const [firmaClienteMime, setFirmaClienteMime] = useState<string | null>(null)
  const [firmaEncargado, setFirmaEncargado] = useState<string | null>(null)
  const [firmaEncargadoMime, setFirmaEncargadoMime] = useState<string | null>(null)
  const [notasEntrega, setNotasEntrega] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [entregarSinCobro, setEntregarSinCobro] = useState(false)
  const [conGarantia, setConGarantia] = useState(!esRetiro)
  const [diasGarantia, setDiasGarantia] = useState(30)
  const [notasGarantia, setNotasGarantia] = useState("")

  const tienePendiente = orden.estadoCobro && orden.estadoCobro !== "COBRADO" && (orden.pendienteCobro || 0) > 0

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
          ...(conGarantia && !esRetiro ? {
            diasGarantia,
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
      setEntregarSinCobro(false)
      setConGarantia(!esRetiro)
      setDiasGarantia(30)
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
            {esRetiro ? <PackageX className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
            {esRetiro ? "Retiro de Equipo Sin Reparación" : "Entrega de Equipo"}
          </DialogTitle>
          <DialogDescription>
            Orden {codigoDisplay} - {orden.dispositivo}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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

          {/* Alerta/Bloqueo si no está cobrado (solo para entregas normales) */}
          {!esRetiro && orden.estadoCobro && orden.estadoCobro !== "COBRADO" && orden.pendienteCobro && orden.pendienteCobro > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm">
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-red-800 dark:text-red-300">
                  Cobro pendiente: {orden.pendienteCobro?.toLocaleString("es-AR", { style: "currency", currency: "ARS" })}
                </p>
                <p className="text-red-700 dark:text-red-400 text-xs mt-0.5">
                  Se recomienda cobrar antes de entregar. Para entregar sin cobro completo, marque la casilla a continuación.
                </p>
                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={entregarSinCobro}
                    onChange={(e) => setEntregarSinCobro(e.target.checked)}
                    className="rounded border-red-300"
                  />
                  <span className="text-xs text-red-700 dark:text-red-400">
                    Confirmo la entrega sin cobro completo
                  </span>
                </label>
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

          {/* Garantía (solo para entregas normales, no retiros) */}
          {!esRetiro && (
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
                      onChange={(e) => setDiasGarantia(parseInt(e.target.value) || 30)}
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
              disabled={loading || (!esRetiro && !!tienePendiente && !entregarSinCobro)}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  {esRetiro ? <PackageX className="mr-2 h-4 w-4" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                  {esRetiro ? "Confirmar Retiro" : "Confirmar Entrega"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
