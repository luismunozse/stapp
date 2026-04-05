import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { z } from "zod"

const updateSchema = z.object({
  nombre: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(100, "El nombre no puede exceder 100 caracteres"),
})

// GET - Obtener datos del perfil
export async function GET() {
  const { error, userId } = await requireAuth()
  if (error) return error

  const { data: user, error: dbError } = await supabaseAdmin
    .from("users")
    .select("nombre, email, rol, password, totp_enabled, avatar_url")
    .eq("id", userId!)
    .single()

  if (dbError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  return NextResponse.json({
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    hasPassword: !!user.password,
    totpEnabled: user.totp_enabled || false,
    avatarUrl: user.avatar_url || null,
  })
}

// PUT - Actualizar nombre
export async function PUT(request: Request) {
  const { error, userId } = await requireAuth()
  if (error) return error

  const parsed = await safeParseBody(request, updateSchema)
  if ("error" in parsed) return parsed.error

  const { nombre } = parsed.data

  const { error: dbError } = await supabaseAdmin
    .from("users")
    .update({ nombre })
    .eq("id", userId!)

  if (dbError) {
    return NextResponse.json({ error: "Error al actualizar perfil" }, { status: 500 })
  }

  return NextResponse.json({ success: true, nombre })
}
