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

const updateSchema = z.object({
  nombre: z.string().min(1).optional(),
  cargo: z.string().optional(),
  telefono: z.string().optional(),
  whatsapp: whatsappValidator,
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  notas: z.string().optional(),
  principal: z.boolean().optional(),
})

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; contactoId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id, contactoId } = await params

    const body = await request.json()
    const data = updateSchema.parse(body)

    if (data.principal === true) {
      await supabaseAdmin
        .from("proveedor_contactos")
        .update({ principal: false })
        .eq("proveedor_id", id)
        .eq("organization_id", organizationId!)
        .neq("id", contactoId)
    }

    const update: Record<string, any> = {}
    if (data.nombre !== undefined) update.nombre = data.nombre
    if (data.cargo !== undefined) update.cargo = data.cargo || null
    if (data.telefono !== undefined) update.telefono = data.telefono || null
    if (data.whatsapp !== undefined) update.whatsapp = data.whatsapp ? data.whatsapp.replace(/\D/g, "") : null
    if (data.email !== undefined) update.email = data.email || null
    if (data.notas !== undefined) update.notas = data.notas || null
    if (data.principal !== undefined) update.principal = data.principal

    const { data: updated, error: dbErr } = await supabaseAdmin
      .from("proveedor_contactos")
      .update(update)
      .eq("id", contactoId)
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (dbErr || !updated) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 })
    }
    return NextResponse.json(formatProveedorContacto(updated))
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error updating contacto:", err)
    return NextResponse.json({ error: "Error al actualizar contacto" }, { status: 500 })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; contactoId: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error
    const { id, contactoId } = await params

    const { error: dbErr } = await supabaseAdmin
      .from("proveedor_contactos")
      .delete()
      .eq("id", contactoId)
      .eq("proveedor_id", id)
      .eq("organization_id", organizationId!)

    if (dbErr) throw dbErr
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("Error deleting contacto:", err)
    return NextResponse.json({ error: "Error al eliminar contacto" }, { status: 500 })
  }
}
