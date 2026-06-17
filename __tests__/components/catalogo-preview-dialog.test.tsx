// __tests__/components/catalogo-preview-dialog.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { CatalogoPreviewDialog } from "@/components/catalogo/catalogo-preview-dialog"

describe("CatalogoPreviewDialog", () => {
  it("con catálogo inactivo muestra aviso y no renderiza iframe", () => {
    const { container } = render(
      <CatalogoPreviewDialog open slug="mi-taller" activo={false} onOpenChange={vi.fn()} />,
    )
    expect(screen.getByText(/desactivado/i)).toBeInTheDocument()
    expect(container.querySelector("iframe")).toBeNull()
  })

  it("con catálogo activo renderiza iframe apuntando al slug", () => {
    render(
      <CatalogoPreviewDialog open slug="mi-taller" activo={true} onOpenChange={vi.fn()} />,
    )
    // Radix Dialog portals into document.body — use document instead of container
    const iframe = document.querySelector("iframe")
    expect(iframe).not.toBeNull()
    expect(iframe?.getAttribute("src")).toContain("/catalogo/mi-taller")
  })
})
