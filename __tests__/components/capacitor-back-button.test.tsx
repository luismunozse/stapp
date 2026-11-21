/**
 * Botón Atrás de Android en la app nativa: en el Inicio minimiza (antes
 * "volvía" al /login que quedaba en el historial y parecía cerrar la sesión);
 * en otra pantalla vuelve, o va al Inicio si no hay a dónde volver.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, waitFor } from "@testing-library/react"

const h = vi.hoisted(() => ({
  pathname: "/dashboard",
  back: vi.fn(),
  replace: vi.fn(),
  minimizeApp: vi.fn(),
  exitApp: vi.fn(),
  listener: null as null | ((e: { canGoBack: boolean }) => void),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back: h.back, replace: h.replace }),
  usePathname: () => h.pathname,
}))
vi.mock("@/lib/capacitor", () => ({ isNativePlatform: () => true }))
vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async (_: string, cb: (e: { canGoBack: boolean }) => void) => {
      h.listener = cb
      return { remove: vi.fn() }
    }),
    minimizeApp: h.minimizeApp,
    exitApp: h.exitApp,
  },
}))

import { CapacitorBackButtonHandler } from "@/components/capacitor/back-button-handler"

async function montar(pathname: string) {
  h.pathname = pathname
  h.listener = null
  render(<CapacitorBackButtonHandler />)
  await waitFor(() => expect(h.listener).not.toBeNull())
  return h.listener!
}

describe("CapacitorBackButtonHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  it("en el Inicio minimiza la app aunque haya historial (no vuelve al login)", async () => {
    const atras = await montar("/dashboard")
    atras({ canGoBack: true })
    expect(h.minimizeApp).toHaveBeenCalledTimes(1)
    expect(h.back).not.toHaveBeenCalled()
    expect(h.exitApp).not.toHaveBeenCalled()
  })

  it("en otra pantalla vuelve a la anterior", async () => {
    const atras = await montar("/ordenes")
    atras({ canGoBack: true })
    expect(h.back).toHaveBeenCalledTimes(1)
  })

  it("sin historial va al Inicio en vez de salir", async () => {
    const atras = await montar("/ordenes/123")
    atras({ canGoBack: false })
    expect(h.replace).toHaveBeenCalledWith("/dashboard")
    expect(h.exitApp).not.toHaveBeenCalled()
  })

  it("una pantalla que maneja app:back (alta de orden) no navega", async () => {
    const atras = await montar("/ordenes")
    const onBack = (e: Event) => e.preventDefault()
    window.addEventListener("app:back", onBack)
    atras({ canGoBack: true })
    window.removeEventListener("app:back", onBack)
    expect(h.back).not.toHaveBeenCalled()
  })
})
