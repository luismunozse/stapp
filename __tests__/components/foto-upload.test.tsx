// Detalle de la orden: FotoUpload acepta varias imagenes (selector, arrastre o
// pegado) y las sube de a una al endpoint de fotos.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const showError = vi.fn().mockResolvedValue(undefined)
vi.mock("@/contexts/modal-context", () => ({ useModal: () => ({ showError }) }))
vi.mock("@/contexts/currency-context", () => ({ useTerminologia: () => (k: string) => k }))
vi.mock("@/lib/image-compression", () => ({ compressImage: async (f: File) => f }))
vi.mock("@/lib/capacitor", () => ({ isNativePlatform: () => false }))

import { FotoUpload } from "@/components/fotos/foto-upload"

const png = (name: string) => new File(["x"], name, { type: "image/png" })
const arrastre = (files: File[]) => ({ dataTransfer: { files, types: ["Files"], dropEffect: "none" } })

function renderUpload() {
  const onSuccess = vi.fn()
  const onUploaded = vi.fn()
  const utils = render(
    <FotoUpload ordenId="o1" onSuccess={onSuccess} onUploaded={onUploaded} onClose={() => {}} />
  )
  const zona = utils.container.firstElementChild as HTMLElement
  return { onSuccess, onUploaded, zona }
}

describe("FotoUpload — carga multiple desde PC", () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    showError.mockClear()
    fetchMock.mockReset()
    vi.stubGlobal("fetch", fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it("sube todas las imagenes soltadas, cada una con su descripcion", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) })
    const { onSuccess, zona } = renderUpload()

    fireEvent.drop(zona, arrastre([png("a.png"), png("b.png")]))
    const descripciones = await screen.findAllByLabelText("Descripción de la foto")
    expect(descripciones).toHaveLength(2)
    fireEvent.change(descripciones[1], { target: { value: "Pantalla rota" } })

    fireEvent.click(screen.getByRole("button", { name: "Subir 2 fotos" }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const bodies = fetchMock.mock.calls.map(([url, init]) => {
      expect(url).toBe("/api/ordenes/o1/fotos")
      return JSON.parse(init.body)
    })
    expect(bodies[0]).toMatchObject({ mime: "image/png", tipo: "REPARACION" })
    expect(bodies[0].descripcion).toBeUndefined()
    expect(bodies[1].descripcion).toBe("Pantalla rota")
  })

  it("si una falla, deja las que no subieron para reintentar y avisa cuantas subieron", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Límite del plan alcanzado" }) })
    const { onSuccess, onUploaded, zona } = renderUpload()

    fireEvent.drop(zona, arrastre([png("a.png"), png("b.png"), png("c.png")]))
    fireEvent.click(await screen.findByRole("button", { name: "Subir 3 fotos" }))

    await waitFor(() => expect(showError).toHaveBeenCalled())
    expect(showError).toHaveBeenCalledWith("Se subieron 1 de 3 fotos. Límite del plan alcanzado")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onUploaded).toHaveBeenCalledTimes(1)
    expect(screen.getAllByLabelText("Descripción de la foto")).toHaveLength(2)
  })

  it("avisa cuando lo soltado no son imagenes", async () => {
    const { zona } = renderUpload()
    fireEvent.drop(zona, arrastre([new File(["x"], "nota.pdf", { type: "application/pdf" })]))
    await waitFor(() =>
      expect(showError).toHaveBeenCalledWith(
        "No se pudo procesar ninguna imagen. Verificá que sean archivos de imagen válidos."
      )
    )
    expect(screen.getByRole("button", { name: "Subir foto" })).toBeDisabled()
  })
})
