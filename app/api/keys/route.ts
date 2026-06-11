import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { generateApiKey } from "@/lib/api-keys"
import { z } from "zod"

const createSchema = z.object({ name: z.string().min(1, "El nombre es requerido") })

export async function GET() {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const { data, error: dbError } = await supabaseAdmin
      .from("api_keys")
      .select("id, name, prefix, last_used_at, activo, created_at, revoked_at")
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })
    if (dbError) throw dbError
    return NextResponse.json({ data: data || [] })
  } catch (e) {
    console.error("Error listing api keys:", e)
    return NextResponse.json({ error: "Error al listar API keys" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error
    const body = await request.json()
    const { name } = createSchema.parse(body)
    const { raw, hash, prefix } = generateApiKey()
    const { data, error: dbError } = await supabaseAdmin
      .from("api_keys")
      .insert({ organization_id: organizationId!, name, key_hash: hash, prefix })
      .select("id, name, prefix, created_at")
      .single()
    if (dbError) throw dbError
    return NextResponse.json({ ...data, key: raw }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    }
    console.error("Error creating api key:", e)
    return NextResponse.json({ error: "Error al crear API key" }, { status: 500 })
  }
}
