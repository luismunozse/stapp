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

// FIX 4: la sección "Informe técnico" ya no arranca expandida para todos —
// solo cuando el documento ya trae algo cargado (veredicto, entidad,
// diagnostico o causa). Un documento nuevo arranca colapsado, asi que los
// tests que lo tocan sin `initialData` (o con `initialData` que no trae
// ninguno de esos cuatro campos) tienen que abrirlo a mano primero, igual que
// haria un usuario real clickeando el encabezado de la sección.
const abrirSeccionInforme = () =>
  fireEvent.click(screen.getByRole("button", { name: "Informe técnico" }))

describe("CotizacionForm — seccion Informe técnico", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("elegir 'Irreparable' colapsa la tabla de items y muestra el aviso", () => {
    stubFetch()
    renderForm()
    abrirSeccionInforme()

    // Antes de elegir el veredicto la tabla de items esta visible.
    expect(screen.getByText("Ítems")).toBeInTheDocument()
    expect(screen.queryByText(AVISO_INFORME)).not.toBeInTheDocument()

    const botonIrreparable = screen.getByRole("button", { name: "Irreparable" })
    fireEvent.click(botonIrreparable)

    expect(screen.queryByText("Ítems")).not.toBeInTheDocument()
    expect(screen.getByText(AVISO_INFORME)).toBeInTheDocument()
    expect(botonIrreparable).toHaveAttribute("aria-pressed", "true")

    // Clickear el mismo boton lo deselecciona: un click accidental no puede
    // quedar pegado para siempre sin forma de corregirlo desde la UI.
    fireEvent.click(botonIrreparable)

    expect(botonIrreparable).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByText("Ítems")).toBeInTheDocument()
    expect(screen.queryByText(AVISO_INFORME)).not.toBeInTheDocument()
  })

  it("el payload enviado incluye veredicto, diagnosticoTecnico, causaDano y presentadoAnte", async () => {
    const fetchMock = stubFetch()
    renderForm()
    abrirSeccionInforme()

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

  it("vaciar un diagnostico y una entidad ya guardados manda null explicito, no undefined ni ausente", async () => {
    // El PUT decide con `!== undefined` si toca la columna: una clave AUSENTE
    // (lo que hace `JSON.stringify` con `undefined`) significa "no tocar" y
    // deja el valor viejo. Solo `null` explicito limpia. Si esto quedara como
    // `|| undefined`, un taller que borra el diagnostico/entidad los ve
    // "borrados" en pantalla pero el PDF sigue imprimiendo los valores viejos.
    const fetchMock = stubFetch()
    renderForm({
      initialData: {
        id: "cot-1",
        items: [
          { id: "item-1", descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 },
        ],
        diagnosticoTecnico: "Diagnóstico previo del técnico.",
        presentadoAnte: "La Segunda ART",
      },
    })

    fireEvent.change(screen.getByLabelText("Diagnóstico del informe técnico"), {
      target: { value: "" },
    })
    fireEvent.change(screen.getByLabelText("Para ser presentado ante"), {
      target: { value: "" },
    })

    fireEvent.click(screen.getByRole("button", { name: "Actualizar Cotización" }))

    await waitFor(() => {
      const putCall = (fetchMock as any).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "PUT"
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse((putCall as any)[1].body)
      // La diferencia entre las tres cosas (valor, null, ausente) es
      // exactamente el bug: `toBeNull` no alcanza sola, porque `undefined`
      // tambien fallaria esa aserción distinto según cómo lo compare Jest —
      // se verifica también que la clave sobrevivió al JSON.stringify.
      expect("diagnosticoTecnico" in body).toBe(true)
      expect("presentadoAnte" in body).toBe(true)
      expect(body.diagnosticoTecnico).toBeNull()
      expect(body.presentadoAnte).toBeNull()
    })
  })

  it("volver la causa del daño a 'Sin especificar' manda causaDano: null", async () => {
    // Mismo patron que el veredicto y el diagnostico/entidad: una vez elegida
    // la causa, la UI tiene que poder volver a vacío, y ese vacío tiene que
    // llegar al servidor como null (no quedarse pegado el valor viejo).
    const fetchMock = stubFetch()
    renderForm({
      initialData: {
        id: "cot-1",
        items: [
          { id: "item-1", descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 },
        ],
        causaDano: "LIQUIDO",
      },
    })

    fireEvent.click(screen.getByLabelText("Causa probable del daño"))
    fireEvent.click(await screen.findByRole("option", { name: "Sin especificar" }))

    fireEvent.click(screen.getByRole("button", { name: "Actualizar Cotización" }))

    await waitFor(() => {
      const putCall = (fetchMock as any).mock.calls.find(
        ([, opts]: [string, RequestInit]) => opts?.method === "PUT"
      )
      expect(putCall).toBeDefined()
      const body = JSON.parse((putCall as any)[1].body)
      expect("causaDano" in body).toBe(true)
      expect(body.causaDano).toBeNull()
    })
  })

  it("una cotizacion normal (sin veredicto) sin items validos sigue avisando y bloqueando el envio", async () => {
    const fetchMock = stubFetch()
    renderForm()

    // No se toca el veredicto: sinPresupuesto es false y el item por defecto
    // (descripcion vacia, precio 0) no es valido. El guard que se toco en el
    // fix del informe (`!sinPresupuesto && validItems.length === 0`) tiene que
    // seguir bloqueando este caso exactamente como antes.
    fireEvent.click(screen.getByRole("button", { name: "Crear Cotización" }))

    expect(await screen.findByText("Debe agregar al menos un item válido")).toBeInTheDocument()
    expect(
      (fetchMock as any).mock.calls.some(([, opts]: [string, RequestInit]) => opts?.method === "POST")
    ).toBe(false)
  })

  it("elegir IRREPARABLE y volver a REPARABLE restaura los items cargados", () => {
    stubFetch()
    renderForm({
      initialData: {
        id: "cot-1",
        items: [
          { id: "item-1", descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 },
        ],
      },
    })
    abrirSeccionInforme()

    // El item cargado esta visible antes de tocar el veredicto.
    expect(screen.getAllByDisplayValue("Cambio de pantalla").length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole("button", { name: "Irreparable" }))
    expect(screen.queryAllByDisplayValue("Cambio de pantalla")).toHaveLength(0)

    // Volver a un veredicto reparable no descarta `items`: el estado nunca se
    // tocó, solo se dejó de mostrar la tabla.
    fireEvent.click(screen.getByRole("button", { name: "Reparable" }))
    expect(screen.getAllByDisplayValue("Cambio de pantalla").length).toBeGreaterThan(0)
  })

  // FIX 2 (HIGH): dentro de la sesion, `items` nunca se toca (el test de
  // arriba lo prueba: deseleccionar el veredicto restaura la tabla tal cual
  // estaba). Pero el PUT borra y reinserta items_cotizacion en CADA guardado,
  // asi que un Guardar con el veredicto puesto SI las pierde de verdad. El
  // aviso tiene que nombrar cuantas filas se van a borrar para que la perdida
  // sea explicita antes de que pase, no solo un "sin presupuesto ni items"
  // generico que no distingue un documento nuevo de uno con doce lineas.
  it("con items cargados, el aviso nombra cuantos se van a eliminar al guardar", () => {
    stubFetch()
    renderForm({
      initialData: {
        id: "cot-1",
        items: [
          { id: "item-1", descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 },
          { id: "item-2", descripcion: "Cambio de batería", cantidad: 1, precioUnitario: 30000 },
        ],
      },
    })
    abrirSeccionInforme()

    fireEvent.click(screen.getByRole("button", { name: "Irreparable" }))

    expect(
      screen.getByText("Al guardar se van a eliminar los 2 ítems cargados.")
    ).toBeInTheDocument()
  })

  it("con un solo item cargado, el aviso usa singular", () => {
    stubFetch()
    renderForm({
      initialData: {
        id: "cot-1",
        items: [
          { id: "item-1", descripcion: "Cambio de pantalla", cantidad: 1, precioUnitario: 50000 },
        ],
      },
    })
    abrirSeccionInforme()

    fireEvent.click(screen.getByRole("button", { name: "Irreparable" }))

    expect(
      screen.getByText("Al guardar se va a eliminar el ítem cargado.")
    ).toBeInTheDocument()
  })

  it("en un documento nuevo (fila default vacia), el aviso no nombra ninguna cantidad", () => {
    stubFetch()
    renderForm()
    abrirSeccionInforme()

    fireEvent.click(screen.getByRole("button", { name: "Irreparable" }))

    expect(screen.getByText(AVISO_INFORME)).toBeInTheDocument()
    expect(screen.queryByText(/eliminar/)).not.toBeInTheDocument()
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
    // La seccion arranca colapsada (documento nuevo, nada cargado todavia): el
    // fetch que trae el diagnostico de la orden resuelve DESPUES del primer
    // render, y `defaultOpen` solo se evalua una vez, al montar -- abrirla a
    // mano es lo que haria un usuario real antes de esperar el valor.
    abrirSeccionInforme()

    await waitFor(() => {
      expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue(
        "Pantalla rota por caída, sin señales de humedad."
      )
    })
  })

  it("en un documento en edicion con diagnostico ya guardado, no se pisa con el de la orden", async () => {
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

  it("en un documento en edicion con diagnostico vacio, tampoco resincroniza desde la orden", () => {
    // Este caso aisla la causa real: si solo importara que el campo esta
    // vacio (y no `isEditing`), este test fallaria igual que fallaria borrar
    // el guard de `isEditing` sin que el anterior lo notara. Un documento ya
    // emitido no puede autosincronizarse, tenga o no diagnostico cargado.
    const fetchMock = stubFetch({
      "/api/ordenes/orden-1": { diagnostico: "Diagnóstico que vendría de la orden." },
    })

    renderForm({
      initialData: {
        id: "cot-1",
        items: [],
        diagnosticoTecnico: "",
      },
    })
    // Vacio ("") es falsy: la seccion arranca colapsada igual que un
    // documento nuevo, aunque el campo ya exista en `initialData`.
    abrirSeccionInforme()

    expect(
      (fetchMock as any).mock.calls.some(([url]: [string]) =>
        String(url).includes("/api/ordenes/orden-1")
      )
    ).toBe(false)
    expect(screen.getByLabelText("Diagnóstico del informe técnico")).toHaveValue("")
  })
})
