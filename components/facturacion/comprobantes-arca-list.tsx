"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCurrency } from "@/contexts/currency-context"
import {
  etiquetaEstadoComprobante,
  fechaFiscalDMA,
  pdfComprobanteHref,
  tituloComprobante,
  type ComprobanteFiscalDTO,
  type ListadoComprobantesResponse,
} from "@/lib/facturacion/comprobante-ui"

const LIMITE = 20
// Radix Select no admite value "": el "sin filtro" viaja como este valor.
const TODOS = "todos"

const FILTROS_ESTADO = [
  { value: TODOS, label: "Todos los estados" },
  { value: "emitido", label: "Emitidas" },
  { value: "pendiente", label: "En proceso" },
  { value: "rechazado", label: "Rechazadas" },
  { value: "anulado", label: "Anuladas" },
] as const

function variantEstado(estado: string) {
  if (estado === "emitido") return "successSoft" as const
  if (estado === "rechazado") return "destructiveSoft" as const
  // Una factura anulada ya no esta vigente pero tampoco fallo: neutra.
  if (estado === "anulado") return "secondary" as const
  return "warningSoft" as const
}

function urlListado(page: number, estado: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(LIMITE) })
  if (estado !== TODOS) params.set("estado", estado)
  return `/api/facturacion-electronica/comprobantes?${params.toString()}`
}

export function ComprobantesArcaList() {
  const { formatPrice, formatDate } = useCurrency()
  const [estado, setEstado] = useState<string>(TODOS)
  const [page, setPage] = useState(1)
  const [datos, setDatos] = useState<ListadoComprobantesResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [fallo, setFallo] = useState(false)
  // Una respuesta lenta de un filtro viejo no debe pisar la del filtro actual.
  const pedidoActual = useRef(0)

  const cargar = useCallback(async () => {
    const pedido = ++pedidoActual.current
    setCargando(true)
    setFallo(false)
    try {
      const res = await fetch(urlListado(page, estado))
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as ListadoComprobantesResponse
      if (pedido !== pedidoActual.current) return
      setDatos(data)
    } catch {
      if (pedido !== pedidoActual.current) return
      setFallo(true)
    } finally {
      if (pedido === pedidoActual.current) setCargando(false)
    }
  }, [page, estado])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const cambiarEstado = (valor: string) => {
    setEstado(valor || TODOS)
    setPage(1)
  }

  const items = datos?.items ?? []
  const totalPages = datos?.totalPages ?? 0

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <Select value={estado} onValueChange={cambiarEstado}>
          <SelectTrigger className="w-full sm:w-auto sm:min-w-[200px]" aria-label="Filtrar por estado">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            {FILTROS_ESTADO.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {fallo ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
          <p className="text-destructive">No pudimos cargar las facturas. Probá de nuevo en un momento.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : cargando && !datos ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="rounded-lg border bg-card p-4 flex gap-4">
              <div className="h-4 bg-muted animate-pulse rounded w-24" />
              <div className="h-4 bg-muted animate-pulse rounded flex-1" />
              <div className="h-4 bg-muted animate-pulse rounded w-16" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {estado === TODOS ? "Todavía no hay facturas electrónicas" : "No hay facturas con ese estado"}
          </CardContent>
        </Card>
      ) : (
        <Card className={cargando ? "opacity-60 transition-opacity" : "transition-opacity"}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-background">
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 font-medium hidden md:table-cell">Fecha</th>
                  <th className="text-left p-3 font-medium">Comprobante</th>
                  <th className="text-left p-3 font-medium">Venta</th>
                  <th className="text-right p-3 font-medium">Total</th>
                  <th className="text-center p-3 font-medium">Estado</th>
                  <th className="text-left p-3 font-medium hidden lg:table-cell">CAE</th>
                  <th className="text-center p-3 font-medium">PDF</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <FilaComprobante key={c.id} c={c} formatPrice={formatPrice} formatDate={formatDate} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!fallo && totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1 || cargando} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {datos?.page ?? page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages || cargando}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function FilaComprobante({
  c,
  formatPrice,
  formatDate,
}: {
  c: ComprobanteFiscalDTO
  formatPrice: (n: number | string | null | undefined) => string
  formatDate: (d: Date | string | null | undefined) => string
}) {
  // Una factura anulada sigue siendo un comprobante emitido: conserva su PDF.
  const tienePdf = c.estado === "emitido" || c.estado === "anulado"
  return (
    <tr className="border-b hover:bg-muted/30 transition-colors">
      <td className="p-3 text-muted-foreground hidden md:table-cell">
        {c.fechaEmision ? fechaFiscalDMA(c.fechaEmision) : formatDate(c.createdAt)}
      </td>
      <td className="p-3">
        {c.numero ? (
          <div className="font-medium">{c.numero}</div>
        ) : (
          <div className="text-muted-foreground">Sin número</div>
        )}
        <div className="text-xs text-muted-foreground">{tituloComprobante(c.tipo, null, c.esNotaCredito)}</div>
        {c.estado === "rechazado" && c.errorMsg && (
          <div className="mt-1 text-xs text-destructive">{c.errorMsg}</div>
        )}
      </td>
      <td className="p-3">
        {c.ventaId && c.numeroVenta != null ? (
          <Link href={`/ventas/${c.ventaId}`} className="hover:underline">
            V{String(c.numeroVenta).padStart(4, "0")}
          </Link>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
      <td className="p-3 text-right font-medium">
        {c.total != null ? `${c.esNotaCredito ? "-" : ""}${formatPrice(c.total)}` : "-"}
      </td>
      <td className="p-3 text-center">
        <Badge variant={variantEstado(c.estado)}>{etiquetaEstadoComprobante(c.estado)}</Badge>
      </td>
      <td className="p-3 font-mono text-xs hidden lg:table-cell">{c.cae ?? "-"}</td>
      <td className="p-3 text-center">
        {tienePdf && c.pdfDisponible ? (
          <Button asChild variant="outline" size="sm">
            <a href={pdfComprobanteHref(c.id)} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1 h-4 w-4" />
              Ver PDF
            </a>
          </Button>
        ) : tienePdf ? (
          <span className="text-xs text-muted-foreground">PDF no disponible: datos incompletos</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </tr>
  )
}
