import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { EstadoFisicoCard } from "@/components/ordenes/danos/estado-fisico-card"

function respuesta(puedeAgregar: boolean) {
  return {
    ok: true,
    json: async () => ({
      danos: [
        {
          id: "d1",
          numero: 1,
          diagrama: "celular@1",
          vista: "frente",
          x: 0.5,
          y: 0.5,
          tipo: "golpe",
          nota: null,
          momento: "diagnostico",
          createdAt: new Date().toISOString(),
          createdByNombre: "Ana",
        },
      ],
      sinDanos: false,
      diagrama: "celular@1",
      puedeAgregar,
    }),
  }
}

afterEach(() => vi.unstubAllGlobals())

describe("EstadoFisicoCard: borrar daño de diagnóstico", () => {
  it("con permiso y dentro de la ventana muestra el botón de quitar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(true)))
    render(<EstadoFisicoCard ordenId="o1" />)
    await waitFor(() => expect(screen.getAllByLabelText("Quitar daño 1").length).toBeGreaterThan(0))
  })

  it("sin puedeAgregar (sin permiso u orden cerrada) no muestra el botón aunque esté en la ventana", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(false)))
    render(<EstadoFisicoCard ordenId="o1" />)
    await waitFor(() => expect(screen.getAllByText(/Golpe/).length).toBeGreaterThan(0))
    expect(screen.queryByLabelText("Quitar daño 1")).toBeNull()
  })

  it("avisa con el estado físico cargado", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(true)))
    const onCargado = vi.fn()
    render(<EstadoFisicoCard ordenId="o1" onCargado={onCargado} />)
    await waitFor(() => expect(onCargado).toHaveBeenCalled())
    expect(onCargado.mock.calls[0][0]).toMatchObject({ diagrama: "celular@1", sinDanos: false })
  })
})
