import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"
import { CotizacionForm } from "@/components/cotizaciones/cotizacion-form"

// El componente tambien consume el vocabulario configurable de la org
// (useTerminologia). Un mock parcial de este modulo hace que el render
// explote con "No export is defined on the mock", asi que la superficie
// mockeada tiene que seguir a la que usa el componente (idem
// cotizacion-form-iva-pais.test.tsx).
vi.mock("@/contexts/currency-context", () => ({
  useCurrency: () => ({ formatPrice: (n: number) => `$${n}` }),
  useTerminologia: () => (key: string) => key,
}))

// jsdom no implementa la API de pointer capture ni scrollIntoView que usa
// @radix-ui/react-select al seleccionar un item con click; sin este polyfill
// "elegir la causa del dano" revienta con "target.hasPointerCapture is not a
// function" apenas se hace click en un SelectItem.
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
  }
}

/**
 * Stub de fetch dirigido por URL. `responses` mapea un substring de la URL al
 * cuerpo JSON que debe devolver esa llamada; todo lo que no matchea devuelve
 * `{}` (ok: true), que es inofensivo para los efectos que solo leen un campo
 * puntual (`d?.diagnostico`, `d.entidades || []`).
 */
const stubFetch = (responses: Record<string, unknown> = {}) => {
  const fn = vi.fn((url: string, _opts?: RequestInit) => {
    const match = Object.keys(responses).find((key) => String(url).includes(key))
    return Promise.resolve({
      ok: true,
      json: async () => (match ? responses[match] : {}),
    } as Response)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

const renderForm = (props: Partial<React.ComponentProps<typeof CotizacionForm>> = {}) =>
  render(
    <ModalProvider>
      <CotizacionForm ordenId="orden-1" onClose={vi.fn()} onSuccess={vi.fn()} {...props} />
    </ModalProvider>
  )

const AVISO_INFORME = "Este documento se va a emitir como informe técnico, sin presupuesto ni ítems."

describe("CotizacionForm — seccion Informe técnico", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("elegir 'Irreparable' colapsa la tabla de items y muestra el aviso", () => {
    stubFetch()
    renderForm()

    // Antes de elegir el veredicto la tabla de items esta visible.
    expect(screen.getByText("Ítems")).toBeInTheDocument()
    expect(screen.queryByText(AVISO_INFORME)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Irreparable" }))

    expect(screen.queryByText("Ítems")).not.toBeInTheDocument()
    expect(screen.getByText(AVISO_INFORME)).toBeInTheDocument()
  })

  it("el payload enviado incluye veredicto, diagnosticoTecnico, causaDano y presentadoAnte", async () => {
    const fetchMock = stubFetch()
    renderForm()

    fireEvent.click(screen.getByRole("button", { name: "Irreparable" }))

    fireEvent.change(screen.getByLabelText("Diagnóstico del informe técnico"), {
      target: { value: "Corrosión generalizada en la placa madre por contacto con líquido." },
    })

    fireEvent.click(screen.getByLabelText("Causa probable del daño"))
    // Radix Select tambien monta un <select> nativo oculto (aria-hidden) para
    // autofill/SSR; findByText matchea las dos opciones. El listbox visible
    // filtra el duplicado.
    fireEvent.click(await screen.findByRole("option", { name: "Contacto con líquido" }))

    fireEvent.change(screen.getByLabelText("Para ser presentado ante"), {
      target: { value: "La Segunda ART" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Crear Cotización" }))

    await waitFor(() => {
      const postCall = (fetchMock as any).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "POST"
      )
      expect(postCall).toBeDefined()
      const body = JSON.parse((postCall as any)[1].body)
      expect(body.veredicto).toBe("IRREPARABLE")
      expect(body.diagnosticoTecnico).toBe(
        "Corrosión generalizada en la placa madre por contacto con líquido."
      )
      expect(body.causaDano).toBe("LIQUIDO")
      expect(body.presentadoAnte).toBe("La Segunda ART")
      expect(body.items).toEqual([])
    })
  })

  it("con initialData que trae el dictamen, los campos aparecen precargados", () => {
    stubFetch()
    renderForm({
      initialData: {
        id: "cot-1",
        items: [],
        veredicto: "IRREPARABLE",
        diagnosticoTecnico: "Sin reparación posible.",
        causaDano: "LIQUIDO",
        presentadoAnte: "La Segunda ART",
      },
    })

    expect(screen.getByRole("button", { name: "Irreparable" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue(
      "Sin reparación posible."
    )
    expect(screen.getByLabelText("Causa probable del daño")).toHaveTextContent(
      "Contacto con líquido"
    )
    expect(screen.getByLabelText("Para ser presentado ante")).toHaveValue("La Segunda ART")
    // Sin items, el documento es un informe: la tabla no se muestra.
    expect(screen.queryByText("Ítems")).not.toBeInTheDocument()
    expect(screen.getByText(AVISO_INFORME)).toBeInTheDocument()
  })

  it("en un documento nuevo colgado de una orden, el diagnostico se precarga desde la orden", async () => {
    stubFetch({
      "/api/ordenes/orden-1": { diagnostico: "Pantalla rota por caída, sin señales de humedad." },
    })

    renderForm()

    await waitFor(() => {
      expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue(
        "Pantalla rota por caída, sin señales de humedad."
      )
    })
  })

  it("en un documento en edicion, el diagnostico guardado no se pisa con el de la orden", async () => {
    const fetchMock = stubFetch({
      "/api/ordenes/orden-1": { diagnostico: "Diagnóstico distinto que vino de la orden." },
    })

    renderForm({
      initialData: {
        id: "cot-1",
        items: [],
        diagnosticoTecnico: "Diagnóstico ya guardado por el técnico.",
      },
    })

    // El guard corta antes del fetch: ni siquiera se llama a /api/ordenes/orden-1.
    expect(
      (fetchMock as any).mock.calls.some(([url]: [string]) =>
        String(url).includes("/api/ordenes/orden-1")
      )
    ).toBe(false)

    expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue(
      "Diagnóstico ya guardado por el técnico."
    )

    // Esperar un tick extra para descartar una sobreescritura asincronica tardia.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue(
      "Diagnóstico ya guardado por el técnico."
    )
  })
})
