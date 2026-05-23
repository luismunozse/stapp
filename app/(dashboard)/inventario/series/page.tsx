"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  ArrowLeft,
  Hash,
  Loader2,
  Search,
  ShieldCheck,
  ScanLine,
} from "lucide-react"

interface SerieRow {
  id: string
  numero_serie: string
  estado:
    | "DISPONIBLE"
    | "RESERVADO"
    | "VENDIDO"
    | "GARANTIA_ACTIVA"
    | "DEVUELTO"
    | "BLOQUEADO"
  fecha_venta: string | null
  fecha_garantia_vence: string | null
  venta_id: string | null
  cliente_id: string | null
  inventario: { id: string; codigo: string | null; nombre: string } | null
  lote: { id: string; numero_lote: string } | null
}

const ESTADO_COLOR: Record<SerieRow["estado"], string> = {
  DISPONIBLE: "border-emerald-500/60 text-emerald-600",
  RESERVADO: "border-blue-500/60 text-blue-600",
  VENDIDO: "border-muted-foreground/40 text-muted-foreground",
  GARANTIA_ACTIVA: "border-amber-500/60 text-amber-600",
  DEVUELTO: "border-red-500/60 text-red-600",
  BLOQUEADO: "border-red-500/60 text-red-600",
}

export default function SeriesGlobalPage() {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SerieRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    setError("")
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(
          `/api/inventario/series/buscar?q=${encodeURIComponent(q.trim())}`
        )
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || "Error al buscar")
        if (!cancelled) setResults(json.data ?? [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Link href="/inventario">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-2">
              <Hash className="h-6 w-6" /> Búsqueda de series
            </h1>
            <p className="text-sm text-muted-foreground">
              Buscá un número de serie globalmente para ver su estado, garantía e historial de venta
            </p>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Escaneá o tipeá número de serie (mín. 2 caracteres)..."
              className="pl-9 font-mono"
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <ScanLine className="h-3 w-3" />
            Compatible con lector de códigos de barras / QR
          </p>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}

      <Card>
        <CardContent className="p-0">
          {q.trim().length < 2 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Ingresá al menos 2 caracteres para buscar.
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Sin resultados para “{q}”.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase">
                  <tr>
                    <th className="text-left p-3">Serie</th>
                    <th className="text-left p-3">Item</th>
                    <th className="text-left p-3">Lote</th>
                    <th className="text-left p-3">Estado</th>
                    <th className="text-left p-3">Vendida</th>
                    <th className="text-left p-3">Garantía</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((s) => (
                    <tr key={s.id} className="border-t hover:bg-muted/40">
                      <td className="p-3 font-mono text-xs">{s.numero_serie}</td>
                      <td className="p-3">
                        {s.inventario ? (
                          <Link
                            href={`/inventario/${s.inventario.id}`}
                            className="hover:underline"
                          >
                            <div className="font-medium">{s.inventario.nombre}</div>
                            {s.inventario.codigo && (
                              <div className="text-[11px] text-muted-foreground">
                                {s.inventario.codigo}
                              </div>
                            )}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-[11px] text-muted-foreground">
                        {s.lote?.numero_lote ?? "—"}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${ESTADO_COLOR[s.estado]}`}
                        >
                          {s.estado}
                        </Badge>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {s.fecha_venta
                          ? new Date(s.fecha_venta).toLocaleDateString("es-AR")
                          : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {s.fecha_garantia_vence ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            {new Date(s.fecha_garantia_vence).toLocaleDateString("es-AR")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
