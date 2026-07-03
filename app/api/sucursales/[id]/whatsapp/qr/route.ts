import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { connectInstance, getConnectionState } from "@/lib/whatsapp/providers/evolution"
import { upsertSucursalWhatsAppState } from "@/lib/whatsapp/sucursal-config"

async function guard(sucursalId: string) {
  const { error, organizationId } = await requireAdmin()
  if (error) return { error }
  const hasFeature = await hasPlanFeature(organizationId!, "whatsapp_notifications")
  if (!hasFeature) {
    return {
      error: NextResponse.json(
        { error: "Requiere plan Profesional", code: "FEATURE_REQUIRED", feature: "whatsapp_notifications" },
        { status: 403 }
      ),
    }
  }
  const { data: suc } = await supabaseAdmin
    .from("sucursales")
    .select("id")
    .eq("id", sucursalId)
    .eq("organization_id", organizationId!)
    .is("deleted_at", null)
    .maybeSingle()
  if (!suc) return { error: NextResponse.json({ error: "Sucursal no encontrada" }, { status: 404 }) }
  const platform = getPlatformEvolutionConfig()
  if (!platform) {
    return {
      error: NextResponse.json({ error: "WhatsApp no disponible (plataforma)", code: "PLATFORM_UNCONFIGURED" }, { status: 503 }),
    }
  }
  const instanceName = buildSucursalInstanceName(organizationId!, sucursalId)
  return { organizationId: organizationId!, creds: { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey }, instanceName }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guard(id)
    if (g.error) return g.error
    const result = await connectInstance(g.creds!)
    await upsertSucursalWhatsAppState(g.organizationId!, id, g.instanceName!, result.state, { qr: !!result.qrBase64 })
    return NextResponse.json({
      state: result.state,
      qrBase64: result.qrBase64 || null,
      pairingCode: result.pairingCode || null,
      error: result.error || null,
    })
  } catch (err) {
    console.error("Error QR Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guard(id)
    if (g.error) return g.error
    const state = await getConnectionState(g.creds!)
    await upsertSucursalWhatsAppState(g.organizationId!, id, g.instanceName!, state.state)
    return NextResponse.json({ state: state.state, error: state.error || null })
  } catch (err) {
    console.error("Error poll Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
