import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import bcrypt from "bcryptjs"
import { z } from "zod"

const vendedorUpdateSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  email: z.string().email("Email inválido").optional(),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres").optional(),
  telefono: z.string().trim().optional().nullable(),
  activo: z.boolean().optional(),
  porcentajeComision: z.coerce
    .number()
    .min(0, "La comisión debe ser mayor o igual a 0")
    .max(100, "La comisión no puede superar 100")
    .optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Ficha de un vendedor. Mismo caso que el listado: el POST/PUT de este
    // archivo ya era de ADMIN y nadie volvio por el GET.
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: vendedor, error: dbError } = await supabaseAdmin
      .from("users")
      .select(
        "id, nombre, email, telefono, activo, porcentaje_comision, created_at"
      )
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (dbError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    const HISTORIAL_LIMIT = 50

    const [statsRes, ventasRes, comisionesRes] = await Promise.all([
      supabaseAdmin.rpc("get_vendedores_stats", { p_org_id: organizationId! }),
      supabaseAdmin
        .from("ventas")
        .select("id, total, estado, created_at")
        .eq("organization_id", organizationId!)
        .eq("vendedor_id", id)
        .order("created_at", { ascending: false })
        .limit(HISTORIAL_LIMIT),
      supabaseAdmin
        .from("v_comisiones_ventas")
        .select("monto_comision, comision_pagada")
        .eq("organization_id", organizationId!)
        .eq("vendedor_id", id),
    ])

    const statsRow = (statsRes.data || []).find((r: any) => r.vendedor_id === id)
    const ventasRecientes = ventasRes.data || []
    const comisiones = comisionesRes.data || []

    const comisionDevengada = comisiones.reduce(
      (sum: number, c: any) => sum + parseFloat(c.monto_comision || "0"),
      0
    )
    const comisionPagada = comisiones
      .filter((c: any) => c.comision_pagada)
      .reduce((sum: number, c: any) => sum + parseFloat(c.monto_comision || "0"), 0)

    return NextResponse.json({
      id: vendedor.id,
      nombre: vendedor.nombre,
      email: vendedor.email,
      telefono: vendedor.telefono ?? null,
      activo: vendedor.activo !== false,
      porcentajeComision: Number(vendedor.porcentaje_comision ?? 0),
      createdAt: vendedor.created_at,
      ventasCompletadas: Number(statsRow?.ventas_completadas ?? 0),
      ventasTotal: Number(statsRow?.ventas_total ?? 0),
      montoTotalVentas: Number(statsRow?.monto_total ?? 0),
      ticketPromedio: statsRow?.ticket_promedio !== null && statsRow?.ticket_promedio !== undefined
        ? Number(statsRow.ticket_promedio)
        : null,
      comisionDevengada,
      comisionPagada,
      comisionPendiente: comisionDevengada - comisionPagada,
      ventas: ventasRecientes.map((v: any) => ({
        id: v.id,
        total: v.total,
        estado: v.estado,
        fecha: v.created_at,
      })),
    })
  } catch (error) {
    console.error("Error fetching vendedor:", error)
    return NextResponse.json(
      { error: "Error al obtener vendedor" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params
    const body = await request.json()
    const data = vendedorUpdateSchema.parse(body)

    // Verificar que el vendedor existe
    const { data: vendedor, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id, email")
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    // Verificar email único si cambió
    if (data.email && data.email !== vendedor.email) {
      const { data: existingUser } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("email", data.email)
        .single()

      if (existingUser) {
        return NextResponse.json(
          { error: "Ya existe un usuario con este email" },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, any> = {}
    if (data.nombre) updateData.nombre = data.nombre
    if (data.email) updateData.email = data.email
    if (data.password) updateData.password = await bcrypt.hash(data.password, 10)
    if (data.telefono !== undefined) updateData.telefono = data.telefono?.trim() || null
    if (data.activo !== undefined) updateData.activo = data.activo
    if (data.porcentajeComision !== undefined) updateData.porcentaje_comision = data.porcentajeComision

    const { data: updatedVendedor, error: updateError } = await supabaseAdmin
      .from("users")
      .update(updateData)
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .eq("rol", "VENDEDOR")
      .select("id, nombre, email, telefono, activo, porcentaje_comision")
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json(updatedVendedor)
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating vendedor:", error)
    return NextResponse.json(
      { error: "Error al actualizar vendedor" },
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

    // Verificar que el vendedor existe
    const { data: vendedor, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .single()

    if (fetchError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    // Contar ventas asociadas sin traerlas (HEAD + count exact)
    const { count: ventasCount, error: countError } = await supabaseAdmin
      .from("ventas")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId!)
      .eq("vendedor_id", id)

    if (countError) throw countError

    if ((ventasCount || 0) > 0) {
      return NextResponse.json(
        { error: `No se puede eliminar un vendedor con ${ventasCount} venta(s) asociada(s). Reasigne las ventas primero.` },
        { status: 400 }
      )
    }

    const { error: deleteError } = await supabaseAdmin
      .from("users")
      .delete()
      .eq("id", id)
      .eq("organization_id", organizationId!)
      .eq("rol", "VENDEDOR")

    if (deleteError) {
      throw deleteError
    }

    return NextResponse.json({ message: "Vendedor eliminado correctamente" })
  } catch (error) {
    console.error("Error deleting vendedor:", error)
    return NextResponse.json(
      { error: "Error al eliminar vendedor" },
      { status: 500 }
    )
  }
}
