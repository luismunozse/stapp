"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { SignaturePad } from "@/components/firma/signature-pad"
import { Textarea } from "@/components/ui/textarea"
import {
  FileText,
  CheckCircle2,
  XCircle,
  Loader2,
  PenTool,
  CalendarClock,
  Download,
  Search,
} from "lucide-react"
import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"

interface CotizacionItem {
  id: string
  descripcion: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  unidad?: string
  descuentoTipo?: string
  descuentoValor?: number
}

interface CotizacionData {
  id: string
  numeroCotizacion: string
  estado: string
  fechaVencimiento: string | null
  notas: string | null
  subtotal: number
  iva: number
  total: number
  createdAt: string
  publicToken: string
  firmaAprobacion: string | null
  firmaMime: string | null
  fechaAprobacion: string | null
  descuentoGlobalTipo?: string | null
  descuentoGlobalValor?: number | null
  ivaPorcentaje?: number | null
  terminos?: string | null
  items: CotizacionItem[]
}

interface CotizacionApprovalProps {
  token: string
  cotizacion: CotizacionData
  dispositivo: string
  moneda?: string
  zonaHoraria?: string
  diagnostico?: string
  onApproved?: () => void
}

export function CotizacionApproval({
  token,
  cotizacion,
  dispositivo,
  moneda = "ARS",
  zonaHoraria,
  diagnostico,
  onApproved,
}: CotizacionApprovalProps) {
  const [showApproval, setShowApproval] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  const [firmaMime, setFirmaMime] = useState<string | null>(null)
  const [rejectMotivo, setRejectMotivo] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [rejected, setRejected] = useState(false)

  const fmt = (v: number) => formatCurrencyValue(v, moneda as CurrencyCode)
  const formatDate = (d: string | null | undefined) => formatDateValue(d, zonaHoraria)

  const isExpired = cotizacion.fechaVencimiento && new Date(cotizacion.fechaVencimiento) < new Date()
  const hasGlobalDiscount = (cotizacion.descuentoGlobalValor || 0) > 0
  const hasIVA = (cotizacion.ivaPorcentaje || 0) > 0

  const itemsSubtotal = cotizacion.items.reduce((sum, i) => sum + i.subtotal, 0)
  const globalDiscountAmount = hasGlobalDiscount
    ? cotizacion.descuentoGlobalTipo === "porcentaje"
      ? itemsSubtotal * ((cotizacion.descuentoGlobalValor || 0) / 100)
      : (cotizacion.descuentoGlobalValor || 0)
    : 0

  const handleApprove = async () => {
    if (!firma || !firmaMime) {
      setError("La firma es requerida para aprobar")
      return
    }

    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/public/ordenes/${token}/approve-cotizacion`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cotizacionId: cotizacion.id,
          firmaAprobacion: firma,
          firmaMime: firmaMime,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al aprobar")
        return
      }

      setDone(true)
      setShowApproval(false)
      onApproved?.()
    } catch {
      setError("Error de conexion. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/public/ordenes/${token}/reject-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: rejectMotivo || undefined }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || "Error al rechazar")
        return
      }

      setRejected(true)
      setShowReject(false)
      onApproved?.()
    } catch {
      setError("Error de conexion. Intenta de nuevo.")
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <Card className="border-green-200 dark:border-green-800">
        <CardContent className="pt-6 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <p className="font-semibold text-lg">Presupuesto aprobado</p>
          <p className="text-sm text-muted-foreground mt-1">
            El taller ha sido notificado y comenzará la reparación.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (rejected) {
    return (
      <Card className="border-red-200 dark:border-red-800">
        <CardContent className="pt-6 text-center">
          <XCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className="font-semibold text-lg">Presupuesto rechazado</p>
          <p className="text-sm text-muted-foreground mt-1">
            El taller ha sido notificado. Pueden contactarte para ofrecer alternativas.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-amber-200 dark:border-amber-800">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5 text-amber-600" />
          Presupuesto detallado pendiente de aprobacion
        </CardTitle>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{cotizacion.numeroCotizacion}</span>
          <span>-</span>
          <span>{formatDate(cotizacion.createdAt)}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {diagnostico && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 p-3">
            <div className="flex items-start gap-2">
              <Search className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold text-blue-700 dark:text-blue-300 uppercase tracking-widest mb-1">
                  Diagnóstico del técnico
                </p>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{diagnostico}</p>
              </div>
            </div>
          </div>
        )}

        {/* Info del equipo */}
        <div className="bg-amber-50 dark:bg-amber-950/50 rounded-lg p-3">
          <p className="text-sm text-muted-foreground">Equipo</p>
          <p className="font-medium">{dispositivo}</p>
        </div>

        {/* Items table */}
        <div>
          {/* Header */}
          <div className="grid grid-cols-12 gap-1 text-[10px] font-medium text-muted-foreground pb-2 border-b uppercase tracking-wider">
            <div className="col-span-5">Descripcion</div>
            <div className="col-span-1 text-center">Cant.</div>
            <div className="col-span-2 text-right">P. Unit.</div>
            <div className="col-span-1 text-center">Dto.</div>
            <div className="col-span-3 text-right">Subtotal</div>
          </div>
          {/* Items */}
          {cotizacion.items.map((item) => {
            const bruto = item.cantidad * item.precioUnitario
            const hasDiscount = (item.descuentoValor || 0) > 0
            return (
              <div
                key={item.id}
                className="grid grid-cols-12 gap-1 text-sm py-2 border-b last:border-b-0"
              >
                <div className="col-span-5">
                  <div className="text-sm">{item.descripcion}</div>
                  {item.unidad && item.unidad !== "Unidad" && (
                    <div className="text-[10px] text-muted-foreground">{item.unidad}</div>
                  )}
                </div>
                <div className="col-span-1 text-center text-sm">{item.cantidad}</div>
                <div className="col-span-2 text-right text-sm">{fmt(item.precioUnitario)}</div>
                <div className="col-span-1 text-center text-[10px] text-muted-foreground">
                  {hasDiscount
                    ? item.descuentoTipo === "fijo"
                      ? `-${fmt(item.descuentoValor || 0)}`
                      : `-${item.descuentoValor}%`
                    : "-"}
                </div>
                <div className="col-span-3 text-right">
                  {hasDiscount && (
                    <span className="text-[10px] text-muted-foreground line-through mr-1">
                      {fmt(bruto)}
                    </span>
                  )}
                  <span className="font-medium text-sm">{fmt(item.subtotal)}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Totals */}
        <div className="border-t-2 pt-3 space-y-1">
          {(hasGlobalDiscount || hasIVA) && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Subtotal</span>
              <span>{fmt(cotizacion.subtotal + (cotizacion.iva || 0) + globalDiscountAmount)}</span>
            </div>
          )}
          {hasGlobalDiscount && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>
                Descuento{" "}
                {cotizacion.descuentoGlobalTipo === "porcentaje"
                  ? `(${cotizacion.descuentoGlobalValor}%)`
                  : ""}
              </span>
              <span className="text-red-500">-{fmt(globalDiscountAmount)}</span>
            </div>
          )}
          {hasIVA && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>IVA ({cotizacion.ivaPorcentaje}%)</span>
              <span>{fmt(cotizacion.iva)}</span>
            </div>
          )}
          <div className="flex justify-between text-xl font-bold pt-1 text-amber-700 dark:text-amber-300">
            <span>Total</span>
            <span>{fmt(cotizacion.total)}</span>
          </div>
        </div>

        {/* Notas */}
        {cotizacion.notas && (
          <div className="text-sm">
            <p className="text-muted-foreground text-xs font-medium mb-1">Notas</p>
            <p className="whitespace-pre-wrap">{cotizacion.notas}</p>
          </div>
        )}

        {/* Terminos */}
        {cotizacion.terminos && (
          <div className="text-sm">
            <p className="text-muted-foreground text-xs font-medium mb-1">Terminos y condiciones</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{cotizacion.terminos}</p>
          </div>
        )}

        {/* Vencimiento */}
        {cotizacion.fechaVencimiento && (
          <div className="text-xs text-muted-foreground">
            Valida hasta: {formatDate(cotizacion.fechaVencimiento)}
            {isExpired && <span className="text-red-500 font-medium ml-1">(Vencida)</span>}
          </div>
        )}

        {/* Expired warning */}
        {isExpired && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30">
            <CalendarClock className="h-5 w-5 text-amber-600 shrink-0" />
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Cotización vencida</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Contactá al servicio técnico para una nueva cotización.
              </p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          {cotizacion.publicToken && (
            <a
              href={`/api/public/cotizaciones/${cotizacion.publicToken}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Descargar PDF del presupuesto
              </Button>
            </a>
          )}

          {!isExpired && !showApproval && !showReject && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                onClick={() => setShowReject(true)}
              >
                <XCircle className="mr-2 h-4 w-4" />
                Rechazar
              </Button>
              <Button
                onClick={() => setShowApproval(true)}
                className="flex-1 bg-amber-600 hover:bg-amber-700"
              >
                <PenTool className="mr-2 h-4 w-4" />
                Aprobar presupuesto
              </Button>
            </div>
          )}
        </div>

        {/* Reject panel */}
        {showReject && (
          <div className="border border-red-200 rounded-lg p-4 space-y-3 bg-red-50/50 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              ¿Estas seguro de rechazar el presupuesto?
            </p>
            <p className="text-xs text-muted-foreground">
              El taller sera notificado y podra contactarte para ofrecer alternativas.
            </p>

            <Textarea
              placeholder="Motivo del rechazo (opcional)"
              value={rejectMotivo}
              onChange={(e) => setRejectMotivo(e.target.value)}
              disabled={loading}
              rows={2}
              maxLength={500}
              className="text-sm"
            />

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowReject(false)
                  setRejectMotivo("")
                  setError(null)
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={handleReject}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-4 w-4" />
                )}
                Confirmar rechazo
              </Button>
            </div>
          </div>
        )}

        {/* Signature panel */}
        {showApproval && (
          <div className="border rounded-lg p-4 space-y-3 bg-background">
            <p className="text-sm text-muted-foreground">
              Firma a continuacion para confirmar la aprobacion del presupuesto
              por <strong>{fmt(cotizacion.total)}</strong>.
            </p>

            <SignaturePad
              label="Firma de aprobacion"
              onSignatureChange={(sig, mime) => {
                setFirma(sig)
                setFirmaMime(mime)
                setError(null)
              }}
              disabled={loading}
            />

            {error && <p className="text-sm text-red-500">{error}</p>}

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowApproval(false)
                  setFirma(null)
                  setFirmaMime(null)
                  setError(null)
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={handleApprove}
                disabled={loading || !firma}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                )}
                Confirmar aprobacion
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
