"use client"

import { useState, useCallback } from "react"
import useSWR from "swr"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrency } from "@/contexts/currency-context"
import { Receipt, Landmark, Settings, Repeat, TrendingDown } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface EstadoResultadosData {
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
  meta: {
    gastosNoComputables: number
    movEgresosCount?: number
    movEgresosSinCategoria?: number
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

export function GastosResumen() {
  const { formatPrice } = useCurrency()
  const [{ desde, hasta }, setRango] = useState(defaultRange)

  const { data, isLoading, error } = useSWR<EstadoResultadosData>(
    `/api/reportes/estado-resultados?desde=${desde}&hasta=${hasta}`,
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

  return (
    <div className="space-y-4">
      {/* Período */}
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
          </div>
        </CardContent>
      </Card>

      {/* Acciones rápidas */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Link href="/caja">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-600">
                <Landmark className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">Registrar gasto</div>
                <div className="text-xs text-muted-foreground">Ir a Caja → Movimientos</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/configuracion/gastos-recurrentes">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-purple-600">
                <Repeat className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">Gastos recurrentes</div>
                <div className="text-xs text-muted-foreground">Sueldos, alquiler, etc.</div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/configuracion/categorias-gasto">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-6 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-slate-100 dark:bg-slate-900/30 text-slate-600 dark:text-slate-300">
                <Settings className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">Categorías</div>
                <div className="text-xs text-muted-foreground">Configurar clasificación</div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {isLoading && (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-[300px] w-full" />
          </CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="py-6 text-center text-destructive">
            Error al cargar los gastos
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          {/* Resumen */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">Total gastos</p>
                    <p className="text-2xl font-bold text-red-600">
                      {formatPrice(data.gastos.total)}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-600">
                    <TrendingDown className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">Gastos fijos</p>
                <p className="text-2xl font-bold text-orange-600">
                  {formatPrice(data.gastos.fijos)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Alquiler, sueldos, servicios, etc.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs text-muted-foreground">Gastos variables</p>
                <p className="text-2xl font-bold text-amber-600">
                  {formatPrice(data.gastos.variables)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Insumos, mantenimiento, otros.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Desglose por categoría */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Gastos por categoría</CardTitle>
              <CardDescription className="text-xs">
                Distribución del gasto operativo en el período
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.gastos.porCategoria.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-10 flex flex-col items-center gap-2">
                  <Receipt className="h-8 w-8 opacity-40" />
                  <div>No hay gastos registrados en este período</div>
                  <Link href="/caja">
                    <Button variant="outline" size="sm" className="mt-2">
                      Registrar un gasto
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {data.gastos.porCategoria.map((c) => (
                    <div key={c.id} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          {c.color && (
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: c.color }}
                            />
                          )}
                          <span className="font-medium">{c.nombre}</span>
                          <span className="text-xs text-muted-foreground">
                            ({c.tipo === "FIJO" ? "fijo" : "variable"})
                          </span>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatPrice(c.monto)}</div>
                          <div className="text-xs text-muted-foreground">{c.porcentaje}%</div>
                        </div>
                      </div>
                      <Progress value={c.porcentaje} className="h-2" />
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {data.meta.gastosNoComputables > 0 && (
            <div className="text-xs text-muted-foreground bg-muted/50 border rounded-lg p-3">
              Se excluyeron {formatPrice(data.meta.gastosNoComputables)} en movimientos marcados
              como "no afecta resultado" (retiros de socio, transferencias internas, etc).
            </div>
          )}

          {/* Diagnóstico: hay EGRESO en período pero $0 computables */}
          {data.gastos.total === 0 && (data.meta.movEgresosCount ?? 0) === 0 && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 space-y-1">
              <div className="font-medium">No hay movimientos EGRESO en este período</div>
              <div>
                Verificá el rango de fechas. Para registrar un gasto: <Link href="/caja" className="underline">Caja → Movimientos → Nuevo</Link>
              </div>
            </div>
          )}

          {data.gastos.total === 0 && (data.meta.movEgresosCount ?? 0) > 0 && data.meta.gastosNoComputables === 0 && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-3 space-y-1">
              <div className="font-medium">Hay {data.meta.movEgresosCount} EGRESO en el período pero suman $0 computable</div>
              <div>Posible causa: monto cero, o problema de datos. Revisá <Link href="/caja" className="underline">Caja → Movimientos</Link>.</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
