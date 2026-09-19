import { supabaseAdmin } from "@/lib/supabase"
import { traerTodoPorLotes } from "@/lib/supabase-paginado"

/**
 * El pago de comisiones saca plata de la caja.
 *
 * EL PROBLEMA QUE RESUELVE (auditoría contable, punto 1.3)
 *
 * "Marcar comisión como pagada" sólo prendía una tilde. La plata salía del
 * cajón y el sistema no se enteraba, así que el dueño quedaba entre dos
 * opciones y las dos daban mal:
 *
 *   a) No cargar nada  → el arqueo da faltante todos los meses de pago.
 *   b) Cargarlo a mano → el Estado de Resultados lo resta DOS veces, porque
 *      ya venía restando la comisión devengada (cuando se hizo el trabajo,
 *      que es lo correcto para medir si el mes fue rentable).
 *
 * LA SOLUCIÓN
 *
 * El pago genera su propio egreso de caja, marcado `afecta_rentabilidad =
 * false`. Eso hace que:
 *   - el arqueo lo vea (la plata salió del cajón de verdad), y
 *   - el P&L NO lo cuente como gasto operativo, porque la comisión ya está
 *     restada en la línea "Comisiones".
 *
 * Es el mismo mecanismo que ya usaban los retiros de socio y los reembolsos
 * en efectivo: movimiento de caja real que no es gasto del período.
 *
 * UN MOVIMIENTO POR PERSONA
 *
 * Un pago puede cubrir órdenes de varios técnicos. Se genera un movimiento
 * por beneficiario en vez de uno solo por el total: en la caja se lee
 * "Comisiones a Juan Pérez" en vez de un monto anónimo, y `origen_id` queda
 * con el id de la persona, que es lo que después se querrá filtrar.
 */

export type OrigenComision = "COMISION_TECNICO" | "COMISION_VENDEDOR"

export interface LineaComision {
  /** Id de la orden o de la venta. */
  referenciaId: string
  /** Id del técnico o del vendedor que cobra. */
  beneficiarioId: string | null
  monto: number
}

export interface EgresoComisionesResult {
  /** referenciaId → id del movimiento de caja que lo pagó. */
  movimientoPorReferencia: Map<string, string>
  totalRegistrado: number
  movimientosCreados: number
}

/**
 * Crea los egresos de caja del pago y devuelve qué movimiento cubrió cada
 * orden/venta, para que el llamador lo guarde en
 * `comision_pago_movimiento_id` y pueda revertirlo después.
 *
 * Best-effort por diseño: si el movimiento falla, el pago ya quedó marcado y
 * no tiene sentido tirar abajo la operación. Se loguea y se devuelve lo que
 * sí se pudo registrar; las órdenes sin movimiento quedan con la columna en
 * NULL, que es exactamente el estado anterior a este cambio.
 */
export async function registrarEgresoComisiones(opts: {
  organizationId: string
  userId: string
  sucursalId: string | null
  origenTipo: OrigenComision
  metodoPago: string
  lineas: LineaComision[]
  nombresPorBeneficiario?: Map<string, string>
  notas?: string | null
}): Promise<EgresoComisionesResult> {
  const vacio: EgresoComisionesResult = {
    movimientoPorReferencia: new Map(),
    totalRegistrado: 0,
    movimientosCreados: 0,
  }

  const conMonto = opts.lineas.filter((l) => l.monto > 0)
  if (conMonto.length === 0) return vacio

  // Sesión abierta de la sucursal, si hay. Igual que en el alta manual: un
  // movimiento sin caja abierta es válido, queda con sesion_caja_id NULL.
  let sesionQuery = supabaseAdmin
    .from("sesiones_caja")
    .select("id")
    .eq("organization_id", opts.organizationId)
    .eq("estado", "ABIERTA")
  if (opts.sucursalId) sesionQuery = sesionQuery.eq("sucursal_id", opts.sucursalId)
  const { data: sesion } = await sesionQuery.maybeSingle()

  // Agrupar por beneficiario. `SIN_ASIGNAR` cubre el caso raro de una orden
  // con comisión pero sin técnico: la plata igual salió.
  const porBeneficiario = new Map<string, { monto: number; referencias: string[] }>()
  for (const linea of conMonto) {
    const clave = linea.beneficiarioId || "SIN_ASIGNAR"
    const acc = porBeneficiario.get(clave) || { monto: 0, referencias: [] }
    acc.monto += linea.monto
    acc.referencias.push(linea.referenciaId)
    porBeneficiario.set(clave, acc)
  }

  const quienes = opts.origenTipo === "COMISION_TECNICO" ? "técnico" : "vendedor"
  const resultado: EgresoComisionesResult = {
    movimientoPorReferencia: new Map(),
    totalRegistrado: 0,
    movimientosCreados: 0,
  }

  for (const [beneficiarioId, datos] of porBeneficiario) {
    const nombre = opts.nombresPorBeneficiario?.get(beneficiarioId)
    const concepto = nombre
      ? `Pago de comisiones a ${nombre}`
      : `Pago de comisiones al ${quienes}`

    // Redondeo a 2 decimales: el monto sale de sumar comisiones ya
    // redondeadas por la vista, pero la suma en coma flotante puede dejar
    // una cola (p.ej. 70.00000000000001) y la columna es DECIMAL(10,2).
    const monto = Math.round(datos.monto * 100) / 100

    const { data: movimiento, error } = await supabaseAdmin
      .from("movimientos_caja")
      .insert({
        organization_id: opts.organizationId,
        sucursal_id: opts.sucursalId,
        sesion_caja_id: sesion?.id || null,
        tipo: "EGRESO",
        monto,
        metodo_pago: opts.metodoPago,
        concepto,
        observaciones: [
          `${datos.referencias.length} ${opts.origenTipo === "COMISION_TECNICO" ? "orden(es)" : "venta(s)"}`,
          opts.notas?.trim() || null,
        ]
          .filter(Boolean)
          .join(" · "),
        usuario_id: opts.userId,
        // La comisión ya se resta devengada en el Estado de Resultados. Si
        // esto contara como gasto operativo se restaría dos veces.
        afecta_rentabilidad: false,
        origen_tipo: opts.origenTipo,
        origen_id: beneficiarioId === "SIN_ASIGNAR" ? null : beneficiarioId,
      })
      .select("id")
      .single()

    if (error || !movimiento) {
      console.error("Error registrando egreso de comisiones:", error)
      continue
    }

    for (const ref of datos.referencias) {
      resultado.movimientoPorReferencia.set(ref, movimiento.id)
    }
    resultado.totalRegistrado += monto
    resultado.movimientosCreados++
  }

  return resultado
}

/**
 * Anula los egresos de caja de un pago de comisiones que se revirtió.
 *
 * Un movimiento cubre varias órdenes, así que sólo se anula cuando ya no
 * queda ninguna orden pagada apuntándole: revertir 1 de 10 órdenes no borra
 * el pago de las otras 9.
 *
 * Lo que NO hace: ajustar el monto del movimiento cuando se revierte parte
 * del lote. El movimiento representa una salida de plata que ya ocurrió; si
 * el técnico devolvió parte, eso es un ingreso nuevo, no una corrección de
 * la fila vieja. Corregirla en silencio sería reescribir un arqueo ya hecho.
 */
export async function anularEgresoComisionesHuerfanos(opts: {
  organizationId: string
  userId: string
  movimientoIds: string[]
  /** "ordenes_servicio" o "ventas": dónde mirar si todavía hay pagos vivos. */
  tabla: "ordenes_servicio" | "ventas"
}): Promise<number> {
  const ids = Array.from(new Set(opts.movimientoIds.filter(Boolean)))
  if (ids.length === 0) return 0

  // ¿Qué movimientos siguen teniendo al menos una fila pagada apuntándoles?
  const { filas: vivos } = await traerTodoPorLotes<{ comision_pago_movimiento_id: string }>(
    ids,
    (lote, desde, hasta) =>
      supabaseAdmin
        .from(opts.tabla)
        .select("comision_pago_movimiento_id")
        .eq("organization_id", opts.organizationId)
        .eq("comision_pagada", true)
        .in("comision_pago_movimiento_id", lote)
        .order("comision_pago_movimiento_id", { ascending: true })
        .range(desde, hasta)
  )

  const conPagosVivos = new Set(vivos.map((f) => f.comision_pago_movimiento_id))
  const huerfanos = ids.filter((id) => !conPagosVivos.has(id))
  if (huerfanos.length === 0) return 0

  const { data, error } = await supabaseAdmin
    .from("movimientos_caja")
    .update({
      anulado: true,
      anulado_at: new Date().toISOString(),
      anulado_por: opts.userId,
      anulado_motivo: "Se revirtió el pago de comisiones",
    })
    .eq("organization_id", opts.organizationId)
    .eq("anulado", false)
    .in("id", huerfanos)
    .select("id")

  if (error) {
    console.error("Error anulando egreso de comisiones:", error)
    return 0
  }

  return data?.length || 0
}

/** Nombres de los beneficiarios, para que el concepto del egreso diga quién cobró. */
export async function nombresDeUsuarios(ids: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  const unicos = Array.from(new Set(ids))
  if (unicos.length === 0) return mapa

  const { data } = await supabaseAdmin.from("users").select("id, nombre").in("id", unicos)
  for (const u of data || []) {
    if (u.nombre) mapa.set(u.id, u.nombre)
  }
  return mapa
}

/**
 * Guarda en cada fila el movimiento de caja que la pagó.
 *
 * Se agrupa por movimiento para hacer un UPDATE por egreso en vez de uno por
 * orden: un pago de 50 órdenes a 3 técnicos son 3 updates, no 50.
 */
export async function enlazarMovimientoComision(
  tabla: "ordenes_servicio" | "ventas",
  organizationId: string,
  movimientoPorReferencia: Map<string, string>
): Promise<void> {
  if (movimientoPorReferencia.size === 0) return

  const porMovimiento = new Map<string, string[]>()
  for (const [referenciaId, movimientoId] of movimientoPorReferencia) {
    const lista = porMovimiento.get(movimientoId) || []
    lista.push(referenciaId)
    porMovimiento.set(movimientoId, lista)
  }

  for (const [movimientoId, referencias] of porMovimiento) {
    const { error } = await supabaseAdmin
      .from(tabla)
      .update({ comision_pago_movimiento_id: movimientoId })
      .eq("organization_id", organizationId)
      .in("id", referencias)
    if (error) {
      // No es fatal: el pago y el egreso ya quedaron. Lo que se pierde es
      // poder anular el egreso automáticamente al revertir.
      console.error("Error enlazando movimiento de comisiones:", error)
    }
  }
}
