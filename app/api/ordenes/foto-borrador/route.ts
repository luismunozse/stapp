import { NextResponse } from "next/server"
import { requireAuth, canCreateOrders } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import {
  generateBorradorToken,
  FOTO_BORRADOR_TTL_MS,
  MAX_BORRADORES_ACTIVOS,
} from "@/lib/foto-borrador-token"

export async function POST() {
  const { error, organizationId, userId, role } = await requireAuth()
  if (error) return error

  if (!canCreateOrders(role)) {
    return NextResponse.json({ error: "Acceso denegado" }, { status: 403 })
  }

  const ahora = new Date()

  // Tope de borradores activos por usuario: evita que alguien farmee tokens.
  const { count } = await supabaseAdmin
    .from("foto_borrador")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .gt("expires_at", ahora.toISOString())

  if ((count ?? 0) >= MAX_BORRADORES_ACTIVOS) {
    return NextResponse.json(
      { error: "Demasiados códigos activos. Cerrá alguno antes de pedir otro." },
      { status: 429 },
    )
  }

  const { raw, hash } = generateBorradorToken()
  const expiresAt = new Date(ahora.getTime() + FOTO_BORRADOR_TTL_MS)

  const { data, error: dbError } = await supabaseAdmin
    .from("foto_borrador")
    .insert({
      organization_id: organizationId,
      user_id: userId,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single()

  if (dbError || !data) {
    return NextResponse.json({ error: "No se pudo generar el código" }, { status: 500 })
  }

  // El crudo se devuelve una única vez, para el QR. No queda persistido.
  return NextResponse.json(
    { draftId: data.id, token: raw, expiresAt: expiresAt.toISOString() },
    { status: 201 },
  )
}
