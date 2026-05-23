"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Loader2 } from "lucide-react"

interface AperturaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AperturaDialog({ open, onOpenChange, onSuccess }: AperturaDialogProps) {
  const [saldoInicial, setSaldoInicial] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async () => {
    setError("")
    const monto = parseFloat(saldoInicial || "0")
    if (isNaN(monto) || monto < 0) {
      setError("Ingrese un monto válido")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/caja/sesiones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saldoInicial: monto }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al abrir caja")
      }

      setSaldoInicial("")
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al abrir caja")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Abrir Caja</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Saldo inicial en efectivo</label>
            <Input
              type="text"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={saldoInicial}
              onChange={(e) => setSaldoInicial(e.target.value)}
              className="mt-1"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              Monto de efectivo con el que se inicia la caja
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Abrir Caja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
