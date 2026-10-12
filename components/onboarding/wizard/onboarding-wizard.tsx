"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, ChevronRight, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCurrency } from "@/contexts/currency-context"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"
import { cn } from "@/lib/utils"
import { NegocioStep } from "./negocio-step"
import { PreguntaStep } from "./pregunta-step"
import { PASOS, pasoInicial, subPasoPractica } from "./wizard-state"
import type { CaminoCompletar, OnboardingWizardProps, PasoWizard, RubroVigente } from "./types"

export function OnboardingWizard(props: OnboardingWizardProps) {
  const router = useRouter()
  const { refreshConfig } = useCurrency()
  const [paso, setPaso] = useState<PasoWizard>(() => pasoInicial(props.practica))
  const [practica, setPractica] = useState<PracticaOrden | null>(props.practica)

  // Business drafts live here so that going back from a later step keeps them.
  const [nombre, setNombre] = useState(props.nombreNegocio)
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(props.logoUrl)

  // The props are a server snapshot: a rubro saved here wins until
  // router.refresh() brings the next snapshot (new tipos and vocabulary).
  const [rubroGuardado, setRubroGuardado] = useState<RubroVigente | null>(null)
  const [rubroBloqueadoAhora, setRubroBloqueadoAhora] = useState(false)
  const rubro = rubroGuardado ?? { rubro: props.rubro, rubroDetalle: props.rubroDetalle }
  const rubroBloqueado = props.ordenesRealesCount > 0 || rubroBloqueadoAhora
  const [actualizando, startActualizar] = useTransition()

  const [completando, setCompletando] = useState(false)
  const completandoRef = useRef(false)

  const contenidoRef = useRef<HTMLDivElement>(null)
  const pantallaAnterior = useRef<string | null>(null)
  const subPaso = subPasoPractica(practica)

  // Move focus to the new title after a step or practice sub-step change, so
  // keyboard and screen-reader users land on what changed. Never on mount.
  useEffect(() => {
    const pantalla = paso === "practica" ? `${paso}:${subPaso}` : paso
    const anterior = pantallaAnterior.current
    pantallaAnterior.current = pantalla
    if (anterior === null || anterior === pantalla) return
    contenidoRef.current?.querySelector<HTMLElement>("[data-paso-titulo]")?.focus()
  }, [paso, subPaso])

  const irA = (siguiente: PasoWizard) => setPaso(siguiente)

  const completar = async (destino: string, camino?: CaminoCompletar) => {
    // A ref, not state: two taps in the same frame must not both get through.
    if (completandoRef.current) return
    completandoRef.current = true
    setCompletando(true)
    try {
      await fetch(
        "/api/onboarding/complete",
        camino
          ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ camino }) }
          : { method: "POST" }
      )
    } catch (err) {
      console.error("Error completing onboarding:", err)
    } finally {
      // Navigate even if completion failed: the dashboard sends the user back
      // here when it did not persist, and the CTA must never be a no-op.
      router.push(destino)
      router.refresh()
    }
  }

  const handleRubroGuardado = (nuevo: RubroVigente) => {
    setRubroGuardado(nuevo)
    setPractica(null) // the rubro change deletes the practice server-side
    refreshConfig()
    startActualizar(() => router.refresh())
  }

  const handleNegocioGuardado = () => {
    setLogoFile(null) // saved: going back and forth must not upload it again
    irA("pregunta")
  }

  const primerNombre = props.ownerNombre.trim().split(/\s+/)[0] ?? ""

  return (
    <div className="flex min-h-dvh items-start justify-center bg-gradient-to-br from-blue-50 to-indigo-50 px-4 py-6 dark:from-gray-950 dark:to-gray-900 sm:items-center sm:p-6">
      <div className="w-full max-w-2xl space-y-6">
        <PasosIndicador actual={paso} />
        <Card className="shadow-xl">
          <div
            ref={contenidoRef}
            key={paso}
            className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200 ease-snappy"
          >
            {paso === "bienvenida" && (
              <>
                <CardHeader className="pb-2 text-center">
                  <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
                    <Sparkles className="h-8 w-8 text-blue-600 dark:text-blue-400" aria-hidden="true" />
                  </div>
                  <CardTitle data-paso-titulo tabIndex={-1} className="text-2xl outline-none">
                    {primerNombre ? `¡Hola, ${primerNombre}!` : "¡Te damos la bienvenida a STApp!"}
                  </CardTitle>
                  <CardDescription className="mt-2 text-base">
                    En un par de minutos dejás tu cuenta lista y ves cómo se entera tu cliente de cada paso.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-4">
                  <Button onClick={() => irA("negocio")} className="w-full" size="lg">
                    Comenzar
                    <ChevronRight className="ml-2 h-4 w-4" aria-hidden="true" />
                  </Button>
                </CardContent>
              </>
            )}
            {paso === "negocio" && (
              <NegocioStep
                nombre={nombre}
                onNombreChange={setNombre}
                logoFile={logoFile}
                logoPreview={logoPreview}
                onLogoChange={(file, preview) => {
                  setLogoFile(file)
                  setLogoPreview(preview)
                }}
                rubro={rubro}
                rubroBloqueado={rubroBloqueado}
                onRubroGuardado={handleRubroGuardado}
                onRubroBloqueado={() => setRubroBloqueadoAhora(true)}
                actualizando={actualizando}
                onAtras={() => irA("bienvenida")}
                onGuardado={handleNegocioGuardado}
              />
            )}
            {paso === "pregunta" && (
              <PreguntaStep
                terminologia={props.terminologia}
                completando={completando}
                ordenesRealesCount={props.ordenesRealesCount}
                onSi={() => void completar("/ordenes?nueva=1", "real")}
                onPracticar={() => irA("practica")}
                onAtras={() => irA("negocio")}
              />
            )}
          </div>
        </Card>
        <div className="flex justify-center">
          <Button
            variant="ghost"
            onClick={() => void completar("/dashboard", "omitido")}
            disabled={completando}
            className="text-muted-foreground"
          >
            Omitir y entrar al panel
          </Button>
        </div>
      </div>
    </div>
  )
}

function PasosIndicador({ actual }: { actual: PasoWizard }) {
  const indiceActual = PASOS.findIndex((p) => p.key === actual)
  return (
    <ol aria-label="Pasos de la configuración" className="flex items-center justify-center">
      {PASOS.map((p, idx) => {
        const hecho = idx < indiceActual
        const esActual = idx === indiceActual
        return (
          <li key={p.key} aria-current={esActual ? "step" : undefined} className="flex items-center">
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors duration-200",
                hecho && "bg-green-500 text-white",
                esActual && "bg-blue-600 text-white",
                !hecho && !esActual && "bg-muted text-muted-foreground"
              )}
            >
              {hecho ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" /> : <span aria-hidden="true">{idx + 1}</span>}
              <span className="sr-only">
                {p.titulo}
                {hecho ? " (hecho)" : ""}
              </span>
            </span>
            {idx < PASOS.length - 1 && (
              <span aria-hidden="true" className={cn("mx-1 h-0.5 w-6 sm:w-8", hecho ? "bg-green-500" : "bg-muted")} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
