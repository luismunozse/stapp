/**
 * Validadores puros del catálogo. Mismas reglas que las constraints SQL
 * para garantizar que el frontend nunca envíe datos que el DB rechazará.
 * Exportados como funciones puras = testeables sin DB ni red.
 */

import { z } from "zod"

// Mismo patrón que la CHECK constraint en migration 143_catalogo_publico.sql
export const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/

// Mismo patrón que CHECK constraint en migration 157_catalogo_cupones.sql
export const CUPON_CODIGO_REGEX = /^[A-Z0-9_-]{3,32}$/

export function isValidSlug(slug: string | null | undefined): boolean {
  if (!slug || typeof slug !== "string") return false
  return SLUG_REGEX.test(slug)
}

export function isValidCuponCodigo(codigo: string | null | undefined): boolean {
  if (!codigo || typeof codigo !== "string") return false
  return CUPON_CODIGO_REGEX.test(codigo.toUpperCase())
}

/**
 * Sanitiza un código de cupón tal como lo escribe el cliente.
 * - mayúsculas
 * - trim
 * - sólo conserva [A-Z0-9_-]
 */
export function normalizeCuponCodigo(input: string): string {
  return input
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32)
}

/**
 * Calcula el descuento de un cupón sobre un subtotal. Misma lógica
 * que la RPC `aplicar_cupon_catalogo`. Para mostrar preview en UI
 * antes de pegarle al backend.
 *
 * Reglas:
 *   - porcentaje: subtotal × (valor/100), redondeado a 2 decimales
 *   - monto: min(valor, subtotal) — nunca descuenta más que el total
 */
export function calcularDescuentoCupon(
  tipo: "porcentaje" | "monto",
  valor: number,
  subtotal: number
): number {
  if (subtotal <= 0 || valor <= 0) return 0
  if (tipo === "porcentaje") {
    const pct = Math.min(100, valor)
    return Math.round(subtotal * pct) / 100
  }
  return Math.min(valor, subtotal)
}

/**
 * Cantidad mínima para entrar al carrito de un item con variantes.
 * Si tiene variantes activas, el cliente debe elegir una. Si no, se
 * agrega como item base.
 */
export type ItemConVariantes = {
  precio: number | null
  stock_disponible?: number | null
  variantes?: Array<{ id: string; stock: number | null }>
}

export function tieneVariantesActivas(item: ItemConVariantes): boolean {
  return !!item.variantes && item.variantes.length > 0
}

export function puedeQuickAdd(item: ItemConVariantes): boolean {
  if (item.precio == null) return false
  if (tieneVariantesActivas(item)) return false // requiere elegir variante
  if (item.stock_disponible === 0) return false
  return true
}

/**
 * Key única en el carrito: si el item tiene variante, ambos componen
 * la key. Esto evita que distintas variantes del mismo item se mezclen.
 */
export function cartKey(item: { id: string; varianteId?: string | null }): string {
  return item.varianteId ? `${item.id}::${item.varianteId}` : item.id
}

/**
 * Schema del item del carrito persistido en localStorage. Defensa contra
 * storage corrupto (versiones viejas, manipulación manual, otros scripts).
 * Si el parse falla, el cart se resetea a []. Mantener en sync con
 * CartItem en components/catalogo-public/use-cart.ts.
 */
export const cartItemSchema = z.object({
  id: z.string().min(1).max(100),
  nombre: z.string().min(1).max(300),
  precio: z.number().nonnegative().finite(),
  cantidad: z.number().int().positive().max(9999),
  imagen_url: z.string().max(1000).nullish(),
  stock_disponible: z.number().int().nonnegative().nullable(),
  varianteId: z.string().min(1).max(100).nullish(),
  varianteEtiqueta: z.string().max(200).nullish(),
})

export const cartSchema = z.array(cartItemSchema).max(100)

/**
 * Schema para arrays de IDs (recientes / favoritos / etc).
 */
export const idArraySchema = z.array(z.string().min(1).max(100)).max(200)
