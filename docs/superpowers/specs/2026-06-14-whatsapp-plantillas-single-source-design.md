# WhatsApp — catálogo de plantillas como única fuente de verdad (por estado)

**Fecha:** 2026-06-14
**Estado:** Diseño aprobado (A+B)

## Problema

Las plantillas por estado YA existen y son editables: `lib/whatsapp/plantillas-catalog.ts` define `orden_estado_recibido … orden_estado_sin_reparacion` (13) con `defaultText` + variables, y el editor (`plantillas-whatsapp-editor.tsx`) las muestra y persiste en `organizations.plantillas_whatsapp`.

Pero hay **dos fuentes de default desincronizadas**:
- El **editor** muestra como default el `defaultText` del catálogo.
- El **envío automático** sin override usa `generateWhatsAppMessage` (copy hardcodeado introducido en PR #26, `lib/notifications/whatsapp-message.ts`).

→ Lo que el usuario ve en el editor ≠ lo que se envía. `resolvePlantillaForTipo` hoy devuelve `null` cuando no hay override, y el envío cae al hardcodeado en vez del catálogo.

## Objetivo

El **catálogo es la única fuente de verdad** del copy por estado. El envío automático, sin override de la org, renderiza el `defaultText` del catálogo. Editor default = mensaje enviado. Editar por estado ya funciona (override gana). Refrescar los defaults al copy accionable (link + CTA aprobar/rechazar).

## Decisiones (cerradas)

1. **A — Unificar:** `resolvePlantillaForTipo` cae al `defaultText` del catálogo cuando no hay override. Orden de resolución: override per-estado → override genérico → default catálogo per-estado → default catálogo genérico → null.
2. **B — Refrescar** los 13 `orden_estado_*` + `orden_presupuesto` + `orden_estado_actual` (genérico) al copy accionable aprobado (con `{link_seguimiento}` y, en presupuestado, CTA *apruebe o rechace*).
3. **Testabilidad:** mover `resolvePlantillaForTipo` + `buildVarsForContext` + `TIPO_TO_CATALOG_KEY` de `send-direct.ts` (imports server-only) a `lib/notifications/whatsapp-message.ts` (puro). `send-direct` los importa.
4. **Retirar la duplicación:** `generateWhatsAppMessage` se reduce a un fallback genérico mínimo (sin switch por estado); el copy por estado vive solo en el catálogo. Queda como último recurso para un `tipo` sin entrada en el catálogo.

## Arquitectura

### `lib/notifications/whatsapp-message.ts` (módulo puro, ampliado)
Pasa a contener:
- `getBaseUrl`, `formatEstado` (ya están).
- `TIPO_TO_CATALOG_KEY` (movido de send-direct).
- `buildVarsForContext(context): Record<string, string|number>` (movido; usa `getBaseUrl`, `formatEstado`, `formatCurrencyValue`, `formatDateValue`).
- `resolvePlantillaForTipo(tipo, context, plantillasOverride): string | null` (movido + extendido):
  ```
  keys = (tipo==="CAMBIO_ESTADO" && estado)
    ? [ `orden_estado_${estado.toLowerCase()}`, "orden_estado_actual" ]
    : [ TIPO_TO_CATALOG_KEY[tipo] ].filter(Boolean)
  vars = buildVarsForContext(context)
  // 1) override (en orden de keys)
  if (plantillasOverride) for key of keys: if override[key]?.trim() → renderTemplate(override[key], vars)
  // 2) default del catálogo (en orden de keys)
  for key of keys: def = getPlantilla(key)?.defaultText; if def → renderTemplate(def, vars)
  return null
  ```
- `generateWhatsAppMessage(tipo, context)`: reducido a fallback genérico (sin switch por estado).

Imports nuevos del módulo: `renderTemplate`, `getPlantilla` de `@/lib/whatsapp/plantillas-catalog`; `formatDateValue` de `@/lib/timezone`. Ninguno arrastra server-only (firebase/push).

### `lib/notifications/send-direct.ts`
- Elimina las defs locales de `TIPO_TO_CATALOG_KEY`, `buildVarsForContext`, `resolvePlantillaForTipo`.
- Importa `resolvePlantillaForTipo`, `generateWhatsAppMessage` de `whatsapp-message.ts` (ya importa `getBaseUrl`/`formatEstado`).
- Los dos call sites (API línea ~271, wa.me ~304) ya hacen `resolvePlantillaForTipo(...) ?? generateWhatsAppMessage(...)`: ahora el primero devuelve también el default del catálogo. Renombrar var `overrideText` → `resolvedText` por claridad.

### `lib/whatsapp/plantillas-catalog.ts`
- Refrescar `defaultText` de: `orden_estado_actual`, `orden_estado_recibido`, `_en_diagnostico`, `_presupuestado`, `_aprobado`, `_en_reparacion`, `_esperando_repuesto`, `_reparado`, `_entregado`, `_entregado_sin_reparacion`, `_entregado_sin_cobro`, `_cancelado`, `_sin_reparacion`, y `orden_presupuesto`. Mantener `{link_seguimiento}` + `{empresa}` en el footer, variables sin cambio.

## Copy aprobado (defaultText, conserva footer `Seguimiento: {link_seguimiento}` + `{empresa}`)

Forma: `Hola {cliente}, le informamos que su {dispositivo} (Orden #{numero_orden}) se encuentra <label>.\n\n<cuerpo>\n\nSeguimiento: {link_seguimiento}\n\n{empresa}`

| Key | Cuerpo |
|---|---|
| orden_estado_recibido | Recibimos su equipo y ya está en cola de diagnóstico. Le avisaremos apenas tengamos novedades. |
| orden_estado_en_diagnostico | Estamos revisando su equipo para detectar la falla. En breve le enviamos el presupuesto. |
| orden_estado_presupuestado | Para avanzar, *apruebe o rechace el presupuesto* desde el link de seguimiento de abajo. Cualquier duda, escríbanos. |
| orden_estado_aprobado | ¡Gracias por aprobar el presupuesto! Su equipo entra en cola de reparación. Le avisamos cuando esté listo. |
| orden_estado_en_reparacion | Ya estamos reparando su equipo. Le avisamos en cuanto esté terminado. |
| orden_estado_esperando_repuesto | Su reparación está en pausa esperando un repuesto. Apenas llegue, retomamos y le avisamos. |
| orden_estado_reparado | Su equipo está reparado y *listo para retirar*. Lo esperamos en horario de atención. |
| orden_estado_entregado | Su equipo fue entregado. ¡Gracias por confiar en nosotros! Si necesita algo más, escríbanos. |
| orden_estado_entregado_sin_reparacion | Su equipo fue retirado sin reparación. Gracias por consultarnos; quedamos a disposición. |
| orden_estado_entregado_sin_cobro | Su equipo fue entregado. ¡Gracias por confiar en nosotros! |
| orden_estado_cancelado | La orden fue cancelada. Si desea retomar o ingresar un nuevo servicio, escríbanos. |
| orden_estado_sin_reparacion | No fue posible reparar su equipo. Puede pasar a retirarlo en horario de atención. Quedamos a disposición. |
| orden_estado_actual (genérico) | (mantener genérico, pero accionable) … se encuentra {estado}. Puede ver el detalle en el link. |

**orden_presupuesto** (`defaultText`):
```
Hola {cliente}, ya tenemos el presupuesto para la reparación de su {dispositivo}:

*Presupuesto: {presupuesto}*

Orden #{numero_orden}

Para avanzar, *apruebe o rechace el presupuesto* desde el link de abajo.

Seguimiento: {link_seguimiento}

{empresa}
```

## Manejo de errores / edge cases
- `getPlantilla(key)` sin match → sigue al siguiente key; si ninguno, `null` → `generateWhatsAppMessage` genérico.
- `renderTemplate` ya borra placeholders de variables ausentes (`{link_seguimiento}` vacío si no hay token) — sin crash.
- Override existente de la org sigue ganando (no se pisa al refrescar defaults; los overrides viven en la DB).

## Testing (vitest)
Nuevo/extendido sobre `whatsapp-message.ts` (puro, importable):
- `resolvePlantillaForTipo` CAMBIO_ESTADO PRESUPUESTADO sin override → devuelve el default del catálogo renderizado, contiene "apruebe o rechace" + el link (`/seguimiento/<token>`).
- Con override per-estado → devuelve el override renderizado (gana sobre el default).
- PRESUPUESTO_DEFINIDO sin override → default `orden_presupuesto` con monto + CTA.
- Sin entrada de catálogo para un tipo desconocido → `null`.
- `generateWhatsAppMessage` genérico no rompe sin orden.

## Fuera de alcance
- El selector MANUAL (`whatsapp-templates.ts` `generateEstadoMessage` / `getWhatsAppTemplates`) sigue con su propio copy (mejorado en #23). Unificarlo también con el catálogo es follow-up; no afecta el envío automático.
- Variables "auto" complejas (linea_presupuesto, etc.) que algunos templates del catálogo usan pero `buildVarsForContext` no genera — follow-up.
