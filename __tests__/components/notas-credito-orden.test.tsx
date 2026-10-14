// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { render, screen } from "@testing-library/react"
import { SWRConfig } from "swr"

vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}`, formatDate: (d: string) => `dia(${d})` }),
}))

import { NotasCreditoOrden } from "@/components/notas-credito/notas-credito-orden"

const filas = [
  {
    id: "nc-2", origen: "ORDEN", origenId: "o-1", origenNumero: "CEL099", numero: "NC-000011",
    fecha: "2026-10-14", modo: "MONTO", motivoNc: "TRABAJO_NO_REALIZADO", motivo: "Trabajo no realizado",
    detalle: null, monto: 2000, montoAplicadoDeuda: 500, montoReembolso: 1500, metodo: "EFECTIVO",
    metodoLabel: "Efectivo", clienteId: "cli-1", clienteNombre: "Juan", sucursalId: null, sucursalNombre: null,
    usuarioNombre: "Ana", anulada: true,
  },
]

function stubFetch(ok: boolean, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, status: ok ? 200 : 404, json: async () => body })))
}

const renderBloque = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NotasCreditoOrden ordenId="o-1" />
    </SWRConfig>
  )

describe("NotasCreditoOrden", () => {
  beforeEach(() => vi.clearAllMocks())

  it("lista las NC de la orden con estado, reparto y PDF", async () => {
    stubFetch(true, filas)
    renderBloque()
    expect(await screen.findByText("Notas de crédito (1)")).toBeInTheDocument()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/ordenes/o-1/notas-credito")
    expect(screen.getByText("NC-000011")).toBeInTheDocument()
    expect(screen.getByText("Anulada")).toBeInTheDocument()
    expect(screen.getByText("Trabajo no realizado")).toBeInTheDocument()
    expect(screen.getByText(/Bajó la deuda \$500 · Reintegro \$1500 \(Efectivo\)/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument()
  })

  it("sin NC no dibuja nada", async () => {
    stubFetch(true, [])
    const { container } = renderBloque()
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it("si la ruta responde error (orden que no ve) no dibuja nada ni rompe el detalle", async () => {
    stubFetch(false, { error: "Orden no encontrada" })
    const { container } = renderBloque()
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })
})

describe("detalle de la orden", () => {
  const src = readFileSync(join(process.cwd(), "components/ordenes/orden-detail.tsx"), "utf8")

  it("monta el bloque de NC para todos los roles que ven la orden", () => {
    expect(src).toMatch(/<NotasCreditoOrden ordenId=\{orden\.id\} \/>/)
  })

  it("refresca el bloque al emitir una NC desde el diálogo actual", () => {
    expect(src).toMatch(/mutate\(`\/api\/ordenes\/\$\{orden\.id\}\/notas-credito`\)/)
  })
})
