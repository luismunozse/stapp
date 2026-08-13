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
  tipoPrecio: z.enum(["MINORISTA", "MAYORISTA"]).optional(),
  descuentoPct: z.number().min(0, "El descuento debe estar entre 0 y 100").max(100, "El descuento debe estar entre 0 y 100").nullable().optional(),
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
    const { error, organizationId, role } = await requireAuth()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = clienteSchema.parse(body)

    // Mismo gate que POST /api/clientes (ver design ADR-7): el precio
    // mayorista solo lo define un ADMIN, se rechaza fuerte, nunca se
    // aplica parcial en silencio.
    if ((data.tipoPrecio !== undefined || data.descuentoPct !== undefined) && role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo un administrador puede definir el precio del cliente" },
        { status: 403 }
      )
    }

    if (data.tipoPrecio === "MAYORISTA" && (data.descuentoPct === undefined || data.descuentoPct === null)) {
      return NextResponse.json(
        { error: "Definí un descuento para un cliente mayorista" },
        { status: 400 }
      )
    }

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
    // Flip a MINORISTA anula el % en el mismo update (REQ-5.2) — no queda un
    // descuento fantasma guardado detrás de un tier que ya no lo usa.
    if (data.tipoPrecio !== undefined) {
      updateData.tipo_precio = data.tipoPrecio
      updateData.descuento_pct = data.tipoPrecio === "MAYORISTA" ? (data.descuentoPct ?? null) : null
    }

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
