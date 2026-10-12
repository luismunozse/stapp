import { NextResponse } from "next/server"
import { z } from "zod"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedorContacto } from "@/lib/db-utils"

const whatsappValidator = z
  .string()
  .optional()
  .refine(
    (v) => !v || /^\d{10,15}$/.test(v.replace(/\D/g, "")),
    "WhatsApp inválido: 10-15 dígitos"
  )

const contactoSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido"),
  cargo: z.string().optional(),
  telefono: z.string().optional(),
  whatsapp: whatsappValidator,
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  notas: z.string().optional(),
  principal: z.boolean().optional().default(false),
})

async function ensureProveedor(id: string, organizationId: string) {
  const { data } = await supabaseAdmin
    .from("proveedores")
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .single()
  return !!data
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Mismo eje que el resto del namespace: ver el comentario en
    // app/api/proveedores/route.ts.
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    const { data, error: dbErr } = await supabaseAdmin
      .from("proveedor_contactos")
      .select("*")
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)
      .order("principal", { ascending: false })
      .order("created_at", { ascending: true })

    if (dbErr) throw dbErr
    return NextResponse.json((data || []).map(formatProveedorContacto))
  } catch (err) {
    console.error("Error fetching contactos:", err)
    return NextResponse.json({ error: "Error al obtener contactos" }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id } = await params

    if (!(await ensureProveedor(id, organizationId!))) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 })
    }

    const body = await request.json()
    const data = contactoSchema.parse(body)

    // Si marca principal, desmarcar otros
    if (data.principal) {
      await supabaseAdmin
        .from("proveedor_contactos")
        .update({ principal: false })
        .eq("proveedor_id", id)
        .eq("organization_id", organizationId!)
    }

    const { data: created, error: dbErr } = await supabaseAdmin
      .from("proveedor_contactos")
      .insert({
        proveedor_id: id,
        organization_id: organizationId!,
        nombre: data.nombre,
        cargo: data.cargo || null,
        telefono: data.telefono || null,
        whatsapp: data.whatsapp ? data.whatsapp.replace(/\D/g, "") : null,
        email: data.email || null,
        notas: data.notas || null,
        principal: data.principal,
      })
      .select()
      .single()

    if (dbErr) throw dbErr
    return NextResponse.json(formatProveedorContacto(created), { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating contacto:", err)
    return NextResponse.json({ error: "Error al crear contacto" }, { status: 500 })
  }
}
