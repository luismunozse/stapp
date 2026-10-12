import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { hasPlanFeature } from "@/lib/subscriptions"
import { getPlatformEvolutionConfig, buildSucursalInstanceName } from "@/lib/whatsapp/platform-config"
import { connectInstance, getConnectionState } from "@/lib/whatsapp/providers/evolution"
import { updateSucursalWhatsAppState } from "@/lib/whatsapp/sucursal-config"

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
  return { organizationId: organizationId!, creds: { baseUrl: platform.baseUrl, instanceName, apiKey: platform.apiKey } }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guard(id)
    if (g.error) return g.error
    const result = await connectInstance(g.creds!)
    // Update-only: crear filas es trabajo exclusivo del POST /connect.
    await updateSucursalWhatsAppState(g.organizationId!, id, result.state, { qr: !!result.qrBase64 })
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

/**
 * Poll de estado. Con `?refresh=1` devuelve ademas un QR nuevo: los QR de
 * Baileys vencen en segundos y Evolution los rota, asi que dejar fijo el
 * primero hace que la sucursal escanee un codigo muerto. Sigue usando
 * `updateSucursalWhatsAppState` (nunca upsert): pollear no debe crear filas.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await guard(id)
    if (g.error) return g.error
    const state = await getConnectionState(g.creds!)
    await updateSucursalWhatsAppState(g.organizationId!, id, state.state)

    const wantsQr = new URL(req.url).searchParams.get("refresh") === "1"
    if (!wantsQr || state.state === "open") {
      return NextResponse.json({ state: state.state, qrBase64: null, error: state.error || null })
    }

    const refreshed = await connectInstance(g.creds!)
    await updateSucursalWhatsAppState(g.organizationId!, id, refreshed.state)

    return NextResponse.json({
      state: refreshed.state,
      qrBase64: refreshed.qrBase64 || null,
      error: refreshed.error || null,
    })
  } catch (err) {
    console.error("Error poll Evolution sucursal:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
