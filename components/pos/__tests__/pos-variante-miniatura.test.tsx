// @vitest-environment jsdom
import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { PosVarianteMiniatura } from "@/components/pos/pos-variante-miniatura"

// The thumbnail of one row of the POS variants sheet: the row's own photo, else the borrowed
// photo of a sibling (dimmed, announced as "Foto de {etiqueta}"), else a placeholder. A broken
// image never throws and never blocks the row.

describe("PosVarianteMiniatura", () => {
  it("shows the own photo in a fixed 44px lazy image named after the row", () => {
    render(<PosVarianteMiniatura etiqueta="Azul / M" imagenUrl="https://img.test/azul.jpg" />)

    const img = screen.getByRole("img", { name: "Azul / M" })
    expect(img.getAttribute("src")).toBe("https://img.test/azul.jpg")
    expect(img.getAttribute("width")).toBe("44")
    expect(img.getAttribute("height")).toBe("44")
    expect(img.getAttribute("loading")).toBe("lazy")
    expect(img.getAttribute("decoding")).toBe("async")
    expect(screen.queryByText(/^Foto de/)).toBeNull()
  })

  it("prefers the own photo over a borrowed one", () => {
    render(
      <PosVarianteMiniatura
        etiqueta="Azul / M"
        imagenUrl="https://img.test/azul.jpg"
        imagenRespaldo={{ url: "https://img.test/rojo.jpg", etiqueta: "Rojo / M" }}
      />
    )

    expect(screen.getByRole("img", { name: "Azul / M" }).getAttribute("src")).toBe("https://img.test/azul.jpg")
    expect(screen.queryByText("Foto de Rojo / M")).toBeNull()
  })

  it("shows the borrowed photo dimmed and says whose it is for screen readers", () => {
    const { container } = render(
      <PosVarianteMiniatura etiqueta="Verde / M" imagenRespaldo={{ url: "https://img.test/rojo.jpg", etiqueta: "Rojo / M" }} />
    )

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.test/rojo.jpg")
    expect(screen.getByText("Foto de Rojo / M").className).toContain("sr-only")
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("")
  })

  it("shows the placeholder and no image when there is no photo at all", () => {
    const { container } = render(<PosVarianteMiniatura etiqueta="Verde / M" />)

    expect(container.querySelectorAll("img")).toHaveLength(0)
    expect(screen.getByTestId("variante-sin-foto")).toBeTruthy()
  })

  it("falls back to the placeholder when the image fails to load, without throwing", () => {
    const { container } = render(<PosVarianteMiniatura etiqueta="Azul / M" imagenUrl="https://img.test/roto.jpg" />)
    const img = container.querySelector("img") as HTMLImageElement
    expect(img).not.toBeNull()

    fireEvent.error(img)

    expect(container.querySelectorAll("img")).toHaveLength(0)
    expect(screen.getByTestId("variante-sin-foto")).toBeTruthy()
  })

  it("recovers when the row gets another photo after a failure", () => {
    const { container, rerender } = render(<PosVarianteMiniatura etiqueta="Azul / M" imagenUrl="https://img.test/roto.jpg" />)
    fireEvent.error(container.querySelector("img") as HTMLImageElement)
    expect(container.querySelectorAll("img")).toHaveLength(0)

    rerender(<PosVarianteMiniatura etiqueta="Azul / M" imagenUrl="https://img.test/nueva.jpg" />)

    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.test/nueva.jpg")
  })
})
