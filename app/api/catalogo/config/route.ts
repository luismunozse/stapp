import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAuth, requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const slugRegex = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/

const trustBadgeIcons = [
  "truck", "shield", "undo", "card", "clock",
  "star", "check", "phone", "map",
] as const

const trustBadgeSchema = z.object({
  icon: z.enum(trustBadgeIcons),
  label: z.string().min(1).max(30),
})

const upsertSchema = z.object({
  slug: z.string().regex(slugRegex, "Slug inválido (a-z, 0-9, guiones)").optional(),
  titulo: z.string().max(120).nullable().optional(),
  descripcion: z.string().max(500).nullable().optional(),
  color_primary: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color hex inválido").nullable().optional(),
  whatsapp: z.string().max(30).nullable().optional(),
  banner_url: z.string().url().nullable().optional(),
  trust_badges: z.array(trustBadgeSchema).max(6).optional(),
  activo: z.boolean().optional(),
})

function normalizarSlug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "catalogo"
}

async function generarSlugUnico(base: string): Promise<string> {
  let candidato = base
  let n = 0
  while (true) {
    const { data } = await supabaseAdmin
      .from("catalogo_config")
      .select("id")
      .eq("slug", candidato)
      .maybeSingle()
    if (!data) return candidato
    n += 1
    candidato = `${base}-${n}`
  }
}

export async function GET() {
  const auth = await requireAuth()
  if (auth.error) return auth.error
  const { organizationId } = auth

  const { data: existing, error } = await supabaseAdmin
    .from("catalogo_config")
    .select("*")
    .eq("organization_id", organizationId!)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (existing) {
    const url = `${process.env.NEXT_PUBLIC_APP_URL || ""}/catalogo/${existing.slug}`
    return NextResponse.json({ config: existing, url })
  }

  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("id, nombre, slug, nombre_mostrar")
    .eq("id", organizationId!)
    .single()

  const base = normalizarSlug(org?.slug || org?.nombre || "catalogo")
  const slug = await generarSlugUnico(base)

  const { data: created, error: errCreate } = await supabaseAdmin
    .from("catalogo_config")
    .insert({
      organization_id: organizationId!,
      slug,
      titulo: org?.nombre_mostrar || org?.nombre || null,
      activo: false,
    })
    .select("*")
    .single()

  if (errCreate) return NextResponse.json({ error: errCreate.message }, { status: 500 })

  const url = `${process.env.NEXT_PUBLIC_APP_URL || ""}/catalogo/${created.slug}`
  return NextResponse.json({ config: created, url })
}

export async function PUT(req: Request) {
  const auth = await requireAdmin()
  if (auth.error) return auth.error
  const { organizationId } = auth

  const body = await req.json()
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos", details: parsed.error.flatten() }, { status: 400 })
  }

  const updates: Record<string, unknown> = { ...parsed.data }

  if (parsed.data.slug) {
    const { data: clash } = await supabaseAdmin
      .from("catalogo_config")
      .select("id, organization_id")
      .eq("slug", parsed.data.slug)
      .maybeSingle()
    if (clash && clash.organization_id !== organizationId) {
      return NextResponse.json({ error: "Slug ya en uso" }, { status: 409 })
    }
  }

  const { data, error } = await supabaseAdmin
    .from("catalogo_config")
    .update(updates)
    .eq("organization_id", organizationId!)
    .select("*")
    .single()

  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "Slug ya en uso" }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  revalidateTag("catalogo", "max")

  const url = `${process.env.NEXT_PUBLIC_APP_URL || ""}/catalogo/${data.slug}`
  return NextResponse.json({ config: data, url })
}
