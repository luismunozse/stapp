/**
 * BM-4 on the order screen: the assignee picker lists the technicians of the branch
 * that HANDLES the order (not the viewer's), and the current assignee is shown even
 * when they belong to another branch. The card is stubbed to expose what it is given,
 * so the assertions are about the data the screen hands it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
import { OrdenDetail } from "@/components/ordenes/orden-detail"

// The same object on every render, like Next's router: a fresh one each time would change
// fetchOrden's identity and re-run the screen's load effect in a loop.
vi.mock("next/navigation", () => {
  const router = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }
  return { useRouter: () => router }
})
const sesion = vi.hoisted(() => ({ role: "ADMIN" as string }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: sesion.role, organizationId: "org-1", name: "Ana" } } }),
}))
const avisos = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }))
vi.mock("sonner", () => ({ toast: avisos }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({
    formatPrice: (n: number) => `$${n}`,
    formatDate: () => "11/10/2026",
    currency: "ARS",
    timezone: "America/Argentina/Buenos_Aires",
    pais: "AR",
  }),
  useTerminologia: () => (key: string) => key,
}))
vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), alert: vi.fn(), showError: vi.fn() }),
}))
// The 15 s refresh of the screen, kept so a test can fire it.
const sondeo = vi.hoisted(() => ({ refrescar: null as null | (() => Promise<void>) }))
vi.mock("@/hooks/use-visibility-polling", () => ({
  useVisibilityPolling: (callback: () => Promise<void>) => {
    sondeo.refrescar = callback
  },
}))
vi.mock("@/components/ordenes/use-etiqueta-size", () => ({
  useEtiquetaSize: () => ({ size: "62x29", ready: true, update: vi.fn() }),
}))
vi.mock("@/components/ordenes/print-label", () => ({ printDeviceLabel: vi.fn(), LABEL_SIZE_OPTIONS: [] }))
vi.mock("@/components/ordenes/orden-estado-card", () => ({ OrdenEstadoCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-tecnico-card", () => ({
  OrdenTecnicoCard: (p: {
    tecnicos: Array<{ nombre: string }>
    tecnicoActual?: { nombre: string } | null
    readOnly?: boolean
  }) => (
    <div data-testid="tecnico-card">
      {`lista:${p.tecnicos.map((t) => t.nombre).join(",")}|actual:${p.tecnicoActual?.nombre ?? "-"}|readOnly:${p.readOnly ? "si" : "no"}`}
    </div>
  ),
}))
vi.mock("@/components/ordenes/orden-costos-card", () => ({ OrdenCostosCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-comision-card", () => ({ OrdenComisionCard: () => <div /> }))
vi.mock("@/components/ordenes/orden-repuestos-tab", () => ({ OrdenRepuestosTab: () => <div /> }))
vi.mock("@/components/ordenes/orden-servicios-tab", () => ({ OrdenServiciosTab: () => <div /> }))
vi.mock("@/components/ordenes/cobrar-orden-dialog", () => ({ CobrarOrdenDialog: () => <div /> }))
vi.mock("@/components/ordenes/confirmar-reparado-dialog", () => ({ ConfirmarReparadoDialog: () => <div /> }))
vi.mock("@/components/ordenes/entrega-dialog", () => ({ EntregaDialog: () => <div /> }))
vi.mock("@/components/ordenes/whatsapp-dialog", () => ({ WhatsAppDialog: () => <div /> }))
vi.mock("@/components/ordenes/thermal-print-orden", () => ({ ThermalPrintOrden: () => <div /> }))
vi.mock("@/components/ordenes/notification-history", () => ({ NotificationHistory: () => <div /> }))
vi.mock("@/components/notas-credito/nota-credito-dialog", () => ({ NotaCreditoDialog: () => <div /> }))
vi.mock("@/components/cotizaciones/cotizacion-list", () => ({ CotizacionList: () => <div /> }))
vi.mock("@/components/garantias/garantia-card", () => ({ GarantiaCard: () => <div /> }))
vi.mock("@/components/fotos/foto-gallery", () => ({ FotoGallery: () => <div /> }))
vi.mock("@/components/checklist/checklist-card", () => ({ ChecklistCard: () => <div /> }))

const ORDEN = {
  id: "ord-1",
  numeroOrden: 7,
  codigoOrden: "CEL0007",
  estado: "EN_REPARACION",
  dispositivo: "Galaxy S21",
  tipoDispositivo: "CELULAR",
  problemaReportado: "No carga",
  costoFinal: 15000,
  fechaIngreso: "2026-10-11",
  publicToken: "tok-123",
  totalCobrado: 0,
  sena: 0,
  descuentoCobro: 0,
  estadoCobro: "PENDIENTE",
  metadata: {},
  esPractica: false,
  cliente: { id: "cli-1", nombre: "Ana Pérez", telefono: "", email: "ana@taller.test" },
}

const POR_SUCURSAL: Record<string, Array<{ id: string; nombre: string }>> = {
  "suc-B": [{ id: "t-b1", nombre: "Carla" }],
  "suc-A": [
    { id: "t-a1", nombre: "Ana" },
    { id: "t-a2", nombre: "Beto" },
  ],
}

let pedidos: string[] = []

/**
 * `retenidas`: answers that are only given once their promise settles (a slow network).
 * `fallan`: branches whose technician list answers with a server error (still carrying a body
 * that would pass for a list) or, with "red", never arrives.
 */
function montarRed(
  orden: Record<string, unknown>,
  retenidas: Record<string, Promise<void>> = {},
  fallan: Record<string, "500" | "red"> = {},
) {
  pedidos = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      pedidos.push(url)
      await retenidas[url]
      // A copy per response, like a real one: the same object would make setOrden bail out.
      if (url === `/api/ordenes/${orden.id}`) return { ok: true, status: 200, json: async () => ({ ...orden }) }
      if (url.startsWith("/api/tecnicos")) {
        const sucursal = new URL(url, "http://localhost").searchParams.get("sucursalId") ?? ""
        if (fallan[sucursal] === "red") throw new TypeError("Failed to fetch")
        if (fallan[sucursal] === "500") {
          return { ok: false, status: 500, json: async () => POR_SUCURSAL["suc-A"] }
        }
        return { ok: true, status: 200, json: async () => POR_SUCURSAL[sucursal] ?? [] }
      }
      return { ok: true, status: 200, json: async () => [] }
    }),
  )
}

const tarjeta = async () => (await screen.findAllByTestId("tecnico-card"))[0]
const pedidosDeTecnicos = () => pedidos.filter((u) => u.startsWith("/api/tecnicos"))

describe("OrdenDetail - technicians of the handling branch", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sesion.role = "ADMIN"
  })

  it.each([
    ["suc-B", "lista:Carla"],
    ["suc-A", "lista:Ana,Beto"],
  ])("an order handled by %s lists that branch's technicians", async (sucursal, esperado) => {
    montarRed({ ...ORDEN, sucursalAtiendeId: sucursal })
    render(<OrdenDetail ordenId="ord-1" />)

    await waitFor(async () => expect(await tarjeta()).toHaveTextContent(esperado))
    expect(pedidosDeTecnicos()).toEqual([`/api/tecnicos?sucursalId=${sucursal}`])
  })

  it("never asks for the unscoped list, not even before the order has arrived", async () => {
    montarRed({ ...ORDEN, sucursalAtiendeId: "suc-B" })
    render(<OrdenDetail ordenId="ord-1" />)

    await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Carla"))
    expect(pedidos.filter((u) => u === "/api/tecnicos")).toEqual([])
  })

  it("encodes the branch id in the query", async () => {
    montarRed({ ...ORDEN, sucursalAtiendeId: "suc A&x=1" })
    render(<OrdenDetail ordenId="ord-1" />)

    await waitFor(() => expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?sucursalId=suc%20A%26x%3D1"]))
  })

  it("hands the card the current assignee, who may belong to another branch", async () => {
    montarRed({
      ...ORDEN,
      sucursalAtiendeId: "suc-B",
      tecnicoId: "t-san-justo",
      tecnico: { id: "t-san-justo", nombre: "Dario" },
    })
    render(<OrdenDetail ordenId="ord-1" />)

    await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Carla|actual:Dario"))
  })

  it("a refresh of the order with the same branch does not fetch the list again", async () => {
    montarRed({ ...ORDEN, sucursalAtiendeId: "suc-A" })
    render(<OrdenDetail ordenId="ord-1" />)
    await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Ana,Beto"))

    await act(async () => {
      await sondeo.refrescar!()
    })

    expect(pedidos.filter((u) => u === "/api/ordenes/ord-1")).toHaveLength(2)
    expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?sucursalId=suc-A"])
  })

  it("a late answer for the old branch never overwrites the list of the new one", async () => {
    const orden: Record<string, unknown> = { ...ORDEN, sucursalAtiendeId: "suc-A" }
    // The answer for suc-A is held back until the screen is already on suc-B.
    let soltarSucA!: () => void
    const retenida = new Promise<void>((resolve) => (soltarSucA = resolve))
    montarRed(orden, { "/api/tecnicos?sucursalId=suc-A": retenida })
    render(<OrdenDetail ordenId="ord-1" />)
    await waitFor(() => expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?sucursalId=suc-A"]))

    orden.sucursalAtiendeId = "suc-B"
    await act(async () => {
      await sondeo.refrescar!()
    })
    await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Carla"))

    await act(async () => {
      soltarSucA()
      await retenida
    })

    expect(await tarjeta()).toHaveTextContent("lista:Carla")
  })

  it("when a refresh brings another handling branch, the list follows it", async () => {
    const orden: Record<string, unknown> = { ...ORDEN, sucursalAtiendeId: "suc-A" }
    montarRed(orden)
    render(<OrdenDetail ordenId="ord-1" />)
    await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Ana,Beto"))

    orden.sucursalAtiendeId = "suc-B"
    await act(async () => {
      await sondeo.refrescar!()
    })

    await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Carla"))
    expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?sucursalId=suc-A", "/api/tecnicos?sucursalId=suc-B"])
  })

  describe("read-only picker (both cards, mobile and desktop)", () => {
    const soloLectura = async () => {
      const tarjetas = await screen.findAllByTestId("tecnico-card")
      return tarjetas.map((t) => t.textContent?.includes("readOnly:si") ?? false)
    }

    it.each([
      ["an ADMIN who can assign", "ADMIN", true, false],
      ["a VENDEDOR of the handling branch", "VENDEDOR", true, false],
      ["a VENDEDOR of another branch: every choice would be a 400", "VENDEDOR", false, true],
      ["a TECNICO", "TECNICO", false, true],
      ["an ADMIN against a server that does not say (old response)", "ADMIN", undefined, false],
      ["a TECNICO against a server that does not say: the role decides", "TECNICO", undefined, true],
    ])("%s", async (_caso, rol, puedeAsignarTecnico, esperado) => {
      sesion.role = rol
      montarRed({ ...ORDEN, sucursalAtiendeId: "suc-A", puedeAsignarTecnico })
      render(<OrdenDetail ordenId="ord-1" />)

      await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Ana,Beto"))
      const lecturas = await soloLectura()
      // The mobile and the desktop layouts each render one card: they must agree.
      expect(lecturas.length).toBeGreaterThanOrEqual(2)
      expect(lecturas.every((v) => v === esperado)).toBe(true)
    })
  })

  describe("when the technician list does not arrive", () => {
    it.each([
      ["answers with a server error (and a body that looks like a list)", "500" as const],
      ["fails on the network", "red" as const],
    ])("it %s: no list, and a toast with a fixed id", async (_caso, fallo) => {
      montarRed({ ...ORDEN, sucursalAtiendeId: "suc-B" }, {}, { "suc-B": fallo })
      render(<OrdenDetail ordenId="ord-1" />)

      await waitFor(() =>
        expect(avisos.error).toHaveBeenCalledWith(expect.stringMatching(/técnicos/i), { id: "fetch-tecnicos-error" }),
      )
      expect(await tarjeta()).toHaveTextContent("lista:|")
    })

    it("a failed refetch for the new branch never leaves the previous branch's list on screen", async () => {
      const orden: Record<string, unknown> = { ...ORDEN, sucursalAtiendeId: "suc-A" }
      montarRed(orden, {}, { "suc-B": "500" })
      render(<OrdenDetail ordenId="ord-1" />)
      await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Ana,Beto"))
      expect(avisos.error).not.toHaveBeenCalled()

      orden.sucursalAtiendeId = "suc-B"
      await act(async () => {
        await sondeo.refrescar!()
      })

      await waitFor(() => expect(avisos.error).toHaveBeenCalledTimes(1))
      expect(await tarjeta()).toHaveTextContent("lista:|")
    })

    it("a late failure for the old branch says nothing: the screen is already on the new one", async () => {
      const orden: Record<string, unknown> = { ...ORDEN, sucursalAtiendeId: "suc-A" }
      let soltarSucA!: () => void
      const retenida = new Promise<void>((resolve) => (soltarSucA = resolve))
      montarRed(orden, { "/api/tecnicos?sucursalId=suc-A": retenida }, { "suc-A": "500" })
      render(<OrdenDetail ordenId="ord-1" />)
      await waitFor(() => expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?sucursalId=suc-A"]))

      orden.sucursalAtiendeId = "suc-B"
      await act(async () => {
        await sondeo.refrescar!()
      })
      await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Carla"))

      await act(async () => {
        soltarSucA()
        await retenida
      })

      expect(avisos.error).not.toHaveBeenCalled()
      expect(await tarjeta()).toHaveTextContent("lista:Carla")
    })

    it("a successful load shows no toast", async () => {
      montarRed({ ...ORDEN, sucursalAtiendeId: "suc-A" })
      render(<OrdenDetail ordenId="ord-1" />)

      await waitFor(async () => expect(await tarjeta()).toHaveTextContent("lista:Ana,Beto"))
      expect(avisos.error).not.toHaveBeenCalled()
    })
  })
})
