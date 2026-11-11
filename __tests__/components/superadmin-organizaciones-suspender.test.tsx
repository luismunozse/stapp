/**
 * Suspender una organización desde la lista: la API exige `reason` al
 * desactivar (toggle-status responde 400 sin él), así que el diálogo tiene que
 * pedirlo y mandarlo. Antes mandaba solo `{ activo: false }` y fallaba siempre.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import OrganizacionesPage from "@/app/superadmin/organizaciones/page"

const ORG = (id: string, nombre: string, activo: boolean) => ({
  id, nombre, slug: id, email: null, telefono: null, activo,
  created_at: "2026-10-01T10:00:00Z", usersCount: 1, last_activity_at: null, subscription: null,
})

function respuesta(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) } as Response)
}

const toggleCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes("/toggle-status"))

describe("Superadmin: suspender organización desde la lista", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("/toggle-status")) return respuesta({ success: true })
      if (init?.method && init.method !== "GET") return respuesta({})
      return respuesta({
        organizations: [ORG("org-a", "Taller Activo", true), ORG("org-b", "Taller Inactivo", false)],
        total: 2,
      })
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  it("pide el motivo y lo manda; sin motivo no deja confirmar", async () => {
    render(<OrganizacionesPage />)
    await screen.findAllByText("Taller Activo")

    fireEvent.click(screen.getAllByTitle("Desactivar")[0])
    const dialog = await screen.findByRole("dialog")
    const confirmar = within(dialog).getByRole("button", { name: /Desactivar/ })
    expect(confirmar).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText("Motivo de la suspensión"), {
      target: { value: "  falta de pago  " },
    })
    expect(confirmar).toBeEnabled()
    fireEvent.click(confirmar)

    await waitFor(() => expect(toggleCalls(fetchMock)).toHaveLength(1))
    const [url, init] = toggleCalls(fetchMock)[0]
    expect(url).toBe("/api/superadmin/organizations/org-a/toggle-status")
    expect(JSON.parse(String(init.body))).toEqual({ activo: false, reason: "falta de pago" })
  })

  it("reactivar no pide motivo ni lo manda", async () => {
    render(<OrganizacionesPage />)
    await screen.findAllByText("Taller Inactivo")

    fireEvent.click(screen.getAllByTitle("Activar")[0])

    await waitFor(() => expect(toggleCalls(fetchMock)).toHaveLength(1))
    expect(JSON.parse(String(toggleCalls(fetchMock)[0][1].body))).toEqual({ activo: true })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })
})
