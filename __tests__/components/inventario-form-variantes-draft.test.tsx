/**
 * PR11: the local draft now carries the variants section (G4). What reaches localStorage has no purchase
 * price (rows or base), no blob:, no data:image, no File; only the ids of rows that had a photo staged. A
 * restored draft never overwrites a stored cost and never stages a photo, and tells the user so.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioForm } from "@/components/inventario/inventario-form"
import { aBorrador } from "@/lib/variantes-borrador"
import { aplicar, reductor } from "../helpers/variantes-filas"
import { estadoInicial } from "@/lib/variantes-filas"
import type { Inventario } from "@/types"

vi.mock("@/contexts/modal-context", () => ({
  useModal: () => ({
    confirm: vi.fn().mockResolvedValue(true),
    alert: vi.fn().mockResolvedValue(undefined),
    showSuccess: vi.fn().mockResolvedValue(undefined),
    showError: vi.fn().mockResolvedValue(undefined),
    showWarning: vi.fn().mockResolvedValue(undefined),
    showInfo: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } }, status: "authenticated" }),
}))
vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }], loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock("@/lib/image-compression", () => ({ compressImage: async (file: File) => file }))
vi.mock("@/components/inventario/quick-stock-adjust", () => ({ QuickStockAdjust: () => null }))

const KEY_ALTA = "draft:v3:inventario-form:org-1:user-1:new"
const KEY_R1 = "draft:v3:inventario-form:org-1:user-1:edit:r1"
const COSTO_ALMACENADO = 1000

interface Llamada {
  url: string
  method: string
  body: any
}

const hijo = (id: string, valor: string) => ({
  id,
  codigo: `FX-${valor.toUpperCase()}`,
  nombre: `Funda X - ${valor}`,
  categoria: "Baterías",
  tipoDispositivo: "CELULAR",
  stock: 3,
  stockReservado: 0,
  precioCompra: COSTO_ALMACENADO,
  precioVenta: 2000,
  barcode: null,
  grupoId: "g1",
  atributos: [{ opcion: "Color", valor }],
  imagenUrl: null,
})

const GRUPO = {
  grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
  variantes: [hijo("r1", "Rojo"), hijo("a1", "Azul")],
  archivadas: [],
}

/** A draft state for a NEW product: Color {Rojo, Azul}, a typed price on the first row, a typed cost everywhere. */
function estadoDeBorrador() {
  const inicial = estadoInicial({ grupoId: "g-del-borrador", semilla: "borrador", codigoBase: "CEL-0009", precioBase: 1000, costoBase: 777, costoCargado: true })
  const activo = aplicar(reductor(), aplicar(reductor(), inicial, { tipo: "activar" }), { tipo: "agregarOpcion", nombre: "Color", valores: ["Rojo", "Azul"] })
  return activo
}

function sembrar(clave: string, ui: Record<string, unknown>, values: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    clave,
    JSON.stringify({
      version: 3,
      savedAt: Date.now(),
      data: {
        values: { nombre: "Funda X", categoria: "Baterías", tipoDispositivo: "CELULAR", stock: 0, precioVenta: 1000, proveedorId: null, ubicacion: null, barcode: null, ...values },
        ui: { showStockConfig: false, showNewTipo: false, newTipo: "", showNewCategoria: false, newCategoria: "", imagenPendiente: false, ...ui },
      },
    })
  )
}

describe("InventarioForm: borrador de variantes", () => {
  let llamadas: Llamada[]
  const onSuccess = vi.fn()
  const json = (status: number, body: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response)
  const puts = () => llamadas.filter((l) => l.method === "PUT" && l.url.startsWith("/api/inventario/grupos/"))
  const posts = () => llamadas.filter((l) => l.method === "POST" && l.url.endsWith("/imagen"))

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    llamadas = []
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fake"), revokeObjectURL: vi.fn() }))
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        const href = String(url)
        const method = init?.method ?? "GET"
        llamadas.push({ url: href, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body })
        if (href.includes("/api/depositos")) return json(200, { data: [{ id: "dep-1", nombre: "Casa Central", principal: true, activo: true }] })
        if (href.includes("/api/inventario/next-code")) return json(200, { codigo: "CEL-0009" })
        if (href.startsWith("/api/inventario/grupos/") && method === "GET") return json(200, GRUPO)
        if (href.startsWith("/api/inventario/grupos/") && method === "PUT") return json(200, { guardado: true, relectura: false, grupoId: "x" })
        if (href.endsWith("/imagen")) return json(200, {})
        if (href.includes("/check-duplicate")) return json(200, { matches: [] })
        return json(200, [])
      })
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  function renderForm(props: Partial<React.ComponentProps<typeof InventarioForm>> = {}) {
    return render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <InventarioForm onClose={vi.fn()} onSuccess={onSuccess} permiteVariantes {...props} />
      </SWRConfig>
    )
  }
  const guardar = () => screen.getByRole("button", { name: "Guardar" })
  const escribir = (el: HTMLElement, valor: string) => {
    fireEvent.change(el, { target: { value: valor } })
    fireEvent.blur(el)
  }

  async function armarNuevo() {
    sembrar(KEY_ALTA, {})
    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)
    fireEvent.click(await screen.findByRole("switch", { name: /este producto tiene variantes/i }))
    const nombreOpcion = await screen.findByLabelText("Nombre de la nueva opción")
    fireEvent.change(nombreOpcion, { target: { value: "Color" } })
    fireEvent.keyDown(nombreOpcion, { key: "Enter" })
    const campo = await screen.findByLabelText("Agregar valor a Color")
    for (const v of ["Rojo", "Azul"]) {
      fireEvent.change(campo, { target: { value: v } })
      fireEvent.keyDown(campo, { key: "Enter" })
    }
    await waitFor(() => expect(guardar()).not.toBeDisabled())
  }

  describe("lo que se escribe", () => {
    it("lleva las variantes y la marca de fotos, sin costo, sin blob:, sin data:image", async () => {
      await armarNuevo()
      fireEvent.change(screen.getByLabelText("Costo base"), { target: { value: "8888" } })
      escribir(screen.getAllByLabelText("Precio de Rojo")[0], "1500")
      const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="foto-input-"]')).map((e) => e.getAttribute("data-testid")!.replace("foto-input-", ""))
      fireEvent.change(document.querySelector(`[data-testid="foto-input-${ids[0]}"]`)!, { target: { files: [new File(["x"], "r.png", { type: "image/png" })] } })
      fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Funda editada" } })

      await waitFor(() => expect(window.localStorage.getItem(KEY_ALTA) ?? "").toContain("fotosPendientes"), { timeout: 4000 })
      await waitFor(() => expect(JSON.parse(window.localStorage.getItem(KEY_ALTA)!).data.ui.fotosPendientes).toEqual([ids[0]]), { timeout: 4000 })

      const crudo = window.localStorage.getItem(KEY_ALTA)!
      const ui = JSON.parse(crudo).data.ui
      expect(ui.variantes.opciones[0].valores.map((v: any) => v.texto)).toEqual(["Rojo", "Azul"])
      expect(Object.values(ui.variantes.filas).some((f: any) => f.precioVenta === 1500)).toBe(true)
      expect(ui.fotosPendientes.every((id: unknown) => typeof id === "string")).toBe(true)
      for (const prohibido of ["precioCompra", "costoBase", "8888", "blob:", "data:image", "r.png", "tieneVariantes"]) expect(crudo).not.toContain(prohibido)
    })

    it("con el interruptor apagado el borrador no trae ni variantes ni marca", async () => {
      sembrar(KEY_ALTA, {})
      renderForm()
      await screen.findByText(/se restauró un borrador no guardado/i)
      fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Otro nombre" } })
      await waitFor(() => expect(window.localStorage.getItem(KEY_ALTA) ?? "").toContain("Otro nombre"), { timeout: 4000 })
      const ui = JSON.parse(window.localStorage.getItem(KEY_ALTA)!).data.ui
      expect(ui).not.toHaveProperty("variantes")
      expect(ui).not.toHaveProperty("fotosPendientes")
    })
  })

  describe("al restaurar", () => {
    it("un alta vuelve con sus opciones y filas, avisa de las fotos y no deja ninguna en cola", async () => {
      sembrar(KEY_ALTA, { variantes: aBorrador(estadoDeBorrador()), fotosPendientes: ["c1", "c2"] })
      renderForm()

      expect(await screen.findByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
      expect(screen.getByText(/Las fotos de 2 variantes no se guardan en el borrador: volvé a elegirlas\./)).toBeInTheDocument()
      expect(await screen.findAllByLabelText("Precio de Rojo")).not.toHaveLength(0)
      expect(screen.getAllByLabelText("Precio de Azul")).not.toHaveLength(0)
      await waitFor(() => expect(guardar()).not.toBeDisabled())

      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(posts()).toHaveLength(0)
      // The group keeps the id the draft carried, so a retry converges on the same group.
      expect(puts()[0].url).toBe("/api/inventario/grupos/g-del-borrador")
    })

    it("una sola foto se avisa en singular", async () => {
      sembrar(KEY_ALTA, { variantes: aBorrador(estadoDeBorrador()), fotosPendientes: ["c1"] })
      renderForm()
      expect(await screen.findByText(/La foto de 1 variante no se guarda en el borrador: volvé a elegirla\./)).toBeInTheDocument()
    })

    it("sin fotos pendientes no menciona las fotos de las variantes", async () => {
      sembrar(KEY_ALTA, { variantes: aBorrador(estadoDeBorrador()), fotosPendientes: [] })
      renderForm()
      await screen.findByText(/se restauró un borrador no guardado/i)
      expect(screen.queryByText(/fotos? de .* variantes?/i)).toBeNull()
    })

    it("sobre una variante guardada con costo 1000 el costo sigue en 1000 y el PUT no lo manda", async () => {
      const guardado = aBorrador({
        ...estadoDeBorrador(),
        grupoId: "g1",
        filas: Object.fromEntries(Object.entries(estadoDeBorrador().filas).map(([id, f]) => [id, f])),
      })
      // The draft talks about the saved rows by id: build it from the group the server returns.
      const rojo = "r1"
      const borrador = {
        ...guardado,
        orden: [rojo, "a1"],
        filas: {
          r1: { ...Object.values(guardado.filas)[0], id: "r1", existente: true, codigo: "FX-ROJO", precioVenta: 2500, precioTocado: true },
          a1: { ...Object.values(guardado.filas)[1], id: "a1", existente: true, codigo: "FX-AZUL", precioVenta: 2000 },
        },
      }
      sembrar(KEY_R1, { variantes: borrador, fotosPendientes: [] })
      renderForm({ item: { ...hijo("r1", "Rojo"), esKit: false } as unknown as Inventario })

      await screen.findByText(/se restauró un borrador no guardado/i)
      await waitFor(() => expect((screen.getAllByLabelText("Precio de Rojo")[0] as HTMLInputElement).value).toMatch(/2\.?500/))
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(puts()).toHaveLength(1))

      const cuerpo = puts()[0].body
      expect(JSON.stringify(cuerpo)).not.toContain("precioCompra")
      expect(cuerpo.variantes.find((v: any) => v.id === "r1")).toMatchObject({ precioVenta: 2500 })
    })

    it("un borrador viejo sin variantes sigue restaurándose igual", async () => {
      sembrar(KEY_ALTA, {})
      renderForm()
      expect(await screen.findByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
      expect(screen.getByLabelText("Nombre *")).toHaveValue("Funda X")
    })

    it("unas variantes con otra forma se ignoran sin tumbar el formulario", async () => {
      sembrar(KEY_ALTA, { variantes: { activo: "si", filas: 3 }, fotosPendientes: "x" })
      renderForm()
      expect(await screen.findByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
      expect(screen.getByLabelText("Nombre *")).toHaveValue("Funda X")
    })
  })

  describe("tras guardar", () => {
    it("el guardado completo borra el borrador", async () => {
      await armarNuevo()
      fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Funda guardada" } })
      await waitFor(() => expect(window.localStorage.getItem(KEY_ALTA) ?? "").toContain("Funda guardada"), { timeout: 4000 })
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(window.localStorage.getItem(KEY_ALTA)).toBeNull()
    })

    it("si falla una foto los datos ya están guardados: el borrador se borra y el formulario sigue abierto", async () => {
      await armarNuevo()
      const ids = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="foto-input-"]')).map((e) => e.getAttribute("data-testid")!.replace("foto-input-", ""))
      fireEvent.change(document.querySelector(`[data-testid="foto-input-${ids[0]}"]`)!, { target: { files: [new File(["x"], "r.png", { type: "image/png" })] } })
      ;(fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation((url: unknown, init?: RequestInit) => {
        const href = String(url)
        const method = init?.method ?? "GET"
        if (href.endsWith("/imagen")) return json(500, { error: "Falló" })
        if (href.startsWith("/api/inventario/grupos/") && method === "PUT") return json(200, { guardado: true, relectura: false, grupoId: "x" })
        if (href.startsWith("/api/inventario/grupos/")) {
          return json(200, { grupo: { id: href.split("/").pop(), nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] }, variantes: [hijo(ids[0], "Rojo"), hijo(ids[1], "Azul")].map((h) => ({ ...h, grupoId: href.split("/").pop() })), archivadas: [] })
        }
        return json(200, [])
      })
      fireEvent.click(guardar())
      await waitFor(() => expect(window.localStorage.getItem(KEY_ALTA)).toBeNull())
      expect(onSuccess).not.toHaveBeenCalled()
    })
  })
})
