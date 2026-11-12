import type Anthropic from "@anthropic-ai/sdk"
import type { ContextoHerramienta, Herramienta } from "./tipos"
import { verOrden } from "./ver-orden"

export type { ContextoHerramienta, Herramienta, LlamadaRegistrada, ResultadoHerramienta } from "./tipos"

/**
 * Todas las herramientas, en orden FIJO. El orden importa: la lista de herramientas va antes del
 * system prompt en el prefijo cacheado, así que cambiarlo entre requests invalida la caché.
 */
export const HERRAMIENTAS: readonly Herramienta[] = [verOrden]

/**
 * Las herramientas que este actor puede usar, en el orden fijo de HERRAMIENTAS.
 * Fail-closed: si `disponible` falla, la herramienta no se ofrece.
 */
export async function herramientasDisponibles(ctx: ContextoHerramienta): Promise<Herramienta[]> {
  const habilitadas = await Promise.all(
    HERRAMIENTAS.map(async (h) => {
      try {
        return await h.disponible(ctx)
      } catch {
        return false
      }
    })
  )
  return HERRAMIENTAS.filter((_, i) => habilitadas[i])
}

export function definiciones(herramientas: readonly Herramienta[]): Anthropic.Tool[] {
  return herramientas.map((h) => h.definicion)
}
