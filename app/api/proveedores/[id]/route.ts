import { NextResponse } from "next/server"
import { requireAuth, requireAdmin, requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedor } from "@/lib/db-utils"
import { z } from "zod"

const CONDICION_IVA = [
  "RESPONSABLE_INSCRIPTO",
  "MONOTRIBUTO",
  "EXENTO",
  "NO_RESPONSABLE",
  "CONSUMIDOR_FINAL",
] as const

const CONDICION_PAGO = ["CONTADO", "CTA_CTE", "TRANSFERENCIA", "CHEQUE", "OTRO"] as const

const whatsappValidator = z
  .string()
  .optional()
  .refine(
    (v) => !v || /^\d{10,15}$/.test(v.replace(/\D/g, "")),
    "WhatsApp inválido: 10-15 dígitos"
  )

const proveedorUpdateSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido").optional(),
  telefono: z.string().optional(),
  whatsapp: whatsappValidator,
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  notas: z.string().optional(),
  activo: z.boolean().optional(),
  razonSocial: z.string().optional(),
  cuit: z.string().optional(),
  condicionIva: z.enum(CONDICION_IVA).optional().or(z.literal("")),
  ingresosBrutos: z.string().optional(),
  condicionPago: z.enum(CONDICION_PAGO).optional().or(z.literal("")),
  diasPago: z.number().int().min(0).max(365).optional().nullable(),
  leadTimeDias: z.number().int().min(0).max(365).optional().nullable(),
  pedidoMinimo: z.number().min(0).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().nullable(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: proveedor, error: dbError } = await supabaseAdmin
      .from("proveedores")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !proveedor) {
      return NextResponse.json(
        { error: "Proveedor no encontrado" },
        { status: 404 }
      )
    }

    return NextResponse.json(formatProveedor(proveedor))
  } catch (error) {
    console.error("Error fetching proveedor:", error)
    return NextResponse.json(
      { error: "Error al obtener proveedor" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = proveedorUpdateSchema.parse(body)

    // Verificar que el proveedor pertenece a la organización
    const { data: existingProveedor, error: fetchError } = await supabaseAdmin
      .from("proveedores")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existingProveedor) {
      return NextResponse.json(
        { error: "Proveedor no encontrado" },
        { status: 404 }
      )
    }

    // Preparar datos
    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.telefono !== undefined) updateData.telefono = data.telefono || null
    if (data.whatsapp !== undefined) updateData.whatsapp = data.whatsapp ? data.whatsapp.replace(/\D/g, "") : null
    if (data.email !== undefined) updateData.email = data.email || null
    if (data.direccion !== undefined) updateData.direccion = data.direccion || null
    if (data.website !== undefined) updateData.website = data.website || null
    if (data.notas !== undefined) updateData.notas = data.notas || null
    if (data.activo !== undefined) updateData.activo = data.activo
    if (data.razonSocial !== undefined) updateData.razon_social = data.razonSocial || null
    if (data.cuit !== undefined) updateData.cuit = data.cuit || null
    if (data.condicionIva !== undefined) updateData.condicion_iva = data.condicionIva || null
    if (data.ingresosBrutos !== undefined) updateData.ingresos_brutos = data.ingresosBrutos || null
    if (data.condicionPago !== undefined) updateData.condicion_pago = data.condicionPago || null
    if (data.diasPago !== undefined) updateData.dias_pago = data.diasPago ?? null
    if (data.leadTimeDias !== undefined) updateData.lead_time_dias = data.leadTimeDias ?? null
    if (data.pedidoMinimo !== undefined) updateData.pedido_minimo = data.pedidoMinimo ?? null
    if (data.rating !== undefined) updateData.rating = data.rating ?? null
    if (data.tags !== undefined) updateData.tags = data.tags && data.tags.length > 0 ? data.tags : null

    const { data: proveedor, error: updateError } = await supabaseAdmin
      .from("proveedores")
      .update(updateData)
      .eq("id", id)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(formatProveedor(proveedor))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating proveedor:", error)
    return NextResponse.json(
      { error: "Error al actualizar proveedor" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const url = new URL(request.url)
    const force = url.searchParams.get("force") === "1"

    // Verificar que el proveedor pertenece a la organización
    const { data: existingProveedor, error: fetchError } = await supabaseAdmin
      .from("proveedores")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existingProveedor) {
      return NextResponse.json(
        { error: "Proveedor no encontrado" },
        { status: 404 }
      )
    }

    // Bloquear hard delete si tiene referencias salvo force=1.
    // Inventario tiene ON DELETE SET NULL en proveedor_id, pero igual avisamos.
    // Órdenes de compra: ON DELETE SET NULL. Avisamos también.
    if (!force) {
      const [{ count: invCount }, { count: ocCount }] = await Promise.all([
        supabaseAdmin
          .from("inventario")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("proveedor_id", id)
          .is("deleted_at", null),
        supabaseAdmin
          .from("ordenes_compra")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId!)
          .eq("proveedor_id", id),
      ])
      if ((invCount || 0) > 0 || (ocCount || 0) > 0) {
        return NextResponse.json(
          {
            error: "El proveedor tiene referencias",
            productos: invCount || 0,
            ordenes: ocCount || 0,
            hint: "Usá archivar o reenviá con ?force=1",
          },
          { status: 409 }
        )
      }
    }

    const { error: deleteError } = await supabaseAdmin
      .from("proveedores")
      .delete()
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting proveedor:", error)
    return NextResponse.json(
      { error: "Error al eliminar proveedor" },
      { status: 500 }
    )
  }
}
