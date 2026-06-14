# Validación de IMEI (15 dígitos) en el formulario de orden

**Fecha:** 2026-06-14
**Estado:** Diseño aprobado

## Problema

El formulario de creación de orden no valida el IMEI: deja escribir más/menos de 15 caracteres y acepta letras. El campo `imei` es compartido (IMEI para celulares, "Número de Serie" para otros tipos), así que no se puede forzar 15 dígitos a todos sin romper los seriales (alfanuméricos, longitud variable).

## Objetivo

Validar el campo como IMEI (exactamente 15 dígitos numéricos) **solo cuando el tipo de dispositivo lo marca como IMEI**. El IMEI es **opcional** (algunos talleres no lo registran), pero si se carga, debe ser válido.

## Decisiones (cerradas)

1. **Flag explícito** `validacion?: "imei"` en `CampoConfig` (no heurística de `maxLength`/`label`, que son frágiles/editables).
2. **Opcional pero válido si presente**: vacío → OK; con valor → exactamente 15 dígitos numéricos.
3. **Configurable por el taller**: toggle en el editor de tipos para marcar el campo como IMEI (así tipos custom también pueden activarlo).
4. **Scope: validación client-side** (el formulario, que es lo reportado) + restricción de input. **Server-side queda como follow-up** (campo informativo, bajo riesgo; el server requeriría cargar la config del tipo).

## Arquitectura

### Tipo (`types/index.ts`)
```ts
export interface CampoConfig {
  visible: boolean
  label?: string
  placeholder?: string
  maxLength?: number
  validacion?: "imei"   // nuevo: si "imei", el campo valida 15 dígitos
}
```

### Presets (`lib/tipos-dispositivo-defaults.ts`)
- Celular: `imei: { visible: true, label: "IMEI", placeholder: "123456789012345", maxLength: 15, validacion: "imei" }`.
- Tablet ("IMEI/Serial"), Consola ("Número de Serie"), resto: **sin** `validacion` → libres.

### Formulario (`components/ordenes/orden-form.tsx`)
- Leer `const imeiEsImei = config.campos?.imei?.validacion === "imei"`.
- Input: cuando `imeiEsImei`, restringir a dígitos (`inputMode="numeric"`, filtrar no-dígitos en onChange o `pattern`), `maxLength={15}`.
- Validación (Zod del form, `schema` línea ~67): hacer `imei` condicional. Como Zod estático no conoce el tipo en runtime fácilmente, validar con `superRefine`/`refine` usando el `tipoDispositivo` seleccionado + la config: si el campo es IMEI y el valor no está vacío y no matchea `^\d{15}$` → error "El IMEI debe tener exactamente 15 dígitos". Si está vacío → OK (opcional).
  - Alternativa si el refine con config es complejo: validar en el `onSubmit`/handler antes de enviar, seteando error en el field `imei` vía `setError`. Implementador elige la que encaje con el patrón de RHF+zod del archivo, pero el resultado debe ser: error visible bajo el campo y submit bloqueado.
- Mensaje de error: "El IMEI debe tener exactamente 15 dígitos".

### Editor de tipos (`components/configuracion/tipo-config-editor.tsx`)
- En la edición del campo `imei`, agregar un toggle/checkbox "Validar como IMEI (15 dígitos)" que setea `campos.imei.validacion = "imei"` (o lo borra). Persistir con el resto de la config del tipo.

## Manejo de errores / edge cases
- IMEI vacío en celular → permitido (opcional).
- IMEI con letras o ≠15 dígitos → error, submit bloqueado.
- Tipo sin `validacion: "imei"` (serial) → sin restricción, comportamiento actual.
- Pegar (paste) un IMEI con espacios/guiones → el filtro de dígitos los remueve (o se valida contra `^\d{15}$` y falla pidiendo corregir — implementador: preferir limpiar no-dígitos al pegar).

## Testing
- `components/ordenes/__tests__/` o el test del form si existe: validar la función/regla de IMEI:
  - valor "" con campo IMEI → válido (opcional).
  - "123456789012345" (15 dígitos) → válido.
  - "12345" / "1234567890123456" (≠15) → inválido.
  - "12345678901234a" (letra) → inválido.
- Si la validación se extrae a un helper puro (recomendado, ej. `isValidImei(value): boolean` en un módulo testeable), testear el helper directamente. Preferir extraer el helper para testabilidad.

## Fuera de alcance
- Validación server-side (requiere cargar config del tipo en la ruta) — follow-up.
- Checksum de Luhn del IMEI (validar dígito verificador) — follow-up opcional; por ahora solo "15 dígitos numéricos".
