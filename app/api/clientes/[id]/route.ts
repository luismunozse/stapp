import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { formatCliente } from "@/lib/db-utils"
import { z } from "zod"

const clienteSchema = z.object({
  nombre: z.string().min(1).optional(),
  telefono: z.string().min(1).optional(),
  email: z.string().email().optional().or(z.literal("")),
  direccion: z.string().optional(),
  dni: z.string().optional(),
  tipoCliente: z.enum(["INDIVIDUAL", "EMPRESA"]).optional(),
  razonSocial: z.string().optional(),
  cuit: z.string().optional(),
  aceptaWhatsapp: z.boolean().optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    const { data: cliente, error: dbError } = await supabaseAdmin
      .from("clientes")
      .select(`
        *,
        ordenes_servicio (
          id,
          numero_orden,
          dispositivo,
          estado,
          fecha_ingreso
        ),
        sectores_cliente (
          id,
          nombre,
          contacto_nombre,
          contacto_telefono,
          contacto_email,
          activo
        )
      `)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !cliente) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      )
    }

    // Formatear respuesta con órdenes y sectores
    const clienteFormatted = {
      ...formatCliente(cliente),
      sectores: cliente.sectores_cliente
        ?.filter((s: any) => s.activo)
        .map((s: any) => ({
          id: s.id,
          clienteId: id,
          nombre: s.nombre,
          contactoNombre: s.contacto_nombre,
          contactoTelefono: s.contacto_telefono,
          contactoEmail: s.contacto_email,
          activo: s.activo,
        })) || [],
      ordenes: cliente.ordenes_servicio
        ?.sort((a: any, b: any) =>
          new Date(b.fecha_ingreso).getTime() - new Date(a.fecha_ingreso).getTime()
        )
        .slice(0, 10)
        .map((o: any) => ({
          id: o.id,
          numeroOrden: o.numero_orden,
          dispositivo: o.dispositivo,
          estado: o.estado,
          fechaIngreso: o.fecha_ingreso,
        })),
    }

    return NextResponse.json(clienteFormatted)
  } catch (error) {
    console.error("Error fetching cliente:", error)
    return NextResponse.json(
      { error: "Error al obtener cliente" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = clienteSchema.parse(body)

    // Verificar que el cliente pertenece a la organización
    const { data: existingCliente, error: fetchError } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existingCliente) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      )
    }

    // Preparar datos
    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.telefono !== undefined) updateData.telefono = data.telefono
    if (data.email !== undefined) updateData.email = data.email === "" ? null : data.email
    if (data.direccion !== undefined) updateData.direccion = data.direccion
    if (data.dni !== undefined) updateData.dni = data.dni
    if (data.tipoCliente !== undefined) updateData.tipo_cliente = data.tipoCliente
    if (data.razonSocial !== undefined) updateData.razon_social = data.razonSocial || null
    if (data.cuit !== undefined) updateData.cuit = data.cuit || null
    if (data.aceptaWhatsapp !== undefined) updateData.acepta_whatsapp = data.aceptaWhatsapp

    const { data: cliente, error: updateError } = await supabaseAdmin
      .from("clientes")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .select()
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(formatCliente(cliente))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating cliente:", error)
    return NextResponse.json(
      { error: "Error al actualizar cliente" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id } = await params

    // Verificar que el cliente pertenece a la organización
    const { data: existingCliente, error: fetchError } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !existingCliente) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("clientes")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting cliente:", error)
    return NextResponse.json(
      { error: "Error al eliminar cliente" },
      { status: 500 }
    )
  }
}
