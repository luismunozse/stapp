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
 * Pago de comisiones a vendedores.
 *
 * Espejo de /api/comisiones/pagar (técnicos): además de marcar las ventas
 * como pagadas genera el egreso de caja (auditoría contable, punto 1.3).
 * Ver lib/comisiones-caja.ts.
 */
export async function POST(request: Request) {
  try {
    const { error, organizationId, userId, role, session } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ventaIds, notas, metodoPago, registrarEnCaja } = body as {
      ventaIds: string[]
      notas?: string
      metodoPago?: string
      registrarEnCaja?: boolean
    }

    if (!Array.isArray(ventaIds) || ventaIds.length === 0) {
      return NextResponse.json(
        { error: "Debe indicar al menos una venta" },
        { status: 400 }
      )
    }

    const { data, error: updErr } = await supabaseAdmin
      .from("ventas")
      .update({
        comision_pagada: true,
        fecha_pago_comision: new Date().toISOString(),
        comision_pago_notas: notas?.trim() || null,
      })
      .in("id", ventaIds)
      .eq("organization_id", organizationId!)
      .eq("estado", "COMPLETADA")
      .eq("comision_pagada", false)
      .select("id")

    if (updErr) throw updErr

    const pagadas = (data || []).map((v) => v.id)
    if (pagadas.length === 0) {
      return NextResponse.json({ updated: 0, egresoCaja: null })
    }

    if (registrarEnCaja === false) {
      return NextResponse.json({ updated: pagadas.length, egresoCaja: null })
    }

    // El monto sale de la vista (neto × porcentaje), única fuente de verdad
    // del cálculo.
    const { filas: comisiones } = await traerTodoPorLotes<any>(
      pagadas,
      (lote, desde, hasta) =>
        supabaseAdmin
          .from("v_comisiones_ventas")
          .select("venta_id, vendedor_id, monto_comision")
          .eq("organization_id", organizationId!)
          .in("venta_id", lote)
          .order("venta_id", { ascending: true })
          .range(desde, hasta)
    )

    const lineas: LineaComision[] = comisiones.map((c: any) => ({
      referenciaId: c.venta_id,
      beneficiarioId: c.vendedor_id,
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
      origenTipo: "COMISION_VENDEDOR",
      metodoPago: metodoPago || "EFECTIVO",
      lineas,
      nombresPorBeneficiario: nombres,
      notas: notas || null,
    })

    await enlazarMovimientoComision("ventas", organizationId!, egreso.movimientoPorReferencia)

    if (pagadas[0]) await logAudit({
      organizationId: organizationId!,
      userId: userId!,
      action: "UPDATE",
      entity: "comisiones",
      entityId: pagadas[0],
      changes: { after: { cantidad: pagadas.length, total: egreso.totalRegistrado } },
      description: `Pagó comisiones de ${pagadas.length} venta(s) por ${egreso.totalRegistrado}`,
    })

    return NextResponse.json({
      updated: pagadas.length,
      egresoCaja: {
        total: egreso.totalRegistrado,
        movimientos: egreso.movimientosCreados,
      },
    })
  } catch (err) {
    console.error("Error pagando comisiones vendedores:", err)
    return NextResponse.json(
      { error: "Error al marcar comisiones como pagadas" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  try {
    const { error, organizationId, userId } = await requireAdmin()
    if (error) return error

    const body = await request.json()
    const { ventaIds } = body as { ventaIds: string[] }

    if (!Array.isArray(ventaIds) || ventaIds.length === 0) {
      return NextResponse.json(
        { error: "Debe indicar al menos una venta" },
        { status: 400 }
      )
    }

    // Leer los movimientos ANTES de limpiar la columna.
    const { filas: previas } = await traerTodoPorLotes<any>(
      ventaIds,
      (lote, desde, hasta) =>
        supabaseAdmin
          .from("ventas")
          .select("id, comision_pago_movimiento_id")
          .eq("organization_id", organizationId!)
          .eq("comision_pagada", true)
          .in("id", lote)
          .order("id", { ascending: true })
          .range(desde, hasta)
    )
    const movimientoIds = previas
      .map((v: any) => v.comision_pago_movimiento_id)
      .filter((id: string | null): id is string => !!id)

    const { data, error: updErr } = await supabaseAdmin
      .from("ventas")
      .update({
        comision_pagada: false,
        fecha_pago_comision: null,
        comision_pago_notas: null,
        comision_pago_movimiento_id: null,
      })
      .in("id", ventaIds)
      .eq("organization_id", organizationId!)
      .eq("comision_pagada", true)
      .select("id")

    if (updErr) throw updErr

    const anulados = await anularEgresoComisionesHuerfanos({
      organizationId: organizationId!,
      userId: userId!,
      movimientoIds,
      tabla: "ventas",
    })

    return NextResponse.json({ updated: data?.length || 0, egresosAnulados: anulados })
  } catch (err) {
    console.error("Error revirtiendo comisiones vendedores:", err)
    return NextResponse.json({ error: "Error al revertir" }, { status: 500 })
  }
}
