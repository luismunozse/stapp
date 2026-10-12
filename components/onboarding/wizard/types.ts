import type { CurrencyCode } from "@/lib/currency"
import type { Terminologia } from "@/lib/terminologia"
import type { PracticaOrden } from "@/lib/onboarding/practica-shared"

/** A device type the practice form offers. Built server-side from tipos_dispositivo. */
export interface TipoPractica {
  codigo: string
  nombre: string
  marcas: string[]
  problemasComunes: string[]
}

export interface RubroVigente {
  rubro: string
  rubroDetalle: string | null
}

/** Sent to POST /api/onboarding/complete. The practice path is recorded by the practice POST. */
export type CaminoCompletar = "real" | "omitido"

export type PasoWizard = "bienvenida" | "negocio" | "pregunta" | "practica" | "listo"

export type SubPasoPractica = "recibir" | "reparar" | "entregar" | "terminada"

/** Built by app/(dashboard)/onboarding/wizard-props.ts; tests build it with a fixture. */
export interface OnboardingWizardProps {
  nombreNegocio: string
  logoUrl: string | null
  rubro: string
  rubroDetalle: string | null
  ownerNombre: string
  ownerEmail: string
  tipos: TipoPractica[]
  terminologia: Terminologia
  moneda: CurrencyCode
  ordenesRealesCount: number
  practica: PracticaOrden | null
}
