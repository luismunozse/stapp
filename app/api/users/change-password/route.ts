import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { z } from "zod"
import bcrypt from "bcryptjs"

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Ingrese su contraseña actual"),
    newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  })

export async function POST(request: Request) {
  const { error, userId } = await requireAuth()
  if (error) return error

  const parsed = await safeParseBody(request, changePasswordSchema)
  if ("error" in parsed) return parsed.error

  const { currentPassword, newPassword } = parsed.data

  // Obtener usuario
  const { data: user, error: dbError } = await supabaseAdmin
    .from("users")
    .select("password")
    .eq("id", userId!)
    .single()

  if (dbError || !user) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
  }

  // Verificar que tiene password (no es Google auth)
  if (!user.password) {
    return NextResponse.json(
      { error: "Esta cuenta usa autenticacion con Google. La contraseña se gestiona desde tu cuenta de Google." },
      { status: 400 }
    )
  }

  // Verificar contraseña actual
  const isValid = await bcrypt.compare(currentPassword, user.password)
  if (!isValid) {
    return NextResponse.json({ error: "La contraseña actual es incorrecta" }, { status: 400 })
  }

  // Verificar que no sea la misma
  const isSame = await bcrypt.compare(newPassword, user.password)
  if (isSame) {
    return NextResponse.json({ error: "La nueva contraseña debe ser diferente a la actual" }, { status: 400 })
  }

  // Hashear y guardar
  const hashedPassword = await bcrypt.hash(newPassword, 12)
  await supabaseAdmin
    .from("users")
    .update({ password: hashedPassword })
    .eq("id", userId!)

  return NextResponse.json({ success: true })
}
