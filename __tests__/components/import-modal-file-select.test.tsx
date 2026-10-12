import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ImportModal } from "@/components/import/import-modal"

// Reproduce el flujo de selección de archivo del modal de importación.
// Estos casos cubren los dos silencios que dejaban al usuario sin feedback
// ni request: reintentar con el MISMO archivo y un FileReader que falla.

function getFileInput(container: HTMLElement) {
  return container.querySelector('input[type="file"]') as HTMLInputElement
}

const xlsxFile = () =>
  new File(["contenido"], "inventario.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })

describe("ImportModal — selección de archivo", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ totalRows: 1, preview: [], headers: [], unmappedColumns: [], invalidRows: 0, sinPrecio: 0 }),
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("limpia el value del input para que re-elegir el mismo archivo dispare el change", async () => {
    const { container } = render(
      <ImportModal entityType="INVENTARIO" onClose={vi.fn()} onSuccess={vi.fn()} />
    )
    const input = getFileInput(container)

    const valueSetter = vi.fn()
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => "",
      set: valueSetter,
    })

    fireEvent.change(input, { target: { files: [xlsxFile()] } })

    await waitFor(() => expect(valueSetter).toHaveBeenCalledWith(""))
  })

  it("muestra un error cuando el archivo no se puede leer", async () => {
    class FailingFileReader {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      result: string | null = null
      readAsDataURL() {
        setTimeout(() => this.onerror?.(), 0)
      }
    }
    vi.stubGlobal("FileReader", FailingFileReader)

    const { container } = render(
      <ImportModal entityType="INVENTARIO" onClose={vi.fn()} onSuccess={vi.fn()} />
    )
    fireEvent.change(getFileInput(container), { target: { files: [xlsxFile()] } })

    expect(await screen.findByText(/no se pudo leer el archivo/i)).toBeInTheDocument()
  })
})
