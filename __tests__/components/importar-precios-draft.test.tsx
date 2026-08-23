/**
 * Borrador local del asistente de importacion de precios (useFormDraft,
 * hooks/use-form-draft.ts).
 *
 * Lo que se protege NO es el archivo, es el trabajo alrededor del archivo.
 *
 * La planilla llega como `File` y se guarda ademas en base64 para mandarla al
 * backend en cada paso. Ninguna de las dos cosas puede ir a localStorage: un
 * `File` se serializa a `{}`, y el base64 de un xlsx de hasta 6MB no entra en
 * una cuota de ~5MB que ademas comparte con todos los otros borradores del
 * panel -- el `setItem` empieza a tirar QuotaExceededError y la persistencia
 * deja de funcionar EN TODO EL PANEL, en silencio.
 *
 * Asi que el borrador guarda las decisiones: que hoja, que fila de encabezados,
 * que columna es cada campo y con que opciones. Volver a elegir el archivo son
 * dos clicks; volver a mapear ocho columnas de una lista de proveedor es la
 * parte tediosa, y es la que vuelve.
 *
 * Lo que NO vuelve son las filas que el operador habia desmarcado a mano en la
 * vista previa: `excludedIds` es un Set (se serializa a `{}`) y restaurar mal
 * esa lista significa volver a incluir en un cambio masivo de precios filas que
 * alguien saco a proposito. Ahi la respuesta correcta es no restaurar y decirlo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import ImportarPreciosPage from "@/app/(dashboard)/inventario/importar-precios/page"

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), back: vi.fn() }),
  usePathname: () => "/inventario/importar-precios",
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } },
    status: "authenticated",
  }),
}))

const KEY = "draft:v3:importar-precios:org-1:user-1:new"

const SHEETS = [
  {
    name: "Hoja1",
    totalRows: 3,
    rows: [
      ["Lista de precios", "", "", ""],
      ["Codigo", "Nombre", "Costo", "Venta"],
      ["A1", "Producto A", "10", "20"],
    ],
  },
  {
    name: "Lista",
    totalRows: 2,
    rows: [
      ["SKU", "Desc", "P.Compra", "P.Venta"],
      ["B1", "Producto B", "1", "2"],
    ],
  },
]

function seedDraft(data: Record<string, unknown>) {
  window.localStorage.setItem(
    KEY,
    JSON.stringify({ version: 3, savedAt: Date.now(), data }),
  )
}

function draftDelAsistente(overrides: Record<string, unknown> = {}) {
  return {
    selectedSheet: "Lista",
    headerRow: 0,
    mapping: { codigo: 0, precioVenta: 3 },
    onlyIncrease: true,
    motivo: "Lista mayo del proveedor",
    teniaExclusiones: false,
    ...overrides,
  }
}

function renderPage() {
  return render(
    <ModalProvider>
      <ImportarPreciosPage />
    </ModalProvider>,
  )
}

/** Sube una planilla por el input de archivo del primer paso. */
async function subirArchivo() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(["contenido"], "precios.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  })
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } })
  })
  // FileReader + POST /parse: dos saltos async antes de que aparezca el paso 2.
  await screen.findByText("Hoja y fila de encabezados")
}

describe("ImportarPreciosPage — borrador local", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.localStorage.clear()
    pushMock.mockClear()
    fetchMock = vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes("/precios/parse")) {
        return Promise.resolve({ ok: true, json: async () => ({ sheets: SHEETS }) } as Response)
      }
      if (href.includes("/precios/preview")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            summary: { totalRows: 1, matched: 1, sinCambios: 0, unmatched: 0, errors: 0 },
            updates: [
              {
                id: "inv-1",
                codigo: "B1",
                nombre: "Producto B",
                precioCompraActual: 1,
                precioVentaActual: 2,
                precioCompraNuevo: 1,
                precioVentaNuevo: 3,
                cambia: true,
              },
            ],
            unmatched: [],
            errors: [],
          }),
        } as Response)
      }
      if (href.includes("/precios/execute")) {
        return Promise.resolve({ ok: true, json: async () => ({ updated: 1 }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("restaura el asistente en el primer paso y avisa que hay que volver a subir el archivo", async () => {
    seedDraft(draftDelAsistente())

    renderPage()

    expect(await screen.findByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    // Sin archivo no hay nada que mostrar mas alla del paso 1.
    expect(screen.getByText("Subir archivo Excel")).toBeInTheDocument()
    expect(screen.getByText(/el archivo no se guarda en el borrador/i)).toBeInTheDocument()
  })

  it("conserva la hoja, la fila de encabezados y el mapeo al volver a subir el archivo", async () => {
    // El auto-detect de columnas sobre esta planilla mapearia tambien
    // `precioCompra` (la columna "P.Compra"). El borrador NO la tenia mapeada,
    // asi que si vuelve mapeada es porque el auto-detect piso lo restaurado.
    seedDraft(draftDelAsistente())

    renderPage()
    await screen.findByText(/se restauró un borrador no guardado/i)
    await subirArchivo()

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.click(await screen.findByRole("button", { name: /ver cambios/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inventario/precios/preview",
        expect.anything(),
      ),
    )
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/precios/preview"),
    )!
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.sheet).toBe("Lista")
    expect(body.headerRow).toBe(0)
    expect(body.mapping).toEqual({ codigo: 0, precioVenta: 3 })
    expect(body.options.onlyIncreasePrices).toBe(true)
  })

  it("usa el auto-detect cuando el mapeo restaurado no entra en la planilla nueva", async () => {
    // Otra planilla, menos columnas: los indices guardados apuntan a columnas
    // que ya no existen. Restaurarlos manda a la API un mapeo que no significa
    // nada; ahi el auto-detect es la respuesta correcta.
    seedDraft(draftDelAsistente({ mapping: { codigo: 0, precioVenta: 9 } }))

    renderPage()
    await screen.findByText(/se restauró un borrador no guardado/i)
    await subirArchivo()

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.click(await screen.findByRole("button", { name: /ver cambios/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inventario/precios/preview",
        expect.anything(),
      ),
    )
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/precios/preview"),
    )!
    const body = JSON.parse((call[1] as RequestInit).body as string)
    expect(body.mapping).toEqual({ codigo: 0, nombre: undefined, precioCompra: 2, precioVenta: 3 })
  })

  it("vuelve a la hoja por defecto cuando la guardada no esta en la planilla nueva", async () => {
    seedDraft(draftDelAsistente({ selectedSheet: "Una hoja que no existe" }))

    renderPage()
    await screen.findByText(/se restauró un borrador no guardado/i)
    await subirArchivo()

    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.click(await screen.findByRole("button", { name: /ver cambios/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inventario/precios/preview",
        expect.anything(),
      ),
    )
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/precios/preview"),
    )!
    expect(JSON.parse((call[1] as RequestInit).body as string).sheet).toBe("Hoja1")
  })

  it("avisa que las filas desmarcadas de la vista previa no vuelven", async () => {
    seedDraft(draftDelAsistente({ teniaExclusiones: true }))

    renderPage()

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByText(/filas que .*desmarcaste|desmarcadas/i)).toBeInTheDocument()
  })

  it("no dice nada de exclusiones cuando no habia ninguna", async () => {
    seedDraft(draftDelAsistente())

    renderPage()

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.queryByText(/desmarcaste|desmarcadas/i)).not.toBeInTheDocument()
  })

  it("borra el borrador cuando los precios se aplican", async () => {
    seedDraft(draftDelAsistente())

    renderPage()
    await screen.findByText(/se restauró un borrador no guardado/i)
    await subirArchivo()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.click(await screen.findByRole("button", { name: /ver cambios/i }))
    fireEvent.click(await screen.findByRole("button", { name: /aplicar 1 cambio/i }))

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/inventario"))
    expect(window.localStorage.getItem(KEY)).toBeNull()
  })

  it("conserva el borrador cuando aplicar falla", async () => {
    seedDraft(draftDelAsistente())
    fetchMock.mockImplementation((url: unknown) => {
      const href = String(url)
      if (href.includes("/precios/parse")) {
        return Promise.resolve({ ok: true, json: async () => ({ sheets: SHEETS }) } as Response)
      }
      if (href.includes("/precios/preview")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            summary: { totalRows: 1, matched: 1, sinCambios: 0, unmatched: 0, errors: 0 },
            updates: [
              {
                id: "inv-1",
                codigo: "B1",
                nombre: "Producto B",
                precioCompraActual: 1,
                precioVentaActual: 2,
                precioCompraNuevo: 1,
                precioVentaNuevo: 3,
                cambia: true,
              },
            ],
            unmatched: [],
            errors: [],
          }),
        } as Response)
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: "Se cayo el server" }),
      } as Response)
    })

    renderPage()
    await screen.findByText(/se restauró un borrador no guardado/i)
    await subirArchivo()
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))
    fireEvent.click(await screen.findByRole("button", { name: /ver cambios/i }))
    fireEvent.click(await screen.findByRole("button", { name: /aplicar 1 cambio/i }))

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/inventario/precios/execute",
        expect.anything(),
      ),
    )
    expect(pushMock).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
  })
})

describe("ImportarPreciosPage — lo que nunca se persiste", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown) => {
        const href = String(url)
        if (href.includes("/precios/parse")) {
          return Promise.resolve({ ok: true, json: async () => ({ sheets: SHEETS }) } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as unknown as Response)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("nunca escribe el archivo ni su base64", async () => {
    renderPage()
    await subirArchivo()

    // La fila de encabezados real de esta planilla es la 2: la 1 es el titulo
    // del proveedor. Elegirla y seguir es exactamente el trabajo que hay que no
    // perder.
    fireEvent.click(screen.getByText("Codigo").closest("tr")!)
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }))

    await waitFor(
      () => expect(window.localStorage.getItem(KEY)).not.toBeNull(),
      { timeout: 5000 },
    )
    const raw = window.localStorage.getItem(KEY)!
    const data = JSON.parse(raw).data
    expect(data).not.toHaveProperty("fileBase64")
    expect(data).not.toHaveProperty("file")
    expect(data).not.toHaveProperty("sheets")
    expect(data).not.toHaveProperty("preview")
    expect(data).not.toHaveProperty("excludedIds")
    expect(raw).not.toContain("precios.xlsx")
    // Lo que si se guarda: la decision que costo tomar.
    expect(data.selectedSheet).toBe("Hoja1")
    expect(data.headerRow).toBe(1)
  })
})
