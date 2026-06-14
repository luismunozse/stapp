# Recordatorio de retiro por WhatsApp (cron)

**Fecha:** 2026-06-14 · **Estado:** Diseño aprobado

## Problema

El cron `app/api/cron/recordatorios/route.ts` (orden REPARADO sin retirar > N días) notifica solo por email. Su rama WhatsApp (vía `NotificationService.generateWhatsAppLink`) **no envía** — genera un link `wa.me` y loguea "pendiente". Además, `if (!org.notificaciones_email) continue` saltea la org entera si el email está off.

## Objetivo

Que el recordatorio se envíe por los canales habilitados de la org (email + **WhatsApp real**), reusando el path de envío automático unificado (`queueNotification` → `sendNotificationDirect`), con la plantilla configurable `orden_listo_retirar`.

## Decisiones (cerradas)

1. **Migrar el cron de `NotificationService` a `queueNotification`.** Ese path sí envía WhatsApp (Evolution/Meta) y email, gateado por toggles + plan + conexión, y usa el catálogo (configurable).
2. **Sin pasar canales explícitos:** `send-direct` envía a los canales habilitados de la org. El cron no fuerza `["EMAIL"]`.
3. **Guarda de org:** saltear solo si `!notificaciones_email && !notificaciones_whatsapp`.
4. **Guarda de orden:** saltear solo si el cliente no tiene email **ni** teléfono.
5. **Dedup intacto:** un recordatorio por orden por día (notification_logs).

## Cambios — `app/api/cron/recordatorios/route.ts`

- Imports: quitar `NotificationService`, `createNotificationContext`; agregar `import { queueNotification } from "@/lib/notifications/queue"`.
- Org select: `id, nombre, nombre_mostrar, slug, dias_recordatorio, notificaciones_email, notificaciones_whatsapp, moneda, zona_horaria`.
- Org guard (línea 38): `if (!org.notificaciones_email && !org.notificaciones_whatsapp) continue`.
- Orden select: `id, numero_orden, dispositivo, public_token, clientes (id, nombre, email, telefono)`.
- Orden guard (línea 75): `if (!orden.clientes?.email && !orden.clientes?.telefono) continue`.
- Reemplazar el bloque `NotificationService` por:
  ```ts
  try {
    await queueNotification({
      organizationId: org.id,
      ordenId: orden.id,
      clienteId: orden.clientes.id,
      tipo: "RECORDATORIO_RETIRO",
      context: {
        organizationName: org.nombre_mostrar || org.nombre,
        organizationSlug: org.slug,
        moneda: org.moneda || "ARS",
        zonaHoraria: org.zona_horaria || "America/Argentina/Buenos_Aires",
        cliente: {
          id: orden.clientes.id,
          nombre: orden.clientes.nombre,
          email: orden.clientes.email,
          telefono: orden.clientes.telefono ?? "",
        },
        orden: {
          id: orden.id,
          numeroOrden: orden.numero_orden,
          dispositivo: orden.dispositivo,
          estado: "REPARADO",
          publicToken: orden.public_token,
        },
      },
    })
    totalEnviados++
  } catch (err) {
    console.error(`Error recordatorio orden ${orden.id}:`, err)
    totalErrores++
  }
  ```
  (Alinear el shape de `context` con la firma de `queueNotification` — mismo que usa el PUT/orden-creada. Ajustar `estadoAnterior`/campos si el tipo lo exige.)

## Edge cases
- Cliente con teléfono pero sin email → WhatsApp sí, email no (send-direct gatea por canal).
- WhatsApp no conectado / plan sin feature → send-direct no manda WhatsApp (falla suave logueada); email igual sale si está habilitado.
- Dedup: el log de RECORDATORIO_RETIRO de send-direct cuenta para el guard del día siguiente.

## Testing
`__tests__/api/` (cron): mock `queueNotification` + supabase. Verificar que para una orden REPARADO elegible se llama `queueNotification` con `tipo: "RECORDATORIO_RETIRO"` y `context.orden.publicToken`. Verificar guard: orden sin email ni teléfono → no se encola. (Seguir el patrón de tests de cron si existe; si no, test mínimo del happy path.)

## Fuera de alcance
- Opt-out por cliente (próximo PR) — cuando exista, send-direct lo respetará y el cron hereda el comportamiento.
