/**
 * Currency of the price in the product form: the selector next to the prices, the local equivalent,
 * the convert/keep dialog when switching, what the submit sends, and the variant group save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"
import { SWRConfig } from "swr"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

const { useMonedaMock, confirmMock, showErrorMock, showWarningMock } = vi.hoisted(() => ({
  useMonedaMock: vi.fn(),
  confirmMock: vi.fn(),
  showErrorMock: vi.fn(),
  showWarningMock: vi.fn(),
}))

vi.mock("@/hooks/use-moneda", () => ({ useMoneda: useMonedaMock }))
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `ARS ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}` }),
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

const CONFIG = {
  monedaLocal: "ARS",
  monedaExtranjera: "USD",
  habilitada: true,
  fuentesDisponibles: ["MANUAL", "OFICIAL", "BLUE", "MEP"],
  fuente: "BLUE",
  tipoCambioManual: null,
  tipoCambioReferencia: null,
  referenciaEn: null,
  redondeoConversion: 10,
  aceptaUsdEfectivo: false,
  vueltoMonedaDefault: "LOCAL",
}
const VIVO = { disponible: true, valor: 1200, fuente: "BLUE", moneda: "USD", en: new Date().toISOString(), estado: "vivo" }

function setMoneda(config: object = {}, tipoCambio: object = VIVO) {
  useMonedaMock.mockReturnValue({ config: { ...CONFIG, ...config }, tipoCambio, itemsEnDivisa: null, isLoading: false, mutate: vi.fn() })
}

const KEY_ALTA = "draft:v3:inventario-form:org-1:user-1:new"

const item = (over: Record<string, unknown> = {}) =>
  ({
    id: "i1",
    codigo: "CEL-0001",
    nombre: "Pantalla",
    categoria: "Pantallas",
    tipoDispositivo: "CELULAR",
    stock: 4,
    stockReservado: 0,
    precioCompra: 36000,
    precioVenta: 60000,
    proveedorId: null,
    moneda: null,
    ...over,
  }) as unknown as Inventario

const hijo = (id: string, valor: string, over: Record<string, unknown> = {}) => ({
  id,
  codigo: `FX-${valor.toUpperCase()}`,
  nombre: `Funda X - ${valor}`,
  categoria: "Pantallas",
  tipoDispositivo: "CELULAR",
  stock: 3,
  stockReservado: 0,
  precioCompra: 36000,
  precioVenta: 60000,
  barcode: null,
  grupoId: "g1",
  atributos: [{ opcion: "Color", valor }],
  imagenUrl: null,
  moneda: null,
  ...over,
})
const grupoGet = (over: Record<string, unknown> = {}) => ({
  grupo: { id: "g1", nombre: "Funda X", opciones: [{ nombre: "Color", valores: ["Rojo", "Azul"] }] },
  variantes: [hijo("r1", "Rojo", over), hijo("a1", "Azul", over)],
  archivadas: [],
})
const itemAgrupado = (over: Record<string, unknown> = {}) =>
  ({ ...hijo("r1", "Rojo", over), esKit: false }) as unknown as Inventario

interface Llamada {
  url: string
  method: string
  body: any
}

describe("InventarioForm: moneda del precio", () => {
  let llamadas: Llamada[]
  let respuestaGrupoPut: () => { status: number; body: unknown }
  let respuestaGrupoGet: () => { status: number; body: unknown }
  const onSuccess = vi.fn()

  const json = (status: number, body: unknown) =>
    Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body } as Response)
  const envio = (method: string, prefijo: string) => llamadas.find((l) => l.method === method && l.url.startsWith(prefijo))

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    setMoneda()
    llamadas = []
    confirmMock.mockResolvedValue(true)
    respuestaGrupoPut = () => ({ status: 200, body: { guardado: true, relectura: false, grupoId: "g1" } })
    respuestaGrupoGet = () => ({ status: 200, body: grupoGet() })
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown, init?: RequestInit) => {
        const href = String(url)
        const method = init?.method ?? "GET"
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body
        llamadas.push({ url: href, method, body })
        if (href.startsWith("/api/inventario/grupos/") && method === "GET") {
          const r = respuestaGrupoGet()
          return json(r.status, r.body)
        }
        if (href.startsWith("/api/inventario/grupos/") && method === "PUT") {
          const r = respuestaGrupoPut()
          return json(r.status, r.body)
        }
        if (href.includes("/api/inventario/next-code")) return json(200, { codigo: "CEL-0009" })
        if (href.includes("/api/depositos")) return json(200, { data: [] })
        if (href.includes("/api/inventario/check-duplicate")) return json(200, { matches: [] })
        if (href === "/api/inventario" && method === "POST") return json(200, { id: "nuevo", codigo: "CEL-0009", nombre: "Funda X" })
        if (href.startsWith("/api/inventario/") && method === "PUT") return json(200, { id: "i1" })
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
        <InventarioForm onClose={vi.fn()} onSuccess={onSuccess} {...props} />
      </SWRConfig>
    )
  }

  const selector = () => screen.getByLabelText("Moneda del precio") as HTMLSelectElement
  const venta = () => screen.getByLabelText(/^(Precio Venta \*|Precio base)$/) as HTMLInputElement
  const costo = () => screen.getByLabelText(/^(Costo \*|Costo base)$/) as HTMLInputElement
  const guardar = () => screen.getByRole("button", { name: "Guardar" })
  const elegir = (moneda: string) => fireEvent.change(selector(), { target: { value: moneda } })

  it("el selector aparece junto a los precios con la función activa", () => {
    renderForm()
    expect(selector()).toBeInTheDocument()
    expect(selector().value).toBe("")
  })

  it("con la función apagada y precio local no hay selector", () => {
    setMoneda({ habilitada: false })
    renderForm({ item: item() })
    expect(screen.queryByLabelText("Moneda del precio")).not.toBeInTheDocument()
  })

  it("con moneda en divisa muestra el equivalente local debajo de venta y de costo", () => {
    renderForm({ item: item({ moneda: "USD", precioVenta: 50, precioCompra: 30 }) })
    expect(selector().value).toBe("USD")
    expect(screen.getByText(/≈ ARS 60\.000 hoy/)).toBeInTheDocument()
    expect(screen.getByText(/≈ ARS 36\.000 hoy/)).toBeInTheDocument()
  })

  it("en moneda local no muestra el equivalente", () => {
    renderForm({ item: item() })
    expect(screen.queryByText(/≈/)).not.toBeInTheDocument()
  })

  it("pasar de local a USD con precios abre el diálogo; Convertir convierte venta y costo", async () => {
    renderForm({ item: item() })
    elegir("USD")
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByRole("button", { name: "Convertir con la cotización de hoy" })).toBeEnabled()
    expect(within(dialogo).getByRole("button", { name: "Mantener el número" })).toBeInTheDocument()

    fireEvent.click(within(dialogo).getByRole("button", { name: "Convertir con la cotización de hoy" }))

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(venta().value).toBe("50")
    expect(costo().value).toBe("30")
    expect(selector().value).toBe("USD")
  })

  it("Mantener el número cambia la moneda y deja los precios", async () => {
    renderForm({ item: item() })
    elegir("USD")
    fireEvent.click(await screen.findByRole("button", { name: "Mantener el número" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(venta().value).toBe("60000")
    expect(costo().value).toBe("36000")
    expect(selector().value).toBe("USD")
  })

  it("Cancelar deja la moneda como estaba", async () => {
    renderForm({ item: item() })
    elegir("USD")
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(selector().value).toBe("")
    expect(venta().value).toBe("60000")
  })

  it("de USD a local, Convertir multiplica por la cotización con el redondeo de la organización", async () => {
    renderForm({ item: item({ moneda: "USD", precioVenta: 50.01, precioCompra: 30 }) })
    elegir("")
    fireEvent.click(await screen.findByRole("button", { name: "Convertir con la cotización de hoy" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    // 50.01 × 1200 = 60012 → a la decena: 60010
    expect(venta().value).toBe("60010")
    expect(costo().value).toBe("36000")
  })

  it("sin cotización, Convertir está deshabilitado y lo dice", async () => {
    setMoneda({}, { disponible: false, motivo: "sin_datos" })
    renderForm({ item: item() })
    elegir("USD")
    const dialogo = await screen.findByRole("dialog")
    expect(within(dialogo).getByRole("button", { name: "Convertir con la cotización de hoy" })).toBeDisabled()
    expect(within(dialogo).getByText("No hay cotización disponible")).toBeInTheDocument()
  })

  it("con los precios vacíos no abre el diálogo", async () => {
    renderForm()
    elegir("USD")
    expect(selector().value).toBe("USD")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("el alta manda la moneda elegida", async () => {
    window.localStorage.setItem(
      KEY_ALTA,
      JSON.stringify({
        version: 3,
        savedAt: Date.now(),
        data: {
          values: { nombre: "Funda X", categoria: "Pantallas", tipoDispositivo: "CELULAR", stock: 0, precioVenta: 0, proveedorId: null, ubicacion: null, barcode: null },
          ui: { showStockConfig: false, showNewTipo: false, newTipo: "", showNewCategoria: false, newCategoria: "", imagenPendiente: false },
        },
      })
    )
    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)
    elegir("USD")
    // The code comes from next-code: Guardar waits for it.
    await waitFor(() => expect(guardar()).not.toBeDisabled())
    fireEvent.click(guardar())
    await waitFor(() => expect(envio("POST", "/api/inventario")).toBeDefined())
    expect(envio("POST", "/api/inventario")!.body.moneda).toBe("USD")
  })

  it("la edición manda la moneda cuando cambió", async () => {
    renderForm({ item: item() })
    elegir("USD")
    fireEvent.click(await screen.findByRole("button", { name: "Mantener el número" }))
    fireEvent.click(guardar())
    await waitFor(() => expect(envio("PUT", "/api/inventario/i1")).toBeDefined())
    expect(envio("PUT", "/api/inventario/i1")!.body.moneda).toBe("USD")
  })

  it("la edición sin cambio de moneda no la manda", async () => {
    renderForm({ item: item({ moneda: "USD", precioVenta: 50, precioCompra: 30 }) })
    fireEvent.click(guardar())
    await waitFor(() => expect(envio("PUT", "/api/inventario/i1")).toBeDefined())
    expect(envio("PUT", "/api/inventario/i1")!.body).not.toHaveProperty("moneda")
  })

  it("sin permiso para ver el costo, un ítem guardado no puede cambiar la moneda", () => {
    renderForm({ item: item({ precioCompra: null }) })
    expect(selector()).toBeDisabled()
    expect(screen.getByText("Para cambiar la moneda tenés que poder ver los costos")).toBeInTheDocument()
  })

  it("sin permiso para ver el costo, un alta nueva sí elige la moneda", () => {
    renderForm()
    expect(selector()).toBeEnabled()
    expect(screen.queryByText("Para cambiar la moneda tenés que poder ver los costos")).not.toBeInTheDocument()
  })

  it("una variante editada sin la sección de variantes no puede cambiar la moneda", () => {
    renderForm({ item: item({ grupoId: "g1" }) })
    expect(selector()).toBeDisabled()
  })

  describe("con variantes", () => {
    const grupoPut = () => envio("PUT", "/api/inventario/grupos/")

    it("guardar el grupo manda la moneda nueva en el cuerpo", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      elegir("USD")
      fireEvent.click(await screen.findByRole("button", { name: "Mantener el número" }))
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(grupoPut()).toBeDefined())
      expect(grupoPut()!.body.moneda).toBe("USD")
    })

    it("Convertir convierte el precio y el costo de cada variante", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      elegir("USD")
      fireEvent.click(await screen.findByRole("button", { name: "Convertir con la cotización de hoy" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(grupoPut()).toBeDefined())
      const { body } = grupoPut()!
      expect(body.moneda).toBe("USD")
      for (const v of body.variantes) {
        expect(v.precioVenta).toBe(50)
        expect(v.precioCompra).toBe(30)
      }
    })

    it("un grupo guardado sin cambio de moneda no la manda", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(grupoPut()).toBeDefined())
      expect(grupoPut()!.body).not.toHaveProperty("moneda")
    })

    it("sin permiso para ver los costos del grupo, el selector queda deshabilitado", async () => {
      respuestaGrupoGet = () => ({ status: 200, body: grupoGet({ precioCompra: null }) })
      renderForm({ item: itemAgrupado({ precioCompra: null }), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      expect(selector()).toBeDisabled()
      expect(screen.getByText("Para cambiar la moneda tenés que poder ver los costos")).toBeInTheDocument()
    })

    it("con variantes archivadas no se puede convertir, pero sí mantener el número", async () => {
      respuestaGrupoGet = () => ({
        status: 200,
        body: { ...grupoGet(), archivadas: [{ id: "v1", atributos: [{ opcion: "Color", valor: "Verde" }], stock: 0 }] },
      })
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      elegir("USD")
      const dialogo = await screen.findByRole("dialog")
      expect(within(dialogo).getByRole("button", { name: "Convertir con la cotización de hoy" })).toBeDisabled()
      expect(within(dialogo).getByText("Hay variantes archivadas: restauralas o eliminalas para convertir")).toBeInTheDocument()
      fireEvent.click(within(dialogo).getByRole("button", { name: "Mantener el número" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      expect(selector().value).toBe("USD")
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(grupoPut()).toBeDefined())
      expect(grupoPut()!.body.moneda).toBe("USD")
    })

    it("una variante restaurada con su precio sin tocar tampoco deja convertir", async () => {
      respuestaGrupoGet = () => ({
        status: 200,
        body: { ...grupoGet(), archivadas: [{ id: "v1", atributos: [{ opcion: "Color", valor: "Verde" }], stock: 2 }] },
      })
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      // Adding the archived combination back restores that member.
      const campo = await screen.findByLabelText("Agregar valor a Color")
      fireEvent.change(campo, { target: { value: "Verde" } })
      fireEvent.keyDown(campo, { key: "Enter" })
      await screen.findAllByLabelText("Precio de Verde")
      elegir("USD")
      const dialogo = await screen.findByRole("dialog")
      expect(within(dialogo).getByRole("button", { name: "Convertir con la cotización de hoy" })).toBeDisabled()
      expect(within(dialogo).getByText("Hay variantes archivadas: restauralas o eliminalas para convertir")).toBeInTheDocument()
    })

    it("convertir y guardar el grupo cierra el formulario sin aviso: la moneda se guarda con el grupo", async () => {
      renderForm({ item: itemAgrupado(), permiteVariantes: true })
      await screen.findAllByLabelText("Precio de Rojo")
      elegir("USD")
      fireEvent.click(await screen.findByRole("button", { name: "Convertir con la cotización de hoy" }))
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      await waitFor(() => expect(guardar()).not.toBeDisabled())
      fireEvent.click(guardar())
      await waitFor(() => expect(onSuccess).toHaveBeenCalled())
      expect(llamadas.filter((l) => l.method === "PUT" && l.url.startsWith("/api/inventario/grupos/"))).toHaveLength(1)
      expect(showWarningMock).not.toHaveBeenCalled()
    })
  })
})
