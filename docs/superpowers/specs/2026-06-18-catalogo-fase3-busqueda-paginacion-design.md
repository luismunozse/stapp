# Catálogo — Fase 3: Búsqueda server-side + paginación (admin items)

**Fecha:** 2026-06-18
**Estado:** Diseño aprobado, pendiente plan de implementación
**Alcance:** Tercera de 4 fases del overhaul de catálogo (ver Roadmap).

## Contexto

Hoy la lista de items del admin (`GET /api/catalogo/items` + `catalogo-items-tab.tsx`) carga
**todos** los items de la organización en una sola request y filtra/busca client-side. Para orgs
con cientos o miles de productos esto es lento (payload grande, filtrado en memoria). Además la
búsqueda solo matchea `nombre` — no encuentra por SKU de variante ni por código de inventario.

Esta fase migra la lista del admin a **búsqueda y paginación server-side**, siguiendo las
convenciones del repo (`parsePagination` en `lib/api-utils.ts`, `?page=&limit=`, `{ count: "exact" }`,
respuesta `{ data, total, page, limit, totalPages }` como en `inventario`/`ordenes`/`clientes`).

Hechos verificados:
- `GET /api/catalogo/items`: sin limit/range/count; `q` = `ilike("nombre", %q%)` únicamente; usa
  `requireAuth()` + `.eq("organization_id", auth.organizationId)`; `select` incluye joins a
  `categoria` e `inventario`; orden `orden ASC, created_at DESC`.
- SKU vive en `catalogo_variantes.sku` (FK `item_id`), código en `inventario.codigo` (item linkeado
  por `catalogo_items.inventario_id`). PostgREST `.or()` **no cruza tablas** → búsqueda multi-fuente
  requiere app-layer (2 pasos) o RPC. **Decidido: app-layer 2 pasos** (sin migración, testeable,
  suficiente para escala SMB).
- `items-tab` depende de tener toda la lista en memoria para: `filtered`, `sinImagenCount`,
  `tagSuggestions` (flatMap), drag-reorder, bulk select-all.
- Storefront público es un path aparte (SSR cacheado + Fuse.js, `lib/catalogo/fetch-data.ts`) →
  **fuera de scope** (Fase 4). Carritos abandonados ya tiene `limit` → fuera de scope.

## Objetivos

1. Búsqueda server-side de items que matchee **nombre OR SKU de variante OR código de inventario**.
2. Paginación server-side de la lista del admin (page/limit/total/totalPages).
3. Mantener funcionando las features del tab que dependían de la lista completa (tags, contador
   "sin foto", drag-reorder) vía un endpoint de agregados y reglas claras.

## Fuera de alcance

- Paginar/buscar carritos abandonados (ya tiene limit; valor bajo).
- Paginar el storefront público (es SSR+Fuse; paginarlo = rediseño UX → Fase 4).
- Índices full-text/trigram o RPC con tsvector (optimización futura si la escala lo pide).

## Diseño

### 1. `GET /api/catalogo/items` (refactor)

Params (todos opcionales): `q`, `tipo` (PRODUCTO|SERVICIO), `categoria_id`, `estado`
(activo|inactivo), `sin_imagen` ("1"), `page`, `limit`.

- `const { page, limit, offset } = parsePagination(searchParams)` (default 20, max 100).
- **Búsqueda 2 pasos** (solo si `q` no vacío, ya `trim`):
  1. Sanitizar `q` para uso en filtros PostgREST: quitar los caracteres que rompen la sintaxis de
     `.or()`/`ilike` embebido — comas, paréntesis y backslashes (`q.replace(/[,()\\]/g, " ")`).
     Si tras sanitizar queda vacío, tratar como sin búsqueda.
  2. En paralelo: `catalogo_variantes` `select("item_id")` `eq(org)` `ilike("sku", %q%)`; e
     `inventario` `select("id")` `eq(org)` `ilike("codigo", %q%)`. Con los `inventario.id`
     encontrados, query a `catalogo_items select("id") eq(org) in("inventario_id", invIds)` para
     resolver los item ids linkeados.
  3. `extraIds = dedup([...variantItemIds, ...invItemIds])`.
- Query principal: `from("catalogo_items").select("<igual que hoy>", { count: "exact" }).eq(org)`,
  más los filtros exactos (`categoria_id`, `tipo`, `estado→activo bool`, `sin_imagen→is("imagen_url", null)`).
  - Texto: si `q`: cuando `extraIds.length > 0` → `.or(\`nombre.ilike.%q%,id.in.(\${extraIds.join(",")})\`)`;
    si no hay extraIds → `.ilike("nombre", %q%)`.
  - Orden: `orden ASC, created_at DESC`. `.range(offset, offset + limit - 1)`.
- Respuesta: `{ items: data ?? [], total: count ?? 0, page, limit, totalPages: Math.ceil((count ?? 0) / limit) }`.

### 2. `GET /api/catalogo/items/meta` (nuevo)

Devuelve los agregados que el tab no puede derivar de una sola página:
- `tags: string[]` — distinct de `etiquetas` de todos los items del org (fetch de la columna
  `etiquetas` para el org, flatten + dedup + sort en el handler).
- `sinImagenCount: number` — `count` de items `activo = true AND imagen_url IS NULL`
  (`{ count: "exact", head: true }`).
- Respuesta: `{ tags, sinImagenCount }`. Scoping por `organization_id`. `requireAuth()`.

### 3. `catalogo-items-tab.tsx` (refactor a server-driven)

- **Carga**: arma un querystring con los filtros actuales (`q`, `tipo`, `categoria_id`, `estado`,
  `sin_imagen`, `page`, `limit`) y hace `fetch(\`/api/catalogo/items?\${qs}\`)`. Guarda `items`,
  `total`, `totalPages`, `page`.
- **Debounce**: el input de búsqueda se debouncea (~300ms) antes de disparar el fetch. Extraer un
  hook `useDebouncedValue` reutilizable (testeable) o helper. Al cambiar cualquier filtro o la
  búsqueda, **resetear a `page = 1`**.
- **Querystring**: extraer la construcción a un helper puro `buildItemsQuery(params)` testeable.
- **Paginación UI**: controles "Anterior / Siguiente", texto "Página X de Y" y "N items"
  (siguiendo el patrón visual del repo). Deshabilitar Anterior en page 1 y Siguiente en la última.
- **Agregados**: `tagSuggestions` y `sinImagenCount` se obtienen del `/meta` endpoint (fetch on
  mount + tras crear/editar/borrar/bulk). Ya no se computan de `items`.
- **Drag-reorder**: habilitado solo cuando no hay filtros ni búsqueda activos, `viewMode === "grid"`,
  sin selección, y `totalPages === 1` (todo en una página). Si no, deshabilitado; mostrar hint
  ("Quitá los filtros para reordenar") cuando el usuario intente.
- **Bulk**: "seleccionar visibles" sigue operando sobre la página actual (la `items` cargada).
  No se agrega "seleccionar todos los que matchean" (YAGNI).
- Las mutaciones (crear/editar/borrar/bulk/duplicar/inline-edit) recargan la página actual +
  refrescan el meta.

## Datos y APIs

- Sin cambios de DB. Nuevo endpoint `/api/catalogo/items/meta`. Refactor del GET de items.
- Reusa `parsePagination` de `lib/api-utils.ts`.

## Testing (TDD activo)

- **API items GET** (patrón `__tests__/api/inventario-search.test.ts`, mock de `supabaseAdmin`):
  - busca por `nombre` (ilike), por SKU de variante (2-paso → id.in), por código de inventario;
  - combina filtros (tipo/categoria/estado/sin_imagen);
  - paginación: aplica `range(offset, offset+limit-1)`, devuelve `total`/`page`/`totalPages`;
  - scoping `organization_id`;
  - `q` con caracteres peligrosos (`,()`) se sanitiza y no rompe el filtro.
- **API meta GET**: `tags` dedup+sort, `sinImagenCount` con el filtro correcto.
- **`buildItemsQuery`** (helper puro): omite params vacíos, arma el querystring esperado.
- **`useDebouncedValue`** (si se extrae): retorna el valor tras el delay (con fake timers).

## Criterios de aceptación

1. La búsqueda del admin encuentra items por nombre, por SKU de variante y por código de inventario.
2. La lista pagina server-side: cambia de página sin recargar todo; muestra total y "página X de Y".
3. Cambiar búsqueda/filtros resetea a página 1 y debouncea la búsqueda.
4. Tags-suggestions y el contador "sin foto" siguen funcionando (vía `/meta`), no por scan en memoria.
5. Drag-reorder solo disponible cuando todo entra en una página y sin filtros.
6. `tsc` + `eslint` verdes; tests nuevos pasan; `next build` exit 0.

## Roadmap (contexto)

- **Fase 1 (en main):** admin polish.
- **Fase 2 (en main):** cerrar schema muerto.
- **Fase 3 (este doc):** búsqueda server-side + paginación (admin items).
- **Fase 4:** rediseño UI/UX del storefront público (incluye su propia estrategia de carga/scroll).
