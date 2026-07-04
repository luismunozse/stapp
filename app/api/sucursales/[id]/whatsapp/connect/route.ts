import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { createInstance, connectInstance } from "@/lib/whatsapp/providers/evolution"
import { upsertSucursalWhatsAppState } from "@/lib/whatsapp/sucursal-config"
import { supabaseAdmin } from "@/lib/supabase"

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { id: sucursalId } = await params

    const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
    if (!hasFeature) {
      return NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      )
    }

    // La sucursal debe pertenecer a la org (evita IDOR).
    const { data: suc } = await supabaseAdmin
      .from("sucursales")
      .select("id")
      .eq("id", sucursalId)
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .maybeSingle()
    if (!suc) {
      return NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 })
    }

    const platform = getPlatformEvolutionConfig()
    if (!platform) {
      return NextResponse.json(
        { error: "WhatsApp no disponible (configuración de plataforma incompleta)", code: "PLATFORM_UNCONFIGURED" },
        { status: 503 }
      )
    }

    const instanceName = buildSucursalInstanceName(organizationId!, sucursalId)
    const creds = { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey }

    const created = await createInstance(creds)
    if (!created.success) {
      return NextResponse.json({ error: `No se pudo crear instancia: ${created.error}` }, { status: 502 })
    }

    const result = await connectInstance(creds)
    await upsertSucursalWhatsAppState(organizationId!, sucursalId, instanceName, result.state, {
      qr: !!result.qrBase64,
    })

    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error connect Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
