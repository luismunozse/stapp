# Validación de IMEI server-side (defensa)

**Fecha:** 2026-06-14 · **Estado:** Diseño aprobado

## Problema

La validación de IMEI (15 dígitos) es solo client-side (#40). Un request directo a la API (bypass del form) puede guardar un IMEI inválido. Falta defensa server-side.

## Objetivo

Que `POST /api/ordenes` y `PUT /api/ordenes/[id]` rechacen un IMEI inválido **cuando el tipo de dispositivo marca el campo como IMEI** (`campos.imei.validacion === "imei"`). IMEI opcional: vacío no valida.

## Decisiones (cerradas)

1. **Solo POST.** Verificado: `app/api/ordenes/[id]/route.ts` (PUT) NO acepta `imei` ni `tipoDispositivo` en su schema (solo estado/presupuesto/técnico/etc.) — la orden no edita el IMEI. Por lo tanto la validación server vive solo en la creación.
2. **Validación contextual** (igual criterio que el cliente): solo si el tipo del dispositivo tiene `campos.imei.validacion === "imei"`. Seriales (sin flag) no se validan.
3. **Reusar `isValidImei`** (`lib/imei.ts`, ya existe). Vacío/null → válido.
4. Fuente de la config: `tipos_dispositivo.config` (JSONB por org, mig 049); fallback a `TIPOS_BASE_CONFIG` (defaults estáticos) si no hay row.

## Arquitectura

### Helper — `lib/tipos-dispositivo-config.ts` (nuevo)
```ts
import { supabaseAdmin } from "@/lib/supabase"
import { TIPOS_BASE_CONFIG } from "@/lib/tipos-dispositivo-defaults"

/** ¿El campo IMEI de este tipo (org) está marcado para validar 15 dígitos? */
export async function tipoValidaImei(organizationId: string, tipoCodigo: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("tipos_dispositivo")
    .select("config")
    .eq("organization_id", organizationId)
    .eq("codigo", tipoCodigo)
    .maybeSingle()
  const config = (data?.config as any) ?? TIPOS_BASE_CONFIG[tipoCodigo] ?? null
  return config?.campos?.imei?.validacion === "imei"
}
```
(`maybeSingle` para no romper si no hay row.)

### Ruta — `app/api/ordenes/route.ts` (POST)
- Tras parsear el body (tiene `tipoDispositivo` + `imei`), antes del insert:
  ```ts
  if (data.imei && data.imei.trim() && data.tipoDispositivo) {
    const validaImei = await tipoValidaImei(organizationId!, data.tipoDispositivo)
    if (validaImei && !isValidImei(data.imei)) {
      return NextResponse.json({ error: "El IMEI debe tener exactamente 15 dígitos" }, { status: 400 })
    }
  }
  ```

### Ruta — PUT
No aplica: el PUT de órdenes no acepta `imei`. Sin cambios.

## Edge cases
- IMEI vacío → no valida (opcional).
- Tipo sin flag (serial) → no valida.
- Tipo no encontrado en DB ni defaults → `tipoValidaImei` devuelve false → no valida (no bloquea).
- El form ya valida client-side; esto es la red de seguridad.

## Testing
`__tests__/api/ordenes.test.ts` (POST) y el del PUT:
- Mock `tipos_dispositivo` select → config con `campos.imei.validacion: "imei"`. POST con `imei: "123"` → 400. POST con `imei: "123456789012345"` → 201. POST con tipo sin flag (config sin validacion) → 201 aunque imei sea corto. POST sin imei → 201.
- (Para mockear el helper: o se mockea el select de `tipos_dispositivo` vía `mockSupabaseFrom`, o se `vi.mock("@/lib/tipos-dispositivo-config")`. Elegir lo que encaje con el patrón del archivo.)

## Fuera de alcance
- Checksum de Luhn del IMEI.
- Validación server de otros campos por tipo (maxLength, etc.).
