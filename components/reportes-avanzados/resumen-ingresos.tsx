"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DollarSign, Wrench, ShoppingBag, Smartphone } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { StatCard } from "@/components/dashboard/stat-card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts"

interface ResumenData {
  resumen: {
    totalIngresos: number
    totalServicios: number
    totalVentas: number
    cantidadServicios: number
    cantidadVentas: number
  }
  porMes: {
    mes: string
    mesCompleto: string
    servicios: number
    ventas: number
    total: number
  }[]
  porMetodoPago: {
    mesKey: string
    mes: string
    mesCompleto: string
    total: number
    metodos: { metodo: string; monto: number }[]
  }[]
  porDispositivo: {
    tipo: string
    total: number
    cantidad: number
  }[]
  periodo: {
    desde: string
    hasta: string
    meses: number
  }
}

const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"]

const METODO_PAGO_LABELS: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  TARJETA: "Tarjeta",
  TARJETA_DEBITO: "T. Débito",
  TARJETA_CREDITO: "T. Crédito",
  MERCADOPAGO: "MercadoPago",
  CUENTA_CORRIENTE: "Cuenta corriente",
  SIN_ESPECIFICAR: "Sin especificar",
  OTRO: "Otro",
}

const metodoLabel = (m: string) => METODO_PAGO_LABELS[m] || m

export function ResumenIngresos() {
  const { formatPrice } = useCurrency()
  const [data, setData] = useState<ResumenData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mesSeleccionado, setMesSeleccionado] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    try {
      setLoading(true)
      const response = await fetch("/api/reportes/resumen-ingresos?meses=6")
      if (!response.ok) throw new Error("Error al cargar datos")
      const result = await response.json()
      setData(result)
      // Default: mes más reciente con ingresos, o el último del período
      const meses = (result.porMetodoPago || []) as ResumenData["porMetodoPago"]
      const conIngresos = [...meses].reverse().find((m) => m.total > 0)
      setMesSeleccionado((conIngresos || meses[meses.length - 1])?.mesKey ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={`skeleton-${i}`}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-3 w-20" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="py-8">
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {error || "No hay datos disponibles"}
        </CardContent>
      </Card>
    )
  }

  const porcentajeServicios = data.resumen.totalIngresos > 0
    ? Math.round((data.resumen.totalServicios / data.resumen.totalIngresos) * 100)
    : 0

  const fuenteData = [
    { name: "Reparaciones", value: data.resumen.totalServicios },
    { name: "Ventas", value: data.resumen.totalVentas },
  ].filter(d => d.value > 0)

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          title="Total Ingresos"
          value={formatPrice(data.resumen.totalIngresos)}
          description={`Últimos ${data.periodo.meses} meses`}
          icon={DollarSign}
          tone="default"
        />
        <StatCard
          title="Reparaciones"
          value={formatPrice(data.resumen.totalServicios)}
          description={`${data.resumen.cantidadServicios} facturas · ${porcentajeServicios}%`}
          icon={Wrench}
          tone="info"
        />
        <StatCard
          title="Ventas"
          value={formatPrice(data.resumen.totalVentas)}
          description={`${data.resumen.cantidadVentas} ventas · ${100 - porcentajeServicios}%`}
          icon={ShoppingBag}
          tone="success"
        />
        <StatCard
          title="Dispositivos"
          value={String(data.porDispositivo.length)}
          description="Tipos atendidos"
          icon={Smartphone}
          tone="default"
        />
      </div>

      {/* Monthly Chart - Stacked by source */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base sm:text-lg">Ingresos por Mes</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            Desglose por reparaciones y ventas de productos
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="h-[250px] sm:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.porMes}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="mes" fontSize={12} />
                <YAxis
                  fontSize={12}
                  tickFormatter={(value) =>
                    value >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`
                  }
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatPrice(value),
                    name === "servicios" ? "Reparaciones" : "Ventas",
                  ]}
                  labelFormatter={(label: any, payload: any) => {
                    const item = payload?.[0]?.payload
                    return item?.mesCompleto || label
                  }}
                />
                <Legend
                  formatter={(value) => (value === "servicios" ? "Reparaciones" : "Ventas")}
                  wrapperStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="servicios" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="ventas" stackId="a" fill="#22c55e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Desglose por método de pago (filtrable por mes) */}
      {data.porMetodoPago.length > 0 && (() => {
        const mesData =
          data.porMetodoPago.find((m) => m.mesKey === mesSeleccionado) ??
          data.porMetodoPago[data.porMetodoPago.length - 1]
        const metodosPie = mesData.metodos.filter((m) => m.monto > 0)
        return (
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base sm:text-lg">Ingresos por Método de Pago</CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Cómo cobraste en el mes seleccionado
                </CardDescription>
              </div>
              <Select
                value={mesSeleccionado ?? mesData.mesKey}
                onValueChange={setMesSeleccionado}
              >
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Elegí un mes" />
                </SelectTrigger>
                <SelectContent>
                  {[...data.porMetodoPago].reverse().map((m) => (
                    <SelectItem key={m.mesKey} value={m.mesKey}>
                      <span className="capitalize">{m.mesCompleto}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {mesData.total === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Sin ingresos registrados en este mes
                </p>
              ) : (
                <div className="grid gap-6 lg:grid-cols-2">
                  {/* Tabla con montos y % */}
                  <div className="overflow-hidden rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-2 font-medium">Método</th>
                          <th className="px-3 py-2 text-right font-medium">Monto</th>
                          <th className="px-3 py-2 text-right font-medium">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mesData.metodos.map((m, i) => (
                          <tr key={m.metodo} className="border-b last:border-0">
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-2">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: COLORS[i % COLORS.length] }}
                                />
                                {metodoLabel(m.metodo)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatPrice(m.monto)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                              {Math.round((m.monto / mesData.total) * 100)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/50 font-semibold">
                          <td className="px-3 py-2">Total</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatPrice(mesData.total)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                            100%
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {/* Pie por método */}
                  {metodosPie.length > 0 && (
                    <div className="h-[220px] sm:h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={metodosPie}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            outerRadius={80}
                            dataKey="monto"
                            nameKey="metodo"
                            label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                            fontSize={11}
                          >
                            {metodosPie.map((m, i) => (
                              <Cell key={m.metodo} fill={COLORS[i % COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(value: number, name: string) => [
                              formatPrice(value),
                              metodoLabel(name),
                            ]}
                          />
                          <Legend
                            formatter={(value) => metodoLabel(String(value))}
                            wrapperStyle={{ fontSize: 12 }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Pie Chart: Source breakdown */}
        {fuenteData.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Por Fuente de Ingreso</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Reparaciones vs Ventas de productos
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[220px] sm:h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fuenteData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      fontSize={11}
                    >
                      <Cell fill="#3b82f6" />
                      <Cell fill="#22c55e" />
                    </Pie>
                    <Tooltip formatter={(value: number) => formatPrice(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bar Chart: By device type */}
        {data.porDispositivo.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base sm:text-lg">Por Tipo de Dispositivo</CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Ingresos por reparación según tipo de equipo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[220px] sm:h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.porDispositivo} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      fontSize={12}
                      tickFormatter={(value) =>
                        value >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`
                      }
                    />
                    <YAxis dataKey="tipo" type="category" width={90} fontSize={11} />
                    <Tooltip
                      formatter={(value: number) => formatPrice(value)}
                      labelFormatter={(label) => `${label}`}
                    />
                    <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                      {data.porDispositivo.map((entry, index) => (
                        <Cell key={`cell-${entry.tipo}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
