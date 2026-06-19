// lib/catalogo/items-query.ts
export interface ItemsQueryParams {
  q?: string
  tipo?: string
  categoriaId?: string
  estado?: string
  sinImagen?: boolean
  page?: number
  limit?: number
}

/** Arma el querystring para GET /api/catalogo/items, omitiendo params vacíos. */
export function buildItemsQuery(p: ItemsQueryParams): string {
  const sp = new URLSearchParams()
  const q = p.q?.trim()
  if (q) sp.set("q", q)
  if (p.tipo) sp.set("tipo", p.tipo)
  if (p.categoriaId) sp.set("categoria_id", p.categoriaId)
  if (p.estado) sp.set("estado", p.estado)
  if (p.sinImagen) sp.set("sin_imagen", "1")
  if (p.page && p.page > 1) sp.set("page", String(p.page))
  if (p.limit) sp.set("limit", String(p.limit))
  return sp.toString()
}
