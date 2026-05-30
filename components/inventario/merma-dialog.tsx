"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { useModal } from "@/contexts/modal-context"
import { Loader2 } from "lucide-react"

interface MermaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  itemId: string
  itemNombre: string
  currentStock: number
  onSuccess?: () => void
}

const TIPOS = [
  { value: "MERMA", label: "Merma / vencido" },
  { value: "ROTURA", label: "Rotura" },
  { value: "ROBO", label: "Robo / pérdida" },
  { value: "OBSOLESCENCIA", label: "Obsolescencia" },
  { value: "DONACION", label: "Donación / regalo" },
  { value: "AJUSTE_FISICO", label: "Ajuste por conteo físico" },
  { value: "OTRO", label: "Otro" },
] as const

export function MermaDialog({
  open,
  onOpenChange,
  itemId,
  itemNombre,
  currentStock,
  onSuccess,
}: MermaDialogProps) {
  const { showError } = useModal()
  const [tipo, setTipo] = useState<string>("MERMA")
  const [direccion, setDireccion] = useState<"SALIDA" | "ENTRADA">("SALIDA")
  const [cantidad, setCantidad] = useState<string>("1")
  const [motivo, setMotivo] = useState("")
  const [afectaRentabilidad, setAfectaRentabilidad] = useState(true)
  const [pending, setPending] = useState(false)

  const reset = () => {
    setTipo("MERMA")
    setDireccion("SALIDA")
    setCantidad("1")
    setMotivo("")
    setAfectaRentabilidad(true)
  }

  const handleSubmit = async () => {
    const cantidadNum = Math.max(1, parseInt(cantidad, 10) || 1)
    if (cantidadNum <= 0) {
      await showError("Cantidad debe ser mayor a 0")
      return
    }
    if (direccion === "SALIDA" && cantidadNum > currentStock) {
      await showError(`Stock insuficiente. Disponible: ${currentStock}`)
      return
    }
    setPending(true)
    try {
      const res = await fetch("/api/inventario/ajustes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inventarioId: itemId,
          tipo,
          direccion,
          cantidad: cantidadNum,
          motivo: motivo || null,
          afectaRentabilidad,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        await showError(json.error || "Error al registrar ajuste")
        return
      }
      toast.success("Ajuste registrado")
      onOpenChange(false)
      reset()
      onSuccess?.()
    } catch {
      await showError("Error de red")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajuste de inventario</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <strong>{itemNombre}</strong> · Stock actual: {currentStock}
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={setTipo} disabled={pending}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={direccion === "SALIDA" ? "default" : "outline"}
              onClick={() => setDireccion("SALIDA")}
              disabled={pending}
              className="flex-1"
            >
              Salida (resta stock)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={direccion === "ENTRADA" ? "default" : "outline"}
              onClick={() => setDireccion("ENTRADA")}
              disabled={pending}
              className="flex-1"
            >
              Entrada (suma stock)
            </Button>
          </div>
          <div>
            <Label className="text-xs">Cantidad</Label>
            <Input
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              disabled={pending}
            />
          </div>
          <div>
            <Label className="text-xs">Motivo (opcional)</Label>
            <Textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej: vencido / roto al manipular / faltante en conteo..."
              disabled={pending}
              maxLength={500}
              rows={2}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="afecta-rentabilidad"
              checked={afectaRentabilidad}
              onChange={(e) => setAfectaRentabilidad(e.target.checked)}
              disabled={pending}
              className="h-4 w-4"
            />
            <Label htmlFor="afecta-rentabilidad" className="text-xs cursor-pointer">
              Afecta rentabilidad (cuenta como costo en finanzas)
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={pending}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Registrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
