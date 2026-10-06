import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

vi.mock("@/components/perfil/cerrar-sesion-tras-baja", () => ({ cerrarSesionTrasBaja: vi.fn().mockResolvedValue(undefined) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/csv-export", () => ({ triggerDownload: vi.fn().mockResolvedValue(undefined) }))

import { cerrarSesionTrasBaja } from "@/components/perfil/cerrar-sesion-tras-baja"
import { triggerDownload } from "@/lib/csv-export"
import { EliminarTallerDialog } from "@/components/perfil/eliminar-taller-dialog"
import type { DeletionInfo } from "@/lib/account-deletion/types"

const info: DeletionInfo = {
  role: "ADMIN", slug: "taller-uno", orgName: "Taller Uno",
  isLastAdmin: false, hasPassword: true, totpEnabled: false, graceDays: 30,
}
const boton = () => screen.getByRole("button", { name: /eliminar el taller/i })
const res = (body: unknown, status: number) => new Response(JSON.stringify(body), { status })
const checkbox = () => screen.getByLabelText(/descargué mi respaldo/i) as HTMLInputElement

function llenar({ backup = true, slug = "taller-uno", password = "abc" } = {}) {
  if (backup) fireEvent.click(checkbox())
  fireEvent.change(screen.getByLabelText(/subdominio del taller/i), { target: { value: slug } })
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: password } })
}

const renderDialog = () => render(<EliminarTallerDialog open onOpenChange={() => {}} info={info} />)

describe("EliminarTallerDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it("ofrece el respaldo y recuerda que la documentación fiscal es del taller", () => {
    renderDialog()
    expect(screen.getByRole("button", { name: /descargar respaldo/i })).toBeInTheDocument()
    expect(screen.getByText(/obligación del taller/i)).toBeInTheDocument()
    expect(screen.getAllByText(/30 días/).length).toBeGreaterThan(0)
  })

  it("respaldo OK: descarga el ZIP y tilda 'Descargué mi respaldo'", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["zip"]), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo/i }))
    await waitFor(() => expect(checkbox().checked).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith("/api/account/export")
    expect(triggerDownload).toHaveBeenCalledTimes(1)
    expect(vi.mocked(triggerDownload).mock.calls[0][1]).toBe("respaldo-taller-uno.zip")
  })

  it("respaldo con status de error: avisa y NO tilda el checkbox", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "Demasiado grande" }, 413)))
    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Demasiado grande/)
    expect(checkbox().checked).toBe(false)
    expect(triggerDownload).not.toHaveBeenCalled()
  })

  it("respaldo con error de red o de stream: avisa y NO tilda el checkbox", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo/i }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/respaldo/i)
    expect(checkbox().checked).toBe(false)
  })

  it("tras fallar el respaldo se puede tildar a mano y seguir", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({}, 500)))
    renderDialog()
    fireEvent.click(screen.getByRole("button", { name: /descargar respaldo/i }))
    await screen.findByRole("alert")
    llenar()
    expect(boton()).toBeEnabled()
  })

  it("no habilita el botón sin tildar el respaldo", () => {
    renderDialog()
    llenar({ backup: false })
    expect(boton()).toBeDisabled()
  })

  it("no habilita el botón si el subdominio no coincide", () => {
    renderDialog()
    llenar({ slug: "otro" })
    expect(boton()).toBeDisabled()
  })

  it("no habilita el botón sin reautenticación", () => {
    renderDialog()
    llenar({ password: "" })
    expect(boton()).toBeDisabled()
  })

  it("con todo completo envía el pedido y cierra la sesión", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ success: true, deletionDate: "2026-11-04T00:00:00Z" }, 200))
    vi.stubGlobal("fetch", fetchMock)
    renderDialog()
    llenar({ slug: " Taller-Uno " })
    expect(boton()).toBeEnabled()
    fireEvent.click(boton())
    await waitFor(() => expect(cerrarSesionTrasBaja).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith("/api/account/delete-organization", expect.objectContaining({
      method: "POST", body: JSON.stringify({ confirmSlug: " Taller-Uno ", password: "abc" }),
    }))
  })

  it("no permite doble envío mientras la petición está pendiente", async () => {
    let resolver!: (r: Response) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => { resolver = r }))
    vi.stubGlobal("fetch", fetchMock)
    renderDialog()
    llenar()
    fireEvent.click(boton())
    fireEvent.click(boton())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(boton()).toBeDisabled()
    resolver(res({ success: true }, 200))
    await waitFor(() => expect(cerrarSesionTrasBaja).toHaveBeenCalled())
  })

  it("mientras envía, cerrar el diálogo queda bloqueado", () => {
    const onOpenChange = vi.fn()
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})))
    render(<EliminarTallerDialog open onOpenChange={onOpenChange} info={info} />)
    llenar()
    fireEvent.click(boton())
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("502: muestra el mensaje de soporte y NO cierra la sesión", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "otro texto" }, 502)))
    renderDialog()
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cancelar tu suscripción, reintentá o escribí a soporte")
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
    expect(boton()).toBeEnabled()
  })

  it("409: ya está en proceso de eliminación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "x" }, 409)))
    renderDialog()
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent(/ya está en proceso de eliminación/i)
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })

  it("cuenta bloqueada (429): muestra el mensaje de reautenticación", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ code: "ACCOUNT_LOCKED" }, 429)))
    renderDialog()
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent(/demasiados intentos/i)
  })

  it("contraseña incorrecta (401): muestra el error del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res({ error: "Contraseña incorrecta", code: "WRONG_CREDENTIAL" }, 401)))
    renderDialog()
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent("Contraseña incorrecta")
  })

  it("respuesta no JSON o null no rompe: mensaje genérico", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 500 })))
    renderDialog()
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos eliminar el taller/)
    expect(boton()).toBeEnabled()
  })

  it("error de red: mensaje de reintento y vuelve a habilitar el botón", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")))
    renderDialog()
    llenar()
    fireEvent.click(boton())
    expect(await screen.findByRole("alert")).toHaveTextContent(/conexión/i)
    expect(boton()).toBeEnabled()
    expect(cerrarSesionTrasBaja).not.toHaveBeenCalled()
  })
})
