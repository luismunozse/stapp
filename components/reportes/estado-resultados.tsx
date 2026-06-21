"use client"

import { useState, useCallback } from "react"
import useSWR from "swr"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Loader2,
  AlertTriangle,
  Info,
  Download,
  Receipt,
} from "lucide-react"
import { StatCard } from "@/components/dashboard/stat-card"
import type { StatChange } from "@/components/dashboard/stat-card"
import { useCurrency } from "@/contexts/currency-context"
import { EmptyState } from "@/components/ui/empty-state"
import { StatusBanner } from "@/components/ui/status-banner"
import { useModal } from "@/contexts/modal-context"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface EstadoResultadosData {
  periodo: { desde: string; hasta: string }
  ingresos: { ventas: number; servicios: number; serviciosAdelantos?: number; otros: number; total: number }
  costos: { productos: number; repuestos: number; merma?: number; mermaPorTipo?: Record<string, number>; total: number }
  gananciaBruta: number
  margenBruto: number
  costosFinancieros?: { ventas: number; servicios: number; total: number }
  comisiones?: { tecnicos: number; vendedores: number; total: number }
  gastos: {
    fijos: number
    variables: number
    total: number
    porCategoria: Array<{
      id: string
      nombre: string
      tipo: string
      color: string | null
      monto: number
      porcentaje: number
    }>
  }
  gananciaNeta: number
  margenNeto: number
  meta: {
    ventasCount: number
    ordenesCount: number
    itemsConCostoConocido: number
    itemsSinCostoConocido: number
    gastosNoComputables: number
  }
}

function defaultRange() {
  const now = new Date()
  const desde = new Date(now.getFullYear(), now.getMonth(), 1)
  const hasta = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return {
    desde: desde.toISOString().split("T")[0],
    hasta: hasta.toISOString().split("T")[0],
  }
}

/**
 * Calcula el rango anterior de la misma duración (para comparativa).
 * Ej: si actual es marzo (31 días), anterior es febrero (28 días) → 28 días previos.
 */
function previousRange(desde: string, hasta: string) {
  const d = new Date(desde + "T00:00:00")
  const h = new Date(hasta + "T00:00:00")
  const diffDays = Math.round((h.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const prevHasta = new Date(d)
  prevHasta.setDate(prevHasta.getDate() - 1)
  const prevDesde = new Date(prevHasta)
  prevDesde.setDate(prevDesde.getDate() - diffDays + 1)
  return {
    desde: prevDesde.toISOString().split("T")[0],
    hasta: prevHasta.toISOString().split("T")[0],
  }
}

export function EstadoResultados() {
  const { formatPrice } = useCurrency()
  const { showError } = useModal()
  const [{ desde, hasta }, setRango] = useState(defaultRange)
  const [exporting, setExporting] = useState(false)

  const { data, isLoading, error } = useSWR<EstadoResultadosData>(
    `/api/reportes/estado-resultados?desde=${desde}&hasta=${hasta}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const prev = previousRange(desde, hasta)
  const { data: dataPrev } = useSWR<EstadoResultadosData>(
    `/api/reportes/estado-resultados?desde=${prev.desde}&hasta=${prev.hasta}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const setMesActual = useCallback(() => setRango(defaultRange()), [])
  const setMesAnterior = useCallback(() => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const h = new Date(now.getFullYear(), now.getMonth(), 0)
    setRango({
      desde: d.toISOString().split("T")[0],
      hasta: h.toISOString().split("T")[0],
    })
  }, [])
  const setUltimos30 = useCallback(() => {
    const h = new Date()
    const d = new Date()
    d.setDate(d.getDate() - 30)
    setRango({
      desde: d.toISOString().split("T")[0],
      hasta: h.toISOString().split("T")[0],
    })
  }, [])

  const handleExportPDF = useCallback(async () => {
    if (!data) return
    setExporting(true)
    try {
      const { default: jsPDF } = await import("jspdf")
      const autoTable = (await import("jspdf-autotable")).default

      const doc = new jsPDF()
      const fmt = (n: number) =>
        new Intl.NumberFormat("es-AR", {
          style: "currency",
          currency: "ARS",
          minimumFractionDigits: 2,
        }).format(n)

      const fechaTexto = `${new Date(desde + "T00:00:00").toLocaleDateString("es-AR")} – ${new Date(
        hasta + "T00:00:00"
      ).toLocaleDateString("es-AR")}`

      // Encabezado
      doc.setFontSize(16)
      doc.text("Estado de Resultados", 14, 18)
      doc.setFontSize(10)
      doc.setTextColor(120)
      doc.text(`Período: ${fechaTexto}`, 14, 25)
      doc.setTextColor(0)

      // Tabla principal
      autoTable(doc, {
        startY: 32,
        head: [["Concepto", "Monto"]],
        body: [
          ["Ventas de productos", fmt(data.ingresos.ventas)],
          ["Servicios (órdenes)", fmt(data.ingresos.servicios)],
          ["Otros ingresos", fmt(data.ingresos.otros)],
          [{ content: "Total ingresos", styles: { fontStyle: "bold" } }, { content: fmt(data.ingresos.total), styles: { fontStyle: "bold" } }],
          ["Costo de productos vendidos", `-${fmt(data.costos.productos)}`],
          ["Costo de repuestos", `-${fmt(data.costos.repuestos)}`],
          ...((data.costos.merma ?? 0) > 0 ? [["Mermas / ajustes", `-${fmt(data.costos.merma!)}`]] : []),
          [{ content: "Total costos", styles: { fontStyle: "bold" } }, { content: `-${fmt(data.costos.total)}`, styles: { fontStyle: "bold" } }],
          [
            { content: "GANANCIA BRUTA", styles: { fontStyle: "bold", fillColor: [220, 252, 231] } },
            { content: `${fmt(data.gananciaBruta)}  (${data.margenBruto}%)`, styles: { fontStyle: "bold", fillColor: [220, 252, 231] } },
          ],
          ["Gastos fijos", `-${fmt(data.gastos.fijos)}`],
          ["Gastos variables", `-${fmt(data.gastos.variables)}`],
          [{ content: "Total gastos operativos", styles: { fontStyle: "bold" } }, { content: `-${fmt(data.gastos.total)}`, styles: { fontStyle: "bold" } }],
          ...(data.costosFinancieros && data.costosFinancieros.total > 0 ? [
            ["Costo terminales (cuotas)", `-${fmt(data.costosFinancieros.total)}`],
          ] : []),
          ...(data.comisiones && data.comisiones.total > 0 ? [
            ...(data.comisiones.tecnicos > 0 ? [["Comisión técnicos", `-${fmt(data.comisiones.tecnicos)}`]] : []),
            ...(data.comisiones.vendedores > 0 ? [["Comisión vendedores", `-${fmt(data.comisiones.vendedores)}`]] : []),
          ] : []),
          [
            {
              content: "GANANCIA NETA",
              styles: {
                fontStyle: "bold",
                fillColor: data.gananciaNeta >= 0 ? [187, 247, 208] : [254, 202, 202],
              },
            },
            {
              content: `${fmt(data.gananciaNeta)}  (${data.margenNeto}%)`,
              styles: {
                fontStyle: "bold",
                fillColor: data.gananciaNeta >= 0 ? [187, 247, 208] : [254, 202, 202],
              },
            },
          ],
        ],
        theme: "grid",
        headStyles: { fillColor: [51, 65, 85] },
        columnStyles: { 1: { halign: "right" } },
      })

      // Tabla de gastos por categoría
      if (data.gastos.porCategoria.length > 0) {
        autoTable(doc, {
          startY: (doc as any).lastAutoTable.finalY + 8,
          head: [["Categoría de gasto", "Monto", "% del total"]],
          body: data.gastos.porCategoria.map((c) => [
            c.nombre,
            fmt(c.monto),
            `${c.porcentaje}%`,
          ]),
          theme: "striped",
          headStyles: { fillColor: [51, 65, 85] },
          columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
        })
      }

      // Avisos
      if (data.meta.itemsSinCostoConocido > 0) {
        const y = (doc as any).lastAutoTable.finalY + 8
        doc.setFontSize(9)
        doc.setTextColor(180, 83, 9)
        doc.text(
          `* ${data.meta.itemsSinCostoConocido} items sin costo histórico (ventas previas a la migración 090).`,
          14,
          y
        )
      }

      doc.save(`estado-resultados-${desde}_${hasta}.pdf`)
    } catch (err) {
      console.error("Error exportando PDF:", err)
      await showError("Error al generar el PDF")
    } finally {
      setExporting(false)
    }
  }, [data, desde, hasta])

  return (
    <div className="space-y-4">
      {/* Selector de período */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground">Desde</label>
              <Input
                type="date"
                value={desde}
                onChange={(e) => setRango((r) => ({ ...r, desde: e.target.value }))}
                className="w-auto"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Hasta</label>
              <Input
                type="date"
                value={hasta}
                onChange={(e) => setRango((r) => ({ ...r, hasta: e.target.value }))}
                className="w-auto"
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={setMesActual}>
                Mes actual
              </Button>
              <Button variant="outline" size="sm" onClick={setMesAnterior}>
                Mes anterior
              </Button>
              <Button variant="outline" size="sm" onClick={setUltimos30}>
                Últimos 30 días
              </Button>
            </div>
            <div className="ml-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPDF}
                disabled={exporting || !data}
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                Exportar PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-center text-destructive">
            Error al cargar el estado de resultados
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          {/* Tarjetas resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={TrendingUp}
              title="Ingresos"
              value={formatPrice(data.ingresos.total)}
              tone="info"
              change={(() => {
                const prev = dataPrev?.ingresos.total
                if (prev === undefined || prev === 0) return prev === 0 && data.ingresos.total !== 0 ? null : undefined
                const pct = ((data.ingresos.total - prev) / Math.abs(prev)) * 100
                if (Math.abs(pct) < 0.1) return undefined
                return { pct: Math.round(pct * 10) / 10, direction: pct > 0 ? "up" : "down" } satisfies StatChange
              })()}
            />
            <StatCard
              icon={DollarSign}
              title="Ganancia bruta"
              value={formatPrice(data.gananciaBruta)}
              description={`Margen ${data.margenBruto}%`}
              tone="success"
              change={(() => {
                const prev = dataPrev?.gananciaBruta
                if (prev === undefined || prev === 0) return prev === 0 && data.gananciaBruta !== 0 ? null : undefined
                const pct = ((data.gananciaBruta - prev) / Math.abs(prev)) * 100
                if (Math.abs(pct) < 0.1) return undefined
                return { pct: Math.round(pct * 10) / 10, direction: pct > 0 ? "up" : "down" } satisfies StatChange
              })()}
            />
            <StatCard
              icon={TrendingDown}
              title="Gastos operativos"
              value={formatPrice(data.gastos.total)}
              tone="warning"
              change={(() => {
                const prev = dataPrev?.gastos.total
                if (prev === undefined || prev === 0) return prev === 0 && data.gastos.total !== 0 ? null : undefined
                const pct = ((data.gastos.total - prev) / Math.abs(prev)) * 100
                if (Math.abs(pct) < 0.1) return undefined
                // positiveIsGood=false: spending more is bad, so direction flips
                return { pct: Math.round(pct * 10) / 10, direction: pct > 0 ? "down" : "up" } satisfies StatChange
              })()}
            />
            <StatCard
              icon={Wallet}
              title="Ganancia neta"
              value={formatPrice(data.gananciaNeta)}
              description={`Margen ${data.margenNeto}%`}
              tone={data.gananciaNeta >= 0 ? "success" : "danger"}
              urgent
              change={(() => {
                const prev = dataPrev?.gananciaNeta
                if (prev === undefined || prev === 0) return prev === 0 && data.gananciaNeta !== 0 ? null : undefined
                const pct = ((data.gananciaNeta - prev) / Math.abs(prev)) * 100
                if (Math.abs(pct) < 0.1) return undefined
                return { pct: Math.round(pct * 10) / 10, direction: pct > 0 ? "up" : "down" } satisfies StatChange
              })()}
            />
          </div>

          {/* Desglose */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Estado de Resultados</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Ventas de productos" value={formatPrice(data.ingresos.ventas)} />
                <Row label="Servicios (órdenes)" value={formatPrice(data.ingresos.servicios)} />
                {(data.ingresos.serviciosAdelantos ?? 0) > 0 && (
                  <div className="text-xs text-muted-foreground pl-3 -mt-1">
                    Incluye {formatPrice(data.ingresos.serviciosAdelantos!)} de cobros adelantados (órdenes abiertas)
                  </div>
                )}
                <Row label="Otros ingresos" value={formatPrice(data.ingresos.otros)} />
                <Row label="Total ingresos" value={formatPrice(data.ingresos.total)} bold />
                <Divider />
                <Row label="Costo de productos vendidos" value={`-${formatPrice(data.costos.productos)}`} muted />
                <Row label="Costo de repuestos" value={`-${formatPrice(data.costos.repuestos)}`} muted />
                {(data.costos.merma ?? 0) > 0 && (
                  <Row label="Mermas / ajustes inventario" value={`-${formatPrice(data.costos.merma!)}`} muted />
                )}
                <Row label="Total costos" value={`-${formatPrice(data.costos.total)}`} bold muted />
                <Divider />
                <Row label="GANANCIA BRUTA" value={formatPrice(data.gananciaBruta)} bold highlight />
                <div className="text-xs text-muted-foreground pl-1">Margen bruto: {data.margenBruto}%</div>
                <Divider />
                <Row label="Gastos fijos" value={`-${formatPrice(data.gastos.fijos)}`} muted />
                <Row label="Gastos variables" value={`-${formatPrice(data.gastos.variables)}`} muted />
                <Row label="Total gastos" value={`-${formatPrice(data.gastos.total)}`} bold muted />
                {data.costosFinancieros && data.costosFinancieros.total > 0 && (
                  <>
                    <Divider />
                    <Row label="Costo terminales (ventas)" value={`-${formatPrice(data.costosFinancieros.ventas)}`} muted />
                    {data.costosFinancieros.servicios > 0 && (
                      <Row label="Costo terminales (servicios)" value={`-${formatPrice(data.costosFinancieros.servicios)}`} muted />
                    )}
                    <Row label="Total costos financieros" value={`-${formatPrice(data.costosFinancieros.total)}`} bold muted />
                  </>
                )}
                {data.comisiones && data.comisiones.total > 0 && (
                  <>
                    <Divider />
                    {data.comisiones.tecnicos > 0 && (
                      <Row label="Comisión técnicos" value={`-${formatPrice(data.comisiones.tecnicos)}`} muted />
                    )}
                    {data.comisiones.vendedores > 0 && (
                      <Row label="Comisión vendedores" value={`-${formatPrice(data.comisiones.vendedores)}`} muted />
                    )}
                    <Row label="Total comisiones" value={`-${formatPrice(data.comisiones.total)}`} bold muted />
                  </>
                )}
                <Divider />
                <Row
                  label="GANANCIA NETA"
                  value={formatPrice(data.gananciaNeta)}
                  bold
                  highlight
                  positive={data.gananciaNeta >= 0}
                />
                <div className="text-xs text-muted-foreground pl-1">Margen neto: {data.margenNeto}%</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Gastos por categoría</CardTitle>
              </CardHeader>
              <CardContent>
                {data.gastos.porCategoria.length === 0 ? (
                  <EmptyState
                    icon={Receipt}
                    title="Sin gastos"
                    description="No hay gastos registrados en este período"
                    variant="search"
                  />
                ) : (
                  <div className="space-y-3">
                    {data.gastos.porCategoria.map((c) => (
                      <div key={c.id} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            {c.color && (
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{ backgroundColor: c.color }}
                              />
                            )}
                            <span className="font-medium">{c.nombre}</span>
                            <span className="text-xs text-muted-foreground">
                              ({c.tipo === "FIJO" ? "fijo" : "variable"})
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="font-medium">{formatPrice(c.monto)}</div>
                            <div className="text-xs text-muted-foreground">{c.porcentaje}%</div>
                          </div>
                        </div>
                        <Progress value={c.porcentaje} className="h-1.5" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {(data.meta.itemsSinCostoConocido > 0 || data.meta.gastosNoComputables > 0) && (
            <div className="space-y-2">
              {data.meta.itemsSinCostoConocido > 0 && (
                <StatusBanner tone="warning" icon={AlertTriangle}>
                  Hay <strong>{data.meta.itemsSinCostoConocido}</strong> items vendidos sin costo
                  histórico registrado (ventas previas a la migración 090). Su costo no se incluyó
                  en el cálculo, por lo que la ganancia bruta puede estar sobreestimada.
                </StatusBanner>
              )}
              {data.meta.gastosNoComputables > 0 && (
                <StatusBanner tone="info" icon={Info}>
                  Se excluyeron {formatPrice(data.meta.gastosNoComputables)} en movimientos
                  marcados como "no afecta resultado" (retiros de socio, transferencias internas,
                  etc).
                </StatusBanner>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Row({
  label,
  value,
  bold,
  muted,
  highlight,
  positive,
}: {
  label: string
  value: string
  bold?: boolean
  muted?: boolean
  highlight?: boolean
  positive?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 ${
        bold ? "font-semibold" : ""
      } ${highlight ? "text-base" : ""}`}
    >
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span
        className={
          highlight
            ? positive === false
              ? "text-destructive"
              : "text-success-700"
            : muted
            ? "text-muted-foreground"
            : ""
        }
      >
        {value}
      </span>
    </div>
  )
}

function Divider() {
  return <div className="border-t my-1" />
}
