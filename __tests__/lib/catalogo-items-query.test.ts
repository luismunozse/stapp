// __tests__/lib/catalogo-items-query.test.ts
import { describe, it, expect } from "vitest"
import { buildItemsQuery } from "@/lib/catalogo/items-query"

describe("buildItemsQuery", () => {
  it("omits empty params", () => {
    expect(buildItemsQuery({})).toBe("")
  })
  it("sets present filters", () => {
    const qs = buildItemsQuery({ q: "nokia", tipo: "PRODUCTO", categoriaId: "c1", estado: "activo", sinImagen: true })
    const sp = new URLSearchParams(qs)
    expect(sp.get("q")).toBe("nokia")
    expect(sp.get("tipo")).toBe("PRODUCTO")
    expect(sp.get("categoria_id")).toBe("c1")
    expect(sp.get("estado")).toBe("activo")
    expect(sp.get("sin_imagen")).toBe("1")
  })
  it("trims q and omits if blank", () => {
    expect(buildItemsQuery({ q: "   " })).toBe("")
    expect(new URLSearchParams(buildItemsQuery({ q: "  hola " })).get("q")).toBe("hola")
  })
  it("only includes page when > 1", () => {
    expect(new URLSearchParams(buildItemsQuery({ page: 1 })).has("page")).toBe(false)
    expect(new URLSearchParams(buildItemsQuery({ page: 3 })).get("page")).toBe("3")
  })
  it("includes limit when provided", () => {
    expect(new URLSearchParams(buildItemsQuery({ limit: 50 })).get("limit")).toBe("50")
  })
})
