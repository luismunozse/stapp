"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import { DollarSign, TrendingUp, FileText, Package } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

export function ReportesView() {
  const { formatPrice, formatDate } = useCurrency()
  const [ingresos, setIngresos] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")

  useEffect(() => {
    fetchIngresos()
  }, [])

  const fetchIngresos = async () => {
    try {
      const params = new URLSearchParams()
      if (desde) params.append("desde", desde)
      if (hasta) params.append("hasta", hasta)

      const res = await fetch(`/api/reportes/ingresos?${params.toString()}`)
      const data = await res.json()
      setIngresos(data)
    } catch (error) {
      console.error("Error fetching ingresos:", error)
    } finally {
      setLoading(false)
    }
  }

  // Agrupar por fecha para el gráfico
  const ingresosPorFecha =
    ingresos?.facturas?.reduce((acc: any, factura: any) => {
      const fecha = formatDate(factura.fecha)
      if (!acc[fecha]) {
        acc[fecha] = 0
      }
      acc[fecha] += factura.total
      return acc
    }, {}) || {}

  const chartData = Object.entries(ingresosPorFecha).map(([fecha, total]) => ({
    fecha,
    total: Number(total),
  }))

  if (loading) {
    return <div className="text-center py-8">Cargando...</div>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DatePicker
              id="desde"
              label="Desde"
              value={desde}
              onChange={setDesde}
            />
            <DatePicker
              id="hasta"
              label="Hasta"
              value={hasta}
              onChange={setHasta}
            />
            <div className="flex items-end">
              <Button onClick={fetchIngresos} className="w-full">
                Aplicar Filtros
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Ingresos</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {ingresos?.resumen?.total
                ? formatPrice(ingresos.resumen.total)
                : "$0"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cantidad Facturas</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {ingresos?.resumen?.cantidad || 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Promedio por Factura</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {ingresos?.resumen?.cantidad
                ? formatPrice(
                    ingresos.resumen.total / ingresos.resumen.cantidad
                  )
                : "$0"}
            </div>
          </CardContent>
        </Card>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ingresos por Fecha</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="fecha" />
                <YAxis />
                <Tooltip formatter={(value: number) => formatPrice(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="#8884d8"
                  name="Ingresos"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

