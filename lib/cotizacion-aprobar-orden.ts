import { supabaseAdmin } from "./supabase"
import { queueNotification } from "./notifications/queue"

/**
 * Datos mínimos de la orden vinculada necesarios para transicionarla a
 * APROBADO y notificar al cliente. Coincide con el shape que ya piden
 * las rutas públicas de aprobación (join de clientes + organizations).
 */
export interface OrdenParaAprobacionCotizacion {
  id: string
  estado: string
  organization_id: string
  cliente_id: string
  numero_orden: number
  dispositivo: string
  public_token?: string | null
  clientes?: { id: string; nombre: string; email?: string | null; telefono: string } | null
  organizations?: {
    nombre?: string | null
    nombre_mostrar?: string | null
    slug?: string | null
    moneda?: string | null
    zona_horaria?: string | null
  } | null
}

export interface AplicarAprobacionCotizacionParams {
  orden: OrdenParaAprobacionCotizacion
  cotizacionId: string
  cotizacionTotal: number
  /** Texto exacto a guardar en orden_eventos.descripcion. */
  descripcionEvento: string
  /** Metadata exacta a guardar en orden_eventos.metadata. */
  metadataEvento?: Record<string, unknown>
  /**
   * Si la aprobación vino del portal público del cliente. Controla
   * `ordenes_servicio.presupuesto_aprobado_portal`. Default true (los tres
   * orígenes actuales — dos portales + firma presencial — sólo el último
   * pasa `false`).
   */
  aprobadoDesdePortal?: boolean
  /** orden_eventos.created_by — sólo aplica cuando hay un usuario autenticado detrás (firma presencial). */
  actorUserId?: string | null
  /** Columnas extra a mergear en el UPDATE de ordenes_servicio (ej. firma subida a storage). */
  camposAdicionalesOrden?: Record<string, unknown>
}

/**
 * Transiciona la orden vinculada a una cotización de PRESUPUESTADO a
 * APROBADO, registra el evento en orden_eventos y encola la notificación
 * de cambio de estado. Usado por las tres vías de aprobación de cotización
 * (portal por token de cotización, portal por token de orden y firma
 * presencial en el local) para evitar que cada una reimplemente la misma
 * lógica con el riesgo de que alguna quede desactualizada.
 *
 * No hace nada (y devuelve false) si la orden no está en PRESUPUESTADO —
 * esto preserva el comportamiento previo de las rutas públicas, donde la
 * transición es un efecto condicional, no obligatorio.
 */
export async function aplicarAprobacionCotizacionAOrden(
  params: AplicarAprobacionCotizacionParams
): Promise<boolean> {
  const {
    orden,
    cotizacionId,
    cotizacionTotal,
    descripcionEvento,
    metadataEvento,
    aprobadoDesdePortal = true,
    actorUserId,
    camposAdicionalesOrden,
  } = params

  if (orden.estado !== "PRESUPUESTADO") return false

  const { error: updateError } = await supabaseAdmin
    .from("ordenes_servicio")
    .update({
      estado: "APROBADO",
      presupuesto: cotizacionTotal,
      costo_final: cotizacionTotal,
      presupuesto_aprobado_portal: aprobadoDesdePortal,
      presupuesto_fecha_aprobacion: new Date().toISOString(),
      ...camposAdicionalesOrden,
    })
    .eq("id", orden.id)

  if (updateError) throw updateError

  await supabaseAdmin.from("orden_eventos").insert({
    orden_id: orden.id,
    organization_id: orden.organization_id,
    tipo: "PRESUPUESTO_APROBADO",
    estado_anterior: "PRESUPUESTADO",
    estado_nuevo: "APROBADO",
    descripcion: descripcionEvento,
    metadata: metadataEvento ?? {},
    ...(actorUserId ? { created_by: actorUserId } : {}),
  })

  const org = orden.organizations
  const cliente = orden.clientes

  queueNotification({
    organizationId: orden.organization_id,
    ordenId: orden.id,
    clienteId: orden.cliente_id,
    tipo: "CAMBIO_ESTADO",
    context: {
      organizationName: org?.nombre_mostrar || org?.nombre || "",
      organizationSlug: org?.slug ?? undefined,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
      cliente: {
        id: cliente?.id as string,
        nombre: cliente?.nombre as string,
        email: cliente?.email ?? null,
        telefono: cliente?.telefono as string,
      },
      orden: {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        estado: "APROBADO",
        estadoAnterior: "PRESUPUESTADO",
        presupuesto: cotizacionTotal,
        publicToken: orden.public_token,
      },
    },
  }).catch((err) => console.error("Error sending notification:", err))

  return true
}
