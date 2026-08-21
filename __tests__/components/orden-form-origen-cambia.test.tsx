/**
 * El alta de ordenes vive dentro de un overlay que NO se remonta: el listado
 * (components/ordenes/ordenes-list.tsx) solo llama a `setShowForm(true)`, y
 * `?fromTurno=` / `?clienteId=` salen de useSearchParams. Navegar de un origen
 * a otro -- otro cliente desde la ficha, el boton Atras del navegador --
 * cambia las props del formulario en pleno vuelo, con el borrador del origen
 * anterior todavia aplicado.
 *
 * Eso es lo que se cubre aca, y es lo que hace falta para poder llegar hasta el
 * submit: mocks propios del pad de firma y de la compresion de imagenes (paso
 * 3), y un fetch que registra el POST para poder mirar con que cliente sale la
 * orden.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        id: "tipo-1",
        codigo: "CELULAR",
        nombre: "Celular",
        config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

// El pad real dibuja sobre un canvas, que jsdom no implementa. Aca solo hace
// falta que el paso 3 se pueda montar para llegar a "Crear Orden".
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div>Firma del Cliente</div>,
}))

vi.mock("@/lib/image-compression", () => ({
  compressImage: async (file: File) => file,
}))

const ACME = {
  id: "cli-1",
  nombre: "Acme SA",
  telefono: "1122334455",
  tipoCliente: "EMPRESA",
  razonSocial: "Acme SA",
}

const BETA = {
  id: "cli-2",
  nombre: "Beta SRL",
  telefono: "1133445566",
  tipoCliente: "EMPRESA",
  razonSocial: "Beta SRL",
}

const CHECKLIST_TEMPLATE = {
  id: "tpl-1",
  nombre: "Ingreso",
  items: [{ id: "item-1", key: "pantalla", label: "Pantalla", tipo: "BOOLEAN", orden: 1 }],
}

/** Borrador del alta que venia abierta para Acme (deep-link ?clienteId=cli-1). */
function borradorDeAcme() {
  return JSON.stringify({
    version: 3,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1",
        dispositivo: "iPhone de Acme",
        tipoDispositivo: "CELULAR",
        marca: "",
        color: "",
        imei: "",
        problemaReportado: "No enciende",
        accesorios: "",
        telefonoContacto: "",
        fechaPrometida: "",
        observaciones: "",
        notasInternas: "",
      },
      selectedClienteObj: ACME,
      accesoriosSeleccionados: [],
      otroAccesorio: "",
      camposExtraValues: {},
      metodoPagoSena: "EFECTIVO",
      selectedSectorId: "",
      selectedTecnicoId: "",
      selectedRecibidoPorId: "",
      checklistValores: {},
      checklistNotas: "",
    },
  })
}

describe("OrdenForm — el origen cambia sin remontar el formulario", () => {
  let requests: Array<{ url: string; body: any }>

  beforeEach(() => {
    requests = []
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === "POST") {
          requests.push({ url, body: JSON.parse(String(init.body ?? "{}")) })
        }
        if (url.includes("/api/ordenes") && init?.method === "POST") {
          // Se rechaza a proposito: lo que se verifica es el payload que sale,
          // no lo que devuelve el servidor (mismo criterio que
          // orden-form-discard.test.tsx).
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: "no importa" }),
          } as Response)
        }
        if (url.includes("/api/checklist-templates/by-device-type")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ template: CHECKLIST_TEMPLATE }),
          } as Response)
        }
        if (url.includes("/sectores")) {
          return Promise.resolve({ ok: true, json: async () => [] } as Response)
        }
        if (url.includes("/api/clientes/cli-1")) {
          return Promise.resolve({ ok: true, json: async () => ACME } as Response)
        }
        if (url.includes("/api/clientes/cli-2")) {
          return Promise.resolve({ ok: true, json: async () => BETA } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Import diferido: el stub de fetch tiene que estar puesto antes de evaluar
   *  el modulo del formulario. */
  async function renderForm(initialClienteId?: string) {
    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    const view = render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} initialClienteId={initialClienteId} />
      </ModalProvider>,
    )
    const rerenderCon = async (siguiente?: string) =>
      view.rerender(
        <ModalProvider>
          <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} initialClienteId={siguiente} />
        </ModalProvider>,
      )
    return { ...view, rerenderCon }
  }

  async function irAlPaso3() {
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText(/Paso 2\/3/)
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText(/Paso 3\/3/)
  }

  it("crea la orden para el cliente que muestra la pantalla, no para el del borrador anterior", async () => {
    // El deep-link nuevo lee el latch de "borrador aplicado" en el MISMO commit
    // en que cambia el origen, cuando `draft` todavia es el del origen anterior:
    // con un latch booleano contestaba que si, el `setValue("clienteId", ...)`
    // se salteaba y el formulario se quedaba con el cliente viejo. El fetch en
    // vuelo si traia el nuevo, asi que la pantalla mostraba a Beta -- y la orden
    // salia para Acme.
    window.localStorage.setItem(
      "draft:v3:orden-form:org-1:user-1:new:cliente:cli-1",
      borradorDeAcme(),
    )

    const { rerenderCon } = await renderForm("cli-1")
    await screen.findByText(/se restauró un borrador no guardado/i)

    // El operador abre el alta de OTRO cliente desde su ficha: mismas props,
    // otro id, sin desmontar.
    await rerenderCon("cli-2")

    // Lo que ve el operador: el buscador resuelve el nombre a partir del
    // clienteId que tiene el formulario...
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Buscar cliente por nombre...")).toHaveValue("Beta SRL")
    })
    // ...y el bloque de empresa solo aparece cuando el objeto del cliente
    // corresponde a ese mismo id.
    expect(screen.getByText("Sector / Area")).toBeInTheDocument()

    // Se carga el equipo de Beta y se crea la orden.
    fireEvent.click(screen.getByRole("button", { name: "Celular" }))
    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G de Beta" },
    })
    fireEvent.change(screen.getByPlaceholderText("Describa el problema del equipo..."), {
      target: { value: "Bateria" },
    })
    await irAlPaso3()
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden" }))

    await waitFor(() => {
      expect(requests.some((r) => r.url.endsWith("/api/ordenes"))).toBe(true)
    })
    const orden = requests.find((r) => r.url.endsWith("/api/ordenes"))
    expect(orden?.body.clienteId).toBe("cli-2")
    expect(orden?.body.dispositivo).toBe("Moto G de Beta")
  })
})
