"use client"

import { useRef, useState, type FormEvent, type MutableRefObject } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { StatusBanner } from "@/components/ui/status-banner"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCurrency } from "@/contexts/currency-context"
import {
  anularComprobanteArca,
  MAX_DETALLE_MOTIVO,
  MOTIVOS_ANULACION,
  type MotivoAnulacion,
  type ResultadoAnulacion,
} from "@/lib/facturacion/anular-comprobante-client"
import { diasDesdeFactura, excedePlazoNotaCredito } from "@/lib/facturacion/plazo-nota-credito"

/** Lo que el dialogo necesita saber de la factura (un subconjunto del listado de comprobantes). */
export interface FacturaAAnular {
  id: string
  tipo: string
  numero: string | null
  total: number | null
  fechaEmision: string | null
  createdAt: string
}

interface AnularFacturaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  factura: FacturaAAnular
  /**
   * Se llama una vez por cada desenlace que cambia (o puede haber cambiado) la factura:
   * todos menos `error`, que el dialogo muestra adentro para poder volver a intentar.
   */
  onResultado: (resultado: ResultadoAnulacion) => void
}

const AVISO_PLAZO =
  "Pasaron más de 15 días desde la emisión de esta factura. ARCA no bloquea la nota de crédito, pero la RG 4540 pide emitirla dentro de ese plazo. Consultalo con tu contador antes de seguir."

/**
 * Confirmacion para anular una factura electronica con una nota de credito de ARCA.
 * Es una accion fiscal que no se deshace: se pide motivo, se avisa si pasaron mas de
 * 15 dias (sin bloquear) y, mientras ARCA contesta, no se puede cerrar ni enviar dos
 * veces. El servidor valida de nuevo cada regla.
 */
export function AnularFacturaDialog({ open, onOpenChange, factura, onResultado }: AnularFacturaDialogProps) {
  // El estado se actualiza en el render siguiente: el ref frena un segundo envio inmediato
  // y, a la vez, deja al Dialog saber que no se puede cerrar mientras ARCA contesta.
  const enviandoRef = useRef(false)

  const handleOpenChange = (siguiente: boolean) => {
    if (!siguiente && enviandoRef.current) return
    onOpenChange(siguiente)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* El formulario vive adentro del contenido: al cerrarse se desmonta y la proxima vez arranca limpio. */}
        <FormularioAnulacion
          factura={factura}
          enviandoRef={enviandoRef}
          onResultado={onResultado}
          onCerrar={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  )
}

interface FormularioAnulacionProps {
  factura: FacturaAAnular
  enviandoRef: MutableRefObject<boolean>
  onResultado: (resultado: ResultadoAnulacion) => void
  onCerrar: () => void
}

function FormularioAnulacion({ factura, enviandoRef, onResultado, onCerrar }: FormularioAnulacionProps) {
  const { formatPrice } = useCurrency()
  const [motivo, setMotivo] = useState<MotivoAnulacion | null>(null)
  const [detalle, setDetalle] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Un solo "hoy" por apertura: el aviso no cambia de golpe si el dialogo queda abierto a medianoche.
  const [ahora] = useState(() => new Date())

  const pasoElPlazo = excedePlazoNotaCredito(diasDesdeFactura(factura, ahora))
  const detalleObligatorio = motivo === "otro"
  const faltaDetalle = detalleObligatorio && detalle.trim() === ""
  const puedeEnviar = motivo !== null && !faltaDetalle && !enviando

  const titulo = ["Anular factura", factura.tipo, factura.numero].filter(Boolean).join(" ")

  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (enviandoRef.current || motivo === null || faltaDetalle) return
    enviandoRef.current = true
    setEnviando(true)
    setError(null)

    const resultado = await anularComprobanteArca(factura.id, { motivo, motivoDetalle: detalle })
    enviandoRef.current = false

    if (resultado.kind === "error") {
      // El servidor dijo que no y la factura sigue como estaba: se queda abierto para corregir o reintentar.
      setError(resultado.message)
      setEnviando(false)
      return
    }
    onResultado(resultado)
    onCerrar()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{titulo}</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2">
            <p>
              Vamos a emitir una nota de crédito electrónica (ARCA) por el total que ARCA autorizó para esta factura
              {factura.total != null ? ` (en STApp figura ${formatPrice(factura.total)})` : ""}.
            </p>
            <p>
              <strong className="font-semibold text-foreground">No se puede deshacer.</strong> No toca el stock, la caja,
              la cuenta corriente ni el estado de la venta. Si el cliente devolvió productos o plata, registrá la
              devolución aparte.
            </p>
            {pasoElPlazo && (
              <StatusBanner tone="warning" icon={AlertTriangle} className="items-start font-normal">
                {AVISO_PLAZO}
              </StatusBanner>
            )}
          </div>
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={enviar} noValidate aria-busy={enviando} className="grid gap-4">
        <fieldset disabled={enviando} className="space-y-2">
          <legend className="mb-2 text-sm font-medium">Motivo</legend>
          {MOTIVOS_ANULACION.map((opcion) => (
            <label
              key={opcion.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 text-sm transition-colors duration-150 has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
            >
              <input
                type="radio"
                name="motivo-anulacion"
                value={opcion.value}
                required
                checked={motivo === opcion.value}
                onChange={() => setMotivo(opcion.value)}
              />
              {opcion.label}
            </label>
          ))}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="detalle-anulacion">Detalle ({detalleObligatorio ? "obligatorio" : "opcional"})</Label>
          <Textarea
            id="detalle-anulacion"
            value={detalle}
            rows={3}
            maxLength={MAX_DETALLE_MOTIVO}
            aria-required={detalleObligatorio}
            disabled={enviando}
            onChange={(e) => setDetalle(e.target.value)}
          />
          <p aria-hidden="true" className="text-right text-xs text-muted-foreground">
            {detalle.length}/{MAX_DETALLE_MOTIVO}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {enviando && (
          <p role="status" className="text-sm text-muted-foreground">
            Estamos emitiendo la nota de crédito en ARCA. Puede tardar unos segundos: no cierres esta pantalla.
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="submit" variant="destructive" disabled={!puedeEnviar}>
            {enviando ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Anulando...
              </>
            ) : (
              "Anular factura"
            )}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
