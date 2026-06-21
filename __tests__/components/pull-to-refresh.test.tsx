// __tests__/components/pull-to-refresh.test.tsx
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PullToRefresh } from "@/components/ui/pull-to-refresh"

describe("PullToRefresh", () => {
  it("renderiza los children", () => {
    render(
      <PullToRefresh onRefresh={vi.fn()}>
        <p>contenido del listado</p>
      </PullToRefresh>,
    )
    expect(screen.getByText("contenido del listado")).toBeInTheDocument()
  })

  it("no muestra 'Actualizando…' en reposo (sin gesto)", () => {
    render(
      <PullToRefresh onRefresh={vi.fn()}>
        <p>x</p>
      </PullToRefresh>,
    )
    // El status vivo existe pero vacío hasta que hay refresco en curso.
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("")
  })

  it("disabled no rompe el render de children", () => {
    render(
      <PullToRefresh onRefresh={vi.fn()} disabled>
        <p>deshabilitado</p>
      </PullToRefresh>,
    )
    expect(screen.getByText("deshabilitado")).toBeInTheDocument()
  })
})
