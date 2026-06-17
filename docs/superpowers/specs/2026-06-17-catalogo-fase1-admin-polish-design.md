# Catálogo — Fase 1: Admin polish + quick wins

**Fecha:** 2026-06-17
**Estado:** Diseño aprobado, pendiente plan de implementación
**Alcance:** Primera de 4 fases del overhaul de catálogo (ver "Roadmap" al final).

## Contexto

El catálogo (`/catalogo`) ya es un sistema maduro: admin de 5 tabs (Items, Categorías,
Cupones, Abandonados, Compartir) + storefront público + backend completo. No se construye
de cero. Esta fase cierra fricciones de UX y corrige inconsistencias detectadas en el
relevamiento, sin tocar el modelo de datos ni las APIs existentes (salvo consumo).

## Objetivos

Pulir el admin de catálogo con cambios de bajo riesgo y alto impacto:

1. Unificar diálogos de confirmación (eliminar los `window.confirm()` restantes).
2. Evitar doble-submit en borrado de variantes.
3. Edición inline de stock y precio en la vista lista de items.
4. Vista previa del catálogo público sin salir del admin (modal con iframe).
5. Feedback de carga a nivel ruta (`loading.tsx`).

## Fuera de alcance (otras fases)

- Búsqueda y paginación server-side (Fase 3).
- Exponer schema muerto: tags, múltiples imágenes por item, imagen y toggle activo de
  categoría, búsqueda por SKU (Fase 2).
- Rediseño visual del storefront público (Fase 4).

## Diseño

### Componentes afectados

| Archivo | Tipo | Cambio |
|---|---|---|
| `components/ui/confirm-dialog.tsx` | existente | Sin cambios (se reutiliza tal cual) |
| `components/catalogo/catalogo-variantes-editor.tsx` | edit | `confirm()` → `ConfirmDialog` + loading/guard |
| `components/catalogo/catalogo-carritos-abandonados-tab.tsx` | edit | `confirm()` → `ConfirmDialog` en "Descartar" |
| `components/catalogo/catalogo-items-tab.tsx` | edit | Inline edit stock/precio (list view) + loading en confirm de borrado |
| `components/catalogo/catalogo-admin.tsx` | edit | Fetch slug + botón "Vista previa" en header |
| `components/catalogo/catalogo-preview-dialog.tsx` | nuevo | Modal con iframe + toggle device |
| `components/catalogo/use-inline-edit.ts` | nuevo | Lógica pura testeable de edición inline |
| `app/(dashboard)/catalogo/loading.tsx` | nuevo | Skeleton a nivel ruta |

### 1. ConfirmDialog en variantes y carritos abandonados

`ConfirmDialog` ya existe (`components/ui/confirm-dialog.tsx`) con props `open`, `onOpenChange`,
`title`, `description`, `confirmText`, `variant` (`danger`/`warning`/`info`/`success`), `loading`,
`onConfirm`. El items-tab ya lo usa (línea 631). Se replica ese patrón.

**`catalogo-variantes-editor.tsx`** (hoy `if (!confirm("¿Eliminar variante?")) return` en :49):
- Nuevo estado: `deletingId: string | null` (id en confirmación) y `deleting: boolean` (request en curso).
- El botón de borrar setea `deletingId`. Se monta un `<ConfirmDialog variant="danger">`.
- `onConfirm` ejecuta el DELETE con `deleting=true`; al terminar limpia `deletingId`.
- Guard: si `deleting` ya es `true`, el handler retorna temprano (anti doble-submit).
- El `ConfirmDialog` recibe `loading={deleting}` (deshabilita botones y muestra "Procesando...").

**`catalogo-carritos-abandonados-tab.tsx`** (hoy `confirm()` en :128, acción "Descartar"):
- Mismo patrón: `discardId`/`discarding`, `<ConfirmDialog variant="danger">`.
- Copy: título "Descartar carrito", descripción que aclare que se pierde el lead.

### 2. Edición inline de stock/precio (solo list view)

La vista lista (tabla, `catalogo-items-tab.tsx` :313-423) tiene celdas Precio (:373) y Stock (:378).
Se vuelven editables.

**Interacción:**
- La celda muestra el valor como botón. Click → reemplaza por `<Input>` enfocado y seleccionado.
- Guarda en **blur** o **Enter**. **Esc** cancela (revierte al valor previo, sin request).
- Si el valor no cambió, no dispara request.

**Persistencia (optimista):**
- Update local inmediato del item en `items` state.
- `PUT /api/catalogo/items/[id]` con `{ stock }` o `{ precio }` (la API ya acepta updates parciales).
- En error: rollback al valor anterior + `toast.error`.

**Reglas de validación (cliente, en `use-inline-edit.ts`):**
- **Stock:** entero ≥ 0. Editable solo para `tipo === "PRODUCTO"`. `SERVICIO` muestra "—" no editable.
  Valor vacío → `null` (sin tracking). `0` válido (agotado).
- **Precio:** número ≥ 0. Vacío → `null` (se muestra "Consultar"). Acepta decimales.
- Entrada inválida (texto, negativo): se descarta, vuelve al valor previo, sin request.

**Edge — constraint de DB `precio_hasta >= precio`:** si el item tiene `precio_hasta` y el nuevo
`precio` lo viola, el `PUT` responde error. Se hace rollback + toast con el mensaje del servidor.
No se valida `precio_hasta` en cliente (no está en la celda); se confía en el rechazo del servidor.

**`use-inline-edit.ts` (unidad pura, testeable):** expone parsing/validación y el cómputo de
optimista→rollback, desacoplado del DOM. Firma tentativa:
- `parseStock(raw: string): { ok: true; value: number | null } | { ok: false }`
- `parsePrecio(raw: string): { ok: true; value: number | null } | { ok: false }`
La celda (componente) usa estos helpers; el request y el toast quedan en el componente.

La **vista grid no cambia** (mantiene "Editar" → diálogo).

### 3. Vista previa del catálogo público (modal iframe)

**`catalogo-admin.tsx`:**
- Al montar, `GET /api/catalogo/config` para obtener `slug` y `activo`.
- Botón "Vista previa" (icono `Eye`) en el header, junto al título. Siempre visible; deshabilitado
  mientras carga el slug.

**`catalogo-preview-dialog.tsx` (nuevo):**
- `Dialog` grande. Toggle **Móvil (375px)** / **Desktop (100%)** que ajusta el ancho del contenedor.
- `<iframe src={`/catalogo/${slug}`} />` con `title` accesible.
- Botón "Refrescar" (recarga el iframe vía cambio de `key`).
- Link "Abrir en pestaña" (`target="_blank" rel="noopener"`).
- **Edge — catálogo inactivo:** si `activo === false`, en vez del iframe se muestra un aviso:
  "El catálogo está desactivado. Activalo en la pestaña Compartir para previsualizarlo."
  (La ruta pública no renderiza catálogos inactivos.)

### 4. `loading.tsx` a nivel ruta

`app/(dashboard)/catalogo/loading.tsx`: skeleton que matchea el shell del admin (bloque de
header con título + fila de tabs + grilla de 6 cards placeholder), reutilizando el patrón de
skeleton que ya tiene el items-tab (:294-305).

### Bonus trivial

`catalogo-items-tab.tsx`: el `ConfirmDialog` de borrar item (:631) hoy no pasa `loading`. Se agrega
estado `deleting` y `loading={deleting}` para consistencia con el resto.

## Datos y APIs

No se crean ni modifican tablas ni endpoints. Se consumen los existentes:
- `GET /api/catalogo/config` → slug + activo (preview).
- `PUT /api/catalogo/items/[id]` → update parcial `{ stock }` / `{ precio }` (inline edit).
- `DELETE /api/catalogo/items/[id]/variantes/[varId]` → borrar variante.
- `PATCH /api/catalogo/carritos-abandonados/[id]` (`{ action: "discard" }`) → descartar carrito.

## Testing (TDD activo)

- **`use-inline-edit.ts`** (unidad pura): tests con vitest de `parseStock`/`parsePrecio` —
  enteros, negativos, vacío→null, decimales en precio, texto inválido, `0` válido en stock.
- **Migraciones de ConfirmDialog:** test de interacción (testing-library) verificando que al
  confirmar se llama al handler una sola vez y que `loading` deshabilita el botón (anti doble-submit).
- **Preview dialog:** test de que con `activo=false` se renderiza el aviso y no el iframe.
- No se testean estilos ni el render del iframe en sí.

## Criterios de aceptación

1. No queda ningún `window.confirm()` en `components/catalogo/`.
2. Borrar variante: no se puede disparar dos veces; muestra estado de carga.
3. En list view, stock y precio se editan inline con guardado optimista y rollback ante error.
4. Existe botón "Vista previa" en el header del admin que abre el catálogo en un modal con
   toggle móvil/desktop; con catálogo inactivo muestra el aviso correspondiente.
5. La ruta `/catalogo` muestra skeleton de carga a nivel Next.js.
6. `tsc --noEmit` y `eslint` en verde; tests nuevos pasan.

## Roadmap (contexto)

- **Fase 1 (este doc):** admin polish + quick wins.
- **Fase 2:** cerrar schema muerto (tags, multi-imagen, imagen/activo de categoría, búsqueda SKU).
- **Fase 3:** escala — búsqueda y paginación server-side (items admin, abandonados, público).
- **Fase 4:** rediseño UI/UX del storefront público.
