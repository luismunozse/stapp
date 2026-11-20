"use client"

import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Check, ExternalLink, Loader2, Wallet, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useCurrency } from "@/contexts/currency-context"
import {
  METODO_PAGO_INFORMADO_LABEL,
  type EstadoPagoInformado,
  type MetodoPagoInformado,
} from "@/lib/ordenes/pagos-informados"

interface PagoInformado {
  id: string
  metodo: MetodoPagoInformado
  monto: number
  nota: string | null
  comprobanteUrl: string | null
  estado: EstadoPagoInformado
  motivoRechazo: string | null
  resueltoAt: string | null
  createdAt: string
}

interface PagosInformadosCardProps {
  ordenId: string
  /** Se llama después de confirmar o rechazar, para refrescar la orden (saldo, estado de cobro). */
  onResuelto: () => void
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })

/**
 * Pagos que el cliente informó desde el seguimiento. Los pendientes se
 * confirman (registra el cobro) o se rechazan; los resueltos quedan como
 * historial. Si la orden no tiene avisos, no se muestra.
 */
export function PagosInformadosCard({ ordenId, onResuelto }: PagosInformadosCardProps) {
  const { formatPrice } = useCurrency()
  const [pagos, setPagos] = useState<PagoInformado[]>([])
  const [accionEnCurso, setAccionEnCurso] = useState<string | null>(null)
  const [rechazando, setRechazando] = useState<string | null>(null)
  const [motivo, setMotivo] = useState("")

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/pagos-informados`)
      if (!res.ok) return
      const data = await res.json()
      setPagos(Array.isArray(data.pagos) ? data.pagos : [])
    } catch {
      // Sin avisos visibles: la orden sigue funcionando igual.
    }
  }, [ordenId])

  useEffect(() => {
    cargar()
  }, [cargar])

  const resolver = async (pagoId: string, body: Record<string, unknown>, exito: string) => {
    setAccionEnCurso(pagoId)
    try {
      const res = await fetch(`/api/ordenes/${ordenId}/pagos-informados/${pagoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || "No se pudo resolver el pago informado")
        await cargar()
        return
      }
      toast.success(exito)
      setRechazando(null)
      setMotivo("")
      await cargar()
      onResuelto()
    } catch {
      toast.error("No se pudo resolver el pago informado")
    } finally {
      setAccionEnCurso(null)
    }
  }

  if (pagos.length === 0) return null

  const pendientes = pagos.filter((p) => p.estado === "PENDIENTE")
  const resueltos = pagos.filter((p) => p.estado !== "PENDIENTE")

  return (
    <Card className={pendientes.length > 0 ? "border-primary/50" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" />
          Pagos informados por el cliente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {pendientes.map((p) => (
          <div key={p.id} className="rounded-lg border p-3 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{formatPrice(p.monto)}</p>
                <p className="text-sm text-muted-foreground">
                  {METODO_PAGO_INFORMADO_LABEL[p.metodo]} · {fecha(p.createdAt)}
                </p>
              </div>
              <Badge variant="outline">Por confirmar</Badge>
            </div>
            {p.nota && <p className="text-sm">“{p.nota}”</p>}
            {p.comprobanteUrl && (
              <a
                href={p.comprobanteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Ver comprobante <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <p className="text-xs text-muted-foreground">
              {p.metodo === "EFECTIVO"
                ? "Confirmalo cuando recibas el efectivo: se registra como cobro."
                : "Confirmalo cuando veas la plata acreditada: se registra como cobro."}
            </p>

            {rechazando === p.id ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="Motivo del rechazo"
                  placeholder="Motivo (opcional, lo ve el cliente). Ej: no me llegó la transferencia"
                  maxLength={300}
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={accionEnCurso === p.id}
                    onClick={() =>
                      resolver(p.id, { accion: "rechazar", motivo: motivo.trim() || undefined }, "Pago informado rechazado")
                    }
                  >
                    {accionEnCurso === p.id && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                    Rechazar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setRechazando(null)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={accionEnCurso === p.id}
                  onClick={() => resolver(p.id, { accion: "confirmar" }, `Cobro de ${formatPrice(p.monto)} registrado`)}
                >
                  {accionEnCurso === p.id ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-1 h-4 w-4" />
                  )}
                  Confirmar pago
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={accionEnCurso === p.id}
                  onClick={() => {
                    setRechazando(p.id)
                    setMotivo("")
                  }}
                >
                  <X className="mr-1 h-4 w-4" />
                  Rechazar
                </Button>
              </div>
            )}
          </div>
        ))}

        {resueltos.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {resueltos.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {fecha(p.createdAt)} · {METODO_PAGO_INFORMADO_LABEL[p.metodo]} · {formatPrice(p.monto)}
                </span>
                <Badge variant={p.estado === "CONFIRMADO" ? "success" : "destructive"}>
                  {p.estado === "CONFIRMADO" ? "Confirmado" : "Rechazado"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
