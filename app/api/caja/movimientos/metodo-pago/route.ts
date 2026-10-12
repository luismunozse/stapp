import { NextResponse } from "next/server"
import { z } from "zod"
import { requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { logAudit, type AuditEntity } from "@/lib/audit"
import { esErrorColumnaOrigen, esOrigenNoEliminable, resolverOrigen } from "@/lib/caja-utils"

// Métodos a los que se puede corregir un movimiento. CUENTA_CORRIENTE queda
// afuera a propósito: pasar de/a fiado no es "corregir una etiqueta", mueve la
// deuda del cliente (usar_cuenta_corriente / reconciliación del fiado) y eso
// se hace anulando y volviendo a cobrar, no desde la caja.
const METODOS_CORREGIBLES = [
  "EFECTIVO",
  "TRANSFERENCIA",
  "TARJETA_DEBITO",
  "TARJETA_CREDITO",
  "MERCADOPAGO",
  "OTRO",
] as const

const bodySchema = z.object({
  fuente: z.enum([
    "cobros_orden",
    "pagos_parciales",
    "pagos_venta",
    "cuenta_corriente",
    "movimientos_caja",
  ]),
  id: z.string().min(1),
  metodoPago: z.enum(METODOS_CORREGIBLES),
  // % que cobra la terminal. Solo se usa si el destino es débito o crédito; con
  // cualquier otro método se descarta. Omitido = no tocar el costo ya guardado.
  costoFinancieroPorcentaje: z.number().min(0).max(100).nullable().optional(),
})

type Fuente = z.infer<typeof bodySchema>["fuente"]

// Columnas de tarjeta que solo valen para TARJETA_CREDITO. Débito tampoco lleva
// cuotas ni recargo (ver PATCH), así que se limpian al salir de crédito. Los
// selects de abajo repiten la lista como literal para que PostgREST la tipe.
const COLUMNAS_TARJETA = [
  "cuotas",
  "recargo_porcentaje",
  "monto_original",
  "costo_financiero_porcentaje",
  "costo_financiero_monto",
] as const

interface Origen {
  metodoPago: string
  /** Monto del pago (base del costo de terminal); solo las fuentes de pago lo traen. */
  monto?: number
  fecha: string
  sucursalId: string | null
  /** Sesión explícita (solo movimientos manuales la guardan). */
  sesionEstado?: string | null
  /** Motivo por el que el registro no es corregible (anulado, etc). */
  bloqueo?: string
  /** Status HTTP del bloqueo (400 por defecto). */
  bloqueoStatus?: number
  /** Valores previos de las columnas de tarjeta (para la auditoría). */
  previos?: Record<string, unknown>
  /** Entidad y id para la auditoría. */
  auditEntity: AuditEntity
  auditEntityId: string
  ventaId?: string
}

function leerOrigenFallo(tabla: string, error: unknown): Error {
  console.error(`Error leyendo ${tabla} para corregir el método de pago:`, error)
  return new Error(`No se pudo leer ${tabla}`)
}

function extraerPrevios(row: any): Record<string, unknown> {
  const previos: Record<string, unknown> = {}
  for (const col of COLUMNAS_TARJETA) previos[col] = row?.[col] ?? null
  return previos
}

// Carga el registro original scopeado a la org. `null` = no existe o es de
// otra org (se responde 404 igual en ambos casos). Si la consulta falla lanza:
// una caída de la DB no es "no encontrado" (el PATCH la responde con 500).
async function cargarOrigen(fuente: Fuente, id: string, orgId: string): Promise<Origen | null> {
  switch (fuente) {
    case "cobros_orden": {
      const { data, error } = await supabaseAdmin
        .from("cobros_orden")
        .select(
          `id, monto, metodo_pago, created_at, anulado, orden_id, cuotas, recargo_porcentaje, monto_original, costo_financiero_porcentaje, costo_financiero_monto, ordenes_servicio:orden_id!inner(sucursal_id)`
        )
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle()
      if (error) throw leerOrigenFallo("cobros_orden", error)
      if (!data) return null
      return {
        metodoPago: data.metodo_pago,
        monto: Number(data.monto),
        fecha: data.created_at,
        sucursalId: (data as any).ordenes_servicio?.sucursal_id ?? null,
        bloqueo: data.anulado ? "El cobro está anulado" : undefined,
        auditEntity: "ordenes_servicio",
        auditEntityId: data.orden_id,
        previos: extraerPrevios(data),
      }
    }
    case "pagos_parciales": {
      const { data, error } = await supabaseAdmin
        .from("pagos_parciales")
        .select(`
          id, monto, metodo_pago, fecha, factura_id, cuotas, recargo_porcentaje, monto_original, costo_financiero_porcentaje, costo_financiero_monto,
          facturas!inner(estado_pago, ordenes_servicio!inner(organization_id, sucursal_id))
        `)
        .eq("id", id)
        .eq("facturas.ordenes_servicio.organization_id", orgId)
        .maybeSingle()
      if (error) throw leerOrigenFallo("pagos_parciales", error)
      if (!data) return null
      const factura = (data as any).facturas
      return {
        metodoPago: data.metodo_pago,
        monto: Number(data.monto),
        fecha: data.fecha,
        sucursalId: factura?.ordenes_servicio?.sucursal_id ?? null,
        bloqueo: factura?.estado_pago === "ANULADA" ? "El remito está anulado" : undefined,
        auditEntity: "facturas",
        auditEntityId: data.factura_id,
        previos: extraerPrevios(data),
      }
    }
    case "pagos_venta": {
      const { data, error } = await supabaseAdmin
        .from("pagos_venta")
        .select(
          `id, monto, metodo_pago, fecha, venta_id, cuotas, recargo_porcentaje, monto_original, costo_financiero_porcentaje, costo_financiero_monto, ventas!inner(organization_id, estado, sucursal_id)`
        )
        .eq("id", id)
        .eq("ventas.organization_id", orgId)
        .maybeSingle()
      if (error) throw leerOrigenFallo("pagos_venta", error)
      if (!data) return null
      const venta = (data as any).ventas
      return {
        metodoPago: data.metodo_pago,
        monto: Number(data.monto),
        fecha: data.fecha,
        sucursalId: venta?.sucursal_id ?? null,
        bloqueo: venta?.estado === "ANULADA" ? "La venta está anulada" : undefined,
        auditEntity: "ventas",
        auditEntityId: data.venta_id,
        ventaId: data.venta_id,
        previos: extraerPrevios(data),
      }
    }
    case "cuenta_corriente": {
      const { data, error } = await supabaseAdmin
        .from("cuenta_corriente")
        .select("id, metodo_pago, created_at, tipo, sucursal_id")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle()
      if (error) throw leerOrigenFallo("cuenta_corriente", error)
      if (!data) return null
      return {
        metodoPago: data.metodo_pago,
        fecha: data.created_at,
        sucursalId: data.sucursal_id ?? null,
        bloqueo: data.tipo !== "DEPOSITO" ? "Solo se pueden corregir depósitos" : undefined,
        auditEntity: "cuenta_corriente",
        auditEntityId: data.id,
      }
    }
    case "movimientos_caja": {
      const selectMovimiento = (columnas: string) =>
        supabaseAdmin
          .from("movimientos_caja")
          .select(columnas)
          .eq("id", id)
          .eq("organization_id", orgId)
          .maybeSingle()
      const sesion = "sesiones_caja:sesion_caja_id(estado)"
      let { data, error } = await selectMovimiento(
        `id, metodo_pago, fecha, sucursal_id, origen, ${sesion}`
      )
      // Mig 335 sin aplicar: sin la columna origen se deduce del concepto
      // (mismo respaldo que el DELETE de movimientos).
      if (error && esErrorColumnaOrigen(error)) {
        ;({ data, error } = await selectMovimiento(
          `id, metodo_pago, fecha, sucursal_id, tipo, afecta_rentabilidad, es_recurrente, concepto, ${sesion}`
        ))
      }
      if (error) throw leerOrigenFallo("movimientos_caja", error)
      if (!data) return null
      const mov = data as any
      // Mismo guard que el DELETE: lo que escribe el sistema (devolución, nota
      // de crédito, COGS) no se re-etiqueta desde caja.
      const delSistema = esOrigenNoEliminable(resolverOrigen(mov))
      return {
        metodoPago: mov.metodo_pago,
        fecha: mov.fecha,
        sucursalId: mov.sucursal_id ?? null,
        sesionEstado: mov.sesiones_caja?.estado ?? null,
        bloqueo: delSistema
          ? "Este movimiento lo generó el sistema (devolución o nota de crédito) y no se puede modificar desde caja."
          : undefined,
        bloqueoStatus: delSistema ? 409 : undefined,
        auditEntity: "movimientos_caja",
        auditEntityId: mov.id,
      }
    }
  }
}

// ¿El movimiento cae dentro de una sesión de caja ya cerrada? El cierre
// congela los totales del arqueo (opened_at..closed_at, ver
// sesiones/[id]/cerrar), así que cambiarle el método después descuadra el
// historial. Una sesión sin sucursal abarca toda la org.
// Devuelve null si la consulta falla: quien llama debe fallar CERRADO.
async function caeEnSesionCerrada(
  orgId: string,
  fecha: string,
  sucursalId: string | null
): Promise<boolean | null> {
  const { data, error } = await supabaseAdmin
    .from("sesiones_caja")
    .select("id, sucursal_id")
    .eq("organization_id", orgId)
    .eq("estado", "CERRADA")
    .lte("opened_at", fecha)
    .gte("closed_at", fecha)
  if (error) {
    console.error("Error consultando sesiones de caja:", error)
    return null
  }
  return (data || []).some(
    (s: any) => s.sucursal_id == null || sucursalId == null || s.sucursal_id === sucursalId
  )
}

// PATCH - Corregir el medio de pago de un movimiento de caja.
//
// La caja no tiene filas propias para ventas/cobros: lee las tablas de pagos
// (ver fetchMovimientosDia). Por eso la corrección se hace sobre el registro
// original, y la caja, el arqueo y los reportes la ven sola.
export async function PATCH(request: Request) {
  try {
    const { error, organizationId, role, session, userId } = await requireCajaAccess()
    if (error) return error

    const parsed = bodySchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: "Datos inválidos" }, { status: 400 })
    }
    const { fuente, id, metodoPago, costoFinancieroPorcentaje } = parsed.data

    const origen = await cargarOrigen(fuente, id, organizationId!)
    if (!origen) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
    }

    // Sucursal: el usuario de una sucursal solo corrige movimientos de la suya.
    const filtro = await sucursalParaLectura({
      role,
      userSucursalId: session!.user.sucursalId ?? null,
    })
    if (!filtro.verTodas && filtro.sucursalId && origen.sucursalId !== filtro.sucursalId) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 })
    }

    if (origen.bloqueo) {
      return NextResponse.json({ error: origen.bloqueo }, { status: origen.bloqueoStatus ?? 400 })
    }

    if (origen.metodoPago === "CUENTA_CORRIENTE") {
      return NextResponse.json(
        { error: "Un pago a cuenta corriente no se puede cambiar desde la caja" },
        { status: 400 }
      )
    }

    // Cronograma de cuotas (cuotas_cobro) de un cobro de orden. Solo existe
    // mientras el cobro es TARJETA_CREDITO: si el método guardado ya no lo es y
    // quedan filas, son huérfanas (el borrado falló después de cambiar el método
    // en un intento anterior). Se limpian ANTES del corte por "mismo método",
    // si no, el reintento no las vería nunca.
    let cuotasBorradas: number | null = null
    if (fuente === "cobros_orden" && origen.metodoPago !== "TARJETA_CREDITO") {
      const { data: huerfanas, error: huerfanasError } = await supabaseAdmin
        .from("cuotas_cobro")
        .select("id")
        .eq("cobro_id", id)
        .eq("organization_id", organizationId!)
      if (huerfanasError) {
        console.error("Error leyendo cuotas del cobro:", huerfanasError)
        return NextResponse.json({ error: "Error al verificar las cuotas del cobro" }, { status: 500 })
      }
      if ((huerfanas || []).length > 0) {
        const { error: deleteError } = await supabaseAdmin
          .from("cuotas_cobro")
          .delete()
          .eq("cobro_id", id)
          .eq("organization_id", organizationId!)
        if (deleteError) {
          console.error("Error borrando cuotas huérfanas del cobro:", deleteError)
          return NextResponse.json({ error: "No se pudieron borrar las cuotas del cobro" }, { status: 500 })
        }
        cuotasBorradas = huerfanas!.length
      }
    }

    if (origen.metodoPago === metodoPago) {
      if (cuotasBorradas) {
        await logAudit({
          organizationId: organizationId!,
          userId: userId!,
          action: "UPDATE",
          entity: origen.auditEntity,
          entityId: origen.auditEntityId,
          changes: { before: { cuotas_borradas: cuotasBorradas }, after: { fuente, id } },
          description: `Limpió el cronograma de cuotas sobrante del cobro (${fuente} #${id.slice(-6)})`,
        })
      }
      return NextResponse.json({ ok: true, metodoPago })
    }

    let sesionCerrada = origen.sesionEstado === "CERRADA"
    if (!sesionCerrada) {
      const cae = await caeEnSesionCerrada(organizationId!, origen.fecha, origen.sucursalId)
      if (cae === null) {
        return NextResponse.json({ error: "Error al verificar la sesión de caja" }, { status: 500 })
      }
      sesionCerrada = cae
    }
    if (sesionCerrada) {
      return NextResponse.json(
        { error: "No se puede modificar un movimiento de una sesión de caja cerrada" },
        { status: 400 }
      )
    }

    const esFuentePago =
      fuente === "pagos_venta" || fuente === "pagos_parciales" || fuente === "cobros_orden"

    // Un cobro de orden en cuotas tiene cronograma en cuotas_cobro. La cuota 1
    // se marca pagada al cobrar; si hay otra pagada, el cronograma ya se usó y
    // no se puede borrar sin perder ese registro.
    const borrarCronograma =
      fuente === "cobros_orden" &&
      origen.metodoPago === "TARJETA_CREDITO" &&
      metodoPago !== "TARJETA_CREDITO"
    if (borrarCronograma) {
      const { data: cuotas, error: cuotasError } = await supabaseAdmin
        .from("cuotas_cobro")
        .select("id, numero_cuota, pagada")
        .eq("cobro_id", id)
        .eq("organization_id", organizationId!)
      if (cuotasError) {
        console.error("Error leyendo cuotas del cobro:", cuotasError)
        return NextResponse.json({ error: "Error al verificar las cuotas del cobro" }, { status: 500 })
      }
      if ((cuotas || []).some((c: any) => c.pagada && c.numero_cuota > 1)) {
        return NextResponse.json(
          { error: "El cobro tiene cuotas ya cobradas: no se puede cambiar el método de pago" },
          { status: 409 }
        )
      }
      cuotasBorradas = (cuotas || []).length
    }

    const update: Record<string, unknown> = { metodo_pago: metodoPago }
    const esTarjeta = metodoPago === "TARJETA_DEBITO" || metodoPago === "TARJETA_CREDITO"
    if (esFuentePago) {
      if (!esTarjeta) {
        // Un pago pasado a efectivo/transferencia/etc. no lleva cuotas, recargo
        // ni costo de terminal; si no, seguiría restando "costo terminal".
        for (const col of COLUMNAS_TARJETA) update[col] = null
      } else {
        // Débito tampoco lleva cuotas ni recargo (solo crédito). Crédito viene
        // de un método sin cuotas, así que queda como pago único (null).
        if (metodoPago === "TARJETA_DEBITO") {
          update.cuotas = null
          update.recargo_porcentaje = null
          update.monto_original = null
        }
        // Costo de terminal: mismo cálculo que al cobrar (monto del pago *
        // porcentaje, redondeado a 2 decimales; 0 o vacío = sin costo).
        if (costoFinancieroPorcentaje !== undefined) {
          const pct = costoFinancieroPorcentaje || null
          update.costo_financiero_porcentaje = pct
          update.costo_financiero_monto =
            pct && Number.isFinite(origen.monto)
              ? Math.round((origen.monto as number) * (pct / 100) * 100) / 100
              : null
        }
      }
    }

    let updateQuery = supabaseAdmin.from(fuente).update(update).eq("id", id)
    // Tablas con organization_id propio; pagos_venta y pagos_parciales se
    // validan por el join de cargarOrigen.
    if (fuente === "cobros_orden" || fuente === "cuenta_corriente" || fuente === "movimientos_caja") {
      updateQuery = updateQuery.eq("organization_id", organizationId!)
    }
    const { error: updateError } = await updateQuery
    if (updateError) {
      console.error("Error actualizando método de pago:", updateError)
      return NextResponse.json({ error: "Error al actualizar el método de pago" }, { status: 500 })
    }

    if (borrarCronograma) {
      // No transaccional: si falla, el método ya cambió y quedan cuotas huérfanas.
      const { error: deleteError } = await supabaseAdmin
        .from("cuotas_cobro")
        .delete()
        .eq("cobro_id", id)
        .eq("organization_id", organizationId!)
      if (deleteError) {
        console.error("Error borrando cuotas del cobro:", deleteError)
        return NextResponse.json(
          { error: "El método se actualizó pero no se pudieron borrar las cuotas del cobro" },
          { status: 500 }
        )
      }
    }

    // ventas.metodo_pago es el método "de cabecera" que muestran el listado y
    // el detalle. Con un único pago tiene que seguir coincidiendo con él; con
    // pagos combinados se deja como está.
    if (origen.ventaId) {
      const { data: pagos, error: pagosError } = await supabaseAdmin
        .from("pagos_venta")
        .select("id")
        .eq("venta_id", origen.ventaId)
      if (pagosError) {
        console.error("Error contando los pagos de la venta:", pagosError)
        return NextResponse.json({ error: "Error al actualizar el método de pago" }, { status: 500 })
      }
      // TODO: pago + cabecera no son atómicos; la atomicidad completa queda
      // diferida a una RPC.
      if ((pagos || []).length === 1) {
        const { error: ventaError } = await supabaseAdmin
          .from("ventas")
          .update({ metodo_pago: metodoPago })
          .eq("id", origen.ventaId)
          .eq("organization_id", organizationId!)
        if (ventaError) {
          console.error("Error actualizando método de la venta:", ventaError)
          return NextResponse.json({ error: "Error al actualizar el método de pago" }, { status: 500 })
        }
      }
    }

    // Valor que queda en la columna: el nuevo si se escribió, el previo si no.
    const valorFinal = (col: string) => (col in update ? update[col] : origen.previos?.[col] ?? null)

    await logAudit({
      organizationId: organizationId!,
      userId: userId!,
      action: "UPDATE",
      entity: origen.auditEntity,
      entityId: origen.auditEntityId,
      changes: {
        before: {
          metodo_pago: origen.metodoPago,
          ...(esFuentePago ? origen.previos : {}),
          ...(cuotasBorradas !== null ? { cuotas_borradas: cuotasBorradas } : {}),
        },
        after: {
          metodo_pago: metodoPago,
          fuente,
          id,
          ...(esFuentePago
            ? {
                costo_financiero_porcentaje: valorFinal("costo_financiero_porcentaje"),
                costo_financiero_monto: valorFinal("costo_financiero_monto"),
              }
            : {}),
        },
      },
      description: `Corrigió el método de pago en caja (${fuente} #${id.slice(-6)}): ${origen.metodoPago} → ${metodoPago}`,
    })

    return NextResponse.json({ ok: true, metodoPago })
  } catch (err) {
    console.error("Error corrigiendo método de pago:", err)
    return NextResponse.json({ error: "Error al actualizar el método de pago" }, { status: 500 })
  }
}
