/**
 * La lista de órdenes lee sus filtros de la URL (links del dashboard, volver
 * desde el detalle) y escribe los cambios de vuelta con router.replace.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { OrdenesList } from "@/components/ordenes/ordenes-list"
import { leerUltimaListaOrdenes } from "@/lib/ordenes/filtros-url"
import { silenceSkeletonNoise } from "./silence-skeleton-noise"

const replace = vi.fn()
let search = ""

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/ordenes",
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => d }),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ showError: vi.fn(), showSuccess: vi.fn(), confirm: vi.fn() }),
}))

vi.mock("@/components/ordenes/orden-form", () => ({
  OrdenForm: () => <div data-testid="orden-form" />,
}))

function renderList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <OrdenesList />
    </SWRConfig>
  )
}

/** Params de la última llamada a /api/ordenes (la lista; no técnicos ni tipos). */
async function ultimaConsultaOrdenes(): Promise<URLSearchParams> {
  let params: URLSearchParams | null = null
  await waitFor(() => {
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/ordenes?"))
    expect(urls.length).toBeGreaterThan(0)
    params = new URLSearchParams(urls[urls.length - 1].split("?")[1])
  })
  return params!
}

describe("OrdenesList — filtros en la URL", () => {
  beforeEach(() => {
    silenceSkeletonNoise()
    replace.mockClear()
    sessionStorage.clear()
    search = ""
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [], total: 0 }) })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("filtro=pendientesCobro (dashboard) consulta las órdenes con deuda", async () => {
    search = "filtro=pendientesCobro"
    renderList()
    const p = await ultimaConsultaOrdenes()
    expect(p.get("cobroPendiente")).toBe("true")
    expect(replace).not.toHaveBeenCalled()
  })

  it("acepta el link viejo estado_cobro=PENDIENTE", async () => {
    search = "estado_cobro=PENDIENTE"
    renderList()
    const p = await ultimaConsultaOrdenes()
    expect(p.get("estadoCobro")).toBe("PENDIENTE")
  })

  it("estado=pendientes trae las órdenes en curso", async () => {
    search = "estado=pendientes"
    renderList()
    const p = await ultimaConsultaOrdenes()
    expect(p.get("activas")).toBe("true")
    expect(p.get("estado")).toBeNull()
  })

  it("arranca con estado, búsqueda, página y orden de la URL", async () => {
    search = "estado=RECIBIDO&search=Galaxy&page=2&sort=numeroOrden&dir=asc"
    renderList()
    const p = await ultimaConsultaOrdenes()
    expect(p.get("estado")).toBe("RECIBIDO")
    expect(p.get("search")).toBe("Galaxy")
    expect(p.get("page")).toBe("2")
    expect(p.get("sortBy")).toBe("numeroOrden")
    expect(p.get("sortOrder")).toBe("asc")
    expect(screen.getByDisplayValue("Galaxy")).toBeInTheDocument()
  })

  it("un chip escribe el filtro en la URL con replace y sin scroll, conservando fromTurno", async () => {
    search = "fromTurno=t1"
    renderList()
    fireEvent.click(await screen.findByRole("button", { name: "Vencidas" }))
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/ordenes?fromTurno=t1&filtro=vencidas", { scroll: false })
    )
    const p = await ultimaConsultaOrdenes()
    expect(p.get("vencimiento")).toBe("vencidas")
  })

  it("recuerda la lista filtrada para el 'volver' del detalle", async () => {
    search = "filtro=vencidas&page=3"
    renderList()
    await ultimaConsultaOrdenes()
    expect(leerUltimaListaOrdenes()).toBe("/ordenes?filtro=vencidas&page=3")
  })
})
