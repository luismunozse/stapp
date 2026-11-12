import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, renderHook, screen } from "@testing-library/react"
import { useState } from "react"
import {
  PRIORIDAD_CAPAS,
  SESSION_KEY,
  VENTANA_MS,
  __resetOrquestador,
  getActiva,
  registrar,
  retirar,
  type CapaId,
} from "@/lib/primer-ingreso/orquestador-capas"
import { useCapaPrioritaria } from "@/hooks/use-capa-prioritaria"

function cerrarVentana() {
  act(() => {
    vi.advanceTimersByTime(VENTANA_MS)
  })
}

/** Simula una capa: se muestra solo si el orquestador le da el turno. */
function Capa({ id, quiere = true }: { id: CapaId; quiere?: boolean }) {
  const permitido = useCapaPrioritaria(id, quiere)
  return permitido ? <div data-testid="capa">{id}</div> : null
}

describe("orquestador de capas de primer ingreso", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.sessionStorage.clear()
    __resetOrquestador()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("define el orden de prioridad en un solo lugar", () => {
    expect(PRIORIDAD_CAPAS).toEqual(["tour", "novedades", "politicas", "apk-beta", "pwa-instalar"])
  })

  it("con las cinco capas postuladas muestra una sola: la de mayor prioridad", () => {
    render(
      <>
        <Capa id="pwa-instalar" />
        <Capa id="apk-beta" />
        <Capa id="politicas" />
        <Capa id="novedades" />
        <Capa id="tour" />
      </>
    )
    // Durante la ventana no se muestra ninguna.
    expect(screen.queryAllByTestId("capa")).toHaveLength(0)
    cerrarVentana()
    const visibles = screen.getAllByTestId("capa")
    expect(visibles).toHaveLength(1)
    expect(visibles[0]).toHaveTextContent("tour")
  })

  it("una capa que llega tarde dentro de la ventana le gana a una de menor prioridad", () => {
    render(<Capa id="pwa-instalar" />)
    act(() => {
      vi.advanceTimersByTime(VENTANA_MS - 100)
    })
    render(<Capa id="novedades" />)
    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(screen.getAllByTestId("capa").map((n) => n.textContent)).toEqual(["novedades"])
  })

  it("después de la ventana, una capa nueva no desplaza a la que ya se está mostrando", () => {
    render(<Capa id="apk-beta" />)
    cerrarVentana()
    render(<Capa id="tour" />)
    act(() => {
      vi.advanceTimersByTime(VENTANA_MS * 2)
    })
    expect(screen.getAllByTestId("capa").map((n) => n.textContent)).toEqual(["apk-beta"])
  })

  it("si nadie ganó en la ventana, la primera que se postula después gana en el acto", () => {
    registrar("politicas")
    retirar("politicas")
    cerrarVentana()
    expect(getActiva()).toBeNull()

    render(<Capa id="pwa-instalar" />)
    expect(screen.getByTestId("capa")).toHaveTextContent("pwa-instalar")
  })

  it("una capa que no quiere mostrarse no se postula", () => {
    render(
      <>
        <Capa id="tour" quiere={false} />
        <Capa id="politicas" />
      </>
    )
    cerrarVentana()
    expect(screen.getAllByTestId("capa").map((n) => n.textContent)).toEqual(["politicas"])
  })

  it("al cerrar la ganadora no aparece otra en la misma sesión", () => {
    function CapaCerrable({ id }: { id: CapaId }) {
      const [quiere, setQuiere] = useState(true)
      const permitido = useCapaPrioritaria(id, quiere)
      return permitido ? (
        <button data-testid="capa" onClick={() => setQuiere(false)}>
          {id}
        </button>
      ) : null
    }
    render(
      <>
        <CapaCerrable id="novedades" />
        <Capa id="politicas" />
      </>
    )
    cerrarVentana()
    act(() => {
      screen.getByTestId("capa").click()
    })
    act(() => {
      vi.advanceTimersByTime(VENTANA_MS * 2)
    })
    expect(screen.queryAllByTestId("capa")).toHaveLength(0)
  })

  it("guarda la ganadora en sessionStorage", () => {
    render(<Capa id="novedades" />)
    cerrarVentana()
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBe("novedades")
  })

  it("en la misma sesión (recarga) respeta la capa ya elegida y no espera la ventana", () => {
    window.sessionStorage.setItem(SESSION_KEY, "politicas")
    render(
      <>
        <Capa id="tour" />
        <Capa id="politicas" />
      </>
    )
    expect(screen.getAllByTestId("capa").map((n) => n.textContent)).toEqual(["politicas"])
    cerrarVentana()
    expect(screen.getAllByTestId("capa").map((n) => n.textContent)).toEqual(["politicas"])
  })

  it("si la sesión ya se la dio a una capa que hoy no se postula, no muestra ninguna", () => {
    window.sessionStorage.setItem(SESSION_KEY, "tour")
    render(<Capa id="novedades" />)
    cerrarVentana()
    expect(screen.queryAllByTestId("capa")).toHaveLength(0)
  })

  it("ignora valores desconocidos en sessionStorage", () => {
    window.sessionStorage.setItem(SESSION_KEY, "cualquier-cosa")
    render(<Capa id="apk-beta" />)
    cerrarVentana()
    expect(screen.getByTestId("capa")).toHaveTextContent("apk-beta")
  })

  it("si sessionStorage tira error igual muestra una sola capa", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado")
    })
    render(
      <>
        <Capa id="pwa-instalar" />
        <Capa id="novedades" />
      </>
    )
    cerrarVentana()
    expect(screen.getAllByTestId("capa").map((n) => n.textContent)).toEqual(["novedades"])
  })

  it("antes de que cierre la ventana no le da el turno a nadie", () => {
    const { result } = renderHook(() => useCapaPrioritaria("tour", true))
    expect(result.current).toBe(false)
    cerrarVentana()
    expect(result.current).toBe(true)
  })
})
