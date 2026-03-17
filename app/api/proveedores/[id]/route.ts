import { NextResponse } from "next/server"
import { requireAuth, requireAdmin, requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatProveedor } from "@/lib/db-utils"
import { z } from "zod"

const proveedorUpdateSchema = z.object({
  nombre: z.string().min(1, "El nombre es requerido").optional(),
  telefono: z.string().optional(),
  whatsapp: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  direccion: z.string().optional(),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  notas: z.string().optional(),
  activo: z.boolean().optional(),
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
    if (data.whatsapp !== undefined) updateData.whatsapp = data.whatsapp || null
    if (data.email !== undefined) updateData.email = data.email || null
    if (data.direccion !== undefined) updateData.direccion = data.direccion || null
    if (data.website !== undefined) updateData.website = data.website || null
    if (data.notas !== undefined) updateData.notas = data.notas || null
    if (data.activo !== undefined) updateData.activo = data.activo

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
