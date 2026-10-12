import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { GRACE_DAYS } from "@/lib/account-deletion/state"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const NO_STORE = { "Cache-Control": "no-store" }

// GET /api/account/deletion-info: lo que la Zona de peligro necesita saber.
// /api/users/profile no trae el slug ni si el usuario es el último ADMIN.
export async function GET() {
  const { error, userId, organizationId, role } = await requireAuth()
  if (error) return error

  const [userRes, orgRes, otrosRes] = await Promise.all([
    supabaseAdmin.from("users").select("password, totp_enabled").eq("id", userId!).single(),
    supabaseAdmin.from("organizations").select("slug, nombre").eq("id", organizationId!).single(),
    // Misma definición de "otro ADMIN" que la guarda SQL solicitar_baja_usuario
    // (migración 338): mismo taller, rol ADMIN, deleted_at IS NULL, distinto del usuario.
    role === "ADMIN"
      ? supabaseAdmin
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("rol", "ADMIN")
          .is("deleted_at", null)
          .neq("id", userId!)
      : Promise.resolve(null),
  ])

  // Nunca adivinar: un error de lectura no puede convertirse en isLastAdmin true/false.
  if (userRes.error || orgRes.error || otrosRes?.error) {
    console.error("[account/deletion-info]", userRes.error ?? orgRes.error ?? otrosRes?.error)
    return NextResponse.json({ error: "No pudimos leer los datos de tu cuenta" }, { status: 500, headers: NO_STORE })
  }

  const user = userRes.data
  const org = orgRes.data
  if (!user || !org) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404, headers: NO_STORE })
  }

  const info: DeletionInfo = {
    role: role as DeletionInfo["role"],
    slug: org.slug,
    orgName: org.nombre,
    isLastAdmin: role === "ADMIN" && (otrosRes?.count ?? 0) === 0,
    hasPassword: !!user.password,
    totpEnabled: !!user.totp_enabled,
    graceDays: GRACE_DAYS,
  }
  return NextResponse.json(info, { headers: NO_STORE })
}
