import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ImageGalleryInput } from "@/components/catalogo/image-gallery-input"

describe("ImageGalleryInput", () => {
  it("marks the cover and renders gallery images", () => {
    render(
      <ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={vi.fn()} onUpload={vi.fn()} />,
    )
    expect(screen.getByText(/portada/i)).toBeInTheDocument()
    expect(screen.getAllByRole("img")).toHaveLength(2)
  })

  it("'Hacer portada' promotes a gallery image and demotes the cover", () => {
    const onChange = vi.fn()
    render(<ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={onChange} onUpload={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /hacer portada/i }))
    expect(onChange).toHaveBeenCalledWith({ cover: "b.jpg", gallery: ["a.jpg"] })
  })

  it("removing the cover clears it", () => {
    const onChange = vi.fn()
    render(<ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={onChange} onUpload={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /quitar portada/i }))
    expect(onChange).toHaveBeenCalledWith({ cover: null, gallery: ["b.jpg"] })
  })

  it("uploading a file appends via onUpload + addImage", async () => {
    const onChange = vi.fn()
    const onUpload = vi.fn().mockResolvedValue("c.jpg")
    const { container } = render(
      <ImageGalleryInput cover="a.jpg" gallery={["b.jpg"]} onChange={onChange} onUpload={onUpload} />,
    )
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(["x"], "c.jpg", { type: "image/jpeg" })
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(file))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ cover: "a.jpg", gallery: ["b.jpg", "c.jpg"] }))
  })
})
