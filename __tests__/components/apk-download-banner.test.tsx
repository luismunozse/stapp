import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const native = vi.hoisted(() => ({ value: false }))
vi.mock("@/lib/capacitor", () => ({ isNativePlatform: () => native.value }))

import { ApkDownloadBanner } from "@/components/shared/apk-download-banner"

const LINK = "https://play.google.com/apps/testing/ar.com.stapp.app"

function respuesta(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response)
}

/** GET devuelve `get`; POST devuelve `post` (o falla si post === "error"). */
function mockFetch(get: unknown, post?: unknown) {
  const fn = vi.fn((_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return post === "error" ? respuesta({ error: "x" }, false) : respuesta(post)
    return get === "error" ? respuesta({ error: "x" }, false) : respuesta(get)
  })
  vi.stubGlobal("fetch", fn)
  return fn
}

describe.each(["sidebar", "top"] as const)("banner de la beta de Android (%s)", (variant) => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.value = false
    window.localStorage.clear()
  })

  it("sin inscripcion: invita a sumarse y pide el correo de Google", async () => {
    mockFetch({ inscripcion: null })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText("Sumate a la beta de Android")).toBeInTheDocument()
    expect(screen.getByText("Probá la app antes que nadie")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("Tu cuenta de Google del celular")).toBeInTheDocument()
    // Tiene que ser la cuenta con la que entra a Play Store en el celular.
    expect(screen.getByText(/Play Store/)).toBeInTheDocument()
    expect(screen.queryByText(/APK/)).not.toBeInTheDocument()
  })

  it("DESCARTADO se comporta como si no estuviera anotado", async () => {
    mockFetch({ inscripcion: { email: "a@gmail.com", estado: "DESCARTADO" } })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText("Sumate a la beta de Android")).toBeInTheDocument()
    expect(screen.queryByText(/Te anotamos/)).not.toBeInTheDocument()
  })

  it("al enviar manda el correo y pasa a 'te anotamos'", async () => {
    const fetchMock = mockFetch({ inscripcion: null }, { inscripcion: { email: "ana@gmail.com", estado: "PENDIENTE" } })
    render(<ApkDownloadBanner variant={variant} />)
    const input = await screen.findByPlaceholderText("Tu cuenta de Google del celular")
    fireEvent.change(input, { target: { value: "ana@gmail.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Sumarme" }))

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")
      expect(post![0]).toBe("/api/beta-android")
      expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({ email: "ana@gmail.com" })
    })
    expect(await screen.findByText(/Te anotamos con ana@gmail.com/)).toBeInTheDocument()
  })

  it("un correo que no es un correo no se manda", async () => {
    const fetchMock = mockFetch({ inscripcion: null })
    render(<ApkDownloadBanner variant={variant} />)
    const input = await screen.findByPlaceholderText("Tu cuenta de Google del celular")
    fireEvent.change(input, { target: { value: "ana" } })
    fireEvent.click(screen.getByRole("button", { name: "Sumarme" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/correo/i)
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false)
  })

  it("si el servidor falla al anotarlo avisa y deja reintentar", async () => {
    mockFetch({ inscripcion: null }, "error")
    render(<ApkDownloadBanner variant={variant} />)
    const input = await screen.findByPlaceholderText("Tu cuenta de Google del celular")
    fireEvent.change(input, { target: { value: "ana@gmail.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Sumarme" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/No pudimos/)
    expect(screen.getByRole("button", { name: "Sumarme" })).toBeEnabled()
  })

  it("PENDIENTE: dice con que correo lo anotamos y que le avisamos", async () => {
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "PENDIENTE" } })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText(/Te anotamos con ana@gmail.com/)).toBeInTheDocument()
    expect(screen.getByText(/Te avisamos acá cuando esté lista tu invitación/)).toBeInTheDocument()
    expect(screen.queryByRole("link", { name: /Aceptar invitación/ })).not.toBeInTheDocument()
  })

  it("PENDIENTE: 'cambiar correo' vuelve al formulario con el correo cargado", async () => {
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "PENDIENTE" } })
    render(<ApkDownloadBanner variant={variant} />)
    fireEvent.click(await screen.findByRole("button", { name: /cambiar correo/i }))
    const input = screen.getByPlaceholderText("Tu cuenta de Google del celular") as HTMLInputElement
    expect(input.value).toBe("ana@gmail.com")
  })

  it("AGREGADO: 'Ya estás adentro' con el boton que abre la invitacion en otra pestaña", async () => {
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "AGREGADO", linkInvitacion: LINK } })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText("¡Ya estás adentro!")).toBeInTheDocument()
    const link = screen.getByRole("link", { name: /Aceptar invitación/ })
    expect(link).toHaveAttribute("href", LINK)
    expect(link).toHaveAttribute("target", "_blank")
    expect(link.getAttribute("rel")).toContain("noopener")
    // Explica el orden: primero aceptar, despues instalar desde Play Store.
    expect(screen.getByText(/instalá STApp desde Play Store/)).toBeInTheDocument()
  })

  it("si falla la lectura no dibuja nada (no rompe el layout)", async () => {
    const fetchMock = mockFetch("error")
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it("si fetch revienta (sin red) no dibuja nada", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))))
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it("en la app nativa no se muestra ni consulta la API", async () => {
    native.value = true
    const fetchMock = mockFetch({ inscripcion: null })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("cerrar lo oculta 7 dias", async () => {
    mockFetch({ inscripcion: null })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await screen.findByText("Sumate a la beta de Android")
    fireEvent.click(screen.getByRole("button", { name: /Cerrar/ }))
    expect(container).toBeEmptyDOMElement()
    const guardado = window.localStorage.getItem("android-beta-banner-dismissed")
    expect(Number(guardado)).toBeGreaterThan(Date.now() - 5000)
  })

  it("cerrado hace menos de 7 dias + sin inscripcion: queda oculto", async () => {
    window.localStorage.setItem("android-beta-banner-dismissed", String(Date.now() - 2 * 86400000))
    mockFetch({ inscripcion: null })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it("cerrado hace menos de 7 dias + PENDIENTE: queda oculto", async () => {
    window.localStorage.setItem("android-beta-banner-dismissed", String(Date.now() - 2 * 86400000))
    const fetchMock = mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "PENDIENTE" } })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it("cerrado hace menos de 7 dias + AGREGADO: igual muestra la invitacion (es lo unico accionable)", async () => {
    window.localStorage.setItem("android-beta-banner-dismissed", String(Date.now() - 2 * 86400000))
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "AGREGADO", linkInvitacion: LINK } })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText("¡Ya estás adentro!")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Aceptar invitación/ })).toHaveAttribute("href", LINK)
  })

  it("AGREGADO se puede cerrar con su propia clave y no pisa la de los otros estados", async () => {
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "AGREGADO", linkInvitacion: LINK } })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await screen.findByText("¡Ya estás adentro!")
    fireEvent.click(screen.getByRole("button", { name: /Cerrar/ }))
    expect(container).toBeEmptyDOMElement()
    expect(Number(window.localStorage.getItem("android-beta-banner-dismissed-agregado"))).toBeGreaterThan(Date.now() - 5000)
    expect(window.localStorage.getItem("android-beta-banner-dismissed")).toBeNull()
  })

  it("AGREGADO cerrado hace menos de 7 dias queda oculto", async () => {
    window.localStorage.setItem("android-beta-banner-dismissed-agregado", String(Date.now() - 2 * 86400000))
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "AGREGADO", linkInvitacion: LINK } })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container).toBeEmptyDOMElement()
  })

  it("AGREGADO cerrado hace mas de 7 dias vuelve a aparecer", async () => {
    window.localStorage.setItem("android-beta-banner-dismissed-agregado", String(Date.now() - 8 * 86400000))
    mockFetch({ inscripcion: { email: "ana@gmail.com", estado: "AGREGADO", linkInvitacion: LINK } })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText("¡Ya estás adentro!")).toBeInTheDocument()
  })

  it("si lo cerro hace mas de 7 dias vuelve a aparecer", async () => {
    window.localStorage.setItem("android-beta-banner-dismissed", String(Date.now() - 8 * 86400000))
    mockFetch({ inscripcion: null })
    render(<ApkDownloadBanner variant={variant} />)
    expect(await screen.findByText("Sumate a la beta de Android")).toBeInTheDocument()
  })

  it("si localStorage tira error igual funciona", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    mockFetch({ inscripcion: null })
    const { container } = render(<ApkDownloadBanner variant={variant} />)
    await screen.findByText("Sumate a la beta de Android")
    fireEvent.click(screen.getByRole("button", { name: /Cerrar/ }))
    expect(container).toBeEmptyDOMElement()
    vi.restoreAllMocks()
  })
})
