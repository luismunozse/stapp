/**
 * The bulk-selection bar sticks to the top once the page is scrolled. The app has two fixed headers that
 * paint above the page: the mobile header (h-14 + safe-area, below `lg`) and the floating top-right bar
 * (top-3, z-40, `lg` and up). Stuck at `top-0`, the bar slid under the floating bar and its right-hand
 * buttons became unreachable (a click opened the global search instead).
 *
 * jsdom cannot measure layout, so the offset classes are pinned directly.
 */
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { InventarioBulkBar } from "@/components/inventario/inventario-bulk-bar"

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({ confirm: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }),
}))

vi.mock("@/components/export/export-button", () => ({
  ExportButton: () => null,
}))

function renderBar() {
  render(
    <InventarioBulkBar
      selectedCount={2}
      selectedIds={["a", "b"]}
      categoriasDisponibles={[]}
      onClear={vi.fn()}
      onSuccess={vi.fn()}
      onAgrupar={vi.fn()}
    />
  )
  // The bar root is the ancestor that carries the selection counter.
  return screen.getByText("2 seleccionados").parentElement as HTMLElement
}

describe("InventarioBulkBar sticky offset", () => {
  it("stops below the mobile header (3.5rem + safe-area) instead of top-0", () => {
    const bar = renderBar()
    const classes = bar.className.split(/\s+/)

    expect(classes).toContain("sticky")
    expect(classes).toContain("top-[calc(3.5rem+env(safe-area-inset-top,0px))]")
    expect(classes).not.toContain("top-0")
  })

  it("stops below the floating top-right bar on desktop (lg:top-16)", () => {
    const bar = renderBar()

    expect(bar.className.split(/\s+/)).toContain("lg:top-16")
  })

  it("stays under the floating header z-index so dialogs and dropdowns paint above it", () => {
    const bar = renderBar()
    const zClass = bar.className.split(/\s+/).find((c) => /^z-\d+$/.test(c))

    // Floating header is z-40; popovers/dialogs are above that. The bar must not outrank them.
    expect(zClass).toBe("z-10")
  })
})
