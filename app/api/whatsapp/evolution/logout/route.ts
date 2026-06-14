import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformEvolutionConfig, buildInstanceName } from "@/lib/whatsapp/platform-config"
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"

export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const result = await logoutInstance({
      baseUrl: platform.baseUrl,
      instanceName: buildInstanceName(organizationId!),
      apiKey: platform.apiKey,
    })

    await supabaseAdmin
      .from("whatsapp_config")
      .update({ evolution_connection_state: "close", is_verified: false })
      .eq("organization_id", organizationId!)

    await supabaseAdmin
      .from("organizations")
      .update({ notificaciones_whatsapp: false })
      .eq("id", organizationId!)

    return NextResponse.json({ success: result.success, error: result.error || null })
  } catch (err) {
    console.error("Error logout Evolution:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
