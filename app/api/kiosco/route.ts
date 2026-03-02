import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { isPremium } from "@/lib/subscriptions"

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { data } = await supabaseAdmin
      .from("kiosk_tokens")
      .select("*")
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    return NextResponse.json(data || [])
  } catch (err) {
    console.error("Error fetching kiosk tokens:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const premium = await isPremium(organizationId!)
    if (!premium) {
      return NextResponse.json({ error: "Requiere plan Premium", code: "PREMIUM_REQUIRED" }, { status: 403 })
    }

    const body = await request.json()

    const { data, error: dbError } = await supabaseAdmin
      .from("kiosk_tokens")
      .insert({
        organization_id: organizationId!,
        name: body.name || "Pantalla Principal",
        config: body.config || {
          columns: ["numero_orden", "dispositivo", "estado", "cliente"],
          filter_estados: [],
          auto_refresh_seconds: 30,
          show_branding: true,
          font_size: "large",
        },
      })
      .select()
      .single()

    if (dbError) throw dbError

    return NextResponse.json(data, { status: 201 })
  } catch (err) {
    console.error("Error creating kiosk token:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
