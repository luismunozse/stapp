/**
 * Creating an order: the technician picker lists the technicians of the branch the order
 * will be CREATED in (`?alcance=escritura`), the same branch the server validates the
 * assignment against. A plain `/api/tecnicos` would offer an ADMIN on Todas every branch's
 * technicians and the server would reject all but the principal's.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

const sesion = vi.hoisted(() => ({ role: "ADMIN" as string }))

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1", role: sesion.role } } }),
}))

// jsdom has no canvas, and the signature pad is not what is verified here.
vi.mock("@/components/firma/signature-pad", () => ({ SignaturePad: () => <div /> }))
vi.mock("@/lib/image-compression", () => ({ compressImage: async (file: File) => file }))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({ tipos: [], loading: false, error: null, refetch: vi.fn() }),
}))

let pedidos: string[] = []

async function montar() {
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  return render(
    <ModalProvider>
      <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
    </ModalProvider>,
  )
}

describe("OrdenForm - technician picker scope", () => {
  beforeEach(() => {
    pedidos = []
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        pedidos.push(String(input))
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each(["ADMIN", "VENDEDOR"])("a %s asks for the write scope, never for the plain list", async (role) => {
    sesion.role = role
    await montar()

    await waitFor(() => expect(pedidos.some((u) => u.startsWith("/api/tecnicos"))).toBe(true))
    expect(pedidos.filter((u) => u.startsWith("/api/tecnicos"))).toEqual(["/api/tecnicos?alcance=escritura"])
  })

  it("a TECNICO does not fetch the technician list at all (he is the technician)", async () => {
    sesion.role = "TECNICO"
    await montar()

    // The operators list is fetched on mount for everyone: once it was asked for, the effects ran.
    await waitFor(() => expect(pedidos).toContain("/api/operadores"))
    expect(pedidos.filter((u) => u.startsWith("/api/tecnicos"))).toEqual([])
  })
})

// The technician can arrive from a restored draft or from the appointment the order is created
// from. If the picker does not offer him (another branch), what is SHOWN and what is SENT must
// agree: nothing chosen, instead of a blank select that still posts a technician.
describe("OrdenForm - a technician that came from a draft or an appointment", () => {
  const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"
  let posts: Array<Record<string, unknown>>

  function borrador(tecnicoId: string) {
    return JSON.stringify({
      version: 3,
      savedAt: Date.now(),
      data: {
        form: {
          clienteId: "cli-1",
          dispositivo: "iPhone del cliente",
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
        selectedClienteObj: { id: "cli-1", nombre: "Cliente X", telefono: "1100000000", tipoCliente: "INDIVIDUAL", razonSocial: null },
        accesoriosSeleccionados: [],
        otroAccesorio: "",
        camposExtraValues: {},
        presupuestoAceptado: false,
        sena: "",
        metodoPagoSena: "EFECTIVO",
        selectedSectorId: "",
        selectedTecnicoId: tecnicoId,
        selectedRecibidoPorId: "",
        checklistValores: {},
        checklistNotas: "",
      },
    })
  }

  beforeEach(() => {
    sesion.role = "ADMIN"
    posts = []
    window.localStorage.clear()
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body ?? "{}")))
          return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: "no importa" }) } as Response)
        }
        if (url.startsWith("/api/tecnicos")) {
          return Promise.resolve({ ok: true, json: async () => [{ id: "t-a", nombre: "Ana", activo: true }] } as Response)
        }
        return Promise.resolve({ ok: true, json: async () => [] } as Response)
      }),
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  /** The picker is on step 2, the submit on step 3: read what the picker shows, then create. */
  async function crearOrdenDesdeElBorrador(tecnicoId: string) {
    window.localStorage.setItem(DRAFT_KEY, borrador(tecnicoId))
    await montar()
    await screen.findByText(/se restauró un borrador no guardado/i)
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText(/Paso 2\/3/)
    // The list answers after the draft is restored: wait for the picker.
    const textoDelSelector = await waitFor(() => {
      const el = document.getElementById("tecnicoId")
      expect(el).not.toBeNull()
      return el!.textContent ?? ""
    })
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText(/Paso 3\/3/)
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden" }))
    await waitFor(() => expect(posts).toHaveLength(1))
    return { textoDelSelector, orden: posts[0] }
  }

  it("one the picker does not offer is shown as Sin asignar and is not sent", async () => {
    const { textoDelSelector, orden } = await crearOrdenDesdeElBorrador("t-otra-sucursal")

    expect(textoDelSelector).toBe("Sin asignar")
    expect(orden.tecnicoId).toBeUndefined()
  })

  it("one the picker offers is shown and sent", async () => {
    const { textoDelSelector, orden } = await crearOrdenDesdeElBorrador("t-a")

    expect(textoDelSelector).toBe("Ana")
    expect(orden.tecnicoId).toBe("t-a")
  })
})
