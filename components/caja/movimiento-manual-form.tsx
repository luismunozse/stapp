"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Plus } from "lucide-react"

const CONCEPTOS_INGRESO = [
  "Ingreso manual",
  "Cobro en efectivo",
  "Otro ingreso",
]

const CONCEPTOS_EGRESO = [
  "Retiro de efectivo",
  "Gasto varios",
  "Pago a proveedor",
  "Compra de insumos",
  "Otro egreso",
]

const METODOS = [
  { value: "EFECTIVO", label: "Efectivo" },
  { value: "TRANSFERENCIA", label: "Transferencia" },
  { value: "TARJETA_DEBITO", label: "Tarjeta Débito" },
  { value: "TARJETA_CREDITO", label: "Tarjeta Crédito" },
  { value: "MERCADOPAGO", label: "MercadoPago" },
  { value: "OTRO", label: "Otro" },
]

interface MovimientoManualFormProps {
  onCreated: () => void
}

export function MovimientoManualForm({ onCreated }: MovimientoManualFormProps) {
  const [tipo, setTipo] = useState<"INGRESO" | "EGRESO">("EGRESO")
  const [monto, setMonto] = useState("")
  const [metodoPago, setMetodoPago] = useState("EFECTIVO")
  const [concepto, setConcepto] = useState("")
  const [conceptoCustom, setConceptoCustom] = useState("")
  const [observaciones, setObservaciones] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const conceptos = tipo === "INGRESO" ? CONCEPTOS_INGRESO : CONCEPTOS_EGRESO
  const conceptoFinal = concepto === "_custom" ? conceptoCustom : concepto

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    const montoNum = parseFloat(monto)
    if (!monto || isNaN(montoNum) || montoNum <= 0) {
      setError("Ingrese un monto válido mayor a 0")
      return
    }
    if (!conceptoFinal) {
      setError("Seleccione o ingrese un concepto")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/caja/movimientos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo,
          monto: montoNum,
          metodoPago,
          concepto: conceptoFinal,
          observaciones: observaciones || undefined,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || "Error al crear movimiento")
      }

      // Reset form
      setMonto("")
      setConcepto("")
      setConceptoCustom("")
      setObservaciones("")
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al crear movimiento")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Nuevo Movimiento Manual</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tipo */}
            <div>
              <label className="text-sm font-medium">Tipo</label>
              <div className="flex gap-2 mt-1">
                <Button
                  type="button"
                  variant={tipo === "EGRESO" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => { setTipo("EGRESO"); setConcepto("") }}
                >
                  Egreso
                </Button>
                <Button
                  type="button"
                  variant={tipo === "INGRESO" ? "default" : "outline"}
                  size="sm"
                  className="flex-1"
                  onClick={() => { setTipo("INGRESO"); setConcepto("") }}
                >
                  Ingreso
                </Button>
              </div>
            </div>

            {/* Monto */}
            <div>
              <label className="text-sm font-medium">Monto</label>
              <Input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                className="mt-1"
              />
            </div>

            {/* Método de pago */}
            <div>
              <label className="text-sm font-medium">Método de pago</label>
              <Select value={metodoPago} onValueChange={setMetodoPago}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METODOS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Concepto */}
            <div>
              <label className="text-sm font-medium">Concepto</label>
              <Select value={concepto} onValueChange={setConcepto}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Seleccionar concepto" />
                </SelectTrigger>
                <SelectContent>
                  {conceptos.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                  <SelectItem value="_custom">Otro (personalizado)</SelectItem>
                </SelectContent>
              </Select>
              {concepto === "_custom" && (
                <Input
                  placeholder="Describir concepto..."
                  value={conceptoCustom}
                  onChange={(e) => setConceptoCustom(e.target.value)}
                  className="mt-2"
                />
              )}
            </div>
          </div>

          {/* Observaciones */}
          <div>
            <label className="text-sm font-medium">Observaciones (opcional)</label>
            <Textarea
              placeholder="Notas adicionales..."
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              className="mt-1"
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <Button type="submit" disabled={loading} className="w-full sm:w-auto">
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            Registrar Movimiento
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
