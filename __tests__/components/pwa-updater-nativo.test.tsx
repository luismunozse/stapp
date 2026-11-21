/**
 * App nativa: no hay Service Worker, así que una versión nueva se detecta por
 * el build-id. Al volver a la app se recarga sola (la sesión sobrevive); si hay
 * algo a medio hacer, ofrece "Actualizar" en vez de tirarlo.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, waitFor, act } from "@testing-library/react"

const h = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock("sonner", () => ({ toast: h.toast }))
vi.mock("@/lib/capacitor", () => ({ isNativePlatform: () => true }))

import { PWAUpdater } from "@/components/pwa/pwa-updater"

const reload = vi.fn()

function volverALaApp() {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true })
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"))
  })
}

describe("PWAUpdater en la app nativa", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ""
    sessionStorage.clear()
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload, pathname: "/ordenes" },
      configurable: true,
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it("al volver a la app con una versión nueva, recarga sola", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildId: "nuevo" }) }))
    render(<PWAUpdater />)
    volverALaApp()
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  })

  it("con una ventana abierta no recarga: ofrece Actualizar", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildId: "nuevo" }) }))
    const dialogo = document.createElement("div")
    dialogo.setAttribute("role", "dialog")
    dialogo.setAttribute("data-state", "open")
    document.body.appendChild(dialogo)
    render(<PWAUpdater />)
    volverALaApp()
    await waitFor(() => expect(h.toast).toHaveBeenCalled())
    expect(reload).not.toHaveBeenCalled()
  })

  it("no recarga dos veces por la misma versión (sin bucles)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildId: "nuevo" }) }))
    sessionStorage.setItem("stapp-native-reload-for", "nuevo")
    render(<PWAUpdater />)
    volverALaApp()
    await waitFor(() => expect(h.toast).toHaveBeenCalled())
    expect(reload).not.toHaveBeenCalled()
  })

  it("misma versión: no hace nada", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }) }))
    render(<PWAUpdater />)
    volverALaApp()
    await new Promise((r) => setTimeout(r, 20))
    expect(reload).not.toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalled()
  })
})
