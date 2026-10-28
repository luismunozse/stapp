/**
 * The appointment form's technician picker.
 *
 * CREATING: an appointment is created in the branch the write lands in, and its technician is
 * carried into the order made from it, so the picker uses the write scope (`?alcance=escritura`).
 * EDITING: the appointment already belongs to a branch (`turno.sucursalId`), so the picker lists
 * THAT branch's technicians. The current technician is always shown, even when he is not in the
 * list (marked "otra sucursal" once the list has loaded), and saving another field never clears him.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { TurnoFormDialog } from "@/components/agenda/turno-form-dialog"
import type { TurnoConRelaciones } from "@/types"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("@/components/cotizaciones/cliente-selector", () => ({ ClienteSelector: () => <div /> }))

let pedidos: string[] = []
let patches: Array<Record<string, unknown>> = []
let respuestaTecnicos: () => Promise<Response>

const TECNICOS_DE_LA_SUCURSAL = [{ id: "t-b1", nombre: "Carla" }]

function turno(extra: Partial<TurnoConRelaciones> = {}): TurnoConRelaciones {
  return {
    id: "turno-1",
    organizationId: "org-1",
    sucursalId: "suc-B",
    clienteId: "c1",
    clienteSnapshot: null,
    tecnicoId: "t-b1",
    inicio: "2030-11-02T13:00:00.000Z",
    fin: null,
    direccion: null,
    tipo: "visita_diagnostico",
    tipoDispositivo: null,
    marca: null,
    modelo: null,
    problemaReportado: null,
    fotosPrevias: [],
    estado: "agendado",
    ordenId: null,
    notas: "nota previa",
    createdBy: null,
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
    tecnico: { id: "t-b1", nombre: "Carla" },
    ...extra,
  } as TurnoConRelaciones
}

function montar(open: boolean, t?: TurnoConRelaciones | null) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TurnoFormDialog open={open} onClose={vi.fn()} onSaved={vi.fn()} turno={t} />
    </SWRConfig>,
  )
}

const pedidosDeTecnicos = () => pedidos.filter((u) => u.startsWith("/api/tecnicos"))

describe("TurnoFormDialog - technician picker scope", () => {
  beforeEach(() => {
    pedidos = []
    patches = []
    respuestaTecnicos = () => Promise.resolve({ ok: true, json: async () => TECNICOS_DE_LA_SUCURSAL } as Response)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        pedidos.push(url)
        if (init?.method === "PATCH") {
          patches.push(JSON.parse(String(init.body ?? "{}")))
          return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
        }
        if (url.startsWith("/api/tecnicos")) return respuestaTecnicos()
        return Promise.resolve({ ok: false, json: async () => ({}) } as Response)
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it("creating: asks for the write scope, never for the plain list", async () => {
    montar(true)

    await waitFor(() => expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?alcance=escritura"]))
  })

  it("asks for nothing while the dialog is closed", () => {
    montar(false)

    expect(pedidosDeTecnicos()).toEqual([])
  })

  it.each([["suc-B"], ["suc-C"]])("editing an appointment of %s: that branch's technicians, not the write scope", async (sucursal) => {
    montar(true, turno({ sucursalId: sucursal }))

    await waitFor(() => expect(pedidosDeTecnicos()).toEqual([`/api/tecnicos?sucursalId=${sucursal}`]))
  })

  it("editing an appointment whose payload carries no branch (old response): falls back to the write scope", async () => {
    montar(true, turno({ sucursalId: undefined }))

    await waitFor(() => expect(pedidosDeTecnicos()).toEqual(["/api/tecnicos?alcance=escritura"]))
  })

  describe("the current technician of an appointment edited from another branch", () => {
    const deOtraSucursal = () => turno({ tecnicoId: "t-x", tecnico: { id: "t-x", nombre: "Dario" } })

    it("is shown, marked 'otra sucursal' once the list has loaded", async () => {
      montar(true, deOtraSucursal())

      expect(await screen.findByText("Dario · otra sucursal")).toBeInTheDocument()
    })

    it("is shown without the mark while the list has not loaded or failed", async () => {
      respuestaTecnicos = () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "x" }) } as Response)
      montar(true, deOtraSucursal())

      expect((await screen.findAllByText("Dario")).length).toBeGreaterThan(0)
      await waitFor(() => expect(pedidosDeTecnicos()).toHaveLength(1))
      expect(screen.queryByText(/otra sucursal/)).not.toBeInTheDocument()
    })

    it("is not marked when he is in the list", async () => {
      montar(true, turno())

      expect((await screen.findAllByText("Carla")).length).toBeGreaterThan(0)
      expect(screen.queryByText(/otra sucursal/)).not.toBeInTheDocument()
    })

    it("saving another field does not clear him", async () => {
      montar(true, deOtraSucursal())
      await screen.findByText("Dario · otra sucursal")

      fireEvent.change(screen.getByDisplayValue("nota previa"), { target: { value: "otra nota" } })
      fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }))

      await waitFor(() => expect(patches).toHaveLength(1))
      expect(patches[0].tecnicoId).toBe("t-x")
      expect(patches[0].notas).toBe("otra nota")
    })
  })
})
