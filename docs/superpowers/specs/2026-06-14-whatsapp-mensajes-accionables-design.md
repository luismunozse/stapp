# WhatsApp — mensajes por estado específicos y accionables

**Fecha:** 2026-06-14
**Estado:** Diseño aprobado

## Problema

Las notificaciones automáticas por WhatsApp informan el cambio de estado pero con copy genérico y poco accionable (PRESUPUESTADO: *"Por favor confirme si desea continuar con la reparacion."*). No le dicen al cliente QUÉ puede hacer ni que el link ya permite aprobar/rechazar. Además, al cargar un presupuesto se disparan DOS mensajes casi iguales (`PRESUPUESTO_DEFINIDO` + `CAMBIO_ESTADO → PRESUPUESTADO`).

## Hallazgo clave (infra existente, NO se construye)

La página pública de seguimiento (`app/seguimiento/[token]`) **ya permite aprobar/rechazar el presupuesto** (`components/seguimiento/budget-approval.tsx`, rutas `approve-budget`/`reject-budget`/`approve-cotizacion`). `link_seguimiento` (`https://{slug}.stapp.com.ar/seguimiento/{publicToken}`) ya apunta ahí. Este cambio es **solo copy + dedup**, no flujo de aprobación.

## Objetivo

Cada mensaje automático por estado debe ser específico y accionable, apoyándose en el link de seguimiento (que ya resuelve aprobar/rechazar, ver comprobante). Un solo mensaje al presupuestar.

## Decisiones (cerradas)

1. **Copy nuevo por estado** (registro formal "usted", consistente con el codebase). Reemplaza los textos genéricos de `generateEstadoMessage`.
2. **Un solo mensaje al presupuestar**: suprimir `CAMBIO_ESTADO` cuando el estado destino es PRESUPUESTADO y el presupuesto cambió en el mismo request; queda solo `PRESUPUESTO_DEFINIDO` (con monto + CTA aprobar/rechazar).
3. **Override por org intacto**: el lookup `orden_estado_{estado}` → `orden_estado_actual` y `organizations.plantillas_whatsapp` siguen funcionando. Solo cambian los textos default.
4. Footer existente se mantiene: `Seguimiento: {link_seguimiento}` + `Descargar orden: {link_pdf}` + `{empresa}`.

## Copy aprobado (cuerpo, tras `Hola {cliente}, ...`)

Base actual: `"Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra {label}."` + cuerpo por estado + footer.

| Estado | Cuerpo |
|---|---|
| RECIBIDO | Recibimos su equipo y ya está en cola de diagnóstico. Le avisaremos apenas tengamos novedades. |
| EN_DIAGNOSTICO | Estamos revisando su equipo para detectar la falla. En breve le enviamos el presupuesto. |
| PRESUPUESTADO | Para avanzar, **apruebe o rechace el presupuesto** desde el link de seguimiento de abajo. Cualquier duda, escríbanos. |
| APROBADO | ¡Gracias por aprobar el presupuesto! Su equipo entra en cola de reparación. Le avisamos cuando esté listo. |
| EN_REPARACION | Ya estamos reparando su equipo. Le avisamos en cuanto esté terminado. |
| ESPERANDO_REPUESTO | Su reparación está en pausa esperando un repuesto. Apenas llegue, retomamos y le avisamos. |
| REPARADO | Su equipo está reparado y **listo para retirar**. Lo esperamos en horario de atención. Comprobante en el link. |
| ENTREGADO | Su equipo fue entregado. ¡Gracias por confiar en nosotros! Si necesita algo más, escríbanos. |
| ENTREGADO_SIN_REPARACION | Su equipo fue retirado sin reparación. Gracias por consultarnos; quedamos a disposición. |
| CANCELADO | La orden fue cancelada. Si desea retomar o ingresar un nuevo servicio, escríbanos. |
| SIN_REPARACION | No fue posible reparar su equipo. Puede pasar a retirarlo en horario de atención. Quedamos a disposición. |

> Nota: el cuerpo usa "su equipo" (no `{dispositivo}` interpolado) porque la línea base ya nombra el dispositivo. Mantener el estilo actual de cada `case`.

**Mensaje de presupuesto (`generatePresupuestoMessage`, el consolidado):**
```
Hola {cliente}, ya tenemos el presupuesto para la reparación de su {dispositivo}:

*Presupuesto: {presupuesto}*

Orden #{numero_orden}

Para avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.
{footer: link_seguimiento + link_pdf}

{empresa}
```

## Cambios de comportamiento (route)

`app/api/ordenes/[id]/route.ts` (PUT):
- Computar `presupuestoCambio = data.presupuesto !== undefined && data.presupuesto !== null && data.presupuesto !== orden.presupuesto`.
- Condición de `CAMBIO_ESTADO`: `if (estadoFinal && estadoFinal !== orden.estado && !(estadoFinal === "PRESUPUESTADO" && presupuestoCambio))`.
- `PRESUPUESTO_DEFINIDO`: usa `presupuestoCambio` (misma expresión).
- Agregar `presupuesto: orden.presupuesto` al `context.orden` de `CAMBIO_ESTADO` (para que el copy PRESUPUESTADO muestre monto si dispara standalone, p.ej. transición manual sin cambiar presupuesto). El generador debe tolerar presupuesto ausente (no romper si null).

## Arquitectura / unidades

- `lib/notifications/whatsapp-templates.ts`: solo cambian los strings dentro de `generateEstadoMessage` (switch) y `generatePresupuestoMessage`. Sin cambios de firma ni de estructura. Override y rendering sin tocar.
- `app/api/ordenes/[id]/route.ts`: la guarda de dedup + el campo `presupuesto` en el context. Cambio mínimo y local.

## Manejo de errores / edge cases
- Transición manual a PRESUPUESTADO sin cambiar presupuesto → CAMBIO_ESTADO dispara copy PRESUPUESTADO (apunta al link). OK.
- Cargar presupuesto sin cambio de estado (orden ya PRESUPUESTADO) → solo PRESUPUESTO_DEFINIDO. OK.
- presupuesto ausente en context → el copy no debe romper (no se interpola monto en el case de estado; el monto vive en el mensaje de presupuesto).

## Testing
- `__tests__/lib/whatsapp-templates.test.ts` (existe): assertar que el copy nuevo por estado contiene la frase clave (ej. PRESUPUESTADO contiene "apruebe o rechace", REPARADO contiene "listo para retirar"). Y que `generatePresupuestoMessage` contiene el monto + "apruebe o rechace".
- `__tests__/api/ordenes.test.ts` (existe): test de dedup → al setear presupuesto en orden RECIBIDO/EN_DIAGNOSTICO (auto-transición a PRESUPUESTADO), se encola PRESUPUESTO_DEFINIDO y NO CAMBIO_ESTADO. Y al cambiar a otro estado (ej. REPARADO) sí se encola CAMBIO_ESTADO.

## Fuera de alcance
- Variable de fecha estimada de entrega.
- Link de pago inline con saldo en REPARADO/ENTREGADO.
- Botones interactivos de WhatsApp (Evolution texto plano; aprobar/rechazar vive en el link).
