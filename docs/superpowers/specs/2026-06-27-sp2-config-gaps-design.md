# SP-2: Cerrar huecos de config (categorías + validación de serie)

**Fecha:** 2026-06-27 · **Estado:** Diseño aprobado

## Contexto

Sub-proyecto 2 de la iniciativa "STApp multipropósito" (app generalista para cualquier rubro que repare). SP-1 (vocabulario configurable) ya está mergeado. SP-2 cierra huecos de config que aún estaban acoplados al rubro celulares. SP-3 (plantillas por rubro + onboarding) viene después.

El motor `tipos_dispositivo.config JSONB` ya guarda `campos`, `camposExtra`, `accesorios`, `problemasComunes`, `marcas`, `categoriasInventario` por tipo.

**Alcance acordado:** Hueco 1 (categorías de inventario) + Hueco 2 (validación de serie). El Hueco 3 (recibo térmico por tipo) queda **fuera** — ya está cubierto por la presencia de datos (el recibo solo imprime campos con valor).

## Hueco 1 — Categorías de inventario por tipo (versión segura)

**Estado actual:** `components/inventario/inventario-form.tsx` ya prioriza `config.categoriasInventario` y cae a un map hardcodeado `categoriasPorTipo` (líneas 76-93) solo si está vacío. El editor `components/configuracion/tipo-config-editor.tsx` (línea 61-122) ya permite editar `config.categoriasInventario` por tipo. Pero los **tipos base** (CELULAR, COMPUTADORA, etc.) NO tienen `categoriasInventario` sembrado en su config (la mig 049 sembró otros campos, no categorías) → en el editor aparecen vacíos y editar requiere cargarlos de cero; en el form se ven vía el fallback hardcodeado.

**Objetivo:** que las categorías de los tipos base estén en su config (editables desde la UI), **sin romper nada**.

**Decisión (versión segura, aprobada):** sembrar + **mantener el fallback** como red de seguridad (NO removerlo). Así no hay ventana de deploy donde los tipos base queden sin categorías.

- **Migración (solo data):** sembrar `config.categoriasInventario` en los tipos base (`es_base = true`, por `codigo`) con los valores que hoy están hardcodeados en `categoriasPorTipo`. **Idempotente:** solo donde `NOT (config ? 'categoriasInventario')` — no pisa configs custom existentes.
- **`inventario-form.tsx`: SIN cambios** — ya prioriza config y mantiene el fallback. Tras la migración, los tipos base usan su config sembrado (mismas categorías visibles).
- El map hardcodeado `categoriasPorTipo` **queda** como último fallback (limpieza futura, una vez todas las orgs migradas).

**Resultado:** categorías de los tipos base editables desde la UI de config; cero ventana de rotura; usuarios actuales ven exactamente las mismas categorías.

## Hueco 2 — Validación de serie configurable por tipo

**Estado actual:** `lib/imei.ts` tiene `isValidImei` (15 dígitos) y `sanitizeImei`. En `orden-form.tsx` (~líneas 275, 612, 1072) la validación se gatea con `config.campos.imei.validacion === "imei"` (15 díg) vs ausente (sin validar). El editor (`tipo-config-editor.tsx` ~176-213) tiene un checkbox "Validar como IMEI (15 díg)". El "serie libre" (sin validación) ya funciona.

**Objetivo:** soportar validación **custom por tipo** (patrón/regex) además de IMEI y libre, manteniendo lo actual intacto.

- **Config (extensión de `config.campos.imei`):**
  - `validacion: "none" | "imei" | "pattern"` (ausente = "none", retrocompatible).
  - `pattern?: string` (regex, solo para `"pattern"`).
  - `mensajeError?: string` (mensaje a mostrar cuando no valida; opcional).
- **`lib/imei.ts`:** nueva `validarSerie(value, { validacion, pattern }): boolean` — vacío/`none` = válido; `imei` = reusa `isValidImei` (15 díg); `pattern` = matchea el regex (regex inválido → tratar como válido/fail-safe, no romper la carga). Mantener `isValidImei`/`sanitizeImei` sin cambios.
- **`orden-form.tsx`:** usar `validarSerie` con el config del tipo, en vez del check hardcodeado. Comportamiento idéntico para los tipos que hoy usan "imei" o nada.
- **`tipo-config-editor.tsx`:** reemplazar el checkbox por un selector de modo (Ninguna / IMEI 15 díg / Patrón custom) + inputs de `pattern` y `mensajeError` visibles solo en modo "Patrón". Las configs existentes (`validacion: "imei"` o ausente) mapean a IMEI/Ninguna sin migrar data.

**Retrocompatibilidad:** aditivo. `validacion` ausente o "imei" se comporta exactamente como hoy. No hay migración de data para el Hueco 2.

## Casos borde

- **Tipo base sin migración aplicada** (Hueco 1) → el fallback hardcodeado lo cubre (red de seguridad).
- **Tipo sin categorías en config** → fallback (o `TODOS`); el campo de categoría permite además el valor que ya tenga el ítem.
- **`validacion: "pattern"` con regex inválido** → `validarSerie` no lanza; trata el valor como válido (fail-safe: no bloquear la carga de la orden por un regex mal escrito).
- **Serie vacía** → válida en todos los modos (el campo es opcional, como hoy).
- **Config existente `validacion: "imei"`** → sigue siendo 15 dígitos, sin cambios.

## No-goals (fuera de alcance de SP-2)

- Recibo térmico por tipo (Hueco 3 — cubierto por presencia de datos).
- Remover el map hardcodeado `categoriasPorTipo` (limpieza futura post-migración).
- Plantillas por rubro / onboarding (SP-3).
- Cambios de schema (todo en `tipos_dispositivo.config` JSONB; la migración del Hueco 1 es solo data/seeding).

## Archivos afectados (resumen)

- **Nuevo:** migración de seeding `categoriasInventario` en tipos base (Hueco 1).
- **Editar (Hueco 2):** `lib/imei.ts` (`validarSerie`); `components/ordenes/orden-form.tsx` (usar `validarSerie`); `components/configuracion/tipo-config-editor.tsx` (selector de modo + pattern/mensaje); tipo `CampoConfig`/`ImeiConfig` en `types/index.ts` (agregar `pattern`/`mensajeError`/ampliar `validacion`).
- **Tests:** unit de `validarSerie` (none/imei/pattern/vacío/regex inválido).
- **Sin cambios:** `inventario-form.tsx` (Hueco 1 versión segura).
