import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react"

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock("sonner", () => ({ toast }))

import { BetaAndroidContent } from "@/app/superadmin/beta-android/_components/beta-android-content"

const TESTERS = [
  {
    id: "b1", email: "ana@gmail.com", estado: "PENDIENTE", created_at: "2026-10-10T10:00:00Z", agregado_at: null,
    usuario: { nombre: "Ana Gómez", email: "ana@taller.com" }, taller: "Taller Uno",
  },
  {
    id: "b2", email: "luis@mitaller.com", estado: "PENDIENTE", created_at: "2026-10-09T10:00:00Z", agregado_at: null,
    usuario: { nombre: "Luis Paz", email: "luis@mitaller.com" }, taller: "Taller Dos",
  },
  {
    id: "b3", email: "ya@gmail.com", estado: "AGREGADO", created_at: "2026-10-01T10:00:00Z", agregado_at: "2026-10-02T10:00:00Z",
    usuario: { nombre: "Yara", email: "yara@x.com" }, taller: "Taller Tres",
  },
  {
    id: "b4", email: "no@gmail.com", estado: "DESCARTADO", created_at: "2026-09-30T10:00:00Z", agregado_at: null,
    usuario: { nombre: "Nora", email: "nora@x.com" }, taller: "Taller Cuatro",
  },
]

const writeText = vi.fn().mockResolvedValue(undefined)

function respuesta(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response)
}

describe("Superadmin: Beta Android", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return respuesta({ actualizados: 1 })
      return respuesta({ testers: TESTERS })
    })
    vi.stubGlobal("fetch", fetchMock)
  })

  it("arranca mostrando los pendientes, con usuario y taller", async () => {
    render(<BetaAndroidContent />)
    expect(await screen.findByText("Ana Gómez")).toBeInTheDocument()
    expect(screen.getByText("Taller Uno")).toBeInTheDocument()
    expect(screen.getByText("Luis Paz")).toBeInTheDocument()
    // Los agregados y descartados no están en la vista inicial.
    expect(screen.queryByText("Yara")).not.toBeInTheDocument()
    expect(screen.queryByText("Nora")).not.toBeInTheDocument()
  })

  it("el filtro por estado cambia las filas", async () => {
    render(<BetaAndroidContent />)
    await screen.findByText("Ana Gómez")
    fireEvent.click(screen.getByRole("button", { name: /Agregados/ }))
    expect(screen.getByText("Yara")).toBeInTheDocument()
    expect(screen.queryByText("Ana Gómez")).not.toBeInTheDocument()
  })

  it("Copiar emails pendientes copia la lista separada por coma y avisa cuántos", async () => {
    render(<BetaAndroidContent />)
    await screen.findByText("Ana Gómez")
    fireEvent.click(screen.getByRole("button", { name: /Copiar emails pendientes/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ana@gmail.com,luis@mitaller.com"))
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("2"))
  })

  it("copia los pendientes aunque la vista esté filtrada por otro estado", async () => {
    render(<BetaAndroidContent />)
    await screen.findByText("Ana Gómez")
    fireEvent.click(screen.getByRole("button", { name: /Descartados/ }))
    fireEvent.click(screen.getByRole("button", { name: /Copiar emails pendientes/ }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("ana@gmail.com,luis@mitaller.com"))
  })

  it("si el portapapeles falla avisa con un error y no dice que copió", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"))
    render(<BetaAndroidContent />)
    await screen.findByText("Ana Gómez")
    fireEvent.click(screen.getByRole("button", { name: /Copiar emails pendientes/ }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(toast.success).not.toHaveBeenCalled()
  })

  it("sin pendientes el botón de copiar está deshabilitado", async () => {
    fetchMock.mockImplementation(() => respuesta({ testers: [TESTERS[2]] }))
    render(<BetaAndroidContent />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const boton = await screen.findByRole("button", { name: /Copiar emails pendientes/ })
    expect(boton).toBeDisabled()
  })

  it("Marcar como agregados manda PATCH con los ids seleccionados y recarga", async () => {
    render(<BetaAndroidContent />)
    const fila = (await screen.findByText("Ana Gómez")).closest("tr") as HTMLElement
    fireEvent.click(within(fila).getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /Marcar como agregados/ }))

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      expect(patch).toBeTruthy()
      expect(patch![0]).toBe("/api/superadmin/beta-android")
      expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({ ids: ["b1"], estado: "AGREGADO" })
    })
    // Después de escribir vuelve a pedir la lista.
    await waitFor(() => {
      const gets = fetchMock.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method)
      expect(gets.length).toBeGreaterThanOrEqual(2)
    })
  })

  it("Descartar manda PATCH con DESCARTADO", async () => {
    render(<BetaAndroidContent />)
    const fila = (await screen.findByText("Luis Paz")).closest("tr") as HTMLElement
    fireEvent.click(within(fila).getByRole("checkbox"))
    fireEvent.click(screen.getByRole("button", { name: /Descartar/ }))
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      expect(JSON.parse((patch![1] as RequestInit).body as string)).toEqual({ ids: ["b2"], estado: "DESCARTADO" })
    })
  })

  it("una selección de más de 200 se manda en lotes de 200 como máximo", async () => {
    const muchos = Array.from({ length: 250 }, (_, i) => ({
      id: `m${i}`, email: `m${i}@gmail.com`, estado: "PENDIENTE", created_at: "2026-10-10T10:00:00Z", agregado_at: null,
      usuario: { nombre: `Usuario ${i}`, email: `u${i}@x.com` }, taller: "Taller",
    }))
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? respuesta({ actualizados: 1 }) : respuesta({ testers: muchos })
    )
    render(<BetaAndroidContent />)
    await screen.findByText("Usuario 0")
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos" }))
    fireEvent.click(screen.getByRole("button", { name: /Marcar como agregados/ }))

    await waitFor(() => {
      const patches = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
      expect(patches).toHaveLength(2)
      const tamanos = patches.map(([, init]) => JSON.parse((init as RequestInit).body as string).ids.length)
      expect(tamanos).toEqual([200, 50])
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
  })

  it("si un lote falla corta, no sigue con los demás y recarga la lista", async () => {
    const muchos = Array.from({ length: 250 }, (_, i) => ({
      id: `m${i}`, email: `m${i}@gmail.com`, estado: "PENDIENTE", created_at: "2026-10-10T10:00:00Z", agregado_at: null,
      usuario: { nombre: `Usuario ${i}`, email: `u${i}@x.com` }, taller: "Taller",
    }))
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "PATCH" ? respuesta({ error: "boom" }, false) : respuesta({ testers: muchos })
    )
    render(<BetaAndroidContent />)
    await screen.findByText("Usuario 0")
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleccionar todos" }))
    fireEvent.click(screen.getByRole("button", { name: /Marcar como agregados/ }))

    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const patches = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")
    expect(patches).toHaveLength(1)
    expect(toast.success).not.toHaveBeenCalled()
    await waitFor(() => {
      const gets = fetchMock.mock.calls.filter(([, init]) => !(init as RequestInit | undefined)?.method)
      expect(gets.length).toBeGreaterThanOrEqual(2)
    })
  })

  it("sin selección no hay acciones de marcado", async () => {
    render(<BetaAndroidContent />)
    await screen.findByText("Ana Gómez")
    expect(screen.queryByRole("button", { name: /Marcar como agregados/ })).not.toBeInTheDocument()
  })
})
