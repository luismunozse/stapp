import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

// Registrar o actualizar push token
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAuth()
    if (error) return error

    const { token, platform } = await request.json()

    if (!token) {
      return NextResponse.json({ error: "Token requerido" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("push_tokens")
      .upsert(
        {
          user_id: userId!,
          organization_id: organizationId!,
          token,
          platform: platform || "android",
          active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,token" }
      )

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error registering push token:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}

// Desregistrar push token
export async function DELETE(request: Request) {
  try {
    const { error, userId } = await requireAuth()
    if (error) return error

    const { token } = await request.json()

    if (!token) {
      return NextResponse.json({ error: "Token requerido" }, { status: 400 })
    }

    const { error: dbError } = await supabaseAdmin
      .from("push_tokens")
      .update({ active: false })
      .eq("user_id", userId!)
      .eq("token", token)

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error unregistering push token:", err)
    return NextResponse.json({ error: "Error interno" }, { status: 500 })
  }
}
