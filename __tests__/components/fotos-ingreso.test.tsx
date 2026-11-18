// Carga de fotos desde PC: ademas del selector, FotosIngreso acepta archivos
// arrastrados y pegados (Ctrl+V).
import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"

// El diálogo del QR se reemplaza por un doble que expone su callback.
const celular: { onFotoRecibida?: (f: File) => void } = {}
vi.mock("@/components/fotos/foto-celular-dialog", () => ({
  FotoCelularDialog: (props: { onFotoRecibida?: (f: File) => void }) => {
    celular.onFotoRecibida = props.onFotoRecibida
    return null
  },
}))

import { FotosIngreso } from "@/components/ordenes/fotos-ingreso"

const png = (name = "foto.png") => new File(["x"], name, { type: "image/png" })

function renderZona(props: Partial<React.ComponentProps<typeof FotosIngreso>> = {}) {
  const onFiles = vi.fn()
  const utils = render(
    <FotosIngreso
      label="Fotos"
      fotos={[]}
      comprimiendo={false}
      onFiles={onFiles}
      onRemove={() => {}}
      onDescripcionChange={() => {}}
      {...props}
    />
  )
  const zona = screen.getByText("Fotos").parentElement as HTMLElement
  return { onFiles, zona, ...utils }
}

const arrastre = (files: File[]) => ({ dataTransfer: { files, types: ["Files"], dropEffect: "none" } })

function pegar(target: Element | Document, files: File[], types: string[] = ["Files"]) {
  const ev = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(ev, "clipboardData", { value: { files, types } })
  target.dispatchEvent(ev)
  return ev
}

describe("FotosIngreso — carga desde PC", () => {
  it("entrega los archivos soltados sobre la zona", () => {
    const { onFiles, zona } = renderZona()
    const files = [png("a.png"), png("b.png")]

    fireEvent.dragEnter(zona, arrastre(files))
    expect(screen.getByText("Soltá las imágenes para agregarlas")).toBeInTheDocument()

    fireEvent.drop(zona, arrastre(files))
    expect(onFiles).toHaveBeenCalledWith(files)
    expect(screen.queryByText("Soltá las imágenes para agregarlas")).not.toBeInTheDocument()
  })

  it("ignora arrastres que no son archivos (texto, enlaces)", () => {
    const { onFiles, zona } = renderZona()
    fireEvent.drop(zona, { dataTransfer: { files: [], types: ["text/plain"] } })
    expect(onFiles).not.toHaveBeenCalled()
  })

  it("no acepta archivos mientras se estan comprimiendo otros", () => {
    const { onFiles, zona } = renderZona({ comprimiendo: true })
    fireEvent.drop(zona, arrastre([png()]))
    pegar(document, [png()])
    expect(onFiles).not.toHaveBeenCalled()
  })

  it("entrega las imagenes pegadas con Ctrl+V y descarta lo que no es imagen", () => {
    const { onFiles } = renderZona()
    const img = png("captura.png")
    const ev = pegar(document, [img, new File(["x"], "nota.txt", { type: "text/plain" })])
    expect(onFiles).toHaveBeenCalledWith([img])
    expect(ev.defaultPrevented).toBe(true)
  })

  it("no intercepta el pegado de texto en un campo aunque traiga una imagen adjunta", () => {
    const { onFiles } = renderZona({
      fotos: [{ id: "1", preview: "data:image/png;base64,AA", descripcion: "" }],
    })
    const campo = screen.getByPlaceholderText("Descripción...")
    const ev = pegar(campo, [png()], ["text/plain", "Files"])
    expect(onFiles).not.toHaveBeenCalled()
    expect(ev.defaultPrevented).toBe(false)
  })

  it("con varias zonas, el pegado va a la ultima sobre la que paso el puntero", () => {
    const a = vi.fn()
    const b = vi.fn()
    const base = { fotos: [], comprimiendo: false, onRemove: () => {}, onDescripcionChange: () => {} }
    render(
      <>
        <FotosIngreso label="Equipo A" onFiles={a} {...base} />
        <FotosIngreso label="Equipo B" onFiles={b} {...base} />
      </>
    )
    fireEvent.pointerEnter(screen.getByText("Equipo B").parentElement as HTMLElement)
    pegar(document, [png()])
    expect(b).toHaveBeenCalledTimes(1)
    expect(a).not.toHaveBeenCalled()
  })
})

describe("FotosIngreso — fotos que llegan desde el celular", () => {
  it("ofrece el QR desde el celular", () => {
    renderZona()
    expect(screen.getByRole("button", { name: "Desde el celular" })).toBeInTheDocument()
  })

  it("entrega las fotos del celular al padre solo cuando no está procesando otras", () => {
    const onFiles = vi.fn()
    const base = { label: "Fotos", fotos: [], onFiles, onRemove: () => {}, onDescripcionChange: () => {} }
    const { rerender } = render(<FotosIngreso {...base} comprimiendo />)

    const a = png("a.png")
    const b = png("b.png")
    act(() => celular.onFotoRecibida!(a))
    act(() => celular.onFotoRecibida!(b))
    // El padre sigue comprimiendo: esperan en la cola.
    expect(onFiles).not.toHaveBeenCalled()

    rerender(<FotosIngreso {...base} comprimiendo={false} />)
    expect(onFiles).toHaveBeenCalledTimes(1)
    expect(onFiles).toHaveBeenCalledWith([a, b])

    // No se vuelven a entregar en renders posteriores.
    rerender(<FotosIngreso {...base} comprimiendo={false} />)
    expect(onFiles).toHaveBeenCalledTimes(1)
  })
})
