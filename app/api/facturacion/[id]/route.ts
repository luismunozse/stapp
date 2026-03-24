import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const updateFacturaSchema = z.object({
  estadoPago: z.enum(["PENDIENTE", "PAGADO_PARCIAL", "PAGADO", "ANULADA"]).optional(),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAdmin()
    if (error) return error

    const { id } = await params

    const { data: factura, error: dbError } = await supabaseAdmin
      .from("facturas")
      .select(`
        *,
        ordenes_servicio!inner (
          id,
          numero_orden,
          dispositivo,
          organization_id,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .eq("id", id)
      .eq("ordenes_servicio.organization_id", organizationId!)
      .single()

    if (dbError || !factura) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    return NextResponse.json({
      id: factura.id,
      ordenId: factura.orden_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      montoAbonado: factura.monto_abonado,
      estadoPago: factura.estado_pago,
      createdAt: factura.created_at,
      orden: {
        id: factura.ordenes_servicio.id,
        numeroOrden: factura.ordenes_servicio.numero_orden,
        dispositivo: factura.ordenes_servicio.dispositivo,
        cliente: factura.ordenes_servicio.clientes,
      },
      pagos: factura.pagos_parciales?.map((p: any) => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        notas: p.observaciones,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
      })).sort((a: any, b: any) =>
        new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
      ),
    }, {
      headers: { "Cache-Control": "no-store, no-cache, must-revalidate" },
    })
  } catch (error) {
    console.error("Error fetching factura:", error)
    return NextResponse.json(
      { error: "Error al obtener factura" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden modificar facturas" },
        { status: 403 }
      )
    }

    const { id } = await params
    const body = await request.json()
    const data = updateFacturaSchema.parse(body)

    // Verificar que la factura existe y pertenece a la org
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("facturas")
      .select("id, ordenes_servicio!inner(organization_id)")
      .eq("id", id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (existing.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    const updateData: Record<string, any> = {}
    if (data.estadoPago !== undefined) updateData.estado_pago = data.estadoPago

    const { data: factura, error: updateError } = await supabaseAdmin
      .from("facturas")
      .update(updateData)
      .eq("id", id)
      .select(`
        *,
        ordenes_servicio (
          id,
          numero_orden,
          dispositivo,
          clientes (*)
        ),
        pagos_parciales (*)
      `)
      .single()

    if (updateError) {
      throw updateError
    }

    return NextResponse.json({
      id: factura.id,
      ordenId: factura.orden_id,
      numeroFactura: factura.numero_factura,
      fecha: factura.fecha,
      subtotal: factura.subtotal,
      iva: factura.iva,
      total: factura.total,
      montoAbonado: factura.monto_abonado,
      estadoPago: factura.estado_pago,
      orden: {
        id: factura.ordenes_servicio.id,
        numeroOrden: factura.ordenes_servicio.numero_orden,
        dispositivo: factura.ordenes_servicio.dispositivo,
        cliente: factura.ordenes_servicio.clientes,
      },
      pagos: factura.pagos_parciales?.map((p: any) => ({
        id: p.id,
        monto: p.monto,
        metodoPago: p.metodo_pago,
        referencia: p.numero_referencia,
        fecha: p.fecha,
        notas: p.observaciones,
        cuotas: p.cuotas,
        recargoPorcentaje: p.recargo_porcentaje,
        montoOriginal: p.monto_original,
      })),
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.errors[0].message },
        { status: 400 }
      )
    }
    console.error("Error updating factura:", error)
    return NextResponse.json(
      { error: "Error al actualizar factura" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, role, userId } = await requireAdmin()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json(
        { error: "Solo administradores pueden eliminar facturas" },
        { status: 403 }
      )
    }

    const { id } = await params

    // Verificar que la factura existe y pertenece a la org
    const { data: factura, error: fetchError } = await supabaseAdmin
      .from("facturas")
      .select(`
        id,
        numero_factura,
        total,
        ordenes_servicio!inner(
          organization_id,
          numero_orden
        )
      `)
      .eq("id", id)
      .single()

    if (fetchError || !factura) {
      return NextResponse.json(
        { error: "Factura no encontrada" },
        { status: 404 }
      )
    }

    const ordenOrgId = (factura.ordenes_servicio as any)?.organization_id
    if (ordenOrgId !== organizationId) {
      return NextResponse.json(
        { error: "No autorizado" },
        { status: 403 }
      )
    }

    // Primero eliminar los pagos asociados
    const { error: deletePagosError } = await supabaseAdmin
      .from("pagos_parciales")
      .delete()
      .eq("factura_id", id)

    if (deletePagosError) {
      console.error("Error deleting pagos:", deletePagosError)
      throw deletePagosError
    }

    // Luego eliminar la factura
    const { error: deleteError } = await supabaseAdmin
      .from("facturas")
      .delete()
      .eq("id", id)

    if (deleteError) {
      throw deleteError
    }

    // Registrar en audit log
    await supabaseAdmin.from("audit_logs").insert({
      organization_id: organizationId,
      user_id: userId,
      action: "DELETE_FACTURA",
      entity_type: "factura",
      entity_id: id,
      details: {
        numero_factura: factura.numero_factura,
        total: factura.total,
        numero_orden: (factura.ordenes_servicio as any)?.numero_orden,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Error deleting factura:", error)
    return NextResponse.json(
      { error: "Error al eliminar factura" },
      { status: 500 }
    )
  }
}
