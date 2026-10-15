import type { InventarioResult } from "@/components/pos/pos-types"

/** What the POS grid draws for one slot of the search results. */
export type PosTarjeta =
  | { tipo: "producto"; producto: InventarioResult }
  | {
      tipo: "grupo"
      grupoId: string
      /** The group's base name ("Funda X"), never a child's custom name. */
      nombre: string
      cantidad: number
      /** Lowest sale price among the members shown. */
      desde: number
      miembros: InventarioResult[]
    }

/**
 * Turns the flat search results into POS cards. With `agrupar`, two or more results of the same
 * group become ONE card at the position of the group's first result; a lone member and every
 * standalone product stay normal cards. Without `agrupar` it is the identity (one card each).
 * Pure: it never reorders anything else.
 */
export function agruparResultados(resultados: readonly InventarioResult[], opciones: { agrupar: boolean }): PosTarjeta[] {
  if (!opciones.agrupar) return resultados.map((producto) => ({ tipo: "producto", producto }))

  const miembrosPorGrupo = new Map<string, InventarioResult[]>()
  for (const r of resultados) {
    if (r.grupoId) miembrosPorGrupo.set(r.grupoId, [...(miembrosPorGrupo.get(r.grupoId) ?? []), r])
  }

  const yaDibujados = new Set<string>()
  const tarjetas: PosTarjeta[] = []
  for (const r of resultados) {
    const miembros = r.grupoId ? (miembrosPorGrupo.get(r.grupoId) ?? []) : []
    if (!r.grupoId || miembros.length < 2) {
      tarjetas.push({ tipo: "producto", producto: r })
      continue
    }
    if (yaDibujados.has(r.grupoId)) continue
    yaDibujados.add(r.grupoId)
    tarjetas.push({
      tipo: "grupo",
      grupoId: r.grupoId,
      nombre: miembros.find((m) => m.grupoNombre)?.grupoNombre ?? miembros[0].nombre,
      cantidad: miembros.length,
      desde: Math.min(...miembros.map((m) => m.precioVenta)),
      miembros,
    })
  }
  return tarjetas
}
