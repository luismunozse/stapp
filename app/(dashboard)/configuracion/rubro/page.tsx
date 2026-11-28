import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { canEditConfiguration } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { countRealOrders } from "@/lib/onboarding/practica"
import { getRubro } from "@/lib/rubros"
import { resolveTerminologia, t } from "@/lib/terminologia"
import { PageShell } from "@/components/ui/page-shell"
import { RubroConfig } from "@/components/configuracion/rubro-config"

// router.refresh() after a rubro change must re-read the tipos and the vocabulary.
export const dynamic = "force-dynamic"

/**
 * The always-reachable place to change the rubro. The onboarding wizard has
 * the same control, but only shows it once and only in its business step.
 */
export default async function RubroPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  if (session.user.role !== "ADMIN") redirect("/configuracion")
  if (!(await canEditConfiguration())) redirect("/configuracion")

  const organizationId = session.user.organizationId

  const [orgRes, tiposRes, ordenesReales] = await Promise.all([
    supabaseAdmin
      .from("organizations")
      .select("rubro, rubro_detalle, terminologia")
      .eq("id", organizationId)
      .single(),
    supabaseAdmin
      .from("tipos_dispositivo")
      .select("codigo, nombre")
      .eq("organization_id", organizationId)
      .eq("activo", true)
      .order("orden", { ascending: true }),
    // A failed count reads as 0, which unlocks "Cambiar": the server's 409 is the real guard.
    countRealOrders(organizationId).catch((e) => {
      console.error("[configuracion/rubro] could not count the real orders:", e)
      return 0
    }),
  ])

  if (orgRes.error || !orgRes.data) {
    throw new Error(`organizations: ${orgRes.error?.message ?? "not found"}`)
  }

  const org = orgRes.data
  const tipos = ((tiposRes.data ?? []) as Array<{ codigo: string; nombre: string }>)
    .filter((tipo) => tipo.codigo !== "TODOS")
    .map((tipo) => tipo.nombre)

  return (
    <PageShell
      title="Rubro"
      description="Qué reparás. Define tus tipos de equipo, el checklist de recepción y el vocabulario del sistema."
      backHref="/configuracion"
      backLabel="Configuración"
    >
      <RubroConfig
        // As the wizard does: an old org with no rubro reads as the genérico pack.
        rubro={getRubro(org.rubro).id}
        rubroDetalle={org.rubro_detalle ?? null}
        tipos={tiposRes.error ? null : tipos}
        equipo={t(resolveTerminologia(org.terminologia), "equipo")}
        ordenesReales={ordenesReales}
      />
    </PageShell>
  )
}
