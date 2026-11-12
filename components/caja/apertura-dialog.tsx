"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { MoneyInput } from "@/components/ui/money-input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

interface AperturaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function AperturaDialog({ open, onOpenChange, onSuccess }: AperturaDialogProps) {
  const [saldoInicial, setSaldoInicial] = useState<number | null>(null)
  const [saldoInvalido, setSaldoInvalido] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async () => {
    setError("")
    const monto = saldoInicial ?? 0
    if (saldoInvalido || monto < 0) {
      setError("Ingresá un monto válido")
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

      setSaldoInicial(null)
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
            <label htmlFor="saldo-inicial" className="text-sm font-medium">Saldo inicial en efectivo</label>
            <MoneyInput
              id="saldo-inicial"
              value={saldoInicial}
              onValueChange={(v, { invalido }) => {
                setSaldoInicial(v)
                setSaldoInvalido(invalido)
              }}
              className="mt-1"
              autoFocus
            />
            <p className="text-xs text-muted-foreground mt-1">
              Monto de efectivo con el que se inicia la caja
            </p>
          </div>
          {error && <p className="text-sm text-destructive-text">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} loading={loading}>
            Abrir Caja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
