import { NextResponse } from "next/server"
import { z } from "zod"
import { requireCajaAccess } from "@/lib/auth-utils"
import { supabaseAdmin } from "@/lib/supabase"
import { sucursalParaLectura } from "@/lib/sucursal"
import { logAudit, type AuditEntity } from "@/lib/audit"

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
})

type Fuente = z.infer<typeof bodySchema>["fuente"]

const ES_TARJETA = (m: string) => m === "TARJETA_DEBITO" || m === "TARJETA_CREDITO"

interface Origen {
  metodoPago: string
  fecha: string
  sucursalId: string | null
  /** Sesión explícita (solo movimientos manuales la guardan). */
  sesionEstado?: string | null
  /** Motivo por el que el registro no es corregible (anulado, etc). */
  bloqueo?: string
  /** Entidad y id para la auditoría. */
  auditEntity: AuditEntity
  auditEntityId: string
  ventaId?: string
}

// Carga el registro original scopeado a la org. `null` = no existe o es de
// otra org (se responde 404 igual en ambos casos).
async function cargarOrigen(fuente: Fuente, id: string, orgId: string): Promise<Origen | null> {
  switch (fuente) {
    case "cobros_orden": {
      const { data } = await supabaseAdmin
        .from("cobros_orden")
        .select("id, metodo_pago, created_at, anulado, orden_id, ordenes_servicio:orden_id!inner(sucursal_id)")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle()
      if (!data) return null
      return {
        metodoPago: data.metodo_pago,
        fecha: data.created_at,
        sucursalId: (data as any).ordenes_servicio?.sucursal_id ?? null,
        bloqueo: data.anulado ? "El cobro está anulado" : undefined,
        auditEntity: "ordenes_servicio",
        auditEntityId: data.orden_id,
      }
    }
    case "pagos_parciales": {
      const { data } = await supabaseAdmin
        .from("pagos_parciales")
        .select(`
          id, metodo_pago, fecha, factura_id,
          facturas!inner(estado_pago, ordenes_servicio!inner(organization_id, sucursal_id))
        `)
        .eq("id", id)
        .eq("facturas.ordenes_servicio.organization_id", orgId)
        .maybeSingle()
      if (!data) return null
      const factura = (data as any).facturas
      return {
        metodoPago: data.metodo_pago,
        fecha: data.fecha,
        sucursalId: factura?.ordenes_servicio?.sucursal_id ?? null,
        bloqueo: factura?.estado_pago === "ANULADA" ? "El remito está anulado" : undefined,
        auditEntity: "facturas",
        auditEntityId: data.factura_id,
      }
    }
    case "pagos_venta": {
      const { data } = await supabaseAdmin
        .from("pagos_venta")
        .select("id, metodo_pago, fecha, venta_id, ventas!inner(organization_id, estado, sucursal_id)")
        .eq("id", id)
        .eq("ventas.organization_id", orgId)
        .maybeSingle()
      if (!data) return null
      const venta = (data as any).ventas
      return {
        metodoPago: data.metodo_pago,
        fecha: data.fecha,
        sucursalId: venta?.sucursal_id ?? null,
        bloqueo: venta?.estado === "ANULADA" ? "La venta está anulada" : undefined,
        auditEntity: "ventas",
        auditEntityId: data.venta_id,
        ventaId: data.venta_id,
      }
    }
    case "cuenta_corriente": {
      const { data } = await supabaseAdmin
        .from("cuenta_corriente")
        .select("id, metodo_pago, created_at, tipo, sucursal_id")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle()
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
      const { data } = await supabaseAdmin
        .from("movimientos_caja")
        .select("id, metodo_pago, fecha, sucursal_id, sesiones_caja:sesion_caja_id(estado)")
        .eq("id", id)
        .eq("organization_id", orgId)
        .maybeSingle()
      if (!data) return null
      return {
        metodoPago: data.metodo_pago,
        fecha: data.fecha,
        sucursalId: data.sucursal_id ?? null,
        sesionEstado: (data as any).sesiones_caja?.estado ?? null,
        auditEntity: "movimientos_caja",
        auditEntityId: data.id,
      }
    }
  }
}

// ¿El movimiento cae dentro de una sesión de caja ya cerrada? El cierre
// congela los totales del arqueo (opened_at..closed_at, ver
// sesiones/[id]/cerrar), así que cambiarle el método después descuadra el
// historial. Una sesión sin sucursal abarca toda la org.
async function caeEnSesionCerrada(orgId: string, fecha: string, sucursalId: string | null) {
  const { data } = await supabaseAdmin
    .from("sesiones_caja")
    .select("id, sucursal_id")
    .eq("organization_id", orgId)
    .eq("estado", "CERRADA")
    .lte("opened_at", fecha)
    .gte("closed_at", fecha)
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
    const { fuente, id, metodoPago } = parsed.data

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
      return NextResponse.json({ error: origen.bloqueo }, { status: 400 })
    }

    if (origen.metodoPago === "CUENTA_CORRIENTE") {
      return NextResponse.json(
        { error: "Un pago a cuenta corriente no se puede cambiar desde la caja" },
        { status: 400 }
      )
    }

    if (origen.metodoPago === metodoPago) {
      return NextResponse.json({ ok: true, metodoPago })
    }

    const sesionCerrada =
      origen.sesionEstado === "CERRADA" ||
      (await caeEnSesionCerrada(organizationId!, origen.fecha, origen.sucursalId))
    if (sesionCerrada) {
      return NextResponse.json(
        { error: "No se puede modificar un movimiento de una sesión de caja cerrada" },
        { status: 400 }
      )
    }

    const update: Record<string, unknown> = { metodo_pago: metodoPago }
    // Cuotas, recargo y costo de terminal solo tienen sentido con tarjeta:
    // mismo criterio que MultiPagoInput al cambiar de método. Si no se
    // limpian, un pago pasado a efectivo seguiría restando "costo terminal".
    if (
      (fuente === "pagos_venta" || fuente === "pagos_parciales" || fuente === "cobros_orden") &&
      !ES_TARJETA(metodoPago)
    ) {
      update.cuotas = null
      update.recargo_porcentaje = null
      update.monto_original = null
      update.costo_financiero_porcentaje = null
      update.costo_financiero_monto = null
    }

    const { error: updateError } = await supabaseAdmin
      .from(fuente)
      .update(update)
      .eq("id", id)
    if (updateError) {
      console.error("Error actualizando método de pago:", updateError)
      return NextResponse.json({ error: "Error al actualizar el método de pago" }, { status: 500 })
    }

    // ventas.metodo_pago es el método "de cabecera" que muestran el listado y
    // el detalle. Con un único pago tiene que seguir coincidiendo con él; con
    // pagos combinados se deja como está.
    if (origen.ventaId) {
      const { data: pagos } = await supabaseAdmin
        .from("pagos_venta")
        .select("id")
        .eq("venta_id", origen.ventaId)
      if ((pagos || []).length === 1) {
        await supabaseAdmin
          .from("ventas")
          .update({ metodo_pago: metodoPago })
          .eq("id", origen.ventaId)
          .eq("organization_id", organizationId!)
      }
    }

    await logAudit({
      organizationId: organizationId!,
      userId: userId!,
      action: "UPDATE",
      entity: origen.auditEntity,
      entityId: origen.auditEntityId,
      changes: {
        before: { metodo_pago: origen.metodoPago },
        after: { metodo_pago: metodoPago },
      },
      description: `Corrigió el método de pago en caja (${fuente} #${id.slice(-6)}): ${origen.metodoPago} → ${metodoPago}`,
    })

    return NextResponse.json({ ok: true, metodoPago })
  } catch (err) {
    console.error("Error corrigiendo método de pago:", err)
    return NextResponse.json({ error: "Error al actualizar el método de pago" }, { status: 500 })
  }
}
