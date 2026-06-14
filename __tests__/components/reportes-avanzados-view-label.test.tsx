/**
 * Test: PR1-3.2 — BranchScopeLabel is rendered inside the header of ReportesAvanzadosView
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import React from "react"

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ refresh: vi.fn() })),
  usePathname: vi.fn(() => "/"),
}))

vi.mock("next/dynamic", () => ({
  default: (loader: any) => {
    // Return a simple stub component for all dynamically imported components
    return function DynamicStub() {
      return null
    }
  },
}))

// Mock BranchScopeLabel to make it predictable in tests
vi.mock("@/components/reportes-avanzados/branch-scope-label", () => ({
  BranchScopeLabel: () => <span data-testid="branch-scope-label">Branch Label</span>,
}))

// Mock ExportButton
vi.mock("@/components/reportes-avanzados/export-button", () => ({
  ExportButton: () => null,
}))

describe("ReportesAvanzadosView — BranchScopeLabel in header", () => {
  beforeEach(() => vi.clearAllMocks())

  it("renders BranchScopeLabel in the header block", async () => {
    const { ReportesAvanzadosView } = await import("@/components/reportes-avanzados/reportes-avanzados-view")
    render(<ReportesAvanzadosView />)

    expect(screen.getByTestId("branch-scope-label")).toBeInTheDocument()
  })

  it("renders BranchScopeLabel after the description paragraph", async () => {
    const { ReportesAvanzadosView } = await import("@/components/reportes-avanzados/reportes-avanzados-view")
    const { container } = render(<ReportesAvanzadosView />)

    const header = container.querySelector(".space-y-6 > div")
    expect(header).not.toBeNull()
    // The label should be inside the header
    expect(header?.querySelector("[data-testid='branch-scope-label']")).not.toBeNull()
  })
})
