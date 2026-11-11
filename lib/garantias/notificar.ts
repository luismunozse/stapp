import { queueNotification } from "@/lib/notifications/queue"
import { supabaseAdmin } from "@/lib/supabase"
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

/**
 * Avisa al cliente que su equipo o producto re-ingresó por garantía
 * (REINGRESO_GARANTIA). La plantilla existía y nunca se encolaba: ahora la
 * encola el único camino que crea re-ingresos (lib/garantias/reingreso.ts).
 * Fire-and-forget, igual que GARANTIA_CREADA. Devuelve la promesa (los tests
 * la esperan); quien la llama no la espera.
 */
export function notificarReingresoGarantia(params: {
  organizationId: string
  garantia: {
    id: string
    origen: "REPARACION" | "VENTA"
    dias_validez: number | null
    fecha_vencimiento: string
  }
  orden: {
    id: string
    numero_orden: number
    dispositivo: string
    public_token: string | null
    sucursal_id: string | null
    cliente_id: string
  }
}): Promise<void> {
  const { organizationId, garantia, orden } = params
  return (async () => {
    const [{ data: cliente }, { data: org }] = await Promise.all([
      supabaseAdmin
        .from("clientes")
        .select("id, nombre, email, telefono")
        .eq("id", orden.cliente_id)
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabaseAdmin
        .from("organizations")
        .select("nombre, nombre_mostrar, slug, moneda, zona_horaria")
        .eq("id", organizationId)
        .maybeSingle(),
    ])
    if (!cliente) return
    await queueNotification({
      organizationId,
      sucursalId: orden.sucursal_id,
      ordenId: orden.id,
      // notification_logs.garantia_id apunta a garantias (reparación): la de venta no va.
      garantiaId: garantia.origen === "REPARACION" ? garantia.id : undefined,
      clienteId: cliente.id,
      tipo: "REINGRESO_GARANTIA",
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
          estado: "RECIBIDO",
          publicToken: orden.public_token,
        },
        garantia: {
          id: garantia.id,
          diasValidez: garantia.dias_validez ?? 0,
          fechaVencimiento: garantia.fecha_vencimiento,
        },
      },
    })
  })().catch((err) => console.error("Error queueing REINGRESO_GARANTIA notification:", err))
}
