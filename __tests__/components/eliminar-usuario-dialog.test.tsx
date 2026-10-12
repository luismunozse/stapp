import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/components/perfil/cerrar-sesion-tras-baja", () => ({ cerrarSesionTrasBaja: vi.fn().mockResolvedValue(undefined) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { cerrarSesionTrasBaja } from "@/components/perfil/cerrar-sesion-tras-baja"
import { EliminarUsuarioDialog } from "@/components/perfil/eliminar-usuario-dialog"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const info = (over: Partial<DeletionInfo> = {}): DeletionInfo => ({
  role: "TECNICO", slug: "taller-uno", orgName: "Taller Uno",
  isLastAdmin: false, hasPassword: true, totpEnabled: false, graceDays: 30, ...over,
})

const boton = () => screen.getByRole("button", { name: /eliminar mi usuario/i })
const res = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })

const completarYEnviar = (over: Partial<DeletionInfo> = {}) => {
  render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info(over)} />)
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "abc" } })
  fireEvent.click(boton())
}

describe("EliminarUsuarioDialog", () => {
  beforeEach(() => vi.clearAllMocks())

  it("explica qué se borra y qué se conserva", () => {
    render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info()} />)
    expect(screen.getByText(/Usuario eliminado/)).toBeInTheDocument()
    expect(screen.getByText(/30 días/)).toBeInTheDocument()
  })

  it("el botón queda deshabilitado hasta completar la contraseña", () => {
    render(<EliminarUsuarioDialog open onOpenChange={() => {}} info={info()} />)
    expect(boton()).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: "abc" } })
    expect(boton()).toBeEnabled()
  })

  it("éxito: manda la reautenticación, avisa y cierra la sesión", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ success: true }, 200))
    vi.stubGlobal("fetch", fetchMock)
    completarYEnviar()
    await waitFor(() => expect(cerrarSesionTrasBaja).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete-user", expect.objectContaining({
      method: "POST", body: JSON.stringify({ password: "abc" }),
    }))
  })

  it("no permite doble envío mientras la petición está pendiente", async () => {
    let resolver!: (r: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => { resolver = r }))
    vi.stubGlobal("fetch", fetchMock)
    completarYEnviar()
    fireEvent.click(boton())
    fireEvent.click(boton())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(boton()).toBeDisabled()
    resolver(res({ success: true }, 200))
    await waitFor(() => expect(cerrarSesionTrasBaja).toHaveBeenCalled())
  })

  it("contraseña incorrecta: muestra el error del servidor y NO cierra la sesión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "Contraseña incorrecta", code: "WRONG_CREDENTIAL" }, 401)))
    completarYEnviar()
    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña incorrecta")
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })

  it("cuenta bloqueada (429): muestra el mensaje de reautenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ code: "ACCOUNT_LOCKED" }, 429)))
    completarYEnviar()
    expect(await screen.findByRole("alert")).toHaveTextContent(/demasiados intentos/i)
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })

  it("último ADMIN (409): explica que hay que eliminar el taller o transferir el rol", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ code: "LAST_ADMIN", error: "x" }, 409)))
    completarYEnviar({ role: "ADMIN", isLastAdmin: true })
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(/eliminar el taller/i)
    expect(alert).toHaveTextContent(/transferir/i)
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })

  it("403: mensaje genérico de acción no permitida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "forbidden" }, 403)))
    completarYEnviar()
    expect(await screen.findByRole("alert")).toHaveTextContent(/no está permitida/i)
  })

  it("500: muestra el error del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "Error interno" }, 500)))
    completarYEnviar()
    expect(await screen.findByRole("alert")).toHaveTextContent("Error interno")
    expect(boton()).toBeEnabled()
  })

  it("error de red: mensaje de reintento y vuelve a habilitar el botón", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    completarYEnviar()
    expect(await screen.findByRole("alert")).toHaveTextContent(/conexión/i)
    expect(boton()).toBeEnabled()
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })
})
