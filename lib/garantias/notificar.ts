import { queueNotification } from "@/lib/notifications/queue"
import { DEFAULT_TIMEZONE } from "@/lib/timezone"

/**
 * Avisa al cliente que su garantía quedó registrada (GARANTIA_CREADA).
 *
 * Lo usan el alta manual (POST /api/garantias) y la entrega de la orden. Los
 * canales (email / WhatsApp) los decide sendNotificationDirect según la
 * configuración de notificaciones de la org. Fire-and-forget: un fallo acá
 * nunca hace fallar la operación que creó la garantía.
 */
export function notificarGarantiaCreada(params: {
  organizationId: string
  sucursalId: string | null
  org: {
    nombre?: string | null
    nombre_mostrar?: string | null
    slug?: string | null
    moneda?: string | null
    zona_horaria?: string | null
  } | null
  cliente: {
    id: string
    nombre: string
    email?: string | null
    telefono: string
  } | null
  orden: {
    id: string
    numero_orden: number
    dispositivo: string
    estado: string
    public_token?: string | null
  }
  garantia: {
    id: string
    dias_validez: number
    fecha_vencimiento: string
  }
}): void {
  const { organizationId, sucursalId, org, cliente, orden, garantia } = params
  if (!cliente) return

  queueNotification({
    organizationId,
    sucursalId,
    ordenId: orden.id,
    garantiaId: garantia.id,
    clienteId: cliente.id,
    tipo: "GARANTIA_CREADA",
    context: {
      organizationName: org?.nombre_mostrar || org?.nombre || "",
      organizationSlug: org?.slug ?? undefined,
      moneda: org?.moneda || "ARS",
      zonaHoraria: org?.zona_horaria || DEFAULT_TIMEZONE,
      cliente: {
        id: cliente.id,
        nombre: cliente.nombre,
        email: cliente.email,
        telefono: cliente.telefono,
      },
      orden: {
        id: orden.id,
        numeroOrden: orden.numero_orden,
        dispositivo: orden.dispositivo,
        estado: orden.estado,
        publicToken: orden.public_token ?? null,
      },
      garantia: {
        id: garantia.id,
        diasValidez: garantia.dias_validez,
        fechaVencimiento: garantia.fecha_vencimiento,
      },
    },
  }).catch((err) => console.error("Error queueing GARANTIA_CREADA notification:", err))
}
