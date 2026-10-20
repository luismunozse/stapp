// __tests__/components/comprobantes-tabs.test.tsx
/**
 * Pestañas de /facturacion: "Remitos" siempre; "Comprobantes ARCA" solo para
 * ADMIN y solo si ya hay comprobantes o se puede emitir.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import React from "react"

let rol: string | undefined = "ADMIN"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: rol ? { user: { role: rol } } : null }),
}))
vi.mock("@/components/facturacion/facturacion-list", () => ({
  FacturacionList: () => <div>LISTA-REMITOS</div>,
}))
vi.mock("@/components/facturacion/comprobantes-arca-list", () => ({
  ComprobantesArcaList: () => <div>LISTA-ARCA</div>,
}))

const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

function sonda(body: unknown, ok = true) {
  mockFetch.mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body })
}

async function montar() {
  const { ComprobantesTabs } = await import("@/components/facturacion/comprobantes-tabs")
  return render(<ComprobantesTabs />)
}

describe("ComprobantesTabs", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rol = "ADMIN"
  })

  it("ADMIN con comprobantes ve las dos pestañas, Remitos por defecto", async () => {
    sonda({ total: 3, puedeEmitir: false })
    await montar()
    expect(await screen.findByRole("tab", { name: "Comprobantes ARCA" })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Remitos" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("LISTA-REMITOS")).toBeInTheDocument()
    expect(screen.queryByText("LISTA-ARCA")).not.toBeInTheDocument()
    expect(mockFetch).toHaveBeenCalledWith("/api/facturacion-electronica/comprobantes?limit=1")
  })

  it("sin comprobantes pero con permiso para emitir, la pestaña igual aparece", async () => {
    sonda({ total: 0, puedeEmitir: true })
    await montar()
    expect(await screen.findByRole("tab", { name: "Comprobantes ARCA" })).toBeInTheDocument()
  })

  it("al elegir la pestaña ARCA muestra su listado", async () => {
    sonda({ total: 1, puedeEmitir: true })
    await montar()
    fireEvent.click(await screen.findByRole("tab", { name: "Comprobantes ARCA" }))
    expect(screen.getByText("LISTA-ARCA")).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: "Comprobantes ARCA" })).toHaveAttribute("aria-selected", "true")
  })

  it("volver a Remitos conserva el listado de remitos montado", async () => {
    sonda({ total: 1, puedeEmitir: true })
    await montar()
    fireEvent.click(await screen.findByRole("tab", { name: "Comprobantes ARCA" }))
    fireEvent.click(screen.getByRole("tab", { name: "Remitos" }))
    expect(screen.getByText("LISTA-REMITOS")).toBeVisible()
    expect(screen.queryByText("LISTA-ARCA")).not.toBeInTheDocument()
  })

  it("sin comprobantes y sin poder emitir no hay pestañas, solo los remitos", async () => {
    sonda({ total: 0, puedeEmitir: false })
    await montar()
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await screen.findByText("LISTA-REMITOS")
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })

  it("si la sonda falla no hay pestañas ni error", async () => {
    sonda({}, false)
    await montar()
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
    expect(screen.getByText("LISTA-REMITOS")).toBeInTheDocument()
  })

  it("un no-ADMIN ni consulta la API y ve solo los remitos", async () => {
    rol = "VENDEDOR"
    sonda({ total: 9, puedeEmitir: true })
    await montar()
    expect(screen.getByText("LISTA-REMITOS")).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 20))
    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.queryByRole("tab")).not.toBeInTheDocument()
  })
})
