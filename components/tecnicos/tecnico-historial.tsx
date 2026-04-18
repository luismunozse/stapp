"use client"

import { useEffect, useState } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Calendar,
  Hash,
} from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { cn } from "@/lib/utils"

interface Orden {
  id: string
  numeroOrden: number
  codigoOrden: string | null
  dispositivo: string
  estado: string
  fechaIngreso: string
  fechaCompletado: string | null
  fechaPrometida: string | null
  costoFinal: number | null
  cliente: string | null
}

interface Response {
  items: Orden[]
  page: number
  limit: number
  total: number
  totalPages: number
}

const estadoLabels: Record<string, string> = {
  RECIBIDO: "Recibido",
  EN_DIAGNOSTICO: "En Diagnóstico",
  PRESUPUESTADO: "Presupuestado",
  APROBADO: "Aprobado",
  EN_REPARACION: "En Reparación",
  ESPERANDO_REPUESTO: "Esperando Repuesto",
  REPARADO: "Reparado",
  ENTREGADO: "Entregado",
  ENTREGADO_SIN_REPARACION: "Entregado s/reparación",
  CANCELADO: "Cancelado",
  SIN_REPARACION: "Sin Reparación",
}

const estadoColors: Record<string, string> = {
  RECIBIDO: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  EN_DIAGNOSTICO: "bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  PRESUPUESTADO: "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  APROBADO: "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  EN_REPARACION: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  ESPERANDO_REPUESTO: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  REPARADO: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  ENTREGADO: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300",
  ENTREGADO_SIN_REPARACION: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  CANCELADO: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
  SIN_REPARACION: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300",
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

export function TecnicoHistorial({ tecnicoId }: { tecnicoId: string }) {
  const { formatPrice, formatDate } = useCurrency()
  const [page, setPage] = useState(1)
  const [estado, setEstado] = useState<string>("todas")
  const [q, setQ] = useState("")
  const qDebounced = useDebounced(q, 300)

  useEffect(() => {
    setPage(1)
  }, [estado, qDebounced])

  const qs = new URLSearchParams({
    page: String(page),
    limit: "10",
    estado,
  })
  if (qDebounced.trim()) qs.set("q", qDebounced.trim())

  const { data, isLoading } = useSWR<Response>(
    `/api/tecnicos/${tecnicoId}/ordenes?${qs.toString()}`,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true }
  )

  const items = data?.items || []
  const totalPages = data?.totalPages || 0
  const total = data?.total || 0

  return (
    <Card>
      <CardHeader className="p-4 sm:p-6 pb-3 sm:pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <CardTitle className="text-base sm:text-lg">Historial de Órdenes</CardTitle>
          <div className="text-xs text-muted-foreground">
            {isLoading ? "…" : `${total} orden(es)`}
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por dispositivo o código…"
              className="pl-8 h-9"
            />
          </div>
          <Select value={estado} onValueChange={setEstado}>
            <SelectTrigger className="h-9 w-full sm:w-[180px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos los estados</SelectItem>
              <SelectItem value="activas">Solo activas</SelectItem>
              <SelectItem value="completadas">Completadas</SelectItem>
              <SelectItem value="RECIBIDO">Recibido</SelectItem>
              <SelectItem value="EN_DIAGNOSTICO">En diagnóstico</SelectItem>
              <SelectItem value="PRESUPUESTADO">Presupuestado</SelectItem>
              <SelectItem value="APROBADO">Aprobado</SelectItem>
              <SelectItem value="EN_REPARACION">En reparación</SelectItem>
              <SelectItem value="ESPERANDO_REPUESTO">Esperando repuesto</SelectItem>
              <SelectItem value="REPARADO">Reparado</SelectItem>
              <SelectItem value="ENTREGADO">Entregado</SelectItem>
              <SelectItem value="CANCELADO">Cancelado</SelectItem>
              <SelectItem value="SIN_REPARACION">Sin reparación</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6 pt-0">
        {isLoading && !data ? (
          <div className="py-8 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Hash className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
            <p className="text-sm">No hay órdenes que coincidan.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((orden) => (
              <Link
                key={orden.id}
                href={`/ordenes/${orden.id}`}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors gap-2"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="font-medium text-sm text-primary shrink-0">
                    {orden.codigoOrden || `#${orden.numeroOrden}`}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-sm truncate">
                      {orden.dispositivo}
                    </div>
                    {orden.cliente && (
                      <div className="text-xs text-muted-foreground truncate">
                        {orden.cliente}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0">
                  {orden.costoFinal != null && (
                    <span className="text-xs font-medium tabular-nums">
                      {formatPrice(orden.costoFinal)}
                    </span>
                  )}
                  <span className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {formatDate(orden.fechaIngreso)}
                  </span>
                  <Badge
                    className={cn(
                      "text-[10px] sm:text-xs whitespace-nowrap",
                      estadoColors[orden.estado] || "bg-muted text-muted-foreground"
                    )}
                  >
                    {estadoLabels[orden.estado] || orden.estado}
                  </Badge>
                </div>
              </Link>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <span className="text-xs text-muted-foreground">
              Página {data?.page ?? page} de {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
              >
                <ChevronLeft className="h-4 w-4" />
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages || isLoading}
              >
                Siguiente
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
