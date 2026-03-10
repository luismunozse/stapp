"use client"

import { useState, useEffect } from "react"
import Image from "next/image"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SignaturePad } from "@/components/firma/signature-pad"
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
  }[]
}

const estadoConfig: Record<string, { label: string; color: string }> = {
  BORRADOR: { label: "Borrador", color: "bg-gray-100 text-gray-800" },
  ENVIADA: { label: "Pendiente de aprobacion", color: "bg-blue-100 text-blue-800" },
  ACEPTADA: { label: "Aprobada", color: "bg-green-100 text-green-800" },
  RECHAZADA: { label: "Rechazada", color: "bg-red-100 text-red-800" },
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
    if (!firma || !firmaMime) {
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
          firmaAprobacion: firma,
          firmaMime: firmaMime,
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
          Presupuesto de servicio
        </p>
      </div>

      {/* Success banner */}
      {approved && (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-green-800">Cotizacion aprobada</p>
              <p className="text-sm text-green-600">
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
                <p className={`font-medium ${isExpired ? "text-red-500" : ""}`}>
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
                <span className="text-red-500">-{fmt(globalDiscountAmount)}</span>
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
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-4">
            <CalendarClock className="h-6 w-6 text-amber-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-amber-800">Cotizacion vencida</p>
              <p className="text-sm text-amber-600">
                Esta cotizacion vencio el {formatDate(data.fechaVencimiento)}.
                Contacte al servicio tecnico para una nueva cotizacion.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Firma de aprobacion existente */}
      {data.estado === "ACEPTADA" && data.firmaAprobacion && data.firmaMime && (
        <Card className="border-green-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2 text-green-700">
              <CheckCircle className="h-5 w-5" />
              Cotizacion aprobada
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="border rounded-lg p-3 bg-white">
              <Image
                src={`data:${data.firmaMime};base64,${data.firmaAprobacion}`}
                alt="Firma de aprobacion"
                width={200}
                height={96}
                className="max-h-24 w-auto mx-auto"
                unoptimized
              />
            </div>
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
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-center gap-3 py-4">
            <XCircle className="h-6 w-6 text-red-600 flex-shrink-0" />
            <div>
              <p className="font-medium text-red-800">Cotizacion rechazada</p>
              <p className="text-sm text-red-600">
                Esta cotizacion fue rechazada. Contacte al servicio tecnico si desea una nueva.
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

        {/* Aprobar - solo si ENVIADA y no vencida */}
        {data.estado === "ENVIADA" && !isExpired && !showApproval && (
          <Button
            className="w-full"
            onClick={() => setShowApproval(true)}
          >
            <PenTool className="mr-2 h-4 w-4" />
            Aprobar cotizacion
          </Button>
        )}
      </div>

      {/* Panel de aprobacion con firma */}
      {showApproval && (
        <Card className="border-primary">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Aprobar cotizacion</CardTitle>
            <p className="text-sm text-muted-foreground">
              Firme a continuacion para confirmar la aprobacion del presupuesto
              por {formatCurrencyValue(data.total, (data.moneda as CurrencyCode) || "ARS")}.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <SignaturePad
              label="Firma de aprobacion"
              onSignatureChange={(sig, mime) => {
                setFirma(sig)
                setFirmaMime(mime)
                setApproveError(null)
              }}
              disabled={approving}
            />

            {approveError && (
              <p className="text-sm text-red-500">{approveError}</p>
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
                disabled={approving || !firma}
              >
                {approving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Aprobando...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirmar aprobacion
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
