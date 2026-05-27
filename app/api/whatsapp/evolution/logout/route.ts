import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { decrypt } from "@/lib/whatsapp/encryption"
import { logoutInstance } from "@/lib/whatsapp/providers/evolution"

export async function POST() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data: config } = await supabaseAdmin
      .from("whatsapp_config")
      .select("provider, evolution_base_url, evolution_instance_name, evolution_api_key_encrypted")
      .eq("organization_id", organizationId!)
      .single()

    if (!config || config.provider !== "evolution") {
      return NextResponse.json({ error: "Provider Evolution no configurado" }, { status: 400 })
    }
    if (!config.evolution_base_url || !config.evolution_instance_name || !config.evolution_api_key_encrypted) {
      return NextResponse.json({ error: "Credenciales Evolution incompletas" }, { status: 400 })
    }

    const result = await logoutInstance({
      baseUrl: config.evolution_base_url,
      instanceName: config.evolution_instance_name,
      apiKey: decrypt(config.evolution_api_key_encrypted),
    })

    await supabaseAdmin
      .from("whatsapp_config")
      .update({
        evolution_connection_state: "close",
        is_verified: false,
      })
      .eq("organization_id", organizationId!)

    return NextResponse.json({ success: result.success, error: result.error || null })
  } catch (err) {
    console.error("Error logout Evolution:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
