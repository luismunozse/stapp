# WhatsApp al crear una orden

**Fecha:** 2026-06-14
**Estado:** Diseño aprobado

## Problema

Al crear una orden no se notifica al cliente. El cliente recibe WhatsApp recién en el primer cambio de estado posterior. El pedido original del usuario era: "si una orden se carga, el WhatsApp se dispara".

## Objetivo

Que al crear una orden se dispare la notificación automática al cliente (multicanal: los canales habilitados de la org), reusando el sistema de plantillas por estado ya existente y configurable.

## Decisiones (cerradas)

1. **Reusar `CAMBIO_ESTADO`** con `estado = estadoInicial` de la orden (no se crea un tipo nuevo). Así usa la plantilla por estado existente: `orden_estado_recibido` (o `orden_estado_en_reparacion` si la orden se crea con `presupuestoAceptado`).
2. **Configurable gratis**: como reusa la plantilla por estado, el taller la personaliza desde Configuración → plantillas WhatsApp (override gana, vía `resolvePlantillaForTipo` — ya implementado en #32).
3. **Multicanal**: sale por los canales habilitados (email + WhatsApp), igual que cualquier cambio de estado.
4. **fire-and-forget**: no bloquea ni rompe la creación de la orden si la notificación falla.
5. **Gating**: plan + toggle de notificaciones los maneja `send-direct` (sin lógica nueva). Si el cliente no tiene teléfono, no se manda WhatsApp (lo maneja send-direct).

## Arquitectura

`app/api/ordenes/route.ts` (POST), tras el insert exitoso de la orden:

1. **Extender el select de `organizations`** (línea ~433) para incluir `slug`, `moneda`, `zona_horaria` (hoy trae `nombre, nombre_mostrar, logo_url, telefono, direccion, comprobante_terminos`). Necesarios para el link de seguimiento y el formato de moneda/fecha del notification context.
2. **Encolar la notificación** (fire-and-forget, mismo shape que el PUT en `app/api/ordenes/[id]/route.ts:386-415`):
   ```ts
   queueNotification({
     organizationId: organizationId!,
     ordenId: orden.id,
     clienteId: orden.clientes?.id,
     tipo: "CAMBIO_ESTADO",
     context: {
       organizationName: org?.nombre_mostrar || org?.nombre,
       organizationSlug: org?.slug,
       moneda: org?.moneda || "ARS",
       zonaHoraria: org?.zona_horaria || "America/Argentina/Buenos_Aires",
       cliente: { id, nombre, email, telefono } (de orden.clientes),
       orden: {
         id: orden.id,
         numeroOrden: orden.numero_orden,
         dispositivo: orden.dispositivo,
         estado: estadoInicial,        // RECIBIDO o EN_REPARACION
         estadoAnterior: null,
         publicToken: orden.public_token,
       },
     },
   }).catch(err => console.error("Error queueing notification (orden creada):", err))
   ```
   Ubicar después del fetch de `org` y antes (o junto) al `return` de la respuesta. Solo encolar si hay `orden.clientes` (cliente cargado).

## Manejo de errores / edge cases
- Sin cliente o sin teléfono → no se manda WhatsApp (send-direct gatea por `cliente.telefono`); el email puede salir si hay email habilitado.
- Orden creada como EN_REPARACION (presupuestoAceptado) → notifica con la plantilla `orden_estado_en_reparacion`. Aceptable y consistente.
- Notificación fire-and-forget → un fallo no afecta la creación (la orden ya se devolvió/creó).
- No hay doble notificación: la creación no dispara ningún otro `queueNotification` hoy.

## Testing
`__tests__/api/ordenes.test.ts` (POST), patrón existente con `vi.mock("@/lib/notifications/queue")`:
- Crear orden (estado inicial RECIBIDO) → se encola `queueNotification` con `tipo: "CAMBIO_ESTADO"` y `context.orden.estado === "RECIBIDO"`, `publicToken` presente, `cliente` del orden.
- Crear orden con `presupuestoAceptado: true` → `context.orden.estado === "EN_REPARACION"`.
- La creación responde 201 aunque `queueNotification` falle (fire-and-forget) — opcional si el patrón lo permite fácil.

## Fuera de alcance
- Recordatorio por WhatsApp (cron), opt-out por cliente — próximos.
- Plantilla "orden recibida" dedicada distinta de `orden_estado_recibido` (no hace falta: ya es editable).
