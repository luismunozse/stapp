import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaEscritura } from "@/lib/sucursal"

/**
 * Materializa todos los gastos recurrentes vencidos (proximo_vencimiento <= hoy)
 * de la organización del usuario.
 *
 * Para cada gasto vencido:
 *   1. Crea un movimiento_caja tipo EGRESO con es_recurrente = true
 *   2. Actualiza ultimo_generado y avanza proximo_vencimiento según la frecuencia
 *
 * Pensado para llamarse:
 *   - Manualmente desde un botón ("Generar gastos vencidos")
 *   - Automáticamente al entrar a /caja (best-effort)
 *   - Vía cron externo si se quiere automatizar 100%
 */
export async function POST() {
  try {
    const { error, session, organizationId, userId, role } = await requireAdmin()
    if (error) return error

    const sucursalId = await sucursalParaEscritura({
      role,
      organizationId: organizationId!,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!sucursalId) {
      return NextResponse.json(
        { error: "La organización no tiene sucursal principal configurada" },
        { status: 500 }
      )
    }

    const hoy = new Date().toISOString().split("T")[0]

    const { data: vencidos } = await supabaseAdmin
      .from("gastos_recurrentes")
      .select("*")
      .eq("organization_id", organizationId!)
      .eq("activo", true)
      .lte("proximo_vencimiento", hoy)

    if (!vencidos || vencidos.length === 0) {
      return NextResponse.json({ generados: 0, movimientos: [] })
    }

    // Buscar sesión abierta (opcional), scoped a la misma sucursal de los
    // movimientos para no enlazarlos a la sesión de otra sucursal.
    let sesionQuery = supabaseAdmin
      .from("sesiones_caja")
      .select("id")
      .eq("organization_id", organizationId!)
      .eq("estado", "ABIERTA")
    if (sucursalId) sesionQuery = sesionQuery.eq("sucursal_id", sucursalId)
    const { data: sesionAbierta } = await sesionQuery.maybeSingle()

    // Buscar afecta_rentabilidad de cada categoría
    const categoriaIds = Array.from(
      new Set(vencidos.map((g: any) => g.categoria_gasto_id).filter(Boolean))
    )
    const categoriasMap: Record<string, boolean> = {}
    if (categoriaIds.length > 0) {
      const { data: cats } = await supabaseAdmin
        .from("categorias_gasto")
        .select("id, afecta_rentabilidad")
        .in("id", categoriaIds)
      for (const c of cats || []) {
        categoriasMap[c.id] = c.afecta_rentabilidad
      }
    }

    const generados: any[] = []

    for (const g of vencidos as any[]) {
      const afectaRent = g.categoria_gasto_id
        ? categoriasMap[g.categoria_gasto_id] ?? true
        : true

      // 1. Insertar movimiento
      const { data: mov, error: insertError } = await supabaseAdmin
        .from("movimientos_caja")
        .insert({
          organization_id: organizationId!,
          sesion_caja_id: sesionAbierta?.id || null,
          tipo: "EGRESO",
          monto: g.monto,
          metodo_pago: g.metodo_pago,
          concepto: g.concepto,
          observaciones: `Generado automáticamente desde gasto recurrente${
            g.observaciones ? ` · ${g.observaciones}` : ""
          }`,
          usuario_id: userId!,
          categoria_gasto_id: g.categoria_gasto_id,
          afecta_rentabilidad: afectaRent,
          es_recurrente: true,
          sucursal_id: sucursalId,
        })
        .select("id")
        .single()

      if (insertError || !mov) {
        console.error("Error insertando movimiento recurrente:", insertError)
        continue
      }

      // 2. Calcular próximo vencimiento
      const next = calcularProximo(g.proximo_vencimiento, g.frecuencia, g.dia_del_mes)

      await supabaseAdmin
        .from("gastos_recurrentes")
        .update({
          ultimo_generado: g.proximo_vencimiento,
          proximo_vencimiento: next,
        })
        .eq("id", g.id)

      generados.push({ id: mov.id, concepto: g.concepto, monto: g.monto })
    }

    return NextResponse.json({ generados: generados.length, movimientos: generados })
  } catch (err) {
    console.error("Error materializando gastos recurrentes:", err)
    return NextResponse.json({ error: "Error al materializar gastos" }, { status: 500 })
  }
}

function calcularProximo(actual: string, frecuencia: string, diaDelMes: number | null): string {
  const d = new Date(actual + "T00:00:00")
  if (frecuencia === "SEMANAL") {
    d.setDate(d.getDate() + 7)
  } else if (frecuencia === "MENSUAL") {
    d.setMonth(d.getMonth() + 1)
    if (diaDelMes) {
      // Ajustar al día deseado, manejando meses con menos días
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      d.setDate(Math.min(diaDelMes, lastDay))
    }
  } else if (frecuencia === "ANUAL") {
    d.setFullYear(d.getFullYear() + 1)
  }
  return d.toISOString().split("T")[0]
}
