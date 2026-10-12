import { supabaseAdmin } from "@/lib/supabase"
import { getRubro } from "@/lib/rubros"
import { resolveTerminologia, type Terminologia } from "@/lib/terminologia"
import { CURRENCIES, DEFAULT_CURRENCY, type CurrencyCode } from "@/lib/currency"
import { countRealOrders, getPracticaOrden } from "@/lib/onboarding/practica"
import type { OnboardingWizardProps, TipoPractica } from "@/components/onboarding/wizard/types"

interface TipoRow {
  codigo: string
  nombre: string
  config: { marcas?: unknown; problemasComunes?: unknown } | null
}

function textos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((v): v is string => typeof v === "string" && v.trim() !== "") : []
}

/**
 * Active tipos the practice form offers, in the org's order. "TODOS" is the
 * catch-all bucket ("Todos los dispositivos"), not a device someone brings in,
 * so it is left out unless it is the only one.
 */
export function tiposParaPractica(rows: TipoRow[]): TipoPractica[] {
  const tipos = rows.map((row) => ({
    codigo: row.codigo,
    nombre: row.nombre,
    marcas: textos(row.config?.marcas),
    problemasComunes: textos(row.config?.problemasComunes),
  }))
  const sinComodin = tipos.filter((tipo) => tipo.codigo !== "TODOS")
  return sinComodin.length > 0 ? sinComodin : tipos
}

interface LoadParams {
  organizationId: string
  userId: string
  fallbackNombre: string
  fallbackEmail: string
}

/**
 * Server snapshot the onboarding wizard renders from. The rubro and the owner
 * are not in the session and not in GET /api/configuracion, so they are read
 * here. The terminology is resolved from the column already selected (same
 * logic as getTerminologia, without a second query).
 */
export async function loadOnboardingWizardProps({
  organizationId,
  userId,
  fallbackNombre,
  fallbackEmail,
}: LoadParams): Promise<OnboardingWizardProps> {
  const [orgRes, ownerRes, tiposRes, ordenesRealesCount, practica] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("nombre, nombre_mostrar, logo_url, rubro, rubro_detalle, moneda, terminologia")
      .eq("id", organizationId)
      .single(),
    supabaseAdmin.from("users").select("nombre, email").eq("id", userId).single(),
    supabaseAdmin
      .from("tipos_dispositivo")
      .select("codigo, nombre, config")
      .eq("organization_id", organizationId)
      .eq("activo", true)
      .order("orden", { ascending: true }),
    // A failed count reads as 0, which unlocks "Cambiar": the server's 409 is the real guard.
    countRealOrders(organizationId).catch((e) => {
      console.error("[onboarding] could not count the real orders:", e)
      return 0
    }),
    getPracticaOrden(organizationId).catch((e) => {
      console.error("[onboarding] could not read the practice order:", e)
      return null
    }),
  ])

  if (orgRes.error || !orgRes.data) {
    // Rendering a blank org would invite saving over real data. Throw so Next shows its
    // error boundary; a redirect to /dashboard would loop (it sends unfinished ADMINs back here).
    console.error("[onboarding] could not read the organization:", orgRes.error)
    throw new Error("Could not load the organization for onboarding")
  }
  if (ownerRes.error) console.error("[onboarding] could not read the owner:", ownerRes.error)
  if (tiposRes.error) console.error("[onboarding] could not read the tipos:", tiposRes.error)

  const org = orgRes.data
  const moneda: CurrencyCode =
    typeof org?.moneda === "string" && org.moneda in CURRENCIES ? (org.moneda as CurrencyCode) : DEFAULT_CURRENCY

  return {
    nombreNegocio: org?.nombre_mostrar || org?.nombre || "",
    logoUrl: org?.logo_url ?? null,
    rubro: getRubro(org?.rubro).id,
    rubroDetalle: org?.rubro_detalle ?? null,
    ownerNombre: ownerRes.data?.nombre || fallbackNombre,
    ownerEmail: ownerRes.data?.email || fallbackEmail,
    tipos: tiposParaPractica((tiposRes.data ?? []) as TipoRow[]),
    terminologia: resolveTerminologia((org?.terminologia ?? null) as Terminologia | null),
    moneda,
    ordenesRealesCount,
    practica,
  }
}
