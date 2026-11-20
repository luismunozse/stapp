import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PagarOrden, type PagoSeguimiento } from "@/components/seguimiento/pagar-orden"

const pagoBase: PagoSeguimiento = {
  total: 187000,
  pagado: 0,
  saldo: 187000,
  moneda: "ARS",
  alias: "taller.mp",
  mediosPagoTexto: null,
  avisoPendiente: null,
  ultimoRechazo: null,
}

describe("PagarOrden (seguimiento)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("muestra el saldo y el alias para transferir", () => {
    render(<PagarOrden token="tok" pago={pagoBase} onInformado={vi.fn()} />)
    expect(screen.getByText("Saldo a pagar")).toBeInTheDocument()
    expect(screen.getByText("taller.mp")).toBeInTheDocument()
  })

  it("sin alias solo ofrece efectivo", () => {
    render(<PagarOrden token="tok" pago={{ ...pagoBase, alias: null }} onInformado={vi.fn()} />)
    expect(screen.queryByRole("radio", { name: /Transferencia/ })).not.toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /Efectivo/ })).toBeInTheDocument()
  })

  it("transferencia sin comprobante no se envía", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
    render(<PagarOrden token="tok" pago={pagoBase} onInformado={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Informar pago" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Adjuntá el comprobante")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("efectivo se informa sin comprobante", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 201 }))
    const onInformado = vi.fn()
    render(<PagarOrden token="tok" pago={pagoBase} onInformado={onInformado} />)
    fireEvent.click(screen.getByRole("radio", { name: /Efectivo/ }))
    fireEvent.click(screen.getByRole("button", { name: "Avisar al taller" }))
    await waitFor(() => expect(onInformado).toHaveBeenCalled())
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe("/api/public/ordenes/tok/informar-pago")
    const form = init.body as FormData
    expect(form.get("metodo")).toBe("EFECTIVO")
    expect(form.get("monto")).toBe("187000")
  })

  it("con un aviso pendiente muestra que el taller lo está verificando", () => {
    render(
      <PagarOrden
        token="tok"
        pago={{ ...pagoBase, avisoPendiente: { monto: 100000, metodo: "TRANSFERENCIA", fecha: "2026-11-19T12:00:00Z" } }}
        onInformado={vi.fn()}
      />,
    )
    expect(screen.getByText(/lo está verificando/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Informar pago" })).not.toBeInTheDocument()
  })
})
