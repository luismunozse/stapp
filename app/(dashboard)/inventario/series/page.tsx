"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { StatusPill } from "@/components/ui/status-pill"
import { serieEstado } from "@/components/inventario/serie-estado"
import { Input } from "@/components/ui/input"
import {
  Hash,
  Loader2,
  Search,
  ShieldCheck,
  ScanLine,
} from "lucide-react"
import { PageShell } from "@/components/ui/page-shell"
import { useCurrency } from "@/contexts/currency-context"

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


export default function SeriesGlobalPage() {
  const { formatDate } = useCurrency()
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
    <PageShell
      title="Búsqueda de series"
      description="Buscá un número de serie globalmente para ver su estado, garantía e historial de venta"
      icon={Hash}
      backHref="/inventario"
    >
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
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <ScanLine className="h-3 w-3" />
            Compatible con lector de códigos de barras / QR
          </p>
        </CardContent>
      </Card>

      {error && (
        <p className="text-sm text-destructive-text">{error}</p>
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
                              <div className="text-xs text-muted-foreground">
                                {s.inventario.codigo}
                              </div>
                            )}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-xs text-muted-foreground">
                        {s.lote?.numero_lote ?? "—"}
                      </td>
                      <td className="p-3">
                        <StatusPill tone={serieEstado(s.estado).tone} size="sm" className="text-xs">
                          {serieEstado(s.estado).label}
                        </StatusPill>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {s.fecha_venta
                          ? formatDate(s.fecha_venta)
                          : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {s.fecha_garantia_vence ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck className="h-3 w-3" />
                            {formatDate(s.fecha_garantia_vence)}
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
    </PageShell>
  )
}
