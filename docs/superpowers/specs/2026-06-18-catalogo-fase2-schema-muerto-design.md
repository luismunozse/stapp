# Catálogo — Fase 2: Cerrar schema muerto

**Fecha:** 2026-06-18
**Estado:** Diseño aprobado, pendiente plan de implementación
**Alcance:** Segunda de 4 fases del overhaul de catálogo (ver Roadmap).

## Contexto

Varias columnas del catálogo existen en la DB y se consumen en el storefront público,
pero no tienen UI de admin para editarlas — son "schema muerto". Esta fase agrega esa UI.
**No hay cambios de backend, DB ni API**: los endpoints ya aceptan y persisten todos los
campos; el storefront público ya los renderiza. El gap es 100% UI de admin.

Verificado en el relevamiento:
- `catalogo_items.etiquetas (text[])`: aceptado en POST/PUT (`z.array(z.string().max(40))`),
  escrito como `etiquetas: d.etiquetas ?? []`. El público lo usa como chips de filtro +
  peso en la búsqueda Fuse.js + badges en el detalle.
- `catalogo_items.imagenes (text[])`: aceptado en POST/PUT, escrito como `imagenes: d.imagenes ?? []`.
  El público arma la galería como `[imagen_url, ...imagenes].filter(Boolean)`.
- `catalogo_categorias.imagen_url (text)` y `activo (boolean)`: aceptados en POST/PUT, columnas
  presentes (migración 143).
- `POST /api/catalogo/upload`: FormData campo `"file"`, acepta jpeg/png/webp ≤4MB, responde
  `{ url, path }`. Stateless → se puede llamar N veces para una galería.

## Objetivos

1. Editar **tags** (`etiquetas`) de un item desde el dialog.
2. Gestionar **múltiples imágenes** por item (galería) + elegir portada.
3. Editar **imagen** y **estado activo** de una categoría.

## Fuera de alcance

- **Búsqueda por SKU**: los items no tienen SKU propio (vive en `catalogo_variantes.sku` y
  `inventario.codigo`); buscar por SKU requiere join server-side → se hace en **Fase 3** junto
  con la búsqueda y paginación server-side, sin reescribir.
- Reordenar la galería de imágenes (drag).
- Cambios de backend/DB/API.

## Diseño

### Componentes afectados

| Archivo | Tipo | Cambio |
|---|---|---|
| `components/catalogo/tags-input.tsx` | nuevo | Input de chips presentacional |
| `components/catalogo/image-gallery-input.tsx` | nuevo | Galería: portada + adicionales, subir/quitar/hacer-portada |
| `components/catalogo/catalogo-item-dialog.tsx` | edit | Integrar TagsInput + ImageGalleryInput; estado `etiquetas`/`imagenes`; payload |
| `components/catalogo/catalogo-items-tab.tsx` | edit | Computar tags existentes y pasarlos al dialog (sugerencias) |
| `components/catalogo/catalogo-categorias-tab.tsx` | edit | CategoriaDialog: upload imagen + Switch activo; lista: thumbnail + badge Inactiva |

### 1. Tags (`tags-input.tsx`)

Componente presentacional controlado:
- Props: `value: string[]`, `onChange: (next: string[]) => void`, `suggestions?: string[]`, `maxLength?` (default 40).
- Render: chips existentes (cada uno con botón X) + input de texto.
- Agregar: **Enter** o **coma** confirma el texto actual como tag. Trim, ignora vacío, dedup
  (case-insensitive: no agrega si ya existe ignorando mayúsculas), trunca a `maxLength`.
- Quitar: X del chip, o **Backspace** con input vacío quita el último.
- Sugerencias: las `suggestions` que no estén ya en `value` se muestran como chips clickeables
  debajo (quick-add). Si no hay suggestions, no se renderiza la fila.

### 2. Multi-imagen (`image-gallery-input.tsx`)

Componente que gestiona portada + galería. El modelo de datos: `imagen_url` (portada, string|null)
y `imagenes` (adicionales, string[]). **Invariante: la portada nunca está duplicada dentro de
`imagenes`.**

- Props: `cover: string | null`, `gallery: string[]`, `onChange: (next: { cover: string | null; gallery: string[] }) => void`, `uploading?`, `onUpload: (file: File) => Promise<string>` (sube y devuelve URL).
- Render: una grilla de imágenes. La portada se marca con un badge "Portada". Cada imagen
  (portada o de galería) tiene: botón quitar (X) y, si no es la portada, botón "Hacer portada".
- Subir: input file (acepta múltiples). Por cada archivo llama `onUpload`; el primer upload cuando
  no hay portada la setea como portada, el resto van a `gallery`.
- Hacer portada: la imagen elegida pasa a `cover`; la portada anterior (si existía) entra a `gallery`.
- Quitar portada: `cover` pasa a `null` (no se promueve nada automáticamente; el usuario elige).
- Quitar de galería: se saca de `gallery`.
- Validación de archivo (tipo/tamaño) la hace el endpoint; el componente solo refleja errores
  vía el `onUpload` que rechaza (el dialog muestra toast).

La lógica pura de transición (add/remove/setCover, manteniendo la invariante de no-duplicado) se
extrae a helpers testeables en el mismo archivo o en `lib/catalogo/gallery.ts`.

### 3. Item dialog (`catalogo-item-dialog.tsx`)

- Nuevos estados: `etiquetas: string[]`, `imagenes: string[]` (galería sin portada). Se cargan
  del `item` en modo edición (`item.etiquetas ?? []`, `item.imagenes ?? []`).
- Reemplazar el upload de portada único por `<ImageGalleryInput>` (cover = el actual `imagenUrl`,
  gallery = `imagenes`). El handler de upload existente (`POST /api/catalogo/upload`, campo `file`,
  lee `data.url`) se adapta a la firma `onUpload(file) => Promise<string>`.
- Agregar `<TagsInput>` con `suggestions` provenientes del items-tab.
- Payload (`handleSave`): sumar `etiquetas` e `imagenes`. `imagen_url` sigue siendo la portada.

### 4. Items tab (`catalogo-items-tab.tsx`)

- Computar el set de tags existentes: `Array.from(new Set(items.flatMap(i => i.etiquetas ?? []))).sort()`.
- Pasarlo al `<CatalogoItemDialog>` como prop `tagSuggestions`.

### 5. Categorías (`catalogo-categorias-tab.tsx`)

- `CategoriaDialog`: nuevos estados `imagenUrl: string | null` y `activo: boolean` (default true en
  creación; carga del `categoria` en edición). Upload de imagen reusando `POST /api/catalogo/upload`.
  Switch para `activo`. Incluir ambos en el payload (POST/PUT ya los aceptan).
- Lista de categorías: mostrar thumbnail (si `imagen_url`) y un badge "Inactiva" cuando `!activo`.

## Datos y APIs

Sin cambios. Se consumen:
- `POST /api/catalogo/upload` → `{ url }` (imágenes de item y de categoría).
- `POST/PUT /api/catalogo/items[/id]` → ya aceptan `etiquetas`, `imagenes`.
- `POST/PUT /api/catalogo/categorias[/id]` → ya aceptan `imagen_url`, `activo`.

## Testing (TDD activo)

- **`tags-input.tsx`**: tests de interacción — Enter/coma agrega; dedup case-insensitive;
  trim/ignora vacío; X y Backspace quitan; click en sugerencia agrega y la saca de la fila.
- **galería (helpers puros)**: tests de `setCover` (swap correcto, portada anterior va a galería),
  `removeCover`, `removeFromGallery`, `addUploaded` (primero sin portada → portada; resto → galería),
  e **invariante**: la portada nunca queda duplicada en `gallery`.
- **`image-gallery-input.tsx`**: render de portada vs galería, botón "Hacer portada" dispara onChange
  con el swap esperado.
- No se testea el upload real ni estilos.

## Criterios de aceptación

1. Desde el item dialog se pueden agregar/quitar tags y persisten (visibles luego como chips de
   filtro en el público).
2. Desde el item dialog se pueden subir varias imágenes, quitarlas y elegir portada; la portada
   nunca queda duplicada en `imagenes`.
3. Desde el CategoriaDialog se puede subir imagen y togglear activo; la lista muestra thumbnail y
   badge "Inactiva".
4. `tsc --noEmit` y `eslint` en verde; tests nuevos pasan.

## Roadmap (contexto)

- **Fase 1 (hecha, en main):** admin polish + quick wins.
- **Fase 2 (este doc):** cerrar schema muerto.
- **Fase 3:** escala — búsqueda (incluye SKU/código vía join) y paginación server-side.
- **Fase 4:** rediseño UI/UX del storefront público.
