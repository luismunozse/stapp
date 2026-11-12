/**
 * El submit de OrdenForm frente a las respuestas de checklist que restauro un
 * borrador.
 *
 * Archivo aparte de orden-form-draft.test.tsx por el mock de
 * useTiposDispositivo: la ventana que se cubre aca solo existe cuando la lista
 * de tipos resuelve DESPUES del primer fetch del template, y ese mock es de
 * alcance de archivo. Con la lista ya resuelta al montar (el mock del otro
 * archivo) el fetch del montaje se cancela y `checklistTemplate` queda en null,
 * o sea que la ventana no se puede abrir.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, act } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

// El pad real monta un canvas y react-signature-canvas revienta en jsdom. La
// firma no interviene aca: el paso 3 solo tiene que poder dibujarse para
// llegar al boton de crear.
vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad" />,
}))

/** Terminal lenta: la lista de tipos de equipo llega despues del montaje. Es
 *  la condicion que deja al formulario mostrando el template por defecto de la
 *  organizacion mientras el del tipo todavia no se pidio. */
const TIPOS_DELAY_MS = 50

vi.mock("@/hooks/use-tipos-dispositivo", async () => {
  const { useState, useEffect } = await import("react")
  return {
    useTiposDispositivo: () => {
      const [listo, setListo] = useState(false)
      useEffect(() => {
        const id = setTimeout(() => setListo(true), TIPOS_DELAY_MS)
        return () => clearTimeout(id)
      }, [])
      return {
        tipos: listo
          ? [
              {
                id: "tipo-1",
                codigo: "CELULAR",
                nombre: "Celular",
                config: { accesorios: [], problemasComunes: [], marcas: [], camposExtra: [] },
              },
            ]
          : [],
        loading: !listo,
        error: null,
        refetch: vi.fn(),
      }
    },
  }
})

const DRAFT_KEY = "draft:v3:orden-form:org-1:user-1:new"

/** El borrador que quedo de una carga anterior: respuestas contestadas sobre
 *  el template del tipo CELULAR, con su id guardado al lado. */
function draftEnvelope(
  checklistValores: Record<string, boolean | string | null> = { espejo: true },
) {
  return JSON.stringify({
    version: 3,
    savedAt: Date.now(),
    data: {
      form: {
        clienteId: "cli-1",
        dispositivo: "iPhone 13 Restaurado",
        tipoDispositivo: "CELULAR",
        marca: "",
        color: "",
        imei: "",
        problemaReportado: "Pantalla rota",
        accesorios: "",
        codigoAccesoDispositivo: "",
        telefonoContacto: "",
        fechaPrometida: "",
        observaciones: "",
        notasInternas: "",
      },
      selectedClienteObj: {
        id: "cli-1",
        nombre: "Acme SA",
        telefono: "1122334455",
        tipoCliente: "EMPRESA",
        razonSocial: "Acme SA",
      },
      accesoriosSeleccionados: [],
      otroAccesorio: "",
      camposExtraValues: {},
      metodoPagoSena: "EFECTIVO",
      selectedSectorId: "",
      selectedTecnicoId: "",
      selectedRecibidoPorId: "",
      checklistValores,
      checklistTemplateId: "tpl-celular",
      checklistNotas: "",
    },
  })
}

async function settle(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

async function renderForm() {
  const { OrdenForm } = await import("@/components/ordenes/orden-form")
  return render(
    <ModalProvider>
      <OrdenForm onClose={vi.fn()} onSuccess={vi.fn()} />
    </ModalProvider>,
  )
}

describe("OrdenForm — checklist restaurado en el submit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** fetch con el template del TIPO controlable desde el test: `pendiente`
   *  (nunca resuelve hasta que se llama a `resolver`), o `falla`. */
  function stubFetch(templateDelTipo: "pendiente" | "falla") {
    let resolver: (template: unknown) => void = () => {}
    let llamadasTipo = 0
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init
      const url = String(input)
      if (url.includes("by-device-type?tipoDispositivoId=")) {
        llamadasTipo++
        if (templateDelTipo === "falla") {
          return Promise.resolve({ ok: false, status: 500, json: async () => ({}) } as Response)
        }
        return new Promise<Response>((resolve) => {
          resolver = (template) =>
            resolve({ ok: true, status: 200, json: async () => ({ template }) } as Response)
        })
      }
      if (url.includes("/api/checklist-templates/by-device-type")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            template: {
              id: "tpl-default-org",
              nombre: "Ingreso generico",
              items: [{ id: "generico", label: "Generico", tipo: "BOOLEAN" }],
            },
          }),
        } as Response)
      }
      if (url === "/api/ordenes") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: "ord-1", numeroOrden: 1 }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response)
    })
    vi.stubGlobal("fetch", fetchSpy)
    return {
      fetchSpy,
      resolver: (template: unknown) => resolver(template),
      llamadasTipo: () => llamadasTipo,
    }
  }

  const urls = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.map((call) => String(call[0]))

  it("mientras el checklist del tipo carga, 'Crear orden' queda deshabilitado en todos los pasos", async () => {
    // "Crear orden" esta desde el paso 1: si se pudiera apretar con el template
    // del tipo en vuelo, los items obligatorios no se controlarian contra nada
    // (y las respuestas restauradas irian bajo el template por defecto de la
    // organizacion, que es el que quedo en pantalla en una terminal lenta).
    const { fetchSpy } = stubFetch("pendiente")
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())

    await renderForm()
    await settle()

    for (const avanzar of ["Agregar detalles", "Siguiente", null]) {
      const crear = screen.getByRole("button", { name: "Crear orden" })
      expect(crear).toBeDisabled()
      expect(crear).toHaveAttribute("aria-describedby", "orden-checklist-cargando")
      expect(screen.getByText("Cargando checklist…")).toBeInTheDocument()
      fireEvent.click(crear)
      await settle()
      if (avanzar) {
        fireEvent.click(screen.getByRole("button", { name: avanzar }))
        await settle()
      }
    }

    expect(urls(fetchSpy)).not.toContain("/api/ordenes")
  })

  it("cuando el checklist llega, se habilita y los items obligatorios no se pueden saltear", async () => {
    const { fetchSpy, resolver } = stubFetch("pendiente")
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope({}))

    await renderForm()
    await settle()
    expect(screen.getByRole("button", { name: "Crear orden" })).toBeDisabled()

    await act(async () => {
      resolver({
        id: "tpl-celular",
        nombre: "Ingreso celular",
        items: [{ id: "pantalla", label: "Pantalla sana", tipo: "BOOLEAN", orden: 1, requerido: true }],
      })
    })
    await settle()

    expect(screen.queryByText("Cargando checklist…")).toBeNull()
    const crear = screen.getByRole("button", { name: "Crear orden" })
    expect(crear).toBeEnabled()
    fireEvent.click(crear)
    await settle()
    // Lleva al checklist en vez de crear.
    expect(urls(fetchSpy)).not.toContain("/api/ordenes")
    expect(screen.getByText(/Paso 3\/3/)).toBeInTheDocument()

    const pantalla = document.getElementById("checklist-item-pantalla")!
    fireEvent.click(Array.from(pantalla.querySelectorAll("button")).find((b) => b.textContent === "Sí")!)
    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()
    expect(urls(fetchSpy)).toContain("/api/ordenes")
    const checklistCall = fetchSpy.mock.calls.find((call) =>
      /^\/api\/ordenes\/.+\/checklist$/.test(String(call[0])),
    )
    expect(JSON.parse(String(checklistCall![1]?.body))).toMatchObject({
      templateId: "tpl-celular",
      valores: { pantalla: true },
    })
  })

  it("un tipo sin checklist no bloquea el alta", async () => {
    const { fetchSpy, resolver } = stubFetch("pendiente")
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope({}))

    await renderForm()
    await settle()
    await act(async () => { resolver(null) })
    await settle()

    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()
    expect(urls(fetchSpy)).toContain("/api/ordenes")
  })

  it("si el checklist no carga, avisa, permite reintentar y no bloquea el alta para siempre", async () => {
    // Decision: bloquear hasta que el endpoint vuelva dejaria el mostrador sin
    // poder tomar ordenes. Se avisa, se ofrece reintentar y se deja crear; el
    // checklist se completa despues desde la ficha.
    const { fetchSpy, llamadasTipo } = stubFetch("falla")
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())

    await renderForm()
    await settle()

    expect(screen.getByText(/No se pudo cargar el checklist de ingreso/)).toBeInTheDocument()
    expect(llamadasTipo()).toBe(1)
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }))
    await settle()
    expect(llamadasTipo()).toBe(2)

    const crear = screen.getByRole("button", { name: "Crear orden" })
    expect(crear).toBeEnabled()
    fireEvent.click(crear)
    await settle()
    expect(urls(fetchSpy)).toContain("/api/ordenes")
    // Sin template no hay contra que guardar las respuestas restauradas.
    expect(urls(fetchSpy).filter((url) => /^\/api\/ordenes\/.+\/checklist$/.test(url))).toEqual([])
  })

  it("descarta las respuestas de items que el template ya no tiene, aunque el id no haya cambiado", async () => {
    // El guard de respuestas huerfanas comparaba SOLO el id del template. Pero
    // PUT /api/checklist-templates/[id] edita la fila en el lugar y los items
    // viven en su propia tabla: agregar o sacar items durante los 7 dias que
    // vive el borrador deja el mismo id. El guard pasaba, y el submit mandaba
    // respuestas indexadas por items que ya no existen bajo un templateId que
    // si -- exactamente la corrupcion que el guard dice cubrir ("si la
    // organizacion lo edito o lo reemplazo").
    const fetchSpy = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void init
      const url = String(input)
      if (url.includes("by-device-type?tipoDispositivoId=")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            // Mismo id que el del borrador; la organizacion le saco el item
            // "espejo" y le dejo "pantalla".
            template: {
              id: "tpl-celular",
              nombre: "Ingreso celular",
              items: [{ id: "pantalla", label: "Pantalla", tipo: "BOOLEAN", orden: 1 }],
            },
          }),
        } as Response)
      }
      if (url.includes("/api/checklist-templates/by-device-type")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            template: {
              id: "tpl-default-org",
              nombre: "Ingreso generico",
              items: [{ id: "generico", label: "Generico", tipo: "BOOLEAN", orden: 1 }],
            },
          }),
        } as Response)
      }
      if (url === "/api/ordenes") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: "ord-1", numeroOrden: 1 }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => [] } as Response)
    })
    vi.stubGlobal("fetch", fetchSpy)
    window.localStorage.setItem(
      DRAFT_KEY,
      draftEnvelope({ espejo: true, pantalla: false }),
    )

    await renderForm()
    await settle()

    fireEvent.click(screen.getByRole("button", { name: "Agregar detalles" }))
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Crear orden" }))
    await settle()

    const checklistCall = fetchSpy.mock.calls.find((call) =>
      /^\/api\/ordenes\/.+\/checklist$/.test(String(call[0])),
    )
    expect(checklistCall).toBeDefined()
    const body = JSON.parse(String(checklistCall![1]?.body))
    expect(body.templateId).toBe("tpl-celular")
    // Se conserva lo que el template de hoy sigue reconociendo...
    expect(body.valores).toEqual({ pantalla: false })
    // ...y se va lo que quedo apuntando a un item que ya no existe.
    expect(body.valores).not.toHaveProperty("espejo")
  })
})
