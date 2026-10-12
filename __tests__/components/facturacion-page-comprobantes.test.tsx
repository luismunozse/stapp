// __tests__/components/facturacion-page-comprobantes.test.tsx
/**
 * Tests: the "Facturación" section was renamed to "Comprobantes" in the UI
 * (nav label, page title) while its documents are now labeled "Remito"
 * (button, empty state). Route, identifiers, and DB fields are unchanged —
 * only the user-visible copy moved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } } }),
}))

const mockFetch = vi.fn()
global.fetch = mockFetch

describe("Facturación page — Comprobantes / Remito renaming", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders the 'Comprobantes' page title and 'Remito' document labels", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] })

    const { default: FacturacionPage } = await import("@/app/(dashboard)/facturacion/page")
    render(<FacturacionPage />)

    expect(screen.getByRole("heading", { name: "Comprobantes" })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText("No hay remitos registrados")).toBeInTheDocument()
    })

    expect(screen.getByText("Generar remito")).toBeInTheDocument()
  })
})
