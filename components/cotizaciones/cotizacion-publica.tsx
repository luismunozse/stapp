"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/firma/signature-pad"
import { Textarea } from "@/components/ui/textarea"
import {
  FileText,
  Download,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  Loader2,
  AlertCircle,
  Phone,
  MapPin,
  Wrench,
  PenTool,
  CalendarClock,
  ClipboardCheck,
} from "lucide-react"
import { formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import { formatDateValue } from "@/lib/timezone"

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
  moneda?: string
  zonaHoraria?: string
  descuentoGlobalTipo?: string | null
  descuentoGlobalValor?: number | null
  ivaPorcentaje?: number | null
  terminos?: string | null
  tipo?: "ORDEN" | "PRESUPUESTO"
  equipo?: {
    dispositivo: string
    tipoDispositivo?: string | null
    marca?: string | null
    modelo?: string | null
    color?: string | null
    imei?: string | null
    numeroSerie?: string | null
    problemaReportado: string
  } | null
  checklist?: {
    items: Array<{ label: string; valor: string; categoria?: string | null }>
    notas?: string | null
  } | null
  condiciones?: {
    diagnostico: string | null
    plazoEstimadoDias: number | null
    anticipoTipo: string
    anticipoValor: number
    garantiaDias: number
    garantiaAlcance: string
    politicaAbandonoDias: number | null
  } | null
  orden: {
    numeroOrden: number
    dispositivo: string
    tipoDispositivo: string
    marca?: string
    problemaReportado: string
  } | null
  cliente: {
    nombre: string | null
    telefono: string | null
    email: string | null
  }
  sector?: {
    nombre: string
  } | null
  organizacion: {
    nombre: string | null
    telefono: string | null
    direccion: string | null
    logoUrl: string | null
  }
  items: {
    id: string
    descripcion: string
    cantidad: number
    precioUnitario: number
    subtotal: number
    unidad?: string
    descuentoTipo?: string
    descuentoValor?: number
    tipoRepuesto?: string
  }[]
}

const estadoConfig: Record<string, { label: string; color: string }> = {
  BORRADOR: { label: "Borrador", color: "bg-muted text-muted-foreground" },
  ENVIADA: { label: "Pendiente de aprobacion", color: "bg-info-50 text-info-700 dark:bg-info/15 dark:text-info-500" },
  ACEPTADA: { label: "Aprobada", color: "bg-success-50 text-success-700 dark:bg-success/15 dark:text-success-500" },
  RECHAZADA: { label: "Rechazada", color: "bg-destructive/10 text-destructive" },
}

export function CotizacionPublica({ token }: { token: string }) {
  const [data, setData] = useState<CotizacionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [showApproval, setShowApproval] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  const [firmaMime, setFirmaMime] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [rejectMotivo, setRejectMotivo] = useState("")
  const [rejecting, setRejecting] = useState(false)
  const [rejected, setRejected] = useState(false)

  const formatDate = (dateStr: string | null | undefined) =>
    formatDateValue(dateStr, data?.zonaHoraria)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/public/cotizaciones/${token}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then(setData)
      .catch(() => { if (!controller.signal.aborted) setError(true) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [token])

  const handleApprove = async () => {
    // Para PRESUPUESTO la firma es opcional; para ORDEN es obligatoria.
    const esPresupuesto = data?.tipo === "PRESUPUESTO"
    if (!esPresupuesto && (!firma || !firmaMime)) {
      setApproveError("La firma es requerida para aprobar")
      return
    }

    setApproving(true)
    setApproveError(null)

    try {
      const res = await fetch(`/api/public/cotizaciones/${token}/aprobar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaAprobacion: firma || null,
          firmaMime: firmaMime || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        setApproveError(err.error || "Error al aprobar")
        return
      }

      setApproved(true)
      setShowApproval(false)
      // Refresh data
      const refreshRes = await fetch(`/api/public/cotizaciones/${token}`)
      if (refreshRes.ok) {
        setData(await refreshRes.json())
      }
    } catch {
      setApproveError("Error al aprobar la cotizacion")
    } finally {
      setApproving(false)
    }
  }

  const handleReject = async () => {
    setRejecting(true)
    try {
      const res = await fetch(`/api/public/cotizaciones/${token}/rechazar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motivo: rejectMotivo || undefined }),
      })
      if (!res.ok) {
        const err = await res.json()
        setApproveError(err.error || "Error al rechazar")
        return
      }
      setRejected(true)
      setShowReject(false)
      const refreshRes = await fetch(`/api/public/cotizaciones/${token}`)
      if (refreshRes.ok) {
        setData(await refreshRes.json())
      }
    } catch {
      setApproveError("Error al rechazar la cotizacion")
    } finally {
      setRejecting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Cargando cotizacion...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="text-center py-12">
        <CardContent className="flex flex-col items-center gap-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold">Cotizacion no encontrada</h2>
            <p className="text-muted-foreground mt-1">
              El enlace no es valido o la cotizacion ya no existe.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const config = estadoConfig[data.estado] || estadoConfig.BORRADOR
  const isExpired = data.fechaVencimiento && new Date(data.fechaVencimiento) < new Date()
  const moneda = (data.moneda as CurrencyCode) || "ARS"
  const fmt = (v: number) => formatCurrencyValue(v, moneda)

  const hasGlobalDiscount = (data.descuentoGlobalValor || 0) > 0
  const hasIVA = (data.ivaPorcentaje || 0) > 0

  // Calculate global discount amount for display
  const itemsSubtotal = data.items.reduce((sum, i) => sum + i.subtotal, 0)
  const globalDiscountAmount = hasGlobalDiscount
    ? data.descuentoGlobalTipo === "porcentaje"
      ? itemsSubtotal * ((data.descuentoGlobalValor || 0) / 100)
      : (data.descuentoGlobalValor || 0)
    : 0

  return (
    <div className="space-y-6">
      {/* Header con branding */}
      <div className="text-center space-y-2">
        {data.organizacion.logoUrl ? (
          <Image
            src={data.organizacion.logoUrl}
            alt={data.organizacion.nombre || ""}
            width={192}
            height={48}
            className="h-12 w-auto mx-auto rounded-lg"
            unoptimized
          />
        ) : null}
        <h1 className="text-xl font-bold">
          {data.organizacion.nombre || "Servicio Tecnico"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.tipo === "PRESUPUESTO" ? "Presupuesto" : "Cotización de servicio"}
        </p>
      </div>

      {/* Success banner */}
      {approved && (
        <Card className="border-success/30 bg-success-50 dark:bg-success/15">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle className="h-6 w-6 text-success-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-success-700">Cotizacion aprobada</p>
              <p className="text-sm text-success-600">
                La firma fue registrada correctamente.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Identificacion */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {data.numeroCotizacion}
            </CardTitle>
            <Badge className={config.color}>{config.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground">Fecha</p>
              <p className="font-medium">{formatDate(data.createdAt)}</p>
            </div>
            {data.fechaVencimiento && (
              <div>
                <p className="text-muted-foreground">Valida hasta</p>
                <p className={`font-medium ${isExpired ? "text-destructive" : ""}`}>
                  {formatDate(data.fechaVencimiento)}
                  {isExpired && " (Vencida)"}
                </p>
              </div>
            )}
          </div>
          {data.cliente.nombre && (
            <div className="pt-2 border-t">
              <p className="text-muted-foreground">Cliente</p>
              <p className="font-medium">{data.cliente.nombre}</p>
              {data.sector?.nombre && (
                <p className="text-sm text-muted-foreground">Sector: {data.sector.nombre}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Equipo - solo si hay orden vinculada */}
      {data.orden && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Equipo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-muted-foreground">Dispositivo</p>
                <p className="font-medium">{data.orden.dispositivo}</p>
              </div>
              {data.orden.marca && (
                <div>
                  <p className="text-muted-foreground">Marca</p>
                  <p className="font-medium">{data.orden.marca}</p>
                </div>
              )}
            </div>
            <div className="pt-2 border-t">
              <p className="text-muted-foreground">Orden</p>
              <p className="font-medium">#{data.orden.numeroOrden}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Problema reportado</p>
              <p>{data.orden.problemaReportado}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Equipo - PRESUPUESTO (snapshot en la cotización) */}
      {data.tipo === "PRESUPUESTO" && data.equipo && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <Wrench className="h-5 w-5" />
              Equipo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-muted-foreground">Dispositivo</p>
                <p className="font-medium">{data.equipo.dispositivo}</p>
              </div>
              {data.equipo.marca && (
                <div>
                  <p className="text-muted-foreground">Marca</p>
                  <p className="font-medium">{data.equipo.marca}</p>
                </div>
              )}
              {data.equipo.modelo && (
                <div>
                  <p className="text-muted-foreground">Modelo</p>
                  <p className="font-medium">{data.equipo.modelo}</p>
                </div>
              )}
              {data.equipo.color && (
                <div>
                  <p className="text-muted-foreground">Color</p>
                  <p className="font-medium">{data.equipo.color}</p>
                </div>
              )}
              {data.equipo.imei && (
                <div>
                  <p className="text-muted-foreground">IMEI</p>
                  <p className="font-medium break-all">{data.equipo.imei}</p>
                </div>
              )}
              {data.equipo.numeroSerie && (
                <div>
                  <p className="text-muted-foreground">N° de serie</p>
                  <p className="font-medium break-all">{data.equipo.numeroSerie}</p>
                </div>
              )}
            </div>
            <div className="pt-2 border-t">
              <p className="text-muted-foreground">Problema reportado</p>
              <p className="whitespace-pre-wrap">{data.equipo.problemaReportado}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Checklist de recepción - PRESUPUESTO */}
      {data.tipo === "PRESUPUESTO" && data.checklist && data.checklist.items.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Checklist de recepción
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-4">
            {(() => {
              const catLabels: Record<string, string> = {
                CONDICION_FISICA: "Condición física",
                ACCESORIOS: "Accesorios",
                FUNCIONAL: "Estado funcional",
                GENERAL: "General",
              }
              const byCat: Record<string, Array<{ label: string; valor: string }>> = {}
              for (const it of data.checklist!.items) {
                const c = it.categoria || "GENERAL"
                if (!byCat[c]) byCat[c] = []
                byCat[c].push({ label: it.label, valor: it.valor })
              }
              return Object.entries(byCat).map(([cat, items]) => (
                <div key={cat}>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                    {catLabels[cat] || cat}
                  </p>
                  <ul className="space-y-1">
                    {items.map((it, idx) => (
                      <li key={idx} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{it.label}</span>
                        <span className="font-medium text-right">{it.valor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            })()}
            {data.checklist.notas && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-1">Observaciones</p>
                <p className="whitespace-pre-wrap">{data.checklist.notas}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Condiciones técnicas - PRESUPUESTO */}
      {data.tipo === "PRESUPUESTO" && data.condiciones && (() => {
        const c = data.condiciones
        const hasGarantia = c.garantiaAlcance && c.garantiaAlcance !== "NINGUNA" && c.garantiaDias > 0
        const hasAnticipo = c.anticipoValor && c.anticipoValor > 0
        const hasPlazo = c.plazoEstimadoDias && c.plazoEstimadoDias > 0
        const hasRetiro = c.politicaAbandonoDias && c.politicaAbandonoDias > 0
        const hasDiag = !!c.diagnostico
        if (!hasGarantia && !hasAnticipo && !hasPlazo && !hasRetiro && !hasDiag) return null
        const alcanceLabel = c.garantiaAlcance === "AMBOS"
          ? "Repuesto y mano de obra"
          : c.garantiaAlcance === "REPUESTO"
            ? "Solo repuesto"
            : c.garantiaAlcance === "MANO_OBRA"
              ? "Solo mano de obra"
              : ""
        const anticipoText = c.anticipoTipo === "fijo"
          ? formatCurrencyValue(c.anticipoValor, (data.moneda as any) || "ARS")
          : `${c.anticipoValor}% del total`
        return (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Wrench className="h-5 w-5" />
                Condiciones técnicas
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-3">
              {hasDiag && (
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Diagnóstico</p>
                  <p className="whitespace-pre-wrap">{c.diagnostico}</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t">
                {hasPlazo && (
                  <div>
                    <p className="text-muted-foreground text-xs">Plazo estimado</p>
                    <p className="font-medium">{c.plazoEstimadoDias} días hábiles</p>
                  </div>
                )}
                {hasAnticipo && (
                  <div>
                    <p className="text-muted-foreground text-xs">Anticipo requerido</p>
                    <p className="font-medium">{anticipoText}</p>
                  </div>
                )}
                {hasGarantia && (
                  <div>
                    <p className="text-muted-foreground text-xs">Garantía</p>
                    <p className="font-medium">{c.garantiaDias} días — {alcanceLabel}</p>
                  </div>
                )}
                {hasRetiro && (
                  <div>
                    <p className="text-muted-foreground text-xs">Plazo de retiro</p>
                    <p className="font-medium">{c.politicaAbandonoDias} días tras aviso de listo</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )
      })()}

      {/* Items / Detalle del presupuesto */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Detalle del presupuesto</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground pb-2 border-b">
              <div className="col-span-4">Descripcion</div>
              <div className="col-span-2 text-center">Cant.</div>
              <div className="col-span-2 text-right">P. Unit.</div>
              <div className="col-span-1 text-center">Dto.</div>
              <div className="col-span-3 text-right">Subtotal</div>
            </div>
            {/* Items */}
            {data.items.map((item) => {
              const bruto = item.cantidad * item.precioUnitario
              const hasDiscount = (item.descuentoValor || 0) > 0
              return (
                <div
                  key={item.id}
                  className="grid grid-cols-12 gap-2 text-sm py-2.5 border-b last:border-b-0"
                >
                  <div className="col-span-4">
                    <div>{item.descripcion}</div>
                    {item.tipoRepuesto && item.tipoRepuesto !== "NO_APLICA" && (
                      <div className="text-xs text-muted-foreground">
                        {item.tipoRepuesto === "ORIGINAL" ? "Repuesto original"
                          : item.tipoRepuesto === "ALTERNATIVO" ? "Repuesto alternativo"
                          : "Repuesto reciclado"}
                      </div>
                    )}
                    {item.unidad && item.unidad !== "Unidad" && (
                      <div className="text-xs text-muted-foreground">{item.unidad}</div>
                    )}
                  </div>
                  <div className="col-span-2 text-center">{item.cantidad}</div>
                  <div className="col-span-2 text-right">
                    {fmt(item.precioUnitario)}
                  </div>
                  <div className="col-span-1 text-center text-xs text-muted-foreground">
                    {hasDiscount
                      ? item.descuentoTipo === "fijo"
                        ? `-${fmt(item.descuentoValor || 0)}`
                        : `-${item.descuentoValor}%`
                      : "-"}
                  </div>
                  <div className="col-span-3 text-right font-medium">
                    {hasDiscount && (
                      <span className="text-xs text-muted-foreground line-through mr-1">
                        {fmt(bruto)}
                      </span>
                    )}
                    {fmt(item.subtotal)}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Totales desglosados */}
          <div className="mt-4 pt-4 border-t-2 space-y-1.5">
            {(hasGlobalDiscount || hasIVA) && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>Subtotal</span>
                <span>{fmt(data.subtotal + (data.iva || 0) + globalDiscountAmount)}</span>
              </div>
            )}
            {hasGlobalDiscount && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  Descuento{" "}
                  {data.descuentoGlobalTipo === "porcentaje"
                    ? `(${data.descuentoGlobalValor}%)`
                    : ""}
                </span>
                <span className="text-destructive">-{fmt(globalDiscountAmount)}</span>
              </div>
            )}
            {hasIVA && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>IVA ({data.ivaPorcentaje}%)</span>
                <span>{fmt(data.iva)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold pt-1">
              <span>Total</span>
              <span>{fmt(data.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notas */}
      {data.notas && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground mb-1">Notas</p>
            <p className="text-sm whitespace-pre-wrap">{data.notas}</p>
          </CardContent>
        </Card>
      )}

      {/* Terminos y Condiciones */}
      {data.terminos && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-1">Terminos y Condiciones</p>
            <p className="text-sm whitespace-pre-wrap">{data.terminos}</p>
          </CardContent>
        </Card>
      )}

      {/* Vencimiento warning */}
      {isExpired && data.estado === "ENVIADA" && (
        <Card className="border-warning/30 bg-warning-50 dark:bg-warning/15">
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarClock className="h-6 w-6 text-warning-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-warning-700">Cotizacion vencida</p>
              <p className="text-sm text-warning-600">
                Esta cotizacion vencio el {formatDate(data.fechaVencimiento)}.
                Contacte al servicio tecnico para una nueva cotizacion.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Estado aprobado (con o sin firma) */}
      {data.estado === "ACEPTADA" && (
        <Card className="border-success/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-success-700">
              <CheckCircle className="h-5 w-5" />
              {data.tipo === "PRESUPUESTO" ? "Presupuesto aprobado" : "Cotización aprobada"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.firmaAprobacion && data.firmaMime && (
              <div className="border rounded-lg p-3 bg-white">
                <Image
                  src={`data:${data.firmaMime};base64,${data.firmaAprobacion}`}
                  alt="Firma de aprobación"
                  width={200}
                  height={96}
                  className="max-h-24 w-auto mx-auto"
                  unoptimized
                />
              </div>
            )}
            {data.fechaAprobacion && (
              <p className="text-sm text-muted-foreground text-center">
                Aprobada el {formatDate(data.fechaAprobacion)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rechazada */}
      {data.estado === "RECHAZADA" && (
        <Card className="border-destructive/25 bg-destructive/10">
          <CardContent className="flex items-start gap-3 py-4">
            <XCircle className="h-6 w-6 text-destructive flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Cotizacion rechazada</p>
              {(data as any).motivoRechazo && (
                <p className="text-sm text-destructive mt-1">
                  Motivo: {(data as any).motivoRechazo}
                </p>
              )}
              <p className="text-sm text-destructive mt-1">
                Contacte al servicio tecnico si desea una nueva cotizacion.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Acciones */}
      <div className="flex flex-col gap-3">
        {/* Descargar PDF */}
        <a
          href={`/api/public/cotizaciones/${data.publicToken}/pdf`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full"
        >
          <Button variant="outline" className="w-full">
            <Download className="mr-2 h-4 w-4" />
            Descargar PDF
          </Button>
        </a>

        {/* Aprobar/Rechazar - solo si ENVIADA y no vencida */}
        {data.estado === "ENVIADA" && !isExpired && !showApproval && !showReject && (
          <>
            <Button
              className="w-full"
              onClick={() => setShowApproval(true)}
            >
              <PenTool className="mr-2 h-4 w-4" />
              Aprobar cotizacion
            </Button>
            <Button
              variant="outline"
              className="w-full text-destructive hover:text-destructive/80 border-destructive/25 hover:bg-destructive/10"
              onClick={() => setShowReject(true)}
            >
              <XCircle className="mr-2 h-4 w-4" />
              Rechazar cotizacion
            </Button>
          </>
        )}
      </div>

      {/* Panel de rechazo */}
      {showReject && (
        <Card className="border-destructive/25">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg text-destructive">Rechazar cotizacion</CardTitle>
            <p className="text-sm text-muted-foreground">
              Indique el motivo del rechazo (opcional).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Motivo del rechazo..."
              value={rejectMotivo}
              onChange={(e) => setRejectMotivo(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={rejecting}
            />
            {approveError && (
              <p className="text-sm text-destructive">{approveError}</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => { setShowReject(false); setApproveError(null) }}
                disabled={rejecting}
                className="flex-1"
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                onClick={handleReject}
                disabled={rejecting}
                className="flex-1"
              >
                {rejecting ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Rechazando...</>
                ) : (
                  <><XCircle className="mr-2 h-4 w-4" />Confirmar rechazo</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Panel de aprobacion con firma */}
      {showApproval && (
        <Card className="border-primary">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {data.tipo === "PRESUPUESTO" ? "Aprobar presupuesto" : "Aprobar cotización"}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {data.tipo === "PRESUPUESTO"
                ? `Confirme la aprobación del presupuesto por ${formatCurrencyValue(data.total, (data.moneda as CurrencyCode) || "ARS")}. La firma es opcional.`
                : `Firme a continuación para confirmar la aprobación del presupuesto por ${formatCurrencyValue(data.total, (data.moneda as CurrencyCode) || "ARS")}.`}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <SignaturePad
              label={data.tipo === "PRESUPUESTO" ? "Firma (opcional)" : "Firma de aprobación"}
              onSignatureChange={(sig, mime) => {
                setFirma(sig)
                setFirmaMime(mime)
                setApproveError(null)
              }}
              disabled={approving}
            />

            {approveError && (
              <p className="text-sm text-destructive">{approveError}</p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowApproval(false)
                  setFirma(null)
                  setFirmaMime(null)
                  setApproveError(null)
                }}
                disabled={approving}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1"
                onClick={handleApprove}
                disabled={approving || (data.tipo !== "PRESUPUESTO" && !firma)}
              >
                {approving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Aprobando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirmar aprobación
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contacto */}
      {(data.organizacion.telefono || data.organizacion.direccion) && (
        <Card>
          <CardContent className="pt-6 space-y-2 text-sm">
            <p className="font-medium text-muted-foreground">Contacto</p>
            {data.organizacion.telefono && (
              <a
                href={`tel:${data.organizacion.telefono}`}
                className="flex items-center gap-2 text-primary hover:underline"
              >
                <Phone className="h-4 w-4" />
                {data.organizacion.telefono}
              </a>
            )}
            {data.organizacion.direccion && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {data.organizacion.direccion}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground pb-4">
        Powered by STApp
      </p>
    </div>
  )
}
