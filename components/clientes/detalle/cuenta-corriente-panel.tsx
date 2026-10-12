"use client"

import { useState, useEffect } from "react"
import useSWR from "swr"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  PiggyBank, Plus, ArrowDownCircle, ArrowUpCircle, Banknote,
  ArrowRightLeft, CreditCard, Wallet, MoreHorizontal, Loader2, Printer, FileText, Undo2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { EmptyState } from "@/components/ui/empty-state"
import { useCurrency } from "@/contexts/currency-context"
import { todayInTimeZone } from "@/lib/timezone"
import { useModal } from "@/contexts/modal-context"
import { RevertirCargoDialog } from "./revertir-cargo-dialog"
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
  revertidoAt: string | null
  revertidoMovimientoId: string | null
}

// CARGO and PAGO come from migration 234 (fiado). Without them the badge
// falls through to the raw enum for every credit sale and every debt payment.
const tipoLabels: Record<string, string> = {
  DEPOSITO: "Depósito", USO: "Uso", DEVOLUCION: "Devolución", AJUSTE: "Ajuste",
  CARGO: "Cargo", PAGO: "Pago",
}

// A recibo acknowledges money received, so only the two movement types that
// bring money in can be emitted — same rule the API and migration 306 enforce.
const TIPOS_CON_RECIBO = ["DEPOSITO", "PAGO"]

// A fiado charge tied to an order is the only movement kind that can be
// reverted (see the revertir_cargos_orden RPC).
function esCargoReversible(mov: Movimiento): boolean {
  return mov.tipo === "CARGO" && mov.referenciaTipo === "ORDEN" && mov.revertidoAt == null
}

const metodoPagoLabels: Record<string, string> = {
  EFECTIVO: "Efectivo", TRANSFERENCIA: "Transferencia", TARJETA_DEBITO: "Tarjeta Débito",
  TARJETA_CREDITO: "Tarjeta Crédito", MERCADOPAGO: "MercadoPago", OTRO: "Otro",
}

interface CuentaCorrientePanelProps {
  cliente: Cliente
  onDeposito?: () => void
}

export function CuentaCorrientePanel({ cliente, onDeposito }: CuentaCorrientePanelProps) {
  const { formatPrice, formatDate, timezone } = useCurrency()
  const { showError } = useModal()
  const { data: session } = useSession()
  const esAdmin = session?.user?.role === "ADMIN"

  // Month-to-date in the org's timezone, matching the resumen route's own
  // default so the form opens on the range the API would have picked anyway.
  const hoy = todayInTimeZone(timezone)
  const [showResumen, setShowResumen] = useState(false)
  const [resumenDesde, setResumenDesde] = useState(`${hoy.slice(0, 7)}-01`)
  const [resumenHasta, setResumenHasta] = useState(hoy)

  const [showDeposito, setShowDeposito] = useState(false)
  const [depositoLoading, setDepositoLoading] = useState(false)
  const [depositoMonto, setDepositoMonto] = useState<string>("")
  const [depositoMetodo, setDepositoMetodo] = useState<MetodoDeposito>("EFECTIVO")
  const [depositoReferencia, setDepositoReferencia] = useState("")
  const [depositoObservaciones, setDepositoObservaciones] = useState("")
  const [revertirTarget, setRevertirTarget] = useState<Movimiento | null>(null)

  const { data, isLoading: loading, mutate } = useSWR<{ saldo: number; movimientos: Movimiento[] }>(
    `/api/clientes/${cliente.id}/cuenta-corriente?limit=50`,
    (url: string) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false }
  )
  const saldo = data?.saldo ?? 0
  const movimientos = data?.movimientos ?? []

  useEffect(() => {
    setShowDeposito(false)
    setDepositoMonto("")
    setDepositoMetodo("EFECTIVO")
    setDepositoReferencia("")
    setDepositoObservaciones("")
  }, [cliente.id])

  const handleDeposito = async () => {
    const depositoMontoNum = parseFloat(depositoMonto) || 0
    if (!depositoMontoNum || depositoMontoNum <= 0) {
      await showError("El monto debe ser mayor a 0")
      return
    }
    setDepositoLoading(true)
    try {
      const res = await fetch(`/api/clientes/${cliente.id}/cuenta-corriente`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          monto: depositoMontoNum,
          metodoPago: depositoMetodo,
          numeroReferencia: depositoReferencia || undefined,
          observaciones: depositoObservaciones || undefined,
        }),
      })
      if (!res.ok) {
        const error = await res.json()
        await showError(error.error || "Error al registrar depósito")
        return
      }
      setDepositoMonto("")
      setDepositoMetodo("EFECTIVO")
      setDepositoReferencia("")
      setDepositoObservaciones("")
      setShowDeposito(false)
      mutate()
      onDeposito?.()
    } catch (err) {
      console.error("Error creating deposito:", err)
      await showError("Error al registrar depósito")
    } finally {
      setDepositoLoading(false)
    }
  }

  const showReferencia = depositoMetodo === "TRANSFERENCIA" || depositoMetodo === "MERCADOPAGO"

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center">
            <div className="text-sm text-muted-foreground">Saldo disponible</div>
            <div className={cn(
              "text-2xl font-bold tabular-nums mt-1",
              saldo > 0 ? "text-info-600" : "text-muted-foreground"
            )}>
              {formatPrice(saldo)}
            </div>
          </div>
        </CardContent>
      </Card>

      {esAdmin && (
        <Button
          onClick={() => setShowDeposito(!showDeposito)}
          variant={showDeposito ? "outline" : "default"}
          className="w-full"
        >
          <Plus className="mr-2 h-4 w-4" />
          Registrar Depósito a Cuenta
        </Button>
      )}

      {esAdmin && showDeposito && (
        <div className="rounded-lg border p-4 space-y-4">
          <h4 className="font-medium text-sm">Nuevo Depósito</h4>
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
          <div>
            <Label className="text-xs">Monto *</Label>
            <Input type="number" step="0.01" min="0" value={depositoMonto}
              onChange={(e) => setDepositoMonto(e.target.value)} placeholder="0.00" />
          </div>
          {showReferencia && (
            <div>
              <Label className="text-xs">Nro. de referencia</Label>
              <Input value={depositoReferencia} onChange={(e) => setDepositoReferencia(e.target.value)}
                placeholder={depositoMetodo === "TRANSFERENCIA" ? "CBU, alias o nro. de operación" : "Nro. de operación MercadoPago"} />
            </div>
          )}
          <div>
            <Label className="text-xs">Observaciones</Label>
            <Textarea value={depositoObservaciones} onChange={(e) => setDepositoObservaciones(e.target.value)}
              placeholder="Notas del depósito..." rows={2} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setShowDeposito(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleDeposito} disabled={depositoLoading}>
              {depositoLoading ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" />Registrando...</>) : "Registrar Depósito"}
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">Movimientos</h4>
          <Button variant="outline" size="sm" onClick={() => setShowResumen((v) => !v)}>
            <FileText className="mr-2 h-3.5 w-3.5" />
            Resumen de cuenta
          </Button>
        </div>

        {showResumen && (
          <div className="rounded-lg border p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Desde</Label>
                <Input type="date" value={resumenDesde} onChange={(e) => setResumenDesde(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Hasta</Label>
                <Input type="date" value={resumenHasta} onChange={(e) => setResumenHasta(e.target.value)} />
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!resumenDesde || !resumenHasta || resumenDesde > resumenHasta}
                onClick={() =>
                  window.open(
                    `/api/clientes/${cliente.id}/cuenta-corriente/resumen?desde=${resumenDesde}&hasta=${resumenHasta}`,
                    "_blank",
                    "noopener,noreferrer"
                  )
                }
              >
                Emitir resumen
              </Button>
            </div>
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : movimientos.length === 0 ? (
          <EmptyState icon={ArrowRightLeft} title="Sin movimientos" variant="default" />
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {movimientos.map((mov) => (
              <div key={mov.id} className="flex items-start justify-between p-3 bg-muted/50 rounded-lg">
                <div className="flex items-start gap-2">
                  {mov.monto >= 0 ? (
                    <ArrowDownCircle className="h-4 w-4 text-success-600 mt-0.5 shrink-0" />
                  ) : (
                    <ArrowUpCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  )}
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-medium text-sm", mov.monto >= 0 ? "text-success-600" : "text-destructive")}>
                        {mov.monto >= 0 ? "+" : ""}{formatPrice(Math.abs(mov.monto))}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {tipoLabels[mov.tipo] || mov.tipo}
                      </Badge>
                      {mov.revertidoAt && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          Revertido
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(mov.createdAt)}
                      {mov.metodoPago && ` · ${metodoPagoLabels[mov.metodoPago] || mov.metodoPago}`}
                    </div>
                    {mov.referenciaTipo && mov.referenciaTipo !== "MANUAL" && (
                      <div className="text-xs text-muted-foreground">
                        {mov.referenciaTipo === "VENTA" ? "Venta" : mov.referenciaTipo === "FACTURA" ? "Remito" : mov.referenciaTipo}
                      </div>
                    )}
                    {mov.observaciones && (
                      <div className="text-xs text-muted-foreground">{mov.observaciones}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    Saldo: {formatPrice(mov.saldoPosterior)}
                  </div>
                  {TIPOS_CON_RECIBO.includes(mov.tipo) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                      title="Emitir recibo"
                      aria-label={`Emitir recibo de ${tipoLabels[mov.tipo] || mov.tipo} por ${formatPrice(Math.abs(mov.monto))}`}
                      onClick={() =>
                        window.open(
                          `/api/clientes/${cliente.id}/cuenta-corriente/${mov.id}/recibo`,
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {esCargoReversible(mov) && esAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      title="Revertir cargo"
                      aria-label={`Revertir cargo por ${formatPrice(Math.abs(mov.monto))}`}
                      onClick={() => setRevertirTarget(mov)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {revertirTarget && (
        <RevertirCargoDialog
          clienteId={cliente.id}
          movimientos={[{ id: revertirTarget.id, monto: revertirTarget.monto }]}
          saldoActual={saldo}
          open={!!revertirTarget}
          onOpenChange={(v) => !v && setRevertirTarget(null)}
          onDone={() => mutate()}
        />
      )}
    </div>
  )
}
