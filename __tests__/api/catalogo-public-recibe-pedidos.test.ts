import { describe, it, expect, beforeEach, vi } from "vitest"
import { mockSupabaseFrom, createChainMock } from "./helpers"

vi.mock("@/lib/catalogo/recibe-pedidos", () => ({ catalogoRecibePedidos: vi.fn() }))

import { catalogoRecibePedidos } from "@/lib/catalogo/recibe-pedidos"
import { fetchCatalogoBaseData } from "@/lib/catalogo/fetch-data"

describe("fetchCatalogoBaseData — recibe_pedidos", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseFrom({
      catalogo_config: createChainMock({
        slug: "mi-taller", titulo: "T", descripcion: null, color_primary: "#111111",
        whatsapp: "11 1234-5678", banner_url: null, trust_badges: [], activo: true, organization_id: "org-1",
      }),
      organizations: createChainMock({
        id: "org-1", nombre: "T", nombre_mostrar: "T", logo_url: null, telefono: null, moneda: "ARS", pais: "AR",
      }),
      catalogo_categorias: createChainMock([]),
      catalogo_items: createChainMock([]),
      catalogo_views: createChainMock([]),
    })
  })

  it("expone solo un booleano derivado de cotizaciones_online", async () => {
    vi.mocked(catalogoRecibePedidos).mockResolvedValue(false)
    const data = await fetchCatalogoBaseData("mi-taller")
    expect(catalogoRecibePedidos).toHaveBeenCalledWith("org-1")
    expect(data?.config.recibe_pedidos).toBe(false)
    expect(Object.keys(data?.config ?? {}).sort()).toEqual(
      ["banner_url", "color_primary", "descripcion", "recibe_pedidos", "slug", "titulo", "trust_badges", "whatsapp"]
    )
    expect(JSON.stringify(data)).not.toMatch(/plan/i)
  })

  it("es true cuando el plan incluye cotizaciones_online", async () => {
    vi.mocked(catalogoRecibePedidos).mockResolvedValue(true)
    const data = await fetchCatalogoBaseData("mi-taller")
    expect(data?.config.recibe_pedidos).toBe(true)
  })
})
