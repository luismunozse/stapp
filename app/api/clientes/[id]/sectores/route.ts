import { NextResponse } from "next/server"
import { requireAdminOrVendedor } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const sectorSchema = z.object({
  nombre: z.string().min(1, "El nombre del sector es requerido"),
  contactoNombre: z.string().optional(),
  contactoTelefono: z.string().optional(),
  contactoEmail: z.string().email().optional().or(z.literal("")),
})

const updateSectorSchema = z.object({
  nombre: z.string().min(1).optional(),
  contactoNombre: z.string().optional(),
  contactoTelefono: z.string().optional(),
  contactoEmail: z.string().email().optional().or(z.literal("")),
  activo: z.boolean().optional(),
})

function formatSector(s: any) {
  return {
    id: s.id,
    clienteId: s.cliente_id,
    nombre: s.nombre,
    contactoNombre: s.contacto_nombre,
    contactoTelefono: s.contacto_telefono,
    contactoEmail: s.contacto_email,
    activo: s.activo,
  }
}

// GET - Listar sectores de un cliente
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { id: clienteId } = await params

    // Verificar que el cliente pertenece a la org
    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const { data: sectores, error: dbError } = await supabaseAdmin
      .from("sectores_cliente")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("nombre", { ascending: true })

    if (dbError) throw dbError

    return NextResponse.json(sectores?.map(formatSector) || [])
  } catch (error) {
    console.error("Error fetching sectores:", error)
    return NextResponse.json(
      { error: "Error al obtener sectores" },
      { status: 500 }
    )
  }
}

// POST - Crear un sector para un cliente
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { id: clienteId } = await params
    const body = await request.json()
    const data = sectorSchema.parse(body)

    // Verificar que el cliente pertenece a la org y es tipo EMPRESA
    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .select("id, tipo_cliente")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    if (cliente.tipo_cliente !== "EMPRESA") {
      return NextResponse.json(
        { error: "Solo se pueden agregar sectores a clientes tipo EMPRESA" },
        { status: 400 }
      )
    }

    const { data: sector, error: createError } = await supabaseAdmin
      .from("sectores_cliente")
      .insert({
        cliente_id: clienteId,
        nombre: data.nombre,
        contacto_nombre: data.contactoNombre || null,
        contacto_telefono: data.contactoTelefono || null,
        contacto_email: data.contactoEmail || null,
      })
      .select()
      .single()

    if (createError) {
      if (createError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un sector con ese nombre para este cliente" },
          { status: 400 }
        )
      }
      throw createError
    }

    return NextResponse.json(formatSector(sector), { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error creating sector:", error)
    return NextResponse.json(
      { error: "Error al crear sector" },
      { status: 500 }
    )
  }
}

// PUT - Actualizar un sector (usa query param sectorId)
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { id: clienteId } = await params
    const { searchParams } = new URL(request.url)
    const sectorId = searchParams.get("sectorId")

    if (!sectorId) {
      return NextResponse.json({ error: "sectorId es requerido" }, { status: 400 })
    }

    const body = await request.json()
    const data = updateSectorSchema.parse(body)

    // Verificar que el cliente pertenece a la org
    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const updateData: Record<string, any> = {}
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.contactoNombre !== undefined) updateData.contacto_nombre = data.contactoNombre || null
    if (data.contactoTelefono !== undefined) updateData.contacto_telefono = data.contactoTelefono || null
    if (data.contactoEmail !== undefined) updateData.contacto_email = data.contactoEmail || null
    if (data.activo !== undefined) updateData.activo = data.activo

    const { data: sector, error: updateError } = await supabaseAdmin
      .from("sectores_cliente")
      .update(updateData)
      .eq("id", sectorId)
      .eq("cliente_id", clienteId)
      .select()
      .single()

    if (updateError) {
      if (updateError.code === "23505") {
        return NextResponse.json(
          { error: "Ya existe un sector con ese nombre" },
          { status: 400 }
        )
      }
      throw updateError
    }

    return NextResponse.json(formatSector(sector))
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating sector:", error)
    return NextResponse.json(
      { error: "Error al actualizar sector" },
      { status: 500 }
    )
  }
}

// DELETE - Eliminar un sector (usa query param sectorId)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdminOrVendedor()
    if (error) return error

    const { id: clienteId } = await params
    const { searchParams } = new URL(request.url)
    const sectorId = searchParams.get("sectorId")

    if (!sectorId) {
      return NextResponse.json({ error: "sectorId es requerido" }, { status: 400 })
    }

    // Verificar que el cliente pertenece a la org
    const { data: cliente, error: clienteError } = await supabaseAdmin
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("organization_id", organizationId!)
      .single()

    if (clienteError || !cliente) {
      return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 })
    }

    const { error: deleteError } = await supabaseAdmin
      .from("sectores_cliente")
      .delete()
      .eq("id", sectorId)
      .eq("cliente_id", clienteId)

    if (deleteError) throw deleteError

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting sector:", error)
    return NextResponse.json(
      { error: "Error al eliminar sector" },
      { status: 500 }
    )
  }
}
