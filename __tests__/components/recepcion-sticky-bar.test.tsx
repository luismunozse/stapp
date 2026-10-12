/**
 * Cubre la barra de acciones sticky de RecepcionForm en mobile (< sm): hoy
 * "Agregar otro equipo" y "Crear recepcion" quedan debajo de dos tarjetas
 * muy largas -- invisibles en un celular real, al punto de que un usuario
 * penso que el limite era 2 equipos. RecepcionForm resuelve mobile vs
 * desktop con useIsMobileViewport (matchMedia "(max-width: 639.98px)",
 * mismo patron que useIsTouchDevice en date-picker.tsx): en desktop (default
 * de window.matchMedia en vitest.setup.ts, matches:false) solo existe el
 * boton inline de siempre; en mobile se monta la barra sticky con contador +
 * "Agregar otro equipo" + submit, y el boton inline NO se monta (evita
 * duplicar un control con el mismo nombre accesible, ademas de reflejar el
 * comportamiento real).
 *
 * Mismos mocks que recepcion-form-equipo-sync.test.tsx (RecepcionForm
 * depende de ClienteSelector y SignaturePad, que no son relevantes para lo
 * que estos tests verifican).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ModalProvider } from "@/contexts/modal-context"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

// Sesion real: con `data: null` useFormDraft se queda en ready=false y el
// formulario corre sin su camino de borrador, que no es el que este archivo
// verifica pero si el que monta/desmonta junto con la barra.
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", organizationId: "org-1" } } }),
}))

vi.mock("@/hooks/use-tipos-dispositivo", () => ({
  useTiposDispositivo: () => ({
    tipos: [
      {
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
  ClienteSelector: () => <div data-testid="cliente-selector-stub" />,
}))

vi.mock("@/components/firma/signature-pad", () => ({
  SignaturePad: () => <div data-testid="signature-pad-stub" />,
}))

/** Stub de MediaQueryList que soporta el addEventListener/removeEventListener
 *  que consume useIsMobileViewport. `matches` fijo: alcanza para estos tests,
 *  no hace falta simular un resize real a mitad de test. */
function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  )
}

describe("RecepcionForm — barra de acciones sticky en mobile", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve({ ok: true, json: async () => [] } as Response)),
    )
    // Con la sesion mockeada el formulario graba borradores de verdad: sin
    // limpiar, un test le restaura al siguiente los equipos que dejo cargados
    // y el contador arranca en otro numero.
    window.localStorage.clear()
  })

  // vi.stubGlobal("matchMedia", ...) y vi.stubGlobal("fetch", ...) quedarian
  // pisando los globals reales (o el stub de matchMedia de vitest.setup.ts)
  // para el resto de la suite si no se limpian entre tests.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("en mobile: el contador de equipos refleja la cantidad despues de agregar y quitar", async () => {
    mockMatchMedia(true)
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
    render(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )

    expect(screen.getByTestId("equipo-counter")).toHaveTextContent("2 equipos")

    fireEvent.click(screen.getByRole("button", { name: /Agregar otro equipo/i }))
    expect(screen.getByTestId("equipo-counter")).toHaveTextContent("3 equipos")

    fireEvent.click(screen.getByRole("button", { name: "Quitar equipo 3" }))
    expect(screen.getByTestId("equipo-counter")).toHaveTextContent("2 equipos")
  })

  it("en mobile: el boton \"Agregar otro equipo\" de la barra sticky agrega un equipo (mismo handler que desktop)", async () => {
    mockMatchMedia(true)
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
    render(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )

    const dispositivoInputs = () => screen.getAllByPlaceholderText("Ej: iPhone 13")
    expect(dispositivoInputs()).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: /Agregar otro equipo/i }))

    expect(dispositivoInputs()).toHaveLength(3)
  })

  it("en mobile: no se duplica el boton \"Agregar otro equipo\" (el inline no se monta)", async () => {
    mockMatchMedia(true)
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
    render(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )

    expect(screen.getAllByRole("button", { name: /Agregar otro equipo/i })).toHaveLength(1)
  })

  it("en desktop: sigue existiendo un unico boton \"Agregar otro equipo\" y no aparece el contador", async () => {
    mockMatchMedia(false)
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")
    render(
      <ModalProvider>
        <RecepcionForm />
      </ModalProvider>,
    )

    expect(screen.getAllByRole("button", { name: /Agregar otro equipo/i })).toHaveLength(1)
    expect(screen.queryByTestId("equipo-counter")).not.toBeInTheDocument()
  })

  it("hay un unico control de submit habilitado, en mobile y en desktop", async () => {
    // Sin vi.resetModules(): el hook lee window.matchMedia recien en su
    // useEffect (no en el top-level del modulo), asi que alcanza con
    // remontar con un stub distinto -- resetear modulos ademas rompe el
    // ModalProvider importado estaticamente arriba (quedaria en una
    // instancia de contexts/modal-context distinta a la que ve RecepcionForm
    // tras el reset).
    const { RecepcionForm } = await import("@/components/ordenes/recepcion-form")

    for (const matches of [true, false]) {
      mockMatchMedia(matches)
      const { unmount } = render(
        <ModalProvider>
          <RecepcionForm />
        </ModalProvider>,
      )

      const submits = screen.getAllByRole("button", { name: /Crear recepci/i })
      expect(submits).toHaveLength(1)
      expect(submits[0]).toBeEnabled()

      unmount()
    }
  })
})
