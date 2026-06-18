"use client"

import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Clock, CheckCircle2, Loader2, Trash2,
  ShoppingCart, RefreshCw, Mail, Phone,
} from "lucide-react"
import { WhatsAppIcon } from "@/components/icons/whatsapp-icon"
import { toast } from "sonner"
import { resolvePlantilla } from "@/lib/whatsapp/plantillas-catalog"
import { useCurrency } from "@/contexts/currency-context"
import { formatPhoneForWhatsApp } from "@/lib/notifications/whatsapp-templates"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface CarritoItem {
  itemId: string
  varianteId?: string | null
  varianteEtiqueta?: string | null
  nombre: string
  cantidad: number
  precioUnitario: number
  imagen_url?: string | null
}

interface Carrito {
  id: number
  catalogo_slug: string
  cliente_nombre: string
  cliente_telefono: string
  cliente_email: string | null
  items: CarritoItem[]
  total_estimado: number
  cupon_codigo: string | null
  created_at: string
  updated_at: string
  recovered_at: string | null
  contacted_at: string | null
  cotizacion_id: string | null
}

function formatPrecio(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n)
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "ahora"
  if (min < 60) return `hace ${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `hace ${hr} h`
  const dias = Math.floor(hr / 24)
  return `hace ${dias} día${dias > 1 ? "s" : ""}`
}

export function CatalogoCarritosAbandonadosTab() {
  const { organizationName, pais } = useCurrency()
  const [carritos, setCarritos] = useState<Carrito[]>([])
  const [pendientes, setPendientes] = useState(0)
  const [loading, setLoading] = useState(true)
  const [includeRecovered, setIncludeRecovered] = useState(false)
  const [actingId, setActingId] = useState<number | null>(null)
  const [discardId, setDiscardId] = useState<number | null>(null)
  const [plantillas, setPlantillas] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/notificaciones/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.plantillasWhatsapp) {
          setPlantillas(data.plantillasWhatsapp)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (includeRecovered) params.set("include_recovered", "1")
      const res = await fetch(`/api/catalogo/carritos-abandonados?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCarritos(data.carritos)
      setPendientes(data.pendientes)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error cargando carritos")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeRecovered])

  const handleContacted = async (id: number) => {
    setActingId(id)
    try {
      const res = await fetch(`/api/catalogo/carritos-abandonados/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark_contacted" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCarritos((prev) => prev.map((c) => (c.id === id ? data.carrito : c)))
      toast.success("Marcado como contactado")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error")
    } finally {
      setActingId(null)
    }
  }

  const handleDiscard = async () => {
    if (discardId == null || actingId != null) return
    setActingId(discardId)
    try {
      const res = await fetch(`/api/catalogo/carritos-abandonados/${discardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "discard" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Error")
      }
      setCarritos((prev) => prev.filter((c) => c.id !== discardId))
      toast.success("Descartado")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error")
    } finally {
      setActingId(null)
      setDiscardId(null)
    }
  }

  const totalRecuperable = useMemo(
    () => carritos.filter((c) => !c.recovered_at).reduce((s, c) => s + Number(c.total_estimado), 0),
    [carritos]
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingCart className="h-5 w-5" />
                Carritos abandonados
                {pendientes > 0 && <Badge variant="destructive">{pendientes}</Badge>}
              </CardTitle>
              <CardDescription>
                Visitantes que dejaron datos pero no enviaron la solicitud. Contactalos por WhatsApp para recuperar la venta.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                Refrescar
              </Button>
              <Button
                variant={includeRecovered ? "default" : "outline"}
                size="sm"
                onClick={() => setIncludeRecovered((v) => !v)}
              >
                {includeRecovered ? "Ocultar recuperados" : "Ver recuperados"}
              </Button>
            </div>
          </div>
          {!includeRecovered && totalRecuperable > 0 && (
            <p className="text-sm pt-2">
              Valor estimado recuperable: <span className="font-semibold text-foreground">{formatPrecio(totalRecuperable)}</span>
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-24 bg-muted rounded-md animate-pulse" />
              ))}
            </div>
          ) : carritos.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>{includeRecovered ? "Sin carritos en el período." : "No hay carritos pendientes."}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {carritos.map((c) => {
                const cantidadTotal = c.items.reduce((s, i) => s + i.cantidad, 0)
                const telFormateado = formatPhoneForWhatsApp(c.cliente_telefono, pais)
                const lista = c.items
                  .slice(0, 5)
                  .map((i) => `• ${i.cantidad}× ${i.nombre}${i.varianteEtiqueta ? ` (${i.varianteEtiqueta})` : ""}`)
                  .join("\n")
                const restantes = c.items.length > 5 ? `\n...y ${c.items.length - 5} más` : ""
                const linkCatalogo =
                  typeof window !== "undefined"
                    ? `${window.location.origin}/catalogo/${c.catalogo_slug}`
                    : ""
                const msg = resolvePlantilla(
                  "catalogo_carrito_abandonado_recovery",
                  {
                    cliente: c.cliente_nombre,
                    items: `${lista}${restantes}`,
                    total: formatPrecio(Number(c.total_estimado)),
                    link_catalogo: linkCatalogo,
                    empresa: organizationName,
                  },
                  plantillas,
                )
                const waUrl = `https://wa.me/${telFormateado}?text=${encodeURIComponent(msg)}`

                return (
                  <div
                    key={c.id}
                    className={`rounded-lg border p-3 ${
                      c.recovered_at ? "bg-muted/30 opacity-70" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold">{c.cliente_nombre}</h4>
                          {c.recovered_at ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="h-3 w-3 text-green-600" />
                              Recuperado
                            </Badge>
                          ) : c.contacted_at ? (
                            <Badge variant="outline" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" />
                              Contactado {timeAgo(c.contacted_at)}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-0.5">
                          <span className="inline-flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {c.cliente_telefono}
                          </span>
                          {c.cliente_email && (
                            <span className="inline-flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {c.cliente_email}
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {timeAgo(c.created_at)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold">{formatPrecio(Number(c.total_estimado))}</div>
                        <div className="text-xs text-muted-foreground">
                          {cantidadTotal} item{cantidadTotal !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>

                    <ul className="text-xs space-y-0.5 mb-3">
                      {c.items.slice(0, 4).map((i, idx) => (
                        <li key={idx} className="flex justify-between gap-2">
                          <span className="truncate">
                            {i.cantidad}× {i.nombre}
                            {i.varianteEtiqueta ? ` (${i.varianteEtiqueta})` : ""}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {formatPrecio(i.precioUnitario * i.cantidad)}
                          </span>
                        </li>
                      ))}
                      {c.items.length > 4 && (
                        <li className="text-muted-foreground italic">+ {c.items.length - 4} más</li>
                      )}
                    </ul>

                    {!c.recovered_at && (
                      <div className="flex flex-wrap gap-1.5 pt-2 border-t">
                        <Button
                          asChild
                          size="sm"
                          className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                        >
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => {
                              if (!c.contacted_at) handleContacted(c.id)
                            }}
                          >
                            <WhatsAppIcon className="h-3.5 w-3.5" />
                            WhatsApp
                          </a>
                        </Button>
                        {!c.contacted_at && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleContacted(c.id)}
                            disabled={actingId === c.id}
                            className="gap-1.5"
                          >
                            {actingId === c.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Marcar contactado
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDiscardId(c.id)}
                          disabled={actingId === c.id}
                          className="gap-1.5 text-destructive ml-auto"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Descartar
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
      <ConfirmDialog
        open={discardId != null}
        onOpenChange={(open) => !open && setDiscardId(null)}
        title="Descartar carrito"
        description="Se pierde este lead y no se podrá recuperar."
        confirmText="Descartar"
        variant="danger"
        loading={actingId != null && actingId === discardId}
        onConfirm={handleDiscard}
      />
    </div>
  )
}
