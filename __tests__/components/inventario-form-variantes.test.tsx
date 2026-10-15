/**
 * Product form wiring of the variants section (dark: only `permiteVariantes` shows it).
 * Every request is recorded; the group endpoint is a small in-memory fake.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

const { confirmMock, showErrorMock, showWarningMock } = vi.hoisted(() => ({
  confirmMock: vi.fn(),
  showErrorMock: vi.fn(),
  showWarningMock: vi.fn(),
}))

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({
    confirm: confirmMock,
    alert: vi.fn().mockResolvedValue(undefined),
    showSuccess: vi.fn().mockResolvedValue(undefined),
    showError: showErrorMock,
    showWarning: showWarningMock,
    showInfo: vi.fn().mockResolvedValue(undefined),
  }),
}))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } }, status: "authenticated" }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

vi.mock("@/lib/image-compression", () => ({ compressImage: async (file: File) => file }))

// The real component needs the modal provider and its own requests; here only "an adjustment happened" matters.
vi.mock("@/components/inventario/quick-stock-adjust", () => ({
  QuickStockAdjust: ({ onAdjusted }: { onAdjusted: () => void }) => (
    <button type="button" onClick={onAdjusted}>
      Ajustar stock
    </button>
  ),
}))

const KEY_ALTA = "draft:v3:inventario-form:org-1:user-1:new"

interface Llamada {
  url: string
  method: string
  body: any
}

function seedDraft(values: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    KEY_ALTA,
    JSON.stringify({
      version: 3,
      savedAt: Date.now(),
      data: {
        values: { nombre: "Funda X", categoria: "Baterías", tipoDispositivo: "CELULAR", stock: 0, precioVenta: 1000, proveedorId: null, ubicacion: null, barcode: null, ...values },
        ui: { showStockConfig: false, showNewTipo: false, newTipo: "", showNewCategoria: false, newCategoria: "", imagenPendiente: false },
      },
    })
  )
}

const hijo = (id: string, valor: string, over: Record<string, unknown> = {}) => ({
  id,
  codigo: `FX-${valor.toUpperCase()}`,
  nombre: `Funda X - ${valor}`,
  categoria: "Baterías",
  tipoDispositivo: "CELULAR",
  stock: 3,
  stockReservado: 0,
  precioCompra: 400,
  precioVenta: 1000,
  barcode: null,
  grupoId: "g1",
  atributos: [{ opcion: "Color", valor }],
  imagenUrl: null,
  ...over,
})

const grupoGet = (over: { variantes?: any[]; archivadas?: any[] } = {}) => ({
  grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
  variantes: over.variantes ?? [hijo("r1", "Rojo"), hijo("a1", "Azul")],
  archivadas: over.archivadas ?? [],
})

const itemAgrupado = (over: Partial<Inventario> = {}) =>
  ({ ...hijo("r1", "Rojo"), grupoId: "g1", esKit: false, ...over }) as unknown as Inventario

const itemSuelto = (over: Partial<Inventario> = {}) =>
  ({ id: "s1", codigo: "CEL-0001", nombre: "Funda suelta", categoria: "Baterías", tipoDispositivo: "CELULAR", stock: 5, stockReservado: 0, precioCompra: 80, precioVenta: 200, ...over }) as unknown as Inventario

describe("InventarioForm: sección de variantes", () => {
  let llamadas: Llamada[]
  let depositos: unknown[]
  let respuestaPut: (n: number, call: Llamada) => { status: number; body: unknown }
  let respuestaGet: () => { status: number; body: unknown }
  let falla: (url: string, method: string) => boolean
  let putCount: number
  const onSuccess = vi.fn()
  const onClose = vi.fn()

  const json = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response)
  const puts = () => llamadas.filter((l) => l.method === "PUT" && l.url.startsWith("/api/inventario/grupos/"))
  const posts = () => llamadas.filter((l) => l.method === "POST" && l.url.endsWith("/imagen"))
  const gets = () => llamadas.filter((l) => l.method === "GET" && l.url.startsWith("/api/inventario/grupos/"))

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    llamadas = []
    putCount = 0
    depositos = [{ id: "dep-1", nombre: "Casa Central", principal: true, activo: true }]
    respuestaPut = () => ({ status: 200, body: { guardado: true, relectura: false, grupoId: "x" } })
    respuestaGet = () => ({ status: 200, body: grupoGet() })
    falla = () => false
    confirmMock.mockResolvedValue(true)
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() }))
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        const href = String(url)
        const method = init?.method ?? "GET"
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
        const llamada = { url: href, method, body }
        llamadas.push(llamada)
        if (href.includes("/api/depositos")) return json(200, { data: depositos })
        if (href.includes("/api/inventario/next-code")) return json(200, { codigo: "CEL-0009" })
        if (href.startsWith("/api/inventario/grupos/") && method === "GET") {
          const r = respuestaGet()
          return json(r.status, r.body)
        }
        if (href.startsWith("/api/inventario/grupos/") && method === "PUT") {
          const r = respuestaPut(++putCount, llamada)
          return json(r.status, r.body)
        }
        if (href.startsWith("/api/inventario/grupos/") && method === "DELETE") {
          const r = falla(href, method) ? { status: 404, body: { error: "Grupo no encontrado" } } : { status: 200, body: { success: true } }
          return json(r.status, r.body)
        }
        if (href.endsWith("/imagen")) return falla(href, method) ? json(500, { error: "Falló" }) : json(200, {})
        if (href.includes("/api/inventario/check-duplicate")) return json(200, { matches: [] })
        if (href.includes("/depositos")) return json(200, { data: [] })
        return json(200, [])
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderForm(props: Partial<React.ComponentProps<typeof InventarioForm>> = {}) {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InventarioForm onClose={onClose} onSuccess={onSuccess} {...props} />
      </SWRConfig>
    )
  }

  const interruptor = () => screen.findByRole("switch", { name: /este producto tiene variantes/i })
  const guardar = () => screen.getByRole("button", { name: "Guardar" })

  async function nuevoConColor(valores = ["Rojo", "Azul"], props: Partial<React.ComponentProps<typeof InventarioForm>> = {}) {
    seedDraft()
    renderForm({ permiteVariantes: true, ...props })
    await screen.findByText(/se restauró un borrador no guardado/i)
    fireEvent.click(await interruptor())
    const nombreOpcion = await screen.findByLabelText("Nombre de la nueva opción")
    fireEvent.change(nombreOpcion, { target: { value: "Color" } })
    fireEvent.keyDown(nombreOpcion, { key: "Enter" })
    const campo = await screen.findByLabelText("Agregar valor a Color")
    for (const v of valores) {
      fireEvent.change(campo, { target: { value: v } })
      fireEvent.keyDown(campo, { key: "Enter" })
    }
    await waitFor(() => expect(guardar()).not.toBeDisabled())
  }

  const idsDeFotos = () =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="foto-input-"]'))
      .map((el) => el.getAttribute("data-testid")!.replace("foto-input-", ""))
      .slice(0, 2)

  /** The row fields keep a draft and commit when the field loses focus. */
  const escribir = (el: HTMLElement, valor: string) => {
    fireEvent.change(el, { target: { value: valor } })
    fireEvent.blur(el)
  }

  /** The group as the server reads it after the save that went to the last PUT's URL. */
  const grupoGuardado = (variantes: any[]) => {
    const id = puts().at(-1)!.url.split("/").pop()
    const base = grupoGet({ variantes })
    return { ...base, grupo: { ...base.grupo, id } }
  }

  const elegirFoto = (id: string) => {
    const input = document.querySelector<HTMLInputElement>(`[data-testid="foto-input-${id}"]`)!
    const archivo = new File(["x"], `${id}.png`, { type: "image/png" })
    fireEvent.change(input, { target: { files: [archivo] } })
  }

  // ---- 9.1 gate -----------------------------------------------------------------------------

  describe("el gate (permiteVariantes)", () => {
    it("sin la prop no hay sección ni la casilla vieja", async () => {
      renderForm({ item: itemSuelto() })
      await screen.findByLabelText("Nombre *")
      expect(screen.queryByRole("switch", { name: /variantes/i })).not.toBeInTheDocument()
      expect(screen.queryByText("Variantes")).not.toBeInTheDocument()
      fireEvent.click(screen.getByText("Tracking avanzado"))
      expect(screen.getByText("Trackear lotes / vencimientos")).toBeInTheDocument()
      expect(screen.queryByText("Tiene variantes")).not.toBeInTheDocument()
    })

    it("con la prop la sección existe y la casilla vieja sigue sin existir", async () => {
      renderForm({ item: itemSuelto(), permiteVariantes: true })
      expect(await interruptor()).toBeInTheDocument()
      fireEvent.click(screen.getByText("Tracking avanzado"))
      expect(screen.queryByText("Tiene variantes")).not.toBeInTheDocument()
    })

    it("el PUT de un producto común ya no lleva tieneVariantes", async () => {
      renderForm({ item: itemSuelto({ tieneVariantes: true } as Partial<Inventario>) })
      await screen.findByLabelText("Nombre *")
      fireEvent.click(guardar())
      await waitFor(() => expect(llamadas.some((l) => l.method === "PUT" && l.url === "/api/inventario/s1")).toBe(true))
      expect(llamadas.find((l) => l.url === "/api/inventario/s1")!.body).not.toHaveProperty("tieneVariantes")
    })

    it("con variantes prendidas el kit queda bloqueado", async () => {
      renderForm({ item: itemSuelto(), permiteVariantes: true })
      fireEvent.click(await interruptor())
      fireEvent.click(screen.getByText("Tracking avanzado"))
      expect(screen.getByRole("checkbox", { name: /es kit/i })).toBeDisabled()
    })

    it("un kit no puede prender las variantes", async () => {
      renderForm({ item: itemSuelto({ esKit: true, tipoKit: "ENSAMBLADO" } as Partial<Inventario>), permiteVariantes: true })
      expect(await interruptor()).toBeDisabled()
      expect(screen.getByText(/un kit no puede tener variantes/i)).toBeInTheDocument()
    })
  })

  // ---- 9.2 toggle ---------------------------------------------------------------------------

  describe("modo variantes", () => {
    it("el stock pasa a ser el total de solo lectura y se esconden los campos de un producto único", async () => {
      await nuevoConColor()
      const stock = screen.getByLabelText("Stock total") as HTMLInputElement
      expect(stock).toHaveAttribute("readonly")
      expect(stock.value).toBe("0")
      escribir(screen.getAllByLabelText("Stock inicial de Rojo")[0], "5")
      escribir(screen.getAllByLabelText("Stock inicial de Azul")[0], "2")
      await waitFor(() => expect((screen.getByLabelText("Stock total") as HTMLInputElement).value).toBe("7"))
      expect(screen.getByLabelText("Precio base")).toBeInTheDocument()
      expect(screen.getByLabelText("Costo base")).toBeInTheDocument()
      expect(screen.queryByLabelText("Código de Barras")).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Ubicación en depósito/)).not.toBeInTheDocument()
      expect(screen.queryByText("Configuración de stock")).not.toBeInTheDocument()
      expect(screen.queryByText("Imagen")).not.toBeInTheDocument()
    })

    it("apagado vuelve todo a la normalidad", async () => {
      await nuevoConColor()
      fireEvent.click(await interruptor())
      expect(screen.getByLabelText("Stock *")).toBeInTheDocument()
      expect(screen.getByLabelText("Código de Barras")).toBeInTheDocument()
      expect(screen.getByLabelText("Precio Venta *")).toBeInTheDocument()
    })

    it("cambiar el precio base reprecia las filas sin tocar", async () => {
      await nuevoConColor()
      fireEvent.change(screen.getByLabelText("Precio base"), { target: { value: "1500" } })
      await waitFor(() => expect((screen.getAllByLabelText("Precio de Rojo")[0] as HTMLInputElement).value).toMatch(/1\.?500/))
    })
  })

  // ---- 9.3 submit order ---------------------------------------------------------------------

  describe("guardar un grupo nuevo", () => {
    it("PUT primero, después una foto por variante con los ids del cliente", async () => {
      await nuevoConColor()
      const [rojo, azul] = idsDeFotos()
      elegirFoto(rojo)
      elegirFoto(azul)
      await waitFor(() => expect(screen.getAllByText("Sin guardar").length).toBeGreaterThan(0))
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())

      const orden = llamadas.filter((l) => l.method !== "GET" && !l.url.includes("/depositos")).map((l) => `${l.method} ${l.url}`)
      expect(orden[0]).toMatch(/^PUT \/api\/inventario\/grupos\/c[0-9a-f]{24}$/)
      expect(orden.slice(1).sort()).toEqual([`POST /api/inventario/${rojo}/imagen`, `POST /api/inventario/${azul}/imagen`].sort())
      const cuerpo = puts()[0].body
      expect(cuerpo.variantes.map((v: any) => v.id).sort()).toEqual([rojo, azul].sort())
      expect(cuerpo.grupo.nombre).toBe("Funda X")
      expect(cuerpo.variantes[0]).toMatchObject({ codigo: expect.stringMatching(/^CEL-0009-/), precioVenta: 1000 })
      expect(gets()).toHaveLength(0)
    })

    it("sin fotos no hay ningún POST de imagen", async () => {
      await nuevoConColor()
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(posts()).toHaveLength(0)
    })

    it("no deja guardar mientras falte algo y lo dice", async () => {
      seedDraft()
      renderForm({ permiteVariantes: true })
      await screen.findByText(/se restauró un borrador no guardado/i)
      fireEvent.click(await interruptor())
      await waitFor(() => expect(guardar()).toBeDisabled())
      expect(screen.getByText(/para guardar, falta/i)).toBeInTheDocument()
    })

    it("la foto del producto pasa a la primera variante", async () => {
      await nuevoConColor()
      const [rojo] = idsDeFotos()
      fireEvent.click(await interruptor())
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
      fireEvent.change(input, { target: { files: [new File(["x"], "p.png", { type: "image/png" })] } })
      await waitFor(() => expect(screen.getByAltText("Preview")).toBeInTheDocument())
      fireEvent.click(await interruptor())
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(posts().map((p) => p.url)).toEqual([`/api/inventario/${rojo}/imagen`])
    })
  })

  // ---- 9.4 partial failure and retries ------------------------------------------------------

  describe("fallos al guardar", () => {
    it("si falla una foto el formulario sigue abierto, relee el grupo y avisa", async () => {
      await nuevoConColor()
      const [rojo, azul] = idsDeFotos()
      elegirFoto(rojo)
      elegirFoto(azul)
      falla = (url) => url.includes(`/${azul}/imagen`)
      respuestaGet = () => ({ status: 200, body: grupoGuardado([hijo(rojo, "Rojo"), hijo(azul, "Azul")]) })
      fireEvent.click(guardar())
      await waitFor(() => expect(showWarningMock).toHaveBeenCalled())
      expect(showWarningMock.mock.calls[0][0]).toContain("Se guardó el producto. No se pudo subir 1 foto.")
      expect(onSuccess).not.toHaveBeenCalled()
      expect(gets().length).toBeGreaterThan(0)
      expect(puts()).toHaveLength(1)

      // Reintentar sends only that photo: no second PUT.
      const antes = posts().length
      falla = () => false
      fireEvent.click((await screen.findAllByRole("button", { name: /reintentar/i }))[0])
      await waitFor(() => expect(posts().length).toBe(antes + 1))
      expect(posts().at(-1)!.url).toBe(`/api/inventario/${azul}/imagen`)
      expect(puts()).toHaveLength(1)
    })

    it("Guardar de nuevo manda el mismo grupo y las mismas filas, y solo sube lo que falta", async () => {
      await nuevoConColor()
      const [rojo, azul] = idsDeFotos()
      elegirFoto(rojo)
      elegirFoto(azul)
      falla = (url) => url.includes(`/${azul}/imagen`)
      respuestaGet = () => ({ status: 200, body: grupoGuardado([hijo(rojo, "Rojo", { imagenUrl: "https://x/r.png" }), hijo(azul, "Azul")]) })
      fireEvent.click(guardar())
      await waitFor(() => expect(showWarningMock).toHaveBeenCalled())
      const grupoUrl = puts()[0].url

      falla = () => false
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(puts()).toHaveLength(2)
      expect(puts()[1].url).toBe(grupoUrl)
      expect(puts()[1].body.variantes.map((v: any) => v.id).sort()).toEqual([rojo, azul].sort())
      expect(posts().filter((p) => p.url.includes(`/${rojo}/`))).toHaveLength(1)
      expect(posts().filter((p) => p.url.includes(`/${azul}/`))).toHaveLength(2)
    })

    it("promover, fallar una foto y Guardar de nuevo: un solo PUT más, sin volver a abrir el diálogo", async () => {
      renderForm({ item: itemSuelto(), permiteVariantes: true })
      fireEvent.click(await interruptor())
      const nombreOpcion = await screen.findByLabelText("Nombre de la nueva opción")
      fireEvent.change(nombreOpcion, { target: { value: "Color" } })
      fireEvent.keyDown(nombreOpcion, { key: "Enter" })
      const campo = await screen.findByLabelText("Agregar valor a Color")
      for (const v of ["Rojo", "Azul"]) {
        fireEvent.change(campo, { target: { value: v } })
        fireEvent.keyDown(campo, { key: "Enter" })
      }
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      const [, azul] = idsDeFotos()
      elegirFoto(azul)
      falla = (url) => url.includes(`/${azul}/imagen`)
      respuestaGet = () => ({ status: 200, body: grupoGuardado([hijo("s1", "Rojo"), hijo(azul, "Azul")]) })
      fireEvent.click(guardar())
      fireEvent.click(await screen.findByRole("button", { name: "Usar esta combinación" }))
      await waitFor(() => expect(showWarningMock).toHaveBeenCalled())
      expect(puts()).toHaveLength(1)
      const grupoUrl = puts()[0].url

      falla = () => false
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(screen.queryByText("¿Qué variante es este producto?")).not.toBeInTheDocument()
      expect(puts()).toHaveLength(2)
      expect(puts()[1].url).toBe(grupoUrl)
      expect(puts()[1].body.variantes.map((v: any) => v.id).sort()).toEqual(["s1", azul].sort())
    })

    it("si no se puede releer el grupo tras fallar una foto, lo dice", async () => {
      await nuevoConColor()
      const [rojo] = idsDeFotos()
      elegirFoto(rojo)
      falla = (url) => url.includes(`/${rojo}/imagen`)
      respuestaGet = () => ({ status: 500, body: { error: "x" } })
      fireEvent.click(guardar())
      await waitFor(() => expect(showErrorMock).toHaveBeenCalled())
      expect(showErrorMock.mock.calls[0][0]).toMatch(/no pudimos volver a leer/i)
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it("cerrar con fotos sin subir pide confirmación", async () => {
      await nuevoConColor()
      elegirFoto(idsDeFotos()[0])
      await waitFor(() => expect(screen.getAllByText("Sin guardar").length).toBeGreaterThan(0))
      confirmMock.mockResolvedValueOnce(false)
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
      await waitFor(() => expect(confirmMock).toHaveBeenCalled())
      expect(onClose).not.toHaveBeenCalled()
      confirmMock.mockResolvedValueOnce(true)
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
      await waitFor(() => expect(onClose).toHaveBeenCalled())
    })

    it("sin red en el PUT conserva las fotos y reusa los mismos ids", async () => {
      await nuevoConColor()
      const [rojo] = idsDeFotos()
      elegirFoto(rojo)
      respuestaPut = (n) => {
        if (n === 1) throw new Error("offline")
        return { status: 200, body: { guardado: true, relectura: false, grupoId: "x" } }
      }
      fireEvent.click(guardar())
      await waitFor(() => expect(showErrorMock).toHaveBeenCalled())
      expect(posts()).toHaveLength(0)
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(puts()).toHaveLength(2)
      expect(puts()[1].body.variantes.map((v: any) => v.id)).toEqual(puts()[0].body.variantes.map((v: any) => v.id))
      expect(posts().map((p) => p.url)).toEqual([`/api/inventario/${rojo}/imagen`])
    })

    it("un código duplicado de los generados toma el siguiente sufijo y reintenta una sola vez", async () => {
      await nuevoConColor()
      respuestaPut = (n) =>
        n === 1
          ? { status: 409, body: { code: "CODIGO_DUPLICADO", error: "Ya existe", codigos: ["CEL-0009-ROJ"] } }
          : { status: 200, body: { guardado: true, relectura: false, grupoId: "x" } }
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(puts()).toHaveLength(2)
      const [a, b] = [puts()[0].body.variantes, puts()[1].body.variantes]
      expect(a.find((v: any) => v.codigo === "CEL-0009-ROJ")).toBeTruthy()
      expect(b.map((v: any) => v.codigo).sort()).toEqual(["CEL-0009-AZU", "CEL-0009-ROJ-2"])
    })

    it("si el segundo intento también choca no sigue reintentando", async () => {
      await nuevoConColor()
      respuestaPut = () => ({ status: 409, body: { code: "CODIGO_DUPLICADO", error: "Ya existe otro producto con el código X", codigos: ["CEL-0009-ROJ", "CEL-0009-ROJ-2"] } })
      fireEvent.click(guardar())
      await waitFor(() => expect(showErrorMock).toHaveBeenCalled())
      expect(puts()).toHaveLength(2)
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it("un código escrito por la persona que choca no se reintenta solo", async () => {
      await nuevoConColor()
      escribir(screen.getAllByLabelText("Código de Rojo")[0], "MIO")
      respuestaPut = () => ({ status: 409, body: { code: "CODIGO_DUPLICADO", error: "Ya existe otro producto con el código MIO", codigos: ["MIO"] } })
      fireEvent.click(guardar())
      await waitFor(() => expect(showErrorMock).toHaveBeenCalled())
      expect(puts()).toHaveLength(1)
    })

    it("si falta una variante en el guardado (409) recarga el grupo y no reenvía", async () => {
      await nuevoConColor()
      respuestaPut = () => ({ status: 409, body: { code: "MIEMBROS_FALTANTES", error: "El producto cambió mientras lo editabas. Recargá la pantalla y volvé a intentar", recargar: true } })
      fireEvent.click(guardar())
      await waitFor(() => expect(gets().length).toBeGreaterThan(0))
      expect(puts()).toHaveLength(1)
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it("un 200 sin relectura nunca vuelve a mandar el guardado", async () => {
      await nuevoConColor()
      respuestaGet = () => ({ status: 500, body: { error: "x" } })
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(puts()).toHaveLength(1)
    })

    it("un 503 de migración pendiente apaga el interruptor con el motivo", async () => {
      await nuevoConColor()
      respuestaPut = () => ({ status: 503, body: { code: "MIGRACION_PENDIENTE", error: "Variantes todavía no está disponible" } })
      fireEvent.click(guardar())
      await waitFor(() => expect(screen.getByText("Variantes todavía no está disponible")).toBeInTheDocument())
      expect(await interruptor()).toBeDisabled()
    })
  })

  // ---- 9.5 cost -----------------------------------------------------------------------------

  describe("costo", () => {
    it("un rol con costo manda precioCompra en las filas nuevas", async () => {
      await nuevoConColor()
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))
      expect(puts()[0].body.variantes.every((v: any) => v.precioCompra === 0)).toBe(true)
    })

    it("un rol sin costo no manda ningún precioCompra, ni siquiera editando el precio", async () => {
      const sinCosto = grupoGet({ variantes: [hijo("r1", "Rojo", { precioCompra: undefined }), hijo("a1", "Azul", { precioCompra: undefined })] })
      respuestaGet = () => ({ status: 200, body: sinCosto })
      renderForm({ item: itemAgrupado({ precioCompra: null } as Partial<Inventario>), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      escribir(screen.getAllByLabelText("Precio de Rojo")[0], "1500")
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))
      expect(JSON.stringify(puts()[0].body)).not.toContain("precioCompra")
      expect(puts()[0].body.variantes.find((v: any) => v.id === "r1")).toMatchObject({ precioVenta: 1500 })
    })
  })

  // ---- 9.6 promotion, gating, hydration -----------------------------------------------------

  describe("promoción, bloqueos e hidratación", () => {
    it("promover un producto con stock abre el diálogo antes del PUT y manda su id", async () => {
      renderForm({ item: itemSuelto(), permiteVariantes: true })
      fireEvent.click(await interruptor())
      const nombreOpcion = await screen.findByLabelText("Nombre de la nueva opción")
      fireEvent.change(nombreOpcion, { target: { value: "Color" } })
      fireEvent.keyDown(nombreOpcion, { key: "Enter" })
      const campo = await screen.findByLabelText("Agregar valor a Color")
      for (const v of ["Rojo", "Azul"]) {
        fireEvent.change(campo, { target: { value: v } })
        fireEvent.keyDown(campo, { key: "Enter" })
      }
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      expect(await screen.findByText("¿Qué variante es este producto?")).toBeInTheDocument()
      expect(puts()).toHaveLength(0)
      fireEvent.click(screen.getByRole("button", { name: "Usar esta combinación" }))
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(puts()).toHaveLength(1)
      const promovida = puts()[0].body.variantes.find((v: any) => v.id === "s1")
      expect(promovida).toMatchObject({ codigo: "CEL-0001", precioVenta: 200 })
      expect(promovida).not.toHaveProperty("stockInicial")
    })

    it("cancelar el diálogo no guarda nada", async () => {
      renderForm({ item: itemSuelto(), permiteVariantes: true })
      fireEvent.click(await interruptor())
      const nombreOpcion = await screen.findByLabelText("Nombre de la nueva opción")
      fireEvent.change(nombreOpcion, { target: { value: "Color" } })
      fireEvent.keyDown(nombreOpcion, { key: "Enter" })
      const campo = await screen.findByLabelText("Agregar valor a Color")
      fireEvent.change(campo, { target: { value: "Rojo" } })
      fireEvent.keyDown(campo, { key: "Enter" })
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await screen.findByText("¿Qué variante es este producto?")
      const dialogo = screen.getByRole("dialog")
      fireEvent.click(Array.from(dialogo.querySelectorAll("button")).find((b) => b.textContent === "Cancelar")!)
      await waitFor(() => expect(screen.queryByText("¿Qué variante es este producto?")).not.toBeInTheDocument())
      expect(puts()).toHaveLength(0)
    })

    it("abrir una variante hidrata el grupo: el nombre es el del producto y el código base viene de la variante", async () => {
      respuestaGet = () => ({ status: 200, body: { ...grupoGet(), grupo: { ...grupoGet().grupo, nombre: "Funda X (base)" } } })
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      await waitFor(() => expect((screen.getByLabelText("Nombre *") as HTMLInputElement).value).toBe("Funda X (base)"))
      expect(gets()[0].url).toBe("/api/inventario/grupos/g1")
      expect(screen.getAllByLabelText("Precio de Azul").length).toBeGreaterThan(0)
    })

    it("sin cambios, guardar un grupo existente manda cada fila solo con id y combinación", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))
      for (const v of puts()[0].body.variantes) expect(Object.keys(v).sort()).toEqual(["atributos", "id"])
      expect(puts()[0].body).not.toHaveProperty("compartidos")
    })

    it("una variante con unidades reservadas que se archiva bloquea Guardar y dice por qué", async () => {
      respuestaGet = () => ({ status: 200, body: grupoGet({ variantes: [hijo("r1", "Rojo"), hijo("a1", "Azul", { stockReservado: 2 })] }) })
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Azul")
      fireEvent.click(await screen.findByRole("button", { name: "Quitar Azul de Color" }))
      await waitFor(() => expect(guardar()).toBeDisabled())
      expect(screen.getAllByText(/tiene 2 unidades reservadas/i).length).toBeGreaterThan(0)
    })

    it("archivar una variante con stock pide confirmar antes de guardar", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Azul")
      fireEvent.click(await screen.findByRole("button", { name: "Quitar Azul de Color" }))
      confirmMock.mockResolvedValueOnce(false)
      fireEvent.click(guardar())
      await waitFor(() => expect(confirmMock).toHaveBeenCalled())
      expect(puts()).toHaveLength(0)
      confirmMock.mockResolvedValueOnce(true)
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))
      expect(puts()[0].body.archivar).toEqual(["a1"])
    })

    it("el depósito aparece con 2 depósitos y una fila nueva con stock, y viaja en el PUT", async () => {
      depositos = [
        { id: "dep-1", nombre: "Casa Central", principal: true, activo: true },
        { id: "dep-2", nombre: "Taller", principal: false, activo: true },
      ]
      await nuevoConColor()
      expect(screen.queryByRole("combobox", { name: /dep[oó]sito del stock inicial/i })).not.toBeInTheDocument()
      escribir(screen.getAllByLabelText("Stock inicial de Rojo")[0], "4")
      const select = await screen.findByRole("combobox", { name: /dep[oó]sito del stock inicial/i })
      expect(select).toHaveTextContent("Casa Central")
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))
      expect(puts()[0].body.depositoId).toBe("dep-1")
    })

    it("con un solo depósito no hay selector ni depositoId", async () => {
      await nuevoConColor()
      escribir(screen.getAllByLabelText("Stock inicial de Rojo")[0], "4")
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))
      expect(puts()[0].body).not.toHaveProperty("depositoId")
    })

    it("si el grupo responde 503 el interruptor queda apagado con el motivo", async () => {
      respuestaGet = () => ({ status: 503, body: { code: "MIGRACION_PENDIENTE", error: "Variantes todavía no está disponible" } })
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await waitFor(() => expect(screen.getByText("Variantes todavía no está disponible")).toBeInTheDocument())
      expect(await interruptor()).toBeDisabled()
    })

    it("tras ajustar el stock de una fila guardada relee el grupo y muestra el número nuevo", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByRole("button", { name: "Ajustar stock" })
      expect((screen.getByLabelText("Stock total") as HTMLInputElement).value).toBe("6")
      respuestaGet = () => ({ status: 200, body: grupoGet({ variantes: [hijo("r1", "Rojo", { stock: 11 }), hijo("a1", "Azul")] }) })
      const antes = gets().length
      fireEvent.click(screen.getAllByRole("button", { name: "Ajustar stock" })[0])
      await waitFor(() => expect(gets().length).toBe(antes + 1))
      await waitFor(() => expect((screen.getByLabelText("Stock total") as HTMLInputElement).value).toBe("14"))
    })
  })

  // ---- ungroup and duplicates ---------------------------------------------------------------

  describe("desagrupar y duplicados", () => {
    it("con la función apagada, abrir una variante no pide depósitos (igual que antes)", async () => {
      renderForm({ item: itemAgrupado() })
      await screen.findByLabelText("Nombre *")
      await new Promise((r) => setTimeout(r, 30))
      expect(llamadas.some((l) => l.url.includes("/api/depositos"))).toBe(false)
    })

    it("apagar las variantes de un grupo guardado confirma y desagrupa sin tocar el producto", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      fireEvent.click(await interruptor())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(confirmMock).toHaveBeenCalled()
      expect(llamadas.some((l) => l.method === "DELETE" && l.url === "/api/inventario/grupos/g1")).toBe(true)
      expect(llamadas.some((l) => l.method === "PUT")).toBe(false)
    })

    it("un 404 al desagrupar es que ya estaba desagrupado: se toma como éxito", async () => {
      falla = (_u, m) => m === "DELETE"
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      fireEvent.click(await interruptor())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(showErrorMock).not.toHaveBeenCalled()
    })

    it("al editar una variante, check-duplicate excluye el item y su grupo", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      fireEvent.blur(screen.getByLabelText("Nombre *"))
      await waitFor(() => expect(llamadas.some((l) => l.url.includes("/check-duplicate"))).toBe(true))
      const url = new URL(llamadas.find((l) => l.url.includes("/check-duplicate"))!.url, "http://x")
      expect(url.searchParams.get("excludeId")).toBe("r1")
      expect(url.searchParams.get("excludeGrupoId")).toBe("g1")
    })
  })

  // ---- 9.7 draft isolation ------------------------------------------------------------------

  describe("borrador con variantes (el detalle está en inventario-form-variantes-draft)", () => {
    it("el borrador guardado no lleva costo, blob: ni data:image", async () => {
      await nuevoConColor()
      elegirFoto(idsDeFotos()[0])
      fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Funda editada" } })
      await waitFor(() => {
        const guardado = window.localStorage.getItem(KEY_ALTA) ?? ""
        expect(guardado).toContain("Funda editada")
      }, { timeout: 4000 })
      const texto = window.localStorage.getItem(KEY_ALTA)!
      expect(texto).not.toContain("precioCompra")
      expect(texto).not.toContain("blob:")
      expect(texto).not.toContain("data:image")
      expect(texto).not.toContain("tieneVariantes")
    })
  })
})
