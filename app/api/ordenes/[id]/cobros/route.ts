import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { requireAuth } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { z } from "zod"

const pagoLineSchema = z.object({
  monto: z.number().positive("El monto debe ser mayor a 0"),
  metodo: z.enum(["EFECTIVO", "TRANSFERENCIA", "TARJETA_DEBITO", "TARJETA_CREDITO", "MERCADOPAGO", "CUENTA_CORRIENTE", "OTRO"]),
  referencia: z.string().nullable().optional(),
  cuotas: z.number().int().min(1).nullable().optional(),
  recargo: z.number().min(0).nullable().optional(),
  montoOriginal: z.number().positive().nullable().optional(),
  costoFinancieroMonto: z.number().min(0).nullable().optional(),
  costoFinancieroPorcentaje: z.number().min(0).max(100).nullable().optional(),
})

const cobrosSchema = z.object({
  pagos: z.array(pagoLineSchema).min(1, "Debe incluir al menos un pago"),
  observaciones: z.string().optional(),
  descuento: z.number().min(0).optional(),
})

// GET - Obtener cobros de una orden
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId } = await requireAuth()
    if (error) return error

    const { id: ordenId } = await params

    const { data: cobros, error: dbError } = await supabaseAdmin
      .from("cobros_orden")
      .select("*")
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .order("created_at", { ascending: false })

    if (dbError) throw dbError

    return NextResponse.json(
      (cobros || []).map((c: any) => ({
        id: c.id,
        monto: parseFloat(c.monto),
        metodoPago: c.metodo_pago,
        referencia: c.numero_referencia,
        observaciones: c.observaciones,
        cuotas: c.cuotas,
        recargoPorcentaje: c.recargo_porcentaje ? parseFloat(c.recargo_porcentaje) : null,
        montoOriginal: c.monto_original ? parseFloat(c.monto_original) : null,
        costoFinancieroMonto: c.costo_financiero_monto ? parseFloat(c.costo_financiero_monto) : null,
        costoFinancieroPorcentaje: c.costo_financiero_porcentaje ? parseFloat(c.costo_financiero_porcentaje) : null,
        fecha: c.created_at,
        anulado: c.anulado || false,
        anuladoAt: c.anulado_at,
        anuladoMotivo: c.anulado_motivo,
      }))
    )
  } catch (err) {
    console.error("Error fetching cobros:", err)
    return NextResponse.json({ error: "Error al obtener cobros" }, { status: 500 })
  }
}

// POST - Registrar cobro(s) en una orden
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden registrar cobros" }, { status: 403 })
    }

    const { id: ordenId } = await params
    const body = await request.json()
    const data = cobrosSchema.parse(body)

    // Obtener orden
    const { data: orden, error: ordenError } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("id, costo_final, total_cobrado, estado_cobro, descuento_cobro, cliente_id, organization_id")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenError || !orden) {
      return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 })
    }

    const costoFinal = parseFloat(orden.costo_final || "0")
    const descuentoAnterior = parseFloat(orden.descuento_cobro || "0")
    const descuentoNuevo = data.descuento || 0
    const descuentoTotal = descuentoAnterior + descuentoNuevo
    const totalCobrado = parseFloat(orden.total_cobrado || "0")
    const pendiente = costoFinal - descuentoTotal - totalCobrado
    const totalPagos = data.pagos.reduce((sum, p) => sum + p.monto, 0)

    if (totalPagos > pendiente + 0.01) {
      return NextResponse.json(
        { error: `El monto total (${totalPagos.toFixed(2)}) excede el pendiente (${pendiente.toFixed(2)})` },
        { status: 400 }
      )
    }

    // Registrar descuento si aplica
    if (descuentoNuevo > 0) {
      await supabaseAdmin
        .from("ordenes_servicio")
        .update({ descuento_cobro: descuentoTotal })
        .eq("id", ordenId)
    }

    // Crear cada cobro
    for (const pago of data.pagos) {
      // Si es CUENTA_CORRIENTE, descontar del saldo
      if (pago.metodo === "CUENTA_CORRIENTE" && orden.cliente_id) {
        const { error: ccError } = await supabaseAdmin.rpc("usar_cuenta_corriente", {
          p_org_id: organizationId!,
          p_cliente_id: orden.cliente_id,
          p_monto: pago.monto,
          p_referencia_tipo: "ORDEN",
          p_referencia_id: ordenId,
          p_usuario_id: userId!,
        })
        if (ccError) {
          return NextResponse.json({ error: ccError.message || "Error al usar cuenta corriente" }, { status: 400 })
        }
      }

      await supabaseAdmin.from("cobros_orden").insert({
        orden_id: ordenId,
        organization_id: organizationId!,
        monto: pago.monto,
        metodo_pago: pago.metodo,
        numero_referencia: pago.referencia || null,
        observaciones: data.observaciones || null,
        cuotas: pago.cuotas || null,
        recargo_porcentaje: pago.recargo || null,
        monto_original: pago.montoOriginal || null,
        costo_financiero_monto: pago.costoFinancieroMonto ?? null,
        costo_financiero_porcentaje: pago.costoFinancieroPorcentaje ?? null,
        usuario_id: userId!,
      })
    }

    // Recalcular estado
    await supabaseAdmin.rpc("recalcular_estado_cobro", { p_orden_id: ordenId })

    // Generar calendario de cuotas si algún pago tiene cuotas > 1
    for (const pago of data.pagos) {
      if (pago.cuotas && pago.cuotas > 1) {
        // Buscar el cobro recién creado
        const { data: ultimoCobro } = await supabaseAdmin
          .from("cobros_orden")
          .select("id")
          .eq("orden_id", ordenId)
          .eq("monto", pago.monto)
          .eq("metodo_pago", pago.metodo)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()

        if (ultimoCobro) {
          const montoCuota = pago.monto / pago.cuotas
          const cuotasInsert = []
          for (let i = 1; i <= pago.cuotas; i++) {
            const fechaVencimiento = new Date()
            fechaVencimiento.setMonth(fechaVencimiento.getMonth() + i)
            cuotasInsert.push({
              cobro_id: ultimoCobro.id,
              orden_id: ordenId,
              organization_id: organizationId!,
              numero_cuota: i,
              total_cuotas: pago.cuotas,
              monto: Math.round(montoCuota * 100) / 100,
              fecha_vencimiento: fechaVencimiento.toISOString().split("T")[0],
              pagada: i === 1, // Primera cuota se considera pagada al registrar
              fecha_pago: i === 1 ? new Date().toISOString() : null,
            })
          }
          await supabaseAdmin.from("cuotas_cobro").insert(cuotasInsert)
        }
      }
    }

    // Obtener estado actualizado
    const { data: ordenActualizada } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("total_cobrado, estado_cobro, descuento_cobro")
      .eq("id", ordenId)
      .single()

    // Invalidar cache del dashboard para que el ingreso se vea reflejado
    revalidateTag("dashboard", "max")

    return NextResponse.json({
      totalCobrado: parseFloat(ordenActualizada?.total_cobrado || "0"),
      estadoCobro: ordenActualizada?.estado_cobro,
      descuento: parseFloat(ordenActualizada?.descuento_cobro || "0"),
    }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 })
    }
    console.error("Error creating cobro:", err)
    return NextResponse.json({ error: "Error al registrar cobro" }, { status: 500 })
  }
}

// DELETE - Anular un cobro (soft-delete con auditoría)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { error, organizationId, userId, role } = await requireAuth()
    if (error) return error

    if (role !== "ADMIN") {
      return NextResponse.json({ error: "Solo administradores pueden anular cobros" }, { status: 403 })
    }

    const { id: ordenId } = await params
    const { searchParams } = new URL(request.url)
    const cobroId = searchParams.get("cobroId")
    const motivo = searchParams.get("motivo") || "Anulado por administrador"

    if (!cobroId) {
      return NextResponse.json({ error: "Se requiere cobroId" }, { status: 400 })
    }

    // Verificar que la orden no esté entregada
    const { data: ordenCheck } = await supabaseAdmin
      .from("ordenes_servicio")
      .select("estado")
      .eq("id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (ordenCheck?.estado === "ENTREGADO" || ordenCheck?.estado === "ENTREGADO_SIN_REPARACION") {
      return NextResponse.json(
        { error: "No se pueden anular cobros de órdenes ya entregadas" },
        { status: 400 }
      )
    }

    // Verificar que el cobro existe y pertenece a la orden
    const { data: cobro, error: cobroError } = await supabaseAdmin
      .from("cobros_orden")
      .select("id, monto, anulado")
      .eq("id", cobroId)
      .eq("orden_id", ordenId)
      .eq("organization_id", organizationId!)
      .single()

    if (cobroError || !cobro) {
      return NextResponse.json({ error: "Cobro no encontrado" }, { status: 404 })
    }

    if (cobro.anulado) {
      return NextResponse.json({ error: "El cobro ya fue anulado" }, { status: 400 })
    }

    // Soft-delete: marcar como anulado
    await supabaseAdmin
      .from("cobros_orden")
      .update({
        anulado: true,
        anulado_at: new Date().toISOString(),
        anulado_por: userId!,
        anulado_motivo: motivo,
      })
      .eq("id", cobroId)

    // Recalcular estado de cobro (ignorará cobros anulados)
    await supabaseAdmin.rpc("recalcular_estado_cobro", { p_orden_id: ordenId })

    // Invalidar cache del dashboard
    revalidateTag("dashboard", "max")

    return NextResponse.json({ message: "Cobro anulado correctamente" })
  } catch (err) {
    console.error("Error anulando cobro:", err)
    return NextResponse.json({ error: "Error al anular cobro" }, { status: 500 })
  }
}
