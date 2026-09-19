import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura } from "@/lib/sucursal"
import { traerTodoPorLotes } from "@/lib/supabase-paginado"
import {
  registrarEgresoComisiones,
  anularEgresoComisionesHuerfanos,
  nombresDeUsuarios,
  enlazarMovimientoComision,
  type LineaComision,
} from "@/lib/comisiones-caja"
import { logAudit } from "@/lib/audit"

/**
 * Pago de comisiones a técnicos.
 *
 * Además de marcar las órdenes como pagadas, genera el egreso de caja
 * correspondiente (auditoría contable, punto 1.3). Ver lib/comisiones-caja.ts
 * para el porqué: antes esto sólo prendía una tilde y el dueño terminaba
 * cargando el gasto a mano, con lo que la comisión se restaba dos veces del
 * Estado de Resultados.
 *
 * `registrarEnCaja: false` deja el comportamiento viejo, para el caso del que
 * ya venía cargando el egreso a mano y no quiere duplicarlo mientras ordena
 * su operatoria.
 */
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ordenIds, notas, metodoPago, registrarEnCaja } = body as {
      ordenIds: string[]
      notas?: string
      metodoPago?: string
      registrarEnCaja?: boolean
    }

    if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
      return NextResponse.json({ error: "Debe indicar al menos una orden" }, { status: 400 })
    }

    const { data, error: updErr } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        comision_pagada: true,
        fecha_pago_comision: new Date().toISOString(),
        comision_pago_notas: notas || null,
      })
      .in("id", ordenIds)
      .eq("organization_id", organizationId!)
      .eq("comision_pagada", false)
      .select("id")

    if (updErr) throw updErr

    const pagadas = (data || []).map((o) => o.id)
    if (pagadas.length === 0) {
      return NextResponse.json({ updated: 0, egresoCaja: null })
    }

    if (registrarEnCaja === false) {
      return NextResponse.json({ updated: pagadas.length, egresoCaja: null })
    }

    // El monto sale de la vista, que es la única fuente de verdad del cálculo
    // (ganancia × porcentaje). Recalcularlo acá sería una segunda versión de
    // la misma fórmula, lista para desincronizarse.
    const { filas: comisiones } = await traerTodoPorLotes<any>(
      pagadas,
      (lote, desde, hasta) =>
        supabaseAdmin
          .from("v_comisiones_ordenes")
          .select("orden_id, tecnico_id, monto_comision")
          .eq("organization_id", organizationId!)
          .in("orden_id", lote)
          .order("orden_id", { ascending: true })
          .range(desde, hasta)
    )

    const lineas: LineaComision[] = comisiones.map((c: any) => ({
      referenciaId: c.orden_id,
      beneficiarioId: c.tecnico_id,
      monto: Number(c.monto_comision || 0),
    }))

    const nombres = await nombresDeUsuarios(
      lineas.map((l) => l.beneficiarioId).filter((id): id is string => !!id)
    )

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })

    const egreso = await registrarEgresoComisiones({
      organizationId: organizationId!,
      userId: userId!,
      sucursalId,
      origenTipo: "COMISION_TECNICO",
      metodoPago: metodoPago || "EFECTIVO",
      lineas,
      nombresPorBeneficiario: nombres,
      notas: notas || null,
    })

    // Enlazar cada orden con el movimiento que la pagó, para poder revertir.
    await enlazarMovimientoComision("ordenes_servicio", organizationId!, egreso.movimientoPorReferencia)

    if (pagadas[0]) await logAudit({
      organizationId: organizationId!,
      userId: userId!,
      action: "UPDATE",
      entity: "comisiones",
      entityId: pagadas[0],
      changes: { after: { cantidad: pagadas.length, total: egreso.totalRegistrado } },
      description: `Pagó comisiones de ${pagadas.length} orden(es) por ${egreso.totalRegistrado}`,
    })

    return NextResponse.json({
      updated: pagadas.length,
      egresoCaja: {
        total: egreso.totalRegistrado,
        movimientos: egreso.movimientosCreados,
      },
    })
  } catch (err) {
    console.error("Error pagando comisiones:", err)
    return NextResponse.json({ error: "Error al marcar comisiones como pagadas" }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ordenIds } = body as { ordenIds: string[] }

    if (!Array.isArray(ordenIds) || ordenIds.length === 0) {
      return NextResponse.json({ error: "Debe indicar al menos una orden" }, { status: 400 })
    }

    // Leer los movimientos ANTES de limpiar la columna: después ya no hay
    // forma de saber qué egreso pagó estas órdenes.
    const { filas: previas } = await traerTodoPorLotes<any>(
      ordenIds,
      (lote, desde, hasta) =>
        supabaseAdmin
          .from("ordenes_servicio")
          .select("id, comision_pago_movimiento_id")
          .eq("organization_id", organizationId!)
          .eq("comision_pagada", true)
          .in("id", lote)
          .order("id", { ascending: true })
          .range(desde, hasta)
    )
    const movimientoIds = previas
      .map((o: any) => o.comision_pago_movimiento_id)
      .filter((id: string | null): id is string => !!id)

    const { data, error: updErr } = await supabaseAdmin
      .from("ordenes_servicio")
      .update({
        comision_pagada: false,
        fecha_pago_comision: null,
        comision_pago_notas: null,
        comision_pago_movimiento_id: null,
      })
      .in("id", ordenIds)
      .eq("organization_id", organizationId!)
      .eq("comision_pagada", true)
      .select("id")

    if (updErr) throw updErr

    const anulados = await anularEgresoComisionesHuerfanos({
      organizationId: organizationId!,
      userId: userId!,
      movimientoIds,
      tabla: "ordenes_servicio",
    })

    return NextResponse.json({ updated: data?.length || 0, egresosAnulados: anulados })
  } catch (err) {
    console.error("Error revirtiendo comisiones:", err)
    return NextResponse.json({ error: "Error al revertir" }, { status: 500 })
  }
}
