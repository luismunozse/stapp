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
import { Loader2, PackageCheck } from "lucide-react"

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
  }
  encargadoNombre: string
}

export function EntregaDialog({
  open,
  onClose,
  onSuccess,
  orden,
  encargadoNombre,
}: EntregaDialogProps) {
  const [loading, setLoading] = useState(false)
  const [firmaCliente, setFirmaCliente] = useState<string | null>(null)
  const [firmaClienteMime, setFirmaClienteMime] = useState<string | null>(null)
  const [firmaEncargado, setFirmaEncargado] = useState<string | null>(null)
  const [firmaEncargadoMime, setFirmaEncargadoMime] = useState<string | null>(null)
  const [notasEntrega, setNotasEntrega] = useState("")
  const [error, setError] = useState<string | null>(null)

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
    if (!firmaCliente || !firmaClienteMime) {
      setError("La firma del cliente es requerida")
      return
    }
    if (!firmaEncargado || !firmaEncargadoMime) {
      setError("La firma del encargado es requerida")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/ordenes/${orden.id}/entregar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaClienteEntrega: firmaCliente,
          firmaClienteMime: firmaClienteMime,
          firmaEncargadoEntrega: firmaEncargado,
          firmaEncargadoMime: firmaEncargadoMime,
          notasEntrega: notasEntrega || null,
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
      onClose()
    }
  }

  const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageCheck className="h-5 w-5" />
            Entrega de Equipo
          </DialogTitle>
          <DialogDescription>
            Orden {codigoDisplay} - {orden.dispositivo}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 p-3 rounded-lg text-sm">
            <p><strong>Cliente:</strong> {orden.cliente.nombre}</p>
            <p><strong>Telefono:</strong> {orden.cliente.telefono}</p>
          </div>

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Firma del Cliente (quien recibe)
              </Label>
              <SignaturePad
                onSignatureChange={handleFirmaClienteChange}
                disabled={loading}
              />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Firma del Encargado ({encargadoNombre})
              </Label>
              <SignaturePad
                onSignatureChange={handleFirmaEncargadoChange}
                disabled={loading}
              />
            </div>
          </div>

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
              disabled={loading || !firmaCliente || !firmaEncargado}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  <PackageCheck className="mr-2 h-4 w-4" />
                  Confirmar Entrega
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
