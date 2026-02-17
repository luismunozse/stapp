import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase"
import { APP_VERSION } from "@/lib/changelog"

export async function POST(req: NextRequest) {
  try {
    const session = await auth()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 401 }
      )
    }

    const { error } = await supabaseAdmin
      .from("users")
      .update({ last_seen_version: APP_VERSION })
      .eq("id", session.user.id)

    if (error) {
      console.error("[seen-version] Error actualizando versión:", error)
      return NextResponse.json(
        { error: "Error actualizando versión" },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, version: APP_VERSION })
  } catch (error) {
    console.error("[seen-version] Error:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}
