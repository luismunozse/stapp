"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { SignaturePad } from "@/components/firma/signature-pad"
import { Input } from "@/components/ui/input"
import { Loader2, PackageCheck, PackageX, AlertTriangle, Shield, HandCoins } from "lucide-react"
import { toast } from "sonner"
import { useCurrency } from "@/contexts/currency-context"
import {
  defaultMotivoSinCobro,
  MOTIVOS_SIN_COBRO,
  MOTIVO_SIN_COBRO_LABELS,
  type MotivoSinCobro,
} from "@/lib/seguimiento-state"

// Hints propios de este diálogo; los labels vienen del mapa compartido para
// no divergir del texto usado en el timeline de eventos y el detalle de orden.
const MOTIVO_HINTS: Record<MotivoSinCobro, string> = {
  NO_REPARABLE: "El equipo no se pudo reparar.",
  CORTESIA: "Reparado pero decidimos no cobrar.",
  GARANTIA: "Reingreso bajo garantía, sin cargo.",
  CLIENTE_DESISTIO: "Cliente aprobó y luego se arrepintió.",
  OTRO: "",
}

const MOTIVO_OPTIONS: Array<{ value: MotivoSinCobro; label: string; hint: string }> =
  MOTIVOS_SIN_COBRO.map((value) => ({
    value,
    label: MOTIVO_SIN_COBRO_LABELS[value],
    hint: MOTIVO_HINTS[value],
  }))

interface EntregaDialogProps {
  open: boolean
  onClose: () => void
  /** Recibe el saldo que quedó pendiente para que el llamador encadene el
   *  cobro. Es el valor calculado por el servidor sobre el costo_final recién
   *  confirmado, no una cuenta hecha en el cliente. */
  onSuccess: (pendienteCobro?: number) => void
  orden: {
    id: string
    numeroOrden: number
    codigoOrden?: string
    dispositivo: string
    estado?: string
    cliente: {
      nombre: string
      telefono: string
    }
    estadoCobro?: string
    pendienteCobro?: number
    costoFinal?: number | null
    repuestos?: RepuestoEntrega[]
  }
  encargadoNombre: string
  esRetiro?: boolean
  sinCobro?: boolean
  garantiaDiasDefault?: number
}

interface RepuestoEntrega {
  id: string
  nombre?: string
  cantidad: number
  precioUnitario: number
  precioVentaUnitario?: number | null
  inventario?: { nombre: string } | null
}

export function EntregaDialog({
  open,
  onClose,
  onSuccess,
  orden,
  encargadoNombre,
  esRetiro = false,
  sinCobro = false,
  garantiaDiasDefault = 30,
}: EntregaDialogProps) {
  const { formatPrice } = useCurrency()
  const [loading, setLoading] = useState(false)
  const [firmaCliente, setFirmaCliente] = useState<string | null>(null)
  const [firmaClienteMime, setFirmaClienteMime] = useState<string | null>(null)
  const [firmaEncargado, setFirmaEncargado] = useState<string | null>(null)
  const [firmaEncargadoMime, setFirmaEncargadoMime] = useState<string | null>(null)
  const [notasEntrega, setNotasEntrega] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [conGarantia, setConGarantia] = useState(!esRetiro && !sinCobro)
  const [diasGarantia, setDiasGarantia] = useState(String(garantiaDiasDefault))
  const [notasGarantia, setNotasGarantia] = useState("")
  const [motivoSinCobro, setMotivoSinCobro] = useState<MotivoSinCobro>(
    () => defaultMotivoSinCobro(orden.estado)
  )
  // Confirmación del total al entregar. Arranca en "ya incluye los repuestos"
  // porque es como se venía trabajando: el costo final se tipeaba a mano
  // contemplándolos. Así, quien no toque nada obtiene el comportamiento previo.
  const [totalDraft, setTotalDraft] = useState("")
  const [incluyeRepuestos, setIncluyeRepuestos] = useState(true)

  useEffect(() => {
    if (open && sinCobro) {
      setMotivoSinCobro(defaultMotivoSinCobro(orden.estado))
    }
  }, [open, sinCobro, orden.estado])

  useEffect(() => {
    if (open) {
      setTotalDraft(orden.costoFinal ? String(orden.costoFinal) : "")
      setIncluyeRepuestos(true)
    }
  }, [open, orden.costoFinal])

  const tienePendiente = !esRetiro && !sinCobro && orden.estadoCobro && orden.estadoCobro !== "COBRADO" && (orden.pendienteCobro || 0) > 0

  const repuestos = orden.repuestos || []
  // Fallback al costo en repuestos anteriores a la migración 286, que no
  // tienen precio de venta registrado.
  const precioVentaDe = (r: RepuestoEntrega) =>
    r.precioVentaUnitario !== null && r.precioVentaUnitario !== undefined
      ? Number(r.precioVentaUnitario)
      : Number(r.precioUnitario || 0)
  const totalRepuestos = repuestos.reduce((sum, r) => sum + r.cantidad * precioVentaDe(r), 0)
  const mostrarCobro = !sinCobro
  const totalIngresado = parseFloat(totalDraft) || 0
  const totalACobrarFinal = incluyeRepuestos ? totalIngresado : totalIngresado + totalRepuestos

  const handleFirmaClienteChange = (data: string | null, mime: string | null) => {
    setFirmaCliente(data)
    setFirmaClienteMime(mime)
    setError(null)
  }

  const handleFirmaEncargadoChange = (data: string | null, mime: string | null) => {
    setFirmaEncargado(data)
    setFirmaEncargadoMime(mime)
    setError(null)
  }

  const handleConfirmar = async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/ordenes/${orden.id}/entregar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firmaClienteEntrega: firmaCliente || null,
          firmaClienteMime: firmaClienteMime || null,
          firmaEncargadoEntrega: firmaEncargado || null,
          firmaEncargadoMime: firmaEncargadoMime || null,
          notasEntrega: notasEntrega || null,
          sinCobro: sinCobro || undefined,
          motivoSinCobro: sinCobro ? motivoSinCobro : undefined,
          // Solo se manda si el operador confirmó un total: si lo deja vacío,
          // el servidor no toca costo_final y la orden conserva el que tenía.
          ...(mostrarCobro && totalDraft.trim()
            ? { totalACobrar: totalIngresado, incluyeRepuestos }
            : {}),
          ...(conGarantia && !esRetiro && !sinCobro ? {
            diasGarantia: Math.max(1, parseInt(diasGarantia, 10) || 30),
            notasGarantia: notasGarantia || null,
          } : {}),
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || "Error al registrar entrega")
        return
      }

      // La entrega pudo completarse con el descuento de stock fallado: el
      // servidor lo devuelve como `warning` en vez de fallar la operacion.
      // Mostrarlo es lo unico que evita que el desajuste pase inadvertido.
      if (data.warning) {
        toast.warning(data.warning, { duration: 10000 })
      }

      onSuccess(typeof data.pendienteCobro === "number" ? data.pendienteCobro : undefined)
      onClose()
    } catch (err) {
      console.error("Error:", err)
      setError("Error al registrar entrega")
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (!loading) {
      setFirmaCliente(null)
      setFirmaClienteMime(null)
      setFirmaEncargado(null)
      setFirmaEncargadoMime(null)
      setNotasEntrega("")
      setError(null)
      setConGarantia(!esRetiro && !sinCobro)
      setDiasGarantia(String(garantiaDiasDefault))
      setNotasGarantia("")
      onClose()
    }
  }

  const codigoDisplay = orden.codigoOrden || `#${orden.numeroOrden}`

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {sinCobro ? <HandCoins className="h-5 w-5" /> : esRetiro ? <PackageX className="h-5 w-5" /> : <PackageCheck className="h-5 w-5" />}
            {sinCobro ? "Entrega sin Cobro" : esRetiro ? "Retiro de Equipo Sin Reparación" : "Entrega de Equipo"}
          </DialogTitle>
          <DialogDescription>
            Orden {codigoDisplay} - {orden.dispositivo}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Banner informativo de entrega sin cobro */}
          {sinCobro && (
            <>
              <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-sm">
                <HandCoins className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-green-800 dark:text-green-300">
                    Entrega sin cobro
                  </p>
                  <p className="text-green-700 dark:text-green-400 text-xs mt-0.5">
                    El equipo será entregado sin cargo al cliente. No se generará cobro por esta reparación.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="motivo-sin-cobro" className="text-sm font-medium">
                  Motivo de la entrega sin cobro
                </Label>
                <select
                  id="motivo-sin-cobro"
                  value={motivoSinCobro}
                  onChange={(e) => setMotivoSinCobro(e.target.value as MotivoSinCobro)}
                  disabled={loading}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                >
                  {MOTIVO_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
                {(() => {
                  const hint = MOTIVO_OPTIONS.find((m) => m.value === motivoSinCobro)?.hint
                  return hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null
                })()}
              </div>
            </>
          )}

          {/* Banner informativo de retiro sin reparación */}
          {esRetiro && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Retiro sin reparación
                </p>
                <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
                  El cliente retira el equipo sin reparar. Al firmar, confirma que recibe el equipo en el estado en que se encuentra, eximiendo al taller de responsabilidad sobre el mismo.
                </p>
              </div>
            </div>
          )}

          {/* Cobro pendiente (solo entregas normales). Antes este cartel mandaba
              al operador a buscar el cobro en otra pantalla; ahora anticipa que
              la pantalla de cobro se abre sola al confirmar. */}
          {tienePendiente && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
              <HandCoins className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">
                  Queda un saldo de {formatPrice(orden.pendienteCobro || 0)}
                </p>
                <p className="text-amber-700 dark:text-amber-400 text-xs mt-0.5">
                  Al confirmar se abre la pantalla de cobro. Si el cliente no paga
                  ahora, cerrala y el saldo queda en su cuenta corriente.
                </p>
              </div>
            </div>
          )}

          <div className="bg-muted/50 p-3 rounded-lg text-sm">
            <p><strong>Cliente:</strong> {orden.cliente.nombre}</p>
            <p><strong>Telefono:</strong> {orden.cliente.telefono}</p>
          </div>

          {mostrarCobro && (
            <div className="rounded-lg border p-3 space-y-3">
              {repuestos.length > 0 && (
                <div>
                  <Label className="text-sm font-medium">Repuestos utilizados</Label>
                  <ul className="mt-2 space-y-1">
                    {repuestos.map((r) => (
                      <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate text-muted-foreground">
                          {r.inventario?.nombre || r.nombre}
                          <span className="ml-1 text-xs">
                            {r.cantidad} × {formatPrice(precioVentaDe(r))}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatPrice(r.cantidad * precioVentaDe(r))}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 flex justify-between border-t pt-2 text-sm font-medium">
                    <span>Total repuestos</span>
                    <span className="tabular-nums">{formatPrice(totalRepuestos)}</span>
                  </div>
                </div>
              )}

              <div>
                <Label htmlFor="total-cobrar" className="text-sm font-medium">
                  Total a cobrar
                </Label>
                <Input
                  id="total-cobrar"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  className="mt-1"
                  value={totalDraft}
                  onChange={(e) => setTotalDraft(e.target.value)}
                />
              </div>

              {repuestos.length > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={incluyeRepuestos}
                    onChange={(e) => setIncluyeRepuestos(e.target.checked)}
                  />
                  <span>
                    El total que ingresé <strong>ya incluye</strong> los repuestos
                    <span className="block text-xs text-muted-foreground">
                      Destildá esta opción si el monto es solo la mano de obra.
                    </span>
                  </span>
                </label>
              )}

              {totalDraft.trim() && (
                <div className="flex items-baseline justify-between rounded-md bg-muted/60 px-3 py-2 text-sm">
                  <span className="font-medium">Se cobrará</span>
                  <span className="font-semibold tabular-nums">
                    {formatPrice(totalACobrarFinal)}
                    {!incluyeRepuestos && repuestos.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({formatPrice(totalIngresado)} + {formatPrice(totalRepuestos)})
                      </span>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium mb-2 block">
                Firma del Cliente (opcional)
              </Label>
              <SignaturePad
                onSignatureChange={handleFirmaClienteChange}
                disabled={loading}
              />
            </div>

            <div>
              <Label className="text-sm font-medium mb-2 block">
                Firma del Encargado - {encargadoNombre} (opcional)
              </Label>
              <SignaturePad
                onSignatureChange={handleFirmaEncargadoChange}
                disabled={loading}
              />
            </div>
          </div>

          {/* Garantía (solo para entregas normales, no retiros ni sin cobro) */}
          {!esRetiro && !sinCobro && (
            <div className="space-y-3 p-3 rounded-lg border">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={conGarantia}
                  onChange={(e) => setConGarantia(e.target.checked)}
                  disabled={loading}
                  className="rounded"
                />
                <span className="flex items-center gap-2 font-medium text-sm">
                  <Shield className="h-4 w-4" />
                  Incluir garantía
                </span>
              </label>
              {conGarantia && (
                <div className="space-y-2 pl-6">
                  <div>
                    <Label htmlFor="dias-garantia" className="text-sm">Días de garantía</Label>
                    <Input
                      id="dias-garantia"
                      type="number"
                      min="1"
                      value={diasGarantia}
                      onChange={(e) => setDiasGarantia(e.target.value)}
                      disabled={loading}
                      className="mt-1 w-32"
                    />
                  </div>
                  <div>
                    <Label htmlFor="notas-garantia" className="text-sm">Condiciones (opcional)</Label>
                    <Textarea
                      id="notas-garantia"
                      value={notasGarantia}
                      onChange={(e) => setNotasGarantia(e.target.value)}
                      placeholder="Condiciones o alcance de la garantía..."
                      rows={2}
                      disabled={loading}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Label htmlFor="notas-entrega">Notas de entrega (opcional)</Label>
            <Textarea
              id="notas-entrega"
              value={notasEntrega}
              onChange={(e) => setNotasEntrega(e.target.value)}
              placeholder="Observaciones sobre la entrega..."
              rows={2}
              disabled={loading}
              className="mt-1"
            />
          </div>

          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleConfirmar}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Registrando...
                </>
              ) : (
                <>
                  {sinCobro ? <HandCoins className="mr-2 h-4 w-4" /> : esRetiro ? <PackageX className="mr-2 h-4 w-4" /> : <PackageCheck className="mr-2 h-4 w-4" />}
                  {sinCobro ? "Confirmar Entrega sin Cobro" : esRetiro ? "Confirmar Retiro" : "Confirmar Entrega"}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
