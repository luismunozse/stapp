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
