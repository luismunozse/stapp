import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { registrarCamino } from "@/lib/onboarding/practica"

// "practica" is not accepted here: only the practice POST sets it.
const completeSchema = z.object({
  camino: z.enum(["real", "omitido"]).optional(),
})

async function leerCuerpo(request: Request): Promise<unknown> {
  const raw = await request.text()
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const parsed = completeSchema.safeParse(await leerCuerpo(request))
    if (!parsed.success) {
      return NextResponse.json({ error: "Camino inválido" }, { status: 400 })
    }

    // The onboarding_progress row may be missing (signup creates it best-effort
    // and the new wizard no longer fetches progress on mount). registrarCamino
    // goes through registrar_camino_onboarding: one upsert by organization_id
    // that creates the row when missing, lets "omitido" only fill an empty
    // camino, and never overwrites "practica". It runs BEFORE the completed_at
    // UPDATE below, which matches 0 rows if the row does not exist yet. The
    // camino is metric data: registrarCamino logs failures and never throws, so
    // the completion is never blocked.
    if (parsed.data.camino) await registrarCamino(organizationId!, parsed.data.camino)

    // Marcar onboarding como completado
    await supabaseAdmin
      .from("organizations")
      .update({ onboarding_completed: true })
      .eq("id", organizationId!)

    await supabaseAdmin
      .from("onboarding_progress")
      .update({ completed_at: new Date().toISOString() })
      .eq("organization_id", organizationId!)

    return NextResponse.json({ message: "Onboarding completado" })
  } catch (err) {
    console.error("Error completing onboarding:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
