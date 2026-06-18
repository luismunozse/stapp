# Catálogo Fase 2 — Cerrar schema muerto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Agregar UI de admin para campos que ya existen en DB/API pero no se podían editar: tags e imágenes múltiples de items, e imagen + estado activo de categorías.

**Architecture:** Solo UI en `components/catalogo/`. Sin cambios de backend/DB/API (ya aceptan los campos). Lógica de transición de galería extraída a helpers puros testeables; TagsInput e ImageGalleryInput son componentes presentacionales controlados.

**Tech Stack:** Next.js client components, TS, Tailwind, vitest 4 + @testing-library/react (jsdom, globals, `fireEvent` — no user-event), sonner.

**Spec:** `docs/superpowers/specs/2026-06-18-catalogo-fase2-schema-muerto-design.md`

---

## Convenciones de testing
- `npx vitest run <ruta>`. Config: jsdom, globals, alias `@`, setup `vitest.setup.ts` (jest-dom ya importado).
- Sin `@testing-library/user-event` → usar `fireEvent`.
- Imports: `import { render, screen, fireEvent, waitFor } from "@testing-library/react"`.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `lib/catalogo/gallery.ts` (nuevo) | Helpers puros: `addImage`, `setCover`, `removeCover`, `removeFromGallery` + tipo `Gallery`. Invariante: cover nunca en gallery. |
| `components/catalogo/tags-input.tsx` (nuevo) | Chip input controlado. |
| `components/catalogo/image-gallery-input.tsx` (nuevo) | Galería controlada (usa helpers). |
| `components/catalogo/catalogo-item-dialog.tsx` (modificar) | Integrar TagsInput + ImageGalleryInput; estado `etiquetas`/`imagenes`; payload; prop `tagSuggestions`. |
| `components/catalogo/catalogo-items-tab.tsx` (modificar) | Computar tags existentes y pasarlos al dialog. |
| `components/catalogo/catalogo-categorias-tab.tsx` (modificar) | CategoriaDialog: imagen + activo; lista: thumbnail + badge Inactiva. |

---

## Task 1: Helpers de galería (`lib/catalogo/gallery.ts`)

**Files:**
- Create: `lib/catalogo/gallery.ts`
- Test: `__tests__/lib/catalogo-gallery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/catalogo-gallery.test.ts
import { describe, it, expect } from "vitest"
import { addImage, setCover, removeCover, removeFromGallery, type Gallery } from "@/lib/catalogo/gallery"

const empty: Gallery = { cover: null, gallery: [] }

describe("addImage", () => {
  it("first image with no cover becomes the cover", () => {
    expect(addImage(empty, "a.jpg")).toEqual({ cover: "a.jpg", gallery: [] })
  })
  it("subsequent images go to the gallery", () => {
    const s = addImage({ cover: "a.jpg", gallery: [] }, "b.jpg")
    expect(s).toEqual({ cover: "a.jpg", gallery: ["b.jpg"] })
  })
  it("dedups: url already cover is a no-op", () => {
    expect(addImage({ cover: "a.jpg", gallery: [] }, "a.jpg")).toEqual({ cover: "a.jpg", gallery: [] })
  })
  it("dedups: url already in gallery is a no-op", () => {
    expect(addImage({ cover: "a.jpg", gallery: ["b.jpg"] }, "b.jpg")).toEqual({ cover: "a.jpg", gallery: ["b.jpg"] })
  })
})

describe("setCover", () => {
  it("promotes a gallery image and demotes the old cover into the gallery", () => {
    const s = setCover({ cover: "a.jpg", gallery: ["b.jpg", "c.jpg"] }, "b.jpg")
    expect(s.cover).toBe("b.jpg")
    expect(s.gallery).toContain("a.jpg")
    expect(s.gallery).not.toContain("b.jpg")
    expect(s.gallery).toContain("c.jpg")
  })
  it("never leaves the cover duplicated in the gallery", () => {
    const s = setCover({ cover: "a.jpg", gallery: ["b.jpg"] }, "b.jpg")
    expect(s.gallery).not.toContain(s.cover as string)
  })
  it("setting current cover is a no-op", () => {
    expect(setCover({ cover: "a.jpg", gallery: ["b.jpg"] }, "a.jpg")).toEqual({ cover: "a.jpg", gallery: ["b.jpg"] })
  })
  it("when there was no cover, just promotes (nothing demoted)", () => {
    expect(setCover({ cover: null, gallery: ["b.jpg"] }, "b.jpg")).toEqual({ cover: "b.jpg", gallery: [] })
  })
})

describe("removeCover", () => {
  it("clears the cover, leaves gallery untouched", () => {
    expect(removeCover({ cover: "a.jpg", gallery: ["b.jpg"] })).toEqual({ cover: null, gallery: ["b.jpg"] })
  })
})

describe("removeFromGallery", () => {
  it("removes the given url from the gallery", () => {
    expect(removeFromGallery({ cover: "a.jpg", gallery: ["b.jpg", "c.jpg"] }, "b.jpg")).toEqual({ cover: "a.jpg", gallery: ["c.jpg"] })
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx vitest run __tests__/lib/catalogo-gallery.test.ts` → module not found.

- [ ] **Step 3: Implement**

```ts
// lib/catalogo/gallery.ts
export type Gallery = { cover: string | null; gallery: string[] }

/** Agrega una URL: si no hay portada, se vuelve portada; si no, va a la galería. Dedup total. */
export function addImage(state: Gallery, url: string): Gallery {
  if (state.cover === url || state.gallery.includes(url)) return state
  if (state.cover == null) return { cover: url, gallery: state.gallery }
  return { cover: state.cover, gallery: [...state.gallery, url] }
}

/** Hace portada a una imagen: la portada anterior baja a la galería. Mantiene la invariante. */
export function setCover(state: Gallery, url: string): Gallery {
  if (state.cover === url) return state
  const gallery = state.gallery.filter((u) => u !== url)
  if (state.cover != null && !gallery.includes(state.cover)) gallery.push(state.cover)
  return { cover: url, gallery }
}

/** Quita la portada (no promueve nada). */
export function removeCover(state: Gallery): Gallery {
  return { cover: null, gallery: state.gallery }
}

/** Quita una imagen de la galería. */
export function removeFromGallery(state: Gallery, url: string): Gallery {
  return { cover: state.cover, gallery: state.gallery.filter((u) => u !== url) }
}
```

- [ ] **Step 4: Run, verify PASS.**

- [ ] **Step 5: Commit**

```bash
git add lib/catalogo/gallery.ts __tests__/lib/catalogo-gallery.test.ts
git commit -m "feat(catalogo): helpers puros de galería (cover/gallery)"
```

---

## Task 2: TagsInput (`tags-input.tsx`)

**Files:**
- Create: `components/catalogo/tags-input.tsx`
- Test: `__tests__/components/catalogo-tags-input.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/catalogo-tags-input.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { TagsInput } from "@/components/catalogo/tags-input"

function setup(value: string[] = [], onChange = vi.fn(), suggestions: string[] = []) {
  render(<TagsInput value={value} onChange={onChange} suggestions={suggestions} />)
  return { onChange }
}

describe("TagsInput", () => {
  it("Enter adds a trimmed tag", () => {
    const { onChange } = setup([])
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "  rojo  " } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).toHaveBeenCalledWith(["rojo"])
  })

  it("comma adds a tag", () => {
    const { onChange } = setup([])
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "azul" } })
    fireEvent.keyDown(input, { key: "," })
    expect(onChange).toHaveBeenCalledWith(["azul"])
  })

  it("ignores empty and dedups case-insensitively", () => {
    const onChange = vi.fn()
    setup(["Rojo"], onChange)
    const input = screen.getByRole("textbox")
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.change(input, { target: { value: "rojo" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("X on a chip removes it", () => {
    const { onChange } = setup(["rojo", "azul"])
    fireEvent.click(screen.getByRole("button", { name: /quitar rojo/i }))
    expect(onChange).toHaveBeenCalledWith(["azul"])
  })

  it("Backspace on empty input removes the last tag", () => {
    const { onChange } = setup(["rojo", "azul"])
    const input = screen.getByRole("textbox")
    fireEvent.keyDown(input, { key: "Backspace" })
    expect(onChange).toHaveBeenCalledWith(["rojo"])
  })

  it("clicking a suggestion adds it", () => {
    const { onChange } = setup(["rojo"], vi.fn(), ["rojo", "oferta"])
    // "rojo" already present should not appear as suggestion; "oferta" should
    fireEvent.click(screen.getByRole("button", { name: /agregar oferta/i }))
    expect(onChange).toHaveBeenCalledWith(["rojo", "oferta"])
  })
})
```

- [ ] **Step 2: Run, verify FAIL** (module not found).

- [ ] **Step 3: Implement**

```tsx
// components/catalogo/tags-input.tsx
"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { X, Plus } from "lucide-react"

interface TagsInputProps {
  value: string[]
  onChange: (next: string[]) => void
  suggestions?: string[]
  maxLength?: number
  placeholder?: string
}

export function TagsInput({
  value,
  onChange,
  suggestions = [],
  maxLength = 40,
  placeholder = "Agregar etiqueta…",
}: TagsInputProps) {
  const [draft, setDraft] = useState("")

  const add = (raw: string) => {
    const t = raw.trim().slice(0, maxLength)
    if (!t) return
    if (value.some((v) => v.toLowerCase() === t.toLowerCase())) return
    onChange([...value, t])
  }

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag))

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      add(draft)
      setDraft("")
    } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
      e.preventDefault()
      remove(value[value.length - 1])
    }
  }

  const freeSuggestions = suggestions.filter(
    (s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()),
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 rounded-md border p-1.5">
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {tag}
            <button
              type="button"
              aria-label={`Quitar ${tag}`}
              onClick={() => remove(tag)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          className="h-7 flex-1 min-w-[120px] border-0 shadow-none focus-visible:ring-0 px-1"
        />
      </div>
      {freeSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {freeSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Agregar ${s}`}
              onClick={() => add(s)}
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run, verify PASS (6/6).**

- [ ] **Step 5: Commit**

```bash
git add components/catalogo/tags-input.tsx __tests__/components/catalogo-tags-input.test.tsx
git commit -m "feat(catalogo): TagsInput de chips con sugerencias"
```

---

## Task 3: ImageGalleryInput (`image-gallery-input.tsx`)

**Files:**
- Create: `components/catalogo/image-gallery-input.tsx`
- Test: `__tests__/components/catalogo-image-gallery-input.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/catalogo-image-gallery-input.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ImageGalleryInput } from "@/components/catalogo/image-gallery-input"

describe("ImageGalleryInput", () => {
  it("marks the cover and renders gallery images", () => {
    render(
      <ImageGalleryInput
        cover="a.jpg"
        gallery={["b.jpg"]}
        onChange={vi.fn()}
        onUpload={vi.fn()}
      />,
    )
    expect(screen.getByText(/portada/i)).toBeInTheDocument()
    // 2 images total
    expect(screen.getAllByRole("img")).toHaveLength(2)
  })

  it("'Hacer portada' promotes a gallery image and demotes the cover", () => {
    const onChange = vi.fn()
    render(
      <ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={onChange} onUpload={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /hacer portada/i }))
    expect(onChange).toHaveBeenCalledWith({ cover: "b.jpg", gallery: ["a.jpg"] })
  })

  it("removing the cover clears it", () => {
    const onChange = vi.fn()
    render(
      <ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={onChange} onUpload={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole("button", { name: /quitar portada/i }))
    expect(onChange).toHaveBeenCalledWith({ cover: null, gallery: ["b.jpg"] })
  })

  it("uploading a file appends via onUpload + addImage", async () => {
    const onChange = vi.fn()
    const onUpload = vi.fn().mockResolvedValue("c.jpg")
    const { container } = render(
      <ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={onChange} onUpload={onUpload} />,
    )
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["x"], "c.jpg", { type: "image/jpeg" })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ cover: "a.jpg", gallery: ["b.jpg", "c.jpg"] }))
  })
})
```

- [ ] **Step 2: Run, verify FAIL** (module not found).

- [ ] **Step 3: Implement**

```tsx
// components/catalogo/image-gallery-input.tsx
"use client"

import { useRef } from "react"
import { Button } from "@/components/ui/button"
import { Upload, Loader2, X, Star } from "lucide-react"
import { addImage, setCover, removeCover, removeFromGallery, type Gallery } from "@/lib/catalogo/gallery"

interface ImageGalleryInputProps {
  cover: string | null
  gallery: string[]
  onChange: (next: Gallery) => void
  onUpload: (file: File) => Promise<string>
  uploading?: boolean
}

export function ImageGalleryInput({ cover, gallery, onChange, onUpload, uploading }: ImageGalleryInputProps) {
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFiles = async (files: FileList) => {
    let next: Gallery = { cover, gallery }
    for (const file of Array.from(files)) {
      try {
        const url = await onUpload(file)
        next = addImage(next, url)
      } catch {
        // onUpload surfaces its own error toast; skip this file
      }
    }
    onChange(next)
  }

  const items: { url: string; isCover: boolean }[] = [
    ...(cover ? [{ url: cover, isCover: true }] : []),
    ...gallery.map((url) => ({ url, isCover: false })),
  ]

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {items.map(({ url, isCover }) => (
          <div key={url} className="relative aspect-square rounded-md overflow-hidden border bg-muted group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-full object-cover" />
            {isCover && (
              <span className="absolute top-1 left-1 inline-flex items-center gap-0.5 rounded bg-background/90 px-1 py-0.5 text-[10px] font-medium">
                <Star className="h-2.5 w-2.5 fill-current text-amber-500" />
                Portada
              </span>
            )}
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-background/80 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!isCover ? (
                <button
                  type="button"
                  aria-label="Hacer portada"
                  onClick={() => onChange(setCover({ cover, gallery }, url))}
                  className="text-[10px] hover:underline"
                >
                  Hacer portada
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground">Principal</span>
              )}
              <button
                type="button"
                aria-label={isCover ? "Quitar portada" : "Quitar imagen"}
                onClick={() => onChange(isCover ? removeCover({ cover, gallery }) : removeFromGallery({ cover, gallery }, url))}
                className="text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="aspect-square rounded-md border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          <span className="text-[10px]">Subir</span>
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) handleFiles(e.target.files)
          e.target.value = ""
        }}
      />
      <p className="text-[11px] text-muted-foreground">
        La primera imagen es la portada. Pasá el mouse para hacer portada o quitar. JPG/PNG/WEBP ≤4MB.
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Run, verify PASS (4/4).**

- [ ] **Step 5: Commit**

```bash
git add components/catalogo/image-gallery-input.tsx __tests__/components/catalogo-image-gallery-input.test.tsx
git commit -m "feat(catalogo): ImageGalleryInput (portada + galería)"
```

---

## Task 4: Integrar en item dialog (`catalogo-item-dialog.tsx`)

**Files:**
- Modify: `components/catalogo/catalogo-item-dialog.tsx`

Sin test nuevo (lógica ya testeada). Verificar tsc + lint.

- [ ] **Step 1: Imports + prop**

Agregar imports:
```tsx
import { TagsInput } from "./tags-input"
import { ImageGalleryInput } from "./image-gallery-input"
import type { Gallery } from "@/lib/catalogo/gallery"
```
Agregar `tagSuggestions?: string[]` a `interface Props` y al destructuring: `{ item, categorias, open, onClose, onSaved, tagSuggestions = [] }`.

- [ ] **Step 2: Estado**

Junto a los otros `useState`, agregar:
```tsx
const [etiquetas, setEtiquetas] = useState<string[]>([])
const [imagenes, setImagenes] = useState<string[]>([])
```
En el `useEffect` de carga: en la rama `if (item)` agregar `setEtiquetas(item.etiquetas ?? [])` y `setImagenes(item.imagenes ?? [])`; en el `else` agregar `setEtiquetas([])` y `setImagenes([])`.

- [ ] **Step 3: Adaptar el upload para devolver la URL**

Reemplazar `handleUpload` por una función que sube y DEVUELVE la url (la galería decide qué hacer):
```tsx
const uploadFile = async (file: File): Promise<string> => {
  setUploading(true)
  try {
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/catalogo/upload", { method: "POST", body: fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Error al subir imagen")
    return data.url as string
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error al subir imagen")
    throw err
  } finally {
    setUploading(false)
  }
}
```

- [ ] **Step 4: Reemplazar el bloque "Imagen" por la galería**

Reemplazar todo el `<div>` del label "Imagen" (el bloque que hoy tiene el preview de `imagenUrl`, botón subir/cambiar/quitar y el `<input type=file>`; aprox. el bloque que empieza con `<Label>Imagen</Label>`) por:
```tsx
<div>
  <Label>Imágenes</Label>
  <div className="mt-1.5">
    <ImageGalleryInput
      cover={imagenUrl}
      gallery={imagenes}
      uploading={uploading}
      onUpload={uploadFile}
      onChange={(next: Gallery) => {
        setImagenUrl(next.cover)
        setImagenes(next.gallery)
      }}
    />
  </div>
</div>
```
Eliminar `fileInputRef` y su `<input>` si ya no se usan (la galería tiene el suyo). El icono `ImageOff`/`Upload`/`Star` imports que queden sin uso: quitarlos del import de lucide-react. (Verificar con eslint qué queda sin usar.)

- [ ] **Step 5: Agregar TagsInput**

Después del bloque de Descripción (o antes del bloque de Categoría), agregar:
```tsx
<div>
  <Label>Etiquetas</Label>
  <div className="mt-1.5">
    <TagsInput value={etiquetas} onChange={setEtiquetas} suggestions={tagSuggestions} />
  </div>
  <p className="text-xs text-muted-foreground mt-1">
    Ayudan a los clientes a filtrar y buscar. Enter o coma para agregar.
  </p>
</div>
```

- [ ] **Step 6: Payload**

En `handleSave`, agregar al objeto `payload`:
```tsx
etiquetas,
imagenes,
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` → 0 errores nuevos (puede aparecer el pre-existente de `csv-export.test.ts`; ignorar).
Run: `npx eslint "components/catalogo/catalogo-item-dialog.tsx"` → 0 warnings (limpiar imports sin uso).

- [ ] **Step 8: Commit**

```bash
git add components/catalogo/catalogo-item-dialog.tsx
git commit -m "feat(catalogo): tags y galería de imágenes en el item dialog"
```

---

## Task 5: Pasar tags existentes desde items-tab (`catalogo-items-tab.tsx`)

**Files:**
- Modify: `components/catalogo/catalogo-items-tab.tsx`

- [ ] **Step 1: Computar sugerencias y pasarlas**

Dentro de `CatalogoItemsTab`, antes del `return`, agregar:
```tsx
const tagSuggestions = Array.from(
  new Set(items.flatMap((i) => i.etiquetas ?? [])),
).sort((a, b) => a.localeCompare(b))
```
En el render del `<CatalogoItemDialog ... />` (donde se pasa `item`, `categorias`, etc.), agregar la prop:
```tsx
tagSuggestions={tagSuggestions}
```

- [ ] **Step 2: Verify**

Run: `npx eslint "components/catalogo/catalogo-items-tab.tsx"` → 0 warnings.
Run: `npx tsc --noEmit` → 0 errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add components/catalogo/catalogo-items-tab.tsx
git commit -m "feat(catalogo): sugerencias de etiquetas existentes en el item dialog"
```

---

## Task 6: Categoría — imagen + activo (`catalogo-categorias-tab.tsx`)

**Files:**
- Modify: `components/catalogo/catalogo-categorias-tab.tsx`

Sin test nuevo. Verificar tsc + lint. NOTA: el `CategoriaDialog` se monta condicionalmente (`{(creating || editing) && <CategoriaDialog/>}`), así que inicializar estado con `useState(categoria?.x ?? default)` es correcto (monta fresco cada vez).

- [ ] **Step 1: Imports**

Agregar a los imports del archivo:
```tsx
import { Switch } from "@/components/ui/switch"
import { Upload, Loader2, ImageOff, X } from "lucide-react"
```
(El archivo ya importa varios de lucide; sumar los que falten: `Switch`, `Upload`, `ImageOff`, `X`. `Loader2` ya está.)

- [ ] **Step 2: Estado nuevo en CategoriaDialog**

Dentro de `CategoriaDialog`, junto a los `useState` existentes:
```tsx
const [imagenUrl, setImagenUrl] = useState<string | null>(categoria?.imagen_url ?? null)
const [activo, setActivo] = useState<boolean>(categoria?.activo ?? true)
const [uploading, setUploading] = useState(false)

const handleUpload = async (file: File) => {
  setUploading(true)
  try {
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/catalogo/upload", { method: "POST", body: fd })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || "Error al subir imagen")
    setImagenUrl(data.url)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : "Error al subir imagen")
  } finally {
    setUploading(false)
  }
}
```

- [ ] **Step 3: Payload**

En `handleSave` de `CategoriaDialog`, agregar al `payload`:
```tsx
payload.imagen_url = imagenUrl
payload.activo = activo
```
(Agregar estas dos líneas después de armar `payload` con nombre/descripcion y antes del `fetch`.)

- [ ] **Step 4: UI dentro del dialog**

Antes del bloque de "Nombre" (o después de la descripción), agregar un bloque de imagen y un toggle activo. Insertar dentro del `<div className="space-y-3">`:

Imagen (al principio del space-y-3):
```tsx
<div>
  <Label>Imagen (opcional)</Label>
  <div className="mt-1.5 flex items-center gap-3">
    <div className="w-20 h-20 bg-muted rounded-md overflow-hidden flex items-center justify-center border shrink-0">
      {imagenUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imagenUrl} alt="" className="w-full h-full object-cover" />
      ) : (
        <ImageOff className="h-5 w-5 text-muted-foreground" />
      )}
    </div>
    <div className="flex flex-col gap-1.5">
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        id="cat-img"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleUpload(f)
          e.target.value = ""
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={uploading} className="gap-1.5"
        onClick={() => document.getElementById("cat-img")?.click()}>
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {imagenUrl ? "Cambiar" : "Subir"}
      </Button>
      {imagenUrl && (
        <Button type="button" variant="ghost" size="sm" className="gap-1.5 text-destructive"
          onClick={() => setImagenUrl(null)}>
          <X className="h-4 w-4" /> Quitar
        </Button>
      )}
    </div>
  </div>
</div>
```

Toggle activo (al final del space-y-3, después de Descripción):
```tsx
<div className="flex items-center justify-between">
  <div>
    <Label htmlFor="cat-activo">Activa</Label>
    <p className="text-xs text-muted-foreground">Si la desactivás, no se muestra en el catálogo público.</p>
  </div>
  <Switch id="cat-activo" checked={activo} onCheckedChange={setActivo} />
</div>
```

- [ ] **Step 5: Lista — thumbnail + badge Inactiva**

En el render de cada categoría (el `<CardContent>`), agregar un thumbnail antes del bloque de texto y un badge cuando `!cat.activo`. Reemplazar el contenido interno del `<CardContent>` para incluir:
- Después del `<GripVertical/>`, si `cat.imagen_url`, un thumbnail:
```tsx
{cat.imagen_url && (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={cat.imagen_url} alt="" className="h-9 w-9 rounded object-cover border shrink-0" />
)}
```
- Junto al `<h3>{cat.nombre}</h3>`, cuando `!cat.activo`, un badge:
```tsx
{!cat.activo && (
  <span className="ml-2 inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground align-middle">
    Inactiva
  </span>
)}
```
(Usar el patrón de Badge existente del repo si preferís: `import { Badge } from "@/components/ui/badge"` y `<Badge variant="secondary">Inactiva</Badge>`. Cualquiera de los dos; mantener consistencia con el resto del repo.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit` → 0 errores nuevos.
Run: `npx eslint "components/catalogo/catalogo-categorias-tab.tsx"` → 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add components/catalogo/catalogo-categorias-tab.tsx
git commit -m "feat(catalogo): imagen y estado activo de categorías"
```

---

## Verificación final

- [ ] `npx vitest run __tests__/lib/catalogo-gallery.test.ts __tests__/components/catalogo-tags-input.test.tsx __tests__/components/catalogo-image-gallery-input.test.tsx` → todo PASS.
- [ ] `npx tsc --noEmit` → sin errores nuevos (solo el pre-existente de `csv-export.test.ts`, que se resuelve cuando esa branch base incluya el fix de Buffer).
- [ ] `npx eslint "components/catalogo/**"` → 0 warnings nuevos.
- [ ] `npm run build` → exit 0.
- [ ] Manual: item dialog → agregar/quitar tags + sugerencias; subir varias imágenes, hacer portada, quitar; guardar y reabrir (persistió). Categoría → subir imagen + toggle activo; lista muestra thumbnail + badge.

## Criterios de aceptación (del spec)

1. ✅ Tags editables en el item dialog, persisten (Tasks 2, 4, 5).
2. ✅ Multi-imagen con portada, sin duplicar portada en `imagenes` (Tasks 1, 3, 4).
3. ✅ Categoría con imagen + activo; lista con thumbnail + badge (Task 6).
4. ✅ tsc + eslint verdes; tests nuevos pasan (verificación final).
