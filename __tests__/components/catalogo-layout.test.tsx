import { describe, it, expect, vi } from "vitest"
import { render } from "@testing-library/react"

// next/font/google is not available in vitest — mock it to return stable
// className/variable handles like the real loader does.
vi.mock("next/font/google", () => ({
  Plus_Jakarta_Sans: () => ({ variable: "font-display-var", className: "" }),
  Inter: () => ({ variable: "font-body-var", className: "" }),
}))

import CatalogoLayout from "@/app/catalogo/[slug]/layout"

describe("CatalogoLayout", () => {
  it("wraps children in the storefront scope with fonts and base tokens", () => {
    const { container, getByText } = render(
      <CatalogoLayout>
        <p>contenido</p>
      </CatalogoLayout>,
    )
    const root = container.firstElementChild!
    expect(getByText("contenido")).toBeInTheDocument()
    expect(root.className).toContain("catalogo-storefront")
    expect(root.className).toContain("font-display-var")
    expect(root.className).toContain("font-body-var")
    expect(root.className).toContain("bg-cat-bg")
    expect(root.className).toContain("text-cat-ink")
    expect(root.className).toContain("font-body")
  })
})
