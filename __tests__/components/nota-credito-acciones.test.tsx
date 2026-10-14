// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
vi.mock("@/components/notas-credito/nota-credito-ticket-dialog", () => ({
  NotaCreditoTicketDialog: (p: { open: boolean; notaCreditoId: string }) =>
    p.open ? <div role="dialog">ticket de {p.notaCreditoId}</div> : null,
}))

import { NotaCreditoAcciones } from "@/components/notas-credito/nota-credito-acciones"

describe("NotaCreditoAcciones", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("open", vi.fn())
  })

  it("PDF abre el documento de esa NC en una pestaña nueva", () => {
    render(<NotaCreditoAcciones id="nc-1" />)
    fireEvent.click(screen.getByRole("button", { name: "PDF" }))
    expect(window.open).toHaveBeenCalledWith("/api/notas-credito/nc-1/pdf", "_blank")
  })

  it("compacto conserva el nombre accesible", () => {
    render(<NotaCreditoAcciones id="nc-1" compacto />)
    expect(screen.getByRole("button", { name: "PDF" })).toBeInTheDocument()
  })

  it("Ticket abre el diálogo de impresión de esa NC", () => {
    render(<NotaCreditoAcciones id="nc-1" />)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ticket" }))
    expect(screen.getByRole("dialog")).toHaveTextContent("ticket de nc-1")
  })
})
