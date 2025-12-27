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

    // Formatear respuesta con órdenes
    const clienteFormatted = {
      ...formatCliente(cliente),
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

    const { data: cliente, error: updateError } = await supabaseAdmin
      .from("clientes")
      .update(updateData)
      .eq("id", id)
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
