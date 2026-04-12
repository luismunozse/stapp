import { NextResponse } from "next/server"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { revalidateTag } from "next/cache"
import { z } from "zod"

const updateSchema = z.object({
  active: z.boolean(),
  message: z.string().max(500),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
})

export async function GET() {
  const { error } = await requireSuperadmin()
  if (error) return error

  const { data, error: dbError } = await supabaseAdmin
    .from("maintenance_banner")
    .select("*")
    .eq("id", "global")
    .maybeSingle()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  return NextResponse.json(
    data || { id: "global", active: false, message: "", severity: "INFO", updated_at: null, updated_by: null }
  )
}

export async function PUT(request: Request) {
  const { error, email } = await requireSuperadmin()
  if (error) return error

  const body = await request.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos inválidos", issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const { active, message, severity } = parsed.data

  if (active && !message.trim()) {
    return NextResponse.json(
      { error: "El mensaje no puede estar vacío cuando el banner está activo" },
      { status: 400 }
    )
  }

  const { data, error: dbError } = await supabaseAdmin
    .from("maintenance_banner")
    .upsert({
      id: "global",
      active,
      message,
      severity,
      updated_at: new Date().toISOString(),
      updated_by: email,
    })
    .select()
    .single()

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 500 })
  }

  // Invalidar cache del layout dashboard para que los cambios se vean inmediatamente
  revalidateTag("maintenance-banner")

  return NextResponse.json(data)
}
