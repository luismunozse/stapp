import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"

const BUCKET = "foto-borrador"

type Ctx = { params: Promise<{ draftId: string }> }

async function findBorrador(draftId: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("foto_borrador")
    .select("id")
    .eq("id", draftId)
    .eq("organization_id", organizationId)
    .single()
  return data
}

export async function GET(_req: Request, { params }: Ctx) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { draftId } = await params
  const borrador = await findBorrador(draftId, organizationId!)
  if (!borrador) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

  const { data: rows } = await supabaseAdmin
    .from("foto_borrador_item")
    .select("id, storage_path, mime")
    .eq("borrador_id", draftId)
    .order("created_at", { ascending: true })

  // Se devuelve base64, no URL: el objeto vive en un bucket privado y nunca
  // queda alcanzable desde afuera.
  const items: { id: string; mime: string; data: string }[] = []
  for (const row of rows ?? []) {
    const { data: blob } = await supabaseAdmin.storage.from(BUCKET).download(row.storage_path)
    if (!blob) continue
    const buffer = Buffer.from(await blob.arrayBuffer())
    items.push({ id: row.id, mime: row.mime, data: buffer.toString("base64") })
  }

  return NextResponse.json({ items })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { error, organizationId } = await requireAuth()
  if (error) return error

  const { draftId } = await params
  const borrador = await findBorrador(draftId, organizationId!)
  if (!borrador) return NextResponse.json({ error: "No encontrado" }, { status: 404 })

  const { data: rows } = await supabaseAdmin
    .from("foto_borrador_item")
    .select("storage_path")
    .eq("borrador_id", draftId)

  const paths = (rows ?? []).map((r) => r.storage_path)
  if (paths.length > 0) {
    await supabaseAdmin.storage.from(BUCKET).remove(paths)
  }

  // El cascade de la FK se lleva los items.
  await supabaseAdmin.from("foto_borrador").delete().eq("id", draftId)

  return NextResponse.json({ ok: true })
}
