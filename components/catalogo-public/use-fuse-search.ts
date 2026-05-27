"use client"

import { useEffect, useMemo, useState } from "react"

type FuseModule = typeof import("fuse.js")

// Lazy-load Fuse.js: ~12KB gz. Solo se necesita cuando el usuario tipea.
// Mantenemos una sola promise compartida entre instancias del hook.
let fuseModulePromise: Promise<FuseModule> | null = null
function loadFuse() {
  if (!fuseModulePromise) {
    fuseModulePromise = import("fuse.js")
  }
  return fuseModulePromise
}

interface FuseConfig<T> {
  keys: Array<{ name: keyof T & string; weight: number }>
  threshold?: number
}

/**
 * Búsqueda fuzzy con Fuse.js, lazy-loaded. Devuelve la función `search`
 * que se aplica al query. Si el módulo no se cargó aún (search < 2 chars),
 * `search` devuelve la lista filtrada por substring sobre la primera key.
 *
 * Extraído de catalogo-view.tsx (era ~40 LOC inline). Reusable.
 */
export function useFuseSearch<T>(items: T[], query: string, config: FuseConfig<T>) {
  const [FuseCtor, setFuseCtor] = useState<FuseModule["default"] | null>(null)

  useEffect(() => {
    if (query.trim().length >= 2 && !FuseCtor) {
      loadFuse().then((mod) => setFuseCtor(() => mod.default))
    }
  }, [query, FuseCtor])

  const fuse = useMemo(() => {
    if (!FuseCtor) return null
    return new FuseCtor(items, {
      keys: config.keys,
      threshold: config.threshold ?? 0.38,
      ignoreLocation: true,
      minMatchCharLength: 2,
      useExtendedSearch: false,
      includeScore: false,
    })
  }, [FuseCtor, items, config.keys, config.threshold])

  const primaryKey = config.keys[0]?.name

  return useMemo(() => {
    const q = query.trim()
    if (q.length === 0) return items
    if (q.length === 1 || !fuse) {
      const needle = q.toLowerCase()
      return items.filter((it) => {
        const v = primaryKey ? (it as Record<string, unknown>)[primaryKey] : ""
        return typeof v === "string" && v.toLowerCase().includes(needle)
      })
    }
    return fuse.search(q).map((r) => r.item)
  }, [items, query, fuse, primaryKey])
}
