# Unificar el selector manual de plantillas con el catálogo

**Fecha:** 2026-06-14 · **Estado:** Diseño aprobado

## Problema

El selector manual de WhatsApp (`getWhatsAppTemplates` → diálogo de orden) usa, como default sin override, sus propios generadores (`generateEstadoMessage`, etc.) en `lib/notifications/whatsapp-templates.ts`. El envío automático usa el `defaultText` del catálogo (#32). Para una misma plantilla por estado, el copy del selector puede diferir del que se envía. Tres fuentes residuales; falta cerrar el lazo.

## Objetivo

Que el selector manual muestre, sin override, el **mismo `defaultText` del catálogo** que usa el envío automático. Override de la org gana en ambos. Una sola fuente de verdad de punta a punta.

## Decisiones (cerradas)

1. **`applyOverride` consulta el catálogo** antes de caer al generador propio. Orden: override (per-estado → genérico) → `getPlantilla(catalogKey)?.defaultText` (per-estado → genérico) → `defaultMessage` (el generador, solo fallback si el legacyId no mapea a catálogo).
2. **No se borran los `generateXMessage`** — quedan como último recurso (cero riesgo si algún id no tiene catálogo). Todos los legacyIds actuales SÍ mapean (`LEGACY_ID_TO_CATALOG_KEY` los cubre).
3. **`nombre`/label** de cada template en el selector queda igual; solo cambia el cuerpo (`mensaje`).

## Arquitectura — `lib/notifications/whatsapp-templates.ts`

- Import: agregar `getPlantilla` a `import { renderTemplate, getPlantilla } from "@/lib/whatsapp/plantillas-catalog"`.
- Reemplazar `applyOverride` por:
```ts
function applyOverride(
  legacyId: string,
  defaultMessage: string,
  ctx: NotificationContext,
  plantillasOverride?: Record<string, string> | null,
): string {
  const vars = buildVarsFromContext(ctx)

  const keys: string[] = []
  if (legacyId === "estado_actual" && ctx.orden?.estado) {
    keys.push(`orden_estado_${ctx.orden.estado.toLowerCase()}`)
  }
  const catalogKey = LEGACY_ID_TO_CATALOG_KEY[legacyId]
  if (catalogKey) keys.push(catalogKey)

  // 1) Override de la org
  if (plantillasOverride) {
    for (const key of keys) {
      const o = plantillasOverride[key]
      if (o && o.trim()) return renderTemplate(o, vars)
    }
  }
  // 2) Default del catálogo (única fuente de verdad)
  for (const key of keys) {
    const def = getPlantilla(key)?.defaultText
    if (def && def.trim()) return renderTemplate(def, vars)
  }
  // 3) Fallback: generador propio (legacyIds sin entrada en catálogo)
  return defaultMessage
}
```
- El resto de `getWhatsAppTemplates` no cambia (sigue pasando `generateXMessage` como `defaultMessage`, que ahora es solo fallback).

## Edge cases
- legacyId sin `catalogKey` (no hay hoy, pero defensivo) → cae al `defaultMessage` (generador).
- `estado_actual`: prioriza `orden_estado_{estado}` y luego `orden_estado_actual` del catálogo (mismo criterio que el override y que el envío).
- Variables faltantes → `renderTemplate` ya las borra (sin crash).

## Testing
`__tests__/lib/whatsapp-templates.test.ts`:
- Sin override: `getWhatsAppTemplates(ctx estado=PRESUPUESTADO).find(id==="estado_actual").mensaje` contiene el copy del catálogo (ej. "apruebe o rechace"). REPARADO → "listo para retirar".
- Con override `orden_estado_recibido` → el mensaje es el override renderizado (gana sobre el catálogo).
- Actualizar cualquier aserción existente que dependiera del texto del generador viejo si difiere del catálogo.

## Fuera de alcance
- Borrar los `generateXMessage` (quedan como fallback; limpieza opcional futura).
- Unificar los labels (`nombre`) con el catálogo.
