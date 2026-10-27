/**
 * An appointment is created in the branch the write lands in, and its technician is carried
 * into the order made from it, so the technician picker uses the same write scope as the
 * order form (`?alcance=escritura`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { TurnoFormDialog } from "@/components/agenda/turno-form-dialog"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ timezone: "America/Argentina/Buenos_Aires" }),
}))
vi.mock("@/components/cotizaciones/cliente-selector", () => ({ ClienteSelector: () => <div /> }))

let pedidos: string[] = []

function montar(open: boolean) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TurnoFormDialog open={open} onClose={vi.fn()} onSaved={vi.fn()} />
    </SWRConfig>,
  )
}

describe("TurnoFormDialog - technician picker scope", () => {
  beforeEach(() => {
    pedidos = []
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        pedidos.push(url)
        const cuerpo = url.startsWith("/api/tecnicos") ? [{ id: "t-a", nombre: "Ana" }] : []
        return Promise.resolve({ ok: true, json: async () => cuerpo } as Response)
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it("asks for the write scope, never for the plain list", async () => {
    montar(true)

    await waitFor(() => expect(pedidos.filter((u) => u.startsWith("/api/tecnicos"))).toEqual(["/api/tecnicos?alcance=escritura"]))
  })

  it("asks for nothing while the dialog is closed", () => {
    montar(false)

    expect(pedidos.filter((u) => u.startsWith("/api/tecnicos"))).toEqual([])
  })
})
