/**
 * La orden de re-ingreso por garantía. Un solo lugar la crea: aceptar un
 * reclamo (lib/garantias/reclamos.ts → aceptarReclamo), que usan tanto la
 * decisión del ADMIN como el atajo "Re-ingreso por garantía" del menú de la
 * orden. Ninguna ruta inserta re-ingresos por su cuenta.
 *
 * La orden nace como cualquier otra (número y código por tipo de equipo,
 * public_token, sucursal) más los vínculos:
 *   - es_reingreso = true (métricas de técnicos y comisiones, 381),
 *   - orden_origen_id = la orden original (null si la garantía es de una venta),
 *   - garantia_origen_id = la garantía reclamada (de reparación o de venta).
 * Sin recibido_por a propósito: un re-ingreso por garantía no comisiona
 * recepción (ver lib/__tests__/comisiones-calculo-sweep.test.ts).
 */
import { randomBytes } from "crypto"
import { supabaseAdmin } from "@/lib/supabase"
import { getNextOrderNumberByType } from "@/lib/counters"
import { getPrincipalId } from "@/lib/sucursal"
import { deletePracticeData } from "@/lib/onboarding/practica"
import { createAuditLogger } from "@/lib/audit"
import { isPlanLimitError, planLimitErrorResponse } from "@/lib/plan-limits"
import { notificarReingresoGarantia } from "./notificar"
import { numeroReferencia, type FilaVistaGarantia } from "./listado"
import { ErrorReclamo } from "./errores"

export interface OrdenReingreso {
  id: string
  numero_orden: number
  codigo_orden: string | null
  public_token: string | null
  sucursal_id: string | null
  cliente_id: string
  dispositivo: string
}

const TIPO_SIN_DATOS = "OTRO"

async function tipoDispositivoDeVenta(garantiaVentaId: string): Promise<string> {
  try {
    const { data: gv } = await supabaseAdmin
      .from("garantias_venta")
      .select("item_venta_id")
      .eq("id", garantiaVentaId)
      .maybeSingle()
    if (!gv?.item_venta_id) return TIPO_SIN_DATOS
    const { data: item } = await supabaseAdmin
      .from("items_venta")
      .select("inventario_id")
      .eq("id", gv.item_venta_id)
      .maybeSingle()
    if (!item?.inventario_id) return TIPO_SIN_DATOS
    const { data: inv } = await supabaseAdmin
      .from("inventario")
      .select("tipo_dispositivo")
      .eq("id", item.inventario_id)
      .maybeSingle()
    const tipo = (inv?.tipo_dispositivo as string | null) ?? null
    return tipo && tipo !== "TODOS" ? tipo : TIPO_SIN_DATOS
  } catch {
    return TIPO_SIN_DATOS
  }
}

export interface ParametrosReingreso {
  organizationId: string
  userId: string
  garantia: FilaVistaGarantia
  reclamo: { id: string; descripcion: string }
  request?: Request
}

/**
 * Crea la orden de re-ingreso de un reclamo aceptado, con sus eventos, la
 * auditoría y el aviso REINGRESO_GARANTIA al cliente. Lanza ErrorReclamo si
 * falta algo para crearla (la venta sin cliente, el límite del plan).
 */
export async function crearOrdenReingreso(p: ParametrosReingreso): Promise<OrdenReingreso> {
  const { organizationId, userId, garantia, reclamo } = p
  const esVenta = garantia.origen === "VENTA"
  const referencia = numeroReferencia(garantia)

  let base: Record<string, unknown>
  let ordenOrigen: { id: string; codigo_orden: string | null; numero_orden: number } | null = null
  let tipoDispositivo: string

  if (esVenta) {
    if (!garantia.cliente_id) {
      throw new ErrorReclamo(
        409,
        "VENTA_SIN_CLIENTE",
        "La venta no tiene un cliente registrado. Asociá un cliente a la venta antes de aceptar el reclamo."
      )
    }
    tipoDispositivo = await tipoDispositivoDeVenta(garantia.id)
    base = {
      cliente_id: garantia.cliente_id,
      dispositivo: garantia.descripcion?.trim() || "Producto vendido",
      tipo_dispositivo: tipoDispositivo,
      metadata: {},
      observaciones: `Re-ingreso por garantía de la venta ${referencia}${
        garantia.numero_garantia ? ` (certificado ${garantia.numero_garantia})` : ""
      }`,
      orden_origen_id: null,
    }
  } else {
    const { data: orden, error } = await supabaseAdmin
      .from("ordenes_servicio")
      .select(
        "id, numero_orden, codigo_orden, cliente_id, dispositivo, tipo_dispositivo, marca, color, imei, " +
          "accesorios, password_dispositivo, metadata, sector_id"
      )
      .eq("id", garantia.orden_id as string)
      .eq("organization_id", organizationId)
      .single()
    if (error || !orden) throw new ErrorReclamo(404, "ORDEN_NO_ENCONTRADA", "Orden original no encontrada")
    const o = orden as unknown as Record<string, any>
    ordenOrigen = { id: o.id, codigo_orden: o.codigo_orden ?? null, numero_orden: o.numero_orden }
    tipoDispositivo = o.tipo_dispositivo || TIPO_SIN_DATOS
    base = {
      cliente_id: o.cliente_id,
      dispositivo: o.dispositivo,
      tipo_dispositivo: tipoDispositivo,
      marca: o.marca ?? null,
      color: o.color ?? null,
      imei: o.imei ?? null,
      accesorios: o.accesorios ?? null,
      password_dispositivo: o.password_dispositivo ?? null,
      metadata: o.metadata || {},
      sector_id: o.sector_id ?? null,
      observaciones: `Re-ingreso por garantía de la orden ${referencia}`,
      orden_origen_id: o.id,
    }
  }

  // La sucursal de la orden o la venta original; si no tiene, la principal.
  const sucursalId = garantia.sucursal_id ?? (await getPrincipalId(organizationId))
  if (!sucursalId) {
    throw new ErrorReclamo(500, "SIN_SUCURSAL", "No se pudo determinar la sucursal del re-ingreso")
  }

  // Número y código como cualquier orden (POST /api/ordenes): después de toda
  // validación, porque la RPC consume el contador.
  const { codigo, numero } = await getNextOrderNumberByType(organizationId, tipoDispositivo)

  const { data: nueva, error: insertError } = await supabaseAdmin
    .from("ordenes_servicio")
    .insert({
      ...base,
      numero_orden: numero,
      codigo_orden: codigo,
      organization_id: organizationId,
      problema_reportado: reclamo.descripcion,
      public_token: randomBytes(16).toString("hex"),
      estado: "RECIBIDO",
      sucursal_id: sucursalId,
      es_reingreso: true,
      garantia_origen_id: garantia.id,
    })
    .select("id, numero_orden, codigo_orden, public_token, sucursal_id, cliente_id, dispositivo")
    .single()

  if (insertError || !nueva) {
    if (isPlanLimitError(insertError)) {
      throw new ErrorReclamo(403, "PLAN_LIMIT_EXCEEDED", "Límite del plan", {}, planLimitErrorResponse(insertError!))
    }
    throw insertError ?? new Error("No se pudo crear la orden de re-ingreso")
  }
  const orden = nueva as unknown as OrdenReingreso
  const numeroNueva = orden.codigo_orden || `#${orden.numero_orden}`

  // The first real order replaces the onboarding practice. A failure never
  // affects this order: the next real order retries.
  try {
    await deletePracticeData(organizationId)
  } catch (err) {
    console.error("[practica] automatic deletion failed:", err)
  }

  // Historial: la orden nueva y, si hay, la original. Un fallo acá no deshace el re-ingreso.
  const eventos: Record<string, unknown>[] = [
    {
      orden_id: orden.id,
      organization_id: organizationId,
      tipo: "CAMBIO_ESTADO",
      estado_nuevo: "RECIBIDO",
      descripcion: esVenta
        ? `Orden creada como re-ingreso por garantía de la venta ${referencia}`
        : `Orden creada como re-ingreso por garantía de la orden ${referencia}`,
      metadata: { reclamoId: reclamo.id, garantiaId: garantia.id, origen: garantia.origen, ordenOrigenId: ordenOrigen?.id ?? null },
      created_by: userId,
    },
  ]
  if (ordenOrigen) {
    eventos.push({
      orden_id: ordenOrigen.id,
      organization_id: organizationId,
      tipo: "NOTA",
      descripcion: `Re-ingreso por garantía creado: orden ${numeroNueva}`,
      metadata: { reingresoOrdenId: orden.id, reclamoId: reclamo.id },
      created_by: userId,
    })
  }
  try {
    const { error } = await supabaseAdmin.from("orden_eventos").insert(eventos)
    if (error) console.error("Error registrando los eventos del re-ingreso:", error.message)
  } catch (err) {
    console.error("Error registrando los eventos del re-ingreso:", err)
  }

  try {
    await createAuditLogger(organizationId, userId, p.request).create("ordenes_servicio", orden.id, {
      tipo: "reingreso",
      origen: garantia.origen,
      orden_origen_id: ordenOrigen?.id ?? null,
      garantia_origen_id: garantia.id,
      reclamo_id: reclamo.id,
      numero_orden: orden.numero_orden,
    })
  } catch (err) {
    console.error("Error auditando el re-ingreso:", err)
  }

  void notificarReingresoGarantia({ organizationId, garantia, orden })

  return orden
}
