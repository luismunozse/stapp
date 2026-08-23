/**
 * Tests: SucursalSwitcher — cambiar de sucursal no espera ningún borrado.
 *
 * Hubo un `await clearServiceWorkerApiCache()` acá: la sucursal activa vive en
 * una cookie httpOnly, así que este es el único punto del cliente que la ve
 * cambiar, y lo que el service worker tuviera guardado quedaba escopeado a la
 * sucursal anterior.
 *
 * Ya no hay nada que borrar: CACHEABLE_API_ROUTES quedó vacía (ver SW-0), así
 * que ninguna respuesta de API se guarda — mucho menos una escopeada por
 * sucursal. Esperar la confirmación del worker le costaba al operador hasta
 * 1500 ms en cada cambio de sucursal, en un equipo lento, por una limpieza sin
 * nada que limpiar.
 *
 * Si alguna vez vuelve a entrar una ruta escopeada por sucursal a esa lista,
 * hace falta volver a limpiar acá (o meter la sucursal en la clave del caché);
 * está anotado arriba de la constante en public/sw.js.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

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

describe("SucursalSwitcher — cambio de sucursal", () => {
  it("SS-1 — recarga sin esperar ningun borrado de cache", async () => {
    render(<SucursalSwitcher />)

    // El trigger abre con click (aria-haspopup="dialog"), no con el pointerdown
    // que jsdom no sabe construir.
    const trigger = await screen.findByRole("button")
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByText("Sucursal Norte"))

    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(clearServiceWorkerApiCache).not.toHaveBeenCalled()
    expect(window.localStorage.getItem("sucursal-activa-ui")).toBe("suc-B")
  })
})
