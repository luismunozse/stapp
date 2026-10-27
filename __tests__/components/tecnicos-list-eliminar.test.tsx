/**
 * The delete guard of the technicians list (change sucursales-aislamiento, PR5b). The count on each card is
 * the orders of the scope the ADMIN works in; the guard that stops a delete is every open order the technician
 * holds in every branch (`ordenesActivasTotal`): a technician of San Justo with work in Tablada cannot be
 * deleted from a San Justo screen that counts zero.
 */
import React from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"

const confirmar = vi.fn()
const advertir = vi.fn()
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "admin-1", role: "ADMIN" } } }) }))
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ confirm: confirmar, showError: vi.fn(), showWarning: advertir }) }))
vi.mock("@/contexts/currency-context", () => ({ useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }) }))
vi.mock("./tecnico-form", () => ({ TecnicoForm: () => null }))
vi.mock("@/components/tecnicos/tecnico-form", () => ({ TecnicoForm: () => null }))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}))

import { TecnicosList } from "@/components/tecnicos/tecnicos-list"

const tecnico = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
  id,
  nombre,
  email: `${id}@x.com`,
  activo: true,
  especialidades: [],
  porcentajeComision: 10,
  ordenesActivas: 0,
  ordenesCompletadas: 0,
  ...extra,
})

let lista: Array<Record<string, unknown>>
let pedidos: Array<{ url: string; method: string }>

function montar() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TecnicosList />
    </SWRConfig>,
  )
}

/** The delete button of the card of `nombre` (the second icon button of its header). */
async function botonEliminarDe(nombre: string) {
  const titulo = await screen.findByText(nombre)
  const tarjeta = titulo.closest("a") as HTMLElement
  const botones = tarjeta.querySelectorAll("button")
  return botones[botones.length - 1] as HTMLButtonElement
}

describe("TecnicosList: the delete guard counts every open order of the technician", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pedidos = []
    confirmar.mockResolvedValue(false)
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        pedidos.push({ url, method: init?.method ?? "GET" })
        if (url.startsWith("/api/tecnicos/summary")) return Promise.resolve({ ok: true, json: async () => ({ rangoDias: 30, tecnicos: [] }) } as Response)
        if (url === "/api/tecnicos") return Promise.resolve({ ok: true, json: async () => lista } as Response)
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response)
      }),
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("a technician with nothing in this scope but work elsewhere (jed-electronics) cannot be deleted from here", async () => {
    lista = [tecnico("t-jed", "Jed", { ordenesActivas: 0, ordenesActivasTotal: 7 })]
    montar()
    fireEvent.click(await botonEliminarDe("Jed"))
    await waitFor(() => expect(advertir).toHaveBeenCalledWith("No se puede eliminar un técnico con órdenes activas"))
    expect(confirmar).not.toHaveBeenCalled()
    expect(pedidos.filter((p) => p.method === "DELETE")).toEqual([])
  })

  it("the card still shows the count of the scope (what a reassignment from here moves)", async () => {
    lista = [tecnico("t-jed", "Jed", { ordenesActivas: 0, ordenesActivasTotal: 7 })]
    montar()
    const tarjeta = (await screen.findByText("Jed")).closest("a") as HTMLElement
    expect(tarjeta).toHaveTextContent(/Activas\s*0/)
  })

  it("with work in this scope it is refused too", async () => {
    lista = [tecnico("t-a", "Ana", { ordenesActivas: 2, ordenesActivasTotal: 2 })]
    montar()
    fireEvent.click(await botonEliminarDe("Ana"))
    await waitFor(() => expect(advertir).toHaveBeenCalled())
    expect(confirmar).not.toHaveBeenCalled()
  })

  it("nothing open anywhere: the confirmation is asked, and a refusal sends no request", async () => {
    lista = [tecnico("t-b", "Beto", { ordenesActivas: 0, ordenesActivasTotal: 0 })]
    montar()
    fireEvent.click(await botonEliminarDe("Beto"))
    await waitFor(() => expect(confirmar).toHaveBeenCalledTimes(1))
    expect(advertir).not.toHaveBeenCalled()
    expect(pedidos.filter((p) => p.method === "DELETE")).toEqual([])
  })

  it("an answer without the total (an older server, or a viewer who is not an ADMIN) falls back to the scoped count", async () => {
    lista = [tecnico("t-c", "Carla", { ordenesActivas: 3 })]
    montar()
    fireEvent.click(await botonEliminarDe("Carla"))
    await waitFor(() => expect(advertir).toHaveBeenCalled())
    expect(confirmar).not.toHaveBeenCalled()
  })
})
