"use client"

import { useState, useEffect } from "react"
import { formatDateValue } from "@/lib/timezone"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Smartphone,
  Monitor,
  Tablet,
  Gamepad2,
  Watch,
  Clock,
  CheckCircle2,
  Circle,
  Phone,
  MapPin,
  Wrench,
  FileText,
  Loader2,
  AlertCircle,
  XCircle,
} from "lucide-react"

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En diagnostico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En reparacion",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin reparacion",
}

const estadoFlow = [
  "RECIBIDO",
  "EN_DIAGNOSTICO",
  "PRESUPUESTADO",
  "APROBADO",
  "EN_REPARACION",
  "REPARADO",
  "ENTREGADO",
]

const tipoDispositivoIcons: Record<string, typeof Smartphone> = {
  CELULAR: Smartphone,
  COMPUTADORA: Monitor,
  TABLET: Tablet,
  CONSOLA: Gamepad2,
  SMARTWATCH: Watch,
}

const tipoDispositivoLabels: Record<string, string> = {
  CELULAR: "Celular",
  COMPUTADORA: "Computadora",
  TABLET: "Tablet",
  CONSOLA: "Consola",
  SMARTWATCH: "Smartwatch",
}

interface TrackingData {
  numeroOrden: number
  codigoOrden?: string
  dispositivo: string
  tipoDispositivo: string
  marca?: string
  color?: string
  estado: string
  problemaReportado: string
  accesorios?: string
  fechaIngreso: string
  fechaPrometida?: string
  fechaCompletado?: string
  fechaEntrega?: string
  publicToken?: string
  zonaHoraria?: string
  cliente: { nombre: string }
  organizacion: {
    nombre: string
    telefono?: string
    direccion?: string
    logoUrl?: string
  }
}

export function SeguimientoContent({ token }: { token: string }) {
  const [data, setData] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const formatDate = (dateStr: string | null | undefined) =>
    formatDateValue(dateStr, data?.zonaHoraria)

  useEffect(() => {
    fetch(`/api/public/ordenes/${token}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found")
        return res.json()
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <p className="text-muted-foreground">Cargando orden...</p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card className="text-center py-12">
        <CardContent className="flex flex-col items-center gap-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold">Orden no encontrada</h2>
            <p className="text-muted-foreground mt-1">
              El enlace de seguimiento no es valido o la orden ya no existe.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const DeviceIcon = tipoDispositivoIcons[data.tipoDispositivo] || Smartphone
  const isTerminal = data.estado === "CANCELADO" || data.estado === "SIN_REPARACION"
  const isCompleted = data.estado === "ENTREGADO"
  const currentIndex = estadoFlow.indexOf(data.estado)

  return (
    <div className="space-y-6">
      {/* Header con branding */}
      <div className="text-center space-y-2">
        {data.organizacion.logoUrl ? (
          <img
            src={data.organizacion.logoUrl}
            alt={data.organizacion.nombre}
            className="h-12 mx-auto rounded-lg"
          />
        ) : null}
        <h1 className="text-xl font-bold">
          {data.organizacion.nombre || "Servicio Tecnico"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Seguimiento de orden de servicio
        </p>
      </div>

      {/* Identificacion de la orden */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Orden {data.codigoOrden || `#${data.numeroOrden}`}
            </CardTitle>
            <Badge
              variant={
                isTerminal
                  ? "destructive"
                  : isCompleted
                    ? "default"
                    : "secondary"
              }
              className="text-sm"
            >
              {estadoLabels[data.estado] || data.estado}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <DeviceIcon className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{data.dispositivo}</span>
            {data.marca && (
              <span className="text-muted-foreground">- {data.marca}</span>
            )}
          </div>
          {data.cliente?.nombre && (
            <p className="text-muted-foreground">
              Cliente: {data.cliente.nombre}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Timeline de estados */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Estado de la orden</CardTitle>
        </CardHeader>
        <CardContent>
          {isTerminal ? (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10">
              <XCircle className="h-8 w-8 text-destructive flex-shrink-0" />
              <div>
                <p className="font-medium text-destructive">
                  {estadoLabels[data.estado]}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data.estado === "CANCELADO"
                    ? "La orden fue cancelada."
                    : "El equipo no pudo ser reparado."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-0">
              {estadoFlow.map((estado, index) => {
                const isPast = index < currentIndex
                const isCurrent = index === currentIndex
                const isFuture = index > currentIndex

                return (
                  <div key={estado} className="flex gap-3">
                    {/* Linea vertical + circulo */}
                    <div className="flex flex-col items-center">
                      {isPast ? (
                        <CheckCircle2 className="h-6 w-6 text-green-500 flex-shrink-0" />
                      ) : isCurrent ? (
                        <div className="h-6 w-6 rounded-full border-[3px] border-primary bg-primary/20 flex-shrink-0 animate-pulse" />
                      ) : (
                        <Circle className="h-6 w-6 text-muted-foreground/30 flex-shrink-0" />
                      )}
                      {index < estadoFlow.length - 1 && (
                        <div
                          className={`w-0.5 h-8 ${
                            isPast
                              ? "bg-green-500"
                              : "bg-muted-foreground/20"
                          }`}
                        />
                      )}
                    </div>
                    {/* Label */}
                    <div className="pb-8">
                      <p
                        className={`text-sm font-medium ${
                          isPast
                            ? "text-green-600 dark:text-green-400"
                            : isCurrent
                              ? "text-primary font-semibold"
                              : "text-muted-foreground/50"
                        }`}
                      >
                        {estadoLabels[estado]}
                      </p>
                      {isCurrent && (
                        <p className="text-xs text-primary mt-0.5">
                          Estado actual
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Fechas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Fechas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Ingreso</p>
              <p className="font-medium">{formatDate(data.fechaIngreso)}</p>
            </div>
            {data.fechaPrometida && (
              <div>
                <p className="text-muted-foreground">Fecha estimada</p>
                <p className="font-medium">{formatDate(data.fechaPrometida)}</p>
              </div>
            )}
            {data.fechaCompletado && (
              <div>
                <p className="text-muted-foreground">Completado</p>
                <p className="font-medium">{formatDate(data.fechaCompletado)}</p>
              </div>
            )}
            {data.fechaEntrega && (
              <div>
                <p className="text-muted-foreground">Entregado</p>
                <p className="font-medium">{formatDate(data.fechaEntrega)}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Detalle del equipo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Detalle del equipo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-muted-foreground">Dispositivo</p>
              <p className="font-medium">{data.dispositivo}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tipo</p>
              <p className="font-medium">
                {tipoDispositivoLabels[data.tipoDispositivo] || data.tipoDispositivo}
              </p>
            </div>
            {data.marca && (
              <div>
                <p className="text-muted-foreground">Marca</p>
                <p className="font-medium">{data.marca}</p>
              </div>
            )}
            {data.color && (
              <div>
                <p className="text-muted-foreground">Color</p>
                <p className="font-medium">{data.color}</p>
              </div>
            )}
          </div>

          <div className="pt-3 border-t">
            <p className="text-muted-foreground mb-1">Problema reportado</p>
            <p>{data.problemaReportado}</p>
          </div>

          {data.accesorios && (
            <div className="pt-3 border-t">
              <p className="text-muted-foreground mb-1">Accesorios recibidos</p>
              <p>{data.accesorios}</p>
            </div>
          )}
        </CardContent>
      </Card>

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

      {/* PDF link */}
      {data.publicToken && (
        <div className="text-center">
          <a
            href={`/api/public/ordenes/${data.publicToken}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <FileText className="h-4 w-4" />
            Descargar comprobante PDF
          </a>
        </div>
      )}

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground pb-4">
        Powered by STApp
      </p>
    </div>
  )
}
