import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

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
