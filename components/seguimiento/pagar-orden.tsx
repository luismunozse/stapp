"use client"

import { useRef, useState } from "react"
import { AlertCircle, Banknote, CheckCircle2, Clock, Copy, Loader2, Upload, Wallet } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MoneyInput } from "@/components/ui/money-input"
import { cn } from "@/lib/utils"
import {
  COMPROBANTE_MAX_BYTES,
  METODO_PAGO_INFORMADO_LABEL,
  requiereComprobante,
  type MetodoPagoInformado,
} from "@/lib/ordenes/pagos-informados"

export interface PagoSeguimiento {
  total: number
  pagado: number
  saldo: number
  moneda: string
  alias: string | null
  mediosPagoTexto: string | null
  avisoPendiente: { monto: number; metodo: MetodoPagoInformado; fecha: string } | null
  ultimoRechazo: { monto: number; motivo: string | null; fecha: string | null } | null
}

interface PagarOrdenProps {
  token: string
  pago: PagoSeguimiento
  /** Refresca el seguimiento después de informar. */
  onInformado: () => void
}

/**
 * Sección "Pagá tu reparación" del seguimiento: saldo, alias del taller y el
 * formulario para informar el pago. El taller lo confirma después; hasta
 * entonces el saldo no cambia.
 */
export function PagarOrden({ token, pago, onInformado }: PagarOrdenProps) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("es-AR", { style: "currency", currency: pago.moneda || "ARS" }).format(n)

  const metodos: MetodoPagoInformado[] = pago.alias ? ["TRANSFERENCIA", "MERCADOPAGO", "EFECTIVO"] : ["EFECTIVO"]
  const [metodo, setMetodo] = useState<MetodoPagoInformado>(metodos[0])
  const [monto, setMonto] = useState<number | null>(pago.saldo)
  const [archivo, setArchivo] = useState<File | null>(null)
  const [nota, setNota] = useState("")
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  if (pago.avisoPendiente) {
    const a = pago.avisoPendiente
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardContent className="p-4 flex items-start gap-3">
          <Clock className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">
              {a.metodo === "EFECTIVO"
                ? `Avisaste que pagás ${fmt(a.monto)} en efectivo al retirar`
                : `Informaste un pago de ${fmt(a.monto)} por ${METODO_PAGO_INFORMADO_LABEL[a.metodo]}`}
            </p>
            <p className="text-muted-foreground mt-0.5">
              {a.metodo === "EFECTIVO"
                ? "El taller lo va a registrar cuando lo recibas."
                : "El taller lo está verificando. Cuando lo confirme, se actualiza el saldo."}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const conComprobante = requiereComprobante(metodo)

  const copiarAlias = async () => {
    if (!pago.alias) return
    try {
      await navigator.clipboard.writeText(pago.alias)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin portapapeles: el alias queda a la vista para copiarlo a mano.
    }
  }

  const enviar = async () => {
    setError(null)
    if (!monto || monto <= 0) return setError("Ingresá el monto que pagaste")
    if (monto > pago.saldo + 0.009) return setError(`El monto no puede superar el saldo (${fmt(pago.saldo)})`)
    if (conComprobante && !archivo) return setError("Adjuntá el comprobante del pago")
    if (archivo && archivo.size > COMPROBANTE_MAX_BYTES) return setError("El comprobante supera los 5 MB")

    const form = new FormData()
    form.set("metodo", metodo)
    form.set("monto", String(monto))
    if (nota.trim()) form.set("nota", nota.trim())
    if (conComprobante && archivo) form.set("comprobante", archivo)

    setEnviando(true)
    try {
      const res = await fetch(`/api/public/ordenes/${token}/informar-pago`, { method: "POST", body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "No se pudo informar el pago. Probá de nuevo.")
        return
      }
      onInformado()
    } catch {
      setError("No se pudo informar el pago. Revisá tu conexión y probá de nuevo.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Pagá tu reparación
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <span>{fmt(pago.total)}</span>
          </div>
          {pago.pagado > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ya pagaste</span>
              <span>{fmt(pago.pagado)}</span>
            </div>
          )}
          <div className="flex justify-between border-t pt-1 font-semibold text-base">
            <span>Saldo a pagar</span>
            <span>{fmt(pago.saldo)}</span>
          </div>
        </div>

        {pago.ultimoRechazo && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-800 dark:text-amber-300">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              El taller no pudo confirmar tu pago de {fmt(pago.ultimoRechazo.monto)}
              {pago.ultimoRechazo.motivo ? `: ${pago.ultimoRechazo.motivo}` : "."} Podés volver a informarlo.
            </span>
          </div>
        )}

        <div role="radiogroup" aria-label="Cómo vas a pagar" className="grid gap-2 sm:grid-cols-3">
          {metodos.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={metodo === m}
              onClick={() => {
                setMetodo(m)
                setError(null)
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-left transition-colors",
                metodo === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent",
              )}
            >
              {m === "EFECTIVO" ? <Banknote className="h-4 w-4" /> : <Wallet className="h-4 w-4" />}
              {METODO_PAGO_INFORMADO_LABEL[m]}
            </button>
          ))}
        </div>

        {conComprobante && pago.alias && (
          <div className="rounded-lg bg-muted p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Transferí o enviá por Mercado Pago a este alias / CBU</p>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold break-all">{pago.alias}</span>
              <Button type="button" variant="outline" size="sm" onClick={copiarAlias}>
                {copiado ? <CheckCircle2 className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copiado ? "Copiado" : "Copiar"}
              </Button>
            </div>
            {pago.mediosPagoTexto && <p className="text-xs text-muted-foreground whitespace-pre-line">{pago.mediosPagoTexto}</p>}
          </div>
        )}

        {metodo === "EFECTIVO" && (
          <p className="text-sm text-muted-foreground">
            Avisale al taller cuánto vas a pagar en efectivo cuando retires el equipo.
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pago-monto">{metodo === "EFECTIVO" ? "Monto que vas a pagar" : "Monto que pagaste"}</Label>
          <MoneyInput id="pago-monto" value={monto} onValueChange={(v) => setMonto(v)} />
          {monto !== null && monto < pago.saldo - 0.009 && (
            <p className="text-xs text-muted-foreground">Pago parcial: te quedarían {fmt(pago.saldo - monto)} por pagar.</p>
          )}
        </div>

        {conComprobante && (
          <div className="space-y-1.5">
            <Label htmlFor="pago-comprobante">Comprobante</Label>
            <input
              ref={fileRef}
              id="pago-comprobante"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="sr-only"
              onChange={(e) => {
                setArchivo(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
            <Button type="button" variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              {archivo ? archivo.name : "Subir foto o PDF del comprobante"}
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="pago-nota">Nota para el taller (opcional)</Label>
          <Textarea id="pago-nota" maxLength={300} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} />
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}

        <Button type="button" className="w-full" disabled={enviando} onClick={enviar}>
          {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {metodo === "EFECTIVO" ? "Avisar al taller" : "Informar pago"}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          El taller confirma el pago cuando lo recibe. Hasta entonces el saldo no cambia.
        </p>
      </CardContent>
    </Card>
  )
}
