"use client"

import { useEffect, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

const LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta débito",
  TARJETA_CREDITO: "Tarjeta crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta corriente",
  OTRO: "Otro",
}

interface Recargo {
  metodo: string
  porcentaje: number
}

export function RecargosMetodoForm() {
  const [recargos, setRecargos] = useState<Recargo[]>([])
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    fetch("/api/configuracion/recargos-metodo")
      .then((r) => r.json())
      .then((d) => setRecargos(d.recargos ?? []))
      .catch(() => setMsg({ type: "error", text: "Error al cargar la configuración" }))
  }, [])

  const setPct = (metodo: string, value: number) =>
    setRecargos((prev) =>
      prev.map((r) => (r.metodo === metodo ? { ...r, porcentaje: value } : r))
    )

  const guardar = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const res = await fetch("/api/configuracion/recargos-metodo", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recargos }),
      })
      if (res.ok) {
        setMsg({ type: "success", text: "Configuración guardada exitosamente" })
      } else {
        const body = await res.json()
        setMsg({ type: "error", text: body.error || "Error al guardar" })
      }
    } catch {
      setMsg({ type: "error", text: "Error al guardar la configuración" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4 max-w-md">
      {msg && (
        <div
          className={`px-4 py-3 rounded text-sm ${
            msg.type === "success"
              ? "bg-success-50 dark:bg-success/15 border border-success-200 dark:border-success/30 text-success-600 dark:text-success-500"
              : "bg-destructive/10 border border-destructive/30 text-destructive"
          }`}
        >
          {msg.text}
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        El porcentaje sube el precio de la venta para ese método de pago (ingreso real, no interés bancario).
        Dejá en 0 los métodos sin recargo.
      </p>

      <div className="space-y-3">
        {recargos.map((r) => (
          <div key={r.metodo} className="flex items-center justify-between gap-3">
            <Label className="text-sm">{LABELS[r.metodo] ?? r.metodo}</Label>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={r.porcentaje}
                onChange={(e) => setPct(r.metodo, parseFloat(e.target.value) || 0)}
                className="w-24 text-right"
                aria-label={`Recargo ${LABELS[r.metodo] ?? r.metodo}`}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        ))}
      </div>

      <Button onClick={guardar} disabled={saving}>
        {saving ? "Guardando…" : "Guardar"}
      </Button>
    </div>
  )
}
