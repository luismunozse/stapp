import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import type { ReactNode } from "react"

const toastMock = vi.fn()
vi.mock("sonner", () => ({ toast: (...a: unknown[]) => toastMock(...a) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "u1", organizationId: "org1" } } }),
}))

import { useNotifications, INTERVALO_NOTIFICACIONES_MS } from "@/hooks/use-notifications"

type N = { id: string; title: string; body: string; read_at: string | null; action_url: string | null }
const notif = (id: string, read_at: string | null = null): N => ({ id, title: `t-${id}`, body: "b", read_at, action_url: null })

let conteo = 0
let lista: N[] = []

function responder(url: string) {
  if (url.includes("unread-count")) return { count: conteo }
  if (url.startsWith("/api/user-notifications?")) return { notifications: lista, nextCursor: null }
  return {}
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  toastMock.mockReset()
  conteo = 1
  lista = [notif("vieja")]
  vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ json: async () => responder(url) })))
  vi.stubGlobal("Audio", vi.fn(() => ({ play: () => Promise.resolve(), volume: 1 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const pasarIntervalo = () => act(async () => { await vi.advanceTimersByTimeAsync(INTERVALO_NOTIFICACIONES_MS + 50) })

describe("useNotifications por polling", () => {
  it("no usa Supabase Realtime", async () => {
    const fs = await import("node:fs")
    const src = fs.readFileSync("hooks/use-notifications.ts", "utf8")
    expect(src).not.toMatch(/postgres_changes|getSupabaseClient|\.channel\(/)
  })

  it("no avisa lo que ya estaba al cargar", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    await waitFor(() => expect(result.current.unreadCount).toBe(1))
    expect(toastMock).not.toHaveBeenCalled()
  })

  it("si el contador sube, recarga la lista y avisa solo la nueva", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    await waitFor(() => expect(result.current.unreadCount).toBe(1))

    conteo = 2
    lista = [notif("nueva"), notif("vieja")]
    await pasarIntervalo()

    await waitFor(() => expect(result.current.notifications).toHaveLength(2))
    expect(toastMock).toHaveBeenCalledTimes(1)
    expect(toastMock.mock.calls[0][0]).toBe("t-nueva")
  })

  it("después de marcar como leída, una nueva que empata el conteo viejo igual se avisa", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(result.current.notifications).toHaveLength(1))
    await waitFor(() => expect(result.current.unreadCount).toBe(1))

    act(() => { result.current.markAsRead("vieja") })
    // En el servidor: la vieja leída y llegó una nueva -> el conteo vuelve a 1.
    conteo = 1
    lista = [notif("nueva"), notif("vieja", "2026-11-11T00:00:00Z")]
    await pasarIntervalo()

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1))
    expect(toastMock.mock.calls[0][0]).toBe("t-nueva")
  })

  it("si el contador no sube, no recarga la lista", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(result.current.unreadCount).toBe(1))
    const fetchMock = vi.mocked(fetch)
    const listasAntes = fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/user-notifications?")).length

    await pasarIntervalo()

    const listasDespues = fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/user-notifications?")).length
    expect(listasDespues).toBe(listasAntes)
    expect(toastMock).not.toHaveBeenCalled()
  })
})
