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
import { SignaturePad } from "@/components/firma/signature-pad"
import { formatCurrency } from "@/lib/utils"
import { Loader2, CheckCircle } from "lucide-react"

interface CotizacionApprovalDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  cotizacion: {
    id: string
    numeroCotizacion: string
    total: number
  }
}

export function CotizacionApprovalDialog({
  open,
  onClose,
  onSuccess,
  cotizacion,
}: CotizacionApprovalDialogProps) {
  const [loading, setLoading] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  const [firmaMime, setFirmaMime] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleSignatureChange = (data: string | null, mime: string | null) => {
    setFirma(data)
    setFirmaMime(mime)
    setError(null)
  }

  const handleApprove = async () => {
    if (!firma || !firmaMime) {
      setError("La firma es requerida para aprobar la cotizacion")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/cotizaciones/${cotizacion.id}/aprobar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaAprobacion: firma,
          firmaMime: firmaMime,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al aprobar cotizacion")
        return
      }

      onSuccess()
      onClose()
    } catch (err) {
      console.error("Error:", err)
      setError("Error al aprobar cotizacion")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setFirma(null)
      setFirmaMime(null)
      setError(null)
      onClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Aprobar Cotizacion</DialogTitle>
          <DialogDescription>
            Cotizacion {cotizacion.numeroCotizacion} por {formatCurrency(cotizacion.total)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Capture la firma del cliente para confirmar la aprobacion del presupuesto.
          </p>

          <SignaturePad
            label="Firma de Aprobacion"
            onSignatureChange={handleSignatureChange}
            disabled={loading}
          />

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
              onClick={handleApprove}
              disabled={loading || !firma}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aprobando...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Aprobar Cotizacion
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
