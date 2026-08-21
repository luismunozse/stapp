/**
 * Tests: SucursalSwitcher — dropping the SW API cache before reloading.
 *
 * The active sucursal lives in an httpOnly cookie, so the switcher is the only
 * place on the client that knows it changed. Whatever the service worker stored
 * is scoped to the PREVIOUS branch and keyed by URL alone, so the reload right
 * below would be served those same entries.
 *
 * The ordering is the whole point: firing the clear and reloading in the same
 * breath tears the page down before the worker has answered, so the clear may
 * never happen at all. It has to be awaited — and the helper carries its own
 * timeout, so awaiting it cannot strand the operator on a spinner.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { role: "ADMIN" } }, status: "authenticated" }),
}))

const clearServiceWorkerApiCache = vi.fn()
vi.mock("@/lib/sw-cache", () => ({
  clearServiceWorkerApiCache: () => clearServiceWorkerApiCache(),
}))

import { SucursalSwitcher } from "@/components/layout/sucursal-switcher"

const SUCURSALES = [
  { id: "suc-A", nombre: "Casa Central", principal: true },
  { id: "suc-B", nombre: "Sucursal Norte", principal: false },
]

let reload: ReturnType<typeof vi.fn>
let locationOriginal: Location

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()

  global.fetch = vi.fn(async (input: any) => {
    const url = String(input)
    if (url.includes("set-activa")) return { ok: true, json: async () => ({}) } as Response
    return { ok: true, json: async () => ({ data: SUCURSALES }) } as Response
  }) as any

  reload = vi.fn()
  locationOriginal = window.location
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  })
})

afterEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: locationOriginal })
})

/** Abre el menu y elige "Sucursal Norte". */
async function elegirOtraSucursal() {
  // El trigger de este dropdown abre con click (aria-haspopup="dialog"), no con
  // el pointerdown que jsdom no sabe construir.
  const trigger = await screen.findByRole("button")
  fireEvent.click(trigger)
  const item = await screen.findByText("Sucursal Norte")
  fireEvent.click(item)
}

describe("SucursalSwitcher — limpieza del cache al cambiar de sucursal", () => {
  it("SS-1 — no recarga hasta que el worker confirma el borrado", async () => {
    let confirmarBorrado: (() => void) | null = null
    clearServiceWorkerApiCache.mockReturnValue(
      new Promise<boolean>((resolve) => {
        confirmarBorrado = () => resolve(true)
      })
    )

    render(<SucursalSwitcher />)
    await elegirOtraSucursal()

    await waitFor(() => expect(clearServiceWorkerApiCache).toHaveBeenCalled())
    // Todavia no: recargar ahora se lleva puesta la limpieza a medio camino.
    expect(reload).not.toHaveBeenCalled()

    await act(async () => {
      confirmarBorrado!()
    })

    await waitFor(() => expect(reload).toHaveBeenCalled())
  })

  it("SS-2 — si el borrado no se puede confirmar, igual recarga (no deja al operador colgado)", async () => {
    // El helper resuelve false por su cuenta (sin controller, o timeout): el
    // cambio de sucursal tiene que completarse igual.
    clearServiceWorkerApiCache.mockResolvedValue(false)

    render(<SucursalSwitcher />)
    await elegirOtraSucursal()

    await waitFor(() => expect(reload).toHaveBeenCalled())
  })
})
