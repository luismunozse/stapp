/**
 * Cubre el wiring de useFormDraft (hooks/use-form-draft.ts) dentro de
 * InventarioForm: ~20 campos que el operador carga a mano y que hasta ahora se
 * perdian enteros ante un vencimiento de sesion, una navegacion o el cierre de
 * la pestana.
 *
 * Tres cosas que este formulario tiene y los tres call sites anteriores no:
 *
 *  - La imagen vive FUERA de react-hook-form y es un `File`. Un File se
 *    serializa a `{}` y su base64 no entra en la cuota de localStorage, asi que
 *    no se persiste: se persiste la marca de que habia una y el aviso lo dice.
 *  - Media pantalla mas vive fuera de RHF tambien (los inputs inline de "nuevo
 *    tipo" / "nueva categoria" y el panel de configuracion de stock). Un
 *    snapshot de `getValues()` a secas los tira en silencio.
 *  - La identidad del registro cambia EN VIVO: "Editar este" sobre un duplicado
 *    mueve `item` de null a un objeto con el formulario montado, o sea que la
 *    key del borrador cambia debajo del hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { InventarioForm } from "@/components/inventario/inventario-form"
import type { Inventario } from "@/types"

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "user-1", organizationId: "org-1", role: "ADMIN" } },
    status: "authenticated",
  }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [{ id: "t1", codigo: "CELULAR", nombre: "Celular", config: null }],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

/** La compresion real necesita canvas, que jsdom no implementa. Lo unico que
 *  estos tests necesitan de ella es que devuelva un File. */
vi.mock("@/lib/image-compression", () => ({
  compressImage: async (file: File) => file,
}))

const KEY_ALTA = "draft:v3:inventario-form:org-1:user-1:new"

/** Los sobres sembrados a mano no llevan `recordVersion`: un sobre sin token no
 *  se considera desactualizado (rama documentada de `isStaleAgainstRecord`), asi
 *  que sirve para montar un borrador restaurable sin recalcular aca la huella. */
function seedDraft(key: string, data: Record<string, unknown>) {
  window.localStorage.setItem(
    key,
    JSON.stringify({ version: 3, savedAt: Date.now(), data }),
  )
}

/** Snapshot completo de un alta a medio cargar, con la forma que el formulario
 *  persiste: los campos de react-hook-form separados del estado de UI que vive
 *  afuera, para que ninguna clave de UI pueda colarse en el payload del POST. */
function draftDeAlta(ui: Record<string, unknown> = {}) {
  return {
    values: {
      nombre: "Bateria restaurada",
      categoria: "Baterías",
      tipoDispositivo: "CELULAR",
      stock: 7,
      precioCompra: 100,
      precioVenta: 250,
      proveedorId: null,
      stockMinimo: null,
      stockMaximo: null,
      puntoReorden: null,
      ubicacion: null,
      barcode: null,
      diasGarantiaDefault: null,
      trackeaLotes: false,
      trackeaSeries: false,
      tieneVariantes: false,
      esKit: false,
      tipoKit: null,
    },
    ui: {
      showStockConfig: false,
      showNewTipo: false,
      newTipo: "",
      showNewCategoria: false,
      newCategoria: "",
      imagenPendiente: false,
      ...ui,
    },
  }
}

function makeItem(overrides: Partial<Inventario> = {}): Inventario {
  return {
    id: "inv-1",
    codigo: "CEL-0001",
    nombre: "Bateria guardada",
    categoria: "Baterías",
    tipoDispositivo: "CELULAR" as Inventario["tipoDispositivo"],
    stock: 3,
    stockReservado: 0,
    precioCompra: 80,
    precioVenta: 200,
    ...overrides,
  }
}

function renderForm(props: Partial<React.ComponentProps<typeof InventarioForm>> = {}) {
  return render(
    <ModalProvider>
      <InventarioForm onClose={vi.fn()} onSuccess={vi.fn()} {...props} />
    </ModalProvider>,
  )
}

describe("InventarioForm — borrador local", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    window.localStorage.clear()
    fetchMock = vi.fn((url: unknown) => {
      const href = String(url)
      if (href.includes("/api/inventario/next-code")) {
        return Promise.resolve({ ok: true, json: async () => ({ codigo: "CEL-0009" }) } as Response)
      }
      if (href.includes("/api/inventario/check-duplicate")) {
        return Promise.resolve({ ok: true, json: async () => ({ matches: [] }) } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as unknown as Response)
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("restaura un borrador de alta y muestra el aviso dismissible", async () => {
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm()

    expect(await screen.findByText(/se restauró un borrador no guardado/i)).toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria restaurada")
    expect(screen.getByLabelText("Stock *")).toHaveValue("7")
  })

  it("restaura tambien el tipo y la categoria, que viven en un <Select>", async () => {
    // Radix monta un <select> nativo oculto que, al cambiarle el valor desde
    // afuera con el listado cerrado (o sea sin ninguna <option> registrada),
    // devuelve "" por onValueChange y pisa lo que se acaba de setear. El
    // borrador volvia con los dos campos obligatorios en blanco, y sin ellos no
    // se genera el codigo: "Guardar" quedaba deshabilitado sin explicacion.
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)

    // El pedido de codigo solo sale con tipo Y categoria cargados: es la lectura
    // del valor que no depende de tener el listado abierto.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("categoria=Bater%C3%ADas&tipoDispositivo=CELULAR"),
        expect.anything(),
      ),
    )
    expect(screen.queryByText("Elegí tipo primero")).not.toBeInTheDocument()
  })

  it("restaura tambien lo que vive fuera de react-hook-form", async () => {
    // El input inline de "nuevo tipo" con texto adentro es trabajo escrito igual
    // que cualquier campo: un snapshot de getValues() a secas lo tira.
    seedDraft(
      KEY_ALTA,
      draftDeAlta({ showNewTipo: true, newTipo: "Drone", showStockConfig: true }),
    )

    renderForm()

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByPlaceholderText("Ej: Drone, Cafetera...")).toHaveValue("Drone")
    expect(screen.getByLabelText("Stock Mínimo")).toBeInTheDocument()
  })

  it("no restaura un borrador de alta sobre un formulario de edicion", async () => {
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm({ item: makeItem() })

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria guardada"),
    )
    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
  })

  it("no devuelve el costo de compra, y el aviso lo dice", async () => {
    // El costo no se persiste (ver el describe de mas abajo). Un borrador viejo
    // que todavia lo traiga tampoco lo devuelve: el input arranca en el default
    // del alta, no en lo que quedo escrito en disco.
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm()

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByLabelText("Costo *")).toHaveValue("0")
    expect(screen.getByText(/el costo no se guarda en el borrador/i)).toBeInTheDocument()
    // El resto del borrador vuelve entero.
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria restaurada")
    expect(screen.getByLabelText("Precio Venta *")).toHaveValue("250")
  })

  it("no habla del costo cuando el rol no puede verlo", async () => {
    // Sin permiso el input ni se muestra: pedir que lo vuelvan a cargar es
    // mandar a alguien a un campo que no existe en su pantalla.
    seedDraft("draft:v3:inventario-form:org-1:user-1:edit:inv-1", draftDeAlta())

    renderForm({ item: makeItem({ precioCompra: null }) })

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByText(/sin permiso para ver el costo/i)).toBeInTheDocument()
    expect(screen.queryByText(/el costo no se guarda en el borrador/i)).not.toBeInTheDocument()
  })

  it("avisa que la foto hay que volver a elegirla cuando el borrador tenia una", async () => {
    seedDraft(KEY_ALTA, draftDeAlta({ imagenPendiente: true }))

    renderForm()

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByText(/la foto no se guarda en el borrador/i)).toBeInTheDocument()
  })

  it("no avisa nada de la foto cuando el borrador no tenia ninguna", async () => {
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm()

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.queryByText(/volvé a seleccionarla/i)).not.toBeInTheDocument()
  })

  it("no reemplaza con el borrador el codigo que acaba de leer el scanner", async () => {
    // Alta desde el lector: `initialBarcode` es el EAN que el operador acaba de
    // escanear. Es el unico campo de la pantalla que nunca tipeo y que por lo
    // tanto no vuelve a mirar, asi que un borrador de hasta 7 dias que lo pise
    // -- casi siempre con null -- se lleva el codigo sin que nadie se entere,
    // aviso de restauracion incluido.
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm({ initialBarcode: "7791234567890" })

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByLabelText("Código de Barras")).toHaveValue("7791234567890")
    // El resto del borrador si vuelve.
    expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria restaurada")
  })

  it("deja ganar al borrador cuando el item ya tenia su propio codigo", async () => {
    // El scanner matcheo por codigo interno y el item YA tiene barcode: ahi el
    // prefill no lo toca (seria pisar el codigo guardado), asi que el borrador
    // es lo ultimo que se escribio sobre ese campo.
    const draft = draftDeAlta()
    seedDraft("draft:v3:inventario-form:org-1:user-1:edit:inv-1", {
      ...draft,
      values: { ...draft.values, barcode: "111111111111" },
    })

    renderForm({
      item: makeItem({ barcode: "999999999999" }),
      initialBarcode: "7791234567890",
    })

    await screen.findByText(/se restauró un borrador no guardado/i)
    expect(screen.getByLabelText("Código de Barras")).toHaveValue("111111111111")
  })

  it("borra el borrador cuando el alta se guarda bien", async () => {
    seedDraft(KEY_ALTA, draftDeAlta())
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/inventario/next-code")) {
        return Promise.resolve({ ok: true, json: async () => ({ codigo: "CEL-0009" }) } as Response)
      }
      if (href === "/api/inventario" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ id: "inv-nuevo" }) } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
    })
    const onSuccess = vi.fn()

    renderForm({ onSuccess })
    await screen.findByText(/se restauró un borrador no guardado/i)
    const guardar = await screen.findByRole("button", { name: "Guardar" })
    await waitFor(() => expect(guardar).not.toBeDisabled())

    fireEvent.click(guardar)

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    expect(window.localStorage.getItem(KEY_ALTA)).toBeNull()
  })

  it("conserva el borrador cuando el guardado falla", async () => {
    seedDraft(KEY_ALTA, draftDeAlta())
    fetchMock.mockImplementation((url: unknown, init?: RequestInit) => {
      const href = String(url)
      if (href.includes("/api/inventario/next-code")) {
        return Promise.resolve({ ok: true, json: async () => ({ codigo: "CEL-0009" }) } as Response)
      }
      if (href === "/api/inventario" && init?.method === "POST") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: "Se cayo el server" }),
        } as Response)
      }
      return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
    })
    const onSuccess = vi.fn()

    renderForm({ onSuccess })
    await screen.findByText(/se restauró un borrador no guardado/i)
    const guardar = await screen.findByRole("button", { name: "Guardar" })
    await waitFor(() => expect(guardar).not.toBeDisabled())

    fireEvent.click(guardar)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/inventario", expect.anything()))
    expect(onSuccess).not.toHaveBeenCalled()
    // Lo unico irrecuperable de los dos lados es lo que el operador escribio.
    expect(window.localStorage.getItem(KEY_ALTA)).not.toBeNull()
  })

  it("descarta el borrador y vuelve el formulario a blanco", async () => {
    seedDraft(KEY_ALTA, draftDeAlta())

    renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)

    fireEvent.click(screen.getByRole("button", { name: "Descartar" }))
    fireEvent.click(screen.getByRole("button", { name: "Descartar borrador" }))
    await act(async () => {})

    expect(screen.queryByText(/se restauró un borrador no guardado/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText("Nombre *")).toHaveValue("")
    expect(window.localStorage.getItem(KEY_ALTA)).toBeNull()
  })
})

describe("InventarioForm — borrador local (lo que nunca se persiste)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown) => {
        const href = String(url)
        if (href.includes("/api/inventario/next-code")) {
          return Promise.resolve({ ok: true, json: async () => ({ codigo: "CEL-0009" }) } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  async function settle(ms = 2000) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it("escribe lo que el operador carga, incluido lo que vive fuera de RHF", async () => {
    renderForm()

    fireEvent.change(screen.getByLabelText("Nombre *"), {
      target: { value: "Bateria iPhone 12" },
    })
    fireEvent.click(screen.getByTitle("Agregar tipo"))
    fireEvent.change(screen.getByPlaceholderText("Ej: Drone, Cafetera..."), {
      target: { value: "Drone" },
    })
    await settle()

    const raw = window.localStorage.getItem(KEY_ALTA)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw!).data
    expect(data.values.nombre).toBe("Bateria iPhone 12")
    expect(data.ui.showNewTipo).toBe(true)
    expect(data.ui.newTipo).toBe("Drone")
    // El submit spreadea los valores del formulario dentro del payload: una
    // clave de UI en ese nivel viaja al POST.
    expect(data.values).not.toHaveProperty("showNewTipo")
  })

  it("nunca escribe el costo de compra", async () => {
    // El costo de compra es el unico campo de esta pantalla con permiso propio:
    // el formulario lo oculta y lo saca del payload cuando el rol no puede verlo
    // (`costoCargado`). Un borrador vive hasta 7 dias en localStorage, en claro,
    // en una terminal de mostrador que sobrevive al logout: persistirlo se lo
    // deja al operador siguiente, sea cual sea su rol. Mismo criterio que
    // lib/cliente-draft-projection.ts con el dni y el cuit.
    renderForm()

    fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Bateria" } })
    fireEvent.change(screen.getByLabelText("Costo *"), { target: { value: "8888.77" } })
    fireEvent.change(screen.getByLabelText("Precio Venta *"), { target: { value: "9999.55" } })
    await settle()

    const raw = window.localStorage.getItem(KEY_ALTA)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw!).data
    expect(data.values).not.toHaveProperty("precioCompra")
    expect(JSON.stringify(data)).not.toContain("8888")
    // El precio de venta si: es lo que ve cualquiera que entre al catalogo.
    expect(data.values.precioVenta).toBe(9999.55)
  })

  it("nunca escribe la imagen: ni el File ni su base64", async () => {
    renderForm()

    fireEvent.change(screen.getByLabelText("Nombre *"), { target: { value: "Con foto" } })
    const file = new File(["x".repeat(2048)], "foto.png", { type: "image/png" })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })
    // La imagen entra por un camino async (compresion + FileReader): hay que
    // dejarlo terminar ANTES de abrir la ventana del debounce, o lo que se
    // graba es el formulario de antes de elegirla.
    await act(async () => {})
    await settle()

    const raw = window.localStorage.getItem(KEY_ALTA)
    expect(raw).not.toBeNull()
    const data = JSON.parse(raw!).data
    // Un File se serializa a `{}` y el base64 revienta la cuota: no va ninguno
    // de los dos. Lo que si va es la marca, para que el aviso pueda decirlo.
    expect(data.ui.imagenPendiente).toBe(true)
    expect(data.values).not.toHaveProperty("pendingFile")
    expect(data.values).not.toHaveProperty("imagenPreview")
    expect(raw).not.toContain("data:image")
    expect(raw).not.toContain("foto.png")
  })
})

describe("InventarioForm — la identidad del registro cambia en vivo", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((url: unknown) => {
        const href = String(url)
        if (href.includes("/api/inventario/next-code")) {
          return Promise.resolve({ ok: true, json: async () => ({ codigo: "CEL-0009" }) } as Response)
        }
        if (href.includes("/api/inventario/check-duplicate")) {
          return Promise.resolve({ ok: true, json: async () => ({ matches: [] }) } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as unknown as Response)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("guarda lo cargado para el producto nuevo cuando 'Editar este' abre el existente", async () => {
    // inventario-list responde a onEditExisting moviendo `item` de null a un
    // objeto con el formulario montado: la key pasa de `new` a `edit:{id}` y el
    // reset() pisa todos los campos. Lo cargado para el producto nuevo tiene que
    // quedar en su propia entrada, no evaporarse con el cambio de key.
    const vista = render(
      <ModalProvider>
        <InventarioForm item={null} onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
    fireEvent.change(screen.getByLabelText("Nombre *"), {
      target: { value: "Producto a medio cargar" },
    })

    vista.rerender(
      <ModalProvider>
        <InventarioForm item={makeItem()} onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )

    await waitFor(() =>
      expect(screen.getByLabelText("Nombre *")).toHaveValue("Bateria guardada"),
    )
    const raw = window.localStorage.getItem(KEY_ALTA)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).data.values.nombre).toBe("Producto a medio cargar")
  })
})
