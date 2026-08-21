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
function draftEnvelope() {
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
      checklistValores: { espejo: true },
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

  it("no manda las respuestas restauradas bajo un template que todavia no resolvio", async () => {
    // El guard de respuestas huerfanas (el efecto que compara
    // `checklistDelBorrador` contra el template del tipo) solo limpia
    // `checklistValores` DESPUES de que ese template llega. El submit no tenia
    // el mismo freno: posteaba `checklistTemplate.id` con lo que hubiera en
    // pantalla apenas los dos estados estuvieran cargados.
    //
    // Y en una terminal lenta esa ventana es real: el fetch del montaje sale
    // antes de que resuelva la lista de tipos, asi que trae el template por
    // defecto de la organizacion y nadie lo cancela; recien cuando la lista
    // llega se pide el del tipo, y ese queda en vuelo. Un "Crear orden" ahi
    // adentro guardaba las respuestas de CELULAR bajo el id del template por
    // defecto: quedan indexadas por items que no son los suyos, invisibles en
    // la ficha y contaminando un template ajeno. Es la misma corrupcion que el
    // guard existe para evitar, por la otra puerta.
    const templateDelTipo = new Promise<Response>(() => {
      // Nunca resuelve: sigue en vuelo cuando el operador aprieta el boton.
    })
    const fetchSpy = vi.fn((input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes("by-device-type?tipoDispositivoId=")) return templateDelTipo
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
    window.localStorage.setItem(DRAFT_KEY, draftEnvelope())

    await renderForm()
    await settle()

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }))
    await settle()
    fireEvent.click(screen.getByRole("button", { name: "Crear Orden" }))
    await settle()

    const urls = fetchSpy.mock.calls.map((call) => String(call[0]))
    // El template en pantalla es el que abre la ventana: el por defecto de la
    // organizacion, traido antes de que se supiera el tipo del borrador.
    expect(urls).toContain("/api/checklist-templates/by-device-type")
    // La orden si se crea. Lo unico que se retiene es el checklist.
    expect(urls).toContain("/api/ordenes")
    expect(urls.filter((url) => /^\/api\/ordenes\/.+\/checklist$/.test(url))).toEqual([])
  })
})
