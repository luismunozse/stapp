"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Trash2, Banknote, ArrowRightLeft, CreditCard, Wallet, MoreHorizontal, PiggyBank } from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"

const METODOS_PAGO = [
  { value: "EFECTIVO", label: "Efectivo", icon: Banknote },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: ArrowRightLeft },
  { value: "TARJETA_DEBITO", label: "T. Débito", icon: CreditCard },
  { value: "TARJETA_CREDITO", label: "T. Crédito", icon: CreditCard },
  { value: "MERCADOPAGO", label: "MercadoPago", icon: Wallet },
  { value: "CUENTA_CORRIENTE", label: "Cuenta", icon: PiggyBank },
  { value: "OTRO", label: "Otro", icon: MoreHorizontal },
] as const

export type MetodoPagoValue = typeof METODOS_PAGO[number]["value"]

export interface PagoLineItem {
  id: string
  metodo: MetodoPagoValue
  monto: number
  referencia: string
  cuotas: number | null
  recargo: number | null
  montoOriginal: number | null
}

interface MultiPagoInputProps {
  montoPendiente: number
  pagos: PagoLineItem[]
  onChange: (pagos: PagoLineItem[]) => void
  saldoCuenta?: number // saldo disponible en cuenta corriente del cliente
  showCuentaCorriente?: boolean // mostrar opción de cuenta corriente
}

let lineIdCounter = 0
export function createPagoLine(monto: number = 0, metodo: MetodoPagoValue = "EFECTIVO"): PagoLineItem {
  return {
    id: `pago_${++lineIdCounter}_${Date.now()}`,
    metodo,
    monto,
    referencia: "",
    cuotas: null,
    recargo: null,
    montoOriginal: null,
  }
}

export function MultiPagoInput({
  montoPendiente,
  pagos,
  onChange,
  saldoCuenta = 0,
  showCuentaCorriente = false,
}: MultiPagoInputProps) {
  const { formatPrice } = useCurrency()

  // Use base amounts for totals (recargo is bank interest, not store income)
  const totalPagos = useMemo(() => pagos.reduce((sum, p) => sum + (p.monto || 0), 0), [pagos])
  const restante = montoPendiente - totalPagos

  const metodosDisponibles = useMemo(() => {
    if (showCuentaCorriente) return METODOS_PAGO
    return METODOS_PAGO.filter(m => m.value !== "CUENTA_CORRIENTE")
  }, [showCuentaCorriente])

  const updatePago = (index: number, updates: Partial<PagoLineItem>) => {
    const newPagos = [...pagos]
    newPagos[index] = { ...newPagos[index], ...updates }

    // Si cambia el método, limpiar campos condicionales
    if (updates.metodo) {
      if (updates.metodo !== "TARJETA_CREDITO" && updates.metodo !== "TARJETA_DEBITO") {
        newPagos[index].cuotas = null
        newPagos[index].recargo = null
        newPagos[index].montoOriginal = null
      }
      if (updates.metodo !== "TRANSFERENCIA" && updates.metodo !== "MERCADOPAGO") {
        newPagos[index].referencia = ""
      }
      if (updates.metodo === "TARJETA_CREDITO") {
        newPagos[index].cuotas = 1
      }
    }

    // Recalcular monto total cuando cambia recargo o monto base
    // monto = precio original, montoOriginal = precio original (se guarda para referencia)
    // El monto final que se paga = monto + (monto * recargo / 100)
    if (updates.recargo !== undefined || updates.monto !== undefined) {
      const pago = newPagos[index]
      if (pago.recargo && pago.recargo > 0) {
        pago.montoOriginal = pago.monto // guardar monto base original
      } else {
        pago.montoOriginal = null
      }
    }

    onChange(newPagos)
  }

  const addPago = () => {
    const nuevoMonto = Math.max(0, restante)
    onChange([...pagos, createPagoLine(nuevoMonto)])
  }

  const removePago = (index: number) => {
    if (pagos.length <= 1) return
    const newPagos = pagos.filter((_, i) => i !== index)
    onChange(newPagos)
  }

  return (
    <div className="space-y-3">
      {pagos.map((pago, index) => {
        const showReferencia = pago.metodo === "TRANSFERENCIA" || pago.metodo === "MERCADOPAGO"
        const showCuotas = pago.metodo === "TARJETA_CREDITO"
        const showRecargo = pago.metodo === "TARJETA_CREDITO" || pago.metodo === "TARJETA_DEBITO"
        const esCuentaCorriente = pago.metodo === "CUENTA_CORRIENTE"

        return (
          <div key={pago.id} className="rounded-lg border p-3 space-y-3">
            {/* Header con número de pago y botón eliminar */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Pago {index + 1}{pagos.length > 1 ? ` de ${pagos.length}` : ""}
              </span>
              {pagos.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  onClick={() => removePago(index)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Método de pago */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
              {metodosDisponibles.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updatePago(index, { metodo: value })}
                  className={cn(
                    "flex flex-col items-center gap-0.5 p-2 rounded-lg border-2 text-center transition-all text-[10px] leading-tight",
                    pago.metodo === value
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Saldo disponible en cuenta corriente */}
            {esCuentaCorriente && (
              <div className="text-xs p-2 rounded bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <span className="text-muted-foreground">Saldo disponible: </span>
                <span className="font-semibold text-blue-600">{formatPrice(saldoCuenta)}</span>
                {pago.monto > saldoCuenta && (
                  <div className="text-red-500 mt-1">
                    El monto excede el saldo disponible
                  </div>
                )}
              </div>
            )}

            {/* Monto */}
            <div>
              <Label className="text-xs">Monto *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={pago.monto || ""}
                onChange={(e) => updatePago(index, { monto: parseFloat(e.target.value) || 0 })}
                placeholder="0.00"
              />
            </div>

            {/* Cuotas + Recargo para tarjeta crédito */}
            {showCuotas && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Cuotas</Label>
                  <Input
                    type="number"
                    min={1}
                    max={48}
                    value={pago.cuotas || ""}
                    onChange={(e) => updatePago(index, { cuotas: parseInt(e.target.value) || null })}
                    placeholder="1"
                  />
                </div>
                <div>
                  <Label className="text-xs">Recargo %</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={100}
                    value={pago.recargo || ""}
                    onChange={(e) => updatePago(index, { recargo: parseFloat(e.target.value) || null })}
                    placeholder="0"
                  />
                </div>
              </div>
            )}

            {/* Recargo solo débito */}
            {pago.metodo === "TARJETA_DEBITO" && (
              <div>
                <Label className="text-xs">Recargo % (si aplica)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={pago.recargo || ""}
                  onChange={(e) => updatePago(index, { recargo: parseFloat(e.target.value) || null })}
                  placeholder="0"
                />
              </div>
            )}

            {/* Preview de recargo */}
            {showRecargo && pago.recargo && pago.recargo > 0 && pago.monto > 0 && (() => {
              const montoRecargo = pago.monto * (pago.recargo / 100)
              const totalConRecargo = pago.monto + montoRecargo
              return (
                <div className="p-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-xs space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monto base:</span>
                    <span>{formatPrice(pago.monto)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Recargo ({pago.recargo}%):</span>
                    <span className="text-amber-600">+{formatPrice(montoRecargo)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t border-amber-300 dark:border-amber-700 pt-0.5">
                    <span>Total a cobrar:</span>
                    <span>{formatPrice(totalConRecargo)}</span>
                  </div>
                  {showCuotas && pago.cuotas && pago.cuotas > 1 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>{pago.cuotas} cuotas de:</span>
                      <span>{formatPrice(totalConRecargo / pago.cuotas)}</span>
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Referencia */}
            {showReferencia && (
              <div>
                <Label className="text-xs">Nro. de referencia</Label>
                <Input
                  value={pago.referencia}
                  onChange={(e) => updatePago(index, { referencia: e.target.value })}
                  placeholder={
                    pago.metodo === "TRANSFERENCIA"
                      ? "CBU, alias o nro. de operación"
                      : "Nro. de operación MercadoPago"
                  }
                />
              </div>
            )}
          </div>
        )
      })}

      {/* Botón agregar otro método */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={addPago}
      >
        <Plus className="mr-1 h-4 w-4" />
        Agregar otro método de pago
      </Button>

      {/* Resumen de pagos */}
      {pagos.length > 1 && (
        <div className="p-3 rounded-lg bg-muted text-sm space-y-1">
          {pagos.map((pago) => {
            const metodoDef = METODOS_PAGO.find(m => m.value === pago.metodo)
            return (
              <div key={pago.id} className="flex justify-between">
                <span className="text-muted-foreground">
                  {metodoDef?.label || pago.metodo}
                  {pago.recargo && pago.recargo > 0 ? ` (+${pago.recargo}% interés)` : ""}:
                </span>
                <span className="font-medium">{formatPrice(pago.monto || 0)}</span>
              </div>
            )
          })}
          <div className="flex justify-between border-t pt-1 font-medium">
            <span>Total pagos:</span>
            <span className={cn(
              Math.abs(restante) < 0.01 ? "text-green-600" : "text-red-600"
            )}>
              {formatPrice(totalPagos)}
            </span>
          </div>
          {Math.abs(restante) >= 0.01 && (
            <div className="flex justify-between text-red-600 text-xs">
              <span>{restante > 0 ? "Falta:" : "Excede:"}</span>
              <span>{formatPrice(Math.abs(restante))}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
