import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateBorradorToken, FOTO_BORRADOR_TTL_MS } from "@/lib/foto-borrador-token"

type Ctx = { params: Promise<{ draftId: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { draftId } = await params

  const { data: borrador } = await supabaseAdmin
    .from("foto_borrador")
    .select("id")
    .eq("id", draftId)
    .eq("organization_id", organizationId!)
    .single()

  if (!borrador) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

  const { raw, hash } = generateBorradorToken()
  const expiresAt = new Date(Date.now() + FOTO_BORRADOR_TTL_MS)

  // Rota el token del mismo borrador: el anterior deja de servir en el acto,
  // y las fotos ya subidas siguen ahí.
  await supabaseAdmin
    .from("foto_borrador")
    .update({ token_hash: hash, expires_at: expiresAt.toISOString(), revoked_at: null })
    .eq("id", draftId)

  return NextResponse.json({ token: raw, expiresAt: expiresAt.toISOString() })
}
