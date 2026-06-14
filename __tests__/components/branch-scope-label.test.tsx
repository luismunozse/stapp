/**
 * Tests: BranchScopeLabel component (PR1-3.1)
 * Reads localStorage["sucursal-activa-ui"] to show current branch or "Todas las sucursales".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import React from "react"

// Mock next/navigation (needed by some components)
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
  usePathname: vi.fn(() => "/"),
}))

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch

describe("BranchScopeLabel", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('renders "Todas las sucursales" when no localStorage key is set', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "suc-A", nombre: "Sucursal Centro", principal: false }] }),
    })

    const { BranchScopeLabel } = await import("@/components/reportes-avanzados/branch-scope-label")
    render(<BranchScopeLabel />)

    await waitFor(() => {
      expect(screen.getByText("Todas las sucursales")).toBeInTheDocument()
    })
  })

  it('renders "Todas las sucursales" when localStorage is "todas"', async () => {
    localStorage.setItem("sucursal-activa-ui", "todas")

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "suc-A", nombre: "Sucursal Centro", principal: false }] }),
    })

    const { BranchScopeLabel } = await import("@/components/reportes-avanzados/branch-scope-label")
    render(<BranchScopeLabel />)

    await waitFor(() => {
      expect(screen.getByText("Todas las sucursales")).toBeInTheDocument()
    })
  })

  it('renders "Viendo: {nombre}" when a specific branch is active', async () => {
    localStorage.setItem("sucursal-activa-ui", "suc-A")

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "suc-A", nombre: "Sucursal Centro", principal: true },
          { id: "suc-B", nombre: "Sucursal Norte", principal: false },
        ],
      }),
    })

    const { BranchScopeLabel } = await import("@/components/reportes-avanzados/branch-scope-label")
    render(<BranchScopeLabel />)

    await waitFor(() => {
      expect(screen.getByText("Viendo: Sucursal Centro")).toBeInTheDocument()
    })
  })

  it("does not render a dropdown or selection UI — read only", async () => {
    localStorage.setItem("sucursal-activa-ui", "suc-A")

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "suc-A", nombre: "Sucursal Centro", principal: true }],
      }),
    })

    const { BranchScopeLabel } = await import("@/components/reportes-avanzados/branch-scope-label")
    const { container } = render(<BranchScopeLabel />)

    await waitFor(() => {
      expect(screen.getByText("Viendo: Sucursal Centro")).toBeInTheDocument()
    })

    // No button (no dropdown trigger)
    expect(container.querySelectorAll("button")).toHaveLength(0)
    expect(container.querySelectorAll("select")).toHaveLength(0)
  })
})
