"use client"

import { useRef, useState } from "react"
import { CheckCircle2, Loader2, Mail, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { VerLoQueVeTuCliente } from "@/components/onboarding/ver-lo-que-ve-tu-cliente"
import { CURRENCIES, formatCurrencyValue, type CurrencyCode } from "@/lib/currency"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"
import { parseMoneyInput } from "@/lib/parse-money"
import type { Terminologia } from "@/lib/terminologia"
import { cn } from "@/lib/utils"
import { PracticaRecibir } from "./practica-recibir"
import { practicaApi, type ResultadoPractica } from "./practica-api"
import { subPasoPractica } from "./wizard-state"
import type { SubPasoPractica, TipoPractica } from "./types"

const TEXTOS: Record<SubPasoPractica, { titulo: string; descripcion: string }> = {
  recibir: {
    titulo: "Cargá tu orden de práctica",
    descripcion: "Hacé de cuenta que entra un cliente. El cliente sos vos: así ves lo que le llega.",
  },
  reparar: {
    titulo: "Ahora, la reparación",
    descripcion: "Poné lo que cobrarías por el trabajo. Al marcarla como reparada sale el segundo email.",
  },
  entregar: {
    titulo: "Última parada: la entrega",
    descripcion: "Cuando el cliente retira, la marcás como entregada y le llega el último email.",
  },
  terminada: {
    titulo: "Práctica terminada",
    descripcion: "Ya recorriste el ciclo completo de una orden.",
  },
}

const ETAPAS: { sub: SubPasoPractica; label: string }[] = [
  { sub: "recibir", label: "Recibida" },
  { sub: "reparar", label: "Reparada" },
  { sub: "entregar", label: "Entregada" },
]
const ORDEN_SUBPASOS: SubPasoPractica[] = ["recibir", "reparar", "entregar", "terminada"]

export interface PracticaStepProps {
  practica: PracticaOrden | null
  tipos: TipoPractica[]
  terminologia: Terminologia
  ownerEmail: string
  moneda: CurrencyCode
  onPracticaChange: (practica: PracticaOrden | null) => void
  onAtras: () => void
}

export function PracticaStep({
  practica,
  tipos,
  terminologia,
  ownerEmail,
  moneda,
  onPracticaChange,
  onAtras,
}: PracticaStepProps) {
  const subPaso = subPasoPractica(practica)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ultimaAccion = useRef<(() => Promise<ResultadoPractica>) | null>(null)

  // On 404/409 the practice moved under us (deleted, or advanced from another
  // tab): re-read it and continue from where it really is instead of failing.
  const ejecutar = async (accion: () => Promise<ResultadoPractica>) => {
    ultimaAccion.current = accion
    setEnviando(true)
    setError(null)
    try {
      const resultado = await accion()
      if (resultado.ok) {
        onPracticaChange(resultado.practica)
        return
      }
      if (resultado.status === 404 || resultado.status === 409) {
        const actual = await practicaApi.leer()
        // Resync only when the practice really is at another sub-step (a null
        // practice counts as "recibir"); otherwise the server's message, with
        // Reintentar, is the honest answer and the button never looks dead.
        if (actual.ok && subPasoPractica(actual.practica) !== subPaso) {
          onPracticaChange(actual.practica)
          return
        }
      }
      setError(resultado.error)
    } finally {
      setEnviando(false)
    }
  }

  const reintentar = () => {
    if (ultimaAccion.current) void ejecutar(ultimaAccion.current)
  }

  const texto = TEXTOS[subPaso]

  return (
    <>
      <CardHeader className="space-y-4">
        <PracticaTracker subPaso={subPaso} />
        <div className="space-y-1.5">
          <CardTitle data-paso-titulo tabIndex={-1} className="text-xl outline-none">
            {texto.titulo}
          </CardTitle>
          <CardDescription>{texto.descripcion}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {practica && (subPaso === "reparar" || subPaso === "entregar") && (
          <AvisoCliente practica={practica} subPaso={subPaso} ownerEmail={ownerEmail} />
        )}
        {practica && <ResumenPractica practica={practica} tipos={tipos} />}
        {subPaso === "recibir" && (
          <PracticaRecibir
            tipos={tipos}
            terminologia={terminologia}
            ownerEmail={ownerEmail}
            enviando={enviando}
            onEnviar={(body) => void ejecutar(() => practicaApi.crear(body))}
            onAtras={onAtras}
          />
        )}
        {subPaso === "reparar" && (
          <PracticaReparar
            moneda={moneda}
            enviando={enviando}
            onReparar={(monto) => void ejecutar(() => practicaApi.reparar(monto))}
          />
        )}
        {subPaso === "entregar" && practica && (
          <PracticaEntregar
            practica={practica}
            moneda={moneda}
            enviando={enviando}
            onEntregar={() => void ejecutar(practicaApi.entregar)}
          />
        )}
        {error && <AvisoError mensaje={error} reintentando={enviando} onReintentar={reintentar} />}
      </CardContent>
    </>
  )
}

function PracticaTracker({ subPaso }: { subPaso: SubPasoPractica }) {
  const actual = ORDEN_SUBPASOS.indexOf(subPaso)
  return (
    <ol aria-label="Avance de la práctica" className="grid grid-cols-3 gap-2">
      {ETAPAS.map((etapa, idx) => {
        const hecha = idx < actual
        const enCurso = idx === actual
        return (
          <li
            key={etapa.sub}
            aria-current={enCurso ? "step" : undefined}
            className={cn(
              "flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition-colors duration-200",
              hecha && "border-success/30 bg-success-50 text-success-700 dark:bg-success/15 dark:text-success-500",
              enCurso && "border-primary bg-primary/5 text-primary",
              !hecha && !enCurso && "border-border text-muted-foreground"
            )}
          >
            {hecha ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">{idx + 1}</span>
            )}
            {etapa.label}
            {hecha && <span className="sr-only"> (hecho)</span>}
          </li>
        )
      })}
    </ol>
  )
}

function AvisoCliente({
  practica,
  subPaso,
  ownerEmail,
}: {
  practica: PracticaOrden
  subPaso: "reparar" | "entregar"
  ownerEmail: string
}) {
  const texto =
    subPaso === "reparar"
      ? `Le mandamos un email a ${ownerEmail}: así se entera tu cliente.`
      : "Le avisamos por email que ya puede pasar a retirar."
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success-50 p-3 text-sm text-success-700 dark:bg-success/15 dark:text-success-500 sm:flex-row sm:items-center sm:justify-between"
    >
      <p className="flex items-start gap-2">
        <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {texto}
      </p>
      <VerLoQueVeTuCliente publicToken={practica.publicToken} />
    </div>
  )
}

function ResumenPractica({ practica, tipos }: { practica: PracticaOrden; tipos: TipoPractica[] }) {
  const tipoNombre = tipos.find((tipo) => tipo.codigo === practica.tipoDispositivo)?.nombre ?? practica.tipoDispositivo
  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="font-medium">{practica.dispositivo}</p>
      <p className="text-muted-foreground">
        {tipoNombre} · {practica.problemaReportado}
      </p>
    </div>
  )
}

function PracticaReparar({
  moneda,
  enviando,
  onReparar,
}: {
  moneda: CurrencyCode
  enviando: boolean
  onReparar: (monto: number) => void
}) {
  const [valor, setValor] = useState("")
  const monto = parseMoneyInput(valor)
  const valido = Number.isFinite(monto) && monto > 0
  const mostrarAyuda = valor.trim() !== "" && !valido
  const simbolo = (CURRENCIES[moneda] ?? CURRENCIES.ARS).symbol

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (valido && !enviando) onReparar(monto)
      }}
      className="space-y-4"
      noValidate
    >
      <div className="space-y-1.5">
        <Label htmlFor="practica-costo">¿Cuánto cobrarías?</Label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
          >
            {simbolo}
          </span>
          <Input
            id="practica-costo"
            inputMode="decimal"
            autoComplete="off"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            disabled={enviando}
            placeholder="0"
            aria-invalid={mostrarAyuda}
            aria-describedby="practica-costo-ayuda"
            className={simbolo.length > 2 ? "pl-14" : "pl-10"}
          />
        </div>
        <p id="practica-costo-ayuda" className={cn("text-xs", mostrarAyuda ? "text-destructive" : "text-muted-foreground")}>
          {mostrarAyuda ? "Poné un monto mayor a cero." : "Es solo para la práctica: nadie te va a cobrar nada."}
        </p>
      </div>
      <Button type="submit" className="w-full sm:w-auto" disabled={!valido || enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {enviando ? "Guardando…" : "Marcar como reparada"}
      </Button>
    </form>
  )
}

function PracticaEntregar({
  practica,
  moneda,
  enviando,
  onEntregar,
}: {
  practica: PracticaOrden
  moneda: CurrencyCode
  enviando: boolean
  onEntregar: () => void
}) {
  return (
    <div className="space-y-4">
      {practica.costoFinal != null && (
        <p className="text-sm text-muted-foreground">Cobrarías {formatCurrencyValue(practica.costoFinal, moneda)}</p>
      )}
      <p className="text-sm">En la práctica no se cobra nada. En una orden real, acá registrás el pago.</p>
      <Button className="w-full sm:w-auto" onClick={onEntregar} disabled={enviando}>
        {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {enviando ? "Entregando…" : "Entregar"}
      </Button>
    </div>
  )
}

function AvisoError({
  mensaje,
  reintentando,
  onReintentar,
}: {
  mensaje: string
  reintentando: boolean
  onReintentar: () => void
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
    >
      <p>{mensaje}</p>
      <Button type="button" size="sm" variant="outline" onClick={onReintentar} disabled={reintentando} className="shrink-0">
        <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  )
}
