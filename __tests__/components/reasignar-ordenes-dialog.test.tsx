/**
 * The bulk reassignment dialog (change sucursales-aislamiento, PR5b; BM-5). The server says which
 * technicians can take the orders to move, how many orders that is in the ADMIN's scope, and whether
 * they span several branches. The dialog shows exactly that:
 *  - the number it says will move is the number the server will move (not the count the screen had);
 *  - several branches (an ADMIN on Todas) is explained, not shown as "no technicians";
 *  - a failed request is an error with a retry, not an empty list.
 */
import React, { useEffect } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig, useSWRConfig } from "swr"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// Radix Select no se maneja bien en jsdom: un <select> nativo con la misma API.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select aria-label="destino" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="">—</option>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}))

import { toast } from "sonner"
import { ReasignarOrdenesDialog } from "@/components/tecnicos/reasignar-ordenes-dialog"

const tecnico = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  email: `${id}@x.com`,
  activo: true,
  ordenesActivas: 1,
  ...extra,
})

const URL_DESTINOS = "/api/tecnicos?paraReasignarDe=t-origen"

let pedidos: Array<{ url: string; method: string; body?: unknown }> = []
let respuestaDestinos: () => Promise<Response>
let respuestaReasignar: () => Promise<Response>

const ok = (cuerpo: unknown) => Promise.resolve({ ok: true, json: async () => cuerpo } as Response)
const falla = (estado = 500) => Promise.resolve({ ok: false, status: estado, json: async () => ({ error: "boom" }) } as Response)

/** Lets a test revalidate the destinations the way the page would (the same cache as the dialog). */
let revalidar: () => Promise<unknown>
function ExponeRevalidar() {
  const { mutate } = useSWRConfig()
  useEffect(() => {
    revalidar = () => mutate(URL_DESTINOS)
  }, [mutate])
  return null
}

function montar(ordenesActivas = 5) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ExponeRevalidar />
      <ReasignarOrdenesDialog
        open
        onOpenChange={vi.fn()}
        tecnicoOrigenId="t-origen"
        tecnicoOrigenNombre="Lucas"
        ordenesActivas={ordenesActivas}
        onSuccess={vi.fn()}
      />
    </SWRConfig>,
  )
}

const boton = () => screen.getByRole("button", { name: /^reasignar/i })

describe("ReasignarOrdenesDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pedidos = []
    respuestaDestinos = () => ok({ tecnicos: [tecnico("t-1", "Ana"), tecnico("t-2", "Beto")], ordenesAMover: 2, variasSucursales: false })
    respuestaReasignar = () => ok({ reasignadas: 2 })
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        pedidos.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined })
        if (url.startsWith("/api/tecnicos?paraReasignarDe=")) return respuestaDestinos()
        if (url.endsWith("/reasignar")) return respuestaReasignar()
        return falla(404)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  describe("how many orders it says it will move", () => {
    it("is the number the server answers, not the count the screen had", async () => {
      montar(5)
      expect(await screen.findByRole("button", { name: "Reasignar 2 orden(es)" })).toBeInTheDocument()
      expect(screen.getByText(/Mover las/)).toHaveTextContent("Mover las 2 orden(es) activa(s) de Lucas")
      expect(screen.queryByText("5")).not.toBeInTheDocument()
    })

    it("until the answer arrives it falls back to the count of the screen", () => {
      respuestaDestinos = () => new Promise<Response>(() => {})
      montar(5)
      expect(screen.getByRole("button", { name: "Reasignar 5 orden(es)" })).toBeInTheDocument()
    })

    it("asks for the destinations of THIS technician", async () => {
      montar()
      await screen.findByLabelText("destino")
      expect(pedidos[0]).toMatchObject({ url: URL_DESTINOS, method: "GET" })
    })
  })

  describe("the destinations", () => {
    it("are the technicians of the answer, without the origin and without the inactive ones", async () => {
      respuestaDestinos = () =>
        ok({
          tecnicos: [tecnico("t-origen", "Lucas"), tecnico("t-1", "Ana"), tecnico("t-3", "Carla", { activo: false })],
          ordenesAMover: 1,
          variasSucursales: false,
        })
      montar()
      const lista = await screen.findByLabelText("destino")
      expect(Array.from(lista.querySelectorAll("option")).map((o) => o.textContent)).toEqual(["—", expect.stringContaining("Ana")])
    })

    it("nobody to offer in the branch: says so", async () => {
      respuestaDestinos = () => ok({ tecnicos: [], ordenesAMover: 2, variasSucursales: false })
      montar()
      expect(await screen.findByText("No hay otros técnicos activos disponibles.")).toBeInTheDocument()
      expect(boton()).toBeDisabled()
    })
  })

  describe("orders in more than one branch (an ADMIN on Todas)", () => {
    beforeEach(() => {
      respuestaDestinos = () => ok({ tecnicos: [], ordenesAMover: 3, variasSucursales: true })
    })

    it("explains that a branch has to be picked, instead of an empty list", async () => {
      montar()
      expect(await screen.findByText(/más de una sucursal/)).toHaveTextContent(
        "Este técnico tiene órdenes abiertas en más de una sucursal. Elegí una sucursal en el selector para mover las de esa sucursal.",
      )
      expect(screen.queryByText("No hay otros técnicos activos disponibles.")).not.toBeInTheDocument()
    })

    it("a destination chosen before the answer changed to several branches cannot be confirmed", async () => {
      respuestaDestinos = () => ok({ tecnicos: [tecnico("t-1", "Ana")], ordenesAMover: 2, variasSucursales: false })
      montar()
      fireEvent.change(await screen.findByLabelText("destino"), { target: { value: "t-1" } })
      expect(boton()).toBeEnabled()
      respuestaDestinos = () => ok({ tecnicos: [tecnico("t-1", "Ana")], ordenesAMover: 3, variasSucursales: true })
      await act(async () => {
        await revalidar()
      })
      expect(await screen.findByText(/más de una sucursal/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reasignar órdenes" })).toBeDisabled()
    })

    it("cannot be confirmed even if the answer still lists technicians", async () => {
      respuestaDestinos = () => ok({ tecnicos: [tecnico("t-1", "Ana")], ordenesAMover: 3, variasSucursales: true })
      montar()
      await screen.findByText(/más de una sucursal/)
      expect(screen.queryByLabelText("destino")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reasignar órdenes" })).toBeDisabled()
    })

    it("does not announce a number of orders that would not move together, and cannot be confirmed", async () => {
      montar()
      await screen.findByText(/más de una sucursal/)
      expect(screen.getByText(/Mover las órdenes activas de/)).toBeInTheDocument()
      expect(screen.queryByText(/\d+ orden\(es\)/)).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reasignar órdenes" })).toBeDisabled()
    })
  })

  describe("when the list cannot be loaded", () => {
    it("says so, with a retry: it is not the same as nobody being available", async () => {
      respuestaDestinos = () => falla(500)
      montar()
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los técnicos disponibles")
      expect(screen.queryByText("No hay otros técnicos activos disponibles.")).not.toBeInTheDocument()
      expect(boton()).toBeDisabled()
    })

    it("a refresh that fails after the list loaded: the chosen destination cannot be confirmed over the error", async () => {
      montar()
      fireEvent.change(await screen.findByLabelText("destino"), { target: { value: "t-1" } })
      expect(boton()).toBeEnabled()
      respuestaDestinos = () => falla(500)
      await act(async () => {
        await revalidar()
      })
      expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar los técnicos disponibles")
      expect(boton()).toBeDisabled()
    })

    it("the retry asks again and shows the list when it works", async () => {
      respuestaDestinos = () => falla(500)
      montar()
      await screen.findByRole("alert")
      respuestaDestinos = () => ok({ tecnicos: [tecnico("t-1", "Ana")], ordenesAMover: 2, variasSucursales: false })
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
      expect(await screen.findByLabelText("destino")).toBeInTheDocument()
      expect(pedidos.filter((p) => p.url === URL_DESTINOS)).toHaveLength(2)
    })
  })

  describe("reassigning", () => {
    it("sends the chosen technician and reports how many moved", async () => {
      montar()
      fireEvent.change(await screen.findByLabelText("destino"), { target: { value: "t-2" } })
      fireEvent.click(boton())
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Se reasignaron 2 orden(es)"))
      expect(pedidos.find((p) => p.method === "POST")).toMatchObject({ url: "/api/tecnicos/t-origen/reasignar", body: { tecnicoDestinoId: "t-2" } })
    })

    it("a refusal of the server is shown as its message", async () => {
      respuestaReasignar = () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: "Ese técnico no pertenece a la sucursal de esta orden" }) } as Response)
      montar()
      fireEvent.change(await screen.findByLabelText("destino"), { target: { value: "t-1" } })
      fireEvent.click(boton())
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Ese técnico no pertenece a la sucursal de esta orden"))
    })
  })
})
