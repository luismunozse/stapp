"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Loader2,
  Layers,
  CalendarClock,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { useCurrency } from "@/contexts/currency-context"

interface LoteVencer {
  lote_id: string
  inventario_id: string
  codigo: string | null
  nombre: string
  numero_lote: string
  cantidad_actual: number
  fecha_vencimiento: string | null
  dias_restantes: number | null
  deposito_id: string | null
  deposito_nombre: string | null
  estado: "ACTIVO" | "AGOTADO" | "VENCIDO" | "BLOQUEADO"
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export default function LotesPage() {
  const { timezone } = useCurrency()
  const [dias, setDias] = useState<string>("30")
  const [marking, setMarking] = useState(false)
  const [error, setError] = useState("")
  const [okMsg, setOkMsg] = useState("")

  const { data, isLoading, mutate } = useSWR<{ data: LoteVencer[] }>(
    `/api/inventario/lotes/proximos-vencer?dias=${dias}`,
    fetcher
  )

  const lotes = data?.data ?? []

  const stats = useMemo(() => {
    const vencidos = lotes.filter((l) => (l.dias_restantes ?? 1) < 0).length
    const urgentes = lotes.filter(
      (l) => (l.dias_restantes ?? 999) >= 0 && (l.dias_restantes ?? 999) <= 7
    ).length
    const proximos = lotes.length
    return { vencidos, urgentes, proximos }
  }, [lotes])

  const handleMarcarVencidos = async () => {
    setError("")
    setOkMsg("")
    setMarking(true)
    try {
      const res = await fetch("/api/inventario/lotes/marcar-vencidos", { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error al marcar vencidos")
      setOkMsg(`${json.count} lote(s) marcado(s) como vencidos y descontados del stock.`)
      mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al marcar vencidos")
    } finally {
      setMarking(false)
    }
  }

  return (
    <PageShell
      title="Lotes y vencimientos"
      description="Lotes activos próximos a vencer y vencidos pendientes de baja"
      icon={Layers}
      backHref="/inventario"
      actions={
        <>
          <Select value={dias} onValueChange={setDias}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Próx. 7 días</SelectItem>
              <SelectItem value="15">Próx. 15 días</SelectItem>
              <SelectItem value="30">Próx. 30 días</SelectItem>
              <SelectItem value="60">Próx. 60 días</SelectItem>
              <SelectItem value="90">Próx. 90 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => mutate()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? "animate-spin" : ""}`} />
            Recargar
          </Button>
          <Button
            variant="destructive"
            onClick={handleMarcarVencidos}
            disabled={marking || stats.vencidos === 0}
          >
            {marking ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4 mr-1" />
            )}
            Marcar vencidos ({stats.vencidos})
          </Button>
        </>
      }
    >
      {error && (
        <div className="flex items-start gap-2 text-sm rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200 text-red-900 p-3">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}
      {okMsg && (
        <div className="text-sm rounded-md border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200 text-emerald-900 p-3">
          {okMsg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">En el rango</p>
            <p className="text-2xl font-bold">{stats.proximos}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Urgentes (≤ 7 días)</p>
            <p className="text-2xl font-bold text-amber-600">{stats.urgentes}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Vencidos sin procesar</p>
            <p className="text-2xl font-bold text-red-600">{stats.vencidos}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : lotes.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No hay lotes próximos a vencer en este rango.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">Item</th>
                    <th className="text-left p-3">Lote</th>
                    <th className="text-right p-3">Cantidad</th>
                    <th className="text-left p-3">Depósito</th>
                    <th className="text-left p-3">Vence</th>
                    <th className="text-left p-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {lotes.map((l) => {
                    const dr = l.dias_restantes ?? 0
                    const vencido = dr < 0
                    const urgente = dr >= 0 && dr <= 7
                    return (
                      <tr key={l.lote_id} className="border-t hover:bg-muted/40">
                        <td className="p-3">
                          <Link
                            href={`/inventario/${l.inventario_id}`}
                            className="font-medium hover:underline"
                          >
                            {l.nombre}
                          </Link>
                          {l.codigo && (
                            <div className="text-[11px] text-muted-foreground">{l.codigo}</div>
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs">{l.numero_lote}</td>
                        <td className="p-3 text-right">{l.cantidad_actual}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {l.deposito_nombre ?? "—"}
                        </td>
                        <td className="p-3">
                          {l.fecha_vencimiento ? (
                            <span
                              className={`flex items-center gap-1 ${
                                vencido
                                  ? "text-red-600"
                                  : urgente
                                  ? "text-amber-600"
                                  : ""
                              }`}
                            >
                              <CalendarClock className="h-3 w-3" />
                              {new Date(l.fecha_vencimiento).toLocaleDateString("es-AR", { timeZone: timezone })}
                              <span className="text-[11px] ml-1">
                                ({dr < 0 ? `hace ${-dr}d` : `en ${dr}d`})
                              </span>
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] ${
                              l.estado === "VENCIDO"
                                ? "border-red-500/60 text-red-600"
                                : l.estado === "BLOQUEADO"
                                ? "border-amber-500/60 text-amber-600"
                                : "border-emerald-500/60 text-emerald-600"
                            }`}
                          >
                            {l.estado}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  )
}
