import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { requireSuperadmin } from "@/lib/superadmin-auth"
import { supabaseAdmin } from "@/lib/supabase"
import { safeParseBody } from "@/lib/api-utils"
import { createSuperadminAuditLogger } from "@/lib/superadmin-audit"

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "La contraseña actual es requerida"),
    newPassword: z
      .string()
      .min(12, "La nueva contraseña debe tener al menos 12 caracteres")
      .regex(/[A-Z]/, "Debe contener al menos una mayúscula")
      .regex(/[a-z]/, "Debe contener al menos una minúscula")
      .regex(/[0-9]/, "Debe contener al menos un número")
      .regex(/[^A-Za-z0-9]/, "Debe contener al menos un carácter especial"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  })

export async function POST(request: Request) {
  try {
    const { error, email, userId } = await requireSuperadmin()
    if (error) return error

    const parsed = await safeParseBody(request, changePasswordSchema)
    if ("error" in parsed) return parsed.error

    const { currentPassword, newPassword } = parsed.data

    // Obtener usuario actual
    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, password")
      .eq("email", email)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 })
    }

    // Verificar contraseña actual
    if (!user.password) {
      return NextResponse.json(
        { error: "Este usuario usa autenticación con Google" },
        { status: 400 }
      )
    }

    const isValid = await bcrypt.compare(currentPassword, user.password)
    if (!isValid) {
      return NextResponse.json({ error: "Contraseña actual incorrecta" }, { status: 400 })
    }

    // Verificar que no sea igual a la anterior
    const isSame = await bcrypt.compare(newPassword, user.password)
    if (isSame) {
      return NextResponse.json(
        { error: "La nueva contraseña debe ser diferente a la actual" },
        { status: 400 }
      )
    }

    // Hash y guardar
    const hashedPassword = await bcrypt.hash(newPassword, 12)
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ password: hashedPassword })
      .eq("id", user.id)

    if (updateError) throw updateError

    // Audit log
    const auditLogger = createSuperadminAuditLogger(email, request)
    auditLogger
      .log({
        userId: user.id,
        action: "UPDATE",
        entity: "users",
        entityId: user.id,
        description: "Contraseña de superadmin cambiada",
      })
      .catch(() => {})

    return NextResponse.json({ success: true, message: "Contraseña actualizada correctamente" })
  } catch (err) {
    console.error("Error changing password:", err)
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 })
  }
}
