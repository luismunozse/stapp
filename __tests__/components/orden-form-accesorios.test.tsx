/**
 * Los dos caminos por los que un accesorio marcado en el mostrador no llegaba
 * al comprobante. Los dos son silenciosos: la orden se crea igual, con
 * "Accesorios recibidos —" en el papel que firma el cliente al dejar el equipo.
 *
 * Se monta el wizard completo (los dos casos son de interaccion: lo que quedo
 * tipeado sin agregar, y un toque de mas en la grilla de tipos) y se mira el
 * body del POST /api/ordenes, que es lo unico que termina en la base.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad" />,
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
        id: "tipo-1",
        codigo: "COMPUTADORA",
        nombre: "Computadora",
        config: {
          campos: {
            imei: { visible: true },
            password: { visible: true },
            color: { visible: true },
            marca: { visible: true },
          },
          accesorios: [
            { id: "cargador_notebook", label: "Cargador/Fuente" },
            { id: "mouse", label: "Mouse" },
          ],
          problemasComunes: [],
          marcas: [],
          camposExtra: [],
        },
      },
      {
        id: "tipo-2",
        codigo: "CELULAR",
        nombre: "Celular",
        config: {
          accesorios: [{ id: "cargador", label: "Cargador" }],
          problemasComunes: [],
          marcas: [],
          camposExtra: [],
        },
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
    onChange: (id: string | null, cliente: { id: string; nombre: string } | null) => void
  }) => (
    <button type="button" onClick={() => onChange("cli-1", { id: "cli-1", nombre: "Candela" })}>
      Elegir cliente de prueba
    </button>
  ),
}))

function stubFetch() {
  const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void init
    const url = String(input)
    if (url === "/api/ordenes") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ id: "ord-1", numeroOrden: 23 }),
      } as Response)
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response)
  })
  vi.stubGlobal("fetch", fetchSpy)
  return fetchSpy
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50))
  })
}

/** Paso 1 completo con el tipo Computadora y el equipo del caso reportado. */
async function completarPaso1() {
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  render(
    <ModalProvider>
      <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
    </ModalProvider>,
  )
  fireEvent.click(screen.getByRole("button", { name: "Elegir cliente de prueba" }))
  fireEvent.click(screen.getByRole("button", { name: "Computadora" }))
  fireEvent.change(screen.getByPlaceholderText("Modelo o descripcion del equipo"), {
    target: { value: "HP 240 G7" },
  })
  fireEvent.change(screen.getByPlaceholderText("Describa el problema del equipo..."), {
    target: { value: "Cambio a SSD + case HDD USB" },
  })
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
  expect(await screen.findByText("Accesorios Recibidos")).toBeInTheDocument()
}

async function crearOrden() {
  fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
  const crear = await screen.findByRole("button", { name: "Crear Orden" })
  await act(async () => {
    fireEvent.click(crear)
  })
  await settle()
}

function bodyDelPost(fetchSpy: ReturnType<typeof stubFetch>) {
  const call = fetchSpy.mock.calls.find((c) => String(c[0]) === "/api/ordenes")
  expect(call).toBeDefined()
  return JSON.parse(String(call![1]?.body))
}

describe("OrdenForm — accesorios que llegaban vacios al comprobante", () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("guarda el accesorio tipeado en 'Otro accesorio...' aunque no se haya apretado '+'", async () => {
    const fetchSpy = stubFetch()
    await completarPaso1()

    // El operador escribe el accesorio y va directo a crear la orden, sin
    // apretar el "+" (ni Enter): el texto esta en pantalla, asi que da por
    // hecho que quedo cargado.
    fireEvent.change(screen.getByPlaceholderText("Otro accesorio..."), {
      target: { value: "Cargador original" },
    })
    await crearOrden()

    expect(bodyDelPost(fetchSpy).accesorios).toBe("Cargador original")
  })

  it("no duplica el texto libre cuando ademas se apreto '+'", async () => {
    const fetchSpy = stubFetch()
    await completarPaso1()

    fireEvent.change(screen.getByPlaceholderText("Otro accesorio..."), {
      target: { value: "Cargador original" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Agregar otro accesorio" }))
    await crearOrden()

    expect(bodyDelPost(fetchSpy).accesorios).toBe("Cargador original")
  })

  it("conserva los accesorios marcados cuando se vuelve a tocar el tipo ya elegido", async () => {
    const fetchSpy = stubFetch()
    await completarPaso1()

    fireEvent.click(screen.getByText("Cargador/Fuente"))

    // Volver al paso 1 a revisar y tocar de nuevo el mismo tipo: no es un
    // cambio de tipo, asi que no puede vaciar lo ya cargado.
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }))
    fireEvent.click(await screen.findByRole("button", { name: "Computadora" }))
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText("Accesorios Recibidos")
    await crearOrden()

    expect(bodyDelPost(fetchSpy).accesorios).toBe("Cargador/Fuente")
  })

  it("si el tipo SI cambia, los accesorios del tipo anterior no viajan con la orden", async () => {
    const fetchSpy = stubFetch()
    await completarPaso1()

    fireEvent.click(screen.getByText("Cargador/Fuente"))
    fireEvent.click(screen.getByRole("button", { name: "Anterior" }))
    fireEvent.click(await screen.findByRole("button", { name: "Celular" }))
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await screen.findByText("Accesorios Recibidos")
    await crearOrden()

    expect(bodyDelPost(fetchSpy).accesorios).toBeUndefined()
  })
})
