import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id: sucursalId } = await params

    const { data: suc } = await supabaseAdmin
      .from("sucursales")
      .select("id")
      .eq("id", sucursalId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()
    if (!suc) return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 })

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 })
    }

    const result = await logoutInstance({
      baseUrl: platform.baseUrl,
      instanceName: buildSucursalInstanceName(organizationId!, sucursalId),
      apiKey: platform.apiKey,
    })

    await supabaseAdmin
      .from("sucursal_whatsapp_config")
      .update({ evolution_connection_state: "close" })
      .eq("organization_id", organizationId!)
      .eq("sucursal_id", sucursalId)

    return NextResponse.json({ success: result.success, error: result.error || null })
  } catch (err) {
    console.error("Error logout Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
