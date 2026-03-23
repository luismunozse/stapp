"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  PiggyBank,
  Plus,
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  ArrowRightLeft,
  CreditCard,
  Wallet,
  MoreHorizontal,
  Loader2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useCurrency } from "@/contexts/currency-context"
import type { Cliente } from "@/types"

const METODOS_DEPOSITO = [
  { value: "EFECTIVO", label: "Efectivo", icon: Banknote },
  { value: "TRANSFERENCIA", label: "Transferencia", icon: ArrowRightLeft },
  { value: "TARJETA_DEBITO", label: "T. Débito", icon: CreditCard },
  { value: "TARJETA_CREDITO", label: "T. Crédito", icon: CreditCard },
  { value: "MERCADOPAGO", label: "MercadoPago", icon: Wallet },
  { value: "OTRO", label: "Otro", icon: MoreHorizontal },
] as const

type MetodoDeposito = typeof METODOS_DEPOSITO[number]["value"]

interface Movimiento {
  id: string
  tipo: string
  monto: number
  saldoPosterior: number
  metodoPago: string | null
  referenciaTipo: string | null
  referenciaId: string | null
  numeroReferencia: string | null
  observaciones: string | null
  createdAt: string
}

interface CuentaCorrienteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  cliente: Cliente
  onDeposito?: () => void
}

const tipoLabels: Record<string, string> = {
  DEPOSITO: "Depósito",
  USO: "Uso",
  DEVOLUCION: "Devolución",
  AJUSTE: "Ajuste",
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito",
  MERCADOPAGO: "MercadoPago",
  OTRO: "Otro",
}

export function CuentaCorrienteDialog({
  open,
  onOpenChange,
  cliente,
  onDeposito,
}: CuentaCorrienteDialogProps) {
  const { formatPrice, formatDate } = useCurrency()
  const [saldo, setSaldo] = useState(0)
  const [movimientos, setMovimientos] = useState<Movimiento[]>([])
  const [loading, setLoading] = useState(true)
  const [showDeposito, setShowDeposito] = useState(false)
  const [depositoLoading, setDepositoLoading] = useState(false)

  // Deposito form state
  const [depositoMonto, setDepositoMonto] = useState<number>(0)
  const [depositoMetodo, setDepositoMetodo] = useState<MetodoDeposito>("EFECTIVO")
  const [depositoReferencia, setDepositoReferencia] = useState("")
  const [depositoObservaciones, setDepositoObservaciones] = useState("")

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/cuenta-corriente?limit=50`)
      if (res.ok) {
        const data = await res.json()
        setSaldo(data.saldo || 0)
        setMovimientos(data.movimientos || [])
      }
    } catch (err) {
      console.error("Error fetching cuenta corriente:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) fetchData()
  }, [open, cliente.id])

  const handleDeposito = async () => {
    if (!depositoMonto || depositoMonto <= 0) {
      alert("El monto debe ser mayor a 0")
      return
    }

    setDepositoLoading(true)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/cuenta-corriente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monto: depositoMonto,
          metodoPago: depositoMetodo,
          numeroReferencia: depositoReferencia || undefined,
          observaciones: depositoObservaciones || undefined,
        }),
      })

      if (!res.ok) {
        const error = await res.json()
        alert(error.error || "Error al registrar depósito")
        return
      }

      // Reset form
      setDepositoMonto(0)
      setDepositoMetodo("EFECTIVO")
      setDepositoReferencia("")
      setDepositoObservaciones("")
      setShowDeposito(false)

      // Refresh data
      fetchData()
      onDeposito?.()
    } catch (err) {
      console.error("Error creating deposito:", err)
      alert("Error al registrar depósito")
    } finally {
      setDepositoLoading(false)
    }
  }

  const showReferencia = depositoMetodo === "TRANSFERENCIA" || depositoMetodo === "MERCADOPAGO"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PiggyBank className="h-5 w-5" />
            Cuenta Corriente - {cliente.nombre}
          </DialogTitle>
        </DialogHeader>

        {/* Saldo actual */}
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-sm text-muted-foreground">Saldo disponible</div>
              <div className={cn(
                "text-3xl font-bold mt-1",
                saldo > 0 ? "text-blue-600" : "text-muted-foreground"
              )}>
                {formatPrice(saldo)}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Botón registrar depósito */}
        <Button
          onClick={() => setShowDeposito(!showDeposito)}
          variant={showDeposito ? "outline" : "default"}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          Registrar Depósito a Cuenta
        </Button>

        {/* Form de depósito */}
        {showDeposito && (
          <div className="rounded-lg border p-4 space-y-4">
            <h4 className="font-medium text-sm">Nuevo Depósito</h4>

            {/* Método */}
            <div className="grid grid-cols-3 gap-1.5">
              {METODOS_DEPOSITO.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setDepositoMetodo(value)}
                  className={cn(
                    "flex flex-col items-center gap-0.5 p-2 rounded-lg border-2 text-center transition-all text-[10px] leading-tight",
                    depositoMetodo === value
                      ? "border-primary bg-primary/5 text-primary font-medium"
                      : "border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* Monto */}
            <div>
              <Label className="text-xs">Monto *</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={depositoMonto || ""}
                onChange={(e) => setDepositoMonto(parseFloat(e.target.value) || 0)}
                placeholder="0.00"
              />
            </div>

            {/* Referencia */}
            {showReferencia && (
              <div>
                <Label className="text-xs">Nro. de referencia</Label>
                <Input
                  value={depositoReferencia}
                  onChange={(e) => setDepositoReferencia(e.target.value)}
                  placeholder={
                    depositoMetodo === "TRANSFERENCIA"
                      ? "CBU, alias o nro. de operación"
                      : "Nro. de operación MercadoPago"
                  }
                />
              </div>
            )}

            {/* Observaciones */}
            <div>
              <Label className="text-xs">Observaciones</Label>
              <Textarea
                value={depositoObservaciones}
                onChange={(e) => setDepositoObservaciones(e.target.value)}
                placeholder="Notas del depósito..."
                rows={2}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowDeposito(false)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={handleDeposito} disabled={depositoLoading}>
                {depositoLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Registrando...
                  </>
                ) : (
                  "Registrar Depósito"
                )}
              </Button>
            </div>
          </div>
        )}

        {/* Historial de movimientos */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Movimientos</h4>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : movimientos.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              No hay movimientos registrados
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {movimientos.map((mov) => (
                <div
                  key={mov.id}
                  className="flex items-start justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-start gap-2">
                    {mov.monto >= 0 ? (
                      <ArrowDownCircle className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    ) : (
                      <ArrowUpCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                    )}
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "font-medium text-sm",
                          mov.monto >= 0 ? "text-green-600" : "text-red-600"
                        )}>
                          {mov.monto >= 0 ? "+" : ""}{formatPrice(Math.abs(mov.monto))}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {tipoLabels[mov.tipo] || mov.tipo}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(mov.createdAt)}
                        {mov.metodoPago && ` · ${metodoPagoLabels[mov.metodoPago] || mov.metodoPago}`}
                      </div>
                      {mov.referenciaTipo && mov.referenciaTipo !== "MANUAL" && (
                        <div className="text-xs text-muted-foreground">
                          {mov.referenciaTipo === "VENTA" ? "Venta" : mov.referenciaTipo === "FACTURA" ? "Factura" : mov.referenciaTipo}
                        </div>
                      )}
                      {mov.observaciones && (
                        <div className="text-xs text-muted-foreground">
                          {mov.observaciones}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    Saldo: {formatPrice(mov.saldoPosterior)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
