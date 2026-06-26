# SP-1: Vocabulario configurable (STApp multipropósito)

**Fecha:** 2026-06-26 · **Estado:** Diseño aprobado

## Contexto

Iniciativa mayor: convertir STApp (hoy app de servicio técnico de celulares/computadoras) en una app **generalista para cualquier rubro que repare algo** (taller mecánico, electrodomésticos, relojería, bicicletería, etc.), con onboarding por rubro.

El análisis de acoplamiento mostró que el motor ya es ~65% genérico: la tabla `tipos_dispositivo` + `config JSONB` (migs 014/049/050) ya permite tipos custom con campos/accesorios/problemas/checklist por tipo. La iniciativa se descompuso en 3 sub-proyectos:
- **SP-1 (este) — Vocabulario configurable** *(fundación)*
- **SP-2 — Cerrar huecos de config** (categorías de inventario, validación de serie, recibo térmico por tipo)
- **SP-3 — Plantillas por rubro + onboarding** (el objetivo headline; depende de SP-1 y SP-2)

## Problema (SP-1)

El vocabulario está hardcodeado al rubro celulares/computadoras en UI, recibo térmico (`lib/escpos.ts`), PDF (`lib/pdf.ts`) y plantillas de notificación: "dispositivo", "equipo", "IMEI", "técnico", "reparación", "orden de servicio". Aunque una org cargue un tipo "Auto", la app sigue diciendo "IMEI" y "dispositivo" → se siente de celulares.

## Objetivo

Una **capa de terminología configurable por organización** con defaults neutrales, editable por el ADMIN en Configuración, consumida en cliente y servidor. Es la fundación que después SP-3 puebla por rubro.

## Decisiones (cerradas)

1. **Set acotado de términos** (los de alto impacto), no todos los strings de la app. YAGNI; se amplía si hace falta.
2. **Editable por el comercio** en Configuración (no solo heredado). SP-3 luego siembra valores por rubro vía el mismo campo.
3. **Reutilizar el flujo de config existente** (`/api/configuracion` + el provider global que ya expone la config vía `useCurrency()`), sin context nuevo paralelo ni fetch extra.
4. **Aplicación por superficies priorizadas**, no big-bang en ~40 archivos. Primero las de alto impacto; listas/reportes incremental.
5. **Solo overrides en DB**: lo no-seteado cae al default neutral en runtime (no se persisten los defaults).

## Arquitectura

### A. Migración — `organizations.terminologia`

Próximo número libre (al escribir: `263`; verificar antes de crear).

```sql
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS terminologia JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Guarda solo overrides, ej: `{ "equipo": "Vehículo", "serie": "Patente" }`.

### B. Catálogo + resolver (`lib/terminologia.ts`, nuevo)

```ts
export interface TerminoDef { key: string; default: string; label: string; help?: string }

export const TERMINOS: TerminoDef[] = [
  { key: "equipo",       default: "Equipo",            label: "Equipo (singular)",  help: "Lo que se repara. Ej: Vehículo, Electrodoméstico, Reloj." },
  { key: "equipoPlural", default: "Equipos",           label: "Equipo (plural)" },
  { key: "orden",        default: "Orden de trabajo",  label: "Orden" },
  { key: "serie",        default: "Número de serie",   label: "Identificador del equipo", help: "Ej: IMEI, Patente, N° de chasis." },
  { key: "tecnico",      default: "Técnico",           label: "Responsable del trabajo" },
  { key: "reparacion",   default: "Reparación",        label: "Trabajo/Reparación" },
  { key: "marca",        default: "Marca",             label: "Marca" },
  { key: "modelo",       default: "Modelo",            label: "Modelo" },
]

export type Terminologia = Record<string, string>

/** Mapa completo: default + overrides (overrides válidos solo para claves conocidas). */
export function resolveTerminologia(overrides?: Terminologia | null): Terminologia { /* ... */ }

/** Lookup de una clave: override o default; clave desconocida => la propia key. */
export function t(map: Terminologia, key: string): string { /* ... */ }
```

`resolveTerminologia` ignora claves no presentes en `TERMINOS` (no confía en JSON arbitrario de la DB).

### C. Exposición

**Cliente:** `/api/configuracion` GET ya devuelve la config de la org → agregar `terminologia: resolveTerminologia(org.terminologia)`. El provider global (que hoy alimenta `useCurrency()`) guarda el mapa y expone un hook `useTerminologia()` → `(key) => string`. Mismo fetch, sin pedido extra.

**Servidor (PDF / térmico / emails):** helper `getTerminologia(organizationId): Promise<Terminologia>` (fetch org + resolve, fail-safe a defaults) + el `t()` puro. Usado en `lib/escpos.ts`, `lib/pdf.ts` y plantillas de WhatsApp/email.

### D. UI de edición (Configuración → "Vocabulario")

- Nueva card en `app/(dashboard)/configuracion/page.tsx` + página `app/(dashboard)/configuracion/vocabulario/page.tsx` (server, guard ADMIN) + form cliente.
- El form lista cada `TERMINO` con su `label`/`help`, un input con placeholder = default, y guarda los overrides (vacío = volver al default).
- API: extender `/api/configuracion` PUT para aceptar `terminologia` (validar que las claves estén en `TERMINOS`, descartar el resto). Solo ADMIN.

### E. Aplicación (superficies priorizadas)

**Tanda 1 (alto impacto):** ficha de orden (`components/ordenes/orden-form.tsx`, `orden-detail.tsx`), recibo térmico (`lib/escpos.ts`), PDF de recepción (`lib/pdf.ts`), seguimiento público (`components/seguimiento/seguimiento-content.tsx`), plantillas de WhatsApp/email de órdenes.

**Tanda 2 (incremental, fuera de SP-1 v1):** listas, reportes, dashboards, notificaciones secundarias.

Regla: reemplazar el string literal por `t("...")` preservando el texto visible (cuando el override está vacío, se ve igual que hoy salvo los defaults neutralizados: "dispositivo"→"Equipo", "orden de servicio"→"Orden de trabajo", "IMEI"→"Número de serie"). NO tocar identificadores de código, claves de DB ni labels de campos que ya vienen del `config` por tipo (ese sistema es ortogonal).

## Casos borde

- **Override de clave desconocida** en el JSON de la DB → ignorado por `resolveTerminologia`.
- **Override vacío / whitespace** → cae al default (no persistir string vacío como override; el PUT lo limpia).
- **Org sin `terminologia`** (columna `{}`) → todos los defaults.
- **Fail-safe server:** si el fetch de terminología falla, usar defaults (nunca romper un PDF/recibo).
- **Interacción con el `config` por tipo:** los labels de campo por tipo (`config.campos.imei.label`, etc.) siguen mandando para ese campo puntual; la terminología global cubre los textos generales. No se pisan.

## No-goals (fuera de alcance de SP-1)

- Plantillas por rubro / onboarding (es SP-3).
- Categorías de inventario configurables, validación de serie por tipo, recibo térmico por tipo (es SP-2).
- Traducción i18n multi-idioma (esto es vocabulario por rubro, no idioma).
- Convertir el 100% de los strings de la app — solo el set acotado y las superficies priorizadas.

## Archivos afectados (resumen)

- **Nuevo:** migración `organizations.terminologia`; `lib/terminologia.ts`; `app/(dashboard)/configuracion/vocabulario/page.tsx` + componente form; helper server `getTerminologia`.
- **Editar:** `app/api/configuracion/route.ts` (GET devuelve terminologia, PUT la acepta); el provider/context de config + `useTerminologia()`; `app/(dashboard)/configuracion/page.tsx` (card); y las superficies de la Tanda 1 (orden-form, orden-detail, escpos, pdf, seguimiento, plantillas WhatsApp/email).
- **Tests:** unit de `resolveTerminologia`/`t`; unit del GET/PUT de terminología (ADMIN-only, merge, descarte de claves desconocidas).
