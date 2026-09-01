"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OrderStatusBadge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Truck } from "lucide-react"
import { useCurrency } from "@/contexts/currency-context"
import { EntregaLoteDialog } from "@/components/ordenes/entrega-lote-dialog"
import { esEstadoEntregado, esEstadoExcluidoDeLote } from "@/lib/lote-estados"
import { round2 } from "@/lib/lote-utils"

type DescuentoTipo = "porcentaje" | "monto"

interface RecepcionOrden {
  id: string
  numeroOrden: number
  codigoOrden: string | null
  dispositivo: string
  marca: string | null
  estado: string
  presupuesto: number | null
  costoFinal: number | null
}

export interface RecepcionDetalleResponse {
  recepcion: {
    id: string
    numero: number
    codigo: string
    clienteId: string
    clienteNombre: string
    descuentoTipo: DescuentoTipo | null
    descuentoValor: number | null
    observaciones: string | null
    createdAt: string
  }
  ordenes: RecepcionOrden[]
  totales: {
    subtotal: number
    totalLote: number
    /** Neto ya facturado en los equipos que ya salieron del taller. */
    yaCobrado: number
    /** Lo que falta para llegar al total del lote (nunca negativo). */
    pendienteCobro: number
    entregadas: number
    pendientes: number
  }
}

interface RecepcionDetailProps {
  recepcionId: string
  /** Permite al llamador reaccionar además de lo que ya hace este componente
   *  (refrescar) — por ejemplo, para navegar o mostrar un toast propio. */
  onEntregarLote?: () => void
}

export function RecepcionDetail({ recepcionId, onEntregarLote }: RecepcionDetailProps) {
  const { data: session } = useSession()
  const { formatPrice, formatDate } = useCurrency()
  const isAdmin = session?.user?.role === "ADMIN"

  const [data, setData] = useState<RecepcionDetalleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [descuentoTipo, setDescuentoTipo] = useState<DescuentoTipo>("porcentaje")
  const [descuentoValor, setDescuentoValor] = useState("")
  const [savingDescuento, setSavingDescuento] = useState(false)
  const [entregaLoteOpen, setEntregaLoteOpen] = useState(false)

  const fetchRecepcion = useCallback(async () => {
    try {
      const res = await fetch(`/api/recepciones/${recepcionId}`)
      if (!res.ok) {
        toast.error("No se pudo cargar la recepcion")
        return
      }
      const json: RecepcionDetalleResponse = await res.json()
      setData(json)
      setDescuentoTipo(json.recepcion.descuentoTipo ?? "porcentaje")
      setDescuentoValor(json.recepcion.descuentoValor != null ? String(json.recepcion.descuentoValor) : "")
    } catch {
      toast.error("No se pudo cargar la recepcion")
    } finally {
      setLoading(false)
    }
  }, [recepcionId])

  useEffect(() => {
    fetchRecepcion()
  }, [fetchRecepcion])

  const handleSaveDescuento = async () => {
    const valorNum = descuentoValor.trim() ? Number(descuentoValor) : null
    setSavingDescuento(true)
    try {
      const res = await fetch(`/api/recepciones/${recepcionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          descuentoTipo: valorNum ? descuentoTipo : null,
          descuentoValor: valorNum,
        }),
      })
      if (res.ok) {
        toast.success("Descuento actualizado")
        await fetchRecepcion()
      } else {
        const err = await res.json().catch(() => null)
        toast.error(err?.error || "Error al guardar el descuento")
      }
    } catch {
      toast.error("Error al guardar el descuento")
    } finally {
      setSavingDescuento(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[300px]" />
      </div>
    )
  }

  if (!data) {
    return <div className="text-center py-8 text-muted-foreground">Recepcion no encontrada</div>
  }

  const { recepcion, ordenes, totales } = data
  // Elegibles = los que todavía pueden salir por la acción de lote. Un equipo
  // cancelado o sin reparación ya salió del lote por otra vía: no entra al
  // cobro único y tampoco puede bloquear el botón (ver lib/lote-estados.ts).
  const ordenesPendientes = ordenes.filter((o) => !esEstadoExcluidoDeLote(o.estado))
  // Mientras algún elegible no llegue a REPARADO no se puede confirmar el
  // total y entregar el lote entero en una sola operación.
  const pendientesSinReparar = ordenesPendientes.filter((o) => o.estado !== "REPARADO")
  const puedeEntregar = ordenesPendientes.length > 0 && pendientesSinReparar.length === 0
  const motivoDeshabilitado =
    ordenesPendientes.length === 0
      ? "No quedan equipos pendientes de entrega en este lote."
      : "Todos los equipos pendientes deben estar en estado Reparado para poder entregar el lote."

  const descuentoAplicado = recepcion.descuentoTipo && recepcion.descuentoValor ? totales.subtotal - totales.totalLote : 0

  // Base que el servidor usa para el total del lote: los costos ya
  // persistidos de los equipos que se retiraron individualmente. El diálogo
  // los necesita para mostrar el mismo número que se va a cobrar.
  const subtotalEntregados = round2(
    ordenes.filter((o) => esEstadoEntregado(o.estado)).reduce((acc, o) => acc + (o.costoFinal ?? 0), 0),
  )
  // Equipos que siguen dentro del lote: entregados + elegibles pendientes.
  const equiposEnLote = totales.entregadas + totales.pendientes

  const handleEntregaLoteSuccess = () => {
    fetchRecepcion()
    onEntregarLote?.()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/ordenes">
          <Button variant="outline" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Lote {recepcion.codigo}</h1>
          <p className="text-sm text-muted-foreground">
            {recepcion.clienteNombre} • Recibido el {formatDate(recepcion.createdAt)}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium">
            {totales.entregadas} de {equiposEnLote} entregados
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Equipos del lote</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {ordenes.map((orden) => (
            <Link
              key={orden.id}
              href={`/ordenes/${orden.id}`}
              className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-muted/50 transition-colors"
            >
              <div>
                <p className="font-medium text-primary">{orden.codigoOrden || `#${orden.numeroOrden}`}</p>
                <p className="text-sm text-muted-foreground">
                  {orden.marca ? `${orden.marca} ` : ""}
                  {orden.dispositivo}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{formatPrice(orden.costoFinal ?? orden.presupuesto ?? 0)}</span>
                <OrderStatusBadge status={orden.estado} showIcon />
              </div>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Totales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span>{formatPrice(totales.subtotal)}</span>
          </div>

          {recepcion.descuentoTipo && recepcion.descuentoValor ? (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">
                Descuento (
                {recepcion.descuentoTipo === "porcentaje" ? `${recepcion.descuentoValor}%` : formatPrice(recepcion.descuentoValor)}
                )
              </span>
              <span className="text-muted-foreground">-{formatPrice(descuentoAplicado)}</span>
            </div>
          ) : null}

          {isAdmin && totales.entregadas === 0 && (
            <div className="flex flex-wrap items-end gap-2 pt-2 border-t">
              <div>
                <Label htmlFor="descuento-tipo" className="text-xs text-muted-foreground">
                  Tipo
                </Label>
                <select
                  id="descuento-tipo"
                  value={descuentoTipo}
                  onChange={(e) => setDescuentoTipo(e.target.value as DescuentoTipo)}
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                  <option value="porcentaje">Porcentaje</option>
                  <option value="monto">Monto</option>
                </select>
              </div>
              <div>
                <Label htmlFor="descuento-valor" className="text-xs text-muted-foreground">
                  Descuento
                </Label>
                <Input
                  id="descuento-valor"
                  type="number"
                  step="0.01"
                  min="0"
                  value={descuentoValor}
                  onChange={(e) => setDescuentoValor(e.target.value)}
                  className="h-9 w-28"
                  placeholder="0"
                />
              </div>
              <Button size="sm" onClick={handleSaveDescuento} disabled={savingDescuento}>
                Guardar
              </Button>
            </div>
          )}

          <div className="flex justify-between items-center pt-3 border-t">
            <span className="font-semibold">Total del lote</span>
            <span className="text-xl font-bold">{formatPrice(totales.totalLote)}</span>
          </div>

          {/* Con equipos ya retirados individualmente, el total del lote no es
              lo que queda por cobrar: el flujo individual cobra el precio
              individual entero y la entrega del lote liquida la diferencia. */}
          {totales.entregadas > 0 && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ya cobrado</span>
                <span>{formatPrice(totales.yaCobrado)}</span>
              </div>
              <div className="flex justify-between text-sm font-medium">
                <span>Pendiente de cobro</span>
                <span>{formatPrice(totales.pendienteCobro)}</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Entregar y cobrar el lote cambia precios y estado de varias órdenes:
          solo ADMIN, igual que el gate de POST /api/recepciones/[id]/entregar. */}
      {isAdmin && (
        <div className="flex flex-col items-end gap-1.5">
          <Button
            size="lg"
            disabled={!puedeEntregar}
            onClick={() => setEntregaLoteOpen(true)}
            title={!puedeEntregar ? motivoDeshabilitado : undefined}
          >
            <Truck className="h-4 w-4 mr-2" />
            Entregar lote
          </Button>
          {!puedeEntregar && <p className="text-xs text-muted-foreground text-right max-w-xs">{motivoDeshabilitado}</p>}
        </div>
      )}

      <EntregaLoteDialog
        open={entregaLoteOpen}
        onClose={() => setEntregaLoteOpen(false)}
        onSuccess={handleEntregaLoteSuccess}
        recepcionId={recepcionId}
        ordenes={ordenesPendientes}
        descuentoTipo={recepcion.descuentoTipo}
        descuentoValor={recepcion.descuentoValor}
        subtotalEntregados={subtotalEntregados}
        yaCobrado={totales.yaCobrado}
      />
    </div>
  )
}
