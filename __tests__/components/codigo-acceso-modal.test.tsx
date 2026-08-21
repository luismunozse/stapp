/**
 * CodigoAccesoModal es el editor de codigo/contrasena/patron de acceso de un
 * equipo en la recepcion multiple (reemplaza el input bare que tenia
 * RecepcionEquipoCard). Guarda un borrador interno -- ver
 * inferirTipoAcceso y el flujo Cancelar/Guardar en el componente -- y estos
 * tests cubren exactamente ese contrato: que pestana se infiere de un valor
 * existente, que Cancelar descarta lo escrito, que cambiar de pestana limpia
 * el borrador (mismo criterio que el toggle PIN/Patron de orden-form.tsx) y
 * que Guardar en la pestana de patron efectivamente commitea el string con
 * el prefijo "Patron: " que emite PatternLock (contrato de persistencia, no
 * se toca).
 *
 * PatternLock dibuja en un <canvas>; jsdom no trae un backend 2D real (mismo
 * problema documentado en recepcion-form-equipo-sync.test.tsx para
 * react-signature-canvas). Se stubea getContext (para que draw() no explote)
 * y getBoundingClientRect (para que la conversion de coordenadas del mouse a
 * puntos del patron no de NaN con un rect de jsdom en 0x0).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CodigoAccesoModal, inferirTipoAcceso } from "@/components/ordenes/codigo-acceso-modal"

describe("inferirTipoAcceso", () => {
  it("valor vacio infiere codigo", () => {
    expect(inferirTipoAcceso("")).toBe("codigo")
  })

  it("valor todo digitos infiere codigo", () => {
    expect(inferirTipoAcceso("1234")).toBe("codigo")
  })

  it("valor con el prefijo de PatternLock infiere patron", () => {
    expect(inferirTipoAcceso("Patrón: 1-2-5-9")).toBe("patron")
  })

  it("cualquier otro texto no vacio infiere contrasena", () => {
    expect(inferirTipoAcceso("hunter2")).toBe("contrasena")
  })
})

describe("CodigoAccesoModal", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
    } as unknown as CanvasRenderingContext2D)
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      width: 180,
      height: 180,
      top: 0,
      left: 0,
      right: 180,
      bottom: 180,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("abre en la pestana Codigo cuando el valor esta vacio", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="" onChange={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /Código/i })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText(/Código numérico/i)).toBeInTheDocument()
  })

  it("abre en la pestana Patron cuando el valor tiene el prefijo Patron:", () => {
    render(
      <CodigoAccesoModal open onOpenChange={vi.fn()} value="Patrón: 1-2-5-9" onChange={vi.fn()} />
    )
    expect(screen.getByRole("tab", { name: /Patrón/i })).toHaveAttribute("aria-selected", "true")
    // PatternLock parsea el valor inicial al montar y ya muestra el patron
    // dibujado (no el placeholder "Dibuja conectando los puntos").
    expect(screen.getByText("Patrón: 1-2-5-9")).toBeInTheDocument()
  })

  it("abre en la pestana Contrasena cuando el valor es texto no numerico", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="hunter2" onChange={vi.fn()} />)
    expect(screen.getByRole("tab", { name: /Contraseña/i })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByLabelText(/^Contraseña$/i)).toHaveValue("hunter2")
  })

  it("Cancelar descarta el borrador: no llama a onChange", () => {
    const onChange = vi.fn()
    const onOpenChange = vi.fn()
    render(<CodigoAccesoModal open onOpenChange={onOpenChange} value="1234" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText(/Código numérico/i), { target: { value: "9999" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))

    expect(onChange).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("Guardar commitea el borrador editado", () => {
    const onChange = vi.fn()
    const onOpenChange = vi.fn()
    render(<CodigoAccesoModal open onOpenChange={onOpenChange} value="1234" onChange={onChange} />)

    fireEvent.change(screen.getByLabelText(/Código numérico/i), { target: { value: "9999" } })
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))

    expect(onChange).toHaveBeenCalledWith("9999")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("el input de codigo filtra caracteres no numericos", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="" onChange={vi.fn()} />)
    const input = screen.getByLabelText(/Código numérico/i)
    fireEvent.change(input, { target: { value: "12a3b" } })
    expect(input).toHaveValue("123")
  })

  it("cambiar de pestana limpia el borrador", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="1234" onChange={vi.fn()} />)

    expect(screen.getByLabelText(/Código numérico/i)).toHaveValue("1234")

    fireEvent.click(screen.getByRole("tab", { name: /Contraseña/i }))
    expect(screen.getByLabelText(/^Contraseña$/i)).toHaveValue("")
  })

  it("no limpia el borrador al volver a hacer click en la pestana ya activa", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="1234" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /Código/i }))
    expect(screen.getByLabelText(/Código numérico/i)).toHaveValue("1234")
  })

  it("el toggle mostrar/ocultar contrasena cambia el type del input", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="hunter2" onChange={vi.fn()} />)
    const input = screen.getByLabelText(/^Contraseña$/i)
    expect(input).toHaveAttribute("type", "password")

    fireEvent.click(screen.getByRole("button", { name: /Mostrar contraseña/i }))
    expect(input).toHaveAttribute("type", "text")

    fireEvent.click(screen.getByRole("button", { name: /Ocultar contraseña/i }))
    expect(input).toHaveAttribute("type", "password")
  })

  it("el canvas de la pestana Patron renderiza en 240px (180 es finger-hostile en mostrador)", () => {
    render(<CodigoAccesoModal open onOpenChange={vi.fn()} value="" onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole("tab", { name: /Patrón/i }))
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    expect(canvas.width).toBe(240)
    expect(canvas.height).toBe(240)
  })

  it("la pestana Patron renderiza PatternLock y Guardar commitea el string con prefijo", () => {
    const onChange = vi.fn()
    const onOpenChange = vi.fn()
    render(<CodigoAccesoModal open onOpenChange={onOpenChange} value="" onChange={onChange} />)

    fireEvent.click(screen.getByRole("tab", { name: /Patrón/i }))
    expect(screen.getByText("Dibuja conectando los puntos")).toBeInTheDocument()

    // Dibuja un patron simple: punto 1 (30,30) -> punto 2 (90,30), adyacentes
    // en la grilla de 3x3 (size=180 por defecto en PatternLock).
    const canvas = document.querySelector("canvas") as HTMLCanvasElement
    fireEvent.mouseDown(canvas, { clientX: 30, clientY: 30 })
    fireEvent.mouseMove(canvas, { clientX: 90, clientY: 30 })
    fireEvent.mouseUp(canvas)

    expect(screen.getByText("Patrón: 1-2")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }))
    expect(onChange).toHaveBeenCalledWith("Patrón: 1-2")
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
