import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { eliminarPersonal } from "@/lib/usuarios/eliminar-personal"
import { readCommissionRows } from "@/lib/commissions/rows"
import { round2 } from "@/lib/precios"
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
      .is("deleted_at", null)
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
      // Every row of this seller (incl. post-payment adjustments) from the single definition.
      readCommissionRows({ organizationId: organizationId!, roles: ["VENDEDOR"], beneficiarioId: id }),
    ])

    const statsRow = (statsRes.data || []).find((r: any) => r.vendedor_id === id)
    const ventasRecientes = ventasRes.data || []
    const comisiones = comisionesRes

    const comisionDevengada = round2(comisiones.reduce((sum, c) => sum + c.monto, 0))
    const comisionPagada = round2(comisiones.filter((c) => c.pagado).reduce((sum, c) => sum + c.monto, 0))
    const comisionPendiente = round2(comisiones.reduce((sum, c) => sum + c.pendiente, 0))
    // Unpaid rows that can actually be paid (a zero-amount row never can); the net total can be 0 with rows left.
    const filasPendientes = comisiones.filter((c) => !c.pagado && c.monto !== 0).length

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
      comisionPendiente,
      filasPendientes,
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
      .is("deleted_at", null)
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
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    // Verificar que el vendedor existe
    const { data: vendedor, error: fetchError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("id", id)
      .eq("rol", "VENDEDOR")
      .eq("organization_id", organizationId!)
      .is("deleted_at", null)
      .single()

    if (fetchError || !vendedor) {
      return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
    }

    const result = await eliminarPersonal({
      id,
      organizationId: organizationId!,
      rol: "VENDEDOR",
      actorId: userId,
    })
    if (!result.ok) {
      if (result.status === 404) {
        return NextResponse.json({ error: "Vendedor no encontrado" }, { status: 404 })
      }
      if (result.status === 409) {
        return NextResponse.json(
          { error: "No se puede dar de baja al último administrador del taller" },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: "Error al eliminar vendedor" }, { status: 500 })
    }

    if (result.baja) {
      return NextResponse.json({
        baja: true,
        message:
          "El vendedor tenía historial (ventas, órdenes o caja): quedó dado de baja. Ya no puede ingresar y su historial se conserva.",
      })
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
