import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
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

  // no-store: el perfil no se cachea en ningún nivel (browser, SW, edge).
  // Si se cachea, queda servido el nombre/avatar viejo después de un update.
  return NextResponse.json(
    {
      nombre: user.nombre,
      email: user.email,
      rol: user.rol,
      hasPassword: !!user.password,
      totpEnabled: user.totp_enabled || false,
      avatarUrl: user.avatar_url || null,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  )
}

// PUT - Actualizar nombre
export async function PUT(request: Request) {
  const { error, userId } = await requireAuth()
  if (error) return error

  const parsed = await safeParseBody(request, updateSchema)
  if ("error" in parsed) return parsed.error

  const { nombre } = parsed.data

  // .select() para confirmar que efectivamente se actualizó una fila.
  // Si userId no matchea ningún registro, .single() devuelve error en vez
  // de un silent success que dejaría al cliente creyendo que guardó pero
  // sin haber escrito nada.
  const { data: updated, error: dbError } = await supabaseAdmin
    .from("users")
    .update({ nombre })
    .eq("id", userId!)
    .select("id, nombre")
    .single()

  if (dbError || !updated) {
    return NextResponse.json(
      { error: "Error al actualizar perfil" },
      { status: 500 }
    )
  }

  // Invalidar el cache server-side de Next.js para que cualquier Server
  // Component que lea session.user.name (dashboard, layout, etc.) se
  // re-renderice con el nombre nuevo. Sin esto, Next reusa el RSC payload
  // pre-renderizado con el nombre viejo.
  revalidatePath("/", "layout")

  return NextResponse.json(
    { success: true, nombre: updated.nombre },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  )
}
