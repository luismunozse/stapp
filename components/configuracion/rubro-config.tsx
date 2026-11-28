"use client"

import { useState, useTransition, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { RubroSelector } from "@/components/onboarding/wizard/rubro-selector"
import type { RubroVigente } from "@/components/onboarding/wizard/types"
import { useCurrency } from "@/contexts/currency-context"
import { CONTACT_EMAIL } from "@/lib/contact"

interface RubroConfigProps {
  rubro: string
  rubroDetalle: string | null
  /** Names of the active tipos, as GET /api/tipos-dispositivo lists them. null when they could not be read. */
  tipos: string[] | null
  /** The org's word for what it repairs ("Equipo", "Artefacto", "Vehículo"…). */
  equipo: string
  ordenesReales: number
}

/**
 * Configuración → Rubro: what the rubro set up, and the change itself (the
 * wizard's RubroSelector, so both places share one tested flow and one route).
 */
export function RubroConfig({ rubro, rubroDetalle, tipos, equipo, ordenesReales }: RubroConfigProps) {
  const router = useRouter()
  const { refreshConfig } = useCurrency()
  // The props are a server snapshot: a rubro saved here wins until
  // router.refresh() brings the next one (new tipos and vocabulary).
  const [rubroGuardado, setRubroGuardado] = useState<RubroVigente | null>(null)
  const [bloqueadoAhora, setBloqueadoAhora] = useState(false)
  const [actualizando, startActualizar] = useTransition()
  const vigente = rubroGuardado ?? { rubro, rubroDetalle }

  const handleGuardado = (nuevo: RubroVigente) => {
    setRubroGuardado(nuevo)
    refreshConfig()
    startActualizar(() => router.refresh())
  }

  // A 409 means real orders exist even if this snapshot said 0: re-read the count.
  const handleBloqueado = () => {
    setBloqueadoAhora(true)
    startActualizar(() => router.refresh())
  }

  return (
    <div className="max-w-2xl space-y-8">
      <section aria-labelledby="rubro-actual-titulo" className="space-y-3">
        <h2 id="rubro-actual-titulo" className="text-base font-semibold">
          Tu rubro
        </h2>
        <RubroSelector
          rubro={vigente.rubro}
          rubroDetalle={vigente.rubroDetalle}
          bloqueado={ordenesReales > 0 || bloqueadoAhora}
          deshabilitado={actualizando}
          onGuardado={handleGuardado}
          onBloqueado={handleBloqueado}
          motivoBloqueo={<MotivoBloqueo ordenesReales={ordenesReales} />}
        />
      </section>

      <section aria-labelledby="rubro-prepara-titulo" aria-busy={actualizando} className="space-y-3">
        <div className="space-y-1">
          <h2 id="rubro-prepara-titulo" className="text-base font-semibold">
            Lo que preparó tu rubro
          </h2>
          <p className="text-sm text-muted-foreground">
            {actualizando
              ? "Actualizando…"
              : "Si algo no encaja con tu taller, ajustalo acá sin cambiar de rubro."}
          </p>
        </div>
        <ul className="divide-y rounded-lg border">
          <Fila href="/configuracion/tipos-dispositivo" titulo="Tipos de equipo">
            {tipos === null
              ? "No pudimos leerlos. Abrí la sección para verlos."
              : tipos.length === 0
                ? "Todavía no tenés tipos activos."
                : tipos.join(", ")}
          </Fila>
          <Fila href="/configuracion/checklist" titulo="Checklist de recepción">
            Lo que revisás cuando entra cada tipo de equipo.
          </Fila>
          <Fila href="/configuracion/vocabulario" titulo="Vocabulario">
            El sistema dice “{equipo}” a lo que reparás.
          </Fila>
        </ul>
      </section>
    </div>
  )
}

function MotivoBloqueo({ ordenesReales }: { ordenesReales: number }) {
  const cuantas =
    ordenesReales === 1
      ? "Tenés 1 orden cargada"
      : ordenesReales > 1
        ? `Tenés ${ordenesReales} órdenes cargadas`
        : "Ya cargaste órdenes"
  return (
    <>
      {cuantas}, así que el rubro queda como está. Si eran de prueba, eliminalas desde{" "}
      <Link href="/ordenes" className="font-medium text-primary underline underline-offset-2">
        Órdenes
      </Link>{" "}
      y lo vas a poder cambiar. Si son trabajos reales, escribinos a{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary underline underline-offset-2">
        {CONTACT_EMAIL}
      </a>{" "}
      y lo vemos con vos.
    </>
  )
}

function Fila({ href, titulo, children }: { href: string; titulo: string; children: ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{titulo}</span>
          <span className="block text-sm text-muted-foreground">{children}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}
