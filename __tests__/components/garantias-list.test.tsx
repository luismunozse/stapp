import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import type { GarantiaListada } from "@/lib/garantias/listado"

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn() }))
const rol = vi.hoisted(() => ({ current: "ADMIN" }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/garantias",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: nav.replace }),
  useSearchParams: () => nav.params,
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: rol.current } }, status: "authenticated" }),
}))

import { GarantiasList } from "@/components/garantias/garantias-list"

const fila = (over: Partial<GarantiaListada> = {}): GarantiaListada => ({
  id: "g-1",
  origen: "REPARACION",
  estado: "POR_VENCER",
  diasRestantes: 3,
  diaVencimiento: "2026-11-14",
  fechaInicio: null,
  fechaVencimiento: "2026-11-14T12:00:00Z",
  diasValidez: 30,
  cliente: { id: "cli-1", nombre: "Juan Pérez", telefono: "1155554444" },
  descripcion: "iPhone 12",
  referencia: { tipo: "ORDEN", id: "o-1", numero: "#123" },
  numeroGarantia: null,
  sucursal: null,
  acciones: {
    verHref: "/ordenes/o-1",
    certificadoUrl: "/api/ordenes/o-1/comprobante-entrega",
    whatsappUrl: "https://wa.me/5491155554444?text=hola",
    registrarReclamo: "vigente",
    decidirReclamo: false,
  },
  reclamo: null,
  ...over,
})

function respuesta(data: GarantiaListada[], extra: Record<string, unknown> = {}) {
  return {
    data,
    total: data.length,
    page: 1,
    limit: 20,
    totalPages: 1,
    conteos: { "por-vencer": data.length, reclamos: 2, vigentes: 10, vencidas: 4 },
    hoy: "2026-11-11",
    ventana: 7,
    sucursal: "todas",
    soloLectura: false,
    ...extra,
  }
}

function mockFetch(impl: (url: string) => { ok: boolean; body: unknown }) {
  const fn = vi.fn(async (url: string, _init?: RequestInit) => {
    const r = impl(url)
    return { ok: r.ok, json: async () => r.body } as Response
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const montar = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <GarantiasList />
    </SWRConfig>
  )

describe("GarantiasList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nav.params = new URLSearchParams()
    rol.current = "ADMIN"
  })

  it("muestra las cuatro pestañas con su conteo y pide la pestaña de la URL", async () => {
    nav.params = new URLSearchParams("tab=reclamos&origen=VENTA")
    const f = mockFetch((u) => (u.startsWith("/api/sucursales") ? { ok: true, body: { data: [] } } : { ok: true, body: respuesta([fila()]) }))
    montar()
    await screen.findAllByText("Juan Pérez")
    const tabs = await screen.findAllByRole("tab")
    expect(tabs.map((t) => t.textContent)).toEqual([
      expect.stringContaining("Por vencer"),
      expect.stringContaining("Reclamos abiertos"),
      expect.stringContaining("Vigentes"),
      expect.stringContaining("Vencidas y anuladas"),
    ])
    expect(screen.getByRole("tab", { name: /Reclamos abiertos/ })).toHaveAttribute("aria-selected", "true")
    const llamada = f.mock.calls.map((c) => String(c[0])).find((u) => u.startsWith("/api/garantias/unificadas"))
    expect(llamada).toContain("tab=reclamos")
    expect(llamada).toContain("origen=VENTA")
  })

  it("dibuja cada fila con cliente, equipo, vencimiento, estado y acciones", async () => {
    mockFetch(() => ({ ok: true, body: respuesta([fila()]) }))
    montar()
    expect((await screen.findAllByText("Juan Pérez")).length).toBeGreaterThan(0)
    expect(screen.getAllByText("iPhone 12").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Vence en 3 días").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Por vencer", { selector: "div" }).length).toBeGreaterThan(0)
    // Fase 2: registrar el reclamo es un diálogo en la fila, no un link a la orden.
    expect(screen.getAllByRole("button", { name: /Registrar reclamo/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole("link", { name: /Comprobante PDF/ })[0]).toHaveAttribute("href", "/api/ordenes/o-1/comprobante-entrega")
    expect(screen.getAllByRole("link", { name: /WhatsApp/ })[0]).toHaveAttribute("href", "https://wa.me/5491155554444?text=hola")
  })

  it("sin garantías y sin filtros: el vacío propio de la pestaña", async () => {
    mockFetch(() => ({ ok: true, body: respuesta([]) }))
    montar()
    expect(await screen.findByText("No hay garantías por vencer")).toBeInTheDocument()
    expect(screen.getByText("Ninguna garantía vence en los próximos 7 días.")).toBeInTheDocument()
  })

  it("con filtros y sin resultados: 'Sin resultados' con Limpiar filtros", async () => {
    nav.params = new URLSearchParams("q=zzz")
    mockFetch(() => ({ ok: true, body: respuesta([]) }))
    montar()
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }))
    expect(nav.replace).toHaveBeenCalledWith("/garantias", { scroll: false })
  })

  it("error: mensaje propio y Reintentar vuelve a pedir", async () => {
    let falla = true
    const f = mockFetch(() => (falla ? { ok: false, body: { error: "x" } } : { ok: true, body: respuesta([fila()]) }))
    montar()
    expect(await screen.findByText("No pudimos cargar las garantías")).toBeInTheDocument()
    falla = false
    const antes = f.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    await waitFor(() => expect(f.mock.calls.length).toBeGreaterThan(antes))
    expect((await screen.findAllByText("Juan Pérez")).length).toBeGreaterThan(0)
  })

  it("cambiar de pestaña actualiza la URL", async () => {
    mockFetch(() => ({ ok: true, body: respuesta([fila()]) }))
    montar()
    fireEvent.click(await screen.findByRole("tab", { name: /Vigentes/ }))
    expect(nav.replace).toHaveBeenCalledWith("/garantias?tab=vigentes", { scroll: false })
  })
})

describe("GarantiasList — reclamos en la fila (fase 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nav.params = new URLSearchParams()
    rol.current = "ADMIN"
  })

  const conReclamo = (decidir: boolean) =>
    fila({
      estado: "RECLAMADA",
      reclamo: { id: "r-1", fase: "ABIERTO", descripcion: "No carga", fecha: "2026-11-10T10:00:00Z", ordenReingreso: null },
      acciones: {
        verHref: "/ordenes/o-1",
        certificadoUrl: null,
        whatsappUrl: null,
        registrarReclamo: null,
        decidirReclamo: decidir,
      },
    })

  it("Registrar reclamo abre un diálogo propio (sin prompt) y manda el origen y la garantía", async () => {
    const promptSpy = vi.fn()
    vi.stubGlobal("prompt", promptSpy)
    const f = mockFetch((u) => (u === "/api/garantias/reclamos" ? { ok: true, body: { id: "r-9" } } : { ok: true, body: respuesta([fila()]) }))
    montar()
    fireEvent.click((await screen.findAllByRole("button", { name: /Registrar reclamo/ }))[0])
    const descripcion = await screen.findByLabelText("¿Qué problema tiene?")
    const enviar = screen.getByRole("button", { name: "Registrar reclamo" })
    expect(enviar).toBeDisabled()
    fireEvent.change(descripcion, { target: { value: "La pantalla volvió a fallar" } })
    fireEvent.click(enviar)
    await waitFor(() => {
      const post = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")
      expect(post).toBeDefined()
      expect(post![0]).toBe("/api/garantias/reclamos")
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
        origen: "REPARACION",
        garantiaId: "g-1",
        descripcion: "La pantalla volvió a fallar",
      })
    })
    expect(promptSpy).not.toHaveBeenCalled()
  })

  it("si la garantía venció, el servidor pide el motivo y el campo aparece en el mismo diálogo", async () => {
    let intentos = 0
    mockFetch((u) => {
      if (u !== "/api/garantias/reclamos") return { ok: true, body: respuesta([fila()]) }
      intentos++
      return { ok: false, body: { error: "La garantía venció el 10/11/2026.", code: "GARANTIA_VENCIDA", requiereMotivo: true } }
    })
    montar()
    fireEvent.click((await screen.findAllByRole("button", { name: /Registrar reclamo/ }))[0])
    fireEvent.change(await screen.findByLabelText("¿Qué problema tiene?"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Registrar reclamo" }))
    expect(await screen.findByLabelText("Motivo para aceptarlo fuera de garantía")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("La garantía venció")
    expect(intentos).toBe(1)
  })

  it("ADMIN en Reclamos abiertos: Rechazar pide el motivo en un diálogo y manda la decisión", async () => {
    nav.params = new URLSearchParams("tab=reclamos")
    const f = mockFetch((u) =>
      u.startsWith("/api/garantias/reclamos/") ? { ok: true, body: { reclamo: {}, orden: null } } : { ok: true, body: respuesta([conReclamo(true)]) }
    )
    montar()
    expect((await screen.findAllByText("No carga")).length).toBeGreaterThan(0)
    fireEvent.click(screen.getAllByRole("button", { name: /^Rechazar$/ })[0])
    const motivo = await screen.findByLabelText("Motivo del rechazo")
    const confirmar = screen.getByRole("button", { name: "Rechazar reclamo" })
    expect(confirmar).toBeDisabled()
    fireEvent.change(motivo, { target: { value: "Daño por humedad" } })
    fireEvent.click(confirmar)
    await waitFor(() => {
      const put = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")
      expect(put).toBeDefined()
      expect(put![0]).toBe("/api/garantias/reclamos/r-1")
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ accion: "rechazar", motivo: "Daño por humedad" })
    })
  })

  it("Aceptar confirma en un diálogo propio y manda accion aceptar", async () => {
    nav.params = new URLSearchParams("tab=reclamos")
    const f = mockFetch((u) =>
      u.startsWith("/api/garantias/reclamos/")
        ? { ok: true, body: { reclamo: {}, orden: { id: "o-9", numeroOrden: 9, codigoOrden: "CEL009" } } }
        : { ok: true, body: respuesta([conReclamo(true)]) }
    )
    montar()
    fireEvent.click((await screen.findAllByRole("button", { name: /^Aceptar$/ }))[0])
    fireEvent.click(await screen.findByRole("button", { name: "Aceptar y crear re-ingreso" }))
    await waitFor(() => {
      const put = f.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "PUT")
      expect(JSON.parse((put![1] as RequestInit).body as string)).toEqual({ accion: "aceptar" })
    })
  })

  it("sin permiso para decidir (VENDEDOR) no hay Aceptar ni Rechazar", async () => {
    rol.current = "VENDEDOR"
    nav.params = new URLSearchParams("tab=reclamos")
    mockFetch(() => ({ ok: true, body: respuesta([conReclamo(false)]) }))
    montar()
    expect((await screen.findAllByText("No carga")).length).toBeGreaterThan(0)
    expect(screen.queryByRole("button", { name: /^Aceptar$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Rechazar$/ })).not.toBeInTheDocument()
  })
})
