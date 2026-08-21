/**
 * "Descartar" tiene que dejar el alta como recien abierta. Lo que ese handler
 * no limpia sobrevive al descarte y viaja con la orden del siguiente cliente:
 * las fotos del equipo anterior se suben como si fueran del equipo nuevo y la
 * firma del checklist anterior queda como conformidad de otra persona.
 *
 * Archivo aparte de orden-form-draft.test.tsx porque necesita mocks propios
 * (buscador de clientes, firma y compresion de imagenes) para poder llegar
 * hasta el paso 3 y hasta el submit.
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

vi.mock("@/components/cotizaciones/cliente-selector", () => ({
  ClienteSelector: ({
    onChange,
  }: {
    onChange: (id: string | null, cliente: unknown) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange("cli-2", { id: "cli-2", nombre: "Cliente Y", telefono: "1199999999" })
      }
    >
      Elegir cliente
    </button>
  ),
}))

vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: ({
    onSignatureChange,
  }: {
    onSignatureChange: (data: string | null, mime: string | null) => void
  }) => (
    <button type="button" onClick={() => onSignatureChange("FIRMA_DEL_CLIENTE_X", "image/png")}>
      Firmar
    </button>
  ),
}))

// La compresion real usa canvas (no implementado en jsdom) y no es lo que se
// verifica aca: alcanza con que el archivo llegue a FileReader.
vi.mock("@/lib/image-compression", () => ({
  compressImage: async (file: File) => file,
}))

const DRAFT_KEY = "draft:v2:orden-form:org-1:user-1:new"

const CHECKLIST_TEMPLATE = {
  id: "tpl-1",
  nombre: "Ingreso",
  items: [{ id: "item-1", key: "pantalla", label: "Pantalla", tipo: "BOOLEAN", orden: 1 }],
}

/** Borrador del "cliente X": ya trae validos los cuatro campos del paso 1, que
 *  es lo que habilita "Siguiente" hasta llegar al paso 3. */
function draftDelClienteX() {
  return JSON.stringify({
    version: 2,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1",
        dispositivo: "iPhone del cliente X",
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
      selectedClienteObj: {
        id: "cli-1",
        nombre: "Cliente X",
        telefono: "1100000000",
        tipoCliente: "INDIVIDUAL",
        razonSocial: null,
      },
      accesoriosSeleccionados: [],
      otroAccesorio: "",
      camposExtraValues: {},
      presupuestoAceptado: false,
      sena: "",
      metodoPagoSena: "EFECTIVO",
      selectedSectorId: "",
      selectedTecnicoId: "",
      selectedRecibidoPorId: "",
      checklistValores: {},
      checklistNotas: "",
    },
  })
}

describe("OrdenForm — descartar un borrador", () => {
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
        if (url.includes("/api/checklist-templates/by-device-type")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ template: CHECKLIST_TEMPLATE }),
          } as Response)
        }
        if (url.includes("/api/ordenes") && init?.method === "POST") {
          // Se rechaza a proposito: lo que se verifica es el payload que sale,
          // no lo que devuelve el servidor, y asi el test no tiene que montar
          // el modal de orden creada.
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: "no importa" }),
          } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Import diferido, como en orden-form-draft.test.tsx: el stub de fetch
   *  tiene que estar puesto antes de evaluar el modulo del formulario. */
  async function renderForm() {
    const { OrdenForm } = await import("@/components/ordenes/orden-form")
    return render(
      <ModalProvider>
        <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
      </ModalProvider>,
    )
  }

  async function irAlPaso3() {
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText(/Paso 2\/3/)
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText(/Paso 3\/3/)
  }

  it("no arrastra las fotos del equipo descartado a la orden siguiente", async () => {
    window.localStorage.setItem(DRAFT_KEY, draftDelClienteX())

    const { container } = await renderForm()
    await screen.findByText(/se restauró un borrador no guardado/i)

    // Paso 3 del cliente X: foto del equipo, checklist y firma.
    await irAlPaso3()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(["equipo-x"], "equipo-x.png", { type: "image/png" })] },
    })
    await screen.findByAltText("Preview")
    fireEvent.click(screen.getByRole("button", { name: "Firmar" }))

    // Se descarta todo y arranca una orden de otro cliente.
    fireEvent.click(screen.getByRole("button", { name: /descartar/i }))
    fireEvent.click(screen.getByRole("button", { name: "Elegir cliente" }))
    fireEvent.click(screen.getByRole("button", { name: "Celular" }))
    fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
      target: { value: "Moto G del cliente Y" },
    })
    fireEvent.change(screen.getByPlaceholderText("Describa el problema del equipo..."), {
      target: { value: "Bateria" },
    })
    await irAlPaso3()

    // La foto del equipo anterior no puede seguir en pantalla...
    expect(screen.queryByAltText("Preview")).not.toBeInTheDocument()

    // ...ni subirse con la orden nueva.
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden" }))

    await waitFor(() => {
      expect(requests.some((r) => r.url.endsWith("/api/ordenes"))).toBe(true)
    })
    const orden = requests.find((r) => r.url.endsWith("/api/ordenes"))
    expect(orden?.body.dispositivo).toBe("Moto G del cliente Y")
    expect(orden?.body.fotos).toBeUndefined()
  })
})
