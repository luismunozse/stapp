import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { FotoVariante, type PropsFotoVariante } from "@/components/inventario/variantes/foto-variante"
import type { VistaFoto } from "@/components/inventario/variantes/use-fotos-variantes"

const vacia: VistaFoto = { pendiente: null, quitar: false, subida: null, errorAlQuitar: null }

function dibujar(over: Partial<PropsFotoVariante> = {}) {
  const props: PropsFotoVariante = {
    id: "r1",
    etiqueta: "Rojo / M",
    propia: null,
    respaldo: null,
    vista: vacia,
    tamano: "tabla",
    alElegir: vi.fn(async () => ({ ok: true as const })),
    alQuitar: vi.fn(),
    alDescartar: vi.fn(),
    alReintentar: vi.fn(),
    ...over,
  }
  const r = render(<FotoVariante {...props} />)
  return { ...r, props }
}

const archivo = (tipo = "image/jpeg") => new File([new Uint8Array(10)], "foto", { type: tipo })
const entrada = () => screen.getByTestId("foto-input-r1") as HTMLInputElement
const imagenes = () => document.querySelectorAll("img")

describe("FotoVariante: states", () => {
  it("empty: offers to add a photo, named after the row", () => {
    dibujar()
    expect(screen.getByRole("button", { name: "Agregar foto de Rojo / M" })).toBeInTheDocument()
    expect(imagenes()).toHaveLength(0)
    expect(screen.queryByRole("button", { name: /Quitar/ })).toBeNull()
  })

  it("fallback: dimmed, captioned with the lender's label, offers to add, and has NO remove control", () => {
    dibujar({ respaldo: { url: "https://cdn/azul.jpg", etiqueta: "Azul" } })
    const img = imagenes()[0]
    expect(img.getAttribute("src")).toBe("https://cdn/azul.jpg")
    expect(img.className).toContain("opacity-60")
    expect(screen.getByText("Foto de Azul")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Agregar foto de Rojo / M" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Quitar|Descartar/ })).toBeNull()
  })

  it("fallback without a lender label still says it is another variant's photo", () => {
    dibujar({ respaldo: { url: "https://cdn/x.jpg", etiqueta: "" } })
    expect(screen.getByText("Foto de otra variante")).toBeInTheDocument()
  })

  it("own: shows the photo at full opacity, replaces and removes", () => {
    const { props } = dibujar({ propia: "https://cdn/rojo.jpg", respaldo: { url: "https://cdn/azul.jpg", etiqueta: "Azul" } })
    const img = imagenes()[0]
    expect(img.getAttribute("src")).toBe("https://cdn/rojo.jpg")
    expect(img.className).not.toContain("opacity-60")
    expect(screen.queryByText(/^Foto de /)).toBeNull()
    expect(screen.getByRole("button", { name: "Cambiar foto de Rojo / M" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Quitar foto de Rojo / M" }))
    expect(props.alQuitar).toHaveBeenCalledWith("r1")
  })

  it("pending: shows the preview and says it is not saved yet", () => {
    const { props } = dibujar({ propia: "https://cdn/vieja.jpg", vista: { ...vacia, pendiente: { previa: "blob:p", estado: "pendiente" } } })
    expect(imagenes()[0].getAttribute("src")).toBe("blob:p")
    expect(screen.queryByRole("button", { name: /^Quitar/ })).toBeNull()
    expect(screen.getByText("Sin guardar")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Descartar foto de Rojo / M" }))
    expect(props.alDescartar).toHaveBeenCalledWith("r1")
  })

  it("uploading: a spinner in a polite status region and the controls locked", () => {
    dibujar({ vista: { ...vacia, pendiente: { previa: "blob:p", estado: "subiendo" } } })
    expect(screen.getByRole("status")).toHaveTextContent("Subiendo foto")
    expect(screen.getByRole("button", { name: /Cambiar foto de Rojo \/ M|Agregar foto de Rojo \/ M/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Descartar foto de Rojo / M" })).toBeDisabled()
    expect(document.querySelector(".animate-spin")?.getAttribute("class")).toContain("motion-reduce:animate-none")
  })

  it("error: shows the reason and Reintentar calls onReintentar(id)", () => {
    const { props } = dibujar({ vista: { ...vacia, pendiente: { previa: "blob:p", estado: "error", mensaje: "No se pudo subir la foto. Probá de nuevo." } } })
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo subir la foto")
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(props.alReintentar).toHaveBeenCalledWith("r1")
  })

  it("marked for removal: says it will go and offers to keep it", () => {
    const { props } = dibujar({ propia: "https://cdn/rojo.jpg", vista: { ...vacia, quitar: true } })
    expect(screen.getByText("Se quitará")).toBeInTheDocument()
    expect(imagenes()).toHaveLength(0)
    fireEvent.click(screen.getByRole("button", { name: "No quitar la foto de Rojo / M" }))
    expect(props.alQuitar).toHaveBeenCalledWith("r1")
  })

  it("a failed removal shows the reason and can be retried", () => {
    const { props } = dibujar({ propia: "https://cdn/rojo.jpg", vista: { ...vacia, quitar: true, errorAlQuitar: "No se pudo quitar la foto. Probá de nuevo." } })
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo quitar la foto")
    expect(screen.queryByText("Se quitará")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/ }))
    expect(props.alReintentar).toHaveBeenCalledWith("r1")
  })

  it("after an upload in this session the new URL wins over the old one", () => {
    dibujar({ propia: "https://cdn/vieja.jpg", vista: { ...vacia, subida: "https://cdn/nueva.jpg" } })
    expect(imagenes()[0].getAttribute("src")).toBe("https://cdn/nueva.jpg")
  })

  it("after a removal in this session the row reads as empty", () => {
    dibujar({ propia: "https://cdn/vieja.jpg", vista: { ...vacia, subida: "" } })
    expect(imagenes()).toHaveLength(0)
    expect(screen.getByRole("button", { name: "Agregar foto de Rojo / M" })).toBeInTheDocument()
  })

  it("an archived row has every control disabled", () => {
    dibujar({ archivada: true, propia: "https://cdn/rojo.jpg" })
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled()
    expect(entrada()).toBeDisabled()
  })

  it("a locked form disables the controls too", () => {
    dibujar({ deshabilitado: true, propia: "https://cdn/rojo.jpg" })
    for (const b of screen.getAllByRole("button")) expect(b).toBeDisabled()
  })
})

describe("FotoVariante: picking", () => {
  it("accepts only JPG, PNG and WebP and does not force the camera", () => {
    dibujar()
    expect(entrada().accept).toBe("image/jpeg,image/png,image/webp")
    expect(entrada().hasAttribute("capture")).toBe(false)
    expect(entrada().type).toBe("file")
  })

  it("the picker button opens the file chooser", () => {
    dibujar()
    const abrir = vi.spyOn(entrada(), "click")
    fireEvent.click(screen.getByRole("button", { name: "Agregar foto de Rojo / M" }))
    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it("a native button opens the chooser with Enter and Space (a click)", () => {
    dibujar()
    const boton = screen.getByRole("button", { name: "Agregar foto de Rojo / M" })
    expect(boton.tagName).toBe("BUTTON")
    expect(boton.getAttribute("type")).toBe("button")
  })

  it("hands the chosen file to onElegir with the row id and resets the input so the same file can be picked again", async () => {
    const { props } = dibujar()
    const f = archivo()
    const reinicios: string[] = []
    Object.defineProperty(entrada(), "value", { configurable: true, get: () => "", set: (v: string) => void reinicios.push(v) })
    fireEvent.change(entrada(), { target: { files: [f] } })
    await waitFor(() => expect(props.alElegir).toHaveBeenCalledWith("r1", f))
    expect(reinicios).toEqual([""])
  })

  it("shows the reason when the file is refused", async () => {
    dibujar({ alElegir: vi.fn(async () => ({ ok: false as const, mensaje: "La foto pesa más de 5 MB. Elegí una más liviana." })) })
    fireEvent.change(entrada(), { target: { files: [archivo()] } })
    expect(await screen.findByRole("alert")).toHaveTextContent("más de 5 MB")
  })

  it("clears a refusal once a file is accepted", async () => {
    const alElegir = vi
      .fn<PropsFotoVariante["alElegir"]>()
      .mockResolvedValueOnce({ ok: false, mensaje: "No." })
      .mockResolvedValueOnce({ ok: true })
    dibujar({ alElegir })
    fireEvent.change(entrada(), { target: { files: [archivo()] } })
    await screen.findByRole("alert")
    fireEvent.change(entrada(), { target: { files: [archivo()] } })
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull())
  })

  it("ignores an empty selection", () => {
    const { props } = dibujar()
    fireEvent.change(entrada(), { target: { files: [] } })
    expect(props.alElegir).not.toHaveBeenCalled()
  })
})

describe("FotoVariante: layout and motion", () => {
  it("the table slot is 40px and the card slot is 56px", () => {
    const { unmount } = dibujar({ tamano: "tabla" })
    expect(screen.getByRole("button", { name: /Agregar foto/ }).className).toMatch(/\bh-10\b.*\bw-10\b|\bw-10\b.*\bh-10\b/)
    unmount()
    dibujar({ tamano: "card" })
    expect(screen.getByRole("button", { name: /Agregar foto/ }).className).toMatch(/\bh-14\b.*\bw-14\b|\bw-14\b.*\bh-14\b/)
  })

  it("the card keeps a 44px target on the secondary controls", () => {
    dibujar({ tamano: "card", propia: "https://cdn/rojo.jpg" })
    expect(screen.getByRole("button", { name: "Quitar foto de Rojo / M" }).className).toContain("min-h-11")
  })

  it("has press feedback that reduced motion turns off, and no entrance animation", () => {
    const { container } = dibujar({ propia: "https://cdn/rojo.jpg" })
    const boton = screen.getByRole("button", { name: /Cambiar foto/ })
    expect(boton.className).toContain("active:scale-[0.97]")
    expect(boton.className).toContain("motion-reduce:transform-none")
    expect(container.innerHTML).not.toMatch(/animate-(in|fade|slide|bounce)|transition-all/)
  })

  it("names the control after the row so a screen reader knows which photo it is", () => {
    dibujar({ etiqueta: "Azul / S" })
    expect(screen.getByRole("button", { name: "Agregar foto de Azul / S" })).toBeInTheDocument()
    expect(within(screen.getByTestId("foto-r1")).getAllByRole("button")).toHaveLength(1)
  })
})
