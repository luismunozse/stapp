/**
 * Tipos compartidos del catálogo público.
 * Centralizar acá evita las 4-5 copias de `interface Item` repartidas entre
 * componentes y SSR pages (catalogo-view, item-card, item-detail-dialog,
 * catalogo-item-view, page.tsx). Cambios al shape se propagan en un lugar.
 */

export interface CatalogoPublicVariante {
  id: string
  etiqueta: string
  sku: string | null
  precio: number | null
  stock: number | null
  imagen_url: string | null
}

export interface CatalogoPublicItem {
  id: string
  tipo: "PRODUCTO" | "SERVICIO"
  nombre: string
  descripcion: string | null
  categoria_id: string | null
  precio: number | null
  precio_hasta: number | null
  precio_lista: number | null
  imagen_url: string | null
  imagenes: string[]
  etiquetas: string[]
  stock_disponible: number | null
  destacado: boolean
  vistas_semana?: number
  top_variante_id?: string | null
  variantes?: CatalogoPublicVariante[]
}

export interface CatalogoPublicConfig {
  slug: string
  titulo: string | null
  descripcion: string | null
  color_primary: string
  whatsapp: string | null
  banner_url: string | null
  trust_badges: Array<{ icon: string; label: string }>
}

export interface CatalogoPublicOrganizacion {
  id: string
  nombre: string
  nombre_mostrar: string
  logo_url: string | null
  telefono: string | null
  moneda: string
}

export interface CatalogoPublicCategoria {
  id: string
  nombre: string
  slug: string | null
  descripcion: string | null
  imagen_url: string | null
  orden: number
}

export interface CatalogoPublicData {
  config: CatalogoPublicConfig
  organizacion: CatalogoPublicOrganizacion
  categorias: CatalogoPublicCategoria[]
  items: CatalogoPublicItem[]
}
